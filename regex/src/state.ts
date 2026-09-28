// Poe Regex 的記憶狀態與書籤:移植自 PobTools `host/regex_state.{h,cpp}`。
//
// 鍵用英文那一行(語言中性、跨賽季不變;列號每季會變),中文當後援;還原不到的**計數回報,不靜默丟掉**。
// 這裡只做模型 + JSON 字串的序列化 / 反序列化;檔案 IO(temp + rename 原子寫入)由呼叫端做(main 或 CLI)。

import type { Mode } from './gen'
import type { RegexEntry, RegexGame, RegexLang, RegexPage } from './data'

/** regex_state.h `RegexBookmark` */
export interface RegexBookmark {
  name: string
  /** 頁面 id,例如 map_mods */
  page: string
  /** 'poe1' | 'poe2';舊檔沒有時留空(不猜),由 UI 依 page id 補 */
  game: RegexGame | ''
  mode: Mode
  /** 存書籤時的輸出語言;同一組勾選換語言是另一組 token */
  lang: RegexLang
  /** 英文行 */
  keys: string[]
  /** 中文行,與 keys 同順序;後援 */
  alt: string[]
}

/** regex_state.h `RegexPagePicks` */
export interface RegexPagePicks {
  page: string
  keys: string[]
  alt: string[]
}

/** regex_state.h `RegexUiState` */
export interface RegexUiState {
  game: RegexGame | ''
  page: string
  mode: Mode
  lang: RegexLang
  bilingual: boolean
  current: RegexPagePicks[]
  bookmarks: RegexBookmark[]
}

export function defaultRegexState (): RegexUiState {
  return { game: '', page: '', mode: 'any', lang: 'zh', bilingual: true, current: [], bookmarks: [] }
}

/** regex_state.cpp:60 `RegexUiState::PicksFor`:該頁的勾選,沒有就建立 */
export function picksFor (s: RegexUiState, pageId: string): RegexPagePicks {
  let p = s.current.find(x => x.page === pageId)
  if (!p) {
    p = { page: pageId, keys: [], alt: [] }
    s.current.push(p)
  }
  return p
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function str (j: Json, key: string, def: string): string {
  const v = j[key]
  if (v === undefined) return def
  if (typeof v !== 'string') throw new Error(`欄位 ${key} 不是字串`)
  return v
}

function stringArray (j: Json, key: string): string[] {
  const v = j[key]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** regex_state.cpp:53 `OneOf`:讀回的值只准是本版認得的,否則用第一個 */
function oneOf<T extends string> (v: string, ...allowed: T[]): T {
  return (allowed as string[]).includes(v) ? v as T : allowed[0]
}

function gameOf (v: string): RegexGame | '' {
  return v === 'poe1' || v === 'poe2' ? v : ''
}

export interface ParsedRegexState {
  /** false = 空字串 / 壞 JSON / 型別不符;state 為預設值(書籤與勾選不留半讀的殘骸) */
  ok: boolean
  state: RegexUiState
}

/** regex_state.cpp:68 `RegexUiState::Load`(不含讀檔)。檔案不存在請直接用 defaultRegexState() */
export function parseRegexState (text: string): ParsedRegexState {
  const s = defaultRegexState()
  try {
    const doc: unknown = JSON.parse(text)
    if (!isObj(doc)) throw new Error('not an object')
    s.game = gameOf(str(doc, 'game', ''))
    s.page = str(doc, 'page', '')
    s.mode = oneOf(str(doc, 'mode', 'any'), 'any', 'all', 'none')
    s.lang = oneOf(str(doc, 'lang', 'zh'), 'zh', 'en')
    if (doc.bilingual !== undefined) {
      if (typeof doc.bilingual !== 'boolean') throw new Error('bilingual 不是布林')
      s.bilingual = doc.bilingual
    }
    if (Array.isArray(doc.current)) {
      for (const p of doc.current) {
        if (!isObj(p)) continue
        const page = str(p, 'page', '')
        if (!page) continue
        s.current.push({ page, keys: stringArray(p, 'keys'), alt: stringArray(p, 'alt') })
      }
    }
    if (Array.isArray(doc.bookmarks)) {
      for (const b of doc.bookmarks) {
        if (!isObj(b)) continue
        const rec: RegexBookmark = {
          name: str(b, 'name', ''),
          page: str(b, 'page', ''),
          game: gameOf(str(b, 'game', '')),
          mode: oneOf(str(b, 'mode', 'any'), 'any', 'all', 'none'),
          lang: oneOf(str(b, 'lang', 'zh'), 'zh', 'en'),
          keys: stringArray(b, 'keys'),
          alt: stringArray(b, 'alt')
        }
        // 沒名字 / 沒頁 / 沒鍵的書籤 UI 無法提供,留著只會多一列永遠空白的東西
        if (!rec.name || !rec.page || rec.keys.length === 0) continue
        s.bookmarks.push(rec)
      }
    }
    return { ok: true, state: s }
  } catch {
    return { ok: false, state: defaultRegexState() }
  }
}

/** regex_state.cpp:137 `RegexUiState::Save` 的內容部分(`dump(1, '\t')`);寫檔請 temp + rename */
export function serializeRegexState (s: RegexUiState): string {
  const doc = {
    schema: 1,
    game: s.game,
    page: s.page,
    mode: s.mode,
    lang: s.lang,
    bilingual: s.bilingual,
    current: s.current.filter(p => p.keys.length > 0).map(p => ({ page: p.page, keys: p.keys, alt: p.alt })),
    bookmarks: s.bookmarks.map(b => ({ name: b.name, page: b.page, game: b.game, mode: b.mode, lang: b.lang, keys: b.keys, alt: b.alt }))
  }
  return JSON.stringify(doc, null, '\t')
}

/**
 * regex_state.cpp:190 `RegexResolveKeys`:把存下的鍵還原成勾選。英文先、找不到才中文;
 * 回傳 `missed` = 兩邊都找不到的鍵數(書籤少了三條看起來跟存錯一樣,只能靠計數分辨)。
 */
export function resolveKeys (
  keys: readonly string[],
  alt: readonly string[],
  entryKeys: readonly string[],
  entryAlt: readonly string[]
): { picked: boolean[], missed: number } {
  const picked = new Array<boolean>(entryKeys.length).fill(false)
  let missed = 0
  for (let k = 0; k < keys.length; k++) {
    let hit = -1
    if (keys[k]) hit = entryKeys.indexOf(keys[k])
    if (hit < 0 && k < alt.length && alt[k]) hit = entryAlt.indexOf(alt[k])
    if (hit >= 0) picked[hit] = true
    else missed++
  }
  return { picked, missed }
}

// ---- 頁面層:勾選 ↔ 鍵(regex_tool_ui.cpp `KeyOf` :95、`ZhLine` :60、`collectKeys` :378、`applyKeys` :364)----

/** regex_tool_ui.cpp:95 `KeyOf`:英文第一行(沒有就空字串) */
export function keyOf (d: RegexEntry): string {
  return d.en[0] ?? ''
}

/** regex_tool_ui.cpp:60 `ZhLine`:中文第一行,沒有就英文第一行 */
export function zhLine (d: RegexEntry): string {
  return d.zh[0] ?? d.en[0] ?? ''
}

/** regex_tool_ui.cpp:378 `collectKeys`:勾選索引 → 鍵(依列順序) */
export function collectKeys (page: RegexPage, picked: readonly number[]): { keys: string[], alt: string[] } {
  const set = new Set(picked)
  const keys: string[] = []
  const alt: string[] = []
  page.entries.forEach((d, i) => {
    if (!set.has(i)) return
    keys.push(keyOf(d))
    alt.push(zhLine(d))
  })
  return { keys, alt }
}

/** regex_tool_ui.cpp:364 `applyKeys`:鍵 → 勾選索引 + 還原不到的數量 */
export function applyKeys (page: RegexPage, keys: readonly string[], alt: readonly string[]): { picked: number[], missed: number } {
  const r = resolveKeys(keys, alt, page.entries.map(keyOf), page.entries.map(zhLine))
  const picked: number[] = []
  r.picked.forEach((v, i) => { if (v) picked.push(i) })
  return { picked, missed: r.missed }
}
