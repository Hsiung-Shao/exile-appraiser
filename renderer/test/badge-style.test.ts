// 第 11 步:OCR 徽章外觀(renderer/src/web/overlay/badge-style.ts + Config.ts 的 ocrBadgeStyle + 防碰撞在不同字級下)
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BADGE_FONT_SIZE_MAX, BADGE_FONT_SIZE_MIN, BADGE_HALO, BUILTIN_BADGE_FONT, badgeStyleVars, defaultOcrBadgeStyle, fontOptions, isDefaultBadgeStyle,
  normHexColor, normOcrBadgeStyle, revealBadgeFontPx, type OcrBadgeStyle
} from '../src/web/overlay/badge-style'
import { _roundTripForTest } from '../src/web/Config'
import { BADGE_STACK_GAP_PX, badgeMetrics, estimateBadgeHeight, stackBadges, type BadgeView } from '../src/web/overlay/ocr-reveal'

const style = (p: Partial<OcrBadgeStyle>): OcrBadgeStyle => ({ ...defaultOcrBadgeStyle(), ...p })

describe('正規化', () => {
  it('預設 = 改版前外觀(跟隨介面字體、跟隨字級、不粗、三段色主題預設、無外框)', () => {
    expect(defaultOcrBadgeStyle()).toEqual({ fontFamily: '', fontSize: null, bold: false, tierColors: { low: null, mid: null, high: null }, outline: 'none' })
  })
  it('缺鍵 / 非物件 → 預設', () => {
    for (const v of [undefined, null, 1, 'x', [], true]) expect(normOcrBadgeStyle(v)).toEqual(defaultOcrBadgeStyle())
  })
  it('顏色只收 #rrggbb(轉小寫);#rgb、色名、rgb() → null', () => {
    expect(normHexColor('#AABBCC')).toBe('#aabbcc')
    expect(normHexColor(' #12ab34 ')).toBe('#12ab34')
    for (const v of ['#abc', 'red', 'rgb(1,2,3)', '#12345g', '', null, 0, '#1234567']) expect(normHexColor(v)).toBeNull()
  })
  it('字級夾到 10–32、四捨五入;null / 字串 / NaN → null(跟隨)', () => {
    expect(normOcrBadgeStyle({ fontSize: 5 }).fontSize).toBe(BADGE_FONT_SIZE_MIN)
    expect(normOcrBadgeStyle({ fontSize: 99 }).fontSize).toBe(BADGE_FONT_SIZE_MAX)
    expect(normOcrBadgeStyle({ fontSize: 17.6 }).fontSize).toBe(18)
    for (const v of [null, '18', Number.NaN, Number.POSITIVE_INFINITY]) expect(normOcrBadgeStyle({ fontSize: v }).fontSize).toBeNull()
  })
  it('字體名:去空白;含引號 / 反斜線 / 分號 / 大括號 / 控制字元 / 過長 → 跟隨介面', () => {
    expect(normOcrBadgeStyle({ fontFamily: ' 微軟正黑體 ' }).fontFamily).toBe('微軟正黑體')
    for (const v of ['a"b', 'a\\b', 'x;color:red', 'a{b}', 'a\nb', 'x'.repeat(200), 3]) expect(normOcrBadgeStyle({ fontFamily: v }).fontFamily).toBe('')
  })
  it('粗體只認 true;外框只認 shadow / outline', () => {
    expect(normOcrBadgeStyle({ bold: 'yes' }).bold).toBe(false)
    expect(normOcrBadgeStyle({ bold: true }).bold).toBe(true)
    expect(normOcrBadgeStyle({ outline: 'shadow' }).outline).toBe('shadow')
    expect(normOcrBadgeStyle({ outline: 'outline' }).outline).toBe('outline')
    expect(normOcrBadgeStyle({ outline: 'glow' }).outline).toBe('none')
  })
  it('壞值逐欄回預設,好的欄位保留', () => {
    expect(normOcrBadgeStyle({ fontFamily: 'Arial', fontSize: 'big', tierColors: { low: '#FF0000', mid: 'blue', high: 7 }, outline: 1 })).toEqual({
      fontFamily: 'Arial', fontSize: null, bold: false, tierColors: { low: '#ff0000', mid: null, high: null }, outline: 'none'
    })
    expect(normOcrBadgeStyle({ tierColors: 'x' }).tierColors).toEqual({ low: null, mid: null, high: null })
  })
})

describe('CSS 變數(badgeStyleVars)', () => {
  it('全部預設 → 不輸出任何變數(兩層都是;樣式回到 var() 的原值)', () => {
    expect(badgeStyleVars(defaultOcrBadgeStyle(), 'rune')).toEqual({})
    expect(badgeStyleVars(defaultOcrBadgeStyle(), 'reveal')).toEqual({})
    expect(isDefaultBadgeStyle(defaultOcrBadgeStyle())).toBe(true)
  })
  it('字體:選的字體 + --font-ui 後援', () => {
    expect(badgeStyleVars(style({ fontFamily: '標楷體' }), 'reveal')).toEqual({ '--badge-font': '"標楷體", var(--font-ui)' })
  })
  it('字級:主文字 = 設定值;小字 符文 = 主 − 1(同 --fs-xs / --fs-sm 差)、褻瀆 = 主 − 2(同 --fs-xs / --fs-base 差)', () => {
    expect(badgeStyleVars(style({ fontSize: 20 }), 'rune')).toEqual({ '--badge-fs': '20px', '--badge-fs-xs': '19px' })
    expect(badgeStyleVars(style({ fontSize: 20 }), 'reveal')).toEqual({ '--badge-fs': '20px', '--badge-fs-xs': '18px' })
  })
  it('粗體:一般 700、原本就粗的 800', () => {
    expect(badgeStyleVars(style({ bold: true }), 'rune')).toEqual({ '--badge-weight': '700', '--badge-weight-strong': '800' })
  })
  it('三段色只給符文層;褻瀆不吃(語意色保留)', () => {
    const s = style({ tierColors: { low: '#111111', mid: null, high: '#ff0000' } })
    expect(badgeStyleVars(s, 'rune')).toEqual({ '--badge-low': '#111111', '--badge-high': '#ff0000' })
    expect(badgeStyleVars(s, 'reveal')).toEqual({})
    expect(isDefaultBadgeStyle(s)).toBe(false)
  })
  it('外框 / 陰影 → text-shadow;外框是 8 方向 1px 黑', () => {
    expect(badgeStyleVars(style({ outline: 'shadow' }), 'reveal')).toEqual({ '--badge-halo': BADGE_HALO.shadow })
    expect(BADGE_HALO.outline.split('),').length).toBe(1) // 沒有 rgba,純 #000
    expect(BADGE_HALO.outline.split(', ')).toHaveLength(8)
  })
  it('樣式守門:徽章 CSS 裡每個 var(--badge-…) 都有原值後援;沒有後援的只能是繼承屬性(font-weight / text-shadow)', () => {
    for (const f of ['OcrBadges.vue', 'RuneshapePrices.vue']) {
      const css = fs.readFileSync(path.join(__dirname, '../src/web/overlay', f), 'utf8').split('<style>')[1]
      const decls = css.match(/[a-z-]+:\s*[^;{}]*var\(--badge-[^;{}]*/g) ?? []
      expect(decls.length).toBeGreaterThan(3)
      for (const d of decls) {
        const prop = d.split(':')[0].trim()
        const bare = /var\(--badge-[a-z-]+\)/.test(d)
        if (bare) expect(['font-weight', 'text-shadow'], `${f}: ${d}`).toContain(prop)
      }
    }
  })
})

describe('字體下拉選項(fontOptions)', () => {
  const sys = ['Arial', 'Noto Sans TC', '微軟正黑體', 'Consolas']
  it('最上方「跟隨介面」(\'\')+ 內建 Noto Sans TC,系統清單去掉重複的內建', () => {
    expect(fontOptions(sys, '', '')).toEqual(['', BUILTIN_BADGE_FONT, 'Arial', '微軟正黑體', 'Consolas'])
  })
  it('篩選不分大小寫;目前選的值永遠保留(即使被篩掉或已不在系統上)', () => {
    expect(fontOptions(sys, 'ari', '')).toEqual(['', BUILTIN_BADGE_FONT, 'Arial'])
    expect(fontOptions(sys, 'ari', '微軟正黑體')).toEqual(['', BUILTIN_BADGE_FONT, '微軟正黑體', 'Arial'])
    expect(fontOptions([], '', 'Gone Font')).toEqual(['', BUILTIN_BADGE_FONT, 'Gone Font'])
  })
})

describe('設定檔(Config.ts)', () => {
  it('舊設定檔沒有 ocrBadgeStyle → 預設,且照常載入其他欄位', () => {
    const { config, serialized } = _roundTripForTest(JSON.stringify({ game: 'poe2', runeshapeEnabled: true }))
    expect(config.game).toBe('poe2')
    expect(config.ocrBadgeStyle).toEqual(defaultOcrBadgeStyle())
    expect(JSON.parse(serialized).ocrBadgeStyle).toEqual(defaultOcrBadgeStyle())
  })
  it('沒有設定檔 → 預設', () => {
    expect(_roundTripForTest(null).config.ocrBadgeStyle).toEqual(defaultOcrBadgeStyle())
  })
  it('往返:存進去讀出來一樣;壞值正規化', () => {
    const s = { fontFamily: '微軟正黑體', fontSize: 22, bold: true, tierColors: { low: '#6fa8dc', mid: null, high: '#ff4d4d' }, outline: 'outline' }
    const a = _roundTripForTest(JSON.stringify({ ocrBadgeStyle: s }))
    expect(a.config.ocrBadgeStyle).toEqual(s)
    const b = _roundTripForTest(a.serialized)
    expect(b.serialized).toBe(a.serialized)
    expect(_roundTripForTest(JSON.stringify({ ocrBadgeStyle: { fontSize: 500, tierColors: { low: 'red' } } })).config.ocrBadgeStyle)
      .toEqual({ ...defaultOcrBadgeStyle(), fontSize: BADGE_FONT_SIZE_MAX })
  })
})

describe('防碰撞在不同字級下(褻瀆徽章估計高度 → stackBadges)', () => {
  const view = (i: number, anchorY: number, rows: number, unmatched = 0): BadgeView => ({
    key: `${i}`, left: 100, top: 0, anchorY,
    rows: Array.from({ length: rows }, () => ({ text: 'T4 · 一般 · 21–26', fuzzy: false })),
    more: 0, guess: false, empty: false, unmatched: Array.from({ length: unmatched }, () => 'x')
  } as BadgeView)
  it('revealBadgeFontPx:設定了用設定值,否則 --fs-base', () => {
    expect(revealBadgeFontPx({ fontSize: null }, 13)).toBe(13)
    expect(revealBadgeFontPx({ fontSize: 28 }, 13)).toBe(28)
  })
  for (const fs of [10, 13, 18, 24, 32]) {
    it(`字級 ${fs}px:行距 29 px 的三組(多候選 + 原文列)上下不重疊、間距 ≥ ${BADGE_STACK_GAP_PX} px`, () => {
      const m = badgeMetrics(revealBadgeFontPx({ fontSize: fs }, 13))
      const views = [view(0, 300, 3, 1), view(1, 329, 2), view(2, 358, 3, 2)]
      const heights = views.map(v => estimateBadgeHeight(v, m))
      // 字級越大估計高度越高(與實際 CSS 行高 1.45 一致)
      expect(heights[0]).toBeCloseTo(3 * fs * 1.45 + (fs - 2) * 1.45 + 8, 5)
      const out = stackBadges(views, heights, 1080)
      const order = out.map((b, i) => ({ top: b.top, h: heights[i] })).sort((a, b) => a.top - b.top)
      for (let i = 1; i < order.length; i++) expect(order[i].top - (order[i - 1].top + order[i - 1].h)).toBeGreaterThanOrEqual(BADGE_STACK_GAP_PX)
      // 量到的實際高度(例:字型比估計高 10%)再排一次也不重疊
      const measured = heights.map(h => Math.round(h * 1.1))
      const again = stackBadges(views, measured, 1080).map((b, i) => ({ top: b.top, h: measured[i] })).sort((a, b) => a.top - b.top)
      for (let i = 1; i < again.length; i++) expect(again[i].top - (again[i - 1].top + again[i - 1].h)).toBeGreaterThanOrEqual(BADGE_STACK_GAP_PX)
    })
  }
})
