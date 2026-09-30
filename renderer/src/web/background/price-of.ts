/**
 * exile-appraiser(WP-R2):PoE2 通貨類(符文、靈魂核心、未切割寶石、通貨…)以 refName 查 poe.ninja 快照的純函式
 * (`Prices.ts` 的 `priceOf` 用;`renderer/test/runeshape-prices.test.ts` 測)。
 *
 * PoE2 exchange 的名稱就是英文 refName(`Aldur's Legacy`),未切割寶石的名稱帶等級(`Uncut Skill Gem (Level 20)`,
 * 與 items.ndjson 的 refName 相同),所以鍵一律 `currency|<refName>`;另給 `level` 時補上 ` (Level N)`。
 * 只做型別匯入(renderer vitest 沒有別名)。
 */
import type { NinjaSnapshot } from '@exile-appraiser/core/ninja'

export interface PriceOfHit {
  status: 'ok'
  key: string
  chaos: number
  /** 崇高石價;快照沒有 exalted 匯率 → undefined */
  exalted?: number
  /** 神聖石價;沒有 divine 匯率 → undefined */
  divine?: number
  lowConfidence: boolean
  detailsId?: string
}

export type PriceOfResult =
  | PriceOfHit
  /** 台服:poe.ninja 沒有台服價格 */
  | { status: 'no-source' }
  /** 沒選聯盟 / 私人聯盟 */
  | { status: 'no-league' }
  /** 價格表還沒載入 */
  | { status: 'loading' }
  /** 價格表裡沒有這個物品 */
  | { status: 'no-price' }

const LEVEL_SUFFIX = /\s\(Level \d+\)$/

export function runeshapeKeys (refName: string, level?: number): string[] {
  if (level != null && Number.isFinite(level) && !LEVEL_SUFFIX.test(refName)) {
    return [`currency|${refName} (Level ${level})`]
  }
  return [`currency|${refName}`]
}

export function priceFromSnapshot (
  snap: Pick<NinjaSnapshot, 'prices' | 'divineRate' | 'exaltedRate'> | null | undefined,
  refName: string,
  level?: number
): PriceOfHit | null {
  if (!snap) return null
  for (const key of runeshapeKeys(refName, level)) {
    const e = snap.prices[key]
    if (!e || !(e.c > 0)) continue
    const hit: PriceOfHit = { status: 'ok', key, chaos: e.c, lowConfidence: e.lc }
    if (snap.exaltedRate && snap.exaltedRate > 0) hit.exalted = e.c / snap.exaltedRate
    if (snap.divineRate && snap.divineRate > 0) hit.divine = e.c / snap.divineRate
    if (e.id) hit.detailsId = e.id
    return hit
  }
  return null
}
