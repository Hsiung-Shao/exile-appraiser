// Poe Regex 的記憶狀態與書籤:移植自 PobTools `host/regex_state.{h,cpp}`。
//
// 鍵用英文那一行(語言中性、跨賽季不變;列號每季會變),中文當後援;還原不到的**計數回報,不靜默丟掉**。
// 這裡只做模型 + JSON 字串的序列化 / 反序列化;檔案 IO(temp + rename 原子寫入)由呼叫端做(main 或 CLI)。
//
// 存檔格式 schema 2(WP-C):多了演算法頁的數值 `numeric{pageId:{entryId:{min,max,choice}}}`、自訂文字 `custom[]`、
// 排除詞 `excludes[]`、輸出範圍 `outScope`(合併 / 單頁)與書籤的 `numeric`(演算法頁書籤的值)。
// schema 1 的舊檔照讀:缺的欄位 = 空 / 預設值。
//
// schema 3(第 32 步,2026-10-04):地圖 / 換界石數值條件嵌進宿主詞綴頁(sections.ts)。數值區的勾選存在宿主頁那筆
// `current` 的 `num`(項目 id)、值存在 `numeric[宿主頁 id]`;書籤同樣以宿主頁 + `num` + `numeric` 表示;
// `collapsed` = 收合的數值區(宿主頁 id)。schema 2 以前頁 id 為 `map_numeric` / `waystone_numeric` 的資料讀入時
// 轉成新結構(`migrateSections`),寫回一律新結構。
//
// schema 4(第 33 步,2026-10-04):書籤可設個別熱鍵 `hotkey`(APT 熱鍵字串,如 `Ctrl + Shift + 1`;空 = 沒設,不寫出)。
// 熱鍵只在書籤的遊戲 = 目前遊戲時註冊(main `shortcut-actions.ts`)。schema ≤ 3 的舊檔照讀(沒有熱鍵);
// 舊版程式讀 schema 4 檔會忽略 `hotkey`(下次存檔就沒了),其餘欄位相容。
//
// schema 5(第 36 步,2026-10-04):書籤資料夾(只有一層,folders.ts)。書籤多 `folder`(空 = 未分類,不寫出);
// `folders: {poe1: [{name, collapsed}], poe2: [...]}`(依遊戲各一組,陣列順序 = 資料夾順序)、`uncatCollapsed`(未分類收合的遊戲)。
// schema ≤ 4 的舊檔讀入 = 全部未分類、沒有資料夾(呼叫端不必為了版號立刻寫回);讀入時 `normalizeFolders` 整理
// (指向不存在資料夾的書籤 → 補資料夾、同遊戲書籤依資料夾順序排好)。舊版程式讀 schema 5 檔會忽略資料夾(書籤內容照讀)。

import type { Mode } from './gen'
import type { RegexEntry, RegexGame, RegexLang, RegexPage } from './data'
import type { AlgoValue } from './pages/types'
import { SECTION_HOSTS, sectionHostOf, unionKeys } from './sections'
import { normalizeFolders, type BookmarkFolder } from './folders'

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
  /** 演算法頁書籤:entryId → 值(schema 2;語料頁沒有)。宿主詞綴頁書籤 = 數值區的值(schema 3) */
  numeric?: Record<string, AlgoValue>
  /** 宿主詞綴頁書籤:數值區勾選的項目 id(schema 3;沒有 = 數值區不勾) */
  num?: string[]
  /** 第 33 步:個別熱鍵(APT 熱鍵字串;沒設 = undefined;schema 4) */
  hotkey?: string
  /** 第 36 步:資料夾名稱(沒有 / 空 = 未分類;schema 5) */
  folder?: string
}

/** 存檔格式版本(serializeRegexState 寫出的 `schema`) */
export const REGEX_STATE_SCHEMA = 5

/** 存檔字串的 `schema`(讀不到 = 0 = 最舊);判斷要不要立刻寫回(遷移)用 */
export function regexStateSchemaOf (text: string): number {
  const m = /"schema"\s*:\s*(\d+)/.exec(text)
  return m ? Number(m[1]) : 0
}

/** regex_state.h `RegexPagePicks` */
export interface RegexPagePicks {
  page: string
  keys: string[]
  alt: string[]
  /** 宿主詞綴頁:數值區勾選的項目 id(schema 3) */
  num?: string[]
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
  /** 演算法頁的輸入值:pageId → entryId → 值(schema 2) */
  numeric: Record<string, Record<string, AlgoValue>>
  /** 自訂文字(每項一個獨立 term,不驗證;schema 2) */
  custom: string[]
  /** 排除詞(併進 none 的 `!` term;schema 2) */
  excludes: string[]
  /** 輸出區顯示合併後(combined)或目前這一頁(page);schema 2 */
  outScope: 'combined' | 'page'
  /** 收合的數值區(宿主頁 id);schema 3,預設全部展開 */
  collapsed: string[]
  /** 第 36 步:書籤資料夾(依遊戲各一組;陣列順序 = 資料夾順序;schema 5) */
  folders: Record<RegexGame, BookmarkFolder[]>
  /** 第 36 步:「未分類」收合的遊戲(schema 5) */
  uncatCollapsed: RegexGame[]
}

export function defaultRegexState (): RegexUiState {
  return {
    game: '', page: '', mode: 'any', lang: 'zh', bilingual: true, current: [], bookmarks: [],
    numeric: {}, custom: [], excludes: [], outScope: 'combined', collapsed: [], folders: { poe1: [], poe2: [] }, uncatCollapsed: []
  }
}

/** 資料夾清單(壞的項目略過;名稱正規化 / 去重由 normalizeFolders 做) */
function folderArray (raw: unknown): BookmarkFolder[] {
  if (!Array.isArray(raw)) return []
  const out: BookmarkFolder[] = []
  for (const f of raw) {
    if (typeof f === 'string') out.push({ name: f, collapsed: false })
    else if (isObj(f) && typeof f.name === 'string') out.push({ name: f.name, collapsed: f.collapsed === true })
  }
  return out
}

/** 只留 AlgoValue 認得的欄位(與 pages/index.ts sanitizeValue 相同規則;這裡不 import 它以免 state ↔ pages 循環) */
function numericValue (raw: unknown): AlgoValue | null {
  if (!isObj(raw)) return null
  const v: AlgoValue = {}
  if (typeof raw.min === 'number' && Number.isFinite(raw.min)) v.min = Math.trunc(raw.min)
  if (typeof raw.max === 'number' && Number.isFinite(raw.max)) v.max = Math.trunc(raw.max)
  if (typeof raw.choice === 'string') v.choice = raw.choice.slice(0, 16)
  return v
}

function numericMap (raw: unknown): Record<string, AlgoValue> {
  const m: Record<string, AlgoValue> = {}
  if (!isObj(raw)) return m
  for (const [k, v] of Object.entries(raw)) {
    const x = numericValue(v)
    if (x) m[k] = x
  }
  return m
}

type Json = Record<string, unknown>
function isObj (v: unknown): v is Json { return typeof v === 'object' && v !== null && !Array.isArray(v) }

/** regex_state.cpp:60 `RegexUiState::PicksFor`:該頁的勾選,沒有就建立 */
export function picksFor (s: RegexUiState, pageId: string): RegexPagePicks {
  let p = s.current.find(x => x.page === pageId)
  if (!p) {
    p = { page: pageId, keys: [], alt: [] }
    s.current.push(p)
  }
  return p
}


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

/**
 * 一筆書籤(regex_state.json 的 `bookmarks[]`;第 40 步起書籤包 bookmarks-share.ts 共用同一套驗證)。
 * 不是物件 / 沒名字 / 沒頁 / 沒鍵 = null(UI 無法提供,留著只會多一列永遠空白的東西);欄位型別不符 = 丟例外(呼叫端決定整份失敗或只略過這筆)。
 */
export function parseBookmark (b: unknown): RegexBookmark | null {
  if (!isObj(b)) return null
  const rec: RegexBookmark = {
    name: str(b, 'name', ''),
    page: str(b, 'page', ''),
    game: gameOf(str(b, 'game', '')),
    mode: oneOf(str(b, 'mode', 'any'), 'any', 'all', 'none'),
    lang: oneOf(str(b, 'lang', 'zh'), 'zh', 'en'),
    keys: stringArray(b, 'keys'),
    alt: stringArray(b, 'alt')
  }
  if (isObj(b.numeric)) rec.numeric = numericMap(b.numeric)
  const num = stringArray(b, 'num')
  if (num.length) rec.num = num
  if (typeof b.hotkey === 'string' && b.hotkey.trim()) rec.hotkey = b.hotkey.trim()
  if (typeof b.folder === 'string' && b.folder.trim()) rec.folder = b.folder
  if (!rec.name || !rec.page || (rec.keys.length === 0 && !rec.num)) return null
  return rec
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
        const rec: RegexPagePicks = { page, keys: stringArray(p, 'keys'), alt: stringArray(p, 'alt') }
        const num = stringArray(p, 'num')
        if (num.length) rec.num = num
        s.current.push(rec)
      }
    }
    if (Array.isArray(doc.bookmarks)) {
      for (const b of doc.bookmarks) {
        const rec = parseBookmark(b)
        if (rec) s.bookmarks.push(rec)
      }
    }
    if (isObj(doc.numeric)) {
      for (const [pid, m] of Object.entries(doc.numeric)) s.numeric[pid] = numericMap(m)
    }
    s.custom = stringArray(doc, 'custom')
    s.excludes = stringArray(doc, 'excludes')
    s.outScope = oneOf(str(doc, 'outScope', 'combined'), 'combined', 'page')
    s.collapsed = stringArray(doc, 'collapsed')
    if (isObj(doc.folders)) {
      s.folders = { poe1: folderArray(doc.folders.poe1), poe2: folderArray(doc.folders.poe2) }
    }
    s.uncatCollapsed = stringArray(doc, 'uncatCollapsed').map(gameOf).filter((g, i, a): g is RegexGame => g !== '' && a.indexOf(g) === i)
    migrateSections(s)
    normalizeFolders(s)
    return { ok: true, state: s }
  } catch {
    return { ok: false, state: defaultRegexState() }
  }
}

/**
 * 第 32 步遷移(schema ≤ 2 → 3,就地):頁 id 為數值頁(`map_numeric` / `waystone_numeric`)的
 * 目前勾選、數值、記住的頁、書籤 → 宿主詞綴頁的數值區。已是新結構的資料不受影響(可重複呼叫)。
 * 回傳是否改了任何東西。
 */
export function migrateSections (s: RegexUiState): boolean {
  let changed = false
  // 目前勾選:數值頁那筆的 keys(項目 id)併進宿主頁那筆的 num
  const kept: RegexPagePicks[] = []
  const moved: Array<[string, string[]]> = []
  for (const p of s.current) {
    const host = sectionHostOf(p.page)
    if (host) { moved.push([host, p.keys]); changed = true } else kept.push(p)
  }
  s.current = kept
  for (const [host, keys] of moved) {
    if (!keys.length) continue
    const slot = picksFor(s, host)
    slot.num = unionKeys(slot.num, keys)
  }
  // 數值:numeric[數值頁] → numeric[宿主頁](數值頁的值優先,宿主頁原本不會有值)
  for (const [sec, host] of Object.entries(SECTION_HOSTS)) {
    const m = s.numeric[sec]
    if (!m) continue
    s.numeric[host] = { ...(s.numeric[host] ?? {}), ...m }
    delete s.numeric[sec]
    changed = true
  }
  const pageHost = sectionHostOf(s.page)
  if (pageHost) { s.page = pageHost; changed = true }
  // 書籤:數值頁書籤 → 宿主頁書籤(詞綴不勾、數值區 = 原本的勾選與值)
  for (const b of s.bookmarks) {
    const host = sectionHostOf(b.page)
    if (!host) continue
    b.page = host
    b.num = [...b.keys]
    b.keys = []
    b.alt = []
    changed = true
  }
  s.collapsed = s.collapsed.map(id => sectionHostOf(id) ?? id).filter((id, i, a) => a.indexOf(id) === i)
  return changed
}

/** regex_state.cpp:137 `RegexUiState::Save` 的內容部分(`dump(1, '\t')`);寫檔請 temp + rename */
export function serializeRegexState (s: RegexUiState): string {
  const doc = {
    schema: REGEX_STATE_SCHEMA,
    game: s.game,
    page: s.page,
    mode: s.mode,
    lang: s.lang,
    bilingual: s.bilingual,
    current: s.current.filter(p => p.keys.length > 0 || (p.num?.length ?? 0) > 0).map(p => ({
      page: p.page, keys: p.keys, alt: p.alt, ...(p.num?.length ? { num: p.num } : {})
    })),
    bookmarks: s.bookmarks.map(b => ({
      name: b.name, page: b.page, game: b.game, mode: b.mode, lang: b.lang, keys: b.keys, alt: b.alt,
      ...(b.numeric && Object.keys(b.numeric).length ? { numeric: b.numeric } : {}),
      ...(b.num?.length ? { num: b.num } : {}),
      ...(b.hotkey ? { hotkey: b.hotkey } : {}),
      ...(b.folder ? { folder: b.folder } : {})
    })),
    numeric: Object.fromEntries(Object.entries(s.numeric).filter(([, m]) => Object.keys(m).length > 0)),
    custom: s.custom,
    excludes: s.excludes,
    outScope: s.outScope,
    collapsed: s.collapsed,
    folders: {
      poe1: s.folders.poe1.map(f => ({ name: f.name, collapsed: f.collapsed })),
      poe2: s.folders.poe2.map(f => ({ name: f.name, collapsed: f.collapsed }))
    },
    uncatCollapsed: s.uncatCollapsed
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
