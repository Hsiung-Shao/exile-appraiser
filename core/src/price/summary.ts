/**
 * 掛單價格摘要(2026-10-14 查價面板 B 改版;純函式、不 import Vue / DOM)。
 *
 * - `summarizeListings`:同一單位的價格(掛單已由便宜到貴)→ 筆數 / 最低 / 最高 / 中位;筆數 < `minForMedian` 標 `few`、不給中位。
 * - `summarizeConverted`:混幣別掛單 → 有換算器就全部換成同一單位(換不了的記 `skipped`);一筆都換不了或沒有換算器
 *   → 取筆數最多的原幣別(同數取先出現 = 較便宜那一端)。
 *
 * 原本是 PoE2 符文塑形自動查市集的 `summarizeRuneTrade`(poe2/src/runeshape/trade-lookup.ts),抽出共用後
 * 符文改呼叫這裡,行為逐字不變(`poe2/test/runeshape/trade-lookup.test.ts`)。(查價面板一般物品的「建議售價」價格區曾共用它,2026-10-14 使用者看過實機後移除。)
 */

export interface ListingSummary {
  /** 參與計算的筆數 */
  count: number
  /** 筆數少於 `minForMedian` */
  few: boolean
  min?: number
  max?: number
  /** ≥ `minForMedian` 筆才有 */
  median?: number
}

export interface SummaryOptions {
  /** 只取前 N 筆(預設全部) */
  take?: number
  /** 至少幾筆才給中位數(預設 3) */
  minForMedian?: number
}

export const DEFAULT_MIN_FOR_MEDIAN = 3

function medianOf (xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function summarizeListings (prices: readonly number[], opts: SummaryOptions = {}): ListingSummary {
  const values = opts.take != null ? prices.slice(0, opts.take) : prices
  const minForMedian = opts.minForMedian ?? DEFAULT_MIN_FOR_MEDIAN
  const count = values.length
  const out: ListingSummary = { count, few: count < minForMedian }
  if (count) {
    out.min = Math.min(...values)
    out.max = Math.max(...values)
    if (count >= minForMedian) out.median = medianOf(values)
  }
  return out
}

export interface PricedListing {
  amount: number
  currency: string
}

export interface ConvertedSummary extends ListingSummary {
  /** 換算後的單位(= opts.unit);沒換算時是原幣別 */
  unit: string
  converted: boolean
  /** 幣別換算不了 / 不是主要幣別而沒算進去的筆數 */
  skipped: number
}

export function summarizeConverted (
  listings: readonly PricedListing[],
  toUnit: ((amount: number, currency: string) => number | undefined) | undefined,
  opts: SummaryOptions & { unit: string }
): ConvertedSummary {
  const top = opts.take != null ? listings.slice(0, opts.take) : listings
  let values: number[] = []
  let unit = opts.unit
  let converted = false
  if (toUnit) {
    for (const l of top) {
      const v = toUnit(l.amount, l.currency)
      if (v != null && Number.isFinite(v) && v > 0) values.push(v)
    }
    converted = values.length > 0
  }
  if (!converted) {
    const counts = new Map<string, number>()
    for (const l of top) counts.set(l.currency, (counts.get(l.currency) ?? 0) + 1)
    let best = ''
    let n = 0
    for (const [c, k] of counts) if (k > n) { best = c; n = k }
    unit = best || opts.unit
    values = top.filter((l) => l.currency === best).map((l) => l.amount)
  }
  const s = summarizeListings(values, { minForMedian: opts.minForMedian })
  const out: ConvertedSummary = { unit, converted, count: s.count, few: s.few, skipped: top.length - s.count }
  if (s.min != null) out.min = s.min
  if (s.max != null) out.max = s.max
  if (s.median != null) out.median = s.median
  return out
}
