// exile-appraiser(2026-10-01):自訂背景圖的 renderer 端(設定正規化 / 往返、網址、CSS 變數)與「overlay 其他區域維持透明」的樣式守門。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nextTick, reactive } from 'vue'
import { _roundTripForTest } from '../src/web/Config'
import {
  BG_DEFAULT, BG_READ_FLOOR, BG_READ_FLOOR_BLURRED, BG_READ_FLOOR_BLUR_AT, bgBakeSpec, bgBlurPx, bgImageUrl, bgLayouts, bgReadability, bgReadFloor, bgShownUrl, bgVars,
  normBg, normBgFile, normBgLayout, useBackground,
  type BgSettings
} from '../src/web/useTheme'
import {
  BG_LAYOUT_DEFAULT, BG_RESIZE_SETTLE_MS, BG_SCALE, BgBakeCache, BgBaker, bgBakeCache, bgBakeFilter, bgBakeKey, bgBakePlan, bgCoverRect, bgCssLayout, bgLayoutIsDefault, bgLayoutRect, createResizeSettle,
  type BgBakeInput, type BgFit, type BgLayout
} from '../src/web/bg-bake'
import { BG_PREVIEW_FALLBACK_RATIO, BG_PREVIEW_W_MAX_EM, bgLayoutKeyStep, isDefaultBgLayout, pointerToFocus, previewBoxEm } from '../src/web/settings/bg-layout-ui'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('normBg / normBgFile(與 main backgrounds.ts 同規則)', () => {
  it('檔名只准 png / jpg / jpeg / webp、沒有路徑字元', () => {
    expect(normBgFile('a-1a2b3c4d.png')).toBe('a-1a2b3c4d.png')
    for (const f of ['../a.png', 'a/b.png', 'a\\b.png', '.a.png', 'a.gif', 'C:a.png', 'a..png']) expect(normBgFile(f)).toBe('')
  })
  it('壞值 → 預設;百分比夾在 0–100 且取整數', () => {
    expect(normBg(undefined)).toEqual(BG_DEFAULT)
    expect(normBg({ enabled: false, file: '../x.png', bright: 140, panelOpacity: 33.4, blur: -1 }))
      .toEqual({ enabled: false, file: '', bright: BG_DEFAULT.bright, panelOpacity: 33, blur: BG_DEFAULT.blur, layout: BG_DEFAULT.layout })
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
    // 第 26 步:沒有 layout 的舊設定 → 兩組都是預設(cover、置中 = 改版前的樣子)
    expect(JSON.parse(_roundTripForTest(JSON.stringify({ bg: saved })).serialized).bg).toEqual({ ...saved, layout: BG_DEFAULT.layout })
    const layout = { panel: { x: 10, y: 90, fit: 'zoom', zoom: 250 }, settings: { x: 0, y: 100, fit: 'contain', zoom: 100 } }
    expect(JSON.parse(_roundTripForTest(JSON.stringify({ bg: { ...saved, layout } })).serialized).bg).toEqual({ ...saved, layout })
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
    // 第 30.6 步:查價面板把自己的 v-show 條件(panelVisible)傳給 BgLayer,藏起時整層卸載
    expect(read('../src/web/App.vue')).toMatch(/id="price-window" class="[^"]*\bbg-host\b[^"]*"[\s\S]{0,300}?<bg-layer host="panel" :shown="panelVisible" \/>/)
    // 第 21 步:根元素多了 :class / :style / tabindex / 事件屬性(大小 / 位置與獨立字級),開頭標籤變長 → 放寬到 600 字元
    // 第 26 步:各自宣告自己是哪個容器(讀對應那組顯示位置與填滿方式)
    expect(read('../src/web/settings/SettingsWindow.vue')).toMatch(/class="[^"]*settings-window bg-host"[\s\S]{0,600}?<bg-layer host="settings" \/>/)
  })
})

// ---- 效能修正第 10 步:背景圖預先模糊(bg-bake.ts)----

describe('bgBakeSpec / bgBlurPx(何時預先模糊)', () => {
  const bg = (o: Partial<BgSettings> = {}): BgSettings => ({ ...BG_DEFAULT, file: 'a.png', ...o })
  it('沒選圖 / 關閉 / 沒網址 → null(沒有背景)', () => {
    expect(bgBakeSpec(bg({ file: '', blur: 50 }), 'app://bg/a.png')).toBeNull()
    expect(bgBakeSpec(bg({ enabled: false, blur: 50 }), 'app://bg/a.png')).toBeNull()
    expect(bgBakeSpec(bg({ blur: 50 }), null)).toBeNull()
  })
  it('第 30.6 步:霧面 0 也預先處理(blurPx 0 = 只縮放裁切 + 亮度)', () => {
    expect(bgBakeSpec(bg({ blur: 0, bright: 60 }), 'app://bg/a.png')).toEqual({ url: 'app://bg/a.png', bright: 0.6, blurPx: 0 })
    expect(bgBakeSpec(bg({ blur: 1 }), 'app://bg/a.png')?.blurPx).toBe(0) // 1% → round(0.24) = 0 px
    expect(bgBakeFilter(0.6, 0, 1.56)).toBe('brightness(0.6)')
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

describe('createResizeSettle(code review 第 B 批:拖曳改大小時去抖)', () => {
  function harness () {
    const t = { now: 0, timers: [] as Array<{ at: number, fn: () => void, id: number }>, id: 0 }
    let fires = 0
    const s = createResizeSettle(() => { fires++ }, {
      setTimeout: (fn, ms) => { const id = ++t.id; t.timers.push({ at: t.now + ms, fn, id }); return id },
      clearTimeout: (h) => { t.timers = t.timers.filter(x => x.id !== h) }
    })
    const advance = (ms: number) => {
      t.now += ms
      for (const x of t.timers.filter(x => x.at <= t.now)) { t.timers = t.timers.filter(y => y !== x); x.fn() }
    }
    return { s, advance, fires: () => fires }
  }
  const sz = (w: number, h: number) => ({ w, h })

  it('拖曳中每幀變動:不重畫;停止 200 ms 後只畫一次', () => {
    const h = harness()
    let prev = sz(800, 600)
    for (let i = 1; i <= 30; i++) { // 30 幀、每幀 16 ms
      const next = sz(800 + i * 3, 600 + i * 2)
      h.s.resized(prev, next, true)
      prev = next
      h.advance(16)
    }
    expect(h.fires()).toBe(0)
    expect(h.s.pending).toBe(true)
    h.advance(BG_RESIZE_SETTLE_MS - 17)
    expect(h.fires()).toBe(0)
    h.advance(1)
    expect(h.fires()).toBe(1)
    expect(h.s.pending).toBe(false)
  })

  it('顯示(0 → 有大小)/ 隱藏(→ 0)/ 還沒有預先模糊的圖 → 立即', () => {
    const h = harness()
    h.s.resized(sz(0, 0), sz(800, 600), true)
    expect(h.fires()).toBe(1)
    h.s.resized(sz(800, 600), sz(0, 0), true)
    expect(h.fires()).toBe(2)
    h.s.resized(sz(800, 600), sz(900, 600), false)
    expect(h.fires()).toBe(3)
    expect(h.s.pending).toBe(false)
  })

  it('去抖中變成隱藏 → 取消計時、立即;cancel() 之後不再觸發', () => {
    const h = harness()
    h.s.resized(sz(800, 600), sz(810, 600), true)
    h.s.resized(sz(810, 600), sz(0, 0), true)
    expect(h.fires()).toBe(1)
    h.advance(1000)
    expect(h.fires()).toBe(1)
    h.s.resized(sz(800, 600), sz(820, 600), true)
    h.s.cancel()
    h.advance(1000)
    expect(h.fires()).toBe(1)
  })
})

describe('BgBaker(何時重算、revoke、霧面 0 也預先處理、只套用最新的)', () => {
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

  it('沒有設定(背景關閉)→ 不載入不繪製,維持 CSS', async () => {
    const h = harness()
    h.baker.update(null)
    await flush()
    expect(h.log).toEqual([])
    expect(h.baker.key).toBeNull()
  })
  it('第 30.6 步:霧面 0 → 也載入並預先處理(只縮放裁切 + 亮度),之後同一個鍵不重畫', async () => {
    const h = harness()
    h.baker.update(inp({ blurPx: 0 }))
    await flush(); h.loads[0].resolve(); await flush(); h.renders[0].resolve(); await flush()
    expect(h.log).toEqual(['load a', 'render img:a 0', 'show blob1'])
    expect(h.baker.key).toBe(bgBakeKey(inp({ blurPx: 0 })))
    h.baker.update(inp({ blurPx: 0 }))
    await flush()
    expect(h.log).toHaveLength(3)
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
  it('霧面調回 0 → 重畫(不重新載入來源圖),新圖好了才換、revoke 舊的;背景關閉 → 立刻回到 CSS、revoke、釋放來源圖', async () => {
    const h = harness()
    h.baker.update(inp())
    await flush(); h.loads[0].resolve(); await flush(); h.renders[0].resolve(); await flush()
    h.baker.update(inp({ blurPx: 0 }))
    await flush(); h.renders[1].resolve(); await flush()
    expect(h.log.slice(3)).toEqual(['render img:a 0', 'show blob2', 'revoke blob1'])
    h.baker.update(null)
    expect(h.log.slice(6)).toEqual(['css', 'revoke blob2', 'release img:a'])
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
    // 第 26 步:位置 / 大小改由 --bg-pos / --bg-size 帶入,沒寫時的後備值 = 原本的 center / cover
    expect(css).toMatch(/\.bgimg \{\s*(?:\/\*[^*]*\*\/\s*)?background: var\(--bg-image, none\) var\(--bg-pos, center\) \/ var\(--bg-size, cover\) no-repeat var\(--surface-0-c\);\s*filter: brightness\(var\(--bg-bright, 1\)\) blur\(var\(--bg-blur, 0px\)\);/)
  })
  it('CSS 的 scale 與 BG_SCALE 一致(預先模糊的解析度靠它對齊)', () => {
    const m = css.match(/\.bgimg \{[^}]*transform: scale\(([\d.]+)\)/)
    expect(Number(m?.[1])).toBe(BG_SCALE)
  })
  it('BgLayer 不把 canvas 放進 DOM(會自成合成層,文字變灰階反鋸齒),只寫 --bg-baked;來源圖以 CORS 載入', () => {
    const vue = read('../src/web/ui/BgLayerImage.vue') // 第 30.6 步:本體移到 BgLayerImage.vue(BgLayer.vue 是閘門)
    expect(vue).not.toMatch(/<canvas/)
    expect(vue).toMatch(/setProperty\('--bg-baked'/)
    expect(vue).toMatch(/URL\.revokeObjectURL/)
    expect(vue).toMatch(/crossOrigin = 'anonymous'/)
  })
  it('文字光暈維持三層(量測:減層後最差對比下降,見 CLAUDE.md)', () => {
    expect(css).toMatch(/text-shadow: 0 0 1px var\(--halo\), 0 0 3px var\(--halo\), 0 0 6px var\(--halo\);/)
  })
})
// ---- 第 26 步(2026-10-03):顯示位置與填滿方式 ----

describe('normBgLayout / normBg.layout(正規化、舊檔相容)', () => {
  it('壞值 / 超出範圍 → 該欄預設;取整數;每次回傳新物件(不共用 BG_DEFAULT)', () => {
    expect(normBgLayout(undefined)).toEqual(BG_LAYOUT_DEFAULT)
    expect(normBgLayout({ x: -1, y: 101, fit: 'stretch', zoom: 99 })).toEqual(BG_LAYOUT_DEFAULT)
    expect(normBgLayout({ x: 12.4, y: 87.6, fit: 'zoom', zoom: 249.6 })).toEqual({ x: 12, y: 88, fit: 'zoom', zoom: 250 })
    expect(normBgLayout({ x: 0, y: 100, fit: 'contain', zoom: 300 })).toEqual({ x: 0, y: 100, fit: 'contain', zoom: 300 })
    expect(normBgLayout({ zoom: 301 }).zoom).toBe(100)
    expect(normBgLayout({ x: '50' }).x).toBe(50)
    const a = normBg(undefined)
    expect(a.layout.panel).not.toBe(BG_LAYOUT_DEFAULT)
    a.layout.panel.x = 1
    expect(BG_LAYOUT_DEFAULT.x).toBe(50)
    expect(normBg(undefined).layout.panel.x).toBe(50)
  })
  it('舊設定檔(沒有 layout / layout 壞掉 / 只有一組)→ 缺的那組 = 預設', () => {
    expect(normBg({ file: 'a.png' }).layout).toEqual({ panel: BG_LAYOUT_DEFAULT, settings: BG_LAYOUT_DEFAULT })
    expect(normBg({ layout: 'x' }).layout).toEqual({ panel: BG_LAYOUT_DEFAULT, settings: BG_LAYOUT_DEFAULT })
    expect(normBg({ layout: { settings: { fit: 'contain' } } }).layout).toEqual({ panel: BG_LAYOUT_DEFAULT, settings: { ...BG_LAYOUT_DEFAULT, fit: 'contain' } })
  })
  it('設定預設值(Config 的初始 bg)不是 BG_DEFAULT 的淺拷貝(巢狀 layout 不能共用)', () => {
    const { config } = _roundTripForTest('{}')
    expect(config.bg).toEqual(BG_DEFAULT)
    expect(config.bg.layout).not.toBe(BG_DEFAULT.layout)
  })
})

describe('bgLayoutRect(繪製矩形純函式)', () => {
  const L = (fit: BgFit, x: number, y: number, zoom = 100): BgLayout => ({ fit, x, y, zoom })
  const imgs = { wide: [1920, 1080], tall: [800, 1600] } as const
  const boxes = { wide: [1000, 400], narrow: [300, 900] } as const
  const eps = 1e-9

  it('預設(cover、50 / 50)與原本的 cover 置中公式逐位元相同', () => {
    for (const [iw, ih] of Object.values(imgs)) {
      for (const [bw, bh] of Object.values(boxes)) {
        const s = Math.max(bw / iw, bh / ih)
        const w = iw * s
        const h = ih * s
        const old = { x: (bw - w) / 2, y: (bh - h) / 2, w, h }
        expect(bgLayoutRect(iw, ih, bw, bh)).toEqual(old)
        expect(bgLayoutRect(iw, ih, bw, bh, L('cover', 50, 50))).toEqual(old)
        expect(bgLayoutRect(iw, ih, bw, bh, L('zoom', 50, 50, 100))).toEqual(old)
        expect(bgLayoutRect(iw, ih, bw, bh, L('cover', 50, 50, 250))).toEqual(old) // 倍率只在 zoom 模式有作用
        expect(bgCoverRect(iw, ih, bw, bh)).toEqual(old)
      }
    }
  })

  for (const fit of ['cover', 'contain', 'zoom'] as const) {
    for (const f of [0, 50, 100]) {
      for (const [ik, [iw, ih]] of Object.entries(imgs)) {
        for (const [bk, [bw, bh]] of Object.entries(boxes)) {
          it(`${fit} × 焦點 ${f} × ${ik} 圖 × ${bk} 框`, () => {
            const zoom = fit === 'zoom' ? 200 : 100
            const r = bgLayoutRect(iw, ih, bw, bh, L(fit, f, f, zoom))
            const cover = Math.max(bw / iw, bh / ih)
            const contain = Math.min(bw / iw, bh / ih)
            const s = fit === 'contain' ? contain : cover * zoom / 100
            expect(r.w).toBeCloseTo(iw * s, 9)
            expect(r.h).toBeCloseTo(ih * s, 9)
            // 焦點不變式:圖上 f% 那一點落在框的 f% 處
            expect(r.x + r.w * f / 100).toBeCloseTo(bw * f / 100, 9)
            expect(r.y + r.h * f / 100).toBeCloseTo(bh * f / 100, 9)
            if (fit === 'contain') {
              // 完整放入:不超出框、至少一邊貼齊;空白在焦點的反方向
              expect(r.x).toBeGreaterThanOrEqual(-eps)
              expect(r.y).toBeGreaterThanOrEqual(-eps)
              expect(r.x + r.w).toBeLessThanOrEqual(bw + eps)
              expect(r.y + r.h).toBeLessThanOrEqual(bh + eps)
              expect(Math.abs(r.w - bw) < 1e-6 || Math.abs(r.h - bh) < 1e-6).toBe(true)
            } else {
              // 蓋滿:不留邊
              expect(r.x).toBeLessThanOrEqual(eps)
              expect(r.y).toBeLessThanOrEqual(eps)
              expect(r.x + r.w).toBeGreaterThanOrEqual(bw - 1e-6)
              expect(r.y + r.h).toBeGreaterThanOrEqual(bh - 1e-6)
            }
            if (f === 0) { expect(r.x).toBeCloseTo(0, 9); expect(r.y).toBeCloseTo(0, 9) }
            if (f === 100) { expect(r.x + r.w).toBeCloseTo(bw, 9); expect(r.y + r.h).toBeCloseTo(bh, 9) }
          })
        }
      }
    }
  }

  it('具體值:寬圖放進窄框', () => {
    // cover:高貼齊 900 → 寬 1600;焦點 0 → 靠左
    expect(bgLayoutRect(1920, 1080, 300, 900, L('cover', 0, 50))).toEqual({ x: 0, y: 0, w: 1600, h: 900 })
    expect(bgLayoutRect(1920, 1080, 300, 900, L('cover', 100, 50))).toEqual({ x: -1300, y: 0, w: 1600, h: 900 })
    // contain:寬貼齊 300 → 高 168.75;焦點 0 → 貼上緣、100 → 貼下緣
    expect(bgLayoutRect(1920, 1080, 300, 900, L('contain', 50, 0))).toEqual({ x: 0, y: 0, w: 300, h: 168.75 })
    expect(bgLayoutRect(1920, 1080, 300, 900, L('contain', 50, 100))).toEqual({ x: 0, y: 731.25, w: 300, h: 168.75 })
    // zoom 200%:cover 的兩倍,置中
    expect(bgLayoutRect(1920, 1080, 300, 900, L('zoom', 50, 50, 200))).toEqual({ x: -1450, y: -450, w: 3200, h: 1800 })
  })
})

describe('bgCssLayout(CSS 路徑的 background-position / background-size)', () => {
  const box = { w: 300, h: 900 }
  it('預設 → null(不寫 inline,沿用樣式表的 center / cover = 與改版前相同)', () => {
    expect(bgCssLayout(BG_LAYOUT_DEFAULT, null, box)).toBeNull()
    expect(bgCssLayout({ ...BG_LAYOUT_DEFAULT, zoom: 250 }, null, box)).toBeNull() // cover 時倍率無作用
    expect(bgCssLayout({ ...BG_LAYOUT_DEFAULT, fit: 'zoom', zoom: 100 }, null, box)).toBeNull()
    expect(bgLayoutIsDefault({ ...BG_LAYOUT_DEFAULT, fit: 'contain' })).toBe(false)
  })
  it('焦點 → x% y%;contain → contain;cover → cover', () => {
    expect(bgCssLayout({ x: 0, y: 100, fit: 'cover', zoom: 100 }, null, box)).toEqual({ pos: '0% 100%', size: 'cover' })
    expect(bgCssLayout({ x: 50, y: 50, fit: 'contain', zoom: 100 }, null, box)).toEqual({ pos: '50% 50%', size: 'contain' })
  })
  it('zoom:以 cover 為基準換成框的百分比;還不知道圖大小 → 暫用 cover', () => {
    const l: BgLayout = { x: 50, y: 50, fit: 'zoom', zoom: 200 }
    expect(bgCssLayout(l, null, box)).toEqual({ pos: '50% 50%', size: 'cover' })
    // 寬圖、窄框:cover 寬 1600 = 533.33%、高 100%;× 2
    expect(bgCssLayout(l, { w: 1920, h: 1080 }, box)).toEqual({ pos: '50% 50%', size: '1066.6667% 200%' })
    // 百分比只跟比例有關(CSS px / 裝置像素算出來相同)
    expect(bgCssLayout(l, { w: 1920, h: 1080 }, { w: 450, h: 1350 })).toEqual(bgCssLayout(l, { w: 1920, h: 1080 }, box))
    expect(bgCssLayout(l, { w: 0, h: 0 }, box)?.size).toBe('cover')
  })
})

describe('bake key / bgBakePlan 套用 layout', () => {
  const input: BgBakeInput = { url: 'u', bright: 0.6, blurPx: 12, width: 900, height: 700, dpr: 1.5, color: '#0e1116' }
  it('省略 layout = 預設;顯式預設的鍵與計畫都相同', () => {
    expect(bgBakeKey({ ...input, layout: { ...BG_LAYOUT_DEFAULT } })).toBe(bgBakeKey(input))
    expect(bgBakePlan({ ...input, layout: { ...BG_LAYOUT_DEFAULT } }, 1920, 1200)).toEqual(bgBakePlan(input, 1920, 1200))
    expect(bgBakePlan(input, 1920, 1200).rect).toEqual(bgCoverRect(1920, 1200, 936, 728))
  })
  it('fit / 倍率 / 焦點變了 → 鍵變了(觸發重畫);cover 模式下的倍率不影響結果 → 鍵不變', () => {
    const k = bgBakeKey(input)
    for (const l of [{ x: 0 }, { y: 100 }, { fit: 'contain' as const }, { fit: 'zoom' as const, zoom: 200 }]) {
      expect(bgBakeKey({ ...input, layout: { ...BG_LAYOUT_DEFAULT, ...l } })).not.toBe(k)
    }
    expect(bgBakeKey({ ...input, layout: { ...BG_LAYOUT_DEFAULT, zoom: 200 } })).toBe(k)
    expect(bgBakeKey({ ...input, layout: { ...BG_LAYOUT_DEFAULT, fit: 'zoom', zoom: 200 } }))
      .not.toBe(bgBakeKey({ ...input, layout: { ...BG_LAYOUT_DEFAULT, fit: 'zoom', zoom: 250 } }))
  })
  it('計畫的落點 = bgLayoutRect(畫布 = 框 × 1.04)', () => {
    const layout: BgLayout = { x: 0, y: 100, fit: 'zoom', zoom: 200 }
    const p = bgBakePlan({ ...input, layout }, 1920, 1200)
    expect(p.rect).toEqual(bgLayoutRect(1920, 1200, 936, 728, layout))
    expect(p.rect.x).toBe(0)
    expect(p.rect.y + p.rect.h).toBeCloseTo(728, 9)
  })
  it('BgBaker:只改 layout 也會重畫(鍵不同)', async () => {
    const shown: string[] = []
    let n = 0
    const baker = new BgBaker<string, string>({
      load: async () => 'img',
      render: async (_img, i) => `blob${++n}:${i.layout?.fit ?? 'default'}`,
      show: (o) => shown.push(o),
      discard: () => {},
      release: () => {},
      clear: () => {}
    })
    const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
    baker.update(input)
    await flush()
    baker.update({ ...input, layout: { ...BG_LAYOUT_DEFAULT } })
    await flush()
    baker.update({ ...input, layout: { ...BG_LAYOUT_DEFAULT, fit: 'contain' } })
    await flush()
    expect(shown).toEqual(['blob1:default', 'blob2:contain'])
  })
})

describe('兩組設定各自套用(useBackground → bgLayouts[host];BgLayer 依 host 讀)', () => {
  it('查價面板與設定視窗各自一組;改一組另一組不動', async () => {
    const s = reactive(normBg({ file: 'a.png' }))
    useBackground(() => s, f => f ? `app://bg/${f}` : null)
    expect(bgLayouts.value).toEqual({ panel: BG_LAYOUT_DEFAULT, settings: BG_LAYOUT_DEFAULT })
    expect(bgShownUrl.value).toBe('app://bg/a.png')
    s.layout.panel = { x: 0, y: 0, fit: 'zoom', zoom: 200 }
    await nextTick()
    expect(bgLayouts.value.panel).toEqual({ x: 0, y: 0, fit: 'zoom', zoom: 200 })
    expect(bgLayouts.value.settings).toEqual(BG_LAYOUT_DEFAULT)
    s.layout.settings.fit = 'contain'
    await nextTick()
    expect(bgLayouts.value.settings.fit).toBe('contain')
    expect(bgLayouts.value.panel.fit).toBe('zoom')
    s.enabled = false
    await nextTick()
    expect(bgShownUrl.value).toBeNull()
  })
  it('BgLayer 依 host 取 bgLayouts、CSS 路徑寫 --bg-pos / --bg-size、預先模糊的輸入帶 layout', () => {
    const vue = read('../src/web/ui/BgLayerImage.vue')
    expect(vue).toMatch(/bgLayouts\.value\[props\.host\]/)
    expect(vue).toMatch(/setProperty\('--bg-pos'/)
    expect(vue).toMatch(/setProperty\('--bg-size'/)
    expect(vue).toMatch(/removeProperty\('--bg-pos'\)/)
    expect(vue).toMatch(/layout: layout\.value/)
  })
})

describe('設定 UI 純函式(bg-layout-ui.ts)與接線', () => {
  it('預覽框大小:高 9em、寬照比例;太寬改縮高;壞值 = 1:1', () => {
    expect(previewBoxEm(0.5)).toEqual({ w: 4.5, h: 9 })
    expect(previewBoxEm(50 / 38)).toEqual({ w: 11.84, h: 9 })
    expect(previewBoxEm(3)).toEqual({ w: BG_PREVIEW_W_MAX_EM, h: 5 })
    expect(previewBoxEm(NaN)).toEqual({ w: 9, h: 9 })
    expect(BG_PREVIEW_FALLBACK_RATIO.panel).toBeLessThan(1)
  })
  it('指標 → 焦點(夾在 0–100、取整數)', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 }
    expect(pointerToFocus(10, 20, rect)).toEqual({ x: 0, y: 0 })
    expect(pointerToFocus(110, 70, rect)).toEqual({ x: 50, y: 50 })
    expect(pointerToFocus(500, -50, rect)).toEqual({ x: 100, y: 0 })
    expect(pointerToFocus(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 50, y: 50 })
  })
  it('方向鍵:1%(Shift 10%),夾在 0–100;其他鍵 null', () => {
    const l = { ...BG_LAYOUT_DEFAULT, x: 5, y: 95 }
    expect(bgLayoutKeyStep(l, 'ArrowLeft', false)).toEqual({ x: 4 })
    expect(bgLayoutKeyStep(l, 'ArrowLeft', true)).toEqual({ x: 0 })
    expect(bgLayoutKeyStep(l, 'ArrowDown', true)).toEqual({ y: 100 })
    expect(bgLayoutKeyStep(l, 'Enter', false)).toBeNull()
    expect(isDefaultBgLayout(BG_LAYOUT_DEFAULT)).toBe(true)
    expect(isDefaultBgLayout({ ...BG_LAYOUT_DEFAULT, zoom: 200 })).toBe(false)
  })
  it('一般分頁有圖時顯示兩組編輯器;拖曳 / 滑桿只在放開時寫設定', () => {
    const gen = read('../src/web/settings/tabs/General.vue')
    expect(gen).toMatch(/<template v-if="bgUrl">[\s\S]*<bg-layout-editor host="panel"[\s\S]*<bg-layout-editor host="settings"/)
    const ed = read('../src/web/settings/BgLayoutEditor.vue')
    expect(ed).toMatch(/@input="draftField\('x', \$event\)" @change="commitField\('x', \$event\)"/)
    expect(ed).toMatch(/@pointerup="onUp"/)
    expect(ed).toMatch(/setPointerCapture/)
    expect(ed).toMatch(/:disabled="shown\.fit !== 'zoom'"/)
    expect(ed).not.toMatch(/\d(?:\.\d+)?rem\b/) // 設定視窗內不用 rem(第 21 步獨立字級)
  })
})

// ---- 第 30.6 步(2026-10-03):背景圖關閉零成本、隱藏時卸載保留畫好的圖、霧面 0 也預先處理 ----

describe('霧面 0 走預先處理:繪製矩形與 CSS 版(background-position / background-size)一致', () => {
  const imgs = { wide: [1920, 1080], tall: [800, 1600] } as const
  const boxes = { panel: [460, 900], settings: [900, 700] } as const
  const layouts: BgLayout[] = []
  for (const fit of ['cover', 'contain', 'zoom'] as BgFit[]) for (const f of [0, 50, 100]) layouts.push({ x: f, y: 100 - f, fit, zoom: fit === 'zoom' ? 200 : 100 })
  /** CSS 路徑在框裡的矩形:size / pos 百分比照瀏覽器規則換算(cover / contain 關鍵字也照規則算) */
  function cssRect (l: BgLayout, iw: number, ih: number, bw: number, bh: number) {
    const css = bgCssLayout(l, { w: iw, h: ih }, { w: bw, h: bh }) ?? { pos: '50% 50%', size: 'cover' }
    let w: number, hgt: number
    if (css.size === 'cover' || css.size === 'contain') {
      const s = css.size === 'cover' ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih)
      w = iw * s; hgt = ih * s
    } else {
      const [sw, sh] = css.size.split(' ').map(v => parseFloat(v) / 100)
      w = bw * sw; hgt = bh * sh
    }
    const [px, py] = css.pos.split(' ').map(v => parseFloat(v) / 100)
    return { x: (bw - w) * px, y: (bh - hgt) * py, w, h: hgt }
  }
  for (const [ik, [iw, ih]] of Object.entries(imgs)) {
    for (const [bk, [bw, bh]] of Object.entries(boxes)) {
      for (const dpr of [1, 1.5]) {
        it(`${ik} 圖 × ${bk} 框 × dpr ${dpr}:${layouts.length} 種位置 / 填滿方式`, () => {
          for (const l of layouts) {
            const input: BgBakeInput = { url: 'u', bright: 0.6, blurPx: 0, width: bw * dpr, height: bh * dpr, dpr, color: '#000', layout: l }
            const p = bgBakePlan(input, iw, ih)
            expect(p.filter).toBe('brightness(0.6)')
            // 畫布像素 → 框的座標(顯示時畫布以 100% 100% 拉滿框,各軸比例 = 畫布 / 框)
            const sx = p.width / bw
            const sy = p.height / bh
            const baked = { x: p.rect.x / sx, y: p.rect.y / sy, w: p.rect.w / sx, h: p.rect.h / sy }
            const css = cssRect(l, iw, ih, bw, bh)
            // 畫布拉回框之後與 CSS 版的矩形重合(只剩 bgCssLayout 百分比取 4 位小數的誤差)
            for (const key of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(baked[key] - css[key])).toBeLessThan(1e-3)
          }
        })
      }
    }
  }
  it('畫布寬高恰好是框 × 1.04 時(無取整誤差)逐位元相同(預設 cover 置中)', () => {
    const input: BgBakeInput = { url: 'u', bright: 0.6, blurPx: 0, width: 500, height: 1000, dpr: 1, color: '#000' }
    const p = bgBakePlan(input, 1920, 1080)
    expect([p.width, p.height]).toEqual([520, 1040])
    const css = cssRect(BG_LAYOUT_DEFAULT, 1920, 1080, 520, 1040)
    expect(p.rect).toEqual(css)
  })
})

describe('BgBaker.detach / adopt + BgBakeCache(隱藏時保留、再顯示不重畫不閃)', () => {
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  function harness () {
    const log: string[] = []
    let n = 0
    const loads: Array<() => void> = []
    const renders: Array<() => void> = []
    const baker = new BgBaker<string, string>({
      load: async (url) => await new Promise<string>((resolve) => { log.push(`load ${url}`); loads.push(() => resolve(`img:${url}`)) }),
      render: async (img, i) => await new Promise<string>((resolve) => { const out = `blob${++n}`; log.push(`render ${img} ${i.blurPx}`); renders.push(() => resolve(out)) }),
      show: (o) => log.push(`show ${o}`),
      discard: (o) => log.push(`revoke ${o}`),
      release: (img) => log.push(`release ${img}`),
      clear: () => log.push('css')
    })
    return { baker, log, loads, renders }
  }
  const inp = (o: Partial<BgBakeInput> = {}): BgBakeInput => ({ url: 'a', bright: 0.6, blurPx: 0, width: 100, height: 80, dpr: 1, color: '#000', ...o })

  it('卸載:detach 交出畫好的圖(不 revoke);新掛載 adopt 第一幀就換上,量到同樣大小 → 不載入不重畫', async () => {
    const a = harness()
    a.baker.update(inp())
    await flush(); a.loads[0](); await flush(); a.renders[0](); await flush()
    const kept = a.baker.detach()
    a.baker.dispose()
    expect(kept).toEqual({ key: bgBakeKey(inp()), out: 'blob1' })
    expect(a.log.slice(3)).toEqual(['release img:a']) // 只放掉來源圖,畫好的圖沒有 revoke、沒有切回 CSS
    const b = harness()
    expect(b.baker.adopt(kept!.key, kept!.out)).toBe(true)
    expect(b.log).toEqual(['show blob1'])
    b.baker.update(inp())
    await flush()
    expect(b.log).toEqual(['show blob1'])
    expect(b.baker.key).toBe(bgBakeKey(inp()))
  })
  it('隱藏中設定變了:adopt 的舊圖先留著(不閃),載入 / 重畫好了才換掉並 revoke', async () => {
    const b = harness()
    b.baker.adopt(bgBakeKey(inp()), 'blob9')
    b.baker.update(inp({ bright: 0.8 }))
    await flush(); b.loads[0](); await flush()
    expect(b.baker.key).toBe(bgBakeKey(inp()))
    b.renders[0](); await flush()
    expect(b.log).toEqual(['show blob9', 'load a', 'render img:a 0', 'show blob1', 'revoke blob9'])
  })
  it('已有圖 / 已卸載時 adopt 不收(回 false,呼叫端自己丟);已卸載 detach 回 null', async () => {
    const b = harness()
    b.baker.update(inp())
    await flush(); b.loads[0](); await flush(); b.renders[0](); await flush()
    expect(b.baker.adopt('k', 'x')).toBe(false)
    b.baker.dispose()
    expect(b.baker.adopt('k', 'x')).toBe(false)
    expect(b.baker.detach()).toBeNull()
  })
  it('BgBakeCache:一個容器一張、放新的丟舊的、take 後就不在、clear 全部丟', () => {
    const gone: string[] = []
    const cache = new BgBakeCache<string>()
    const d = (o: string) => { gone.push(o) }
    cache.put('panel', 'k1', 'b1', d)
    cache.put('panel', 'k2', 'b2', d)
    expect(gone).toEqual(['b1'])
    cache.put('settings', 'k3', 'b3', d)
    expect(cache.take('panel')).toMatchObject({ key: 'k2', out: 'b2' })
    expect(cache.take('panel')).toBeNull()
    cache.clear()
    expect(gone).toEqual(['b1', 'b3'])
    expect(cache.size).toBe(0)
  })
  it('useBackground:背景關閉 / 換圖 → 清掉隱藏中容器保留的圖;只改亮度不清', async () => {
    const s = reactive(normBg({ file: 'a.png' }))
    useBackground(() => s, f => f ? `app://bg/${f}` : null)
    await nextTick()
    const gone: unknown[] = []
    bgBakeCache.put('panel', 'k', 'b1', o => { gone.push(o) })
    s.bright = 40
    await nextTick()
    expect(gone).toEqual([])
    s.file = 'b.png'
    await nextTick()
    expect(gone).toEqual(['b1'])
    bgBakeCache.put('panel', 'k', 'b2', o => { gone.push(o) })
    s.enabled = false
    await nextTick()
    expect(gone).toEqual(['b1', 'b2'])
  })
  it('接線:BgLayer.vue 是閘門(背景開著且顯示中才掛 BgLayerImage);App.vue 的 v-show 與傳給 BgLayer 的是同一個條件;本體卸載時存、掛載時取', () => {
    const gate = read('../src/web/ui/BgLayer.vue')
    expect(gate).toMatch(/<bg-layer-image v-if="on" :host="host" :instance="instance" \/>/)
    expect(gate).toMatch(/props\.shown && bgShownUrl\.value != null/)
    const app = read('../src/web/App.vue')
    expect(app).toMatch(/<div v-show="panelVisible"/)
    expect(app).toMatch(/const panelVisible = computed\(\(\) => isOverlay \? panelShown\.value && !settingsVisible\.value : !settingsVisible\.value\)/)
    const impl = read('../src/web/ui/BgLayerImage.vue')
    // 2026-10-06:同一 host 的第二個容器(相關物品)用 instance 當快取鍵、不回寫 bgHostSize
    expect(impl).toMatch(/bgBakeCache\.take\(props\.instance \?\? props\.host\)/)
    expect(impl).toMatch(/if \(!\(width > 0 && height > 0\) \|\| props\.instance\) return/)
    expect(app).toMatch(/class="related-host bg-host[^"]*"[^>]*>\s*<bg-layer host="panel" instance="related" :shown="showRelated" \/>/)
    expect(impl).toMatch(/bgShownUrl\.value != null \? baker\.detach\(\) : null/)
    expect(impl).toMatch(/bgBakeCache\.put\(props\.instance \?\? props\.host/)
  })
})
