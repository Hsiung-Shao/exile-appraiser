// exile-appraiser(2026-10-01):自訂背景圖的 renderer 端(設定正規化 / 往返、網址、CSS 變數)與「overlay 其他區域維持透明」的樣式守門。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import {
  BG_DEFAULT, BG_READ_FLOOR, BG_READ_FLOOR_BLURRED, BG_READ_FLOOR_BLUR_AT, bgImageUrl, bgReadability, bgReadFloor, bgVars, normBg, normBgFile
} from '../src/web/useTheme'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('normBg / normBgFile(與 main backgrounds.ts 同規則)', () => {
  it('檔名只准 png / jpg / jpeg / webp、沒有路徑字元', () => {
    expect(normBgFile('a-1a2b3c4d.png')).toBe('a-1a2b3c4d.png')
    for (const f of ['../a.png', 'a/b.png', 'a\\b.png', '.a.png', 'a.gif', 'C:a.png', 'a..png']) expect(normBgFile(f)).toBe('')
  })
  it('壞值 → 預設;百分比夾在 0–100 且取整數', () => {
    expect(normBg(undefined)).toEqual(BG_DEFAULT)
    expect(normBg({ enabled: false, file: '../x.png', bright: 140, panelOpacity: 33.4, blur: -1 }))
      .toEqual({ enabled: false, file: '', bright: BG_DEFAULT.bright, panelOpacity: 33, blur: BG_DEFAULT.blur })
  })
})

describe('bgImageUrl', () => {
  it('Electron 視窗 → app://bg/<編碼檔名>', () => {
    expect(bgImageUrl('風景 1.png', { electron: true, preview: false, baseURI: 'app://app/index.html' })).toBe('app://bg/%E9%A2%A8%E6%99%AF%201.png')
  })
  it('瀏覽器預覽 → 頁面所在 token 路徑下的 bg/(token 保護)', () => {
    const t = 'a'.repeat(32)
    expect(bgImageUrl('a.png', { electron: true, preview: true, baseURI: `http://127.0.0.1:5000/t/${t}/` }))
      .toBe(`http://127.0.0.1:5000/t/${t}/bg/a.png`)
  })
  it('純瀏覽器 / 沒選 / 不合法 → null', () => {
    expect(bgImageUrl('a.png', { electron: false, preview: false, baseURI: 'http://localhost:5173/' })).toBeNull()
    expect(bgImageUrl('', { electron: true, preview: false, baseURI: 'app://app/' })).toBeNull()
    expect(bgImageUrl('../a.png', { electron: true, preview: false, baseURI: 'app://app/' })).toBeNull()
  })
})

describe('bgVars', () => {
  const bg = { enabled: true, file: 'a.png', bright: 40, panelOpacity: 70, blur: 50 }
  it('有圖 → 圖 / 亮度 / 霧面 / 面板不透明度 + 可讀性三個值', () => {
    expect(bgVars(bg, 'app://bg/a.png')).toEqual({
      '--bg-image': 'url("app://bg/a.png")',
      '--bg-bright': '0.4',
      '--bg-blur': '12px',
      '--bg-panel-pct': '70%',
      '--bg-read-pct': '70%',
      '--bg-lift': '0%',
      '--bg-halo': '0.45'
    })
  })
  it('關閉 / 沒圖 / 沒網址 → null(不設 data-bg)', () => {
    expect(bgVars({ ...bg, enabled: false }, 'app://bg/a.png')).toBeNull()
    expect(bgVars({ ...bg, file: '' }, 'app://bg/a.png')).toBeNull()
    expect(bgVars(bg, null)).toBeNull()
  })
})

describe('可讀性(透明面板時自動加強文字對比)', () => {
  it('地板值:霧面 0 → 70%,霧面 ≥ 50 → 55%,中間線性', () => {
    expect(bgReadFloor(0)).toBe(BG_READ_FLOOR)
    expect(BG_READ_FLOOR).toBe(70)
    expect(bgReadFloor(BG_READ_FLOOR_BLUR_AT)).toBe(BG_READ_FLOOR_BLURRED)
    expect(bgReadFloor(100)).toBe(BG_READ_FLOOR_BLURRED)
    expect(bgReadFloor(25)).toBe(Math.round((BG_READ_FLOOR + BG_READ_FLOOR_BLURRED) / 2))
    expect(bgReadFloor(-5)).toBe(BG_READ_FLOOR)
  })
  it('閱讀區塊不透明度 = max(使用者值, 地板值);使用者值高於地板值時照使用者值、不補', () => {
    expect(bgReadability(0, 0)).toEqual({ readPct: 70, liftPct: 70, halo: 0.9 })
    expect(bgReadability(30, 0)).toEqual({ readPct: 70, liftPct: 57.1, halo: 0.71 })
    expect(bgReadability(80, 0)).toEqual({ readPct: 80, liftPct: 0, halo: 0.38 })
    expect(bgReadability(100, 0)).toEqual({ readPct: 100, liftPct: 0, halo: 0.25 })
    expect(bgReadability(0, 100).readPct).toBe(BG_READ_FLOOR_BLURRED)
  })
  it('補足層:疊在使用者底色上的總覆蓋 = 地板值(1 − (1 − p)(1 − a))', () => {
    for (const p of [0, 10, 30, 55, 69]) {
      const r = bgReadability(p, 0)
      const total = 1 - (1 - p / 100) * (1 - r.liftPct / 100)
      expect(total).toBeCloseTo(r.readPct / 100, 2)
    }
  })
  it('光暈濃度隨面板透明度單調提高', () => {
    const halos = [100, 75, 50, 25, 0].map(p => bgReadability(p, 0).halo)
    for (let i = 1; i < halos.length; i++) expect(halos[i]).toBeGreaterThan(halos[i - 1])
  })
})

describe('設定欄位 bg 往返', () => {
  it('舊設定檔沒有 → 預設(沒選圖);寫入值讀回相同;壞檔名清掉', () => {
    expect(_roundTripForTest(JSON.stringify({ theme: 'light' })).config.bg).toEqual(BG_DEFAULT)
    const saved = { enabled: true, file: 'wall-1a2b3c4d.webp', bright: 35, panelOpacity: 55, blur: 20 }
    expect(JSON.parse(_roundTripForTest(JSON.stringify({ bg: saved })).serialized).bg).toEqual(saved)
    expect(_roundTripForTest(JSON.stringify({ bg: { ...saved, file: 'C:\\x\\a.png' } })).config.bg.file).toBe('')
  })
})

describe('樣式守門:圖只畫在查價面板 / 設定視窗裡,overlay 其他區域維持透明', () => {
  const css = read('../src/theme/pobtools.css')
  it('不再有塗整頁的 `:root[data-bg] {`(overlay 的 html 必須透明);window 模式限定 :not(.ppz-overlay)', () => {
    expect(css).not.toMatch(/:root\[data-bg\]\s*\{/)
    expect(css).toMatch(/:root\[data-bg\]:not\(\.ppz-overlay\)\s*\{/)
    expect(css).toMatch(/html\.ppz-overlay,\s*html\.ppz-overlay body\s*\{\s*background:\s*transparent/)
  })
  it('面板不透明度只在 .bg-host 內生效;圖層是容器內的 absolute + z-index -1', () => {
    expect(css).toMatch(/:root\[data-bg\] \.bg-host \{[^}]*isolation: isolate[^}]*--panel-pct: var\(--bg-panel-pct/)
    expect(css).toMatch(/\.bgimg,\s*\.bgtint \{[^}]*position: absolute;[^}]*z-index: -1/)
    // 設定視窗(role=dialog)不被「彈出層一律實色」蓋掉
    expect(css).toMatch(/\[role="listbox"\]\)\:not\(\.bg-host\)/)
  })
  it('可讀性:容器內表面色用地板值、圖上那層用使用者值;文字光暈(按鈕 / 輸入框也吃);次要文字在背景模式提高對比', () => {
    expect(css).toMatch(/--surface-0: color-mix\(in srgb, var\(--surface-0-c\) var\(--read-pct\), transparent\)/)
    expect(css).toMatch(/\.bgtint \{\s*background: color-mix\(in srgb, var\(--surface-0-c\) var\(--panel-pct\), transparent\)/)
    expect(css).toMatch(/text-shadow: 0 0 1px var\(--halo\)/)
    expect(css).toMatch(/:root\[data-bg\] \.bg-host :is\(button, input, select, textarea\) \{\s*text-shadow: inherit/)
    for (const theme of ['light', 'contrast', 'parchment']) expect(css).toMatch(new RegExp(`:root\\[data-bg\\]\\[data-theme="${theme}"\\] \\.bg-host \\{\\s*--ink-2:`))
    expect(read('../src/web/settings/tabs/General.vue')).toMatch(/data-setting="bg-readability-hint"/)
  })
  it('查價面板與設定視窗是 .bg-host 且第一個子元素是 BgLayer', () => {
    expect(read('../src/web/App.vue')).toMatch(/id="price-window" class="[^"]*\bbg-host\b[^"]*"[\s\S]{0,300}?<bg-layer \/>/)
    expect(read('../src/web/settings/SettingsWindow.vue')).toMatch(/class="[^"]*settings-window bg-host"[\s\S]{0,300}?<bg-layer \/>/)
  })
})
