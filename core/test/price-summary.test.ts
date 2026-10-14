// P2(查價面板 B 改版):掛單價格摘要純函式(建議售價 / 最低 / 中位 / 符合;符文塑形自動查市集共用)
import { describe, expect, it } from 'vitest'
import { summarizeConverted, summarizeListings } from '../src/price/summary'

describe('summarizeListings(單一單位的價格清單)', () => {
  it('0 筆:筆數 0、標少、沒有最低與中位', () => {
    expect(summarizeListings([])).toEqual({ count: 0, few: true })
  })
  it('1 筆:最低 = 最高 = 該價、沒有中位、標少', () => {
    expect(summarizeListings([7])).toEqual({ count: 1, few: true, min: 7, max: 7 })
  })
  it('2 筆:仍標少、沒有中位', () => {
    expect(summarizeListings([9, 5])).toEqual({ count: 2, few: true, min: 5, max: 9 })
  })
  it('3 筆:不標少,中位取排序後中間那筆', () => {
    expect(summarizeListings([3, 1, 2])).toEqual({ count: 3, few: false, min: 1, max: 3, median: 2 })
  })
  it('偶數筆:中位取中間兩筆平均', () => {
    expect(summarizeListings([1, 2, 3, 10]).median).toBe(2.5)
  })
  it('take 只取前 N 筆(掛單已由便宜到貴)', () => {
    expect(summarizeListings([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1000, 1000], { take: 10 })).toMatchObject({ count: 10, median: 5.5, max: 10 })
  })
  it('minForMedian 可調:設 1 時 1 筆也有中位且不標少', () => {
    expect(summarizeListings([4], { minForMedian: 1 })).toEqual({ count: 1, few: false, min: 4, max: 4, median: 4 })
  })
})

describe('summarizeConverted(混幣別換算成同一單位)', () => {
  const rate: Record<string, number> = { chaos: 1, divine: 200 }
  const toChaos = (a: number, c: string) => rate[c] != null ? a * rate[c] : undefined

  it('混幣別全部換成同一單位再算,換不了的記 skipped', () => {
    const s = summarizeConverted(
      [{ amount: 150, currency: 'chaos' }, { amount: 1, currency: 'divine' }, { amount: 3, currency: 'mirror' }, { amount: 180, currency: 'chaos' }],
      toChaos, { unit: 'chaos' })
    expect(s).toEqual({ unit: 'chaos', converted: true, count: 3, few: false, skipped: 1, min: 150, max: 200, median: 180 })
  })
  it('沒有換算器:取筆數最多的原幣別,其他幣別記 skipped', () => {
    const s = summarizeConverted(
      [{ amount: 1, currency: 'divine' }, { amount: 100, currency: 'chaos' }, { amount: 2, currency: 'divine' }],
      undefined, { unit: 'chaos' })
    expect(s).toEqual({ unit: 'divine', converted: false, count: 2, few: true, skipped: 1, min: 1, max: 2 })
  })
  it('一筆都換不了 → 退回原幣別', () => {
    const s = summarizeConverted([{ amount: 5, currency: 'mirror' }], toChaos, { unit: 'chaos' })
    expect(s).toMatchObject({ unit: 'mirror', converted: false, count: 1, skipped: 0 })
  })
  it('換算結果 ≤ 0 或非有限數不算進去', () => {
    const s = summarizeConverted([{ amount: 0, currency: 'chaos' }, { amount: 5, currency: 'chaos' }], toChaos, { unit: 'chaos' })
    expect(s).toMatchObject({ converted: true, count: 1, skipped: 1, min: 5 })
  })
  it('空清單:單位用預設、count 0、標少', () => {
    expect(summarizeConverted([], toChaos, { unit: 'exalted' })).toEqual({ unit: 'exalted', converted: false, count: 0, few: true, skipped: 0 })
  })
  it('take 先截前 N 筆再換算,skipped 只算這 N 筆內', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ amount: i + 1, currency: i === 0 ? 'mirror' : 'chaos' }))
    expect(summarizeConverted(many, toChaos, { unit: 'chaos', take: 10 })).toMatchObject({ count: 9, skipped: 1, min: 2, max: 10 })
  })
})
