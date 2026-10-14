// P2(查價面板 B 改版):價格區 PriceHero 的純邏輯 —— 一般物品摘要(建議售價 / 最低 / 中位 / 符合)與通貨兌換比
import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fmtAmount, rateSides, unitIconFor } from '../src/web/price-panel/price-hero'


describe('數字與筆數格式', () => {
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

describe('一般物品價格區已移除', () => {
  it('price-hero 模組與 PriceHero 不再有一般物品模式', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/web/price-panel/price-hero.ts'), 'utf8')
    const vue = fs.readFileSync(path.resolve(__dirname, '../src/web/price-panel/PriceHero.vue'), 'utf8')
    expect(src).not.toMatch(/buildItemHero|ItemHeroView|HERO_TAKE|formatTotal|summarizeConverted/)
    expect(vue).not.toMatch(/mode === 'item'|ItemHeroView|ppz\.hero\.suggested/)
  })
})

describe('fmtAmount 依單位保留小數', () => {
  it('神聖石 / 崇高石保留一位小數(12.5 div 不取整)', () => {
    expect(fmtAmount(12.5, 'div')).toBe('12.5')
    expect(fmtAmount(12, 'div')).toBe('12')
    expect(fmtAmount(0.5, 'div')).toBe('0.5')
    expect(fmtAmount(1234.56, 'exalted')).toBe('1,234.6')
  })
  it('chaos:小於 10 一位小數、10 以上取整', () => {
    expect(fmtAmount(7.46, 'chaos')).toBe('7.5')
    expect(fmtAmount(123.4, 'chaos')).toBe('123')
  })
  it('兌換比右邊照幣別保留小數', () => {
    expect(rateSides({ min: 12.5, max: 12.5, currency: 'div' }, false)).toEqual({ left: '1', right: '12.5' })
    expect(rateSides({ min: 123.4, max: 123.4, currency: 'chaos' }, false)).toEqual({ left: '1', right: '123' })
  })
})
