// B5 / B7:字級上限放寬到約 3 倍(4K)與查價面板圓角內距
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import { FS_BASE_MAX, FS_BASE_MIN, clampFsBase } from '../src/web/useTheme'
import { BADGE_FONT_SIZE_MAX, normBadgeFontSize } from '../src/web/overlay/badge-style'
import { RELATED_SCALE_MAX, normRelatedItemsScale } from '../src/web/related-items-scale'
import { SETTINGS_FS_MAX, clampSettingsRect, normSettingsFontSize } from '../src/web/settings/settings-window-geom'

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

describe('T12 字級新上限', () => {
  it('四個上限常數分別是 40 / 48 / 72 / 400', () => {
    expect([FS_BASE_MAX, SETTINGS_FS_MAX, BADGE_FONT_SIZE_MAX, RELATED_SCALE_MAX]).toEqual([40, 48, 72, 400])
    expect(FS_BASE_MIN).toBe(11)
  })
  it('上限值照收、超過夾回', () => {
    expect([clampFsBase(40), clampFsBase(99)]).toEqual([40, 40])
    expect([normSettingsFontSize(48), normSettingsFontSize(99)]).toEqual([48, 48])
    expect([normBadgeFontSize(72), normBadgeFontSize(200)]).toEqual([72, 72])
    expect([normRelatedItemsScale(400), normRelatedItemsScale(900)]).toEqual([400, 400])
  })
  it('設定檔往返:新範圍內的值保留、舊值(13 / 20 / 150)照讀', () => {
    const c = _roundTripForTest('{"fsBase":36,"settingsFontSize":44,"relatedItemsScale":350,"ocrBadgeStyle":{"fontSize":60}}').config
    expect([c.fsBase, c.settingsFontSize, c.relatedItemsScale, c.ocrBadgeStyle.fontSize]).toEqual([36, 44, 350, 60])
    const o = _roundTripForTest('{"fsBase":13,"settingsFontSize":20,"relatedItemsScale":150}').config
    expect([o.fsBase, o.settingsFontSize, o.relatedItemsScale]).toEqual([13, 20, 150])
    expect(_roundTripForTest('{"fsBase":99}').config.fsBase).toBe(40)
  })
})

describe('T13 大字級幾何', () => {
  it('fsBase 40 時預設視窗(50rem×1.23 / 38rem×1.23)仍被夾進暗幕', () => {
    const rem = 40 * 1.23
    const view = { w: 1920, h: 1080 }
    const r = clampSettingsRect({ w: 50 * rem, h: 38 * rem, x: 900, y: 500 }, view)
    expect(r.w).toBeLessThanOrEqual(view.w)
    expect(r.h).toBeLessThanOrEqual(view.h)
    expect(r.x + r.w).toBeLessThanOrEqual(view.w)
    expect(r.y + r.h).toBeLessThanOrEqual(view.h)
  })
  it('設定視窗 CSS 預設大小同時有 vw / vh 上限', () => {
    const css = read('../src/web/settings/SettingsWindow.vue')
    expect(css).toMatch(/92vw\)/)
    expect(css).toMatch(/88vh\)/)
  })
})

describe('B5 查價面板外觀', () => {
  it('pobtools.css 有 --radius-l: 12px,price-panel overlay 使用它', () => {
    expect(read('../src/theme/pobtools.css')).toMatch(/--radius-l:\s*12px/)
    const app = read('../src/web/App.vue')
    expect(app).toMatch(/\.price-panel\.is-overlay\s*\{[^}]*border-radius:\s*var\(--radius-l\)/)
  })
})
