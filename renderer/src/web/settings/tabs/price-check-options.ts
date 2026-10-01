// 設定 › 查價 的純邏輯選項(給 vitest 測,不碰 .vue)。
import type { Game } from '@exile-appraiser/core/realm'

export type ItemHoverMode = 'off' | 'keybind' | 'always'

/** 「滑鼠懸停顯示物品」三選一;值與 Exiled Exchange 2 的 `itemHoverTooltip` 相同。 */
export const HOVER_OPTIONS: ReadonlyArray<{ value: ItemHoverMode, key: string }> = [
  { value: 'off', key: 'ppz.item_hover_off' },
  { value: 'keybind', key: 'ppz.item_hover_keybind' },
  { value: 'always', key: 'ppz.item_hover_always' }
]

/** 只有 PoE2 的結果列有物品浮窗元件(`TradeItem.vue`);PoE1 沒有,不顯示這個選項。 */
export function hasItemHover (game: Game): boolean {
  return game === 'poe2'
}
