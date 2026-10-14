/**
 * exile-appraiser(2026-10-15):PoE1 查價結果「懸停顯示物品」浮窗的繁中顯示。
 * 演算法與 PoE2 版(`poe2/src/web/price-check/trade/display-zh.ts`,耦合點 15)相同,改接 PoE1 的資料與浮窗結構:
 *
 * 國際服 `/api/trade/fetch` 回的詞綴 / 物品名一律是英文;介面語言是繁中時,這裡把它們換成 repo 既有資料裡的繁中,
 * **不自行翻譯任何字**:
 * - 詞綴:每行自己的 trade stat id(`display-item.ts` 已放在 `DisplayLine.tradeId`)→ en / cmn-Hant `stats.ndjson`
 *   `trade.ids` 含這個 id 的條目,以 `ref` 配對英 / 繁兩筆;英文行必須**完整匹配**某個英文 matcher,再依語言無關的
 *   `negate` / `value` 挑繁中 matcher 代入數值;同旗標多種繁中寫法 → 台服交易站快照(`data/poe1/trade/tw/stats.json`,
 *   `scripts/fetch-poe1-trade-data.mjs`)同一個 id 的文字代入同樣數值,恰好命中一個才採用;挑不出唯一 → 保留英文。
 * - 物品名:傳奇 `name` → `UNIQUE::`;`typeLine` 等於 `baseType`(或寶石 / 命運卡)→ `ITEM` / `GEM` / `DIVINATION_CARD`;
 *   稀有隨機名、魔法物品帶詞綴的 typeLine 保留英文。
 * - 類別行 / 屬性名 / 需求行 / 物品等級 / 插槽 / 底部標籤 → GGPK `itemclasses` + `clientstrings` 白名單
 *   (`data/poe1/item-classes/item-classes.json`,`scripts/sync-poe1-item-classes.mjs`);需求行依 `requirements[].type`
 *   (62 等級 / 63 力量 / 64 敏捷 / 65 智慧,語言無關)重組,任何一項對不上整行保留英文。
 * - tier、顏色、行數、順序完全不動;只換 `text`。
 *
 * 何時翻:宿主(renderer)以 `configureDisplayZh` 注入設定與資料來源;國際服 + 介面繁中 + 懸停浮窗不是「關閉」才翻。
 * 沒注入(CLI / 測試)= 一律不翻。`requestResults` 不 await 資料:已載好同步翻;還沒載 → 這次英文、背景載入,
 * 下一次查價(含快取結果)就是繁中;renderer 在資料載好後閒置時 `scheduleDisplayZhPreload` 先載。
 * 重用 `@/assets/data` 目前繫結的那一個語系(`ACTIVE_LANG` + `STATS_ITERATOR` / `ITEMS_ITERATOR`),只另讀缺的檔。
 */
import { ACTIVE_LANG, ITEMS_ITERATOR, STATS_ITERATOR } from '@/assets/data'
import type { DataSource } from '@exile-appraiser/core/games/adapter'
import type { Stat, StatMatcher, StatOrGroup } from '@/assets/data/interfaces'
import { MOD_SECTIONS, type DisplayItem, type DisplayLine, type FetchItem, type ModSection } from './display-item'

export interface DisplayZhOptions {
  uiLanguage: string
  itemHoverTooltip: string
}

export interface DisplayZhHost {
  options: () => DisplayZhOptions
  /** PoE1 資料目錄的 DataSource(renderer 用 `browserDataSource('./data/poe1')`);沒有 = 不翻 */
  source: () => DataSource | undefined
}

let host: DisplayZhHost | undefined

/** renderer 啟動時注入;`undefined` = 解除(測試用) */
export function configureDisplayZh (h: DisplayZhHost | undefined): void {
  host = h
}

interface StatPair { en: Stat, zh: Stat }

export interface DisplayZhData {
  /** 正規化後的 trade stat id(`explicit.stat_123`)→ 英 / 繁條目配對 */
  statsByTradeId: Map<string, StatPair[]>
  /** `stat_123`(去掉類別前綴)→ 配對;完整 id 查不到時的後備 */
  statsByHash: Map<string, StatPair[]>
  /** `${namespace}::${refName}` → 繁中名集合 */
  itemNames: Map<string, Set<string>>
  /** 台服交易站 trade stat id → 繁中文字(同旗標多種寫法時挑一個) */
  tradeTextZh?: Map<string, string>
  /** GGPK `ItemClasses` 的 Id 與英文名 → 繁中名集合 */
  itemClassZh?: Map<string, Set<string>>
  /** GGPK clientstrings 白名單:英文 → 繁中(同一英文對到多個不同繁中的不收) */
  stringZh?: Map<string, string>
  /** 需求行用字(`ItemRequirementsLabel` / `Level` / `StrengthShort`…) */
  requiresZh?: { label: string, level: string, attrs: Record<number, string> }
}

export interface DisplayZhExtras {
  /** `trade/tw/stats.json` */
  tradeStatsTw?: string
  /** `item-classes/item-classes.json` */
  itemClasses?: string
}

export type ZhLineReason = 'ok' | 'no-id' | 'unknown-id' | 'no-en-match' | 'no-zh-variant' | 'ambiguous'

export interface ZhLineReport {
  type: ModSection
  index: number
  tradeId: string | undefined
  en: string
  zh: string | undefined
  reason: ZhLineReason
}

// ---------------------------------------------------------------------------
// 資料

const loaded = new WeakMap<DataSource, Promise<DisplayZhData>>()
const ready = new WeakMap<DataSource, DisplayZhData>()

function * flatStats (records: Iterable<StatOrGroup | Stat>): Generator<Stat> {
  for (const r of records) {
    if ('stats' in r) yield * r.stats
    else yield r
  }
}

function parseNdjson<T> (text: string): T[] {
  const out: T[] = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (s) out.push(JSON.parse(s) as T)
  }
  return out
}

interface ZhItemRecord { namespace: string, refName: string, name: string }

export function buildDisplayZhData (
  enStatsNdjson: string,
  zhStatsNdjson: string,
  zhItemsNdjson: string,
  extras?: DisplayZhExtras
): DisplayZhData {
  return buildDisplayZhDataFrom(
    flatStats(parseNdjson<StatOrGroup>(enStatsNdjson)),
    flatStats(parseNdjson<StatOrGroup>(zhStatsNdjson)),
    parseNdjson<ZhItemRecord>(zhItemsNdjson),
    extras
  )
}

function buildExtras (extras: DisplayZhExtras | undefined): Partial<DisplayZhData> {
  const out: Partial<DisplayZhData> = {}
  if (extras?.tradeStatsTw) {
    const map = new Map<string, string>()
    const json = JSON.parse(extras.tradeStatsTw) as { result?: Array<{ entries?: Array<{ id?: unknown, text?: unknown }> }> }
    for (const group of json.result ?? []) {
      for (const e of group.entries ?? []) {
        if (typeof e.id === 'string' && typeof e.text === 'string' && !map.has(e.id)) map.set(e.id, e.text)
      }
    }
    out.tradeTextZh = map
  }
  if (extras?.itemClasses) {
    const json = JSON.parse(extras.itemClasses) as {
      classes?: Array<{ id?: unknown, en?: unknown, zh?: unknown }>
      strings?: Array<{ id?: unknown, en?: unknown, zh?: unknown }>
    }
    const classes = new Map<string, Set<string>>()
    const add = (key: string, zh: string) => {
      let set = classes.get(key)
      if (!set) classes.set(key, (set = new Set()))
      set.add(zh)
    }
    for (const c of json.classes ?? []) {
      if (typeof c.zh !== 'string' || !c.zh) continue
      if (typeof c.id === 'string') add(c.id, c.zh)
      if (typeof c.en === 'string' && c.en !== c.id) add(c.en, c.zh)
    }
    out.itemClassZh = classes

    const byEn = new Map<string, Set<string>>()
    const byId = new Map<string, string>()
    for (const s of json.strings ?? []) {
      if (typeof s.id !== 'string' || typeof s.en !== 'string' || typeof s.zh !== 'string' || !s.zh) continue
      byId.set(s.id, s.zh)
      let set = byEn.get(s.en)
      if (!set) byEn.set(s.en, (set = new Set()))
      set.add(s.zh)
    }
    out.stringZh = new Map([...byEn].filter(([, set]) => set.size === 1).map(([en, set]) => [en, [...set][0]]))
    const label = byId.get('ItemRequirementsLabel')
    const level = byId.get('Level')
    const str = byId.get('StrengthShort')
    const dex = byId.get('DexterityShort')
    const int = byId.get('IntelligenceShort')
    if (label && level && str && dex && int) out.requiresZh = { label, level, attrs: { 63: str, 64: dex, 65: int } }
  }
  return out
}

export function buildDisplayZhDataFrom (
  enStats: Iterable<Stat>,
  zhStats: Iterable<Stat>,
  zhItems: Iterable<ZhItemRecord>,
  extras?: DisplayZhExtras
): DisplayZhData {
  const enByRef = new Map<string, Stat>()
  for (const s of enStats) {
    if (!enByRef.has(s.ref)) enByRef.set(s.ref, s)
  }
  const statsByTradeId = new Map<string, StatPair[]>()
  const statsByHash = new Map<string, StatPair[]>()
  const push = (map: Map<string, StatPair[]>, key: string, pair: StatPair) => {
    const list = map.get(key)
    if (!list) map.set(key, [pair])
    else if (!list.includes(pair)) list.push(pair)
  }
  for (const zh of zhStats) {
    const en = enByRef.get(zh.ref)
    if (!en) continue
    const pair = { en, zh }
    for (const ids of Object.values(zh.trade?.ids ?? {})) {
      for (const id of ids) {
        push(statsByTradeId, id, pair)
        const dot = id.indexOf('.')
        if (dot !== -1) push(statsByHash, id.slice(dot + 1), pair)
      }
    }
  }
  const itemNames = new Map<string, Set<string>>()
  for (const r of zhItems) {
    const key = `${r.namespace}::${r.refName}`
    let set = itemNames.get(key)
    if (!set) itemNames.set(key, (set = new Set()))
    set.add(r.name)
  }
  return { statsByTradeId, statsByHash, itemNames, ...buildExtras(extras) }
}

const STAT_LINE_KEY = '"ref":'
const ITEM_LINE_KEY = '"namespace":'

/** 補充來源各自讀;失敗只記錄,那部分維持英文 */
async function loadExtras (ds: DataSource): Promise<DisplayZhExtras> {
  const soft = async (rel: string): Promise<string | undefined> => {
    try {
      return await ds.text(rel)
    } catch (e) {
      console.error(`[trade] 懸停浮窗繁中補充資料 ${rel} 載入失敗,該部分維持英文:`, e)
      return undefined
    }
  }
  const [tradeStatsTw, itemClasses] = await Promise.all([soft('trade/tw/stats.json'), soft('item-classes/item-classes.json')])
  return { tradeStatsTw, itemClasses }
}

/**
 * 讀 `en/stats.ndjson`、`cmn-Hant/{stats,items}.ndjson` 與補充資料(同一個 DataSource 只讀一次;失敗下次重試)。
 * `@/assets/data` 目前繫結的語系直接用記憶體裡的(不重讀那個語系的檔)。
 */
export function loadDisplayZhData (ds: DataSource): Promise<DisplayZhData> {
  const have = ready.get(ds)
  if (have) return Promise.resolve(have)
  let p = loaded.get(ds)
  if (!p) {
    // 呼叫當下取(之後查價換語系會換掉迭代器,這裡拿到的仍是同一份)
    const mem = ACTIVE_LANG
    const statsIt = STATS_ITERATOR
    const itemsIt = ITEMS_ITERATOR
    const parsedStats = async (rel: string) => [...flatStats(parseNdjson<StatOrGroup>(await ds.text(rel)))]
    p = (async () => {
      const extras = await loadExtras(ds)
      if (mem === 'cmn-Hant') {
        const en = await parsedStats('en/stats.ndjson')
        return buildDisplayZhDataFrom(en, statsIt(STAT_LINE_KEY), itemsIt(ITEM_LINE_KEY) as Iterable<ZhItemRecord>, extras)
      }
      if (mem === 'en') {
        const [zh, items] = await Promise.all([
          parsedStats('cmn-Hant/stats.ndjson'),
          ds.text('cmn-Hant/items.ndjson').then(t => parseNdjson<ZhItemRecord>(t))
        ])
        return buildDisplayZhDataFrom(statsIt(STAT_LINE_KEY), zh, items, extras)
      }
      const [en, zh, items] = await Promise.all([
        ds.text('en/stats.ndjson'),
        ds.text('cmn-Hant/stats.ndjson'),
        ds.text('cmn-Hant/items.ndjson')
      ])
      return buildDisplayZhData(en, zh, items, extras)
    })().then(d => {
      ready.set(ds, d)
      return d
    })
    p.catch(() => loaded.delete(ds))
    loaded.set(ds, p)
  }
  return p
}

/** 測試用:清掉某個 DataSource 的快取 */
export const __displayZhTest = {
  reset (ds: DataSource): void {
    loaded.delete(ds)
    ready.delete(ds)
  }
}

function hostSource (): DataSource | undefined {
  try {
    return host?.source()
  } catch {
    return undefined
  }
}

/** 浮窗會翻繁中的條件(國際服、介面繁中、懸停浮窗不是「關閉」、宿主有注入) */
function wantsZh (realm: string): boolean {
  if (!host) return false
  const opts = host.options()
  return realm === 'intl' && opts.uiLanguage === 'cmn-Hant' && opts.itemHoverTooltip !== 'off'
}

function whenIdle (fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (typeof ric === 'function') ric(fn, { timeout: 5000 })
  else setTimeout(fn, 2000)
}

/**
 * renderer 在 PoE1 資料載好後、或設定(遊戲 / 伺服器 / 介面語言 / 懸停浮窗)改變時呼叫;符合翻譯條件且還沒載 / 沒在載
 * → 排到閒置時背景載入,第一次查價就能同步翻。回傳是否排了新的載入。
 */
export function scheduleDisplayZhPreload (realm: string, later: (fn: () => void) => void = whenIdle): boolean {
  if (!wantsZh(realm)) return false
  const ds = hostSource()
  if (!ds) return false
  if (ready.has(ds) || loaded.has(ds)) return false
  later(() => {
    if (!wantsZh(realm)) return
    const started = Date.now()
    loadDisplayZhData(ds).then(
      () => console.log(`[trade] PoE1 懸停浮窗繁中資料預先載入完成(${Date.now() - started} ms)`),
      (e: unknown) => console.error('[trade] PoE1 懸停浮窗繁中資料預先載入失敗,查價時再試:', e)
    )
  })
  return true
}

// ---------------------------------------------------------------------------
// 單行詞綴

const NUM = String.raw`(\d+(?:\.\d+)?)`
const SIGNED_NUM = String.raw`([+-]?\d+(?:\.\d+)?)`

function normalizeText (s: string): string {
  return s.replace(/[ \t]*\n[ \t]*/g, '\n').trim()
}

function escapeRe (s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface Template {
  parts: string[]
  signs: Array<'+' | '-' | undefined>
  re?: RegExp
}

function parseTemplate (tpl: string): Template {
  const parts = normalizeText(tpl).split('#')
  const signs = parts.slice(0, -1).map(p => {
    const last = p.slice(-1)
    return last === '+' || last === '-' ? last : undefined
  })
  return { parts, signs }
}

const templateCache = new WeakMap<StatMatcher, Template>()
function templateOf (m: StatMatcher): Template {
  let t = templateCache.get(m)
  if (!t) {
    t = parseTemplate(m.string)
    templateCache.set(m, t)
  }
  return t
}

function matchTemplate (line: string, tpl: Template): string[] | undefined {
  if (!tpl.re) {
    let re = '^' + escapeRe(tpl.parts[0])
    for (let k = 1; k < tpl.parts.length; k += 1) {
      re += (tpl.signs[k - 1] ? NUM : SIGNED_NUM) + escapeRe(tpl.parts[k])
    }
    tpl.re = new RegExp(re + '$')
  }
  const m = tpl.re.exec(line)
  if (!m) return undefined
  return m.slice(1).map((v, k) => (tpl.signs[k] ? tpl.signs[k] + v : v))
}

function fillTemplate (tpl: Template, values: string[]): string | undefined {
  if (values.length !== tpl.parts.length - 1) return undefined
  let out = tpl.parts[0]
  for (let k = 0; k < values.length; k += 1) {
    let v = values[k]
    const literal = tpl.signs[k]
    if (literal) {
      const own = /^[+-]/.exec(v)?.[0]
      if (own && own !== literal) return undefined
      if (own) v = v.slice(1)
      else if (literal === '-') return undefined
    }
    out += v + tpl.parts[k + 1]
  }
  return out
}

function candidatesForPair (line: string, pair: StatPair): { out: Set<string>, enMatched: boolean, valueSets: string[][] } {
  const out = new Set<string>()
  const valueSets: string[][] = []
  let enMatched = false
  for (const enM of pair.en.matchers) {
    const values = matchTemplate(line, templateOf(enM))
    if (!values) continue
    enMatched = true
    const enHasValue = enM.value != null
    if (enHasValue && values.length === 1 && Number(values[0]) !== enM.value) continue

    const sameKey = (m: StatMatcher) => !!m.negate === !!enM.negate && m.value === enM.value
    let zhMatchers = pair.zh.matchers.filter(sameKey)
    let zhValues = values
    if (!zhMatchers.length && enHasValue && !pair.zh.trade?.option && values.length <= 1) {
      zhMatchers = pair.zh.matchers.filter(m => !!m.negate === !!enM.negate && m.value == null && templateOf(m).parts.length === 2)
      zhValues = values.length ? values : [String(enM.value)]
    }
    if (zhMatchers.length) valueSets.push(zhValues)
    for (const zhM of zhMatchers) {
      const filled = fillTemplate(templateOf(zhM), zhValues)
      if (filled != null) out.add(filled)
    }
  }
  return { out, enMatched, valueSets }
}

const tradeTplCache = new Map<string, Template>()

function pickByTradeText (results: Set<string>, valueSets: string[][], fullIds: string[], data: DisplayZhData): string | undefined {
  if (!data.tradeTextZh) return undefined
  const text = fullIds.map(id => data.tradeTextZh!.get(id)).find(t => t != null)
  if (text == null) return undefined
  let tpl = tradeTplCache.get(text)
  if (!tpl) tradeTplCache.set(text, (tpl = parseTemplate(text)))
  const picks = new Set<string>()
  for (const values of valueSets) {
    const filled = fillTemplate(tpl, values)
    if (filled != null && results.has(filled)) picks.add(filled)
  }
  return picks.size === 1 ? [...picks][0] : undefined
}

function idKeys (rawId: string): { full: string[], hash: string[] } {
  let id = rawId.startsWith('stat.') ? rawId.slice(5) : rawId
  const full = [id]
  const bar = id.indexOf('|')
  if (bar !== -1) {
    id = id.slice(0, bar)
    full.push(id)
  }
  const dot = id.indexOf('.')
  return { full, hash: dot !== -1 ? [id.slice(dot + 1)] : [] }
}

export function translateModLine (enLine: string, rawId: string | undefined, data: DisplayZhData): { zh: string | undefined, reason: ZhLineReason } {
  if (!rawId) return { zh: undefined, reason: 'no-id' }
  const keys = idKeys(rawId)
  let pairs: StatPair[] | undefined
  for (const k of keys.full) {
    pairs = data.statsByTradeId.get(k)
    if (pairs) break
  }
  if (!pairs) {
    for (const k of keys.hash) {
      pairs = data.statsByHash.get(k)
      if (pairs) break
    }
  }
  if (!pairs?.length) return { zh: undefined, reason: 'unknown-id' }

  const line = normalizeText(enLine)
  let enMatched = false
  const results = new Set<string>()
  const valueSets: string[][] = []
  for (const pair of pairs) {
    const cand = candidatesForPair(line, pair)
    if (cand.enMatched) enMatched = true
    for (const c of cand.out) results.add(c)
    valueSets.push(...cand.valueSets)
  }
  if (!enMatched) return { zh: undefined, reason: 'no-en-match' }
  if (results.size === 0) return { zh: undefined, reason: 'no-zh-variant' }
  if (results.size > 1) {
    const picked = pickByTradeText(results, valueSets, keys.full, data)
    return picked != null ? { zh: picked, reason: 'ok' } : { zh: undefined, reason: 'ambiguous' }
  }
  return { zh: [...results][0], reason: 'ok' }
}

// ---------------------------------------------------------------------------
// 整個浮窗

function uniqueName (data: DisplayZhData, keys: string[]): string | undefined {
  const names = new Set<string>()
  for (const k of keys) for (const n of data.itemNames.get(k) ?? []) names.add(n)
  return names.size === 1 ? [...names][0] : undefined
}

function translateTitle (display: DisplayItem, item: FetchItem, data: DisplayZhData): string[] {
  return display.title.map((t, i) => {
    if (i === 0 && item.name && t === item.name) {
      // 稀有物品名是隨機組字,只有傳奇名是 refName
      return display.rarity === 'Unique' ? (uniqueName(data, [`UNIQUE::${t}`]) ?? t) : t
    }
    if (item.typeLine && t === item.typeLine) {
      // 魔法物品 typeLine 帶詞綴名(≠ baseType),拆不出來 → 保留英文
      if (item.baseType && item.baseType !== item.typeLine) return t
      return uniqueName(data, [`ITEM::${t}`, `GEM::${t}`, `DIVINATION_CARD::${t}`]) ?? t
    }
    return t
  })
}

/** `Evasion Rating: ` / `Item Level: ` → 繁中(冒號與空白照原樣) */
function translateLabel (text: string, data: DisplayZhData): string {
  const m = /^(.*?)(: )?$/.exec(text)
  const name = m?.[1] ?? text
  const zh = data.stringZh?.get(name)
  return zh ? zh + (m?.[2] ?? '') : text
}

function translateClass (name: string, data: DisplayZhData): string {
  const set = data.itemClassZh?.get(name) ?? data.itemClassZh?.get(`${name}s`)
  return set?.size === 1 ? [...set][0] : name
}

function translateRequires (l: DisplayLine, item: FetchItem, data: DisplayZhData): DisplayLine {
  const words = data.requiresZh
  const reqs = item.requirements
  if (!words || !reqs?.length || reqs.length !== (l.values?.length ?? 0)) return l
  const values: NonNullable<DisplayLine['values']> = []
  for (const [i, r] of reqs.entries()) {
    const v = r.values?.[0]?.[0]
    if (v == null) return l
    if (r.type === 62) values.push({ ...l.values![i], text: `${words.level} ${v}` })
    else {
      const w = r.type != null ? words.attrs[r.type] : undefined
      if (!w) return l
      values.push({ ...l.values![i], text: `${v} ${w}` })
    }
  }
  return { ...l, text: `${words.label} `, values }
}

function translateInfoLine (l: DisplayLine, item: FetchItem, data: DisplayZhData): DisplayLine {
  switch (l.key) {
    case 'class': return { ...l, text: translateClass(l.text, data) }
    case 'prop':
    case 'ilvl':
    case 'sockets':
    case 'tag': return { ...l, text: translateLabel(l.text, data) }
    case 'requires': return translateRequires(l, item, data)
    default: return l
  }
}

/**
 * 回傳換成繁中的新 DisplayItem(輸入不變)與每一個詞綴行的結果。對不上的行保留英文。
 */
export function translateDisplayItem (display: DisplayItem, item: FetchItem, data: DisplayZhData): { display: DisplayItem, lines: ZhLineReport[] } {
  const lines: ZhLineReport[] = []
  const info = (list: DisplayLine[] | undefined) => list?.map(l => translateInfoLine(l, item, data))
  const out: DisplayItem = {
    ...display,
    title: translateTitle(display, item, data),
    nameBlock: info(display.nameBlock),
    itemProps: info(display.itemProps),
    itemTags: info(display.itemTags)
  }
  for (const type of MOD_SECTIONS) {
    if (type === 'veiled') continue
    const key = `${type}Mods` as const
    const shown = display[key]
    if (!shown?.length) continue
    out[key] = shown.map((dl, index) => {
      const { zh, reason } = translateModLine(dl.text, dl.tradeId, data)
      lines.push({ type, index, tradeId: dl.tradeId, en: dl.text, zh, reason })
      return zh != null ? { ...dl, text: zh } : dl
    })
  }
  return { display: out, lines }
}

/**
 * `requestResults` 用:符合翻譯條件才回傳轉換函式。**同步**、不擋查價 —— 資料已載好就回函式;
 * 還沒載 → 回 undefined(這次英文)並在背景載入,載好後下一次查價生效。
 */
export function displayZhFor (realm: string): ((display: DisplayItem, item: FetchItem) => DisplayItem) | undefined {
  if (!wantsZh(realm)) return undefined
  const ds = hostSource()
  if (!ds) return undefined
  const data = ready.get(ds)
  if (!data) {
    loadDisplayZhData(ds).catch((e: unknown) => {
      console.error('[trade] PoE1 懸停浮窗繁中資料載入失敗,維持英文(下次查價再試):', e)
    })
    return undefined
  }
  return (display, item) => translateDisplayItem(display, item, data).display
}
