/**
 * 瀏覽器預覽伺服器(WP-P):用一般瀏覽器開 `http://127.0.0.1:<port>/t/<token>/` 看/改設定,與 overlay 同步。
 * 照 PobTools `host/modern_ui_browser.cpp` 的做法,但用 Node `http`(零新依賴),而且**不 import electron**
 * (vitest 直接測;handlers 與靜態根目錄由呼叫端注入)。
 *
 * 安全模型(細節見 docs/browser-preview.md):
 * - 只綁 127.0.0.1、port 0(系統給臨時埠);
 * - 所有路徑都要帶隨機 token 前綴 `/t/<32 hex>/`,不符 → 404;
 * - `Host` 標頭必須正好是 `127.0.0.1:<port>`,否則 421(擋 DNS rebinding);
 * - 帶 `Origin` 的請求必須是本伺服器的 origin,否則 403(擋其他網頁跨站 POST);
 * - 靜態檔與 `app://` 相同的根目錄與防穿越規則。
 * - 自訂背景圖 `<prefix>bg/<檔名>`(同樣在 token 之後):與 `app://bg/` 同一支 `resolveBgPath`(只准 png / jpg / webp、不跳出資料夾)。
 *
 * 協定(boot script 產生的 `window.host` shim 用):
 * - `POST ~rpc` `{id, cid, method, args}` → 202;結果之後從 SSE 回 `{id, result}` 或 `{id, error:{message}}`(只送給該 cid)。
 * - `GET ~events?cid=<cid>`:SSE。每則 `id: <seq>`;事件 `{event, data}` 送給所有連線。
 *   重連帶 `Last-Event-ID` → 從下一則續傳;新連線只收「給自己的舊回覆」+ 連上之後的廣播。15 秒送一次 keep-alive 註解。
 * - 佇列保留(2026-10-01 效能修正第 9 步):給 cid 的回覆送達後只再留 `replyGraceMs`(5 秒,斷線重連補送用);
 *   該 cid 的連線全部斷掉超過 5 秒 → 丟掉它未送達的回覆;從沒連上過的 cid 留 `unclaimedReplyMs`(30 秒)。
 *   廣播照舊只受總量上限限制。總量上限以 UTF-8 位元組計(512 則 / 32 MB);≥ 256 KB 的大項目另有 4 MB 合計上限
 *   (超過先丟已送達的)。
 * - 靜態檔快取:`assets/` 下 Vite 帶 hash 的檔 `public, max-age=31536000, immutable`;其他檔(含背景圖)`no-cache` +
 *   `ETag`(大小 + mtime),`If-None-Match` 相符回 304;`index.html`(boot script 內含 token)維持 `no-store`。
 * - 自動關閉:曾有連線後 20 秒沒有任何 SSE 連線,或啟動後 180 秒都沒人連 → 關閉(`onClose(reason)`)。
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AddressInfo, Socket } from 'node:net'
import { bgContentType, bgFileFromPath, resolveBgPath } from './backgrounds'

export interface PreviewCtx { source: 'preview', clientId: string }
export type PreviewHandler = (ctx: PreviewCtx, ...args: any[]) => unknown

/** `HostApi` 方法名 → main 的 IPC channel(與 preload.ts 一一對應;只列預覽端經 RPC 的)。 */
export const HOST_METHOD_CHANNELS: Readonly<Record<string, string>> = {
  fetch: 'http-fetch',
  fetchAbort: 'http-abort',
  loadConfig: 'config-load',
  saveConfig: 'config-save',
  regexStateLoad: 'regex-state-load',
  regexStateSave: 'regex-state-save',
  dustUiLoad: 'dust-ui-load',
  dustUiSave: 'dust-ui-save',
  ninjaCacheLoad: 'ninja-cache-load',
  ninjaCacheSave: 'ninja-cache-save',
  updateHostConfig: 'host-config',
  openExternal: 'open-external',
  openCaptcha: 'open-captcha',
  getUpdaterInfo: 'updater-info',
  checkForUpdate: 'updater-check',
  downloadUpdate: 'updater-download',
  installUpdate: 'updater-install',
  openPreview: 'preview-open',
  getPreviewUrl: 'preview-url',
  listFonts: 'list-fonts'
}

/** `HostApi` 訂閱方法 → 事件名(預覽端只會收到 main `PREVIEW_EVENTS` 放行的那幾個)。 */
export const HOST_EVENT_METHODS: Readonly<Record<string, string>> = {
  onItemText: 'item-text',
  onFocusChange: 'focus-change',
  onHideWidget: 'hide-exclusive-widget',
  onSwitchGame: 'switch-game',
  onOpenSettings: 'open-settings',
  onUpdaterState: 'updater-state',
  onConfigChanged: 'config-changed',
  // 褻瀆自動辨識:事件不在 PREVIEW_EVENTS,預覽端永遠收不到(只訂閱不報錯)
  onRevealScanResult: 'reveal-scan-result',
  // WP-S2:框選熱鍵事件同樣只給 overlay
  onOcrRegionPick: 'ocr-region-pick',
  // WP-R2:符文塑形掃描結果同樣只給 overlay(不在 PREVIEW_EVENTS)
  onRuneshapeScanResult: 'runeshape-scan-result'
}

/**
 * 瀏覽器端沒有視窗可控:這幾個在 shim 裡直接 no-op(不走 RPC)。`ocrRevealAvailable`(WP-S)回 undefined = 預覽端不適用;
 * WP-S2 的 `overlayActivate` / `ocrRevealNow` 也是(預覽端設定卡片隱藏「在遊戲上框選」)。
 */
export const PREVIEW_NOOP_ASYNC = ['hideWindow', 'resizeWindow', 'ocrRevealAvailable', 'overlayActivate', 'ocrRevealNow', 'runeshapeStats', 'revealStats'] as const
/** WP-R2:`runeshapeUiState`(預覽分頁開設定不該暫停 overlay 的掃描)也是 no-op */
export const PREVIEW_NOOP_SYNC = ['trackArea', 'focusGame', 'usedRecently', 'runeshapeUiState'] as const

export interface PreviewServerOptions {
  /** 靜態檔根目錄(與 `app://` 相同:打包後是 app 根目錄,開發模式是 renderer/dist)。 */
  staticRoot: string
  /** 自訂背景圖資料夾(`userData/backgrounds`);`<prefix>bg/<檔名>` 供應,與 `app://bg/` 同一套檔名 / 防穿越規則。省略 = 沒有這條路由 */
  bgDir?: string
  /** channel → handler(只含開放給預覽端的)。 */
  handlers: Readonly<Record<string, PreviewHandler>>
  version: string
  methodChannels?: Readonly<Record<string, string>>
  token?: string
  log?: (msg: string) => void
  onClose?: (reason: string) => void
  /** 測試用時鐘(ms)。 */
  now?: () => number
  /** 閒置檢查間隔;0 = 不自動檢查(測試手動呼叫 `checkIdle()`)。 */
  idleCheckMs?: number
  goneMs?: number
  firstConnectMs?: number
  keepAliveMs?: number
  /** 給 cid 的回覆送達後(或該 cid 連線全斷後)再保留多久供重連補送;預設 5000。 */
  replyGraceMs?: number
  /** 從沒連上過的 cid 的回覆保留多久(RPC 比 SSE 先到);預設 30000。 */
  unclaimedReplyMs?: number
}

export interface PreviewServer {
  readonly url: string
  readonly origin: string
  readonly prefix: string
  readonly port: number
  readonly token: string
  readonly closed: boolean
  readonly streamCount: number
  /** 事件佇列目前的則數 / UTF-8 位元組(測試與診斷用)。 */
  readonly queueStats: { count: number, bytes: number }
  /** 廣播事件給所有預覽 client。 */
  push: (event: string, data: unknown) => void
  /** 依 now() 判斷是否該自動關閉(true = 已關或正在關)。 */
  checkIdle: () => boolean
  close: (reason?: string) => Promise<void>
}

interface Queued {
  seq: number
  to?: string
  line: string
  /** `line` 的 UTF-8 位元組數 */
  bytes: number
  /** 入佇列時間(now()) */
  at: number
  /** 給 cid 的回覆最近一次寫到該 cid 連線的時間 */
  deliveredAt?: number
}
interface Stream { res: http.ServerResponse, cid: string, next: number, minBroadcastSeq: number }

const CID_RE = /^[A-Za-z0-9_-]{1,64}$/
const MAX_QUEUE = 512
/** 佇列總量上限(UTF-8 位元組;以前是 UTF-16 長度,中文約為兩倍以上) */
export const MAX_QUEUE_BYTES = 32 * 1024 * 1024
/** 單則 ≥ 這個大小算大項目(`http-fetch` 回應、`ninja-cache-load` 快照) */
export const LARGE_ENTRY_BYTES = 256 * 1024
/** 大項目合計保留上限;超過先丟已送達的大回覆 */
export const MAX_LARGE_BYTES = 4 * 1024 * 1024
const MAX_BODY = 64 * 1024 * 1024
/** `assets/` 下 Vite 的輸出檔名 `<name>-<8 碼 hash>.<ext>`(整個 assets/ 都是 Vite 產物,public/ 的檔在根目錄) */
const HASHED_ASSET_RE = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/

/** 弱 ETag:大小 + mtime(檔案換了大小或時間就變)。 */
export function fileEtag (st: { size: number, mtimeMs: number }): string {
  return `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
}

/** `If-None-Match` 是否與 etag 相符(弱比對;`*` 一律相符)。 */
export function etagMatches (ifNoneMatch: string | string[] | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false
  const raw = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(',') : ifNoneMatch
  const want = etag.replace(/^W\//, '')
  return raw.split(',').some((t) => {
    const v = t.trim()
    return v === '*' || v.replace(/^W\//, '') === want
  })
}

/** 相對於靜態根目錄的路徑是 `assets/<Vite 帶 hash 檔名>` → 可永久快取。 */
export function isHashedAsset (root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), file).split(path.sep)
  return rel.length === 2 && rel[0] === 'assets' && HASHED_ASSET_RE.test(rel[1])
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.bin': 'application/octet-stream'
}

/** 與 main.ts `installAppProtocol` 相同的對應與防穿越:回傳根目錄內的絕對路徑,越界回 null。 */
export function resolveStatic (root: string, relUrlPath: string): string | null {
  let rel: string
  try { rel = decodeURIComponent(relUrlPath) } catch { return null }
  if (rel.includes('\0')) return null
  if (rel === '' || rel === '/') rel = '/index.html'
  if (!rel.startsWith('/')) rel = '/' + rel
  const base = path.resolve(root)
  const file = path.normalize(path.join(base, rel))
  if (file !== base && !file.startsWith(base + path.sep)) return null
  return file
}

/** 在第一個 `<script` 前插入 boot script(沒有 script 就插在 `</head>` 前,再沒有就最前面)。 */
export function injectBootScript (html: string, script: string): string {
  const tag = `<script>${script}</script>`
  let at = html.search(/<script\b/i)
  if (at < 0) at = html.search(/<\/head>/i)
  if (at < 0) at = 0
  return html.slice(0, at) + tag + html.slice(at)
}

/** 產生 `window.host` shim(字串;烤入 prefix / version / 方法表)。 */
export function bootScript (opts: { prefix: string, version: string, methodChannels?: Readonly<Record<string, string>> }): string {
  const methods = Object.keys(opts.methodChannels ?? HOST_METHOD_CHANNELS)
  const cfg = {
    P: opts.prefix,
    V: opts.version,
    M: methods,
    E: HOST_EVENT_METHODS,
    NA: PREVIEW_NOOP_ASYNC,
    NS: PREVIEW_NOOP_SYNC
  }
  // `<` 轉義,避免 `</script>` 提早結束
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c')
  return `(function(){var C=${json};
var cid=(Math.random().toString(36).slice(2)+Date.now().toString(36)).replace(/[^a-z0-9]/g,'').slice(0,40);
var seq=0,pending={},subs={},es=null,lostT=null,lost=false,autoOpened=false;
var TABS=['general','price-check','hotkeys','chat','regex','dust','about'];
var m=/(?:^|[#&])tab=([a-z-]+)/.exec(location.hash||'');var tab=m&&TABS.indexOf(m[1])>=0?m[1]:'general';
function emit(n,d){var a=subs[n];if(!a)return;a.slice().forEach(function(cb){try{cb(d)}catch(e){console.error(e)}})}
function banner(on){try{var id='host-preview-lost',el=document.getElementById(id);
if(on&&!el){el=document.createElement('div');el.id=id;el.setAttribute('role','status');
el.style.cssText='position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:6px 12px;background:#7a2a22;color:#fff;font:13px system-ui,sans-serif;text-align:center';
el.textContent=/^zh/i.test(navigator.language||'')?'已與 ExileAppraiser 斷線(程式已結束或預覽已關閉;請從托盤重新開啟)':'Disconnected from ExileAppraiser (the app quit or the preview closed; reopen it from the tray)';
(document.body||document.documentElement).appendChild(el)}else if(!on&&el){el.remove()}}catch(e){}}
function failAll(msg){var p=pending;pending={};Object.keys(p).forEach(function(k){p[k].reject(new Error(msg))})}
function connect(){es=new EventSource(C.P+'~events?cid='+cid);
es.onmessage=function(e){var x;try{x=JSON.parse(e.data)}catch(_){return}
if(x.id!=null){var p=pending[x.id];if(!p)return;delete pending[x.id];if(x.error)p.reject(new Error(x.error.message||'error'));else p.resolve(x.result);return}
if(x.event){if(x.event==='config-changed'&&x.data&&x.data.source==='preview:'+cid)return;emit(x.event,x.data)}};
es.onopen=function(){if(lostT){clearTimeout(lostT);lostT=null}if(lost){lost=false;banner(false);emit('host.reconnected');try{window.dispatchEvent(new CustomEvent('host.reconnected'))}catch(_){}}};
es.onerror=function(){if(!lostT&&!lost){lostT=setTimeout(function(){lostT=null;lost=true;banner(true);failAll('host.disconnected');emit('host.disconnected');try{window.dispatchEvent(new CustomEvent('host.disconnected'))}catch(_){}},4000)}}}
function call(method,args){return new Promise(function(resolve,reject){var id=cid+':'+(++seq);pending[id]={resolve:resolve,reject:reject};
fetch(C.P+'~rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,cid:cid,method:method,args:args})})
.then(function(r){if(r.status!==202){delete pending[id];reject(new Error('rpc '+method+' HTTP '+r.status))}})
.catch(function(e){delete pending[id];reject(e)})})}
var host={isElectron:true,isPreview:true,version:C.V,windowMode:'window',previewClientId:cid};
C.M.forEach(function(k){host[k]=function(){return call(k,Array.prototype.slice.call(arguments))}});
C.NA.forEach(function(k){host[k]=function(){return Promise.resolve()}});
C.NS.forEach(function(k){host[k]=function(){}});
Object.keys(C.E).forEach(function(k){var n=C.E[k];host[k]=function(cb){(subs[n]=subs[n]||[]).push(cb);
if(k==='onOpenSettings'&&!autoOpened){autoOpened=true;setTimeout(function(){cb({tab:tab})},0)}
return function(){var a=subs[n]||[],i=a.indexOf(cb);if(i>=0)a.splice(i,1)}}});
window.host=host;connect();})();`
}

function randomToken (): string {
  return crypto.randomBytes(16).toString('hex')
}

export async function startPreviewServer (opts: PreviewServerOptions): Promise<PreviewServer> {
  const token = opts.token ?? randomToken()
  if (!/^[0-9a-f]{32}$/.test(token)) throw new Error('preview token must be 32 hex')
  const prefix = `/t/${token}/`
  const methodChannels = opts.methodChannels ?? HOST_METHOD_CHANNELS
  const log = opts.log ?? (() => {})
  const now = opts.now ?? Date.now
  const goneMs = opts.goneMs ?? 20_000
  const firstConnectMs = opts.firstConnectMs ?? 180_000
  const keepAliveMs = opts.keepAliveMs ?? 15_000
  const replyGraceMs = opts.replyGraceMs ?? 5_000
  const unclaimedReplyMs = opts.unclaimedReplyMs ?? 30_000
  const startedAt = now()

  const queue: Queued[] = []
  let queueBytes = 0
  let largeBytes = 0
  let nextSeq = 1
  const streams = new Set<Stream>()
  /** cid → 該 cid 最後一條連線斷掉的時間(有連線時不在表內;從沒連過也不在表內) */
  const cidGoneAt = new Map<string, number>()
  let everConnected = false
  let lastStreamSeen = startedAt
  let closed = false
  let hostHeader = ''
  let origin = ''
  const sockets = new Set<Socket>()

  const writeTo = (s: Stream) => {
    let out = ''
    const t = now()
    for (const q of queue) {
      if (q.seq < s.next) continue
      if (q.to !== undefined ? q.to === s.cid : q.seq >= s.minBroadcastSeq) {
        out += `id: ${q.seq}\ndata: ${q.line}\n\n`
        if (q.to !== undefined) q.deliveredAt = t
      }
    }
    s.next = nextSeq
    if (out) s.res.write(out)
  }

  const cidLive = (cid: string): boolean => {
    for (const s of streams) if (s.cid === cid) return true
    return false
  }

  const removeAt = (i: number) => {
    const [q] = queue.splice(i, 1)
    queueBytes -= q.bytes
    if (q.bytes >= LARGE_ENTRY_BYTES) largeBytes -= q.bytes
  }

  /** 給 cid 的回覆是否已過保留期(廣播一律 false,只受總量上限)。 */
  const replyExpired = (q: Queued, t: number): boolean => {
    if (q.to === undefined) return false
    if (q.deliveredAt !== undefined) return t - q.deliveredAt >= replyGraceMs
    if (cidLive(q.to)) return false
    const gone = cidGoneAt.get(q.to)
    if (gone !== undefined) return t - Math.max(gone, q.at) >= replyGraceMs
    return t - q.at >= unclaimedReplyMs
  }

  /** 丟掉過期的回覆、清掉不再需要的 cid 斷線紀錄。 */
  const prune = () => {
    const t = now()
    for (let i = queue.length - 1; i >= 0; i--) {
      if (replyExpired(queue[i], t)) removeAt(i)
    }
    if (cidGoneAt.size) {
      const waiting = new Set<string>()
      for (const q of queue) if (q.to !== undefined && q.deliveredAt === undefined) waiting.add(q.to)
      for (const [cid, gone] of cidGoneAt) {
        if (!waiting.has(cid) && t - gone >= replyGraceMs) cidGoneAt.delete(cid)
      }
    }
  }

  const enqueue = (line: string, to?: string) => {
    if (closed) return
    const bytes = Buffer.byteLength(line, 'utf8')
    queue.push({ seq: nextSeq++, to, line, bytes, at: now() })
    queueBytes += bytes
    if (bytes >= LARGE_ENTRY_BYTES) largeBytes += bytes
    prune()
    while (queue.length > MAX_QUEUE || (queueBytes > MAX_QUEUE_BYTES && queue.length > 1)) removeAt(0)
    for (const s of streams) writeTo(s)
    // 大項目合計超過上限:先丟最舊的已送達大回覆(未送達的留給總量上限處理)
    while (largeBytes > MAX_LARGE_BYTES) {
      const i = queue.findIndex(q => q.bytes >= LARGE_ENTRY_BYTES && q.deliveredAt !== undefined)
      if (i < 0) break
      removeAt(i)
    }
  }

  const push = (event: string, data: unknown) => {
    enqueue(JSON.stringify({ event, data }))
  }

  const respond = (res: http.ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(body)
  }

  const runRpc = async (cid: string, id: unknown, method: string, args: unknown[]) => {
    let line: string
    try {
      const channel = Object.prototype.hasOwnProperty.call(methodChannels, method) ? methodChannels[method] : undefined
      const fn = channel && Object.prototype.hasOwnProperty.call(opts.handlers, channel) ? opts.handlers[channel] : undefined
      if (!fn) throw new Error(`unknown method: ${method}`)
      // JSON 把 undefined 參數變成 null;handler 的預設參數只認 undefined
      const result = await fn({ source: 'preview', clientId: cid }, ...args.map(a => a === null ? undefined : a))
      line = JSON.stringify({ id, result: result === undefined ? null : result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      line = JSON.stringify({ id, error: { message } })
    }
    enqueue(line, cid)
  }

  const handleRpc = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const chunks: Buffer[] = []
    let size = 0
    let aborted = false
    req.on('data', (c: Buffer) => {
      if (aborted) return
      size += c.length
      if (size > MAX_BODY) { aborted = true; respond(res, 413, 'too large'); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      if (aborted) return
      let msg: { id?: unknown, cid?: unknown, method?: unknown, args?: unknown }
      try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return respond(res, 400, 'bad json') }
      if (msg == null || typeof msg.cid !== 'string' || !CID_RE.test(msg.cid) || typeof msg.method !== 'string' ||
        (typeof msg.id !== 'string' && typeof msg.id !== 'number') || (msg.args !== undefined && !Array.isArray(msg.args))) {
        return respond(res, 400, 'bad request')
      }
      respond(res, 202, '{"ok":true}', 'application/json')
      void runRpc(msg.cid, msg.id, msg.method, (msg.args as unknown[] | undefined) ?? [])
    })
  }

  const handleEvents = (req: http.IncomingMessage, res: http.ServerResponse, cid: string) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.write('retry: 1000\n\n')
    const lastRaw = req.headers['last-event-id']
    const last = typeof lastRaw === 'string' && /^\d+$/.test(lastRaw) ? Number(lastRaw) : null
    // 續傳:從 Last-Event-ID 的下一則(已被擠出佇列的就從佇列頭);
    // 新連線:給自己的舊回覆全補(RPC 可能比 SSE 先送出),廣播只收連上之後的(不重播舊事件)
    const s: Stream = last !== null
      ? { res, cid, next: last + 1, minBroadcastSeq: 0 }
      : { res, cid, next: 0, minBroadcastSeq: nextSeq }
    streams.add(s)
    cidGoneAt.delete(cid)
    if (!everConnected) log(`[preview] 第一個瀏覽器連上 (cid=${cid})`)
    everConnected = true
    lastStreamSeen = now()
    writeTo(s)
    const ka = setInterval(() => { res.write(': keep-alive\n\n') }, keepAliveMs)
    const done = () => {
      clearInterval(ka)
      if (streams.delete(s)) {
        lastStreamSeen = now()
        if (!cidLive(cid)) cidGoneAt.set(cid, lastStreamSeen)
        if (streams.size === 0) log(`[preview] 已無瀏覽器連線;${Math.round(goneMs / 1000)} 秒內沒人重連就關閉`)
      }
    }
    req.on('close', done)
    res.on('close', done)
  }

  /**
   * 帶 validator 的檔案回應:`If-None-Match` 相符 → 304(不讀檔);否則 200 + 檔案內容(HEAD 不讀檔)。
   * 讀檔失敗 → 404。
   */
  const sendFile = async (req: http.IncomingMessage, res: http.ServerResponse, file: string, st: { size: number, mtimeMs: number },
    type: string, cacheControl: string, headOnly: boolean) => {
    const etag = fileEtag(st)
    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': type,
      'Cache-Control': cacheControl,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff'
    }
    if (etagMatches(req.headers['if-none-match'], etag)) {
      delete headers['Content-Type']
      res.writeHead(304, headers)
      return res.end()
    }
    let data: Buffer | undefined
    if (!headOnly) {
      try { data = await fs.readFile(file) } catch { return respond(res, 404, 'not found') }
    }
    headers['Content-Length'] = data ? data.length : st.size
    res.writeHead(200, headers)
    res.end(data)
  }

  const serveStatic = async (req: http.IncomingMessage, res: http.ServerResponse, rel: string, headOnly: boolean) => {
    const file = resolveStatic(opts.staticRoot, rel)
    if (!file) return respond(res, 403, 'forbidden')
    let st: Awaited<ReturnType<typeof fs.stat>>
    try {
      st = await fs.stat(file)
      if (!st.isFile()) return respond(res, 404, 'not found')
    } catch {
      return respond(res, 404, 'not found')
    }
    const ext = path.extname(file).toLowerCase()
    const type = CONTENT_TYPES[ext] ?? 'application/octet-stream'
    if (path.basename(file).toLowerCase() !== 'index.html') {
      // Vite 帶 hash 的檔內容不會變 → 永久快取;其他檔每次驗證(ETag → 304)
      const cc = isHashedAsset(opts.staticRoot, file) ? 'public, max-age=31536000, immutable' : 'no-cache'
      return await sendFile(req, res, file, st, type, cc, headOnly)
    }
    // index.html:boot script 內含 token 前綴 → 不快取、不給 validator(與以前相同)
    let data: Buffer
    try { data = await fs.readFile(file) } catch { return respond(res, 404, 'not found') }
    const body = injectBootScript(data.toString('utf8'), bootScript({ prefix, version: opts.version, methodChannels }))
    res.writeHead(200, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Length': Buffer.byteLength(body)
    })
    res.end(headOnly ? undefined : body)
  }

  /** 自訂背景圖(token 之後的 `bg/<檔名>`;檔名不合法 / 跳出資料夾 / 不存在一律 404) */
  const serveBg = async (req: http.IncomingMessage, res: http.ServerResponse, rest: string, headOnly: boolean) => {
    const name = opts.bgDir ? bgFileFromPath(rest.slice('bg/'.length)) : null
    const file = name == null || !opts.bgDir ? null : resolveBgPath(opts.bgDir, name)
    if (!file) return respond(res, 404, 'not found')
    let st: Awaited<ReturnType<typeof fs.stat>>
    try {
      st = await fs.stat(file)
      if (!st.isFile()) return respond(res, 404, 'not found')
    } catch {
      return respond(res, 404, 'not found')
    }
    // 網址在 token 之後(換 token = 換網址,不會拿到別的伺服器的快取);同名檔被換掉時 ETag 跟著變
    await sendFile(req, res, file, st, bgContentType(file), 'no-cache', headOnly)
  }

  const server = http.createServer((req, res) => {
    if (closed) return respond(res, 503, 'closed')
    // Host 必須正好是本機位址(擋 DNS rebinding)
    if ((req.headers.host ?? '').toLowerCase() !== hostHeader) return respond(res, 421, 'bad host')
    const reqOrigin = req.headers.origin
    if (reqOrigin !== undefined && reqOrigin !== origin) return respond(res, 403, 'bad origin')
    let url: URL
    try { url = new URL(req.url ?? '/', origin) } catch { return respond(res, 400, 'bad url') }
    const p = url.pathname
    if (p === prefix.slice(0, -1)) {
      res.writeHead(308, { Location: prefix, 'Cache-Control': 'no-store' })
      return res.end()
    }
    if (!p.startsWith(prefix)) return respond(res, 404, 'not found')
    const rest = p.slice(prefix.length)
    if (rest === '~rpc') {
      if (req.method !== 'POST') return respond(res, 405, 'method not allowed')
      return handleRpc(req, res)
    }
    if (rest === '~events') {
      if (req.method !== 'GET') return respond(res, 405, 'method not allowed')
      const cid = url.searchParams.get('cid') ?? ''
      if (!CID_RE.test(cid)) return respond(res, 400, 'bad cid')
      return handleEvents(req, res, cid)
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, 'method not allowed')
    if (rest.startsWith('bg/')) return void serveBg(req, res, rest, req.method === 'HEAD')
    void serveStatic(req, res, '/' + rest, req.method === 'HEAD')
  })
  server.on('connection', (sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const port = (server.address() as AddressInfo).port
  hostHeader = `127.0.0.1:${port}`
  origin = `http://${hostHeader}`

  let idleTimer: NodeJS.Timeout | null = null

  const close = async (reason = 'closed') => {
    if (closed) return
    closed = true
    if (idleTimer) clearInterval(idleTimer)
    for (const s of streams) { try { s.res.end() } catch {} }
    streams.clear()
    for (const sock of sockets) sock.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    log(`[preview] 伺服器已關閉(${reason})`)
    opts.onClose?.(reason)
  }

  const checkIdle = (): boolean => {
    if (closed) return true
    prune()
    if (streams.size > 0) return false
    const t = now()
    if (everConnected && t - lastStreamSeen >= goneMs) {
      void close(`${Math.round(goneMs / 1000)} 秒沒有瀏覽器連線`)
      return true
    }
    if (!everConnected && t - startedAt >= firstConnectMs) {
      void close(`啟動後 ${Math.round(firstConnectMs / 1000)} 秒沒有瀏覽器連上`)
      return true
    }
    return false
  }

  const idleCheckMs = opts.idleCheckMs ?? 1000
  if (idleCheckMs > 0) {
    idleTimer = setInterval(checkIdle, idleCheckMs)
    idleTimer.unref()
  }

  const url = `${origin}${prefix}`
  log(`[preview] 伺服器啟動 ${url}`)
  return {
    url,
    origin,
    prefix,
    port,
    token,
    get closed () { return closed },
    get streamCount () { return streams.size },
    get queueStats () { return { count: queue.length, bytes: queueBytes } },
    push,
    checkIdle,
    close
  }
}
