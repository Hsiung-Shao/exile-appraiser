/**
 * 第 24 步:poe.ninja 價格(一律以 chaos 存)→ 顯示單位的純函式。
 *
 * - PoE1(APT `autoCurrency` 逐條):區間 → 上限 > 1 div 就整段換 div,否則 chaos;
 *   單值 → > 0.94 div 換 div(0.94–1.06 div 直接顯示 1 div),否則 chaos。
 * - PoE2(與符文塑形徽章 `runeshape-view.ts` `pickUnit` 同一規則):≥ 1 div → div;否則有 exalted 匯率 → exalted;
 *   都沒有 → chaos。區間以下限判斷(整段同一單位)。`coreOnly` = 不換 div(上游 EE2 查 Divine Orb 本身時用)。
 *
 * 匯率參數都是「1 X = 幾 chaos」(快照的 `divineRate` / `exaltedRate`)。
 */
import type { NinjaGame } from './client'

export type PriceUnit = 'chaos' | 'exalted' | 'div'

export interface PriceValue<U extends string = PriceUnit> {
  min: number
  max: number
  currency: U
}

export interface ChaosRates {
  /** 1 divine = 幾 chaos */
  divineRate?: number | null
  /** 1 exalted = 幾 chaos(PoE2) */
  exaltedRate?: number | null
}

function pos (n: number | null | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}

/** PoE1:APT `autoCurrency`(沒有 divine 匯率時照上游用 9999 當分界 = 實際上一律 chaos)。 */
export function autoCurrencyPoe1 (value: number | [number, number], rates: ChaosRates): PriceValue<'chaos' | 'div'> {
  const div = pos(rates.divineRate) ?? 9999
  if (Array.isArray(value)) {
    if (value[1] > div) return { min: value[0] / div, max: value[1] / div, currency: 'div' }
    return { min: value[0], max: value[1], currency: 'chaos' }
  }
  if (value > div * 0.94) {
    if (value < div * 1.06) return { min: 1, max: 1, currency: 'div' }
    return { min: value / div, max: value / div, currency: 'div' }
  }
  return { min: value, max: value, currency: 'chaos' }
}

/** PoE2:≥ 1 div → div,否則 exalted(有匯率)/ chaos。 */
export function autoCurrencyPoe2 (value: number | [number, number], rates: ChaosRates, opts: { coreOnly?: boolean } = {}): PriceValue {
  const [lo, hi] = Array.isArray(value) ? value : [value, value]
  const div = pos(rates.divineRate)
  const ex = pos(rates.exaltedRate)
  if (div && !opts.coreOnly && lo / div >= 1) return { min: lo / div, max: hi / div, currency: 'div' }
  if (ex) return { min: lo / ex, max: hi / ex, currency: 'exalted' }
  return { min: lo, max: hi, currency: 'chaos' }
}

export function autoCurrencyFor (game: NinjaGame, value: number | [number, number], rates: ChaosRates, opts: { coreOnly?: boolean } = {}): PriceValue {
  return game === 'poe2' ? autoCurrencyPoe2(value, rates, opts) : autoCurrencyPoe1(value, rates)
}
