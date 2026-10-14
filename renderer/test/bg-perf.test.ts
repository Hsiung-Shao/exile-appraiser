// B9:有背景圖時開設定卡頓的修正 —— 保留解碼後的來源圖、預覽縮圖不用原圖即時模糊;降解析度模糊評估後不採用。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import fs from 'node:fs'
import path from 'node:path'
import { BG_PREVIEW_MAX_W, BG_SCALE, BgBaker, BgSourceCache, bgBakePlan, bgPreviewCache, bgPreviewSize, makeBgPreview, useBgPreview, type BgBakeInput, type BgSource } from '../src/web/bg-bake'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

const input = (o: Partial<BgBakeInput> = {}): BgBakeInput => ({
  url: 'app://bg/a.jpg', bright: 0.6, blurPx: 3, width: 900, height: 700, dpr: 1, color: '#111', ...o
})

describe('T17 保留原圖不重解碼', () => {
  it('BgSourceCache:同一張只載一次;換圖釋放舊的;clear 釋放', async () => {
    const loads: string[] = []
    const released: string[] = []
    const cache = new BgSourceCache<string>((img) => { released.push(img) })
    const loader = async (url: string) => { loads.push(url); return `img:${url}` }
    expect(await cache.get('a', loader)).toBe('img:a')
    expect(await cache.get('a', loader)).toBe('img:a')
    expect(loads).toEqual(['a'])
    expect(await cache.get('b', loader)).toBe('img:b')
    expect(released).toEqual(['img:a'])
    cache.clear()
    expect(released).toEqual(['img:a', 'img:b'])
    expect(cache.size).toBe(0)
  })

  it('載入失敗不快取(下次重試),載入中換圖則丟掉晚到的結果', async () => {
    const released: string[] = []
    const cache = new BgSourceCache<string>((img) => { released.push(img) })
    let fail = true
    const bad = async () => { if (fail) throw new Error('x'); return 'ok' }
    await expect(cache.get('a', bad)).rejects.toThrow()
    fail = false
    expect(await cache.get('a', bad)).toBe('ok')
    let resolveSlow: (v: string) => void = () => {}
    const slow = cache.get('c', () => new Promise<string>(r => { resolveSlow = r }))
    cache.clear()
    resolveSlow('img:c')
    await expect(slow).resolves.toBe('img:c')
    await flush()
    expect(released).toContain('img:c') // 被清掉的那張晚到 → 直接釋放
  })

  it('detach → 新掛載 adopt → 框大小變了重畫:來源圖只載一次', async () => {
    let loaderCalls = 0
    const cache = new BgSourceCache<{ id: number }>(() => {})
    const loader = async () => { loaderCalls++; return { id: 1 } }
    const renders: string[] = []
    const mk = () => new BgBaker<{ id: number }, string>({
      load: async (url) => await cache.get(url, loader),
      render: async (_img, i) => { renders.push(`${i.width}x${i.height}`); return `out-${i.width}` },
      show: () => {},
      discard: () => {},
      release: () => {}, // 來源圖歸快取管,卸載不釋放
      clear: () => {}
    })
    const a = mk()
    a.update(input())
    await flush()
    const kept = a.detach()!
    a.dispose()
    const b = mk()
    expect(b.adopt(kept.key, kept.out)).toBe(true)
    b.update(input({ width: 1000, height: 760 })) // 設定視窗改了大小 → 要重畫
    await flush()
    expect(renders).toEqual(['900x700', '1000x760'])
    expect(loaderCalls).toBe(1)
  })

  it('接線:BgLayerImage 經 bgSourceCache 取來源圖、release 不釋放;useBackground 換圖 / 關閉時一起清', () => {
    const vue = read('renderer/src/web/ui/BgLayerImage.vue')
    expect(vue).toMatch(/bgSourceCache\.get\(url, loadBgSource\)/)
    expect(vue).not.toMatch(/release: \(img\) => \{ img\.removeAttribute\('src'\) \}/)
    const theme = read('renderer/src/web/useTheme.ts')
    expect(theme).toMatch(/bgBakeCache\.clear\(\); bgSourceCache\.clear\(\); bgPreviewCache\.clear\(\)/)
  })
})

describe('T18 預覽縮圖不用原圖即時模糊', () => {
  it('一般分頁縮圖:沒有 CSS blur、不用原圖網址,改用預先處理的縮圖', () => {
    const vue = read('renderer/src/web/settings/tabs/General.vue')
    const thumb = /<div class="bg-thumb"[\s\S]*?>/.exec(vue)![0]
    expect(thumb).not.toMatch(/blur\(/)
    expect(thumb).not.toMatch(/filter/)
    expect(thumb).toMatch(/bgThumb/)
    expect(vue).toMatch(/useBgThumb\(/)
    expect(vue).not.toMatch(/backgroundImage: `url\("\$\{.*bgImageUrl/)
  })

  it('位置預覽框:不再自己 new Image() 解碼原圖,背景用共用的縮小預覽圖', () => {
    const vue = read('renderer/src/web/settings/BgLayoutEditor.vue')
    expect(vue).not.toMatch(/new Image\(\)/)
    // 預覽圖由一般分頁 useBgPreview 做一次,兩個預覽框經 prop 共用
    expect(vue).toMatch(/preview: \{ type: Object as PropType<BgPreviewState>/)
    expect(read('renderer/src/web/settings/tabs/General.vue').match(/:preview="bgPreview"/g)).toHaveLength(2)
    expect(vue).toMatch(/backgroundImage: preview\.value/)
  })

  it('預覽圖大小:最寬 BG_PREVIEW_MAX_W、保持比例、小圖不放大', () => {
    expect(bgPreviewSize(3840, 2160)).toEqual({ w: BG_PREVIEW_MAX_W, h: Math.round(BG_PREVIEW_MAX_W * 2160 / 3840) })
    expect(bgPreviewSize(1000, 4000)).toEqual({ w: 120, h: 480 }) // 直圖以長邊為準
    expect(bgPreviewSize(300, 200)).toEqual({ w: 300, h: 200 })
  })
})

describe('T19 降解析度模糊外觀不變(評估後不採用,見 docs/perf/changes-round6.md)', () => {
  it('bgBakePlan 維持原解析度:畫布 = 框 × 1.04、filter 與 CSS 同一串(沒有縮小模糊的路徑)', () => {
    const p = bgBakePlan(input({ blurPx: 24, dpr: 1.5 }), 3840, 2160) as ReturnType<typeof bgBakePlan> & { low?: unknown }
    expect(p.width).toBe(Math.round(900 * BG_SCALE))
    expect(p.height).toBe(Math.round(700 * BG_SCALE))
    expect(p.low).toBeUndefined()
    expect(p.filter).toBe(`brightness(0.6) blur(${Math.round(24 * 1.5 * BG_SCALE * 1000) / 1000}px)`)
  })

  it('來源圖保留 <img>,不轉 ImageBitmap(重取樣不同會改外觀)', () => {
    const src = read('renderer/src/web/bg-bake.ts')
    expect(src).not.toMatch(/createImageBitmap\(/)
  })
})

describe('T20 預覽圖不把 4K 原圖留在來源快取', () => {
  afterEach(() => { vi.unstubAllGlobals(); bgPreviewCache.clear() })
  const stubDom = () => {
    const ctx = { drawImage: () => {}, imageSmoothingQuality: '' }
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob) => void) => cb(new Blob(['x'])) }
    vi.stubGlobal('document', { createElement: () => canvas })
    let n = 0
    const revoked: string[] = []
    vi.stubGlobal('URL', { createObjectURL: () => `blob:${++n}`, revokeObjectURL: (u: string) => { revoked.push(u) } })
    return { revoked }
  }
  const mkSrc = () => ({ image: { removeAttribute: vi.fn() }, width: 3840, height: 2160 }) as unknown as BgSource & { image: { removeAttribute: ReturnType<typeof vi.fn> } }

  it('背景沒顯示這張時:做完預覽 bgSourceCache 為空、每次都重載、來源被釋放', async () => {
    stubDom()
    const cache = new BgSourceCache<BgSource>(() => {})
    const srcs: Array<ReturnType<typeof mkSrc>> = []
    const load = vi.fn(async () => { const s = mkSrc(); srcs.push(s); return s })
    await makeBgPreview('app://bg/a.png', { shownUrl: () => null, load, cache })
    await makeBgPreview('app://bg/a.png', { shownUrl: () => null, load, cache })
    expect(cache.size).toBe(0)
    expect(load).toHaveBeenCalledTimes(2)
    expect(srcs.every(s => s.image.removeAttribute.mock.calls.some(c => c[0] === 'src'))).toBe(true)
  })

  it('背景正顯示這張時:沿用快取、只載一次、不釋放', async () => {
    stubDom()
    const cache = new BgSourceCache<BgSource>(() => {})
    const srcs: Array<ReturnType<typeof mkSrc>> = []
    const load = vi.fn(async () => { const s = mkSrc(); srcs.push(s); return s })
    await makeBgPreview('app://bg/a.png', { shownUrl: () => 'app://bg/a.png', load, cache })
    await makeBgPreview('app://bg/a.png', { shownUrl: () => 'app://bg/a.png', load, cache })
    expect(cache.size).toBe(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(srcs[0].image.removeAttribute).not.toHaveBeenCalled()
  })

  it('預覽快取被清掉後 useBgPreview 會重做、不指向已 revoke 的 blob', async () => {
    const { revoked } = stubDom()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const OrigImage = (globalThis as { Image?: unknown }).Image
    vi.stubGlobal('Image', class { crossOrigin = ''; decoding = ''; naturalWidth = 3840; naturalHeight = 2160; src = ''; async decode () {} removeAttribute () {} })
    try {
      const state = useBgPreview(() => 'app://bg/a.png')
      for (let i = 0; i < 30; i++) await Promise.resolve()
      await nextTick()
      const first = state.value.preview?.src
      expect(first).toBeTruthy()
      bgPreviewCache.clear()
      expect(revoked).toContain(first)
      for (let i = 0; i < 30; i++) await Promise.resolve()
      await nextTick()
      for (let i = 0; i < 30; i++) await Promise.resolve()
      expect(state.value.preview?.src).toBeTruthy()
      expect(state.value.preview?.src).not.toBe(first)
    } finally {
      vi.stubGlobal('Image', OrigImage)
    }
  })
})
