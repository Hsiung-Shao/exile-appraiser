/**
 * exile-appraiser(2026-10-14 查價面板 B 改版):PoE1 一般物品價格區(renderer `price-panel/PriceHero.vue`)的換算器。
 * 掛單原幣(交易站幣別 id:`chaos` / `divine` / `exalted` / `alch`…)→ chaos。
 * 不 import renderer(poe1 的 tsc 看不到 `@/web/background/Prices`):匯率與單價由 `CheckedItem.vue` 傳進來。
 */
import { ITEMS_ITERATOR } from '@/assets/data'

const refByTag = new Map<string, string>()

/** 交易站幣別 id → 英文 refName(items.ndjson 的 `tradeTag`);找不到 → undefined(不快取,資料可能還沒載入) */
export function refNameOfTradeTag (tag: string): string | undefined {
  const hit = refByTag.get(tag)
  if (hit) return hit
  for (const item of ITEMS_ITERATOR(`"tradeTag":${JSON.stringify(tag)}`)) {
    if (item.tradeTag === tag) {
      refByTag.set(tag, item.refName)
      return item.refName
    }
  }
  return undefined
}

/**
 * @param divineRate 1 divine = 幾 chaos(poe.ninja);沒有 = 沒有價格表(台服等)→ 不給換算器,摘要改用原幣別
 * @param chaosOfRef 物品 refName → poe.ninja chaos 單價
 */
export function poe1ToChaos (
  divineRate: number | undefined,
  chaosOfRef: (refName: string) => number | undefined
): ((amount: number, currency: string) => number | undefined) | undefined {
  if (!divineRate || !(divineRate > 0)) return undefined
  return (amount, currency) => {
    if (currency === 'chaos') return amount
    if (currency === 'divine') return amount * divineRate
    const ref = refNameOfTradeTag(currency)
    const unit = ref != null ? chaosOfRef(ref) : undefined
    return unit != null ? amount * unit : undefined
  }
}
