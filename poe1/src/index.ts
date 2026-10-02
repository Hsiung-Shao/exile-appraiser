/**
 * PoE1 adapter 對外入口。
 *
 * 底下的 parser / filters / trade 是逐檔移植自 awakened-poe-trade-zh-TW 的程式碼,
 * 這個檔案只做兩件事:
 * 1. 把「realm + 客戶端語言」翻成上游需要的 `useEn` 等參數;
 * 2. 把上游散在 Vue 元件裡的流程(search → fetch 10+10、bulk 的 have 選擇、網頁網址)
 *    收成純函式,讓 CLI、測試與 UI 走同一條路。
 */
import type { DataSource, GameAdapter, ItemTextLanguage, ParseFailure, ParseResult, PresetOptions, TradeContext } from '@exile-appraiser/core/games/adapter'
import { REALMS, useEnglishNames, type Language, type Realm } from '@exile-appraiser/core/realm'
import { chooseParseLanguage, detectItemTextLanguage, markersFromClientStrings, type LanguageMarkers } from '@exile-appraiser/core/realm/item-language'
import { init, loadForLang, configureDataSource, activateLangData, clientStringsFor, ACTIVE_LANG } from '@/assets/data'
import { parseClipboard as upstreamParse } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { createPresets as upstreamCreatePresets } from '@/web/price-check/filters/create-presets'
import type { FilterPreset, ItemFilters, FilterOrGroup } from '@/web/price-check/filters/interfaces'
import { apiToSatisfySearch as upstreamApiToSatisfySearch } from '@/web/price-check/trade/common'
import {
  createTradeRequest as upstreamCreateTradeRequest,
  requestTradeResultList,
  requestResults,
  type PricingResult,
  type SearchResult
} from '@/web/price-check/trade/pathofexile-trade'
import {
  createTradeRequest as createBulkRequest,
  execBulkSearch,
  type BulkSearch
} from '@/web/price-check/trade/pathofexile-bulk'

export type { ParsedItem, FilterPreset, ItemFilters, FilterOrGroup, PricingResult, SearchResult, BulkSearch }
// nodeDataSource 刻意不從這裡 re-export:它 import node:fs,會被打進瀏覽器 bundle。CLI/測試直接 import '@/assets/data/node-source'。
export { browserDataSource } from '@/assets/data/browser-source'
export { resetTradeSessions, tradeSession } from '@/web/price-check/trade/common'
export { searchUrl, fetchUrl } from '@/web/price-check/trade/pathofexile-trade'
export { exchangeUrl } from '@/web/price-check/trade/pathofexile-bulk'

export type Poe1TradeRequest = ReturnType<typeof upstreamCreateTradeRequest>

/** 客戶端語言(`loadData` 載入的那一套)。 */
let loadedLang: Language | undefined
/** 第 27 步:各語系複製文字的名牌區標頭(取自各自的 client_strings),語言判斷用。 */
let markers: LanguageMarkers = {}
const LANGUAGES: Language[] = ['cmn-Hant', 'en']

/** 第 27 步:載入 / 換語系一律排隊(資料是模組層級全域,兩個載入交錯會留下半套)。 */
let queue: Promise<unknown> = Promise.resolve()
function serial<T> (fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

async function loadData (source: DataSource, lang: Language): Promise<void> {
  return await serial(async () => {
    if (loadedLang === undefined) {
      configureDataSource(source)
      await init(lang)
    } else if (loadedLang !== lang) {
      configureDataSource(source)
      await loadForLang(lang)
    } else {
      // 同語系(切遊戲回來):沿用原本的 DataSource,兩套快取才不會因來源換了而作廢;
      // 換回客戶端語言那一套(上一件可能是另一語言的物品)
      await activateLangData(lang)
    }
    loadedLang = lang
    markers = await loadMarkers()
  })
}

async function loadMarkers (): Promise<LanguageMarkers> {
  const out: LanguageMarkers = {}
  for (const l of LANGUAGES) {
    try {
      const m = markersFromClientStrings(await clientStringsFor(l))
      if (m) out[l] = m
    } catch (e) {
      console.error(`[poe1] 讀取 ${l} client_strings 失敗,查價時不會自動判斷這個語言:`, e)
    }
  }
  return out
}

/** 第 27 步:物品文字的語言(判斷不出 = undefined)。 */
export function detectItemLanguage (text: string): Language | undefined {
  return detectItemTextLanguage(text, markers)
}

/** 第 27 步:解析前依 realm + 文字語言換好資料集(見 GameAdapter.prepareItemText)。 */
export async function prepareItemText (text: string, realm: Realm): Promise<ItemTextLanguage> {
  return await serial(async () => {
    const clientLanguage = loadedLang
    const detected = detectItemLanguage(text)
    if (clientLanguage === undefined) return { detected, lang: detected ?? 'cmn-Hant' }
    const lang = chooseParseLanguage(realm, clientLanguage, detected)
    await activateLangData(lang)
    return { detected, lang, clientLanguage }
  })
}

/** 第 27 步:目前資料集的語系。 */
export function dataLanguage (): Language | undefined {
  return ACTIVE_LANG as Language | undefined
}

function parseClipboard (text: string): ParseResult<ParsedItem> | ParseFailure {
  const result = upstreamParse(text)
  if (result.isErr()) return { ok: false, error: result.error }
  const item = result.value
  return { ok: true, item, unknownModifiers: item.unknownModifiers.map(m => m.text) }
}

/** 上游 `createPresets` 的參數 + 由 realm 推導的 `useEn`。 */
export function toUpstreamPresetOptions (opts: PresetOptions) {
  return {
    league: opts.league,
    merchantOnly: opts.merchantOnly,
    collapseListings: opts.collapseListings,
    activateStockFilter: opts.activateStockFilter,
    searchStatRange: opts.searchStatRange,
    currency: opts.currency,
    useEn: useEnglishNames(opts.realm, opts.clientLanguage)
  }
}

export function createPresets (item: ParsedItem, opts: PresetOptions): { presets: FilterPreset[], active: string } {
  return upstreamCreatePresets(item, toUpstreamPresetOptions(opts))
}

export function createTradeRequest (preset: FilterPreset): Poe1TradeRequest {
  return upstreamCreateTradeRequest(preset.filters, preset.stats)
}

export function apiToSatisfySearch (item: ParsedItem, preset: FilterPreset): 'trade' | 'bulk' {
  return upstreamApiToSatisfySearch(item, preset.stats, preset.filters)
}

/** 給玩家開的網頁:有搜尋 id 就用 id,否則把整個 query 放進 `?q=`(⚠ 上游沒 encode,這裡有)。 */
export function webSearchUrl (realm: Realm, league: string, request: Poe1TradeRequest, searchId?: string): string {
  const base = `https://${REALMS[realm].host}/trade/search/${encodeURIComponent(league)}`
  return searchId ? `${base}/${searchId}` : `${base}?q=${encodeURIComponent(JSON.stringify(request))}`
}

export function webExchangeUrl (realm: Realm, league: string, searchId?: string): string {
  const base = `https://${REALMS[realm].host}/trade/exchange/${encodeURIComponent(league)}`
  return searchId ? `${base}/${searchId}` : base
}

/** 上游 TradeBulk.vue 的規則:賽季初混沌/神聖定價常錯,查混沌石只用神聖石計價,反之亦然。 */
export function bulkHaveCurrencies (item: ParsedItem): string[] {
  if (item.info.refName === 'Chaos Orb') return ['divine']
  if (item.info.refName === 'Divine Orb') return ['chaos']
  return ['divine', 'chaos']
}

export interface SearchProgress {
  /** 搜尋回來(有 id、總筆數)但尚未抓明細。 */
  onSearch?: (result: SearchResult) => void
  /** 每批(10 筆)明細到達。 */
  onBatch?: (results: PricingResult[]) => void
}

/**
 * 上游 TradeListing.vue 的流程:search → 前兩批 10 筆並行(順序保證)→ 之後依需求續抓。
 * 這裡固定抓到 `maxResults`(預設 20)為止;UI 需要「再多一點」時再呼叫 `requestResults` 續抓。
 */
export async function searchPrices (
  ctx: TradeContext,
  preset: FilterPreset,
  progress: SearchProgress = {},
  maxResults = 20
): Promise<{ search: SearchResult, request: Poe1TradeRequest, results: PricingResult[] }> {
  const request = createTradeRequest(preset)
  const search = await requestTradeResultList(ctx, request, preset.filters.trade.league)
  progress.onSearch?.(search)

  const results: PricingResult[] = []
  const ids = search.result.slice(0, maxResults)
  const r1 = ids.length > 0
    ? requestResults(ctx, search.id, ids.slice(0, 10)).then(r => { results.push(...r); progress.onBatch?.(r) })
    : Promise.resolve()
  const r2 = ids.length > 10
    ? requestResults(ctx, search.id, ids.slice(10, 20)).then(r => r1.then(() => { results.push(...r); progress.onBatch?.(r) }))
    : Promise.resolve()
  await Promise.all([r1, r2])
  return { search, request, results }
}

export async function bulkPrices (
  ctx: TradeContext,
  item: ParsedItem,
  filters: ItemFilters
): Promise<{ have: string[], request: ReturnType<typeof createBulkRequest>, results: Array<BulkSearch | null> }> {
  const have = bulkHaveCurrencies(item)
  const request = createBulkRequest(filters, item, have)
  const results = await execBulkSearch(ctx, item, filters, have)
  return { have, request, results }
}

export const poe1Adapter: GameAdapter<ParsedItem, FilterPreset, Poe1TradeRequest> = {
  id: 'poe1',
  loadData,
  prepareItemText,
  dataLanguage,
  parseClipboard,
  createPresets: (item, opts) => createPresets(item, opts).presets,
  createTradeRequest,
  apiToSatisfySearch,
  webSearchUrl: (realm, league, request) => webSearchUrl(realm, league, request)
}
