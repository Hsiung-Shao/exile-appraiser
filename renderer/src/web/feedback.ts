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
/** 預填網址超過這個長度(字元)就改走剪貼簿:瀏覽器 / GitHub 對過長網址會截斷或 414。 */
export const MAX_ISSUE_URL_LENGTH = 6000
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
  const scope = `[${input.game}/${input.realm}]`
  const itemLabel = item && (item.name ?? item.refName)
    ? (item.name && item.refName && item.name !== item.refName ? `${item.name}(${item.refName})` : (item.name ?? item.refName)!)
    : undefined
  const what = input.error ? oneLine(input.error, 120) : 'price check issue'
  const title = oneLine(itemLabel ? `${scope} ${itemLabel} — ${what}` : `${scope} ${input.error ? what : 'feedback'}`, 200)

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

  if (item) {
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

  if (input.clipboard) {
    lines.push('', '### Clipboard', fence(input.clipboard))
  }

  if (input.request !== undefined) {
    lines.push('', '### Trade query')
    if (input.requestNote) lines.push(`_${input.requestNote}_`, '')
    lines.push(fence(JSON.stringify(sanitize(input.request), null, 2), 'json'))
  }

  return { title, body: lines.join('\n') + '\n' }
}

export function issueUrl (title: string, body?: string): string {
  const q = `title=${encodeURIComponent(title)}` + (body != null ? `&body=${encodeURIComponent(body)}` : '')
  return `${ISSUE_NEW_URL}?${q}`
}

/**
 * 開預填好的 issue 頁面。網址 ≤ 6000 字元 → 整份報告放在網址;否則網址只帶標題 + 「已複製到剪貼簿」提示,
 * 全文寫進剪貼簿。回傳採用的路徑(UI 依它顯示提示)。
 */
export async function openIssue (report: Report, deps: ReportDeps): Promise<OpenIssueResult> {
  const full = issueUrl(report.title, report.body)
  if (full.length <= MAX_ISSUE_URL_LENGTH) {
    await deps.openExternal(full)
    return { path: 'url', url: full }
  }
  await deps.writeClipboard(report.body)
  const short = issueUrl(report.title, CLIPBOARD_HINT)
  await deps.openExternal(short)
  return { path: 'clipboard', url: short }
}

/** 「複製報告」:標題 + 內文一起複製。 */
export async function copyReport (report: Report, deps: Pick<ReportDeps, 'writeClipboard'>): Promise<void> {
  await deps.writeClipboard(`# ${report.title}\n\n${report.body}`)
}
