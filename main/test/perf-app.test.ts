// B8:效能紀錄改為整個 app —— PoE1 倉庫掃描計數、renderer 指標彙整、摘要依區塊分列、IPC 守門、取樣不再讀 config.json。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PerfRendererReport } from '@ipc/types'
import type { Fingerprint, ScanCapture, ScanEnv } from '../src/ocr/panel-scan'
import { StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import {
  PerfMonitor, RendererPerfAccumulator, bgActiveFromConfigText, deriveScenario, formatPerfSummary, perfSummarySections,
  stashSnapshotOf, type PerfTimers, type ScanSnapshot, type ScenarioInput
} from '../src/perf/perf-monitor'
import { LagProbe } from '../src/perf/lag-probe'
import { HOST_METHOD_CHANNELS, bootScript } from '../src/preview-server'
import { PREVIEW_EVENTS } from '../src/host-handlers'

class FakeTimers implements PerfTimers {
  private next = 1
  readonly pending = new Map<number, { fn: () => void, ms: number }>()
  set (fn: () => void, ms: number) { const id = this.next++; this.pending.set(id, { fn, ms }); return id }
  clear (h: unknown) { this.pending.delete(h as number) }
}

const snap = (o: Partial<ScanSnapshot> = {}): ScanSnapshot => ({
  reason: null, ticks: 0, captures: 0, ocrRuns: 0, locates: 0, skippedUnchanged: 0, skippedBusy: 0, blockCounts: {}, ...o
})

const base: ScenarioInput = {
  mode: 'overlay', gameAttached: true, gameForeground: true, ui: { panel: false, settings: false, picker: false },
  revealReason: 'disabled', runeReason: 'disabled', bg: false, windowVisible: true
}

function report (o: Partial<PerfRendererReport> = {}): PerfRendererReport {
  return {
    windowMs: 5000,
    longTask: { n: 0, totalMs: 0, maxMs: 0 },
    frames: { n: 0, p95: 0, max: 0 },
    query: { parseMs: [], firstMs: [] },
    bg: { redraws: 0, adopts: 0, loads: 0, loadMs: [], drawMs: [], encodeMs: [], decodeMs: [] },
    ...o
  }
}

function stashHarness () {
  const cfg: StashScanConfig = { enabled: false, game: 'poe1', intervalMs: 1000 }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: 2560, height: 1440 } }
  const st = { busy: false, frame: 10 }
  const fp = (): Fingerprint => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(st.frame) })
  const scan = new StashScan({
    clock: { now: () => 0, setTimeout: () => 1, clearTimeout: () => {} },
    config: () => cfg,
    env: () => env,
    ocrBusy: () => st.busy,
    capture: async (): Promise<ScanCapture> => ({
      size: { w: 2560, h: 1440 },
      offset: { x: 0, y: 0 },
      client: { w: 2560, h: 1440 },
      fingerprint: fp,
      recognize: async () => ({ lines: [], ms: 5 })
    }),
    send: () => {},
    log: () => {}
  })
  return { scan, cfg, st }
}

// ---------------------------------------------------------------------------------------------------------------------

describe('T14 perf 含倉庫掃描', () => {
  it('StashScan 計數只 ++:被擋 / 擷取 / 沒變 / 忙碌 / OCR 次數', async () => {
    const h = stashHarness()
    await h.scan.tick()
    await h.scan.tick()
    expect(h.scan.blockCounts).toEqual({ disabled: 2 })
    expect(h.scan.counters.captures).toBe(0)
    h.cfg.enabled = true
    await h.scan.tick() // 擷取 + OCR(沒有基準)
    await h.scan.tick() // 擷取,畫面沒變
    h.st.busy = true
    await h.scan.tick() // WinOcr 忙碌,不擷取
    expect(h.scan.counters).toEqual({ ticks: 5, captures: 2, ocrRuns: 1, skippedUnchanged: 1, skippedBusy: 1, qtyRuns: 0, qtyCells: 0, qtyPeeks: 0, qtyCursorSkips: 0, qtyMasked: 0, maskWaits: 0 })
  })

  it('stashSnapshotOf:沒啟動 = stopped;被擋原因;計數轉成 ScanSnapshot', async () => {
    const h = stashHarness()
    await h.scan.tick()
    expect(stashSnapshotOf(h.scan)).toMatchObject({ reason: 'stopped', ticks: 1, captures: 0, blockCounts: { disabled: 1 } })
    h.scan.start(60_000)
    expect(stashSnapshotOf(h.scan).reason).toBe('disabled')
    h.cfg.enabled = true
    await h.scan.tick()
    expect(stashSnapshotOf(h.scan)).toMatchObject({ reason: null, captures: 1, ocrRuns: 1, locates: 0 })
    h.scan.stop()
  })

  it('情境鍵:倉庫掃描開著加 +stash;停用 / 不是 PoE1 不加', () => {
    expect(deriveScenario({ ...base, stashReason: null }).key).toBe('fg-idle+stash')
    expect(deriveScenario({ ...base, stashReason: 'game-inactive', gameForeground: false }).key).toBe('game-bg+stash')
    expect(deriveScenario({ ...base, stashReason: 'not-poe1' }).key).toBe('fg-idle')
    expect(deriveScenario({ ...base, stashReason: 'disabled' }).key).toBe('fg-idle')
    expect(deriveScenario(base).tags.stashOcr).toBe(false)
  })

  it('取樣含倉庫速率,摘要的辨識區塊列出倉庫 / 褻瀆 / 符文', async () => {
    const h = monitor()
    h.m.start()
    h.st.scans = { ...h.st.scans, stash: snap({ reason: null, ticks: 10, captures: 10, ocrRuns: 2 }) }
    h.advance(5000)
    const s = (await h.m.sample())!
    expect(s.stash).toMatchObject({ state: 'active', capPerSec: 2, ocrPerSec: 0.4 })
    const scan = perfSummarySections(s).find(x => x.key === 'scan')!
    expect(scan.text).toMatch(/^倉庫 擷取 2\/s OCR 0\.4\/s · 褻瀆 disabled · 符文 not-poe2$/)
    h.m.stop()
  })
})

describe('摘要依區塊分列', () => {
  it('區塊順序:行程 / main 卡頓 / renderer / 查價 / 辨識 / 背景圖 / 系統;一行摘要 = 情境 + 各區塊', async () => {
    const h = monitor()
    h.m.start()
    h.advance(5000)
    const s = (await h.m.sample())!
    const sec = perfSummarySections(s)
    expect(sec.map(x => x.key)).toEqual(['proc', 'lag', 'renderer', 'query', 'scan', 'bg', 'sys'])
    expect(sec[0].text).toBe('CPU 1.5%(Browser 1.2 GPU 0.3)WS 200 MB')
    expect(sec.find(x => x.key === 'renderer')!.text).toBe('沒有回報')
    expect(formatPerfSummary(s)).toBe(`[perf] 情境 ${s.scenario} | ` + sec.map(x => x.text).join(' | '))
    h.m.stop()
  })
})

describe('renderer 指標彙整(perf-renderer)', () => {
  it('不可信的 payload 丟掉;合法的累加,drain 後清空', () => {
    const acc = new RendererPerfAccumulator()
    acc.add(null)
    acc.add({ windowMs: 'x' })
    acc.add({ ...report(), longTask: { n: -1, totalMs: 0, maxMs: 0 } })
    expect(acc.drain()).toBeNull()
    acc.add(report({ longTask: { n: 2, totalMs: 130, maxMs: 90 }, frames: { n: 300, p95: 17.2, max: 40 } }))
    acc.add(report({ longTask: { n: 1, totalMs: 60, maxMs: 60 }, frames: { n: 100, p95: 33.4, max: 50 } }))
    const r = acc.drain()!
    expect(r.reports).toBe(2)
    expect(r.longTask).toEqual({ n: 3, totalMs: 190, maxMs: 90 })
    // p95 合併取較大(保守);n 加總
    expect(r.frames).toEqual({ n: 400, p95: 33.4, max: 50 })
    expect(acc.drain()).toBeNull()
  })

  it('查價延遲 / 背景圖耗時:p50 / p95 / max;陣列有上限', () => {
    const acc = new RendererPerfAccumulator()
    acc.add(report({ query: { parseMs: [10, 20, 30], firstMs: [400, 800] }, bg: { redraws: 1, adopts: 2, loads: 1, loadMs: [120], drawMs: [300], encodeMs: [90], decodeMs: [8] } }))
    acc.add(report({ query: { parseMs: [40], firstMs: [600] } }))
    acc.add(report({ query: { parseMs: Array.from({ length: 5000 }, () => 1), firstMs: [] } }))
    const r = acc.drain()!
    expect(r.query.n).toBe(3) // firstMs 筆數 = 查到結果的次數
    expect(r.query.first).toEqual({ p50: 600, p95: 800, max: 800 })
    expect(r.query.parse).toMatchObject({ n: 500, max: 1 }) // 只留最新 500 筆
    expect(r.bg).toEqual({ redraws: 1, adopts: 2, loads: 1, load: { p50: 120, p95: 120, max: 120 }, draw: { p50: 300, p95: 300, max: 300 }, encode: { p50: 90, p95: 90, max: 90 }, decode: { p50: 8, p95: 8, max: 8 } })
  })

  it('取樣帶 renderer 摘要,沒有回報 = null;摘要文字含 longtask / 幀 / 查價 / 背景圖', async () => {
    const h = monitor()
    h.m.start()
    h.advance(5000)
    expect((await h.m.sample())!.renderer).toBeNull()
    h.acc.add(report({ longTask: { n: 2, totalMs: 130, maxMs: 90 }, frames: { n: 300, p95: 17.2, max: 40 }, query: { parseMs: [30], firstMs: [700] }, bg: { redraws: 1, adopts: 0, loads: 1, loadMs: [120], drawMs: [300], encodeMs: [90], decodeMs: [8] } }))
    h.advance(5000)
    const s = (await h.m.sample())!
    expect(s.renderer?.longTask.n).toBe(2)
    const sec = Object.fromEntries(perfSummarySections(s).map(x => [x.key, x.text]))
    expect(sec.renderer).toBe('longtask 2 次 130 ms(最長 90)· 幀間隔 p95 17.2 / 最長 40 ms')
    expect(sec.query).toBe('1 次 · 解析 p50 30 · 第一筆結果 p50 700 / p95 700 / 最長 700 ms')
    expect(sec.bg).toBe('重畫 1 · 快取換上 0 · 載入 1(120 ms)· 繪製 300 · 編碼 90 · 解碼 8 ms')
    h.m.stop()
  })
})

describe('T16 perf IPC 不開放預覽', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8')
  const main = read('main.ts')
  const preload = read('preload.ts')
  const entry = (ch: string) => {
    const i = main.indexOf(`'${ch}':`)
    expect(i, `main.ts 沒有登錄 ${ch}`).toBeGreaterThan(0)
    const rest = main.slice(i + 1)
    const next = rest.search(/\n    '[a-z-]+':/)
    return main.slice(i, i + 1 + (next < 0 ? rest.length : next))
  }

  it('perf-renderer:send + preview: false,不在預覽方法表', () => {
    const e = entry('perf-renderer')
    expect(e).toContain("kind: 'send'")
    expect(e).toContain('preview: false')
    expect(Object.values(HOST_METHOD_CHANNELS)).not.toContain('perf-renderer')
  })

  it('perf-state 事件不在 PREVIEW_EVENTS;preload 對應;預覽 boot script 沒有這兩個方法', () => {
    expect(PREVIEW_EVENTS.has('perf-state')).toBe(false)
    expect(preload).toContain("ipcRenderer.send('perf-renderer', r)")
    expect(preload).toContain("subscribe('perf-state', cb)")
    const s = bootScript({ prefix: '/t/' + 'a'.repeat(32) + '/', version: '1.0.0' })
    expect(s).not.toContain('perfRenderer')
    expect(s).not.toContain('perf-state')
  })

  it('perf 開關時廣播 perf-state;倉庫掃描接進 scans', () => {
    expect(main).toMatch(/send\('perf-state'/)
    expect(main).toMatch(/stash: stashSnapshotOf\(stashScan\)/)
    expect(main).toMatch(/stashReason: stashSnapshotOf\(stashScan\)\.reason/)
  })

  it('取樣不再每次讀 config.json:背景圖旗標用記憶體(config-save 時更新)', () => {
    const i = main.indexOf('const perf = new PerfMonitor(')
    const block = main.slice(i, main.indexOf('})\n', i))
    expect(block).not.toMatch(/readFile|CONFIG_PATH/)
    expect(main).not.toMatch(/readBgActive/)
    expect(main).toMatch(/bgActiveFromConfigText\(contents\)/)
  })
})

describe('bgActiveFromConfigText', () => {
  it.each<[string, boolean | null]>([
    ['{"bg":{"enabled":true,"file":"a.png"}}', true],
    ['{"bg":{"file":"a.png"}}', true],
    ['{"bg":{"enabled":false,"file":"a.png"}}', false],
    ['{"bg":{"enabled":true,"file":""}}', false],
    ['{}', false],
    ['not json', null]
  ])('%s → %s', (text, want) => {
    expect(bgActiveFromConfigText(text)).toBe(want)
  })
})

// ---------------------------------------------------------------------------------------------------------------------

function monitor () {
  const timers = new FakeTimers()
  let t = new Date(2026, 9, 14, 12).getTime()
  const acc = new RendererPerfAccumulator()
  const st = {
    scans: { reveal: snap({ reason: 'disabled' }), rune: snap({ reason: 'not-poe2' }), stash: snap({ reason: 'disabled' }) }
  }
  const m = new PerfMonitor({
    metrics: () => [
      { pid: 10, type: 'Browser', cpu: { percentCPUUsage: 1.2 }, memory: { workingSetSize: 120 * 1024 } },
      { pid: 11, type: 'GPU', cpu: { percentCPUUsage: 0.3 }, memory: { workingSetSize: 80 * 1024 } }
    ],
    scenario: () => ({ ...base }),
    scans: () => st.scans,
    uiohook: () => ({ running: false, holders: 0 }),
    detector: () => ({ enums: 0, processProbes: 0, running: true }),
    winOcr: () => ({ running: false }),
    renderer: () => acc.drain(),
    write: () => {},
    log: () => {},
    timers,
    now: () => t,
    lagProbe: new LagProbe(20, { now: () => 0, setTimeout: () => 1, clearTimeout: () => {} })
  })
  return { m, st, acc, advance: (ms: number) => { t += ms } }
}
