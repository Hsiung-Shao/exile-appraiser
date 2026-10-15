/**
 * PoE1 倉庫掃描:overlay screenshot 「全黑」鎖存(全螢幕獨占)期間不擷取(不再每秒 getSources 卡 main)。
 * 假時鐘 + 假擷取;不碰 Electron、不送輸入。
 */
import { describe, expect, it, vi } from 'vitest'
import type { StashScanEvent } from '@ipc/types'
import type { ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import { StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import { createGameClientCapture, LATCH_AFTER, LATCH_RETRY_MS, type CropImage, type PhysRect } from '../src/ocr/overlay-shot'

interface Img extends CropImage<Img> { tag: string }
const img = (tag: string): Img => ({ tag, crop: () => img(tag) })

const B: PhysRect = { x: 0, y: 0, width: 200, height: 100 }

function capSetup (shotImpl: () => Buffer, bounds: () => PhysRect = () => B) {
  const clock = { t: 1_000_000 }
  const shot = vi.fn(shotImpl)
  const cap = createGameClientCapture<Img>({
    screenshot: shot,
    shotBounds: bounds,
    display: () => ({ x: 0, y: 0, width: 4000, height: 3000 }),
    fromBitmap: () => img('overlay'),
    fallback: async (b) => ({ image: img('sources'), offset: { x: 0, y: 0 }, client: { w: b.width, h: b.height } }),
    now: () => clock.t
  })
  return { cap, shot, clock }
}
const blackBuf = () => Buffer.alloc(B.width * B.height * 4)

describe('overlay-shot blackLatchRemainingMs', () => {
  it('全黑鎖存後回剩餘毫秒,期滿 / bounds 改變 / reset 後回 0', async () => {
    let cur = B
    const { cap, clock } = capSetup(blackBuf, () => cur)
    expect(cap.blackLatchRemainingMs()).toBe(0)
    for (let i = 0; i < LATCH_AFTER; i++) await cap.capture(B)
    expect(cap.blackLatchRemainingMs()).toBe(LATCH_RETRY_MS)
    clock.t += 12_000
    expect(cap.blackLatchRemainingMs()).toBe(LATCH_RETRY_MS - 12_000)
    clock.t += LATCH_RETRY_MS
    expect(cap.blackLatchRemainingMs()).toBe(0)
    clock.t -= LATCH_RETRY_MS
    cur = { ...B, x: 5 }
    expect(cap.blackLatchRemainingMs()).toBe(0)
    cur = B
    cap.reset()
    expect(cap.blackLatchRemainingMs()).toBe(0)
  })

  it('throw 鎖存不算全黑(回 0)', async () => {
    const { cap } = capSetup(() => { throw new Error('x') })
    for (let i = 0; i < LATCH_AFTER; i++) await cap.capture(B)
    expect(cap.isLatched).toBe(true)
    expect(cap.blackLatchRemainingMs()).toBe(0)
  })
})

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
    for (let i = 0; i < 50; i++) await Promise.resolve()
  }
  return { clock, advance, pending: () => [...timers.values()].map(v => v.at - t) }
}

function scanHarness () {
  const clk = fakeClock()
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 1000 }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: 2546, height: 1432 } }
  const state = { blackMs: 0, captures: 0 }
  const logs: string[] = []
  const events: StashScanEvent[] = []
  const scan = new StashScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => false,
    captureBlackMs: () => state.blackMs,
    capture: async (): Promise<ScanCapture> => {
      state.captures++
      const client = { w: 2546, h: 1432 }
      return {
        size: { ...client },
        offset: { x: 0, y: 0 },
        client,
        fingerprint: () => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(7) }),
        recognize: async () => ({ lines: [], ms: 5 }),
        gray: () => new Uint8Array(32)
      }
    },
    send: (e) => { events.push(e) },
    log: (m) => { logs.push(m) }
  })
  return { scan, state, logs, events, clk }
}

describe('StashScan 全黑鎖存時不擷取', () => {
  it('鎖存中 tick 被擋下、原因 capture-black、不呼叫擷取', async () => {
    const h = scanHarness()
    h.state.blackMs = 20_000
    const r = await h.scan.tick()
    expect(r).toMatchObject({ kind: 'blocked', block: 'capture-black', retryMs: 20_000 })
    expect(h.state.captures).toBe(0)
    expect(h.scan.blockCounts['capture-black']).toBe(1)
    expect(h.scan.snapshot().block).toBe('capture-black')
  })

  it('鎖存中保底重看不超過剩餘時間,期滿後恢復擷取', async () => {
    const h = scanHarness()
    h.state.blackMs = 4_000
    h.scan.start(0)
    await h.clk.advance(0)
    expect(h.state.captures).toBe(0)
    expect(Math.max(...h.clk.pending())).toBeLessThanOrEqual(4_000)
    h.state.blackMs = 0
    await h.clk.advance(4_000)
    expect(h.state.captures).toBeGreaterThan(0)
    h.scan.stop()
  })

  it('reset 後 poke 立刻恢復擷取', async () => {
    const h = scanHarness()
    h.state.blackMs = 25_000
    h.scan.start(0)
    await h.clk.advance(0)
    expect(h.state.captures).toBe(0)
    h.state.blackMs = 0
    h.scan.poke()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    h.scan.stop()
  })

  it('進入與離開全黑狀態各只記一行 [stash] log', async () => {
    const h = scanHarness()
    h.state.blackMs = 20_000
    for (let i = 0; i < 4; i++) await h.scan.tick()
    h.state.blackMs = 0
    for (let i = 0; i < 3; i++) await h.scan.tick()
    const enter = h.logs.filter(l => l.startsWith('[stash]') && l.includes('capture-black'))
    const leave = h.logs.filter(l => l === '[stash] 繼續掃描')
    expect(enter).toHaveLength(1)
    expect(leave).toHaveLength(1)
  })

  it('沒注入 captureBlackMs = 照常擷取(褻瀆 / 符文與舊行為不變)', async () => {
    const h = scanHarness()
    const scan = new StashScan({
      clock: h.clk.clock,
      config: () => ({ enabled: true, game: 'poe1', intervalMs: 1000 }),
      env: () => ({ overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: 2546, height: 1432 } }),
      ocrBusy: () => false,
      capture: async () => { h.state.captures++; throw new Error('stop') },
      send: () => {}
    })
    await scan.tick()
    expect(h.state.captures).toBe(1)
  })
})
