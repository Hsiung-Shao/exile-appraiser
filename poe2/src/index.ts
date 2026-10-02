/**
 * PoE2 adapter 對外入口(比照 poe1/src/index.ts)。
 *
 * 底下的 parser / filters / trade 是逐檔移植自 Exiled-Exchange-2-zh-TW(ee2-patched)的程式碼,
 * 這個檔案只做兩件事:
 * 1. 把「realm + 客戶端語言」翻成上游需要的 `useEn` 等參數;
 * 2. 把上游散在 Vue composable(trade-api.ts / bulk-api.ts)與 .vue 裡的流程
 *    (search → fetch 10+10、bulk 的 have 選擇、網頁網址)收成純函式,讓 CLI、測試與 UI 走同一條路。
 */
import type { DataSource, GameAdapter, ItemTextLanguage, ParseFailure, ParseResult, PresetOptions, TradeContext } from '@exile-appraiser/core/games/adapter'
import { tradeWebBase, useEnglishNames, type Language, type Realm } from '@exile-appraiser/core/realm'
import { chooseParseLanguage, detectItemTextLanguage, markersFromClientStrings, type LanguageMarkers } from '@exile-appraiser/core/realm/item-language'
import { init, loadForLang, configureDataSource, activateLangData, clientStringsFor, LOADED_DATA } from '@/assets/data'
import { parseClipboard as upstreamParse } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { setHostOptions } from '@/parser/host-options'
import { createPresets as upstreamCreatePresets } from '@/web/price-check/filters/create-presets'
import type { FilterPreset, ItemFilters, StatFilter } from '@/web/price-check/filters/interfaces'
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

export type { ParsedItem, FilterPreset, ItemFilters, StatFilter, PricingResult, SearchResult, BulkSearch }
// nodeDataSource 刻意不從這裡 re-export:它 import node:fs,會被打進瀏覽器 bundle。CLI/測試直接 import '@/assets/data/node-source'。
export { browserDataSource } from '@/assets/data/browser-source'
export { resetTradeSessions, tradeSession, setTradeContextProvider } from '@/web/price-check/trade/common'
export { searchUrl, fetchUrl } from '@/web/price-check/trade/pathofexile-trade'
export { exchangeUrl } from '@/web/price-check/trade/pathofexile-bulk'
export { setHostOptions, setHostOptionsProvider, type HostOptions } from '@/parser/host-options'
export { configureTradeDataLoader, snapshotTradeDataLoader, type TradeDataLoader } from '@/web/background/TradeData'

export type Poe2TradeRequest = ReturnType<typeof upstreamCreateTradeRequest>

/** PoE2 多兩個上游選項(E 的 PriceCheckWidget 設定);不給就用上游預設。 */
export interface Poe2PresetOptions extends PresetOptions {
  listingType?: 'securable' | 'any' | 'online' | 'available' | 'onlineleague'
  defaultAllSelected?: boolean
}

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
    // magic-name / 錯語系提示讀的語言 = 目前資料集的語系
    setHostOptions({ language: lang })
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
      console.error(`[poe2] 讀取 ${l} client_strings 失敗,查價時不會自動判斷這個語言:`, e)
    }
  }
  return out
}

/** 第 27 步:物品文字的語言(判斷不出 = undefined)。 */
export function detectItemLanguage (text: string): Language | undefined {
  return detectItemTextLanguage(text, markers)
}

/**
 * 第 27 步:解析前依 realm + 文字語言換好資料集(見 GameAdapter.prepareItemText)。
 * host 選項的 `language`(magic-name、錯語系提示)跟著換成實際解析的語系。
 */
export async function prepareItemText (text: string, realm: Realm): Promise<ItemTextLanguage> {
  return await serial(async () => {
    const clientLanguage = loadedLang
    const detected = detectItemLanguage(text)
    if (clientLanguage === undefined) return { detected, lang: detected ?? 'cmn-Hant' }
    const lang = chooseParseLanguage(realm, clientLanguage, detected)
    await activateLangData(lang)
    setHostOptions({ language: lang })
    return { detected, lang, clientLanguage }
  })
}

/** 第 27 步:目前資料集的語系。 */
export function dataLanguage (): Language | undefined {
  return LOADED_DATA?.lang as Language | undefined
}

function parseClipboard (text: string): ParseResult<ParsedItem> | ParseFailure {
  const result = upstreamParse(text)
  if (result.isErr()) return { ok: false, error: result.error }
  const item = result.value
  return { ok: true, item, unknownModifiers: item.unknownModifiers.map(m => m.text) }
}

/** 上游 `createPresets` 的參數 + 由 realm 推導的 `useEn`(= E CheckedItem.vue 的 `cmn-Hant && pc-ggg || www`)。 */
export function toUpstreamPresetOptions (opts: Poe2PresetOptions) {
  return {
    league: opts.league,
    currency: opts.currency ?? undefined,
    listingType: opts.listingType,
    collapseListings: opts.collapseListings,
    activateStockFilter: opts.activateStockFilter,
    searchStatRange: opts.searchStatRange,
    useEn: useEnglishNames(opts.realm, opts.clientLanguage),
    defaultAllSelected: opts.defaultAllSelected ?? false
  }
}

export function createPresets (item: ParsedItem, opts: Poe2PresetOptions): { presets: FilterPreset[], active: string } {
  return upstreamCreatePresets(item, toUpstreamPresetOptions(opts))
}

export function createTradeRequest (preset: FilterPreset, item: ParsedItem): Poe2TradeRequest {
  return upstreamCreateTradeRequest(preset.filters, preset.stats, item)
}

export function apiToSatisfySearch (item: ParsedItem, preset: FilterPreset): 'trade' | 'bulk' {
  return upstreamApiToSatisfySearch(item, preset.stats, preset.filters)
}

/**
 * 給玩家開的網頁:有搜尋 id 就用 id,否則把整個 query 放進 `?q=`(⚠ 上游 E 的 CheckedItem.vue 沒 encode,這裡有)。
 * PoE2 網址多一段 `/poe2/`:`/trade2/search/poe2/{league}/{id}`。
 */
export function webSearchUrl (realm: Realm, league: string, request: Poe2TradeRequest, searchId?: string): string {
  const base = tradeWebBase(realm, 'poe2', 'search', league)
  return searchId ? `${base}/${searchId}` : `${base}?q=${encodeURIComponent(JSON.stringify(request))}`
}

export function webExchangeUrl (realm: Realm, league: string, searchId?: string): string {
  const base = tradeWebBase(realm, 'poe2', 'exchange', league)
  return searchId ? `${base}/${searchId}` : base
}

/** 上游 bulk-api.ts 的規則:賽季初定價常錯,查某種基礎通貨時不用它自己計價。 */
export function bulkHaveCurrencies (item: ParsedItem): string[] {
  switch (item.info.refName) {
    case 'Exalted Orb': return ['divine', 'chaos']
    case 'Chaos Orb': return ['divine', 'exalted']
    case 'Divine Orb': return ['exalted', 'chaos']
    default: return ['divine', 'exalted', 'chaos']
  }
}

export interface SearchProgress {
  /** 搜尋回來(有 id、總筆數)但尚未抓明細。 */
  onSearch?: (result: SearchResult) => void
  /** 每批(10 筆)明細到達。 */
  onBatch?: (results: PricingResult[]) => void
}

/**
 * 上游 trade-api.ts `useTradeApi().search` 的流程:search → 前兩批 10 筆並行(順序保證)→ 之後依需求續抓。
 * 這裡固定抓到 `maxResults`(預設 20)為止;UI 續抓用 `requestResults`。
 */
export async function searchPrices (
  ctx: TradeContext,
  preset: FilterPreset,
  item: ParsedItem,
  progress: SearchProgress = {},
  maxResults = 20
): Promise<{ search: SearchResult, request: Poe2TradeRequest, results: PricingResult[] }> {
  const request = createTradeRequest(preset, item)
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

export const poe2Adapter: GameAdapter<ParsedItem, FilterPreset, Poe2TradeRequest> = {
  id: 'poe2',
  loadData,
  prepareItemText,
  dataLanguage,
  parseClipboard,
  createPresets: (item, opts) => createPresets(item, opts).presets,
  createTradeRequest,
  apiToSatisfySearch,
  webSearchUrl: (realm, league, request) => webSearchUrl(realm, league, request)
}
