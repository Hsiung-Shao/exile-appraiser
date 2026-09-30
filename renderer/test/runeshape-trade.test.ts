// 符文塑形自動查市集(renderer 純邏輯):哪些列查市集、「未發現」不畫、市價換算與顯示、徽章文字(含篩選短字)
import { describe, expect, it } from 'vitest'
import {
  formatRuneTrade, layoutRunePrices, runeTradeBadge, runeTradeShortFilter, runeTradeToExalted, tradeCurrencyUnit, type MatchedRow
} from '../src/web/overlay/runeshape-view'
import type { PriceOfResult } from '../src/web/background/price-of'
import type { Poe2RuneTradeFilter } from '@poe2-entry'
import zh from '../src/i18n/cmn-Hant.json'

// 1 div = 600 ex、1 ex = 0.1 c(比例好算即可)
const RATES = { exalted: 0.1, divine: 60 }
const th = { low: 0.5, high: 5 }
const row = (over: Partial<MatchedRow>): MatchedRow => ({ text: 'x', x: 100, y: 40, w: 200, h: 20, quantity: 1, match: 'exact', ...over })

describe('哪些列查市集(tradeKey)', () => {
  const priceOf = (ref: string): PriceOfResult =>
    ref === 'Priced' ? { status: 'ok', key: 'currency|Priced', chaos: 1, exalted: 10, lowConfidence: false } : { status: 'no-price' }
  const keyOf = (r: MatchedRow) => (r.refName ? `k:${r.refName}` : undefined)

  it('只有「沒有 ninja 價」的列帶 tradeKey:技能寶石、價格表沒有的物品;有價、配方泛稱、對不上不查', () => {
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

  it('查詢計畫組不出來(tradeKeyOf 回 undefined)→ 不查;沒給 tradeKeyOf → 全部不查', () => {
    const v = layoutRunePrices([row({ kind: 'gem', refName: 'X', unpriced: 'gem' })], priceOf, { w: 1, h: 1 }, { w: 1, h: 1 }, th, () => undefined)
    expect(v[0].tradeKey).toBeUndefined()
    expect(layoutRunePrices([row({ kind: 'gem', refName: 'X', unpriced: 'gem' })], priceOf, { w: 1, h: 1 }, { w: 1, h: 1 }, th)[0].tradeKey).toBeUndefined()
  })

  it('台服(priceOf = no-source)→ noPrice no-source,照樣查市集', () => {
    const v = layoutRunePrices([row({ kind: 'item', refName: 'Regal Orb' })], () => ({ status: 'no-source' }), { w: 1, h: 1 }, { w: 1, h: 1 }, th, keyOf)
    expect([v[0].noPrice, v[0].tradeKey]).toEqual(['no-source', 'k:Regal Orb'])
  })

  it('「未發現」列(尚未解鎖的配方)→ 不畫徽章(原本顯示「?」);rowIndex 仍對應原列', () => {
    const v = layoutRunePrices([
      row({ kind: 'gem', refName: 'Powered by Verisium', unpriced: 'gem' }),
      row({ text: '未發現', kind: 'item', refName: undefined, match: null, undiscovered: true, y: 80 }),
      row({ text: '未發現', kind: 'item', refName: undefined, match: null, undiscovered: true, y: 120 }),
      row({ kind: 'item', refName: 'Priced', y: 160 })
    ], priceOf, { w: 1, h: 1 }, { w: 1, h: 1 }, th, keyOf)
    expect(v.map(b => [b.kind, b.rowIndex])).toEqual([['no-price', 0], ['price', 3]])
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

/** 用真的繁中字串檔翻譯(徽章文字要和畫面一致) */
function tZh (key: string, args?: Record<string, unknown>): string {
  let v: unknown = zh
  for (const k of key.split('.')) v = (v as Record<string, unknown>)?.[k]
  if (typeof v !== 'string') throw new Error(`missing i18n ${key}`)
  return v.replace(/\{(\w+)\}/g, (_, k: string) => String(args?.[k] ?? ''))
}

describe('徽章文字(runeTradeBadge / runeTradeShortFilter)', () => {
  const GEM_L20: Poe2RuneTradeFilter[] = [
    { id: 'realm', value: 'intl' }, { id: 'league', value: 'Runes of Aldur' }, { id: 'mode', value: 'search' },
    { id: 'type', value: 'Powered by Verisium' }, { id: 'category', value: 'gem' }, { id: 'gem_level', value: 20 },
    { id: 'corrupted', value: false }, { id: 'quality', value: 0 }, { id: 'status', value: 'securable' }
  ]
  const SKILL_ANY: Poe2RuneTradeFilter[] = [
    { id: 'mode', value: 'search' }, { id: 'type', value: 'Rain of Blades' }, { id: 'category', value: 'gem' },
    { id: 'gem_level_any' }, { id: 'corrupted', value: false }, { id: 'quality', value: 0 }
  ]
  const BULK: Poe2RuneTradeFilter[] = [{ id: 'mode', value: 'bulk' }, { id: 'want', value: 'thaumaturgic-flux-18' }, { id: 'have', value: ['exalted', 'divine'] }]
  const disp = (s: Parameters<typeof formatRuneTrade>[0], rates = RATES) => formatRuneTrade(s, rates)

  it('篩選短字:寶石等級 → L20;技能 / 輔助沒寫等級 → 等級不限;bulk / 一般物品不標', () => {
    expect(runeTradeShortFilter(GEM_L20, tZh)).toBe('L20')
    expect(runeTradeShortFilter(SKILL_ANY, tZh)).toBe('等級不限')
    expect(runeTradeShortFilter(BULK, tZh)).toBeUndefined()
  })

  it('排隊中 / 查詢中 / 沒有 entry(剛出現)', () => {
    expect(runeTradeBadge({ state: 'queued' }, undefined, GEM_L20, tZh)).toMatchObject({ status: 'queued', text: '市 … · L20' })
    expect(runeTradeBadge(undefined, undefined, SKILL_ANY, tZh)).toMatchObject({ status: 'queued', text: '市 … · 等級不限' })
    expect(runeTradeBadge({ state: 'loading' }, undefined, GEM_L20, tZh)).toMatchObject({ status: 'loading', text: '市 查詢中 · L20' })
  })

  it('結果:中位數 → 「市 80 崇高 · L20」;≥ 1 神聖石改神聖;筆數 < 3 → 最低價 + 「少」', () => {
    const d = disp({ unit: 'exalted', converted: true, count: 10, median: 80, min: 30, max: 199, few: false, skipped: 0 })
    expect(runeTradeBadge({ state: 'done' }, d, GEM_L20, tZh)).toEqual({ status: 'price', value: '80', unit: '崇高', few: false, short: 'L20', text: '市 80 崇高 · L20' })
    const dv = disp({ unit: 'exalted', converted: true, count: 8, median: 1200, min: 1, max: 30000, few: false, skipped: 0 })
    expect(runeTradeBadge({ state: 'done' }, dv, SKILL_ANY, tZh).text).toBe('市 2 神聖 · 等級不限')
    const few = disp({ unit: 'exalted', converted: true, count: 2, min: 5, max: 9, few: true, skipped: 0 })
    expect(runeTradeBadge({ state: 'done' }, few, GEM_L20, tZh)).toMatchObject({ status: 'price', value: '5', few: true, text: '市 5 崇高 少 · L20' })
    const bulk = disp({ unit: 'exalted', converted: true, count: 8, median: 3, min: 1, max: 30, few: false, skipped: 0 })
    expect(runeTradeBadge({ state: 'done' }, bulk, BULK, tZh).text).toBe('市 3 崇高')
  })

  it('台服原幣:神聖 / 認不得的幣別照原 id', () => {
    const d = disp({ unit: 'divine', converted: false, count: 5, median: 1, min: 1, max: 50, few: false, skipped: 3 }, {})
    expect(runeTradeBadge({ state: 'done' }, d, GEM_L20, tZh).text).toBe('市 1 神聖 · L20')
    const a = disp({ unit: 'annul', converted: false, count: 3, median: 2, min: 1, max: 3, few: false, skipped: 0 }, {})
    expect(runeTradeBadge({ state: 'done' }, a, GEM_L20, tZh).text).toBe('市 2 annul · L20')
  })

  it('沒有掛單 / 查詢失敗', () => {
    const empty = disp({ unit: 'exalted', converted: false, count: 0, few: true, skipped: 0 })
    expect(runeTradeBadge({ state: 'done' }, empty, GEM_L20, tZh)).toMatchObject({ status: 'empty', text: '市 無掛單 · L20' })
    expect(runeTradeBadge({ state: 'failed' }, undefined, SKILL_ANY, tZh)).toMatchObject({ status: 'failed', text: '市 查詢失敗 · 等級不限' })
  })
})
