/**
 * 第 30.6 步(2026-10-03):背景圖層的閘門(BgLayer.vue → BgLayerImage.vue)真的掛載測試(mini-dom,用戶端流程)。
 * - 背景關閉:沒有 .bgimg / .bgtint DOM、沒有 ResizeObserver / MutationObserver、不載入圖;
 * - 容器隱藏(查價面板 v-show 藏起 → `shown` false):本體卸載、observer 斷開,之後改設定也不載入 / 不預先處理;
 * - 背景開著且顯示中:一個 ResizeObserver + 一個 MutationObserver,量到大小後才載入圖(霧面 0 也預先處理)。
 * 觀察器 / Image / getComputedStyle 都換成計數用的替身(node 環境沒有瀏覽器)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import BgLayer from '../src/web/ui/BgLayer.vue'
import { bgBake, bgShownUrl } from '../src/web/useTheme'
import { bgBakeCache, bgBakeKey, BG_LAYOUT_DEFAULT } from '../src/web/bg-bake'
import { mount, findAll, byClass, type MiniNode } from './mini-dom'

interface Counters { roNew: number, roLive: number, moNew: number, moLive: number, images: string[] }
const c: Counters = { roNew: 0, roLive: 0, moNew: 0, moLive: 0, images: [] }
const roCallbacks: Array<(entries: unknown[]) => void> = []

class FakeResizeObserver {
  private live = false
  constructor (private readonly cb: (entries: unknown[]) => void) { c.roNew++; roCallbacks.push(cb) }
  observe () { if (!this.live) { this.live = true; c.roLive++ } }
  disconnect () { if (this.live) { this.live = false; c.roLive-- } }
}
class FakeMutationObserver {
  private live = false
  constructor (_cb: unknown) { c.moNew++ }
  observe () { if (!this.live) { this.live = true; c.moLive++ } }
  disconnect () { if (this.live) { this.live = false; c.moLive-- } }
}
class FakeImage {
  crossOrigin = ''
  decoding = ''
  naturalWidth = 1920
  naturalHeight = 1080
  private s = ''
  get src () { return this.s }
  set src (v: string) { this.s = v; c.images.push(v) }
  async decode () {}
  removeAttribute () {}
}

const saved: Record<string, unknown> = {}
beforeEach(() => {
  Object.assign(c, { roNew: 0, roLive: 0, moNew: 0, moLive: 0, images: [] })
  roCallbacks.length = 0
  for (const k of ['ResizeObserver', 'MutationObserver', 'Image', 'getComputedStyle']) saved[k] = (globalThis as Record<string, unknown>)[k]
  Object.assign(globalThis, {
    ResizeObserver: FakeResizeObserver,
    MutationObserver: FakeMutationObserver,
    Image: FakeImage,
    getComputedStyle: () => ({ getPropertyValue: () => '#0e1116' })
  })
  bgShownUrl.value = null
  bgBake.value = null
})
afterEach(() => {
  Object.assign(globalThis, saved)
  bgShownUrl.value = null
  bgBake.value = null
  bgBakeCache.clear()
})

const settle = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise(resolve => setTimeout(resolve, 20))
  for (let i = 0; i < 5; i++) await nextTick()
}

function host (shown: boolean) {
  const vis = shallowRef(shown)
  const Root = defineComponent({ setup: () => () => h('div', { class: 'bg-host' }, [h(BgLayer, { host: 'panel', shown: vis.value })]) })
  const { app, container } = mount(Root)
  const layers = () => findAll(container, (n: MiniNode) => byClass('bgimg')(n) || byClass('bgtint')(n))
  return { app, vis, layers }
}

/** 背景開著(useBackground 會寫的兩個值;這裡直接設) */
function bgOn (blurPx: number) {
  bgShownUrl.value = 'app://bg/a.png'
  bgBake.value = { url: 'app://bg/a.png', bright: 0.6, blurPx }
}
/** ResizeObserver 回報框大小(裝置像素) */
function resize (w: number, hgt: number) {
  for (const cb of roCallbacks) cb([{ contentRect: { width: w, height: hgt }, devicePixelContentBoxSize: [{ inlineSize: w, blockSize: hgt }] }])
}

describe('背景圖層閘門(第 30.6 步)', () => {
  it('背景關閉:沒有圖層 DOM、沒有任何 observer、不載入圖', async () => {
    const t = host(true)
    await settle()
    expect(t.layers()).toHaveLength(0)
    expect([c.roNew, c.moNew, c.images.length]).toEqual([0, 0, 0])
    t.app.unmount()
  })

  it('背景開著但查價面板隱藏:不掛載、不 bake;之後改設定也一樣', async () => {
    bgOn(0)
    const t = host(false)
    await settle()
    expect(t.layers()).toHaveLength(0)
    expect([c.roNew, c.moNew, c.images.length]).toEqual([0, 0, 0])
    bgOn(12)
    await settle()
    expect([c.roNew, c.moNew, c.images.length]).toEqual([0, 0, 0])
    t.app.unmount()
  })

  it('背景開著且顯示中:圖層 2 個 + 各 1 個 observer;量到大小才載入圖(霧面 0 也預先處理)', async () => {
    bgOn(0)
    const t = host(true)
    await settle()
    expect(t.layers()).toHaveLength(2)
    expect([c.roLive, c.moLive]).toEqual([1, 1])
    expect(c.images).toEqual([]) // 還沒量到大小(隱藏 / 0)不載入
    resize(460, 900)
    await settle()
    expect(c.images).toEqual(['app://bg/a.png'])
    t.app.unmount()
    expect([c.roLive, c.moLive]).toEqual([0, 0])
  })

  it('顯示 → 隱藏:本體卸載、observer 斷開;隱藏中改霧面不載入不 bake;再顯示才重新掛載', async () => {
    bgOn(12)
    const t = host(true)
    await settle()
    resize(460, 900)
    await settle()
    const loads = c.images.length
    expect(loads).toBe(1)
    t.vis.value = false
    await settle()
    expect(t.layers()).toHaveLength(0)
    expect([c.roLive, c.moLive]).toEqual([0, 0])
    bgOn(24)
    await settle()
    expect(c.images.length).toBe(loads)
    t.vis.value = true
    await settle()
    expect(t.layers()).toHaveLength(2)
    expect([c.roLive, c.moLive]).toEqual([1, 1])
    t.app.unmount()
  })

  it('背景關掉:顯示中的圖層也整個卸載', async () => {
    bgOn(0)
    const t = host(true)
    await settle()
    expect(t.layers()).toHaveLength(2)
    bgShownUrl.value = null
    bgBake.value = null
    await settle()
    expect(t.layers()).toHaveLength(0)
    expect([c.roLive, c.moLive]).toEqual([0, 0])
    t.app.unmount()
  })

  it('再顯示:上次畫好的圖第一幀就換上;掛載當幀的 rAF(框大小還沒量到)不能把它丟掉;量到同樣大小 → 不載入不重畫', async () => {
    bgOn(12)
    const key = bgBakeKey({ url: 'app://bg/a.png', bright: 0.6, blurPx: 12, width: 460, height: 900, dpr: 1, color: '#0e1116', layout: { ...BG_LAYOUT_DEFAULT } })
    const discarded: unknown[] = []
    const out = { url: 'blob:cached', img: new FakeImage() }
    bgBakeCache.put('panel', key, out, (o) => { discarded.push(o) })
    const t = host(true)
    const img = t.layers().find(byClass('bgimg'))!
    expect(img.dataset.baked).toBe('1')
    expect(img.style.props['--bg-baked']).toBe('url("blob:cached")')
    await settle() // 掛載當幀的 rAF 跑過(這時 ResizeObserver 還沒回報)
    expect(img.dataset.baked).toBe('1')
    expect(discarded).toEqual([])
    resize(460, 900)
    await settle()
    expect(img.dataset.baked).toBe('1')
    expect(c.images).toEqual([])
    expect(discarded).toEqual([])
    // 再隱藏 → 圖回到快取(不丟)
    t.vis.value = false
    await settle()
    expect(discarded).toEqual([])
    expect(bgBakeCache.size).toBe(1)
    t.app.unmount()
  })
})
