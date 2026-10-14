// PoE1 倉庫價格疊層:徽章排版純函式(overlay/stash-view.ts)、外觀變數、台服、接線守門
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cellRects, parseStashLayouts, type StashLayoutFile } from '../../core/src/stash/layout'
import { layoutStashBadges, shortStashName, stashPriceUnit, type StashLayoutInput } from '../src/web/overlay/stash-view'
import type { PriceOfResult } from '../src/web/background/price-of'
import { badgeStyleVars, defaultOcrBadgeStyle } from '../src/web/overlay/badge-style'
import { _roundTripForTest } from '../src/web/Config'
import { REGION_PICKER_SPECS } from '../src/web/overlay/ocr-reveal'
import { defaultStripRegion } from '../../core/src/stash/detect'
import { overlayContentKey, overlayContentOf, overlayLayers } from '../src/web/overlay/overlay-content'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const FILE: StashLayoutFile = parseStashLayouts(JSON.parse(read('../../data/poe1/stash/layouts.json')))

const okPrice = (chaos: number, lowConfidence = false): PriceOfResult => ({ status: 'ok', key: 'k', chaos, lowConfidence })

function input (p: Partial<StashLayoutInput> = {}): StashLayoutInput {
  return {
    file: FILE,
    subtab: 'scarabs',
    yOffset: 0,
    client: { w: 1432, h: 2012 },
    viewport: { w: 716, h: 1006 },
    names: r => `聖甲蟲：${r}`,
    priceOf: () => okPrice(10),
    divineRate: undefined,
    thresholds: { low: 5, high: 50 },
    hover: null,
    ...p
  }
}

describe('S13 格子矩形換成 CSS 位置', () => {
  it('viewport 一半大小時第一格位置 = cellRects × 0.5', () => {
    const rects = cellRects(FILE, 'scarabs', 2012, 0)
    const out = layoutStashBadges(input())
    // 漏格 / 多格會讓數量不同
    expect(out).toHaveLength(rects.length)
    const r = rects[0]
    // 錯用左緣 / 上緣、漏乘比例會讓下列失敗
    expect(out[0].refName).toBe(r.refName)
    expect(out[0].left).toBeCloseTo((r.x + r.w / 2) * 0.5, 6)
    expect(out[0].top).toBeCloseTo((r.y + r.h) * 0.5, 6)
    expect(out[0].width).toBeCloseTo(r.w * 0.5, 6)
  })
  it('yOffset 47 時 top 跟著下移', () => {
    const r = cellRects(FILE, 'scarabs', 2012, 47)[0]
    const out = layoutStashBadges(input({ yOffset: 47 }))
    // 沒把偏移傳給 cellRects 會停在原位
    expect(out[0].top).toBeCloseTo((r.y + r.h) * 0.5, 6)
    expect(out[0].top - layoutStashBadges(input())[0].top).toBeCloseTo(47 * 0.5, 6)
  })
  it('client 寬或高為 0 → 空陣列', () => {
    // 沒擋 0 會除以 0 產生 Infinity / NaN 位置
    expect(layoutStashBadges(input({ client: { w: 0, h: 2012 } }))).toEqual([])
    expect(layoutStashBadges(input({ client: { w: 1432, h: 0 } }))).toEqual([])
  })
})

describe('S14 停在格上只留該格', () => {
  const target = FILE.subtabs.scarabs[3].refName
  it('hover 某格 → 只回一枚、hovered、全名', () => {
    const out = layoutStashBadges(input({ hover: target }))
    // 沒過濾其他格會蓋住遊戲說明框
    expect(out).toHaveLength(1)
    expect(out[0].refName).toBe(target)
    expect(out[0].hovered).toBe(true)
    // hover 時仍用短名就看不到完整名稱
    expect(out[0].name).toBe(`聖甲蟲：${target}`)
  })
  it('hover 不存在的格 → 空陣列', () => {
    expect(layoutStashBadges(input({ hover: '不存在的物品' }))).toEqual([])
  })
  it('hover null → 每格都有、都不是 hovered、用短名', () => {
    const out = layoutStashBadges(input())
    expect(out.length).toBe(FILE.subtabs.scarabs.length)
    for (const b of out) {
      expect(b.hovered).toBe(false)
      expect(b.name).toBe(b.refName)
    }
  })
  it('names 回 undefined → 用 refName', () => {
    const out = layoutStashBadges(input({ names: () => undefined, subtab: 'general' }))
    for (const b of out) expect(b.name).toBe(shortStashName(b.refName))
    expect(out[0].name).toBe(FILE.subtabs.general[0].refName)
  })
})

describe('S14b 價格分段同符文規則', () => {
  const tierOf = (chaos: number) => layoutStashBadges(input({ priceOf: () => okPrice(chaos) }))[0].tier
  it('門檻 low 5 / high 50 的邊界', () => {
    // 邊界用 <= / > 寫反會在 5 或 50 失敗
    expect(tierOf(4.9)).toBe('low')
    expect(tierOf(5)).toBe('mid')
    expect(tierOf(49.9)).toBe('mid')
    expect(tierOf(50)).toBe('high')
  })
  it('有匯率 ≥ 1 div 改神聖石,否則混沌石', () => {
    expect(stashPriceUnit(300, 200)).toEqual({ value: '1.5', unit: 'div' })
    expect(stashPriceUnit(150, 200)).toEqual({ value: '150', unit: 'c' })
    // 沒有匯率不可除以 undefined
    expect(stashPriceUnit(300, undefined)).toEqual({ value: '300', unit: 'c' })
    expect(stashPriceUnit(5000, 0)).toEqual({ value: '5000', unit: 'c' })
  })
  it('徽章帶價格、低信心照傳', () => {
    const b = layoutStashBadges(input({ priceOf: () => okPrice(300, true), divineRate: 200 }))[0]
    expect(b.status).toBe('ok')
    expect(b.price).toEqual({ value: '1.5', unit: 'div' })
    // tier 以 chaos 判斷(300 ≥ 50),誤用 div 值 1.5 會變 low
    expect(b.tier).toBe('high')
    expect(b.lowConfidence).toBe(true)
  })
  it('非 ok 狀態對應(no-league 算 no-source)且沒有 price', () => {
    for (const [s, want] of [['no-price', 'no-price'], ['loading', 'loading'], ['no-league', 'no-source']] as const) {
      const b = layoutStashBadges(input({ priceOf: () => ({ status: s }) as PriceOfResult }))[0]
      expect(b.status).toBe(want)
      expect(b.price).toBeUndefined()
    }
  })
})

describe('S14c 徽章外觀變數沿用', () => {
  it('預設 style → 不輸出變數', () => {
    expect(badgeStyleVars(defaultOcrBadgeStyle(), 'stash')).toEqual({})
  })
  it('stash 吃三段色(同 rune),reveal 不吃', () => {
    const s = { ...defaultOcrBadgeStyle(), tierColors: { low: '#112233', mid: null, high: null } }
    expect(badgeStyleVars(s, 'stash')['--badge-low']).toBe('#112233')
    expect(badgeStyleVars(s, 'stash')['--badge-low']).toBe(badgeStyleVars(s, 'rune')['--badge-low'])
    expect(badgeStyleVars(s, 'reveal')['--badge-low']).toBeUndefined()
  })
  it('fontSize 14 → stash 小字 13px(同 rune)', () => {
    const s = { ...defaultOcrBadgeStyle(), fontSize: 14 }
    expect(badgeStyleVars(s, 'stash')['--badge-fs-xs']).toBe('13px')
    expect(badgeStyleVars(s, 'rune')['--badge-fs-xs']).toBe('13px')
  })
})

describe('S16 台服不顯示價格', () => {
  it('priceOf no-source → 每枚 no-source、沒有 price', () => {
    const out = layoutStashBadges(input({ priceOf: () => ({ status: 'no-source' }) }))
    expect(out.length).toBeGreaterThan(0)
    for (const b of out) {
      expect(b.status).toBe('no-source')
      expect(b.price).toBeUndefined()
      expect(b.tier).toBeUndefined()
    }
  })
  it('StashPrices.vue:tw 分支不抓 poe.ninja,else 才抓', () => {
    const src = read('../src/web/overlay/StashPrices.vue')
    const i = src.indexOf("if (config.realm === 'tw') {")
    expect(i).toBeGreaterThan(-1)
    const j = src.indexOf('} else {', i)
    expect(j).toBeGreaterThan(i)
    expect(src.slice(i, j)).not.toContain('queuePricesFetch')
    const k = src.indexOf('}', src.indexOf('queuePricesFetch', j))
    expect(src.slice(j, k)).toContain('queuePricesFetch()')
  })
})

describe('S16b 名稱短名規則', () => {
  it('去「聖甲蟲:」前綴與英文 Scarab 字樣;其他原樣', () => {
    expect(shortStashName('聖甲蟲：落降深淵')).toBe('落降深淵')
    expect(shortStashName('聖甲蟲:落降深淵')).toBe('落降深淵')
    expect(shortStashName('Horned Scarab of Nemeses')).toBe('Horned Nemeses')
    expect(shortStashName('黃昏的奉獻')).toBe('黃昏的奉獻')
  })
})

describe('S14d 價格單位', () => {
  it('混沌石 = C、神聖石 = D(兩語相同,2026-10-14 使用者指定)', () => {
    // 改回「混 / 神」或英文 c / div → 失敗
    for (const lang of ['cmn-Hant', 'en']) {
      const st = JSON.parse(readFileSync(fileURLToPath(new URL(`../src/i18n/${lang}.json`, import.meta.url)), 'utf8')).ppz.stash
      expect([st.unit_c, st.unit_div], lang).toEqual(['C', 'D'])
    }
  })
})

describe('S18e 自訂倉庫 OCR 區域(設定 / 框選層)', () => {
  it('stashRegion 預設 null、存讀往返、壞值回 null', () => {
    // 沒存 / 讀壞 → 使用者框的區域重開就不見,或壞值讓 main 算出怪矩形
    expect(_roundTripForTest(null).config.stashRegion).toBeNull()
    const r = { x: 0.01, y: 0.12, w: 0.35, h: 0.07 }
    const rt = _roundTripForTest(JSON.stringify({ stashRegion: r }))
    expect(rt.config.stashRegion).toEqual(r)
    expect(JSON.parse(rt.serialized).stashRegion).toEqual(r)
    expect(_roundTripForTest(JSON.stringify({ stashRegion: { x: 'a' } })).config.stashRegion).toBeNull()
  })
  it('框選層有「倉庫」目標:寫 stashRegion,沒框過時顯示預設按鈕列', () => {
    // 沒有這個目標 → 設定頁的框選鈕框到別的功能的區域
    const spec = REGION_PICKER_SPECS.stash
    expect(spec.field).toBe('stashRegion')
    expect(spec.defaultRegion?.({ w: 2560, h: 1440 })).toEqual(defaultStripRegion(2560, 1440))
    expect(REGION_PICKER_SPECS.reveal.defaultRegion).toBeUndefined()
  })
  it('設定卡片有區域列、框選鈕與還原預設', () => {
    const card = readFileSync(fileURLToPath(new URL('../src/web/settings/StashPricesSection.vue', import.meta.url)), 'utf8')
    expect(card).toContain("openRegionPicker('settings', 'stash')")
    expect(card).toContain('config.stashRegion = null')
  })
})

describe('S17 圖層接線守門', () => {
  it('App.vue 只在 overlay 掛疊層', () => {
    expect(read('../src/web/App.vue')).toContain('<stash-prices v-if="isOverlay"')
  })
  it('overlay-content:overlayLayers 有 stash、輸出含 stash、鍵隨 stash 改變', () => {
    expect('stash' in overlayLayers).toBe(true)
    const app = { panel: false, settings: false, picker: false }
    const on = overlayContentOf(app, { reveal: false, rune: false, stash: true })
    const off = overlayContentOf(app, { reveal: false, rune: false, stash: false })
    expect(on.stash).toBe(true)
    expect(off.stash).toBe(false)
    // 鍵沒納入 stash → 徽章出現時不重送,overlay 可能維持藏著
    expect(overlayContentKey(on)).not.toBe(overlayContentKey(off))
  })
  it('main overlay-idle:CONTENT_KEYS 與 sanitize 處理 stash', () => {
    const src = read('../../main/src/windowing/overlay-idle.ts')
    const keys = src.match(/const CONTENT_KEYS = \[([^\]]*)\]/)
    expect(keys?.[1]).toContain("'stash'")
    const s = src.indexOf('export function sanitizeOverlayContent')
    expect(s).toBeGreaterThan(-1)
    expect(src.slice(s, src.indexOf('\n}', s))).toContain('stash: o.stash === true')
  })
  it('掃描事件不進預覽、stash-stats preview: false、preload 三個 API', () => {
    const hh = read('../../main/src/host-handlers.ts')
    const pe = hh.match(/PREVIEW_EVENTS[^=]*=\s*new Set\(\[([^\]]*)\]/)
    expect(pe).not.toBeNull()
    expect(pe![1]).not.toContain('stash-scan-result')
    expect(pe![1]).not.toContain('stash-cursor')
    expect(read('../../main/src/main.ts')).toMatch(/'stash-stats':\s*\{[^}]*preview:\s*false/)
    const pre = read('../../main/src/preload.ts')
    for (const k of ['onStashScanResult', 'onStashCursor', 'stashStats']) expect(pre).toContain(`${k}:`)
  })
  it('Config:兩個掃描設定立即送 main', () => {
    const cfg = read('../src/web/Config.ts')
    const m = cfg.match(/HOST_CONFIG_IMMEDIATE_KEYS[^=]*=\s*\[([\s\S]*?)\]/)
    expect(m?.[1]).toContain("'stashPricesEnabled'")
    expect(m?.[1]).toContain("'stashPricesIntervalMs'")
  })
  it('i18n 兩語 ppz.stash 鍵集合相同且非空', () => {
    const keysOf = (o: unknown, pre = ''): string[] => o && typeof o === 'object'
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keysOf(v, `${pre}${k}.`))
      : [pre]
    const zh = JSON.parse(read('../src/i18n/cmn-Hant.json')).ppz?.stash
    const en = JSON.parse(read('../src/i18n/en.json')).ppz?.stash
    expect(keysOf(zh).length).toBeGreaterThan(0)
    expect(keysOf(zh).sort()).toEqual(keysOf(en).sort())
  })
})
