import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'

export const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../fixtures')

/** `UPDATE_FIXTURES=1 npm test` 時改寫快照,而不是比對。 */
export const UPDATE_MODE = process.env.UPDATE_FIXTURES === '1'

export interface Fixture {
  name: string
  language: string
  text: string
  expectedPath: string
}

export type FixtureOutcome =
  | { kind: 'parsed', item: ParsedItem, snapshot: unknown }
  | { kind: 'error', error: string }

/**
 * **本專案維護的語系** —— 繁中是這個 fork 存在的理由,解析它的物品文字是我們的
 * 責任,所以少了樣本就是缺口,必須讓測試紅掉。
 */
export const MAINTAINED_LANGUAGES = ['cmn-Hant'] as const

/**
 * **上游維護的語系**。en 是上游 SnosMe 的來源語言,ru / ko 由上游的貢獻者維護,
 * 我們只是沿用 —— 替它們建回歸樣本不是這個 fork 的工作,少了也不算缺口。
 *
 * 這個分野與 `verify-i18n` 一致(它把 ko / ru 標成「非本專案維護,僅報告」)。
 * ⚠ 「有樣本就照樣測」是刻意的:哪天真的補了英文樣本,它就自動納入回歸網。
 */
export const UPSTREAM_LANGUAGES = ['en', 'ru', 'ko'] as const

export function hasFixtures (language: string): boolean {
  const dir = path.join(FIXTURES_DIR, language)
  return fsSync.existsSync(dir) && fsSync.readdirSync(dir).some(f => f.endsWith('.txt'))
}

/**
 * 上面兩份清單裡、磁碟上真的有樣本的語系。
 *
 * ⚠ 判準是**宣告的清單**,不是「掃 fixtures 底下所有子目錄」。掃描版寫過一次就
 *   踩到:`fixtures/filter-visibility/` 是 `map-price-mods.test.ts` 的地圖樣本集,
 *   不是語系,被當成語系之後 `loadForLang('filter-visibility')` 直接炸掉。
 *   「目錄裡有 .txt」根本不是「這是一個語系」的證據。
 *
 * ⚠ 回空陣列時呼叫端必須自己擋掉 —— 否則後面每一項斷言都會空轉通過,
 *   那比沒有測試更危險。
 */
export function fixtureLanguages (): string[] {
  return [...MAINTAINED_LANGUAGES, ...UPSTREAM_LANGUAGES].filter(hasFixtures)
}

export async function listFixtures (language: string): Promise<Fixture[]> {
  const dir = path.join(FIXTURES_DIR, language)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const out: Fixture[] = []
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.txt')) continue
    const name = entry.slice(0, -'.txt'.length)
    out.push({
      name,
      language,
      text: await fs.readFile(path.join(dir, entry), 'utf8'),
      expectedPath: path.join(dir, `${name}.expected.json`)
    })
  }
  return out
}

export function runFixture (fixture: Fixture): FixtureOutcome {
  const result = parseClipboard(fixture.text)
  if (result.isErr()) {
    return { kind: 'error', error: result.error }
  }
  const item = result.value
  return { kind: 'parsed', item, snapshot: stableSnapshot(item) }
}

/**
 * 把解析結果轉成**鍵順序固定**的純資料。
 *
 * 不排序鍵的話,快照的差異會取決於物件屬性的賦值順序 —— parser 裡挪動一行
 * 賦值就會產生整份 diff,而真正的行為改變會被埋在雜訊裡。`undefined` 一併移除,
 * 因為 JSON 沒有這個值,留著會讓「欄位不存在」與「欄位是 undefined」看起來不同。
 */
function stableSnapshot (value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSnapshot)
  }
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue
      out[key] = stableSnapshot(src[key])
    }
    return out
  }
  return value
}

export async function readExpected (fixture: Fixture): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(fixture.expectedPath, 'utf8'))
  } catch {
    return undefined
  }
}

export async function writeExpected (fixture: Fixture, snapshot: unknown): Promise<void> {
  await fs.writeFile(fixture.expectedPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
}

export interface SnapshotDiff {
  field: string
  expected: unknown
  actual: unknown
}

/** 逐欄比對,回報**路徑**而不是整份物件 —— 只印 diff 的話看不出哪個欄位變了。 */
export function diffSnapshots (expected: unknown, actual: unknown, at = ''): SnapshotDiff[] {
  if (Object.is(expected, actual)) return []

  const bothObjects = (
    expected !== null && typeof expected === 'object' &&
    actual !== null && typeof actual === 'object' &&
    Array.isArray(expected) === Array.isArray(actual)
  )
  if (!bothObjects) {
    return [{ field: at || '(根)', expected, actual }]
  }

  const keys = new Set([
    ...Object.keys(expected as object),
    ...Object.keys(actual as object)
  ])
  const out: SnapshotDiff[] = []
  for (const key of [...keys].sort()) {
    const childPath = Array.isArray(expected) ? `${at}[${key}]` : (at ? `${at}.${key}` : key)
    out.push(...diffSnapshots(
      (expected as Record<string, unknown>)[key],
      (actual as Record<string, unknown>)[key],
      childPath
    ))
  }
  return out
}

export function formatDiff (diffs: SnapshotDiff[]): string {
  const shown = diffs.slice(0, 12)
  const lines = shown.map(d =>
    `  ${d.field}\n` +
    `      期望: ${brief(d.expected)}\n` +
    `      實際: ${brief(d.actual)}`)
  if (diffs.length > shown.length) {
    lines.push(`  …另有 ${diffs.length - shown.length} 處`)
  }
  return lines.join('\n')
}

function brief (value: unknown): string {
  if (value === undefined) return '(不存在)'
  const text = JSON.stringify(value)
  return (text !== undefined && text.length > 120) ? text.slice(0, 120) + '…' : String(text)
}
