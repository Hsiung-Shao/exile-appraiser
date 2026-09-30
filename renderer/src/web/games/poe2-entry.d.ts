/**
 * PoE2 adapter 在 renderer 端的型別宣告(執行期實作:poe2/src/renderer-entry.ts,經 Vite alias `@poe2-entry`)。
 *
 * renderer 的 tsconfig 不能直接讀 poe2 原始碼(`@/…` 會被指到 poe1),所以這裡手寫 renderer 真正用到的子集;
 * 與實作的一致性由 poe2/src/renderer-entry.check.ts 在 poe2 的型別檢查裡把關。
 * .vue 元件(`CheckedItem`、`RateLimiterState`)的型別走 env.d.ts 的 `*.vue` 宣告。
 */
import type { DefineComponent } from 'vue'
import type { Result } from 'neverthrow'
import type { DataSource, GameAdapter, PresetOptions, TradeContext } from '@exile-appraiser/core/games/adapter'
import type { Language, Realm } from '@exile-appraiser/core/realm'

/** App.vue 只讀名稱做 log;其餘欄位原樣交給 poe2 的 CheckedItem.vue。 */
export interface Poe2ParsedItem {
  info: { name: string, refName: string }
  /** WP-S:揭露面板 OCR 的 profile 後援(ItemCategory 字串) */
  category?: string
}

// ---- WP-S:靈魂之井揭露面板 OCR(poe2/src/desecration/ocr-match.ts 的子集) ----
export interface Poe2OcrLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}
export interface Poe2RevealLine extends Poe2OcrLine {
  /** null = 對不上任何模板(UI 灰色顯示原文) */
  match: { norm: string } | null
  merged?: boolean
}
export type Poe2DesecrationPool = 'normal' | 'desecration_exclusive' | 'desecration_exclusive_jewel'
export interface Poe2RevealCandidate {
  tier?: number
  tierRange: [number, number]
  pool: Poe2DesecrationPool
  gods?: string[]
  ranges: Array<[number, number] | null>
  fuzzy: boolean
  entryIds: string[]
}
export interface Poe2RevealGroup {
  lines: Poe2RevealLine[]
  rect: { x: number, y: number, w: number, h: number }
  candidates: Poe2RevealCandidate[]
  partial: boolean
}
export type Poe2RevealResult =
  | { ok: true, groups: Poe2RevealGroup[], profileExact: boolean, profileSource: 'refName' | 'category' | 'intersection' | 'all' }
  | { ok: false, error: 'no-panel', lines: Poe2RevealLine[] }
export type Poe2Translate = (key: string, args?: unknown) => string

export interface Poe2HostOptions {
  language: string
  savedAugments: { [key: string]: Array<string | null> }
  searchStatRange: number
}

/** 一鍵回報只需要 id 與 filters/stats 能原樣交回 createTradeRequest。 */
export interface Poe2FilterPreset {
  id: string
}

/**
 * 一鍵回報(report.ts)用:以預設篩選重算查詢 JSON。
 * 用 method 語法宣告(參數雙變),實作收的是完整的 poe2 ParsedItem / FilterPreset,這裡只認子集。
 */
export interface Poe2ReportFns {
  createPresets (item: Poe2ParsedItem, opts: PresetOptions & { defaultAllSelected?: boolean }): { presets: Poe2FilterPreset[], active: string }
  createTradeRequest (preset: Poe2FilterPreset, item: Poe2ParsedItem): unknown
}

export declare const poe2Adapter: Pick<GameAdapter, 'id' | 'loadData'>
export declare function browserDataSource (baseUrl: string): DataSource
export declare function setTradeContextProvider (provider: () => TradeContext): void
export declare function setHostOptionsProvider (next: (() => Partial<Poe2HostOptions>) | undefined): void
export declare function parseClipboard (clipboard: string): Result<Poe2ParsedItem, string>
export declare const CheckedItem: DefineComponent<{}, {}, any>
export declare const RateLimiterState: DefineComponent<{}, {}, any>
export declare const createPresets: Poe2ReportFns['createPresets']
export declare const createTradeRequest: Poe2ReportFns['createTradeRequest']
/** 資料沒載入(不是 PoE2 / 舊安裝缺檔)→ undefined */
export declare function matchRevealLines (lines: Poe2OcrLine[], opts?: { refName?: string, category?: string }): Poe2RevealResult | undefined
export declare function revealPoolLabel (c: { pool: Poe2DesecrationPool, gods?: string[] }, t: Poe2Translate): string
export declare function revealRangeLabel (ranges: Array<[number, number] | null>): string

// ---- WP-R2:符文塑形面板 OCR 列 → refName / poe.ninja 鍵(poe2/src/runeshape/match.ts;規則見 docs/runeshape.md) ----
export interface Poe2RuneshapeMatchRow extends Poe2OcrLine {
  kind: 'gem' | 'skill' | 'support' | 'item' | 'recipe'
  norm: string
  refName?: string
  level?: number
  quantity: number
  match: 'exact' | 'fuzzy' | null
  similarity?: number
  ambiguous?: string[]
  category?: string
  ninjaKey?: string | null
  unpriced?: 'gem' | 'recipe'
  recipeId?: string
  offPanel?: boolean
  /** 目前語系 items.ndjson 的名稱(台服交易站查詢用) */
  name?: string
  /** 可堆疊物品的交易站 bulk tag */
  tradeTag?: string
}
export declare function matchRunesRows (lines: Poe2OcrLine[]): Poe2RuneshapeMatchRow[]

// ---- 符文塑形點選查交易站(poe2/src/runeshape/trade-lookup.ts;docs/runeshape.md「點選查交易站」) ----
export type Poe2RuneTradeRowInput = Pick<Poe2RuneshapeMatchRow, 'kind' | 'refName' | 'name' | 'level' | 'tradeTag' | 'ambiguous' | 'offPanel'>
export type Poe2RuneTradeFilter =
  | { id: 'realm', value: Realm }
  | { id: 'league', value: string }
  | { id: 'mode', value: 'search' | 'bulk' }
  | { id: 'type', value: string }
  | { id: 'category', value: 'gem' }
  | { id: 'gem_level', value: number }
  | { id: 'gem_level_any' }
  | { id: 'corrupted', value: false }
  | { id: 'quality', value: 0 }
  | { id: 'want', value: string }
  | { id: 'have', value: string[] }
  | { id: 'status', value: 'securable' | 'online' }
export type Poe2RuneTradeUnavailable = 'recipe' | 'ambiguous' | 'no-ref' | 'off-panel' | 'no-name'
/** 查詢計畫(renderer 只讀這些欄位;search body / bulk 參數原樣交回 store) */
export interface Poe2RuneTradePlan {
  mode: 'search' | 'bulk'
  key: string
  realm: Realm
  league: string
  filters: Poe2RuneTradeFilter[]
  levelAny: boolean
  webUrl: string
}
export interface Poe2RuneTradeListing { amount: number, currency: string }
export interface Poe2RuneTradeRaw {
  key: string
  mode: 'search' | 'bulk'
  queryId?: string
  total: number
  listings: Poe2RuneTradeListing[]
  webUrl: string
  at: number
}
export interface Poe2RuneTradeSummary {
  unit: string
  converted: boolean
  count: number
  median?: number
  min?: number
  max?: number
  few: boolean
  skipped: number
}
export type Poe2RuneTradeOutcome =
  | { ok: true, raw: Poe2RuneTradeRaw, cached: boolean }
  | { ok: false, error: 'busy' }
  | { ok: false, error: 'rate-limited', seconds: number }
  | { ok: false, error: 'failed', message: string }
/** method 語法(參數雙變):實作收完整的 plan 聯集 */
export interface Poe2RuneTradeStore {
  lookup (plan: Poe2RuneTradePlan): Promise<Poe2RuneTradeOutcome>
  cached (key: string): Poe2RuneTradeRaw | undefined
  readonly busy: boolean
}
export declare function runeTradeUnavailable (row: Poe2RuneTradeRowInput, opts?: { realm: Realm, language: Language }): Poe2RuneTradeUnavailable | null
export declare function planRuneTradeQuery (row: Poe2RuneTradeRowInput, opts: { realm: Realm, language: Language, league: string }):
  { ok: true, plan: Poe2RuneTradePlan } | { ok: false, reason: Poe2RuneTradeUnavailable }
export declare function summarizeRuneTrade (listings: readonly Poe2RuneTradeListing[], toExalted?: (amount: number, currency: string) => number | undefined): Poe2RuneTradeSummary
export declare const runeTradeStore: Poe2RuneTradeStore
