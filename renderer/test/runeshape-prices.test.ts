// WP-R2:符文塑形自動查價 — priceOf(快照查價)、徽章排版 / 計價單位 / 顏色門檻 / 數量顯示、框選層參數化
import { describe, expect, it } from 'vitest'
import { priceFromSnapshot, runeshapeKeys } from '../src/web/background/price-of'
import { formatAmount, layoutRunePrices, pickUnit, priceTier, recordScanTimings, runeshapeLastTimings, type MatchedRow } from '../src/web/overlay/runeshape-view'
import {
  BADGE_GAP_PX, REGION_PICKER_SPECS, closeRegionPicker, openRegionPicker, regionPickerClosed, regionPickerSpec, regionPickerTarget
} from '../src/web/overlay/ocr-reveal'
import type { PriceOfResult } from '../src/web/background/price-of'

// PoE2 錄製檔(core/test/recordings/ninja/poe2,2026-09-30 Forbidden Rites)的匯率與 primaryValue:
// 1 div = 9.61 c、1 ex = 9.61 / 610.9 c;Aldur's Legacy 385.3 div、Ancient Rune of Control 0.001637 div、
// Uncut Skill Gem (Level 20) 6.27 div(lc: true 是為了測低信心旗標刻意設的,exchange 列本身不帶低信心)
const C_PER_DIV = 9.61
const C_PER_EX = 9.61 / 610.9
const snap = {
  divineRate: C_PER_DIV,
  exaltedRate: C_PER_EX,
  prices: {
    "currency|Aldur's Legacy": { c: 385.3 * C_PER_DIV, n: 0, lc: false, t: 'Runes', id: 'aldurs-legacy' },
    'currency|Ancient Rune of Control': { c: 0.001637 * C_PER_DIV, n: 0, lc: false, t: 'Runes' },
    'currency|Uncut Skill Gem (Level 20)': { c: 6.27 * C_PER_DIV, n: 0, lc: true, t: 'UncutGems' }
  }
}

describe('priceOf(快照查價)', () => {
  it('鍵:currency|<refName>;給 level 且 refName 沒帶等級時補 (Level N)', () => {
    expect(runeshapeKeys("Aldur's Legacy")).toEqual(["currency|Aldur's Legacy"])
    expect(runeshapeKeys('Uncut Skill Gem', 20)).toEqual(['currency|Uncut Skill Gem (Level 20)'])
    expect(runeshapeKeys('Uncut Skill Gem (Level 20)', 20)).toEqual(['currency|Uncut Skill Gem (Level 20)'])
  })
  it('換算成崇高石 / 神聖石;帶 detailsId 與低信心', () => {
    const a = priceFromSnapshot(snap, "Aldur's Legacy")!
    expect(a.divine).toBeCloseTo(385.3, 9)
    expect(a.exalted).toBeCloseTo(385.3 * 610.9, 6)
    expect(a.detailsId).toBe('aldurs-legacy')
    expect(priceFromSnapshot(snap, 'Ancient Rune of Control')!.exalted).toBeCloseTo(1.0000433, 6)
    expect(priceFromSnapshot(snap, 'Uncut Skill Gem', 20)).toMatchObject({ lowConfidence: true, key: 'currency|Uncut Skill Gem (Level 20)' })
    expect(priceFromSnapshot(snap, 'Nope')).toBeNull()
    expect(priceFromSnapshot(null, "Aldur's Legacy")).toBeNull()
  })
  it('舊快照沒有 exaltedRate → 只有神聖石', () => {
    const p = priceFromSnapshot({ ...snap, exaltedRate: null }, "Aldur's Legacy")!
    expect(p.exalted).toBeUndefined()
    expect(p.divine).toBeCloseTo(385.3, 9)
  })
})

describe('徽章:單位、數字、顏色', () => {
  it('formatAmount', () => {
    expect(formatAmount(0.0461)).toBe('0.05')
    expect(formatAmount(1.25)).toBe('1.3')
    expect(formatAmount(3)).toBe('3')
    expect(formatAmount(12.4)).toBe('12')
    expect(formatAmount(0)).toBe('0')
  })
  it('pickUnit:預設崇高石,≥ 1 神聖石改神聖石,沒有匯率退回混沌石', () => {
    const rates = { exalted: C_PER_EX, divine: C_PER_DIV }
    expect(pickUnit(5 * C_PER_EX, rates)).toEqual({ value: expect.closeTo(5, 9), unit: 'ex' })
    expect(pickUnit(C_PER_DIV * 0.99, rates).unit).toBe('ex')
    expect(pickUnit(C_PER_DIV, rates)).toEqual({ value: 1, unit: 'div' })
    expect(pickUnit(3, {})).toEqual({ value: 3, unit: 'c' })
  })
  it('priceTier:< low 暗、≥ high 金、之間一般;沒有崇高石價 → 一般', () => {
    const th = { low: 0.5, high: 5 }
    expect(priceTier(0.49, th)).toBe('low')
    expect(priceTier(0.5, th)).toBe('mid')
    expect(priceTier(4.99, th)).toBe('mid')
    expect(priceTier(5, th)).toBe('high')
    expect(priceTier(undefined, th)).toBe('mid')
  })
})

describe('layoutRunePrices', () => {
  const priceOf = (ref: string, level?: number): PriceOfResult =>
    ref === 'Loading' ? { status: 'loading' } : priceFromSnapshot(snap, ref, level) ?? { status: 'no-price' }
  const row = (over: Partial<MatchedRow>): MatchedRow => ({ text: 'x', x: 1000, y: 400, w: 200, h: 30, quantity: 1, match: 'exact', ...over })
  const th = { low: 0.5, high: 5 }

  it('位置:列右緣 + 14 px、垂直中心;client → CSS 比例換算', () => {
    const [b] = layoutRunePrices([row({ refName: 'Ancient Rune of Control' })], priceOf, { w: 2000, h: 1000 }, { w: 1000, h: 500 }, th)
    expect(b.left).toBe(Math.round(1200 / 2 + BADGE_GAP_PX))
    expect(b.top).toBe(Math.round(415 / 2))
  })

  it('三段顏色 + 神聖石切換 + 數量(依總價上色,單價另列)', () => {
    const v = layoutRunePrices([
      row({ refName: 'Ancient Rune of Control' }), // 1 ex → mid
      row({ refName: 'Ancient Rune of Control', quantity: 6, y: 440 }), // 6 ex → high,單價 1 ex
      row({ refName: "Aldur's Legacy", y: 480 }), // 385.3 div → high、神聖石
      row({ refName: 'Uncut Skill Gem (Level 20)', quantity: 2, y: 520 }) // 6.27 div × 2 = 12.54
    ], priceOf, { w: 2000, h: 1000 }, { w: 2000, h: 1000 }, th)
    expect(v.map(b => [b.kind, b.tier, b.total, b.each])).toEqual([
      ['price', 'mid', { value: '1', unit: 'ex' }, undefined],
      ['price', 'high', { value: '6', unit: 'ex' }, { value: '1', unit: 'ex' }],
      ['price', 'high', { value: '385', unit: 'div' }, undefined],
      ['price', 'high', { value: '13', unit: 'div' }, { value: '6.3', unit: 'div' }]
    ])
    expect(v[3].lowConfidence).toBe(true)
    const cheap = layoutRunePrices([row({ refName: 'Ancient Rune of Control' })], priceOf, { w: 1, h: 1 }, { w: 1, h: 1 }, { low: 2, high: 5 })
    expect(cheap[0].tier).toBe('low')
  })

  it('對不上 / 沒價格 / 載入中', () => {
    const v = layoutRunePrices([
      row({ text: '阿 德爾', refName: undefined, match: null }),
      row({ refName: 'Nope' }),
      row({ refName: 'Loading' })
    ], priceOf, { w: 1, h: 1 }, { w: 1, h: 1 }, th)
    expect(v.map(b => [b.kind, b.raw])).toEqual([['unmatched', '阿德爾'], ['no-price', undefined], ['loading', undefined]])
    expect(v[1].noPrice).toBe('not-listed')
  })

  it('§2:技能寶石(unpriced: gem)不查價直接「無價格」;面板外的列不畫;重名帶候選;模糊標 approx', () => {
    const asked: string[] = []
    const spy = (ref: string, level?: number): PriceOfResult => { asked.push(ref); return priceOf(ref, level) }
    const v = layoutRunePrices([
      row({ text: '技能等級 20：傳導符文', refName: 'Conductive Runes', level: 20, unpriced: 'gem' }),
      row({ text: '符形組合', refName: undefined, match: null, offPanel: true, y: 100 }),
      row({ text: '1x 乙', refName: undefined, match: 'exact', ambiguous: ['B1', 'B2'], y: 440 }),
      row({ text: '1x 遠古控制符文', refName: 'Ancient Rune of Control', match: 'fuzzy', y: 480 })
    ], spy, { w: 1, h: 1 }, { w: 1, h: 1 }, th)
    expect(v.map(b => [b.kind, b.noPrice, b.candidates, b.approx])).toEqual([
      ['no-price', 'gem', undefined, false],
      ['unmatched', undefined, ['B1', 'B2'], false],
      ['price', undefined, undefined, true]
    ])
    expect(asked).toEqual(['Ancient Rune of Control'])
    // key 保留原本的列序號(面板外那列被跳過)
    expect(v.map(b => b.key.split(':')[0])).toEqual(['0', '2', '3'])
  })

  it('配方泛稱(unpriced: recipe)不查價直接「無固定價格」,與「無價格」(not-listed / gem)區分;模糊命中照樣標 approx', () => {
    const asked: string[] = []
    const spy = (ref: string, level?: number): PriceOfResult => { asked.push(ref); return priceOf(ref, level) }
    const v = layoutRunePrices([
      row({ text: '維里西姆堆', refName: 'Verisium Pile', unpriced: 'recipe' }),
      row({ text: '5x 隨機通貨', refName: '5x Random Currency', unpriced: 'recipe', match: 'fuzzy', y: 440 }),
      row({ text: '1x 不在價格表', refName: 'Nope', y: 480 })
    ], spy, { w: 1, h: 1 }, { w: 1, h: 1 }, th)
    expect(v.map(b => [b.kind, b.noPrice, b.refName, b.approx, b.tier])).toEqual([
      ['no-price', 'recipe', 'Verisium Pile', false, 'low'],
      ['no-price', 'recipe', '5x Random Currency', true, 'low'],
      ['no-price', 'not-listed', 'Nope', false, 'low']
    ])
    expect(asked).toEqual(['Nope'])
  })

  it('recordScanTimings:只記有 timings 的事件(設定頁最近耗時)', () => {
    recordScanTimings({ ts: 1, rows: [], timings: undefined })
    expect(runeshapeLastTimings.value).toBeNull()
    recordScanTimings({ ts: 2, rows: [{ text: 'a', x: 0, y: 0, w: 1, h: 1 }], timings: { captureMs: 80, diffMs: 1, ocrWallMs: 110, ocrMs: 90, totalMs: 191 } })
    expect(runeshapeLastTimings.value).toMatchObject({ at: 2, rows: 1, timings: { totalMs: 191 } })
  })
})

describe('框選層參數化(WP-R2)', () => {
  it('兩種 spec:目標欄位 / 確認後動作 / 標題 / 上次偵測', () => {
    expect(REGION_PICKER_SPECS.reveal).toMatchObject({ field: 'ocrRegion', afterConfirm: 'reveal-now', showLastDetected: true, titleKey: 'ppz.ocr.region.picker.help' })
    expect(REGION_PICKER_SPECS.runeshape).toMatchObject({ field: 'runeshapeRegion', afterConfirm: 'focus-game', showLastDetected: false, titleKey: 'ppz.runeshape.picker.help' })
  })
  it('openRegionPicker 不帶 target = 揭露面板(WP-S2 行為不變);closed 記錄不帶 target', () => {
    openRegionPicker('hotkey')
    expect(regionPickerTarget.value).toBe('reveal')
    expect(regionPickerSpec().field).toBe('ocrRegion')
    closeRegionPicker('測試', 'confirm')
    expect(regionPickerClosed.value).toEqual({ source: 'hotkey', outcome: 'confirm' })
  })
  it('target = runeshape:spec 換成 runeshapeRegion;closed 帶 target', () => {
    openRegionPicker('settings', 'runeshape')
    expect(regionPickerSpec().field).toBe('runeshapeRegion')
    closeRegionPicker('測試', 'clear')
    expect(regionPickerClosed.value).toEqual({ source: 'settings', outcome: 'clear', target: 'runeshape' })
    // 下一次沒帶 target 又回到揭露面板
    openRegionPicker('settings')
    expect(regionPickerSpec().field).toBe('ocrRegion')
    closeRegionPicker('測試', 'cancel')
  })
})
