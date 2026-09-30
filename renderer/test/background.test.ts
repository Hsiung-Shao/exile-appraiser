// exile-appraiser(2026-10-01):自訂背景圖的 renderer 端(設定正規化 / 往返、網址、CSS 變數)與「overlay 其他區域維持透明」的樣式守門。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import { BG_DEFAULT, bgImageUrl, bgVars, normBg, normBgFile } from '../src/web/useTheme'

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
  it('有圖 → 四個變數', () => {
    expect(bgVars(bg, 'app://bg/a.png')).toEqual({
      '--bg-image': 'url("app://bg/a.png")',
      '--bg-bright': '0.4',
      '--bg-blur': '12px',
      '--bg-panel-pct': '70%'
    })
  })
  it('關閉 / 沒圖 / 沒網址 → null(不設 data-bg)', () => {
    expect(bgVars({ ...bg, enabled: false }, 'app://bg/a.png')).toBeNull()
    expect(bgVars({ ...bg, file: '' }, 'app://bg/a.png')).toBeNull()
    expect(bgVars(bg, null)).toBeNull()
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
  it('查價面板與設定視窗是 .bg-host 且第一個子元素是 BgLayer', () => {
    expect(read('../src/web/App.vue')).toMatch(/id="price-window" class="[^"]*\bbg-host\b[^"]*"[\s\S]{0,300}?<bg-layer \/>/)
    expect(read('../src/web/settings/SettingsWindow.vue')).toMatch(/class="[^"]*settings-window bg-host"[\s\S]{0,300}?<bg-layer \/>/)
  })
})
