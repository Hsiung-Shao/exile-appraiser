/**
 * PoE1 倉庫掃描:疊層沒顯示(不在倉庫)時 tick 間隔 = max(設定間隔, 3000 ms);顯示中照設定間隔。
 * 假時鐘 + 假擷取 + 真實 OCR 快照(core/test/stash/fixtures/ocr);不碰 Electron、不送輸入。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import { STASH_IDLE_INTERVAL_MS, StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import { buttonRects, type TextLine } from '../../core/src/stash/detect'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX_DIR = path.join(HERE, '../../core/test/stash/fixtures/ocr')
const H = 1432
const W = 2546
interface FixtureEntry { file: string, cropX: number, cropY: number }
const INDEX = JSON.parse(fs.readFileSync(path.join(FIX_DIR, 'index.json'), 'utf8')) as { fixtures: FixtureEntry[] }
function clientLines (name: string): TextLine[] {
  const f = INDEX.fixtures.find(x => x.file === name)!
  const snap = JSON.parse(fs.readFileSync(path.join(FIX_DIR, name.replace(/\.png$/, '.ocr.json')), 'utf8')) as { scale: number, lines: TextLine[] }
  return snap.lines.map(l => ({ text: l.text, x: l.x / snap.scale + f.cropX, y: l.y / snap.scale + f.cropY, w: l.w / snap.scale, h: l.h / snap.scale }))
}
const SCARAB_LINES = clientLines('strip-scarabs-1432.png')

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
  const state = { lines: [] as TextLine[], frame: 10, captureAt: [] as number[] }
  const scan = new StashScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => false,
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
        recognize: async () => ({ lines: state.lines.map(l => ({ ...l })), ms: 5 }),
        gray: (rect) => {
          const k = buttonRects(client.h, 0).findIndex(b => Math.abs(b.x - rect.x) <= 1)
          return new Uint8Array(32).fill(k === 1 ? 160 : 140)
        }
      }
    },
    send: () => {},
    textLang: () => 'zh'
  })
  const gaps = () => state.captureAt.slice(1).map((t, i) => t - state.captureAt[i])
  return { scan, state, clk, gaps }
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
    h.state.lines = SCARAB_LINES
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
