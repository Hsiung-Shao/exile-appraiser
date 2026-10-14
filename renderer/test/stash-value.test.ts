// 倉庫價值(2026-10-15):小計 / 整頁總價(stash-view.ts)、單位與分段色依小計、讀數量開關設定與接線守門(V9 / V10 / V13)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cellRects, parseStashLayouts, type StashLayoutFile } from '../../core/src/stash/layout'
import { layoutStashBadges, stashPageValue, stashValueCardPos, type StashLayoutInput } from '../src/web/overlay/stash-view'
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

describe('V15 未計入總價的格子標記', () => {
  const refIdx = new Map(FILE.subtabs.general.map((c, i) => [c.refName, i]))
  // 第 0 格 3 個、第 1 格讀不到、第 2 格 4 個但沒價格、第 3 格讀不到又沒價格、第 4 格價格讀取中
  const prices: Record<number, PriceOfResult> = { 2: { status: 'no-price' }, 3: { status: 'no-price' }, 4: { status: 'loading' } }
  const inp = () => input({ quantities: qtys([3, null, 4, null, 2]), priceOf: r => prices[refIdx.get(r)!] ?? okPrice(10) })

  it('數量讀不到 → qty-unknown;有數量但沒價格 → no-price;正常 / 讀取中沒有標記', () => {
    const by = new Map(layoutStashBadges(inp()).map(b => [refIdx.get(b.refName)!, b]))
    expect(by.get(0)!.mark).toBeUndefined()
    expect(by.get(1)!.mark).toBe('qty-unknown')
    expect(by.get(2)!.mark).toBe('no-price')
    // 讀不到數量優先(不管有沒有價格都沒算進總價,先處理數量)
    expect(by.get(3)!.mark).toBe('qty-unknown')
    expect(by.get(4)!.mark).toBeUndefined()
  })

  it('沒有數量(關閉讀數量)→ 沒有標記', () => {
    expect(layoutStashBadges(input({ priceOf: () => ({ status: 'no-price' }) })).every(b => b.mark === undefined)).toBe(true)
  })

  it('未計入格數 = 數量未讀 + 有數量但沒價格(讀取中不算)', () => {
    const v = stashPageValue(inp())!
    expect(v.unknown).toBe(2)
    expect(v.noPrice).toBe(1)
    expect(v.excluded).toBe(3)
    expect(v.totalChaos).toBe(30)
  })

  it('兩語字串:明細卡說明、無價標記、本頁價值卡說明與未計入格數', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const s = JSON.parse(read(`../src/i18n/${lang}.json`)).ppz.stash
      for (const k of ['qty_unknown', 'no_price_excluded', 'mark_no_price', 'value_note', 'value_excluded']) expect(s[k], `${lang} ${k}`).toBeTruthy()
      expect(s.value_excluded, lang).toContain('{n}')
      expect(s.value_excluded, lang).toContain('{unknown}')
      expect(s.value_excluded, lang).toContain('{noPrice}')
    }
    const zh = JSON.parse(read('../src/i18n/cmn-Hant.json')).ppz.stash
    expect(zh.qty_unknown).toBe('數量未讀取,未計入總價')
  })

  it('標記樣式用警示色且可被徽章外觀覆蓋(var(--badge-…, 原值))', () => {
    const css = read('../src/web/overlay/StashPrices.vue').split('<style>')[1]
    const rule = css.slice(css.indexOf('.st-layer .st-mark {'))
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/var\(--badge-warn, var\(--warn\)\)/)
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

describe('V16 倉庫價格只支援國際服', () => {
  it('伺服器送給 main 且立即送(main 台服不掃描)', () => {
    const tw = _roundTripForTest('{"realm":"tw"}')
    expect(hostConfigOf(tw.config).realm).toBe('tw')
    expect(hostConfigOf(_roundTripForTest(null).config).realm).toBe('intl')
    expect(HOST_CONFIG_IMMEDIATE_KEYS).toContain('realm')
  })
  it('設定狀態列:not-intl → 警示「只支援國際服」;兩語字串', async () => {
    const { stashScanStatus } = await import('../src/web/settings/scan-card-specs')
    const tr = (k: string) => k
    expect(stashScanStatus({ block: 'not-intl', showing: false, subtab: null, lastOcrMs: null, ocrCount: 0 }, tr, ''))
      .toEqual({ code: 'not-intl', tone: 'warn', text: 'ppz.stash.status_not_intl' })
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`../src/i18n/${lang}.json`)).ppz
      expect(j.stash.status_not_intl, lang).toBeTruthy()
      expect(j.menu.stash_tw, lang).toBeTruthy()
    }
    expect(JSON.parse(read('../src/i18n/cmn-Hant.json')).ppz.stash.status_not_intl).toBe('只支援國際服')
  })
  it('懸浮選單倉庫列:台服顯示「只支援國際服」說明、整列停用', () => {
    const src = read('../src/web/overlay/FloatMenu.vue')
    expect(src).toMatch(/config\.realm === 'tw'[^\n]*'ppz\.menu\.stash_tw'/)
    expect(src).toMatch(/data-menu="stash" :data-disabled="stashOff \? 'true' : 'false'"/)
  })
})

describe('V17 本頁價值卡放在倉庫面板底部', () => {
  it.each([
    ['general', 1125, 0], ['scarabs', 1125, 0], ['general', 1440, 0], ['scarabs', 1440, 0], ['scarabs', 1440, 40], ['general', 2160, 0]
  ] as const)('%s @%i 高(資料夾偏移 %i):卡片在格子區下方、面板內,不蓋右側頁籤清單', (subtab, h, yOffset) => {
    const client = { w: Math.round(h * 16 / 9), h }
    // 介面縮放 150%:CSS px = client px / 1.5
    for (const scale of [1, 1.5]) {
      const viewport = { w: client.w / scale, h: client.h / scale }
      const pos = stashValueCardPos({ file: FILE, subtab, yOffset, client, viewport })!
      const sx = viewport.w / client.w
      const sy = viewport.h / client.h
      const cells = cellRects(FILE, subtab, h, yOffset)
      const cellBottom = Math.max(...cells.map(c => c.y + c.h)) * sy
      const panelRight = Math.floor(h * 37 / 60) * sx
      // 格子區下方(不蓋任何格子)
      expect(pos.top).toBeGreaterThan(cellBottom)
      // 面板內:左右不出面板(右緣外是倉庫頁籤清單)
      expect(pos.left).toBeGreaterThanOrEqual(0)
      expect(pos.left + pos.maxWidth).toBeLessThanOrEqual(panelRight)
      // 高度在空白帶內(搜尋列上方:1440 基準 1150 + 資料夾偏移)
      expect(pos.top + pos.maxHeight).toBeLessThanOrEqual((1150 / 1440 * h + yOffset) * sy)
      expect(pos.maxHeight).toBeGreaterThan(0)
    }
  })
  it('卡片版面:單行為主(說明收成一行)、高寬受限不溢出', () => {
    const src = read('../src/web/overlay/StashPrices.vue')
    expect(src).toMatch(/:style="\{ left: `\$\{card\.left\}px`, top: `\$\{card\.top\}px`, maxWidth: `\$\{card\.maxWidth\}px`, maxHeight: `\$\{card\.maxHeight\}px` \}"/)
  })
})
