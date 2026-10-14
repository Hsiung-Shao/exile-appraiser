// B8:renderer 效能指標(longtask / rAF 幀間隔 / 查價延遲 / 背景圖)—— 關著零成本、開著每個取樣間隔回報一次、接線守門。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { PerfRendererReport, PerfState, PerfStateEvent } from '@ipc/types'
import { RendererPerfCollector, initRendererPerf, perfHooks, type PerfEnv } from '../src/web/perf/renderer-perf'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

/** 計數替身:PerformanceObserver / rAF / setInterval / onItemText 都記數,測試手動觸發 */
function fakeEnv () {
  let t = 0
  const st = {
    observers: 0,
    observing: 0,
    rafs: new Map<number, (ts: number) => void>(),
    rafCalls: 0,
    intervals: new Map<number, { fn: () => void, ms: number }>(),
    itemTextSubs: new Set<() => void>(),
    wanted: true,
    sent: [] as PerfRendererReport[],
    ltCb: null as null | ((list: { getEntries: () => Array<{ duration: number }> }) => void)
  }
  let id = 0
  class FakeObserver {
    static supportedEntryTypes = ['longtask']
    constructor (cb: (list: { getEntries: () => Array<{ duration: number }> }) => void) { st.observers++; st.ltCb = cb }
    observe () { st.observing++ }
    disconnect () { st.observing--; st.ltCb = null }
  }
  const env: PerfEnv = {
    PerformanceObserver: FakeObserver as unknown as PerfEnv['PerformanceObserver'],
    raf: (cb) => { st.rafCalls++; st.rafs.set(++id, cb); return id },
    caf: (h) => { st.rafs.delete(h) },
    setInterval: (fn, ms) => { st.intervals.set(++id, { fn, ms }); return id },
    clearInterval: (h) => { st.intervals.delete(h as number) },
    now: () => t,
    framesWanted: () => st.wanted,
    onItemText: (cb) => { st.itemTextSubs.add(cb); return () => { st.itemTextSubs.delete(cb) } },
    send: (r) => { st.sent.push(r) }
  }
  const frame = (dt: number) => {
    t += dt
    const pending = [...st.rafs.entries()]
    st.rafs.clear()
    for (const [, cb] of pending) cb(t)
  }
  const tick = () => { for (const v of [...st.intervals.values()]) v.fn() }
  return { env, st, frame, tick, advance: (ms: number) => { t += ms } }
}

describe('T15 renderer 指標關著零成本', () => {
  it('沒開:0 observer / 0 rAF / 0 計時器 / 不訂閱物品文字;hook 都是 null', () => {
    const f = fakeEnv()
    const c = new RendererPerfCollector(f.env)
    expect(c.running).toBe(false)
    expect(f.st.observers).toBe(0)
    expect(f.st.rafCalls).toBe(0)
    expect(f.st.intervals.size).toBe(0)
    expect(f.st.itemTextSubs.size).toBe(0)
    expect(perfHooks.trade).toBeNull()
    expect(perfHooks.bg).toBeNull()
  })

  it('initRendererPerf:perf-get 回關著 → 不啟動;收到 perf-state 開 → 啟動;關 → 全部拆掉', async () => {
    const f = fakeEnv()
    let push: ((e: PerfStateEvent) => void) | null = null
    const host = {
      canPerf: true,
      perfGet: async (): Promise<PerfState | null> => ({ enabled: false, byArg: false, setting: false, sampleMs: 5000, file: '', last: null }),
      onPerfState: (cb: (e: PerfStateEvent) => void) => { push = cb; return () => { push = null } }
    }
    const c = initRendererPerf(host, f.env)!
    await Promise.resolve(); await Promise.resolve()
    expect(c.running).toBe(false)
    expect(f.st.observers + f.st.rafCalls + f.st.intervals.size + f.st.itemTextSubs.size).toBe(0)
    push!({ enabled: true, sampleMs: 5000 })
    expect(c.running).toBe(true)
    expect(f.st.observing).toBe(1)
    expect([...f.st.intervals.values()].map(v => v.ms)).toEqual([5000])
    expect(f.st.itemTextSubs.size).toBe(1)
    expect(perfHooks.trade).not.toBeNull()
    expect(perfHooks.bg).not.toBeNull()
    push!({ enabled: false, sampleMs: 5000 })
    expect(c.running).toBe(false)
    expect(f.st.observing).toBe(0)
    expect(f.st.rafs.size).toBe(0)
    expect(f.st.intervals.size).toBe(0)
    expect(f.st.itemTextSubs.size).toBe(0)
    expect(perfHooks.trade).toBeNull()
    expect(perfHooks.bg).toBeNull()
  })

  it('預覽 / 沒有 perf 能力:什麼都不做', () => {
    const f = fakeEnv()
    const host = { canPerf: false, perfGet: async () => null, onPerfState: () => () => {} }
    expect(initRendererPerf(host, f.env)).toBeNull()
    expect(f.st.observers + f.st.rafCalls + f.st.intervals.size).toBe(0)
  })
})

describe('開著:每個取樣間隔回報一次', () => {
  it('longtask 次數 / 總時間 / 最長;回報後歸零', () => {
    const f = fakeEnv()
    const c = new RendererPerfCollector(f.env)
    c.start(5000)
    f.st.ltCb!({ getEntries: () => [{ duration: 60 }, { duration: 120 }] })
    f.advance(5000)
    f.tick()
    expect(f.st.sent).toHaveLength(1)
    expect(f.st.sent[0].longTask).toEqual({ n: 2, totalMs: 180, maxMs: 120 })
    expect(f.st.sent[0].windowMs).toBe(5000)
    f.advance(5000)
    f.tick()
    expect(f.st.sent[1].longTask.n).toBe(0)
    c.stop()
  })

  it('rAF 幀間隔 p95 / 最長;沒內容(framesWanted false)就停 rAF', () => {
    const f = fakeEnv()
    const c = new RendererPerfCollector(f.env)
    c.start(5000)
    expect(f.st.rafs.size).toBe(1)
    f.frame(16) // 第一幀只當起點
    for (let i = 0; i < 19; i++) f.frame(16)
    f.frame(50)
    f.tick()
    expect(f.st.sent[0].frames).toEqual({ n: 20, p95: 16, max: 50 })
    f.st.wanted = false
    f.frame(16) // 這一幀發現不需要 → 不再排
    expect(f.st.rafs.size).toBe(0)
    f.tick()
    expect(f.st.sent[1].frames.n).toBe(0)
    f.st.wanted = true
    f.tick() // 取樣時重看:要量就重新開始
    expect(f.st.rafs.size).toBe(1)
    c.stop()
    expect(f.st.rafs.size).toBe(0)
  })

  it('查價延遲:物品文字 → 第一個交易站請求(解析)→ 第一筆結果(fetch / exchange 回應)', () => {
    const f = fakeEnv()
    const c = new RendererPerfCollector(f.env)
    c.start(5000)
    for (const cb of f.st.itemTextSubs) cb()
    f.advance(30)
    perfHooks.trade!('request', 'https://www.pathofexile.com/api/trade/search/Standard')
    f.advance(300)
    perfHooks.trade!('response', 'https://www.pathofexile.com/api/trade/search/Standard') // search 回應不是結果
    f.advance(370)
    perfHooks.trade!('response', 'https://www.pathofexile.com/api/trade/fetch/a,b')
    perfHooks.trade!('response', 'https://www.pathofexile.com/api/trade/fetch/c,d') // 同一次查價只記第一筆
    perfHooks.trade!('request', 'https://poe.ninja/api/data') // 不是交易站
    f.tick()
    expect(f.st.sent[0].query).toEqual({ parseMs: [30], firstMs: [700] })
    c.stop()
  })

  it('背景圖事件累計;stop 後 hook 收掉、不再送', () => {
    const f = fakeEnv()
    const c = new RendererPerfCollector(f.env)
    c.start(5000)
    perfHooks.bg!({ kind: 'load', ms: 120 })
    perfHooks.bg!({ kind: 'redraw', drawMs: 300, encodeMs: 90, decodeMs: 8 })
    perfHooks.bg!({ kind: 'adopt' })
    f.tick()
    expect(f.st.sent[0].bg).toEqual({ redraws: 1, adopts: 1, loads: 1, loadMs: [120], drawMs: [300], encodeMs: [90], decodeMs: [8] })
    c.stop()
    expect(perfHooks.bg).toBeNull()
    f.tick()
    expect(f.st.sent).toHaveLength(1)
  })
})

describe('接線守門', () => {
  it('IPC.ts:交易站請求 / 回應經 perfHooks(關著只是一個 null 檢查);記下 overlay 內容;perfRenderer / onPerfState 只給 canPerf', () => {
    const ipc = read('renderer/src/web/background/IPC.ts')
    expect(ipc).toMatch(/perfHooks\.trade\?\.\('request', url\)/)
    expect(ipc).toMatch(/perfHooks\.trade\?\.\('response', url\)/)
    expect(ipc).toMatch(/this\.lastOverlayContent = s/)
    expect(ipc).toMatch(/perfRenderer \(r: PerfRendererReport\): void \{ if \(this\.canPerf\) window\.host\?\.perfRenderer\?\.\(r\) \}/)
  })

  it('renderer main.ts 啟動時呼叫 initRendererPerf', () => {
    expect(read('renderer/src/main.ts')).toMatch(/initRendererPerf\(Host/)
  })

  it('BgLayerImage:每次重畫寫一行 [bg] 記錄並送 perfHooks.bg(關著不送)', () => {
    const vue = read('renderer/src/web/ui/BgLayerImage.vue')
    expect(vue).toMatch(/console\.log\(`\[bg\] 重畫/)
    expect(vue).toMatch(/perfHooks\.bg\?\.\(\{ kind: 'redraw'/)
    expect(vue).toMatch(/perfHooks\.bg\?\.\(\{ kind: 'adopt' \}\)/)
    // 來源圖載入在 bg-bake.ts loadBgSource(B9:BgLayerImage 與設定頁預覽圖共用)
    expect(read('renderer/src/web/bg-bake.ts')).toMatch(/perfHooks\.bg\?\.\(\{ kind: 'load'/)
  })
})
