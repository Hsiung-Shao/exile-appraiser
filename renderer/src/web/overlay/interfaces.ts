/**
 * 上游把查價設定放在 overlay 的 widget 設定裡(`PriceCheckWidget extends Widget`)。
 * 本專案沒有 overlay / WidgetManager,只留查價會用到的欄位;移植的元件仍以
 * `AppConfig<PriceCheckWidget>('price-check')` 取用。
 */
export interface PriceCheckWidget {
  showRateLimitState: boolean
  apiLatencySeconds: number
  collapseListings: 'app' | 'api'
  smartInitialSearch: boolean
  lockedInitialSearch: boolean
  activateStockFilter: boolean
  builtinBrowser: boolean
  showSeller: false | 'account' | 'ign'
  searchStatRange: number
  showCursor: boolean
  requestPricePrediction: boolean
  merchantOnly: boolean
  defaultCurrency: string | null
  // ---- PoE2(Exiled Exchange 2 的 PriceCheckWidget 多出的欄位;poe2 package 的 .vue 會讀) ----
  rememberCurrency: boolean
  defaultAllSelected: boolean
  itemHoverTooltip: 'off' | 'keybind' | 'always'
  alwaysShowTier: boolean
  coreCurrency: 'exalted' | 'chaos'
  currencyVolume: 'none' | 'value' | 'item' | 'both'
  rememberListingType: boolean
  initialDelay: number
  /** 依物品類別預填的符文 / 魂核 refName(E 的物品編輯器「記住」功能;parser 經 host-options 讀取) */
  savedAugments: { [key: string]: Array<string | null> }
}
