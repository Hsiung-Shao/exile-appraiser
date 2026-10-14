// 倉庫價值(2026-10-15):小計 / 整頁總價(stash-view.ts)、單位與分段色依小計、讀數量開關設定與接線守門(V9 / V10 / V13)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseStashLayouts, type StashLayoutFile } from '../../core/src/stash/layout'
import { layoutStashBadges, stashPageValue, type StashLayoutInput } from '../src/web/overlay/stash-view'
import { stashValueText } from '../src/web/overlay/stash-value'
import type { PriceOfResult } from '../src/web/background/price-of'
import { HOST_CONFIG_IMMEDIATE_KEYS, _roundTripForTest, hostConfigOf } from '../src/web/Config'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const FILE: StashLayoutFile = parseStashLayouts(JSON.parse(read('../../data/poe1/stash/layouts.json')))
const N = FILE.subtabs.general.length

const okPrice = (chaos: number): PriceOfResult => ({ status: 'ok', key: 'k', chaos, lowConfidence: false })

/** 一般子頁:前幾格指定數量,其餘 0(空格) */
function qtys (head: Array<number | null>): Array<number | null> {
  return [...head, ...Array(N - head.length).fill(0)]
}

function input (p: Partial<StashLayoutInput> = {}): StashLayoutInput {
  return {
    file: FILE,
    subtab: 'general',
    yOffset: 0,
    client: { w: 2000, h: 1125 },
    viewport: { w: 2000, h: 1125 },
    names: r => r,
    priceOf: () => okPrice(10),
    divineRate: 200,
    thresholds: { low: 5, high: 50 },
    hover: null,
    ...p
  }
}

describe('V9 小計與總價', () => {
  it('總價 = Σ 單價 × 數量;null 不計入;已讀 / 未讀 / 空格格數正確', () => {
    const v = stashPageValue(input({ quantities: qtys([3, null, 2, 0, null]) }))!
    // 把 null 當 1 或把 0 算進已讀都會失敗
    expect(v.totalChaos).toBe(50)
    expect(v.known).toBe(2)
    expect(v.unknown).toBe(2)
    expect(v.empty).toBe(N - 4)
  })

  it('沒有價格的格不計入總價,但數量仍算已讀', () => {
    const prices: Record<number, PriceOfResult> = { 0: okPrice(10), 1: { status: 'no-price' } }
    const refIdx = new Map(FILE.subtabs.general.map((c, i) => [c.refName, i]))
    const v = stashPageValue(input({ quantities: qtys([3, 4]), priceOf: r => prices[refIdx.get(r)!] ?? okPrice(1) }))!
    expect(v.totalChaos).toBe(30)
    expect(v.known).toBe(2)
    expect(v.noPrice).toBe(1)
  })

  it('沒有數量(關閉讀數量 / 舊 main)→ null', () => {
    expect(stashPageValue(input())).toBeNull()
  })

  it('徽章:數量 > 0 顯示小計並帶單價 / 數量;null 顯示單價 + 未讀;0 不畫(停格時才畫)', () => {
    const out = layoutStashBadges(input({ quantities: qtys([3, null, 0]) }))
    const byRef = new Map(out.map(b => [b.refName, b]))
    const [c0, c1, c2] = FILE.subtabs.general
    expect(byRef.get(c0.refName)).toMatchObject({ qty: 3, price: { value: '30', unit: 'c' }, unitPrice: { value: '10', unit: 'c' }, subtotal: { value: '30', unit: 'c' } })
    expect(byRef.get(c1.refName)).toMatchObject({ qty: null, qtyUnknown: true, price: { value: '10', unit: 'c' } })
    expect(byRef.get(c1.refName)!.subtotal).toBeUndefined()
    // 空格沒藏起來會在倉庫空格上畫價格
    expect(byRef.has(c2.refName)).toBe(false)
    const hovered = layoutStashBadges(input({ quantities: qtys([3, null, 0]), hover: c2.refName }))
    expect(hovered).toHaveLength(1)
    expect(hovered[0]).toMatchObject({ qty: 0, empty: true })
  })

  it('沒有數量時徽章維持單價、沒有數量欄位(關閉讀數量 = 改版前行為)', () => {
    const b = layoutStashBadges(input())[0]
    expect(b.price).toEqual({ value: '10', unit: 'c' })
    expect(b.qty).toBeUndefined()
    expect(b.subtotal).toBeUndefined()
  })

  it('peek(main 要重讀被蓋住的數字)→ 格子徽章全部收起', () => {
    expect(layoutStashBadges(input({ quantities: qtys([3]), peek: true }))).toEqual([])
  })
})

describe('V10 單位與分段色依小計', () => {
  it('單價 10 × 6 = 60 → high(依小計,不是單價的 mid)', () => {
    const b = layoutStashBadges(input({ quantities: qtys([6]) }))[0]
    expect(b.tier).toBe('high')
  })
  it('單價 3 × 2 = 6 → mid;單價 3 × 1 → low', () => {
    expect(layoutStashBadges(input({ priceOf: () => okPrice(3), quantities: qtys([2]) }))[0].tier).toBe('mid')
    expect(layoutStashBadges(input({ priceOf: () => okPrice(3), quantities: qtys([1]) }))[0].tier).toBe('low')
  })
  it('小計 ≥ 1 神聖石改 D(單價仍是 C)', () => {
    const b = layoutStashBadges(input({ priceOf: () => okPrice(50), quantities: qtys([10]), divineRate: 200 }))[0]
    expect(b.price).toEqual({ value: '2.5', unit: 'div' })
    expect(b.unitPrice).toEqual({ value: '50', unit: 'c' })
  })
  it('數量讀不到 → 不分段(不知道小計)', () => {
    expect(layoutStashBadges(input({ quantities: qtys([null]) }))[0].tier).toBeUndefined()
  })
  it('總價文字:千分位 C,≈ D 一位小數;沒有匯率不給 D', () => {
    expect(stashValueText({ totalChaos: 12345.6, divineRate: 200 })).toEqual({ chaos: '12,346', div: '61.7' })
    expect(stashValueText({ totalChaos: 0, divineRate: undefined })).toEqual({ chaos: '0', div: null })
  })
})

describe('V13 關閉讀數量(設定與接線)', () => {
  it('stashReadQuantity 預設開、存讀往返、送 main、立即送', () => {
    expect(_roundTripForTest(null).config.stashReadQuantity).toBe(true)
    const off = _roundTripForTest('{"stashReadQuantity":false}')
    expect(off.config.stashReadQuantity).toBe(false)
    expect(JSON.parse(off.serialized).stashReadQuantity).toBe(false)
    expect(hostConfigOf(off.config).stashReadQuantity).toBe(false)
    expect(HOST_CONFIG_IMMEDIATE_KEYS).toContain('stashReadQuantity')
  })
  it('main:scanConfigKey 含 stashReadQuantity、StashScan 讀 hostCfg.stashReadQuantity', () => {
    const key = read('../../main/src/scan-config.ts')
    expect(key.slice(key.indexOf('function scanConfigKey'))).toContain('cfg.stashReadQuantity')
    expect(read('../../main/src/main.ts')).toContain('readQuantity: hostCfg?.stashReadQuantity !== false')
  })
  it('設定 › 自動辨識 › 倉庫價格卡 #extra 有開關;兩語字串', () => {
    const rec = read('../src/web/settings/tabs/Recognition.vue')
    expect(rec).toMatch(/kind="stash">[\s\S]*<template #extra>[\s\S]*v-model="config\.stashReadQuantity"[\s\S]*data-setting="stash-read-quantity"[\s\S]*<\/ocr-scan-section>/)
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`../src/i18n/${lang}.json`))
      expect(j.ppz.stash.read_quantity, lang).toBeTruthy()
      expect(j.ppz.stash.read_quantity_hint, lang).toBeTruthy()
      expect(j.ppz.stash.value_title, lang).toBeTruthy()
      expect(j.ppz.stash.qty_unit_price, lang).toBeTruthy()
      expect(j.ppz.menu.stash_none, lang).toBeTruthy()
      expect(j.ppz.menu.stash_sub, lang).toBeTruthy()
    }
  })
  it('StashPrices.vue 走共用掃描層(source stash,遮罩 + ack)並寫共用狀態', () => {
    const src = read('../src/web/overlay/StashPrices.vue')
    expect(src).toMatch(/useScanLayer<StashScanEvent>\(\{\s*source: 'stash'/)
    expect(src).toContain('ref="layer"')
    expect(src).toContain('stashValue.value')
  })
})
