/**
 * renderer 的所有對外請求都走這裡(`ipcMain.handle('http-fetch')`):
 * - 用 Electron session 的 fetch 送出,才會帶 Cloudflare 在內建瀏覽器視窗解挑戰時拿到的 cookie;
 * - host 白名單(上游 `proxy.ts` 的 PROXY_HOSTS,縮成本專案會打的三個);
 * - Cloudflare 的 Set-Cookie 帶 `Partitioned`,Electron 的 net 沒有 partition key 可指定,剝掉才存得進去(上游同一招);
 *   只掛在交易站 / poe.ninja / Cloudflare 挑戰網域(`COOKIE_PATCH_URLS`),其他回應不必回 main JS 一趟;
 * - User-Agent 固定用 `app.userAgentFallback`(內含 `exile-appraiser/<version>`;GGG 靠它擋舊版第三方工具)。
 * - 逾時(2026-10-01 效能修正第 9 步):預設 30 秒(`init.timeoutMs` 可覆寫,1 秒 ~ 5 分鐘),涵蓋讀完 body;
 *   renderer 帶 `init.requestId` 時可用 `http-abort`(`abortHostFetch`)中止。逾時 / 中止都丟一般 `Error`,
 *   與網路錯誤同形狀(renderer 端 `ipcRenderer.invoke` reject)。
 */
import { app, session } from 'electron'
import type { HostFetchInit, HostFetchResult } from '@ipc/types'

const ALLOWED_HOSTS = new Set(['www.pathofexile.com', 'pathofexile.tw', 'poe.ninja'])

/**
 * Set-Cookie 剝 `Partitioned` 的範圍:`ALLOWED_HOSTS`(session fetch 要帶的 cookie)與驗證視窗會碰到的
 * 交易站子網域、Cloudflare 挑戰 iframe。match pattern 的 `*.example.com` 也涵蓋 `example.com` 本身。
 */
export const COOKIE_PATCH_URLS: readonly string[] = [
  '*://*.pathofexile.com/*',
  '*://*.pathofexile.tw/*',
  '*://*.poe.ninja/*',
  '*://challenges.cloudflare.com/*'
]

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 300_000
const REQUEST_ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/

/** 進行中、帶 abort key 的請求(`http-abort` 用)。 */
const inflight = new Map<string, AbortController>()

export function installCookiePatch () {
  session.defaultSession.webRequest.onHeadersReceived({ urls: [...COOKIE_PATCH_URLS] }, (details, next) => {
    const cookies = details.responseHeaders?.['set-cookie']
    if (cookies) {
      details.responseHeaders!['set-cookie'] = cookies.map(cookie =>
        cookie.split(';').filter(part => part.trim().toLowerCase() !== 'partitioned').join(';'))
    }
    next({ responseHeaders: details.responseHeaders })
  })
}

/** `timeoutMs` 不合法(非數字 / 越界)一律用預設值或夾到範圍內。 */
export function normTimeoutMs (v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_FETCH_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(v)))
}

/**
 * 呼叫端 + requestId → inflight 的鍵(不同來源 / 預覽分頁互不干擾);requestId 不合法回 undefined(= 不可中止)。
 */
export function abortKeyOf (ctx: { source: string, clientId?: string }, requestId: unknown): string | undefined {
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) return undefined
  return `${ctx.source}|${ctx.clientId ?? ''}|${requestId}`
}

/** 中止進行中的請求;找不到(已結束 / 不存在)回 false。 */
export function abortHostFetch (key: string | undefined): boolean {
  if (key === undefined) return false
  const ctrl = inflight.get(key)
  if (!ctrl) return false
  inflight.delete(key)
  ctrl.abort(new Error('request aborted'))
  return true
}

/** 測試用:目前進行中的可中止請求數。 */
export function inflightCount (): number { return inflight.size }

/** `p` 與 signal 賽跑:signal 先觸發就以 `onAbort()` 的錯誤 reject(body 讀取卡住時也能及時結束)。 */
function raceAbort<T> (p: Promise<T>, signal: AbortSignal, onAbort: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const listener = () => { reject(onAbort()) }
    signal.addEventListener('abort', listener, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', listener); resolve(v) },
      (e) => { signal.removeEventListener('abort', listener); reject(signal.aborted ? onAbort() : e) }
    )
  })
}

/**
 * 2026-11-26 診斷(使用者回報「查價沒反應」):交易站的請求每筆一行(狀態、耗時、限流狀態);poe.ninja 一次更新幾十筆,只記失敗。
 * 失敗時附回應開頭:HTML = Cloudflare 擋下 / 維護頁,JSON = 交易站的錯誤訊息(Query is too complex 等)。回 null = 不記。
 */
export function httpLogLine (method: string, url: URL, res: Pick<HostFetchResult, 'status' | 'headers' | 'body'>, ms: number): string | null {
  const bad = res.status >= 400
  if (!bad && url.host === 'poe.ninja') return null
  const rl = res.headers.find(([k]) => k.toLowerCase() === 'x-rate-limit-ip-state')?.[1]
  let hint = ''
  if (bad) {
    const head = res.body.trimStart()
    hint = head.startsWith('<')
      ? `,回應是 HTML(${/cloudflare|cf-ray|challenge/i.test(head) ? '可能是 Cloudflare 驗證' : '可能是維護 / 錯誤頁'})`
      : `,回應 ${head.slice(0, 160).replace(/\s+/g, ' ')}`
  }
  // fetch 端點的路徑是 10 個掛單 id,只留開頭
  const p = url.pathname.length > 80 ? `${url.pathname.slice(0, 80)}…` : url.pathname
  return `[http] ${method} ${url.host}${p} → ${res.status}(${ms} ms${rl ? `,限流 ${rl}` : ''})${hint}`
}

export async function hostFetch (url: string, init: HostFetchInit = {}, abortKey?: string): Promise<HostFetchResult> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.host)) {
    throw new Error(`refused host: ${parsed.host}`)
  }
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith('sec-') || ['host', 'origin', 'content-length', 'user-agent'].includes(key.toLowerCase())) delete headers[key]
  }
  headers['User-Agent'] = app.userAgentFallback

  const timeoutMs = normTimeoutMs(init.timeoutMs)
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(new Error('timeout')) }, timeoutMs)
  // 同鍵重複(不該發生):舊的那筆就不能再被中止,但仍受逾時保護
  if (abortKey !== undefined) inflight.set(abortKey, ctrl)
  const abortError = () => new Error(timedOut
    ? `request timed out after ${timeoutMs} ms: ${parsed.host}${parsed.pathname}`
    : `request aborted: ${parsed.host}${parsed.pathname}`)
  const started = Date.now()
  const method = init.method ?? 'GET'
  try {
    const result = await raceAbort((async () => {
      const res = await session.defaultSession.fetch(url, {
        method: init.method ?? 'GET',
        headers,
        body: init.body,
        credentials: 'include',
        redirect: 'follow',
        referrerPolicy: 'no-referrer-when-downgrade',
        signal: ctrl.signal
      })
      const body = await res.text()
      return {
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers.entries()],
        body
      }
    })(), ctrl.signal, abortError)
    try {
      const line = httpLogLine(method, parsed, result, Date.now() - started)
      if (line) (result.status >= 400 ? console.warn : console.log)(line)
    } catch { /* 記錄只是旁觀,不能讓成功的請求變失敗 */ }
    return result
  } catch (e) {
    // 中止 = renderer 換了物品 / 關了面板,不算問題
    if (!(e instanceof Error && e.message.startsWith('request aborted'))) {
      console.warn(`[http] ${method} ${parsed.host}${parsed.pathname} 失敗(${Date.now() - started} ms):${e instanceof Error ? e.message : String(e)}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
    if (abortKey !== undefined && inflight.get(abortKey) === ctrl) inflight.delete(abortKey)
  }
}
