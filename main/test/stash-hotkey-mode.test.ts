/**
 * PoE1 倉庫價格「熱鍵顯示」模式(H1,測試規格 K1–K8):`stashTriggerMode: 'hotkey'` 時平常不擷取,按熱鍵(`arm()`)才開始掃描。
 * 假時鐘 / 假擷取 / 假 OCR(寫法同 stash-scan.test.ts),不碰 Electron、不送任何輸入。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StashScanEvent } from '@ipc/types'
import type { Fingerprint, ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import {
  STASH_ARM_MISS_LIMIT, STASH_CLEARING_BLOCKS, STASH_IDLE_INTERVAL_MS, StashScan, stashBlock, type StashScanConfig
} from '../src/ocr/stash-scan'
import { stashHotkeyAction } from '../src/shortcut-actions'
import { stashArmMissToastMessage } from '../src/startup-toast'
import { buttonRects, type TextLine } from '../../core/src/stash/detect'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const FIX_DIR = path.join(ROOT, 'core/test/stash/fixtures/ocr')
const H = 1432
const W = 2546

interface FixtureEntry { file: string, clientH: number, cropX: number, cropY: number }
const INDEX = JSON.parse(fs.readFileSync(path.join(FIX_DIR, 'index.json'), 'utf8')) as { fixtures: FixtureEntry[] }
function clientLines (name: string): TextLine[] {
  const f = INDEX.fixtures.find(x => x.file === name)
  if (!f) throw new Error(`找不到 fixture ${name}`)
  const snap = JSON.parse(fs.readFileSync(path.join(FIX_DIR, name.replace(/\.png$/, '.ocr.json')), 'utf8')) as { scale: number, lines: TextLine[] }
  const s = snap.scale
  return snap.lines.map(l => ({ text: l.text, x: l.x / s + f.cropX, y: l.y / s + f.cropY, w: l.w / s, h: l.h / s }))
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
  return { clock, advance, pending: () => [...timers.values()].map(v => v.at - t), now: () => t }
}

const fp = (v: number): Fingerprint => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(v) })
const SCARAB_BRIGHT = [140, 160, 140, 140]

function harness (mode: 'auto' | 'hotkey' = 'hotkey') {
  const clk = fakeClock()
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 500, triggerMode: mode }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 100, y: 50, width: W, height: H } }
  const state = { lines: SCARAB_LINES as TextLine[], frame: fp(10), captures: 0, captureAt: [] as number[], ocrs: 0, dark: false }
  const events: StashScanEvent[] = []
  const logs: string[] = []
  let armMiss = 0
  const scan = new StashScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => false,
    capture: async (): Promise<ScanCapture> => {
      state.captures++
      state.captureAt.push(clk.now())
      const client = { w: W, h: H }
      return {
        size: { ...client },
        offset: { x: 0, y: 0 },
        client,
        fingerprint: () => state.frame,
        recognize: async () => { state.ocrs++; return { lines: state.lines.map(l => ({ ...l })), ms: 42 } },
        gray: (rect) => {
          const k = buttonRects(client.h, 0).findIndex(b => Math.abs(b.x - rect.x) <= 1)
          return new Uint8Array(32).fill(!state.dark && k >= 0 ? SCARAB_BRIGHT[k] : 0)
        }
      }
    },
    send: (e) => { events.push(e) },
    textLang: () => 'zh',
    log: (m) => { logs.push(m) },
    onArmMiss: () => { armMiss++ }
  })
  let frameV = 10
  const changeFrame = () => { frameV = (frameV + 37) % 250; state.frame = fp(frameV) }
  return { scan, cfg, env, state, events, logs, clk, changeFrame, armMiss: () => armMiss }
}

describe('K1 熱鍵模式未觸發不截圖', () => {
  it('stashBlock:hotkey 模式未 armed = not-armed;使用者暫停優先;auto 不受影響', () => {
    const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: W, height: H } }
    const ui = { panel: false, settings: false, picker: false }
    const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 500, triggerMode: 'hotkey' }
    expect(stashBlock(cfg, env, ui, false, false)).toBe('not-armed')
    expect(stashBlock(cfg, env, ui, false, true)).toBeNull()
    expect(stashBlock(cfg, env, ui, true, false)).toBe('user-paused')
    expect(stashBlock({ ...cfg, triggerMode: 'auto' }, env, ui, false, false)).toBeNull()
    expect(stashBlock({ ...cfg, triggerMode: undefined }, env, ui, false, false)).toBeNull()
    expect(STASH_CLEARING_BLOCKS.has('not-armed')).toBe(true)
  })
  it('假時鐘跑 30 秒:擷取 0 次、原因 not-armed、不排 tick', async () => {
    const h = harness()
    h.scan.start(0)
    await h.clk.advance(30_000)
    expect(h.state.captures).toBe(0)
    expect(h.scan.snapshot().block).toBe('not-armed')
    expect(h.clk.pending()).toEqual([])
    // 視窗事件叫醒也只是再被擋一次,不擷取
    h.scan.wake()
    await h.clk.advance(30_000)
    expect(h.state.captures).toBe(0)
    expect(h.clk.pending()).toEqual([])
  })
})

describe('K2 按熱鍵後開始掃描', () => {
  it('arm():立即擷取、顯示疊層、之後間隔 = 設定值', async () => {
    const h = harness()
    h.scan.start(0)
    await h.clk.advance(1000)
    expect(h.state.captures).toBe(0)
    h.scan.arm()
    expect(h.scan.armed).toBe(true)
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    expect(h.events.map(e => e.reason)).toEqual(['show'])
    expect(h.scan.showing).toBe(true)
    expect(h.clk.pending()).toEqual([500])
  })
  it('armed 但還沒偵測到倉庫時也用設定間隔(不套閒置 3 秒下限)', async () => {
    const h = harness()
    h.state.lines = []
    h.scan.start(0)
    await h.clk.advance(100)
    h.scan.arm()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    expect(h.scan.showing).toBe(false)
    expect(h.clk.pending()).toEqual([500])
    expect(500).toBeLessThan(STASH_IDLE_INTERVAL_MS)
  })
})

describe('K3 倉庫關掉自動解除', () => {
  it('顯示中偵測不到按鈕列達上限 → hide、armed = false、之後不再擷取', async () => {
    const h = harness()
    h.scan.start(0)
    h.scan.arm()
    await h.clk.advance(0)
    expect(h.scan.showing).toBe(true)
    h.state.lines = []
    h.changeFrame()
    await h.clk.advance(2000)
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    expect(h.scan.armed).toBe(false)
    const n = h.state.captures
    await h.clk.advance(30_000)
    expect(h.state.captures).toBe(n)
    expect(h.scan.snapshot().block).toBe('not-armed')
    // 倉庫關掉收起不是「沒偵測到倉庫」,不提示
    expect(h.armMiss()).toBe(0)
  })
})

describe('K4 按了沒倉庫自動解除', () => {
  it(`arm 後連 ${STASH_ARM_MISS_LIMIT} 次沒偵測到 → 解除 + 提示一次、不再擷取`, async () => {
    expect(STASH_ARM_MISS_LIMIT).toBe(3)
    const h = harness()
    h.state.lines = []
    h.scan.start(0)
    h.scan.arm()
    await h.clk.advance(0)
    await h.clk.advance(500)
    expect(h.scan.armed).toBe(true)
    expect(h.armMiss()).toBe(0)
    await h.clk.advance(500)
    expect(h.state.captures).toBe(STASH_ARM_MISS_LIMIT)
    expect(h.scan.armed).toBe(false)
    expect(h.armMiss()).toBe(1)
    await h.clk.advance(30_000)
    expect(h.state.captures).toBe(STASH_ARM_MISS_LIMIT)
    expect(h.armMiss()).toBe(1)
    expect(h.events).toEqual([])
  })
  it('畫面靜止(差分沒變不 OCR)也算沒偵測到', async () => {
    const h = harness()
    h.state.lines = []
    h.scan.start(0)
    h.scan.arm()
    await h.clk.advance(2000)
    expect(h.state.ocrs).toBe(1)
    expect(h.scan.armed).toBe(false)
    expect(h.armMiss()).toBe(1)
  })
  it('提示字串兩語:「沒有偵測到倉庫」', () => {
    expect(stashArmMissToastMessage('cmn-Hant').title).toContain('沒有偵測到倉庫')
    expect(stashArmMissToastMessage('en').title.toLowerCase()).toContain('no stash')
  })
})

describe('K5 顯示中再按收起', () => {
  it('hotkeyPress:沒顯示 = arm、顯示中 = 收起並解除', async () => {
    const h = harness()
    h.scan.start(0)
    expect(h.scan.hotkeyPress()).toBe('armed')
    await h.clk.advance(0)
    expect(h.scan.showing).toBe(true)
    expect(h.scan.hotkeyPress()).toBe('hidden')
    expect(h.scan.showing).toBe(false)
    expect(h.scan.armed).toBe(false)
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    const n = h.state.captures
    await h.clk.advance(30_000)
    expect(h.state.captures).toBe(n)
  })
  it('擷取 / OCR 進行中解除 → 這次結果不畫', async () => {
    const h = harness()
    h.scan.arm()
    const p = h.scan.tick()
    h.scan.disarm()
    await p
    expect(h.scan.showing).toBe(false)
    expect(h.events).toEqual([])
  })
  it('stashHotkeyAction:hotkey 模式開著 = show-hide;關著 = enable;auto 照舊', () => {
    expect(stashHotkeyAction(true, 'hotkey')).toBe('show-hide')
    expect(stashHotkeyAction(undefined, 'hotkey')).toBe('show-hide')
    expect(stashHotkeyAction(false, 'hotkey')).toBe('enable')
    expect(stashHotkeyAction(true, 'auto')).toBe('toggle')
    expect(stashHotkeyAction(true)).toBe('toggle')
    expect(stashHotkeyAction(false)).toBe('enable')
  })
})

describe('K6 auto 模式行為不變', () => {
  it('auto:不用 arm 就掃描,沒顯示時間隔 = 閒置下限;arm / 沒偵測到都不提示', async () => {
    const h = harness('auto')
    h.state.lines = []
    h.scan.start(0)
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    expect(h.clk.pending()).toEqual([STASH_IDLE_INTERVAL_MS])
    await h.clk.advance(30_000)
    expect(h.armMiss()).toBe(0)
    h.state.lines = SCARAB_LINES
    h.changeFrame()
    await h.clk.advance(STASH_IDLE_INTERVAL_MS)
    expect(h.scan.showing).toBe(true)
  })
})

describe('K8 功能關著按熱鍵', () => {
  it('停用時 arm 保留到啟用:設定送達(poke)後立刻擷取並顯示', async () => {
    const h = harness()
    h.cfg.enabled = false
    h.scan.start(0)
    await h.clk.advance(1000)
    h.scan.arm()
    await h.clk.advance(1000)
    expect(h.state.captures).toBe(0)
    expect(h.scan.armed).toBe(true)
    h.cfg.enabled = true
    h.scan.poke()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    expect(h.scan.showing).toBe(true)
  })
  it('main 接線:onStashToggle 依 stashTriggerMode 分流;啟用時 hotkey 模式 arm;沒偵測到倉庫提示', () => {
    const main = fs.readFileSync(path.join(ROOT, 'main/src/main.ts'), 'utf8')
    const i = main.indexOf('onStashToggle:')
    const block = main.slice(i, main.indexOf('onScanToggleBoth', i))
    expect(block).toContain('stashHotkeyAction(hostCfg?.stashPricesEnabled, stashTriggerMode())')
    expect(block).toContain("send('stash-enable')")
    expect(block).toMatch(/stashTriggerMode\(\) === 'hotkey'\) stashScan\.arm\(\)/)
    expect(block).toContain('stashScan.hotkeyPress()')
    expect(main).toContain("triggerMode: stashTriggerMode()")
    expect(main).toMatch(/onArmMiss: \(\) => \{[^}]*stashArmMissToastMessage/)
  })
})

describe('K9 模式切換與子頁判不出', () => {
  it('hotkey → auto → hotkey 切換後沒按熱鍵就不擷取、不提示沒偵測到倉庫', async () => {
    const h = harness()
    h.scan.start(0)
    h.scan.arm()
    await h.clk.advance(0)
    expect(h.scan.showing).toBe(true)
    h.cfg.triggerMode = 'auto'
    h.scan.poke()
    await h.clk.advance(0)
    // auto 模式下倉庫關掉(auto 的收起不解除)
    h.state.lines = []
    h.changeFrame()
    await h.clk.advance(10_000)
    expect(h.scan.showing).toBe(false)
    h.cfg.triggerMode = 'hotkey'
    h.scan.poke()
    const n = h.state.captures
    await h.clk.advance(30_000)
    expect(h.scan.armed).toBe(false)
    expect(h.state.captures).toBe(n)
    expect(h.armMiss()).toBe(0)
  })
  it('顯示中一個 tick 子頁按鈕亮度全 0 → 暫時收起但仍 armed,恢復後重新顯示', async () => {
    const h = harness()
    h.scan.start(0)
    h.scan.arm()
    await h.clk.advance(0)
    expect(h.scan.showing).toBe(true)
    h.state.dark = true
    h.changeFrame()
    await h.clk.advance(500)
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    expect(h.scan.armed).toBe(true)
    h.state.dark = false
    h.changeFrame()
    await h.clk.advance(500)
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide', 'show'])
    expect(h.scan.showing).toBe(true)
    expect(h.armMiss()).toBe(0)
  })
  it('子頁一直判不出 → 比照沒偵測到倉庫,累計達上限解除並提示', async () => {
    const h = harness()
    h.state.dark = true
    h.scan.start(0)
    h.scan.arm()
    await h.clk.advance(0)
    await h.clk.advance(500 * STASH_ARM_MISS_LIMIT)
    expect(h.scan.armed).toBe(false)
    expect(h.armMiss()).toBe(1)
  })
})
