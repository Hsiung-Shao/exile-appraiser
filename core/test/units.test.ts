// 第 24 步:poe.ninja chaos 價 → 顯示單位(PoE1 照 APT、PoE2 崇高石 / 神聖石)
import { describe, expect, it } from 'vitest'
import { autoCurrencyPoe1, autoCurrencyPoe2 } from '../src/ninja'

describe('autoCurrencyPoe1(APT autoCurrency 逐條)', () => {
  it('單值:≤ 0.94 div chaos;0.94–1.06 div 顯示 1 div;> 1.06 div 換算', () => {
    expect(autoCurrencyPoe1(188, { divineRate: 200 })).toEqual({ min: 188, max: 188, currency: 'chaos' })
    expect(autoCurrencyPoe1(189, { divineRate: 200 })).toEqual({ min: 1, max: 1, currency: 'div' })
    expect(autoCurrencyPoe1(211, { divineRate: 200 })).toEqual({ min: 1, max: 1, currency: 'div' })
    expect(autoCurrencyPoe1(212, { divineRate: 200 })).toEqual({ min: 1.06, max: 1.06, currency: 'div' })
  })
  it('區間:上限 > 1 div 整段換 div;沒有匯率當 9999', () => {
    expect(autoCurrencyPoe1([100, 200], { divineRate: 200 })).toEqual({ min: 100, max: 200, currency: 'chaos' })
    expect(autoCurrencyPoe1([100, 201], { divineRate: 200 })).toEqual({ min: 0.5, max: 1.005, currency: 'div' })
    expect(autoCurrencyPoe1(9000, { divineRate: null })).toEqual({ min: 9000, max: 9000, currency: 'chaos' })
    expect(autoCurrencyPoe1(9500, {}).currency).toBe('div')
  })
})

describe('autoCurrencyPoe2(與符文塑形徽章 pickUnit 同規則)', () => {
  const r = { divineRate: 10, exaltedRate: 0.02 }
  it('≥ 1 div → div;否則 exalted;區間看下限', () => {
    expect(autoCurrencyPoe2(10, r)).toEqual({ min: 1, max: 1, currency: 'div' })
    expect(autoCurrencyPoe2(9.99, r).currency).toBe('exalted')
    expect(autoCurrencyPoe2(9.99, r).min).toBeCloseTo(499.5, 9)
    expect(autoCurrencyPoe2([5, 20], r)).toEqual({ min: 250, max: 1000, currency: 'exalted' })
    expect(autoCurrencyPoe2([10, 20], r)).toEqual({ min: 1, max: 2, currency: 'div' })
  })
  it('coreOnly 不換 div;沒有 exalted 匯率 → chaos;匯率非正數視為沒有', () => {
    expect(autoCurrencyPoe2(100, r, { coreOnly: true })).toEqual({ min: 5000, max: 5000, currency: 'exalted' })
    expect(autoCurrencyPoe2(5, { divineRate: 10 })).toEqual({ min: 5, max: 5, currency: 'chaos' })
    expect(autoCurrencyPoe2(50, { divineRate: 0, exaltedRate: -1 })).toEqual({ min: 50, max: 50, currency: 'chaos' })
  })
})
