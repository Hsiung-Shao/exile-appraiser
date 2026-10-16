/**
 * 上游把查價設定放在 overlay 的 widget 設定裡(`PriceCheckWidget extends Widget`)。
 * 本專案沒有 overlay / WidgetManager,只留查價會用到的欄位;移植的元件仍以
 * `AppConfig<PriceCheckWidget>('price-check')` 取用。
 */
import type { ListingLayout } from '../price-panel/listing-layout'

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
  /** 查價面板 B 改版 P4(2026-10-14):掛單顯示方式,一般物品 / 通貨分開記(預設 item 方塊、bulk 長條) */
  listingLayout: ListingLayout
  /** 2026-10-16:查價面板「機制」開關(預設關 = 只有非一般模式的列顯示機制按鈕) */
  showMechanism: boolean
}
