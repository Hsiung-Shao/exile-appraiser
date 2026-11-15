/**
 * 一鍵回報:把「版本 / 環境 / 剪貼簿原文 / 解析摘要 / 查詢 JSON / 錯誤」組成 GitHub issue 的標題與 Markdown 內文,
 * 再用預填網址開 `issues/new`(不自動上傳任何東西;使用者在 GitHub 頁面上自己按送出)。
 *
 * 純函式、不碰 DOM / Vue / window:外部動作(開網址、寫剪貼簿)由呼叫端注入(`ReportDeps`),
 * 讓 `renderer/test/feedback.test.ts` 能在 node 環境直接跑。
 *
 * 隱私:
 * - 物品只取白名單欄位(名稱 / refName / namespace / category / rarity / unknownModifiers 的文字),不序列化整個物件;
 * - 查詢 JSON 遞迴移除帳號 / token / cookie 類的鍵(`accountName`、`account`、`poesessid`、`token`…);
 * - 呼叫端不傳 accountName;就算傳進來的物件夾帶它也不會出現在內文。
 */

export const ISSUE_NEW_URL = 'https://github.com/Hsiung-Shao/exile-appraiser/issues/new'
/**
 * 預填網址的長度上限,量的是**沒登入 GitHub 時被導去的登入網址**(`login?return_to=<整個網址再編碼一次>`):
 * 那個網址超過約 7000 字元 GitHub 回 500(「Whoops, something went wrong」;2026-11-15 實測 6793 可、7103 不可)。
 * 中文每個字在預填網址佔 9 個字元、再編碼後 15 個,所以不能只看預填網址本身的長度。
 */
export const MAX_ISSUE_URL_LENGTH = 6500
const LOGIN_PREFIX = 'https://github.com/login?return_to='
/** 沒登入時實際會打開的網址長度 */
export function issueUrlCost (url: string): number {
  return LOGIN_PREFIX.length + encodeURIComponent(url).length
}
/** 走剪貼簿時,網址內文只放這段提示(雙語,不依賴介面語言)。 */
export const CLIPBOARD_HINT = '內容已複製到剪貼簿,請貼上。\nThe full report was copied to your clipboard — please paste it here.'

export interface ReportItemSummary {
  name?: string
  refName?: string
  namespace?: string
  category?: string
  rarity?: string
  unknownModifiers: string[]
}

export interface ReportInput {
  game: 'poe1' | 'poe2'
  realm: 'intl' | 'tw'
  /** 客戶端語言(資料集)。 */
  language: string
  /** 介面語言。 */
  uiLanguage: string
  version: string
  /** 剪貼簿原文(物品文字);關於頁「回報問題」沒有物品時可省略。 */
  clipboard?: string
  /** ParsedItem(poe1 / poe2 皆可);只讀白名單欄位。 */
  item?: unknown
  /** 送出(或重算)的交易站查詢。 */
  request?: unknown
  /** 查詢的來源說明(例如「以預設篩選重算」);有 request 才顯示。 */
  requestNote?: string
  error?: string
  /** `navigator.userAgent`(會精簡成 OS / Electron / Chrome)。 */
  platform?: string
}

export interface Report {
  title: string
  body: string
  /** 網址放不下整份時依序改用的精簡版內文(先拿掉查詢 JSON,再拿掉解析摘要,再把物品原文從尾端一段段截短;錯誤與版本留著) */
  shorter?: string[]
  /** 不含剪貼簿原文與查詢的摘要:連精簡版都放不下、改走剪貼簿時,網址至少帶上它(使用者常常沒貼上) */
  summary?: string
}

export type OpenIssuePath = 'url' | 'clipboard'

export interface OpenIssueResult {
  path: OpenIssuePath
  url: string
}

export interface ReportDeps {
  openExternal: (url: string) => void | Promise<void>
  writeClipboard: (text: string) => void | Promise<void>
}

const SENSITIVE_KEY = /^(account(name)?|poesessid|sessid|session(id)?|token|access_?token|refresh_?token|cookie|authorization|password)$/i

function str (v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** 從 ParsedItem 取白名單欄位(不信任輸入形狀)。 */
export function summarizeItem (item: unknown): ReportItemSummary | undefined {
  if (item == null || typeof item !== 'object') return undefined
  const it = item as Record<string, unknown>
  const info = (it.info != null && typeof it.info === 'object') ? it.info as Record<string, unknown> : {}
  const unknown = Array.isArray(it.unknownModifiers) ? it.unknownModifiers : []
  return {
    name: str(info.name),
    refName: str(info.refName),
    namespace: str(info.namespace),
    category: str(it.category),
    rarity: str(it.rarity),
    unknownModifiers: unknown
      .map(m => (typeof m === 'string' ? m : str((m as Record<string, unknown> | null)?.text)))
      .filter((m): m is string => m != null)
  }
}

/** 遞迴複製並移除敏感鍵(帳號、token、cookie…)。 */
export function sanitize (value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value != null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) continue
      out[k] = sanitize(v)
    }
    return out
  }
  return value
}

/** `Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/130.0.0.0 Electron/33.2.0 …` → `Windows NT 10.0; Win64; x64 · Electron 33.2.0 · Chrome 130.0.0.0`。 */
export function summarizeUserAgent (ua: string | undefined): string {
  if (!ua) return 'unknown'
  const os = /\(([^)]*)\)/.exec(ua)?.[1]
  const electron = /Electron\/([\d.]+)/.exec(ua)?.[1]
  const chrome = /Chrome\/([\d.]+)/.exec(ua)?.[1]
  const parts = [os, electron ? `Electron ${electron}` : undefined, chrome ? `Chrome ${chrome}` : undefined].filter(Boolean)
  return parts.length ? parts.join(' · ') : ua.slice(0, 120)
}

/** 程式碼區塊:內容裡有 ``` 時用更長的圍欄。 */
function fence (text: string, lang = ''): string {
  let bar = '```'
  while (text.includes(bar)) bar += '`'
  return `${bar}${lang}\n${text.replace(/\n+$/, '')}\n${bar}`
}

function oneLine (s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function buildReport (input: ReportInput): Report {
  const item = summarizeItem(input.item)
  // 版號放進標題:就算內文沒帶到(走剪貼簿而使用者沒貼),也知道是哪一版回報的
  const scope = `[${input.game}/${input.realm} ${input.version}]`
  const itemLabel = item && (item.name ?? item.refName)
    ? (item.name && item.refName && item.name !== item.refName ? `${item.name}(${item.refName})` : (item.name ?? item.refName)!)
    : undefined
  const what = input.error ? oneLine(input.error, 120) : 'price check issue'
  const title = oneLine(itemLabel ? `${scope} ${itemLabel} — ${what}` : `${scope} ${input.error ? what : 'feedback'}`, 200)

  // level:0 完整、1 去查詢 JSON、2 再去解析摘要、3 只留環境 / 錯誤 / 解析摘要(走剪貼簿時放進網址)
  const body = (level: 0 | 1 | 2 | 3, clip = input.clipboard): string => {
  const lines: string[] = []
  lines.push('<!-- 請在上方簡述發生了什麼、你預期的結果。 / Describe what happened and what you expected above. -->', '')
  lines.push('### Environment')
  lines.push(`- Version: ${input.version}`)
  lines.push(`- Game: ${input.game}`)
  lines.push(`- Realm: ${input.realm}`)
  lines.push(`- Client language: ${input.language}`)
  lines.push(`- UI language: ${input.uiLanguage}`)
  lines.push(`- OS: ${summarizeUserAgent(input.platform)}`)

  if (input.error) {
    lines.push('', '### Error', fence(input.error))
  }

  if (item && level !== 2) {
    lines.push('', '### Parsed item')
    lines.push(`- Name: ${item.name ?? '-'}`)
    lines.push(`- refName: ${item.refName ?? '-'}`)
    lines.push(`- namespace: ${item.namespace ?? '-'}`)
    lines.push(`- category: ${item.category ?? '-'}`)
    lines.push(`- rarity: ${item.rarity ?? '-'}`)
    if (item.unknownModifiers.length) {
      lines.push(`- unknownModifiers (${item.unknownModifiers.length}):`)
      for (const m of item.unknownModifiers) lines.push(`  - \`${m.replace(/`/g, "'")}\``)
    } else {
      lines.push('- unknownModifiers: none')
    }
  }

  if (clip && level < 3) {
    lines.push('', clip === input.clipboard ? '### Clipboard' : '### Clipboard (截短 / truncated)', fence(clip))
  }

  if (input.request !== undefined && level < 1) {
    lines.push('', '### Trade query')
    if (input.requestNote) lines.push(`_${input.requestNote}_`, '')
    lines.push(fence(JSON.stringify(sanitize(input.request), null, 2), 'json'))
  }

    return lines.join('\n') + '\n'
  }

  const full = body(0)
  // 物品原文還是放不下:從尾端一段一段拿掉(說明文字、備註、背景故事在後面;名稱與詞綴區在前面)
  const sections = (input.clipboard ?? '').split(/\r?\n-{8}\r?\n/)
  const trimmed = sections.slice(1).map((_, i) => body(2, sections.slice(0, sections.length - 1 - i).join('\n--------\n')))
  return { title, body: full, shorter: [body(1), body(2), ...trimmed].filter((b, i, a) => b !== full && a.indexOf(b) === i), summary: body(3) }
}

export function issueUrl (title: string, body?: string): string {
  const q = `title=${encodeURIComponent(title)}` + (body != null ? `&body=${encodeURIComponent(body)}` : '')
  return `${ISSUE_NEW_URL}?${q}`
}

/**
 * 開預填好的 issue 頁面。放得下 → 整份報告放在網址;放不下先試精簡版(`shorter`);還是不行才網址只帶標題 + 「已複製到剪貼簿」提示,
 * 全文寫進剪貼簿。回傳採用的路徑(UI 依它顯示提示)。
 */
export async function openIssue (report: Report, deps: ReportDeps): Promise<OpenIssueResult> {
  for (const body of [report.body, ...(report.shorter ?? [])]) {
    const url = issueUrl(report.title, body)
    if (issueUrlCost(url) <= MAX_ISSUE_URL_LENGTH) {
      await deps.openExternal(url)
      return { path: 'url', url }
    }
  }
  await deps.writeClipboard(report.body)
  const withSummary = issueUrl(report.title, `${CLIPBOARD_HINT}\n\n${report.summary ?? ''}`)
  const short = report.summary && issueUrlCost(withSummary) <= MAX_ISSUE_URL_LENGTH ? withSummary : issueUrl(report.title, CLIPBOARD_HINT)
  await deps.openExternal(short)
  return { path: 'clipboard', url: short }
}

/** 「複製報告」:標題 + 內文一起複製。 */
export async function copyReport (report: Report, deps: Pick<ReportDeps, 'writeClipboard'>): Promise<void> {
  await deps.writeClipboard(`# ${report.title}\n\n${report.body}`)
}
