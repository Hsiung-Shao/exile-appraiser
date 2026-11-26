/**
 * PoE1 倉庫掃描:疊層沒顯示(不在倉庫)時 tick 間隔 = max(設定間隔, 3000 ms);顯示中照設定間隔。
 * 假時鐘 + 假擷取 + 假 fit·verify;不碰 Electron、不送輸入。
 */
import { describe, expect, it } from 'vitest'
import type { ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import { STASH_IDLE_INTERVAL_MS, StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import { LAYOUTS_330 as LAYOUTS, createFitFakes } from './stash-fit-fakes'

const H = 1432
const W = 2546

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
  return { clock, advance, now: () => t }
}

function harness (intervalMs: number) {
  const clk = fakeClock()
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: W, height: H } }
  const state = { frame: 10, captureAt: [] as number[] }
  const fits = createFitFakes(LAYOUTS)
  const scan = new StashScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    capture: async (): Promise<ScanCapture> => {
      state.captureAt.push(clk.now())
      state.frame = (state.frame + 37) % 250 // 每次畫面都不同 → 一定 OCR
      const client = { w: W, h: H }
      const v = state.frame
      return {
        size: { ...client },
        offset: { x: 0, y: 0 },
        client,
        fingerprint: () => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(v) }),
        recognize: async () => { throw new Error('倉庫偵測不該呼叫 OCR') },
        gray: fits.gray
      }
    },
    send: () => {},
    fit: fits.fit,
    verify: fits.verify,
    qty: { layouts: () => LAYOUTS, templates: () => null }
  })
  const gaps = () => state.captureAt.slice(1).map((t, i) => t - state.captureAt[i])
  return { scan, state, clk, gaps, fits }
}

describe('StashScan 沒顯示時放慢掃描', () => {
  it('閒置間隔常數為 3000 ms', () => {
    expect(STASH_IDLE_INTERVAL_MS).toBe(3000)
  })

  it('不在倉庫時兩次擷取間隔 ≥ 3000 ms', async () => {
    const h = harness(1000)
    h.scan.start(0)
    await h.clk.advance(10_000)
    h.scan.stop()
    expect(h.gaps().length).toBeGreaterThan(0)
    expect(Math.min(...h.gaps())).toBeGreaterThanOrEqual(3000)
  })

  it('偵測到倉庫後立刻回到設定間隔 1000 ms', async () => {
    const h = harness(1000)
    h.fits.show('general', W, H)
    h.scan.start(0)
    await h.clk.advance(5_000)
    h.scan.stop()
    expect(h.scan.showing).toBe(true)
    expect(h.gaps().every(g => g === 1000)).toBe(true)
  })

  // 設定間隔上限 3000(clampScanInterval)→ 5000 實際 = 3000;沒顯示不會比使用者設定更短
  it('使用者設 5000 ms(夾成上限 3000)時沒顯示是 3000 ms', async () => {
    const h = harness(5000)
    h.scan.start(0)
    await h.clk.advance(20_000)
    h.scan.stop()
    expect(h.gaps().length).toBeGreaterThan(0)
    expect(h.gaps().every(g => g === 3000)).toBe(true)
  })
})
