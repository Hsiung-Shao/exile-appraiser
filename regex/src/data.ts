// Poe Regex 出貨清單:`data/regex/regex_poe{1,2}.json`(逐位元組來自 pob-zh-engine `dist/Data/`)。
// 載入規則移植自 PobTools `host/regex_data.cpp` `RegexDataset::LoadOne`(:92–157):
//   * 缺鍵 = 空(StringArray / NestedStringArray);非字串元素略過
//   * `zh` 與 `en` 皆空的項目丟棄;`g` 越界歸 0;沒有項目的頁丟棄
//   * `limit` 缺鍵 = 250
// 語料組法移植自 `host/regex_tool_ui.cpp` `buildCorpus()`(:1059)與 `regex_selftest.cpp` DataTests 的 build():
//   選定語言的行為主,整筆退回另一語言;hidden 跟著該筆實際用的語言走;ambient / 名稱字用選定語言。
// 純 TS:不讀檔(讀檔在 `node.ts` 或呼叫端)。
//
// schema 2(PobTools 產生器升版後):頂層多 `labels{zh,en}`(clientstrings 鍵 → 文字,`{0}` 已換成 `#`)、
// 頁面多 `kind`(mods / names;演算法頁 numeric / sockets 由 `pages/` 在程式裡組,不在資料檔)。schema 1 照樣可讀:
// 缺 `kind` = mods、缺 `labels` = null(呼叫端改讀 `data/regex/labels.<game>.json` 暫代檔,見 parseLabels)。

import { Corpus, type Ambient, type Entry, type Options } from './gen'

export type RegexGame = 'poe1' | 'poe2'
/** 輸出語言 = 語料語言(「不會誤中」是對單一語言清單講的,兩邊的 token 不能互換) */
export type RegexLang = 'zh' | 'en'
/**
 * 頁面種類(schema 2 `kind`):mods / names = 語料頁(Corpus 覆蓋演算法);
 * numeric / sockets = 演算法頁(`pages/` 產生片段,不經 Corpus,見 combine.ts)
 */
export type PageKind = 'mods' | 'names' | 'numeric' | 'sockets'
export const PAGE_KINDS: readonly PageKind[] = ['mods', 'names', 'numeric', 'sockets']

/** clientstrings 鍵 → 顯示文字(兩語);`{0}` 已換成 `#`、`[Id|文字]` 已剝成「文字」 */
export interface RegexLabels {
  zh: Record<string, string>
  en: Record<string, string>
}

export interface RegexEntry {
  id: string
  /** index into RegexPage.groups(越界已歸 0) */
  g: number
  t17: boolean
  affixZh: string
  zh: string[]
  en: string[]
  hiddenZh: string[]
  hiddenEn: string[]
  /** 同一條詞綴在別的 roll 值印的其他寫法(gen.ts `Entry.alts`);沒有就省略 */
  altZh?: string[]
  altEn?: string[]
}

export interface RegexPage {
  game: RegexGame
  id: string
  /** schema 2 `kind`;schema 1 沒有 = 'mods' */
  kind?: PageKind
  title: string
  titleEn: string
  note: string
  limit: number
  groups: string[]
  groupsEn: string[]
  entries: RegexEntry[]
  ambientZh: string[]
  ambientEn: string[]
  namePrefixZh: string[]
  nameSuffixZh: string[]
  namePrefixEn: string[]
  nameSuffixEn: string[]
}

export interface RegexCatalogue {
  game: RegexGame
  schema: number
  source: string
  pages: RegexPage[]
  /** schema 2 頂層 `labels`;schema 1 = null */
  labels: RegexLabels | null
}

/** 是否為語料頁(mods / names;缺 kind 也算) */
export function isCorpusPage (p: RegexPage): boolean {
  return p.kind === undefined || p.kind === 'mods' || p.kind === 'names'
}

type Json = Record<string, unknown>

function isObj (v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** regex_data.cpp:44 `StringArray`:缺鍵或非陣列 = 空;非字串元素略過 */
function stringArray (j: Json, key: string): string[] {
  const v = j[key]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

/** regex_data.cpp:56 `NestedStringArray` */
function nestedStringArray (j: Json, key: string, sub: string): string[] {
  const v = j[key]
  return isObj(v) ? stringArray(v, sub) : []
}

/**
 * nlohmann `j.value(key, default)`:缺鍵 → default;型別不符 → 丟例外(C++ 端整個檔案回滾)。
 * 這裡照做,讓壞檔在測試裡紅,而不是悄悄變成空字串。
 */
function value<T extends string | number | boolean> (j: Json, key: string, def: T): T {
  if (!(key in j) || j[key] === null) return def
  const v = j[key]
  if (typeof def === 'number' ? typeof v !== 'number' : typeof v !== typeof def) {
    throw new Error(`欄位 ${key} 型別不符(期望 ${typeof def},實際 ${typeof v})`)
  }
  return (typeof def === 'number' ? Math.trunc(v as number) : v) as T
}

/** regex_data.cpp:92 `RegexDataset::LoadOne`(不含讀檔):解析一個遊戲的清單檔。失敗丟例外。 */
export function parseRegexCatalogue (input: string | unknown, game: RegexGame): RegexCatalogue {
  const doc: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (!isObj(doc)) throw new Error(`regex_${game}.json 不是 JSON 物件`)
  const pagesRaw = doc.pages
  if (!Array.isArray(pagesRaw)) throw new Error(`regex_${game}.json 缺少 pages 陣列`)
  const pages: RegexPage[] = []
  for (const p of pagesRaw) {
    if (!isObj(p)) continue
    const page: RegexPage = {
      game,
      id: value(p, 'id', ''),
      kind: pageKind(value(p, 'kind', 'mods')),
      title: value(p, 'title', ''),
      titleEn: value(p, 'titleEn', ''),
      note: value(p, 'note', ''),
      limit: value(p, 'limit', 250),
      groups: stringArray(p, 'groups'),
      groupsEn: stringArray(p, 'groupsEn'),
      entries: [],
      ambientZh: stringArray(p, 'ambientZh'),
      ambientEn: stringArray(p, 'ambientEn'),
      namePrefixZh: nestedStringArray(p, 'nameWordsZh', 'prefix'),
      nameSuffixZh: nestedStringArray(p, 'nameWordsZh', 'suffix'),
      namePrefixEn: nestedStringArray(p, 'nameWordsEn', 'prefix'),
      nameSuffixEn: nestedStringArray(p, 'nameWordsEn', 'suffix')
    }
    const entries = p.entries
    if (!Array.isArray(entries)) continue
    for (const e of entries) {
      if (!isObj(e)) continue
      const d: RegexEntry = {
        id: value(e, 'id', ''),
        g: value(e, 'g', 0),
        t17: value(e, 't17', false),
        affixZh: value(e, 'affixZh', ''),
        zh: stringArray(e, 'zh'),
        en: stringArray(e, 'en'),
        hiddenZh: stringArray(e, 'hiddenZh'),
        hiddenEn: stringArray(e, 'hiddenEn')
      }
      const altZh = stringArray(e, 'altZh')
      const altEn = stringArray(e, 'altEn')
      if (altZh.length) d.altZh = altZh
      if (altEn.length) d.altEn = altEn
      if (d.zh.length === 0 && d.en.length === 0) continue
      if (d.g < 0 || d.g >= page.groups.length) d.g = 0
      page.entries.push(d)
    }
    if (page.entries.length) pages.push(page)
  }
  return {
    game,
    schema: typeof doc.schema === 'number' ? doc.schema : 0,
    source: typeof doc.source === 'string' ? doc.source : '',
    pages,
    labels: isObj(doc.labels) ? parseLabels(doc.labels) : null
  }
}

/** 未知的 kind 當 mods(新版產生器加了本版不認得的種類時,至少還能當語料頁用) */
function pageKind (v: string): PageKind {
  return (PAGE_KINDS as readonly string[]).includes(v) ? v as PageKind : 'mods'
}

/**
 * clientstrings 文字 → 搜尋列看得到的樣子:`[Id|顯示]` → 顯示、`[Id]` → Id(PoE2 的標記)、`{0}` → `#`。
 * (與資料檔的 `#` 慣例一致:`#` = 一個數值)
 */
export function normalizeLabel (s: string): string {
  return s
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2')
    .replace(/\[([^\]|]*)\]/g, '$1')
    .replace(/\{\d+\}/g, '#')
}

/**
 * 合併兩份 labels:primary(schema 2 資料檔自帶)逐鍵優先,fallback(暫代檔)只補 primary 缺的鍵。
 * 兩者都 null → null。
 */
export function mergeLabels (primary: RegexLabels | null, fallback: RegexLabels | null): RegexLabels | null {
  if (!primary) return fallback
  if (!fallback) return primary
  return { zh: { ...fallback.zh, ...primary.zh }, en: { ...fallback.en, ...primary.en } }
}

/**
 * labels 物件:接受 `{zh:{…}, en:{…}}`(schema 2 頂層 `labels`)或暫代檔 `{schema, source, labels:{zh,en}}`。
 * 非字串值略過;文字經 normalizeLabel。
 */
export function parseLabels (input: string | unknown): RegexLabels {
  let doc: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (isObj(doc) && isObj(doc.labels)) doc = doc.labels
  const out: RegexLabels = { zh: {}, en: {} }
  if (!isObj(doc)) return out
  for (const lang of ['zh', 'en'] as const) {
    const m = doc[lang]
    if (!isObj(m)) continue
    for (const [k, v] of Object.entries(m)) if (typeof v === 'string') out[lang][k] = normalizeLabel(v)
  }
  return out
}

/** 一筆項目在某語言下實際用的行(`buildCorpus` 的 want/fallback);`usedWant=false` 表示退回另一語言 */
export function entryLines (d: RegexEntry, lang: RegexLang): { texts: string[], hidden: string[], alts: string[], usedWant: boolean } {
  const zh = lang === 'zh'
  const want = zh ? d.zh : d.en
  const other = zh ? d.en : d.zh
  const usedWant = want.length > 0
  const zhSide = usedWant === zh
  return {
    texts: usedWant ? want : other,
    hidden: zhSide ? d.hiddenZh : d.hiddenEn,
    alts: (zhSide ? d.altZh : d.altEn) ?? [],
    usedWant
  }
}

/** 頁面的 ambient 文字(選定語言) */
export function pageAmbient (page: RegexPage, lang: RegexLang): Ambient {
  const zh = lang === 'zh'
  return {
    lines: zh ? page.ambientZh : page.ambientEn,
    nameLeft: zh ? page.namePrefixZh : page.namePrefixEn,
    nameRight: zh ? page.nameSuffixZh : page.nameSuffixEn
  }
}

export interface BuildCorpusOptions extends Options {
  /** false = 不放 hidden / ambient(只給 selftest 的「stuck by hidden/ambient text」統計用)。預設 true */
  hidden?: boolean
}

const corpusCache = new WeakMap<RegexPage, Map<string, Corpus>>()

/**
 * regex_tool_ui.cpp:1059 `buildCorpus`:依語言組 Corpus。建索引要一趟全文,所以以 (page, lang, 選項) 快取;
 * 同一個 page 物件重複呼叫拿到同一個 Corpus。
 */
export function buildCorpus (page: RegexPage, lang: RegexLang, opt: BuildCorpusOptions = {}): Corpus {
  const full = opt.hidden ?? true
  const key = `${lang}|${full ? 1 : 0}|${opt.maxTokenChars ?? 12}|${opt.anchors ?? true ? 1 : 0}`
  let byKey = corpusCache.get(page)
  if (!byKey) {
    byKey = new Map()
    corpusCache.set(page, byKey)
  }
  const hit = byKey.get(key)
  if (hit) return hit
  const es: Entry[] = page.entries.map(d => {
    const l = entryLines(d, lang)
    // alts 是印出的文字,不是 hidden:不放 hidden 時照樣帶(regex_selftest.cpp DataTests 同)
    return { id: d.id, texts: l.texts, hidden: full ? l.hidden : [], ...(l.alts.length ? { alts: l.alts } : {}) }
  })
  const c = new Corpus(es, full ? pageAmbient(page, lang) : {}, { maxTokenChars: opt.maxTokenChars, anchors: opt.anchors })
  byKey.set(key, c)
  return c
}

/** 顯示用的主行(選定語言的第一行,沒有就退回另一語言) */
export function entryTitle (d: RegexEntry, lang: RegexLang): string {
  return entryLines(d, lang).texts[0] ?? d.id
}
