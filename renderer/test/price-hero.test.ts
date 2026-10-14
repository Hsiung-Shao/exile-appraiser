// P2(查價面板 B 改版):價格區 PriceHero 的純邏輯 —— 一般物品摘要(建議售價 / 最低 / 中位 / 符合)與通貨兌換比
import { describe, expect, it } from 'vitest'
import { buildItemHero, fmtAmount, formatTotal, rateSides, unitIconFor } from '../src/web/price-panel/price-hero'

const r = (priceAmount: number, priceCurrency = 'chaos') => ({ priceAmount, priceCurrency })
const id = (a: number) => a
const showChaos = (b: number) => ({ amount: b, unit: 'chaos' })

describe('數字與筆數格式', () => {
  it('符合筆數:不精確時加 +,沒有總數給空字串', () => {
    expect(formatTotal(10000, true)).toBe('10000+')
    expect(formatTotal(42, false)).toBe('42')
    expect(formatTotal(undefined, false)).toBe('')
  })
  it('金額:< 1 取兩位有效、< 10 一位小數、其餘取整加千分位', () => {
    expect(fmtAmount(0.04321)).toBe('0.043')
    expect(fmtAmount(2.5)).toBe('2.5')
    expect(fmtAmount(3)).toBe('3')
    expect(fmtAmount(12.6)).toBe('13')
    expect(fmtAmount(1234.4)).toBe('1,234')
  })
})

describe('unitIconFor(單位 → 圖示,兩代分開)', () => {
  it('PoE1 走 /images/、PoE2 走 /images/poe2/', () => {
    expect(unitIconFor('poe1', 'chaos')).toBe('/images/chaos.png')
    expect(unitIconFor('poe1', 'div')).toBe('/images/divine.png')
    expect(unitIconFor('poe2', 'exalted')).toBe('/images/poe2/exa.png')
    expect(unitIconFor('poe2', 'divine')).toBe('/images/poe2/divine.png')
  })
  it('不認得的幣別回 undefined(只顯示文字)', () => {
    expect(unitIconFor('poe1', 'alch')).toBeUndefined()
  })
})

describe('rateSides(通貨兌換比 1 X → N Y)', () => {
  it('一般:左邊 1、右邊價格', () => {
    expect(rateSides({ min: 360, max: 360, currency: 'chaos' }, false)).toEqual({ left: '1', right: '360' })
  })
  it('可堆疊且不到 1 單位:反過來寫 N X → 1 Y', () => {
    expect(rateSides({ min: 0.25, max: 0.25, currency: 'chaos' }, true)).toEqual({ left: '4', right: '1' })
  })
  it('區間價顯示 min ~ max', () => {
    expect(rateSides({ min: 1, max: 2, currency: 'chaos' }, false)).toEqual({ left: '1', right: '1 ~ 2' })
  })
})

describe('buildItemHero(一般物品價格區)', () => {
  it('搜尋結果還沒回來 → 讀取中', () => {
    expect(buildItemHero({ listings: [], total: undefined, ready: false, show: showChaos })).toMatchObject({ state: 'loading', total: '' })
  })
  it('符合 0 筆 → 沒有結果', () => {
    expect(buildItemHero({ listings: [], total: 0, ready: true, show: showChaos })).toMatchObject({ state: 'empty', total: '0' })
  })
  it('有總數但掛單還沒抓到(全是補位)→ 讀取中', () => {
    expect(buildItemHero({ listings: [undefined, undefined], total: 5, ready: true, toBase: id, show: showChaos }).state).toBe('loading')
  })
  it('3 筆以上:建議售價 = 中位,另列最低 / 中位 / 符合', () => {
    const v = buildItemHero({ listings: [r(1), r(2), r(3), undefined], total: 5, ready: true, toBase: id, show: showChaos })
    expect(v).toEqual({
      state: 'ready', converted: true, few: false, total: '5',
      suggested: { amount: 2, unit: 'chaos' }, min: { amount: 1, unit: 'chaos' }, median: { amount: 2, unit: 'chaos' }
    })
  })
  it('不到 3 筆:建議售價退回最低、沒有中位、標少', () => {
    const v = buildItemHero({ listings: [r(4), r(9)], total: 2, ready: true, toBase: id, show: showChaos })
    expect(v).toMatchObject({ state: 'ready', few: true, suggested: { amount: 4 }, min: { amount: 4 } })
    expect(v.median).toBeUndefined()
  })
  it('混幣別先換成同一單位再算,顯示單位由 show 決定', () => {
    const toChaos = (a: number, c: string) => c === 'divine' ? a * 200 : c === 'chaos' ? a : undefined
    const show = (b: number) => b >= 200 ? { amount: b / 200, unit: 'div' } : { amount: b, unit: 'chaos' }
    const v = buildItemHero({ listings: [r(150), r(1, 'divine'), r(1.5, 'divine')], total: 3, ready: true, toBase: toChaos, show })
    expect(v).toMatchObject({ converted: true, min: { amount: 150, unit: 'chaos' }, median: { amount: 1, unit: 'div' } })
  })
  it('沒有匯率(台服):用筆數最多的原幣別顯示', () => {
    const v = buildItemHero({ listings: [r(1, 'divine'), r(100), r(2, 'divine')], total: 3, ready: true, show: showChaos })
    expect(v).toMatchObject({ converted: false, min: { amount: 1, unit: 'divine' }, suggested: { amount: 1, unit: 'divine' }, few: true })
  })
  it('不精確總數顯示 +;只取前 10 筆', () => {
    const many = Array.from({ length: 15 }, (_, i) => r(i + 1))
    const v = buildItemHero({ listings: many, total: 10000, inexact: true, ready: true, toBase: id, show: showChaos })
    expect(v).toMatchObject({ total: '10000+', median: { amount: 5.5 } })
  })
})
