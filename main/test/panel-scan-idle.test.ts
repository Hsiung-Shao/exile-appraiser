// 第 30.2 步(閒置降耗):PanelScan 被 scanBlock 擋下時不再每秒重排 —— 事件 poke / wake 立刻重看、10 秒保底、
// 停用(disabled / not-poe2)連保底都不排、計時器不洩漏。假時鐘 + 假擷取,不啟動 Electron、不送任何按鍵。
import { describe, expect, it } from 'vitest'
import type { RuneshapeScanEvent } from '@ipc/types'
import { RuneshapeScan, type Fingerprint, type ScanCapture, type ScanClock, type ScanConfig, type ScanEnv } from '../src/ocr/runeshape-scan'
import { BLOCKED_FALLBACK_MS, IDLE_STOP_BLOCKS, isIdleBlocked, nextTickDelay } from '../src/ocr/panel-scan'

function fakeClock () {
  let t = 0
  let id = 0
  const timers = new Map<number, { at: number, fn: () => void }>()
  const clock: ScanClock = {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id },
    clearTimeout: (h) => { timers.delete(h as number) }
  }
  async function advance (ms: number) {
    const end = t + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0])
      t = next[1].at
      next[1].fn()
      for (let i = 0; i < 50; i++) await Promise.resolve()
    }
    t = end
  }
  return { clock, advance, pending: () => [...timers.values()].map(v => v.at - t) }
}

const fp = (v: number): Fingerprint => ({ w: 64, h: 40, data: new Uint8Array(64 * 40).fill(v) })

function harness (over: Partial<ScanConfig> = {}, envOver: Partial<ScanEnv> = {}) {
  const clk = fakeClock()
  const cfg: ScanConfig = { enabled: true, game: 'poe2', region: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, intervalMs: 1000, ...over }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: 2000, height: 1000 }, ...envOver }
  const state = { captures: 0, frame: fp(10) }
  const events: RuneshapeScanEvent[] = []
  const scan = new RuneshapeScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => false,
    capture: async (): Promise<ScanCapture> => {
      state.captures++
      return {
        size: { w: 2000, h: 1000 },
        offset: { x: 0, y: 0 },
        client: { w: 2000, h: 1000 },
        fingerprint: () => state.frame,
        recognize: async () => ({ lines: [{ text: '1x 崇高 石', x: 1010, y: 300, w: 80, h: 20 }], ms: 5 })
      }
    },
    send: (e) => { events.push(e) },
    log: () => {}
  })
  return { scan, cfg, env, state, events, clk }
}

describe('nextTickDelay(純函式)', () => {
  it('被 scanBlock 擋下:停用 / 不是 PoE2 → 不排;其他原因 → 10 秒保底', () => {
    expect(nextTickDelay({ kind: 'blocked', block: 'disabled' }, 1000)).toBeNull()
    expect(nextTickDelay({ kind: 'blocked', block: 'not-poe2' }, 1000)).toBeNull()
    for (const b of ['not-overlay', 'no-window', 'user-paused', 'game-inactive', 'ui-open', 'no-data']) {
      expect(nextTickDelay({ kind: 'blocked', block: b }, 1000)).toBe(BLOCKED_FALLBACK_MS)
    }
    expect(BLOCKED_FALLBACK_MS).toBe(10_000)
    expect([...IDLE_STOP_BLOCKS].sort()).toEqual(['disabled', 'not-poe2'])
  })
  it('其餘結果(含 region-outside、例外 / null)照掃描間隔(與改前相同)', () => {
    expect(nextTickDelay({ kind: 'blocked', block: 'region-outside' }, 1000)).toBe(1000)
    expect(nextTickDelay({ kind: 'ocr' }, 250)).toBe(250)
    expect(nextTickDelay({ kind: 'busy' }, 9000)).toBe(3000)
    expect(nextTickDelay({ kind: 'mask-wait' }, 1000)).toBe(1000)
    expect(nextTickDelay(null, 1000)).toBe(1000)
    expect(isIdleBlocked({ kind: 'blocked', block: 'region-outside' })).toBe(false)
    expect(isIdleBlocked({ kind: 'blocked', block: 'game-inactive' })).toBe(true)
  })
})

describe('封鎖期間的 tick 數', () => {
  it('遊戲失焦 60 秒:只有第一次判斷 + 每 10 秒保底(改前 = 每秒一次 61 個)', async () => {
    const h = harness({}, { gameActive: false })
    h.scan.start()
    await h.clk.advance(0)
    expect(h.scan.stats.ticks).toBe(1)
    await h.clk.advance(60_000)
    expect(h.scan.stats.ticks).toBe(7) // t = 0, 10, 20, 30, 40, 50, 60 秒
    expect(h.state.captures).toBe(0)
    expect(h.scan.blockCounts['game-inactive']).toBe(7)
    h.scan.stop()
  })

  it('沒有遊戲視窗(no-window)/ UI 開著也走 10 秒保底', async () => {
    const h = harness({}, { bounds: null })
    h.scan.start()
    await h.clk.advance(30_000)
    expect(h.scan.stats.ticks).toBe(4)
    h.scan.stop()
    const u = harness()
    u.scan.setUiState({ panel: false, settings: true, picker: false })
    u.scan.start()
    await u.clk.advance(30_000)
    expect(u.scan.stats.ticks).toBe(4)
    u.scan.stop()
  })

  it('正常掃描不受影響:每 intervalMs 一次', async () => {
    const h = harness({ intervalMs: 500 })
    h.scan.start()
    await h.clk.advance(5000)
    expect(h.scan.stats.ticks).toBe(11)
    h.scan.stop()
  })
})

describe('事件 poke 立即恢復', () => {
  it('失焦中切回遊戲(active-change → poke):同一刻就擷取,不等保底', async () => {
    const h = harness({}, { gameActive: false })
    h.scan.start()
    await h.clk.advance(3_000)
    expect(h.state.captures).toBe(0)
    h.env.gameActive = true
    h.scan.poke()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    expect(h.events.map(e => e.reason)).toEqual(['rows'])
    // 解除後回到每秒一次
    h.state.frame = fp(90)
    await h.clk.advance(1000)
    expect(h.state.captures).toBe(2)
    h.scan.stop()
  })

  it('UI 狀態(setUiState)關掉設定視窗 → 立刻掃描', async () => {
    const h = harness()
    h.scan.setUiState({ panel: false, settings: true, picker: false })
    h.scan.start()
    await h.clk.advance(4_000)
    expect(h.state.captures).toBe(0)
    h.scan.setUiState({ panel: false, settings: false, picker: false })
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    h.scan.stop()
  })

  it('wake()(attach / detach / 視窗移動縮放):被擋下時立刻重看;正常掃描中不插 tick', async () => {
    const h = harness({}, { bounds: null })
    h.scan.start()
    await h.clk.advance(2_000)
    expect(h.scan.stats.ticks).toBe(1)
    h.env.bounds = { x: 0, y: 0, width: 2000, height: 1000 } // 遊戲 attach
    h.scan.wake()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    const ticks = h.scan.stats.ticks
    for (let i = 0; i < 20; i++) h.scan.wake() // 拖動視窗:moveresize 很密
    await h.clk.advance(0)
    expect(h.scan.stats.ticks).toBe(ticks)
    expect(h.clk.pending()).toEqual([1000])
    h.scan.stop()
  })

  it('解除封鎖的第一個 tick 不比改前慢:改前最壞要等一個掃描間隔,現在 poke 當下就跑', async () => {
    const h = harness({ intervalMs: 3000 }, { gameActive: false })
    h.scan.start()
    await h.clk.advance(1_234)
    h.env.gameActive = true
    h.scan.poke()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    h.scan.stop()
  })
})

describe('OCR 功能停用:連保底都不排', () => {
  it('disabled:第一次判斷之後 0 tick、沒有計時器;host-config poke 啟用 → 立刻掃描', async () => {
    const h = harness({ enabled: false })
    h.scan.start()
    await h.clk.advance(0)
    expect(h.scan.stats.ticks).toBe(1)
    expect(h.scan.scheduled).toBe(false)
    await h.clk.advance(120_000)
    expect(h.scan.stats.ticks).toBe(1)
    expect(h.clk.pending()).toEqual([])
    h.cfg.enabled = true
    h.scan.poke()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    expect(h.scan.scheduled).toBe(true)
    h.scan.stop()
  })

  it('not-poe2:同上(main 收到 host-config 前 game 預設 poe1)', async () => {
    const h = harness({ game: 'poe1' })
    h.scan.start()
    await h.clk.advance(60_000)
    expect(h.scan.stats.ticks).toBe(1)
    expect(h.clk.pending()).toEqual([])
    h.cfg.game = 'poe2'
    h.scan.poke()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    h.scan.stop()
  })

  it('停用中 wake() 也會重看一次(之後仍不排)', async () => {
    const h = harness({ enabled: false })
    h.scan.start()
    await h.clk.advance(0)
    h.scan.wake()
    await h.clk.advance(0)
    expect(h.scan.stats.ticks).toBe(2)
    expect(h.clk.pending()).toEqual([])
    h.scan.stop()
  })
})

describe('計時器不洩漏', () => {
  it('任何時候最多一個計時器;封鎖中連續 poke / setUiState 不會累積;stop 後 0 個', async () => {
    const h = harness({}, { gameActive: false })
    h.scan.start()
    for (let i = 0; i < 30; i++) {
      h.scan.poke()
      h.scan.setUiState({ panel: i % 2 === 0, settings: false, picker: false })
      h.scan.wake()
      await h.clk.advance(i % 3 === 0 ? 0 : 700)
      expect(h.clk.pending().length).toBeLessThanOrEqual(1)
    }
    h.env.gameActive = true
    h.scan.poke()
    await h.clk.advance(5_000)
    expect(h.clk.pending().length).toBe(1)
    h.scan.stop()
    expect(h.clk.pending()).toEqual([])
    expect(h.scan.scheduled).toBe(false)
    // stop 之後 poke / wake 不會再排
    h.scan.poke()
    h.scan.wake()
    await h.clk.advance(30_000)
    expect(h.clk.pending()).toEqual([])
  })

  it('停用 ↔ 啟用來回切換:計時器數不會增加', async () => {
    const h = harness()
    h.scan.start()
    for (let i = 0; i < 10; i++) {
      h.cfg.enabled = i % 2 === 1
      h.scan.poke()
      await h.clk.advance(0)
      expect(h.clk.pending().length).toBe(h.cfg.enabled ? 1 : 0)
    }
    h.scan.stop()
    expect(h.clk.pending()).toEqual([])
  })
})
