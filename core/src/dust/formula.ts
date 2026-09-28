/**
 * 拆粉(Thaumaturgic Dust)數量公式。
 *
 * 逐字移植自 APT `renderer/src/parser/Parser.ts` 的 `calcDisenchantDust`(本 repo `poe1/src/parser/Parser.ts:1720-1749`),
 * 只把 ParsedItem 的欄位換成參數:
 *   dust = floor(disenchantValue × 5 × base(ilvl) × (100 + 50×影響數 + 2×品質 + 50×腐化詞綴數) / 100)
 *   base(ilvl) = 50 + 2×(clamp(ilvl,46,68)−46) + floor(3×(clamp(ilvl,46,68)−46)/11) + 25×(clamp(ilvl,68,84)−68)
 * ⇒ base(46 以下)= 50、base(68)= 100、base(84 以上)= 500;ilvl 84 品質 0 = disenchantValue × 2500,品質 20 = × 3500。
 * 數字與運算順序刻意照抄(含浮點),單件查價(`item.dustEquivalent`)與排行面板才會算出同一個數。
 */

export interface DustFactors {
  /** 物品等級,預設 84(ninja 價格多半是低 ilvl,排行由呼叫端決定) */
  ilvl?: number
  /** 品質 %,預設 0 */
  quality?: number
  /** 勢力數(每種 +50%) */
  influences?: number
  /** 腐化詞綴數(每條 +50%) */
  corruptedMods?: number
}

/** `5 × base(ilvl)`:ilvl 84 以上 = 2500。 */
export function dustIlvlMultiplier (ilvl: number): number {
  const term1 = 50 // ilvl 46 and below
  const term2 = 2 * (Math.min(Math.max(ilvl, 46), 68) - 46) // ilvl 47 to 68
  const term3 = Math.floor(3 * (Math.min(Math.max(ilvl, 46), 68) - 46) / 11) // ilvl 47 to 68
  const term4 = 25 * (Math.min(Math.max(ilvl, 68), 84) - 68) // ilvl 69 to 84
  return 5 * (term1 + term2 + term3 + term4)
}

export function dustAt (disenchantValue: number, factors: DustFactors = {}): number {
  const { ilvl = 84, quality = 0, influences = 0, corruptedMods = 0 } = factors

  let increaseByFactors = 0

  // +50% per Influence Type
  increaseByFactors += influences * 50

  // +2% per 1% Item Quality
  if (quality) {
    increaseByFactors += quality * 2
  }

  // +50% per Corruption Implicit
  increaseByFactors += corruptedMods * 50

  const factorsMulti = (increaseByFactors + 100) / 100
  const term1 = 50 // ilvl 46 and below
  const term2 = 2 * (Math.min(Math.max(ilvl, 46), 68) - 46) // ilvl 47 to 68
  const term3 = Math.floor(3 * (Math.min(Math.max(ilvl, 46), 68) - 46) / 11) // ilvl 47 to 68
  const term4 = 25 * (Math.min(Math.max(ilvl, 68), 84) - 68) // ilvl 69 to 84
  const totalMulti = 5 * (term1 + term2 + term3 + term4) * factorsMulti

  return Math.floor(disenchantValue * totalMulti)
}
