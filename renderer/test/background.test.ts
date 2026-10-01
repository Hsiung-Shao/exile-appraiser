// exile-appraiser(2026-10-01):自訂背景圖的 renderer 端(設定正規化 / 往返、網址、CSS 變數)與「overlay 其他區域維持透明」的樣式守門。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import {
  BG_DEFAULT, BG_READ_FLOOR, BG_READ_FLOOR_BLURRED, BG_READ_FLOOR_BLUR_AT, bgBakeSpec, bgBlurPx, bgImageUrl, bgReadability, bgReadFloor, bgVars, normBg, normBgFile,
  type BgSettings
} from '../src/web/useTheme'
import { BG_SCALE, BgBaker, bgBakeKey, bgBakePlan, bgCoverRect, type BgBakeInput } from '../src/web/bg-bake'

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

// ---- 效能修正第 10 步:背景圖預先模糊(bg-bake.ts)----

describe('bgBakeSpec / bgBlurPx(何時預先模糊)', () => {
  const bg = (o: Partial<BgSettings> = {}): BgSettings => ({ ...BG_DEFAULT, file: 'a.png', ...o })
  it('霧面 0 / 沒選圖 / 關閉 / 沒網址 → null(維持原本的 CSS,原圖直接用)', () => {
    expect(bgBakeSpec(bg({ blur: 0 }), 'app://bg/a.png')).toBeNull()
    expect(bgBakeSpec(bg({ blur: 1 }), 'app://bg/a.png')).toBeNull() // 1% → round(0.24) = 0 px
    expect(bgBakeSpec(bg({ file: '', blur: 50 }), 'app://bg/a.png')).toBeNull()
    expect(bgBakeSpec(bg({ enabled: false, blur: 50 }), 'app://bg/a.png')).toBeNull()
    expect(bgBakeSpec(bg({ blur: 50 }), null)).toBeNull()
  })
  it('霧面 > 0 → 與 CSS 變數同值(亮度 0–1、模糊 px)', () => {
    expect(bgBakeSpec(bg({ blur: 50, bright: 60 }), 'app://bg/a.png')).toEqual({ url: 'app://bg/a.png', bright: 0.6, blurPx: 12 })
    expect(bgBlurPx(100)).toBe(24)
    expect(bgVars(bg({ blur: 50 }), 'app://bg/a.png')?.['--bg-blur']).toBe(`${bgBlurPx(50)}px`)
  })
})

describe('bgBakePlan(與 CSS .bgimg 等價的繪製參數)', () => {
  const input: BgBakeInput = { url: 'u', bright: 0.6, blurPx: 12, width: 900, height: 700, dpr: 1.5, color: '#0e1116' }
  it('畫布 = 框 × 1.04(CSS scale);blur std-dev × dpr × 1.04;亮度在模糊前(同 CSS filter 順序)', () => {
    const p = bgBakePlan(input, 1920, 1200)
    expect(BG_SCALE).toBe(1.04)
    expect([p.width, p.height]).toEqual([936, 728])
    expect(p.filter).toBe('brightness(0.6) blur(18.72px)')
  })
  it('cover + 置中:蓋滿畫布、多出的部分兩邊平分', () => {
    expect(bgCoverRect(1920, 1200, 960, 960)).toEqual({ x: -288, y: 0, w: 1536, h: 960 })
    expect(bgCoverRect(1000, 2000, 500, 500)).toEqual({ x: 0, y: -250, w: 500, h: 1000 })
  })
  it('鍵包含所有會改變結果的輸入', () => {
    const k = bgBakeKey(input)
    for (const ch of [{ url: 'v' }, { bright: 0.5 }, { blurPx: 13 }, { width: 901 }, { height: 701 }, { dpr: 1 }, { color: '#fff' }]) {
      expect(bgBakeKey({ ...input, ...ch })).not.toBe(k)
    }
  })
})

describe('BgBaker(何時重算、revoke、霧面 0 不模糊、只套用最新的)', () => {
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  function harness (opts: { failLoad?: boolean, failRender?: boolean } = {}) {
    const log: string[] = []
    const loads: Array<{ url: string, resolve: () => void, reject: () => void }> = []
    const renders: Array<{ key: string, resolve: () => void, reject: () => void }> = []
    let n = 0
    const baker = new BgBaker<string, string>({
      load: async (url) => await new Promise<string>((resolve, reject) => {
        log.push(`load ${url}`)
        loads.push({ url, resolve: () => resolve(`img:${url}`), reject: () => reject(new Error('x')) })
        if (opts.failLoad) reject(new Error('x'))
      }),
      render: async (img, i) => await new Promise<string>((resolve, reject) => {
        const out = `blob${++n}`
        log.push(`render ${img} ${i.blurPx}`)
        renders.push({ key: bgBakeKey(i), resolve: () => resolve(out), reject: () => reject(new Error('x')) })
        if (opts.failRender) reject(new Error('x'))
      }),
      show: (o) => log.push(`show ${o}`),
      discard: (o) => log.push(`revoke ${o}`),
      release: (img) => log.push(`release ${img}`),
      clear: () => log.push('css')
    })
    return { baker, log, loads, renders }
  }
  const inp = (o: Partial<BgBakeInput> = {}): BgBakeInput => ({ url: 'a', bright: 0.6, blurPx: 12, width: 100, height: 80, dpr: 1, color: '#000', ...o })

  it('霧面 0 / 沒有設定 → 不載入不繪製,維持 CSS', async () => {
    const h = harness()
    h.baker.update(inp({ blurPx: 0 }))
    h.baker.update(null)
    await flush()
    expect(h.log).toEqual([])
    expect(h.baker.key).toBeNull()
  })
  it('首次:載入 → 繪製 → 換上;同一個鍵不重畫', async () => {
    const h = harness()
    h.baker.update(inp())
    await flush(); h.loads[0].resolve(); await flush(); h.renders[0].resolve(); await flush()
    expect(h.log).toEqual(['load a', 'render img:a 12', 'show blob1'])
    expect(h.baker.key).toBe(bgBakeKey(inp()))
    h.baker.update(inp())
    await flush()
    expect(h.log).toHaveLength(3)
  })
  it('設定 / 大小 / 主題底色變了才重畫;同一張圖不重新載入;新圖換上後 revoke 舊的', async () => {
    const h = harness()
    h.baker.update(inp())
    await flush(); h.loads[0].resolve(); await flush(); h.renders[0].resolve(); await flush()
    h.baker.update(inp({ width: 120 }))
    await flush(); h.renders[1].resolve(); await flush()
    h.baker.update(inp({ width: 120, color: '#fff' }))
    await flush(); h.renders[2].resolve(); await flush()
    expect(h.log.filter(l => l.startsWith('load'))).toEqual(['load a'])
    expect(h.log.slice(3)).toEqual(['render img:a 12', 'show blob2', 'revoke blob1', 'render img:a 12', 'show blob3', 'revoke blob2'])
  })
  it('繪製途中又變了:不排隊,畫完的過期結果 revoke 不套用,接著只畫最新的', async () => {
    const h = harness()
    h.baker.update(inp())
    await flush(); h.loads[0].resolve(); await flush()
    h.baker.update(inp({ blurPx: 13 }))
    h.baker.update(inp({ blurPx: 14 }))
    h.renders[0].resolve(); await flush()
    expect(h.renders).toHaveLength(2)
    h.renders[1].resolve(); await flush()
    expect(h.log).toEqual(['load a', 'render img:a 12', 'revoke blob1', 'render img:a 14', 'show blob2'])
  })
  it('霧面調回 0 → 立刻回到 CSS、revoke 目前的圖、釋放來源圖', async () => {
    const h = harness()
    h.baker.update(inp())
    await flush(); h.loads[0].resolve(); await flush(); h.renders[0].resolve(); await flush()
    h.baker.update(inp({ blurPx: 0 }))
    expect(h.log.slice(3)).toEqual(['css', 'revoke blob1', 'release img:a'])
    expect(h.baker.key).toBeNull()
  })
  it('框大小 0(容器隱藏)→ 回到 CSS 但保留來源圖;顯示回來不必重新載入', async () => {
    const h = harness()
    h.baker.update(inp())
    await flush(); h.loads[0].resolve(); await flush(); h.renders[0].resolve(); await flush()
    h.baker.update(inp({ width: 0 }))
    h.baker.update(inp())
    await flush(); h.renders[1].resolve(); await flush()
    expect(h.log.slice(3)).toEqual(['css', 'revoke blob1', 'render img:a 12', 'show blob2'])
  })
  it('換圖:釋放舊來源圖、載入新圖;載入期間舊的預先模糊圖留著(不閃爍),新圖好了才換', async () => {
    const h = harness()
    h.baker.update(inp())
    await flush(); h.loads[0].resolve(); await flush(); h.renders[0].resolve(); await flush()
    h.baker.update(inp({ url: 'b' }))
    await flush()
    expect(h.log.slice(3)).toEqual(['release img:a', 'load b'])
    expect(h.baker.key).toBe(bgBakeKey(inp()))
    h.loads[1].resolve(); await flush(); h.renders[1].resolve(); await flush()
    expect(h.log.slice(5)).toEqual(['render img:b 12', 'show blob2', 'revoke blob1'])
  })
  it('載入 / 繪製失敗 → 回到 CSS,同一張圖 / 同一個鍵不重試', async () => {
    const h = harness({ failLoad: true })
    h.baker.update(inp())
    await flush()
    h.baker.update(inp({ width: 120 }))
    await flush()
    expect(h.log).toEqual(['load a'])
    const r = harness({ failRender: true })
    r.baker.update(inp())
    await flush(); r.loads[0].resolve(); await flush()
    r.baker.update(inp())
    await flush()
    expect(r.log).toEqual(['load a', 'render img:a 12'])
    expect(r.baker.key).toBeNull()
  })
  it('卸載:釋放來源圖、revoke 目前的圖;途中完成的結果直接 revoke', async () => {
    const h = harness()
    h.baker.update(inp())
    await flush(); h.loads[0].resolve(); await flush(); h.renders[0].resolve(); await flush()
    h.baker.update(inp({ width: 120 }))
    await flush()
    h.baker.dispose()
    expect(h.log.slice(3)).toEqual(['render img:a 12', 'release img:a', 'css', 'revoke blob1'])
    h.renders[1].resolve(); await flush()
    expect(h.log.slice(-1)).toEqual(['revoke blob2'])
    h.baker.update(inp())
    await flush()
    expect(h.log.slice(-1)).toEqual(['revoke blob2'])
  })
})

describe('樣式守門:預先模糊(效能修正第 10 步)', () => {
  const css = read('../src/theme/pobtools.css')
  it('預先模糊後拿掉即時的背景與 filter,改貼 --bg-baked(100% 100%);霧面 0 的原本規則不變', () => {
    expect(css).toMatch(/\.bgimg\[data-baked\] \{\s*background: var\(--bg-baked\) 0 0 \/ 100% 100% no-repeat;\s*filter: none;/)
    expect(css).toMatch(/\.bgimg \{\s*background: var\(--bg-image, none\) center \/ cover no-repeat var\(--surface-0-c\);\s*filter: brightness\(var\(--bg-bright, 1\)\) blur\(var\(--bg-blur, 0px\)\);/)
  })
  it('CSS 的 scale 與 BG_SCALE 一致(預先模糊的解析度靠它對齊)', () => {
    const m = css.match(/\.bgimg \{[^}]*transform: scale\(([\d.]+)\)/)
    expect(Number(m?.[1])).toBe(BG_SCALE)
  })
  it('BgLayer 不把 canvas 放進 DOM(會自成合成層,文字變灰階反鋸齒),只寫 --bg-baked;來源圖以 CORS 載入', () => {
    const vue = read('../src/web/ui/BgLayer.vue')
    expect(vue).not.toMatch(/<canvas/)
    expect(vue).toMatch(/setProperty\('--bg-baked'/)
    expect(vue).toMatch(/URL\.revokeObjectURL/)
    expect(vue).toMatch(/crossOrigin = 'anonymous'/)
  })
  it('文字光暈維持三層(量測:減層後最差對比下降,見 CLAUDE.md)', () => {
    expect(css).toMatch(/text-shadow: 0 0 1px var\(--halo\), 0 0 3px var\(--halo\), 0 0 6px var\(--halo\);/)
  })
})
