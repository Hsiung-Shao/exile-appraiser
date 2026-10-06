/**
 * 一鍵從 PobTools 送正則分享碼(2026-10-07;介面規格見 docs/regex-share-cli.md)。
 *
 * PobTools 以 `<ExileAppraiser.exe> --regex-share <分享碼>`(或 `--regex-share-file <檔案路徑>`,碼太長時用)啟動本程式:
 * - 沒有在執行:這個行程拿到單一實例鎖,whenReady 後解析 `process.argv` → 放進 `RegexShareInbox`,
 *   等 renderer 掛好監聽、呼叫 `regex-share-take` 時交出去(renderer 就緒前不送)。
 * - 已在執行:這個行程拿不到鎖就結束,主行程 `second-instance` 收到同一組參數 → 解析後送 `regex-share` 事件。
 * renderer 開設定 › 正則,顯示確認對話框(來源 / 遊戲 / 會覆蓋哪些清單 / 找不到幾項),使用者按「套用」才套用。
 * overlay 模式而遊戲沒開(overlay 不會出現)→ 改用預設瀏覽器開設定 › 正則(瀏覽器預覽),在那裡確認(`regexShareTarget`)。
 *
 * 這裡只做**格式檢查**(只接受 base64url 字元集、長度 ≤ `REGEX_SHARE_MAX_CODE_CHARS`),不解碼;
 * 不合格 → 回 `error`(記 log、renderer 顯示錯誤),**不做任何其他動作**(不改設定、不寫檔、不刪檔、不執行任何東西)。
 *
 * Chromium 在 Windows 轉交 `second-instance` 的 argv 時會把開關(`--x`)排到一般參數前面、開關名轉小寫,
 * 所以 `--regex-share <碼>` 的碼不一定緊接在開關後面:緊接的不是開關就用它,否則取最後一個一般參數。
 * `--regex-share=<碼>` 形式不受影響(開關值原樣保留),建議 PobTools 用這個形式。
 */
import path from 'node:path'
import type { RegexShareErrorReason, RegexShareRequest } from '@ipc/types'

export type { RegexShareRequest }

/** = regex/src/share.ts `SHARE_MAX_CODE_CHARS`(= PobTools `kMaxCodeChars`);main 不依賴 regex 套件,守門測試比對兩邊數字 */
export const REGEX_SHARE_MAX_CODE_CHARS = 4 * 1024 * 1024
/** `--regex-share-file` 的檔案大小上限(位元組):碼的上限 + BOM / 換行 / 前後空白的餘裕 */
export const REGEX_SHARE_MAX_FILE_BYTES = REGEX_SHARE_MAX_CODE_CHARS + 4096
export const REGEX_SHARE_FLAG = '--regex-share'
export const REGEX_SHARE_FILE_FLAG = '--regex-share-file'

const CODE_CHARSET = /^[A-Za-z0-9_-]+$/

/** 命令列上找到的分享碼參數(還沒讀檔、還沒檢查) */
export type RegexShareArg =
  | { via: 'arg' | 'file', value: string }
  | { via: 'arg' | 'file', error: RegexShareErrorReason, detail: string }

const isSwitch = (a: string) => a.startsWith('-')

/** 找某個開關:`--flag=值` 或 `--flag 值`;沒有這個開關 = undefined;有開關但找不到值 = null */
function switchValue (argv: readonly string[], flag: string): string | null | undefined {
  const lower = flag.toLowerCase()
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    const al = a.toLowerCase()
    if (al.startsWith(`${lower}=`)) return a.slice(flag.length + 1)
    if (al !== lower) continue
    const next = argv[i + 1]
    if (next != null && !isSwitch(next)) return next
    // Chromium 重排:開關在前、一般參數在後 → 取最後一個一般參數(argv[0] 是 exe 本身,不算)
    for (let j = argv.length - 1; j > i; j--) if (!isSwitch(argv[j])) return argv[j]
    return null
  }
  return undefined
}

/**
 * 從 argv(`process.argv` 或 `second-instance` 的 argv)找分享碼參數;沒有 = null。
 * 兩種都給 = 錯誤(不猜要用哪一個)。開發模式 argv 裡的 app 路徑(`.`、`main/dist/main.js`)若被誤取,會在格式檢查被擋下。
 */
export function findRegexShareArg (argv: readonly string[]): RegexShareArg | null {
  const code = switchValue(argv, REGEX_SHARE_FLAG)
  const file = switchValue(argv, REGEX_SHARE_FILE_FLAG)
  if (code !== undefined && file !== undefined) return { via: 'arg', error: 'both-flags', detail: `${REGEX_SHARE_FLAG} 與 ${REGEX_SHARE_FILE_FLAG} 只能給一個` }
  if (code !== undefined) return code == null ? { via: 'arg', error: 'missing-value', detail: REGEX_SHARE_FLAG } : { via: 'arg', value: code }
  if (file !== undefined) return file == null ? { via: 'file', error: 'missing-value', detail: REGEX_SHARE_FILE_FLAG } : { via: 'file', value: file }
  return null
}

/** argv 裡有沒有分享碼參數(只看開關名;值對不對交給 `findRegexShareArg`) */
export function hasRegexShareArg (argv: readonly string[]): boolean {
  return argv.some((a, i) => {
    if (i === 0) return false
    const al = a.toLowerCase()
    return al === REGEX_SHARE_FLAG || al === REGEX_SHARE_FILE_FLAG || al.startsWith(`${REGEX_SHARE_FLAG}=`) || al.startsWith(`${REGEX_SHARE_FILE_FLAG}=`)
  })
}

/**
 * 自我重新啟動(`relaunchSelf`)時拿掉分享碼參數,否則重新啟動後會再跳一次確認對話框。
 * `--flag 值` 形式的值只在緊接著時拿掉(重排後的一般參數分不出是誰的,留著也無害:沒有開關就不會被當成分享碼)。
 */
export function stripRegexShareArgs (args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const al = args[i].toLowerCase()
    if (al.startsWith(`${REGEX_SHARE_FLAG}=`) || al.startsWith(`${REGEX_SHARE_FILE_FLAG}=`)) continue
    if (al === REGEX_SHARE_FLAG || al === REGEX_SHARE_FILE_FLAG) {
      if (args[i + 1] != null && !isSwitch(args[i + 1])) i++
      continue
    }
    out.push(args[i])
  }
  return out
}

/** 分享碼格式檢查(前後空白 / 換行先去掉;不解碼) */
export function validateShareCode (raw: string): { ok: true, code: string } | { ok: false, reason: RegexShareErrorReason, detail: string } {
  const code = raw.replace(/^﻿/, '').trim()
  if (!code) return { ok: false, reason: 'empty', detail: '分享碼是空的' }
  if (code.length > REGEX_SHARE_MAX_CODE_CHARS) return { ok: false, reason: 'too-long', detail: `${code.length} 字元(上限 ${REGEX_SHARE_MAX_CODE_CHARS})` }
  if (!CODE_CHARSET.test(code)) {
    const bad = [...code].find(ch => !CODE_CHARSET.test(ch)) ?? '?'
    return { ok: false, reason: 'charset', detail: `含有 base64url 以外的字元(U+${bad.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})` }
  }
  return { ok: true, code }
}

/** 讀檔用的最小介面(測試注入假的) */
export interface RegexShareFs {
  stat: (p: string) => Promise<{ size: number, isFile: () => boolean }>
  readFile: (p: string) => Promise<string>
}

/**
 * 參數 → 要交給 renderer 的請求(不含 id)。`cwd` = 帶參數的那個行程的工作目錄(相對路徑以它為準;
 * `second-instance` 給的 `workingDirectory`)。檔案只讀、不刪、不改。
 */
export async function resolveRegexShareArg (
  arg: RegexShareArg, cwd: string, fs: RegexShareFs
): Promise<Omit<RegexShareRequest, 'id'>> {
  const base = { source: 'pobtools' as const, via: arg.via }
  if ('error' in arg) return { ...base, error: { reason: arg.error, detail: arg.detail } }
  if (arg.via === 'arg') {
    const v = validateShareCode(arg.value)
    return v.ok ? { ...base, code: v.code } : { ...base, error: { reason: v.reason, detail: v.detail } }
  }
  const file = path.resolve(cwd, arg.value)
  let text: string
  try {
    const st = await fs.stat(file)
    if (!st.isFile()) return { ...base, error: { reason: 'file-read', detail: `${file} 不是檔案` } }
    if (st.size > REGEX_SHARE_MAX_FILE_BYTES) return { ...base, error: { reason: 'file-too-large', detail: `${file}(${st.size} 位元組,上限 ${REGEX_SHARE_MAX_FILE_BYTES})` } }
    text = await fs.readFile(file)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    return { ...base, error: { reason: 'file-read', detail: `${file}(${code ?? (e instanceof Error ? e.message : String(e))})` } }
  }
  const v = validateShareCode(text)
  return v.ok ? { ...base, code: v.code } : { ...base, error: { reason: v.reason, detail: v.detail } }
}

/** log 用的一行摘要(不印分享碼內容,只印長度) */
export function describeRegexShareRequest (req: RegexShareRequest): string {
  if (req.error) return `#${req.id} ${req.via} 不合格:${req.error.reason}(${req.error.detail})`
  return `#${req.id} ${req.via} ${req.code?.length ?? 0} 字元`
}

/**
 * 確認對話框要顯示在哪裡(使用者裁定,2026-10-07):
 * - `app`:Electron 視窗 —— 視窗模式,或 overlay 模式且遊戲視窗在(overlay 看得到);
 * - `preview`:overlay 模式但遊戲視窗不在(overlay 不會出現)→ 用預設瀏覽器開設定 › 正則(瀏覽器預覽),在那裡確認。
 */
export type RegexShareTarget = 'app' | 'preview'

export function regexShareTarget (mode: 'overlay' | 'window', gameAttached: boolean): RegexShareTarget {
  return mode === 'overlay' && !gameAttached ? 'preview' : 'app'
}

/**
 * 首次啟動就帶參數時,overlay 還沒綁定 / 遊戲 attach 事件還沒來 → `gameAttached` 一定是 false,直接判斷會誤開瀏覽器。
 * 延後到「啟動穩定」再決定目標:遊戲 attach,或開始追蹤遊戲視窗(第一次 host-config)後 `graceMs` 仍沒 attach(= 遊戲沒開);
 * 保險:建立後 `maxWaitMs` 一定放行。視窗模式 / 沒有 overlay 一開始就是穩定的。
 */
export class RegexShareStartupGate {
  private settled: boolean
  private waiters: Array<() => void> = []
  private graceTimer: unknown = null
  private maxTimer: unknown = null

  constructor (private readonly opts: {
    settled: boolean
    graceMs?: number
    maxWaitMs?: number
    setTimeout: (fn: () => void, ms: number) => unknown
    clearTimeout: (t: unknown) => void
    log: (msg: string) => void
  }) {
    this.settled = opts.settled
    if (!this.settled) this.maxTimer = opts.setTimeout(() => { this.settle('逾時') }, opts.maxWaitMs ?? 15000)
  }

  get isSettled (): boolean { return this.settled }

  /** 穩定後執行(已穩定 = 立刻) */
  whenSettled (fn: () => void): void {
    if (this.settled) fn()
    else this.waiters.push(fn)
  }

  /** 開始追蹤遊戲視窗(第一次 host-config 的 attachByTitle)→ `graceMs` 後還沒 attach 就當遊戲沒開 */
  trackingStarted (): void {
    if (this.settled || this.graceTimer != null) return
    this.graceTimer = this.opts.setTimeout(() => { this.settle('遊戲沒有 attach') }, this.opts.graceMs ?? 2500)
  }

  settle (reason: string): void {
    if (this.settled) return
    this.settled = true
    if (this.graceTimer != null) this.opts.clearTimeout(this.graceTimer)
    if (this.maxTimer != null) this.opts.clearTimeout(this.maxTimer)
    const ws = this.waiters
    this.waiters = []
    if (ws.length) this.opts.log(`[regex-share] 啟動穩定(${reason}),處理 ${ws.length} 筆`)
    for (const w of ws) w()
  }
}

/**
 * 交給 renderer 的信箱(依顯示目標):只留最新一筆。
 * - `app`:Electron renderer 呼叫 `take('app')`(= 已掛好 `regex-share` 監聽)之前收到的先留著,之後收到的直接送事件。
 *   renderer 重新載入(`did-start-loading`)→ `reset()`,回到「先留著」。
 * - `preview`:只等預覽分頁啟動時 `take('preview')` 拿走(不送事件;已開著的舊分頁不會搶)。
 */
export class RegexShareInbox {
  private pending: { req: RegexShareRequest, target: RegexShareTarget } | null = null
  private ready = false
  private seq = 0

  constructor (private readonly opts: { deliver: (req: RegexShareRequest) => void, log: (msg: string) => void }) {}

  push (req: Omit<RegexShareRequest, 'id'>, target: RegexShareTarget = 'app'): RegexShareRequest {
    const full: RegexShareRequest = { id: ++this.seq, ...req }
    if (this.pending) this.opts.log(`[regex-share] #${this.pending.req.id} 還沒送出就被 #${full.id} 取代`)
    this.pending = null
    if (target === 'app' && this.ready) {
      this.opts.log(`[regex-share] 送出 ${describeRegexShareRequest(full)}`)
      this.opts.deliver(full)
    } else {
      this.opts.log(`[regex-share] 等待${target === 'app' ? ' renderer 就緒' : '瀏覽器設定頁'},先留著 ${describeRegexShareRequest(full)}`)
      this.pending = { req: full, target }
    }
    return full
  }

  /** 拿走留著的那一筆(目標不同 = null);`app` 同時表示 Electron renderer 已就緒 */
  take (target: RegexShareTarget = 'app'): RegexShareRequest | null {
    if (target === 'app') this.ready = true
    const p = this.pending
    if (!p || p.target !== target) return null
    this.pending = null
    this.opts.log(`[regex-share] ${target === 'app' ? 'renderer' : '瀏覽器設定頁'}取走 #${p.req.id}`)
    return p.req
  }

  reset (): void { this.ready = false }
}
