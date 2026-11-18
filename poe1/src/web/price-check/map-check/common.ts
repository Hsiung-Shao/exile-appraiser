// exile-appraiser:移植自 Awakened PoE Trade(MIT,© Alexander Drozdov)。
// 2026-11-18 起地圖詞綴檢查改依正則書籤上色(renderer `web/map-check-bookmark.ts`),上游 `map-check/common.ts` 的
// 標記 / 設定檔 / 過時判斷都不需要了;這裡只留上游 `item-check/WidgetItemCheck.vue` 的 `isMapLike`(適用物品)。
import { ItemCategory, ItemRarity, type ParsedItem } from '@/parser'

export function isMapLike (item: ParsedItem): boolean {
  const { category, rarity, info: { refName } } = item
  return (
    (category === ItemCategory.Map && rarity !== ItemRarity.Unique) ||
    category === ItemCategory.HeistContract ||
    category === ItemCategory.HeistBlueprint ||
    category === ItemCategory.Invitation ||
    category === ItemCategory.Chart ||
    refName === 'Expedition Logbook')
}
