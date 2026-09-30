// 符文塑形點選查交易站(renderer 純邏輯):哪些徽章可點、overlayKey 何時進可點模式、市價換算與顯示、篩選清單字串
import { describe, expect, it } from 'vitest'
import {
  enterClickModeOnOverlayKey, formatRuneTrade, layoutRunePrices, placeTradeCard, runeTradeFilterLines, runeTradeToExalted, tradeCurrencyUnit, type MatchedRow
} from '../src/web/overlay/runeshape-view'
import type { PriceOfResult } from '../src/web/background/price-of'

// 1 div = 600 ex、1 ex = 0.1 c(比例好算即可)
const RATES = { exalted: 0.1, divine: 60 }
const th = { low: 0.5, high: 5 }
const row = (over: Partial<MatchedRow>): MatchedRow => ({ text: 'x', x: 100, y: 40, w: 200, h: 20, quantity: 1, match: 'exact', ...over })

describe('哪些徽章可點(tradeKey)', () => {
  const priceOf = (ref: string): PriceOfResult =>
    ref === 'Priced' ? { status: 'ok', key: 'currency|Priced', chaos: 1, exalted: 10, lowConfidence: false } : { status: 'no-price' }
  const keyOf = (r: MatchedRow) => (r.refName ? `k:${r.refName}` : undefined)

  it('只有「沒有 ninja 價」的列帶 tradeKey:技能寶石、價格表沒有的物品可點;有價、配方泛稱、對不上不可點', () => {
    const v = layoutRunePrices([
      row({ kind: 'gem', refName: 'Powered by Verisium', level: 20, unpriced: 'gem' }),
      row({ kind: 'item', refName: 'Nope', y: 80 }),
      row({ kind: 'item', refName: 'Priced', y: 120 }),
      row({ kind: 'recipe', refName: 'Verisium Pile', unpriced: 'recipe', y: 160 }),
      row({ refName: undefined, match: null, y: 200 })
    ], priceOf, { w: 1, h: 1 }, { w: 1, h: 1 }, th, keyOf)
    expect(v.map(b => [b.kind, b.noPrice ?? null, b.tradeKey ?? null, b.rowIndex])).toEqual([
      ['no-price', 'gem', 'k:Powered by Verisium', 0],
      ['no-price', 'not-listed', 'k:Nope', 1],
      ['price', null, null, 2],
      ['no-price', 'recipe', null, 3],
      ['unmatched', null, null, 4]
    ])
  })

  it('查詢計畫組不出來(tradeKeyOf 回 undefined)→ 不可點;沒給 tradeKeyOf → 全部不可點', () => {
    const v = layoutRunePrices([row({ kind: 'gem', refName: 'X', unpriced: 'gem' })], priceOf, { w: 1, h: 1 }, { w: 1, h: 1 }, th, () => undefined)
    expect(v[0].tradeKey).toBeUndefined()
    expect(layoutRunePrices([row({ kind: 'gem', refName: 'X', unpriced: 'gem' })], priceOf, { w: 1, h: 1 }, { w: 1, h: 1 }, th)[0].tradeKey).toBeUndefined()
  })

  it('台服(priceOf = no-source)→ noPrice no-source,仍可點', () => {
    const v = layoutRunePrices([row({ kind: 'item', refName: 'Regal Orb' })], () => ({ status: 'no-source' }), { w: 1, h: 1 }, { w: 1, h: 1 }, th, keyOf)
    expect([v[0].noPrice, v[0].tradeKey]).toEqual(['no-source', 'k:Regal Orb'])
  })
})

describe('overlayKey → 徽章可點模式', () => {
  it('overlay 由 overlayKey 叫出、查價面板沒開、畫面上有徽章才進;否則維持原行為(開設定)', () => {
    const hot = { overlay: true, usingHotkey: true }
    expect(enterClickModeOnOverlayKey(hot, false, true)).toBe(true)
    expect(enterClickModeOnOverlayKey(hot, false, false)).toBe(false)
    expect(enterClickModeOnOverlayKey(hot, true, true)).toBe(false)
    expect(enterClickModeOnOverlayKey({ overlay: true, usingHotkey: false }, false, true)).toBe(false)
    expect(enterClickModeOnOverlayKey({ overlay: false, usingHotkey: true }, false, true)).toBe(false)
  })
})

describe('市價換算與顯示', () => {
  it('runeTradeToExalted:崇高石原值;神聖石 / 混沌石用 poe.ninja 匯率;其他幣別或沒有匯率 → undefined', () => {
    const f = runeTradeToExalted(RATES)
    expect(f(3, 'exalted')).toBe(3)
    expect(f(1, 'divine')).toBeCloseTo(600, 9)
    expect(f(1, 'chaos')).toBeCloseTo(10, 9)
    expect(f(1, 'annul')).toBeUndefined()
    const none = runeTradeToExalted({})
    expect([none(2, 'exalted'), none(1, 'divine'), none(1, 'chaos')]).toEqual([2, undefined, undefined])
  })

  it('formatRuneTrade:已換算 → 崇高石,≥ 1 神聖石改神聖石(主價、最低、最高各自挑單位)', () => {
    const ex = (value: string) => ({ value, unit: 'ex', known: true })
    const div = (value: string) => ({ value, unit: 'div', known: true })
    expect(formatRuneTrade({ unit: 'exalted', converted: true, count: 10, median: 80, min: 30, max: 199, few: false, skipped: 0 }, RATES))
      .toEqual({ unit: 'ex', known: true, headline: '80', isMedian: true, min: ex('30'), max: ex('199') })
    expect(formatRuneTrade({ unit: 'exalted', converted: true, count: 8, median: 600, min: 1, max: 30000, few: false, skipped: 0 }, RATES))
      .toEqual({ unit: 'div', known: true, headline: '1', isMedian: true, min: ex('1'), max: div('50') })
  })

  it('筆數少 → 主價 = 最低價、isMedian false;沒有結果 → 沒有主價', () => {
    expect(formatRuneTrade({ unit: 'exalted', converted: true, count: 2, min: 5, max: 9, few: true, skipped: 0 }, RATES))
      .toMatchObject({ headline: '5', isMedian: false })
    expect(formatRuneTrade({ unit: 'exalted', converted: false, count: 0, few: true, skipped: 0 }, RATES).headline).toBeUndefined()
  })

  it('原幣(台服)→ 照交易站幣別,認不得的幣別顯示原 id', () => {
    expect(formatRuneTrade({ unit: 'divine', converted: false, count: 5, median: 1, min: 1, max: 50, few: false, skipped: 3 }, {}))
      .toEqual({ unit: 'div', known: true, headline: '1', isMedian: true, min: { value: '1', unit: 'div', known: true }, max: { value: '50', unit: 'div', known: true } })
    expect(formatRuneTrade({ unit: 'annul', converted: false, count: 3, median: 2, min: 1, max: 3, few: false, skipped: 0 }, {}))
      .toMatchObject({ unit: 'annul', known: false, headline: '2' })
    expect([tradeCurrencyUnit('exalted'), tradeCurrencyUnit('chaos'), tradeCurrencyUnit('annul')]).toEqual(['ex', 'c', undefined])
  })
})

describe('市價卡片位置(placeTradeCard)', () => {
  const size = { w: 340, h: 330 }
  it('徽章欄右側、上緣對齊徽章往上 24 px(不蓋住其他列的徽章)', () => {
    expect(placeTradeCard({ top: 160, rowLeft: 420, columnRight: 900 }, { w: 1400, h: 800 }, size)).toEqual({ left: 912, top: 136 })
  })
  it('右邊放不下 → 面板左側;夾進視窗', () => {
    expect(placeTradeCard({ top: 160, rowLeft: 800, columnRight: 1200 }, { w: 1400, h: 800 }, size)).toEqual({ left: 448, top: 136 })
    expect(placeTradeCard({ top: 780, rowLeft: 100, columnRight: 1200 }, { w: 1400, h: 800 }, size)).toEqual({ left: 8, top: 462 })
    expect(placeTradeCard({ top: 5, rowLeft: 500, columnRight: 600 }, { w: 1400, h: 800 }, size).top).toBe(8)
  })
})

describe('篩選清單字串(卡片「使用的篩選」)', () => {
  const t = (key: string) => `<${key}>`
  it('每個篩選都有標籤與值;寶石等級 / 未汙染 / 品質 0 照實列出', () => {
    const lines = runeTradeFilterLines([
      { id: 'realm', value: 'intl' },
      { id: 'league', value: 'Runes of Aldur' },
      { id: 'mode', value: 'search' },
      { id: 'type', value: 'Powered by Verisium' },
      { id: 'category', value: 'gem' },
      { id: 'gem_level', value: 20 },
      { id: 'corrupted', value: false },
      { id: 'quality', value: 0 },
      { id: 'status', value: 'securable' }
    ], t)
    expect(lines.map(l => `${l.label}=${l.value}`)).toEqual([
      '<ppz.runeshape.trade.f_realm>=<ppz.realm_intl_short>',
      '<ppz.runeshape.trade.f_league>=Runes of Aldur',
      '<ppz.runeshape.trade.f_mode>=<ppz.runeshape.trade.mode_search>',
      '<ppz.runeshape.trade.f_type>=Powered by Verisium',
      '<ppz.runeshape.trade.f_category>=<ppz.runeshape.trade.v_gem>',
      '<ppz.runeshape.trade.f_gem_level>=20',
      '<ppz.runeshape.trade.f_corrupted>=<ppz.runeshape.trade.v_uncorrupted>',
      '<ppz.runeshape.trade.f_quality>=<ppz.runeshape.trade.v_quality_zero>',
      '<ppz.runeshape.trade.f_status>=<ppz.runeshape.trade.status_securable>'
    ])
  })
  it('bulk:支付幣別轉成單位字;等級不限', () => {
    const lines = runeTradeFilterLines([{ id: 'have', value: ['exalted', 'divine', 'annul'] }, { id: 'gem_level_any' }, { id: 'want', value: 'thaumaturgic-flux-18' }], t)
    expect(lines.map(l => l.value)).toEqual(['<ppz.runeshape.unit_ex> / <ppz.runeshape.unit_div> / annul', '<ppz.runeshape.trade.v_level_any>', 'thaumaturgic-flux-18'])
  })
})
