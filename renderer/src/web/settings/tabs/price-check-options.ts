// 設定 › 查價 的純邏輯選項(給 vitest 測,不碰 .vue)。
import type { Game, Realm } from '@exile-appraiser/core/realm'
import type { CurrencyVolumeSetting } from '../../background/price-trend'

export type ItemHoverMode = 'off' | 'keybind' | 'always'

/** 「滑鼠懸停顯示物品」三選一;值與 Exiled Exchange 2 的 `itemHoverTooltip` 相同。 */
export const HOVER_OPTIONS: ReadonlyArray<{ value: ItemHoverMode, key: string }> = [
  { value: 'off', key: 'ppz.item_hover_off' },
  { value: 'keybind', key: 'ppz.item_hover_keybind' },
  { value: 'always', key: 'ppz.item_hover_always' }
]

/**
 * 第 24 步:「通貨每小時成交量」四選一(查價面板通貨價格區;PoE1 / PoE2 都有)。
 * 值與 Exiled Exchange 2 的 `currencyVolume` 相同(`settings-price-check.vue` 的 None / Currency / Hour / Items / Hour / Both)。
 */
export const CURRENCY_VOLUME_OPTIONS: ReadonlyArray<{ value: CurrencyVolumeSetting, key: string }> = [
  { value: 'none', key: 'ppz.currency_volume_none' },
  { value: 'value', key: 'ppz.currency_volume_value' },
  { value: 'item', key: 'ppz.currency_volume_item' },
  { value: 'both', key: 'ppz.currency_volume_both' }
]

/**
 * 結果列的物品浮窗元件(`TradeItem.vue`):PoE2 移植自 EE2;PoE1 2026-10-15 起也有(`poe1/src/web/price-check/trade/TradeItem.vue`)。
 * 兩代都顯示這個選項;保留函式讓之後若有遊戲沒有浮窗時可再隱藏。
 */
export function hasItemHover (_game: Game): boolean {
  return true
}

/** 第 39 步:「預設價格通貨」只影響 PoE1 的初始搜尋(PoE2 的查價元件不讀這個設定)→ PoE2 不顯示。 */
export function hasDefaultCurrency (game: Game): boolean {
  return game === 'poe1'
}

/** 第 39 步:通貨每小時成交量來自 poe.ninja,只有國際服 → 台服不顯示。 */
export function hasCurrencyVolume (realm: Realm): boolean {
  return realm === 'intl'
}
