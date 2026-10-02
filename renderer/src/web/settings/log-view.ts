/**
 * 設定 › 記錄(第 28 步)的純函式:篩選、關鍵字搜尋、快照 / 即時追加的合併、複製用格式、自動捲動判定。
 * 不依賴 Vue / DOM / Electron(`renderer/test/log-view.test.ts`)。
 */
import type { LogEntry } from '@ipc/types'

export type LogFilterId = 'all' | 'error' | 'ocr' | 'trade' | 'hotkey'
export const LOG_FILTERS: readonly LogFilterId[] = ['all', 'error', 'ocr', 'trade', 'hotkey']

/** renderer 端保留的行數上限(與 main 環形緩衝同) */
export const LOG_VIEW_CAP = 3000

/** 錯誤行:error 等級、`[renderer-error]`、或內容含 failed / 失敗 / Error(不分大小寫的 failed / error) */
const ERROR_TEXT_RE = /failed|失敗|error/i
export function isErrorLine (e: Pick<LogEntry, 'level' | 'text'>): boolean {
  return e.level === 'error' || e.text.includes('[renderer-error]') || ERROR_TEXT_RE.test(e.text)
}

/**
 * 以行內容的 tag 判定分類(任一前綴命中即算):
 * - OCR:`[ocr`(含 `[ocr-region]`)、`[reveal-scan]`、`[runeshape]`、`[capture]`、`[scan-mask]`、`[desecration]`
 * - 查價:`[app] 解析`、`[trade`(含 `[trade-site]`)、`[ninja]`、`[http]`、`[poe1]`、`[poe2]`
 * - 熱鍵:`[shortcuts]`、`[uiohook`
 * 子字串比對,所以 renderer 轉印行(`[renderer] [app] 解析…`)也算。
 */
const OCR_TAGS = ['[ocr', '[reveal-scan]', '[runeshape]', '[capture]', '[scan-mask]', '[desecration]']
const TRADE_TAGS = ['[app] 解析', '[trade', '[ninja]', '[http]', '[poe1]', '[poe2]']
const HOTKEY_TAGS = ['[shortcuts]', '[uiohook']

const hasAny = (text: string, tags: readonly string[]) => tags.some(t => text.includes(t))

export function matchesFilter (e: Pick<LogEntry, 'level' | 'text'>, filter: LogFilterId): boolean {
  switch (filter) {
    case 'all': return true
    case 'error': return isErrorLine(e)
    case 'ocr': return hasAny(e.text, OCR_TAGS)
    case 'trade': return hasAny(e.text, TRADE_TAGS)
    case 'hotkey': return hasAny(e.text, HOTKEY_TAGS)
  }
}

/** 篩選 + 關鍵字(不分大小寫、子字串;空白 = 不搜尋)。回傳新陣列(保持舊 → 新) */
export function filterLogEntries (entries: readonly LogEntry[], filter: LogFilterId, keyword: string): LogEntry[] {
  const kw = keyword.trim().toLowerCase()
  if (filter === 'all' && !kw) return entries.slice()
  return entries.filter(e => matchesFilter(e, filter) && (!kw || e.text.toLowerCase().includes(kw)))
}

/**
 * 合併(快照 / 即時追加 / 輪詢)進目前清單:以 `seq` 去重、依 seq 排序、只留最新 `cap` 筆。
 * 快路徑:新資料全部比目前最後一筆新(最常見的即時追加)→ 直接接在後面。
 */
export function mergeLogEntries (current: readonly LogEntry[], incoming: readonly LogEntry[], cap = LOG_VIEW_CAP): LogEntry[] {
  if (!incoming.length) return current as LogEntry[]
  const lastSeq = current.length ? current[current.length - 1].seq : 0
  let out: LogEntry[]
  if (incoming[0].seq > lastSeq && isAscending(incoming)) {
    out = current.concat(incoming)
  } else {
    const seen = new Set<number>()
    out = []
    for (const e of [...current, ...incoming]) {
      if (seen.has(e.seq)) continue
      seen.add(e.seq)
      out.push(e)
    }
    out.sort((a, b) => a.seq - b.seq)
  }
  return out.length > cap ? out.slice(out.length - cap) : out
}

function isAscending (a: readonly LogEntry[]): boolean {
  for (let i = 1; i < a.length; i++) if (a[i].seq <= a[i - 1].seq) return false
  return true
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 列上顯示用 `HH:MM:SS.mmm`(本機時區) */
export function logTime (ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** 複製 / 檔案用的完整格式:與 main `formatLogEntry`(app-log.ts)逐字相同(`renderer/test/log-view.test.ts` 對照) */
export function formatLogLine (e: Pick<LogEntry, 'ts' | 'level' | 'text'>): string {
  const d = new Date(e.ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${logTime(e.ts)} [${e.level.toUpperCase()}] ${e.text.replace(/\r?\n/g, '\n    ')}`
}

/** 「複製目前篩選結果」的文字 */
export function formatLogText (entries: readonly LogEntry[]): string {
  return entries.map(formatLogLine).join('\n')
}

/** 列上單行顯示:多行訊息(堆疊)以 ↵ 串成一行,完整內容在 tooltip / 複製裡 */
export function oneLine (text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ↵ ')
}

/** 捲動位置是否算「在底部」(`slack` px 內);使用者往上捲 → false → 暫停自動捲動 */
export function isAtBottom (scrollTop: number, viewH: number, totalH: number, slack = 24): boolean {
  return scrollTop + viewH >= totalH - slack
}
