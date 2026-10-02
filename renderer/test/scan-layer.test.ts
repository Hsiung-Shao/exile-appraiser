// code review 第 C 批:掃描層共用接線(`src/web/overlay/scan-layer.ts`,`OcrBadges.vue` / `RuneshapePrices.vue` 經 useScanLayer 用)。
// node 環境:Vue 反應式 + nextTick 照真的跑,DOM / ResizeObserver / document.fonts 給假的。
import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import type { ScanMaskReport } from '@ipc/types'
import { createScanLayer, type ResizeObserverLike, type ScanLayerOptions } from '../src/web/overlay/scan-layer'

type Ev = { seq: number }
interface FakeEl { w: number, getBoundingClientRect: () => { left: number, top: number, width: number, height: number } }
const el = (w: number, top = 0): FakeEl => {
  const e: FakeEl = { w, getBoundingClientRect: () => ({ left: 10, top, width: e.w, height: 20 }) }
  return e
}
const fakeLayer = (kids: FakeEl[]) => ({ children: kids }) as unknown as HTMLElement

/** 假的 ResizeObserver:記錄 observe 中的元素,`fire()` 模擬尺寸變化回呼 */
function fakeRO () {
  const inst: { cb: () => void, observed: Set<unknown>, disconnected: boolean }[] = []
  class RO implements ResizeObserverLike {
    s = { cb: () => {}, observed: new Set<unknown>(), disconnected: false }
    constructor (cb: () => void) { this.s.cb = cb; inst.push(this.s) }
    observe (e: Element) { this.s.observed.add(e) }
    unobserve (e: Element) { this.s.observed.delete(e) }
    disconnect () { this.s.observed.clear(); this.s.disconnected = true }
  }
  return { RO, inst }
}

function setup (over: Partial<ScanLayerOptions<Ev>> = {}, fonts?: any) {
  const sent: ScanMaskReport[] = []
  const subs: Array<(e: Ev) => void> = []
  const unsub = vi.fn()
  const { RO, inst } = fakeRO()
  const drawn = shallowRef(0)
  const data = shallowRef(0)
  const scope = effectScope()
  const s = scope.run(() => createScanLayer<Ev>({
    source: 'reveal',
    handleEvent: () => {},
    drawn: [drawn],
    data: [data],
    showing: () => false,
    ...over
  }, {
    subscribe: (cb) => { subs.push(cb); return unsub },
    send: r => { sent.push(r) },
    viewport: () => ({ w: 800, h: 600 }),
    fonts,
    ResizeObserver: RO
  }))!
  return { s, sent, subs, unsub, inst, drawn, data, scope }
}
/** 等 nextTick + 其後的 promise 鏈(ack 是 nextTick 裡的 async) */
const settle = async () => { for (let i = 0; i < 6; i++) await nextTick() }

describe('createScanLayer:ack 一定送出', () => {
  it('handleEvent 丟例外:例外照樣往外丟,但 DOM 更新後仍送出帶 seq 的 ack', async () => {
    const { s, sent } = setup({ handleEvent: () => { throw new Error('boom') } })
    expect(() => { s.onEvent({ seq: 7 }) }).toThrow('boom')
    await settle()
    expect(sent.at(-1)?.seq).toBe(7)
  })

  it('beforeAck 丟例外 / reject:照樣 ack', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { s, sent } = setup({ beforeAck: async () => { throw new Error('x') } })
    s.onEvent({ seq: 3 })
    await settle()
    expect(sent.at(-1)?.seq).toBe(3)
    warn.mockRestore()
  })

  it('subscribe 進來的事件走同一條路(start 訂閱、stop 取消訂閱並送空遮罩)', async () => {
    const { s, sent, subs, unsub } = setup()
    s.start()
    expect(subs).toHaveLength(1)
    s.layer.value = fakeLayer([el(50)])
    subs[0]({ seq: 1 })
    await settle()
    expect(sent.at(-1)).toMatchObject({ seq: 1, rects: [{ w: 50 }] })
    s.stop()
    expect(unsub).toHaveBeenCalled()
    expect(sent.at(-1)?.rects).toEqual([])
  })
})

describe('createScanLayer:ack 帶重排後的外框', () => {
  it('beforeAck 回傳 true(重排改了 DOM)→ 等一次 nextTick 再量,ack 那份是新外框', async () => {
    const kid = el(50, 0)
    const { s, sent } = setup({
      beforeAck: async () => {
        // 模擬 restackMeasured:量完把徽章往下推,DOM 下一輪才更新
        void nextTick(() => { (kid as any).getBoundingClientRect = () => ({ left: 10, top: 40, width: 50, height: 20 }) })
        return true
      }
    })
    s.layer.value = fakeLayer([kid])
    await settle()
    s.onEvent({ seq: 5 })
    await settle()
    const ack = sent.find(r => r.seq === 5)!
    expect(ack.rects[0].y).toBe(40)
  })

  it('beforeAck 收到 fontsWaited:字型在載入 → true,否則 false', async () => {
    const calls: boolean[] = []
    let done!: () => void
    const fonts = { status: 'loading', ready: new Promise<void>(res => { done = res }) }
    const { s } = setup({ beforeAck: (w) => { calls.push(w) } }, fonts)
    s.onEvent({ seq: 1 })
    await settle()
    done()
    await settle()
    fonts.status = 'loaded'
    s.onEvent({ seq: 2 })
    await settle()
    expect(calls).toEqual([true, false])
  })
})

describe('createScanLayer:遮罩重報', () => {
  it('drawn 來源(外觀 / 字級 / 語言)改了 → DOM 更新後重量重報', async () => {
    const kid = el(50)
    const { s, sent, drawn } = setup()
    s.layer.value = fakeLayer([kid])
    await settle()
    const n = sent.length
    kid.w = 70 // 字級變大,徽章變寬
    drawn.value++
    await settle()
    expect(sent.length).toBe(n + 1)
    expect(sent.at(-1)?.rects[0].w).toBe(70)
    expect(sent.at(-1)?.seq).toBeUndefined()
  })

  it('ResizeObserver:每個直接子元素都被觀察;尺寸變化回呼 → 重報;子元素換了跟著換;stop 拆掉', async () => {
    const a = el(50)
    const b = el(60, 30)
    const { s, sent, inst, drawn } = setup()
    s.layer.value = fakeLayer([a, b])
    await settle()
    expect([...inst[0].observed]).toEqual([a, b])
    const n = sent.length
    a.w = 80 // 例如字型載入、換語言後文字變寬(不經任何反應式來源)
    inst[0].cb()
    expect(sent.length).toBe(n + 1)
    expect(sent.at(-1)?.rects.map(r => r.w)).toEqual([80, 60])
    inst[0].cb() // 沒變 → 不重送
    expect(sent.length).toBe(n + 1)
    const c = el(40)
    s.layer.value = fakeLayer([a, c])
    drawn.value++
    await settle()
    expect([...inst[0].observed]).toEqual([a, c])
    s.stop()
    expect(inst[0].disconnected).toBe(true)
  })

  it('字型 loadingdone:預設重報;給 onFontsLoaded 就呼叫它', async () => {
    const listeners: Record<string, () => void> = {}
    const fonts = {
      status: 'loaded',
      ready: Promise.resolve(),
      addEventListener: (t: string, fn: () => void) => { listeners[t] = fn },
      removeEventListener: (t: string) => { delete listeners[t] }
    }
    const kid = el(50)
    const { s, sent } = setup({}, fonts)
    s.start()
    s.layer.value = fakeLayer([kid])
    await settle()
    kid.w = 71
    listeners.loadingdone()
    expect(sent.at(-1)?.rects[0].w).toBe(71)
    s.stop()
    expect(listeners.loadingdone).toBeUndefined()

    const onFontsLoaded = vi.fn()
    const t2 = setup({ onFontsLoaded }, fonts)
    t2.s.start()
    listeners.loadingdone()
    expect(onFontsLoaded).toHaveBeenCalledTimes(1)
  })
})

describe('createScanLayer:resend(第 B 批)保留', () => {
  it('收到 rows 時資料沒載好(missed)→ 資料改變時送一次 resend: true;之後再改不送', async () => {
    const { s, sent, data } = setup()
    s.resend.missed()
    data.value++
    await settle()
    expect(sent.filter(r => r.resend)).toHaveLength(1)
    data.value++
    await settle()
    expect(sent.filter(r => r.resend)).toHaveLength(1)
  })

  it('畫面上有徽章(舊資料算的)時資料改變 → resend', async () => {
    let showing = true
    const { sent, data } = setup({ showing: () => showing })
    data.value++
    await settle()
    expect(sent.filter(r => r.resend)).toHaveLength(1)
    showing = false
    data.value++
    await settle()
    expect(sent.filter(r => r.resend)).toHaveLength(1)
  })
})

describe('兩個徽章層都改用 useScanLayer(不再各自接線)', () => {
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
  for (const f of ['../src/web/overlay/OcrBadges.vue', '../src/web/overlay/RuneshapePrices.vue']) {
    it(f, () => {
      const src = read(f)
      expect(src).toMatch(/useScanLayer</)
      for (const old of ['createScanMaskReporter', 'createResendTracker', 'createScanResultGate', 'reportWithAck', "addEventListener?.('loadingdone'"]) {
        expect(src).not.toContain(old)
      }
    })
  }
  it('褻瀆層:字級讀 config.fsBase(反應式)、去重鍵含介面語言、量高度走 layer.children、不再另掛 fonts.ready', () => {
    const src = read('../src/web/overlay/OcrBadges.vue')
    expect(src).not.toContain('getComputedStyle')
    expect(src).toContain('config.fsBase')
    expect(src).toMatch(/scanResultKey\([^)]*locale\.value/)
    expect(src).toMatch(/watch\(\[\(\) => config\.fsBase, locale\]/)
    expect(src).not.toContain('querySelector')
    expect(src).not.toContain('fonts?.ready')
  })
  it('useScanLayer 追全域字級與 i18n locale', () => {
    const src = read('../src/web/overlay/useScanLayer.ts')
    expect(src).toMatch(/drawn: \[\.\.\.opts\.drawn, \(\) => config\.fsBase, locale\]/)
  })
})
