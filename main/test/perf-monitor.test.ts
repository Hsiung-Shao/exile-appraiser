// 第 29 步:效能診斷(main/src/perf/):卡頓探針、行程加總、掃描速率、情境標記、JSONL / 摘要格式、監測器開關(關著零計時器 / 零監聽)、
// perf 檔名與共用 LogFileWriter 的輪替 / 清除、各模組計數器(GameDetector / PanelScan),以及 IPC 登錄表守門。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ desktopCapturer: { getSources: vi.fn() } }))

import { LagProbe, summarizeLag, type LagProbeClock } from '../src/perf/lag-probe'
import {
  PerfMonitor, aggregateProcs, deriveScenario, formatPerfJsonl, formatPerfSummary, isPerfFile, ocrOn, perfFileName, scanRates, scanSnapshotOf,
  type PerfTimers, type ScanSnapshot, type ScenarioInput
} from '../src/perf/perf-monitor'
import { LogFileWriter, type LogAppender, type LogFs } from '../src/app-log'
import { GameDetector, detectorCounters } from '../src/windowing/GameDetector'
import { RuneshapeScan } from '../src/ocr/runeshape-scan'
import type { ScanConfig, ScanEnv } from '../src/ocr/panel-scan'
import { HOST_METHOD_CHANNELS, bootScript } from '../src/preview-server'

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime()

class FakeTimers implements PerfTimers {
  private next = 1
  readonly pending = new Map<number, { fn: () => void, ms: number }>()
  set (fn: () => void, ms: number) { const id = this.next++; this.pending.set(id, { fn, ms }); return id }
  clear (h: unknown) { this.pending.delete(h as number) }
}

// ---------------------------------------------------------------------------------------------------------------------

describe('LagProbe / summarizeLag', () => {
  it('summarizeLag:p95 / 最長,負值當 0,空 = 0', () => {
    expect(summarizeLag([])).toEqual({ n: 0, p95: 0, max: 0 })
    const v = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    expect(summarizeLag(v)).toEqual({ n: 100, p95: 96, max: 100 })
    expect(summarizeLag([-3, -1, 2.25])).toEqual({ n: 3, p95: 2.3, max: 2.3 })
  })

  it('假時鐘:每 tick 記「實際間隔 − 間隔」;drain 取摘要並清空;stop 後不再排', () => {
    let t = 0
    const q: Array<() => void> = []
    const clock: LagProbeClock = { now: () => t, setTimeout: (fn) => { q.push(fn); return q.length }, clearTimeout: () => { q.length = 0 } }
    const p = new LagProbe(20, clock)
    p.start()
    expect(p.running).toBe(true)
    for (const gap of [20, 20, 70, 25]) { t += gap; q.shift()!() }
    expect(p.maxLag(0, 1000)).toBe(50)
    expect(p.drain()).toEqual({ n: 4, p95: 50, max: 50 })
    expect(p.drain().n).toBe(0)
    p.stop()
    expect(p.running).toBe(false)
    expect(q).toHaveLength(0)
  })
})

describe('aggregateProcs', () => {
  it('逐行程、依 type 加總、全部加總(工作集 KB → MB)', () => {
    const a = aggregateProcs([
      { pid: 1, type: 'Browser', cpu: { percentCPUUsage: 1.04 }, memory: { workingSetSize: 102400 } },
      { pid: 2, type: 'GPU', cpu: { percentCPUUsage: 0.5 }, memory: { workingSetSize: 51200 } },
      { pid: 3, type: 'Tab', name: 'renderer', cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 204800 } },
      { pid: 4, type: 'Tab', cpu: { percentCPUUsage: Number.NaN }, memory: { workingSetSize: 1024 } }
    ])
    expect(a.cpu.total).toBe(3.5)
    expect(a.cpu.byType).toEqual({ Browser: 1, GPU: 0.5, Tab: 2 })
    expect(a.wsMB.total).toBe(351)
    expect(a.wsMB.byType).toEqual({ Browser: 100, GPU: 50, Tab: 201 })
    expect(a.procs[2]).toEqual({ pid: 3, type: 'Tab', name: 'renderer', cpu: 2, wsMB: 200 })
    expect(a.procs[3].cpu).toBe(0)
  })
})

const snap = (o: Partial<ScanSnapshot> = {}): ScanSnapshot => ({
  reason: null, ticks: 0, captures: 0, ocrRuns: 0, locates: 0, skippedUnchanged: 0, skippedBusy: 0, blockCounts: {}, ...o
})

describe('scanRates', () => {
  it('兩次累計 → 視窗內次數 / 每秒;被擋原因只列有增加的', () => {
    const prev = snap({ ticks: 10, captures: 4, ocrRuns: 1, blockCounts: { 'ui-open': 3, 'game-inactive': 2 } })
    const cur = snap({ reason: 'ui-open', ticks: 15, captures: 9, ocrRuns: 3, locates: 1, blockCounts: { 'ui-open': 5, 'game-inactive': 2 } })
    expect(scanRates(prev, cur, 5000)).toEqual({
      state: 'ui-open', ticks: 5, capPerSec: 1, ocrPerSec: 0.4, locates: 1, skippedUnchanged: 0, skippedBusy: 0, blocked: { 'ui-open': 2 }
    })
    expect(scanRates(null, snap({ captures: 3 }), 2000)).toMatchObject({ state: 'active', capPerSec: 1.5 })
  })
})

const base: ScenarioInput = {
  mode: 'overlay', gameAttached: true, gameForeground: true, ui: { panel: false, settings: false, picker: false },
  revealReason: 'disabled', runeReason: 'disabled', bg: false, windowVisible: true
}

describe('deriveScenario(情境標記)', () => {
  it.each<[string, Partial<ScenarioInput>, string]>([
    ['window 模式', { mode: 'window', gameAttached: null, gameForeground: null, ui: null }, 'window'],
    ['遊戲沒開', { gameAttached: false, gameForeground: false }, 'no-game'],
    ['還沒 attach 資訊', { gameAttached: null }, 'no-game'],
    ['遊戲不在前景', { gameForeground: false }, 'game-bg'],
    ['前景無面板', {}, 'fg-idle'],
    ['查價面板', { ui: { panel: true, settings: false, picker: false } }, 'panel'],
    ['設定視窗(優先於面板)', { ui: { panel: true, settings: true, picker: false } }, 'settings'],
    ['框選層', { ui: { panel: false, settings: true, picker: true } }, 'picker'],
    ['褻瀆 OCR(失焦暫停仍算開)', { revealReason: 'game-inactive', gameForeground: false }, 'game-bg+reveal'],
    ['褻瀆 + 符文掃描中', { revealReason: null, runeReason: null }, 'fg-idle+reveal+rune'],
    ['使用者暫停 = 關', { revealReason: 'user-paused' }, 'fg-idle'],
    ['PoE1 = 關', { revealReason: 'not-poe2', runeReason: 'not-poe2' }, 'fg-idle'],
    ['背景圖 + 面板', { bg: true, ui: { panel: true, settings: false, picker: false } }, 'panel+bg'],
    ['背景圖但沒有面板 = 不加', { bg: true }, 'fg-idle'],
    ['window 模式背景圖看視窗顯示', { mode: 'window', gameAttached: null, ui: null, bg: true, windowVisible: true }, 'window+bg']
  ])('%s → %s', (_n, over, key) => {
    expect(deriveScenario({ ...base, ...over }).key).toBe(key)
  })

  it('tags:window 模式遊戲 / 面板狀態未知', () => {
    const { tags } = deriveScenario({ ...base, mode: 'window', gameAttached: null, gameForeground: null, ui: null, windowVisible: false })
    expect(tags).toMatchObject({ mode: 'window', game: 'unknown', panel: null, settings: null, windowVisible: false })
  })

  it('ocrOn:關的原因清單', () => {
    for (const r of ['disabled', 'not-poe2', 'not-overlay', 'user-paused', 'no-data', 'stopped']) expect(ocrOn(r)).toBe(false)
    for (const r of [null, 'game-inactive', 'ui-open', 'no-window', 'region-outside']) expect(ocrOn(r)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------------------

function monitorHarness () {
  const timers = new FakeTimers()
  let t = at(2026, 10, 3, 12)
  const listeners = new Set<() => void>()
  const st = {
    scans: { reveal: snap({ reason: 'disabled' }), rune: snap({ reason: 'not-poe2' }) },
    detect: { enums: 5, processProbes: 0, running: true },
    metricsCalls: 0
  }
  const written: string[] = []
  const logged: string[] = []
  const probe = new LagProbe(20, { now: () => 0, setTimeout: () => 1, clearTimeout: () => {} })
  const m = new PerfMonitor({
    metrics: () => {
      st.metricsCalls++
      return [
        { pid: 10, type: 'Browser', cpu: { percentCPUUsage: 1.2 }, memory: { workingSetSize: 120 * 1024 } },
        { pid: 11, type: 'GPU', cpu: { percentCPUUsage: 0.3 }, memory: { workingSetSize: 80 * 1024 } }
      ]
    },
    scenario: async () => ({ ...base }),
    scans: () => st.scans,
    uiohook: () => ({ running: false, holders: 0 }),
    hookEvents: { on: (fn) => { listeners.add(fn) }, off: (fn) => { listeners.delete(fn) } },
    detector: () => st.detect,
    winOcr: () => ({ running: true, pid: 4242 }),
    write: (l) => { written.push(l) },
    log: (l) => { logged.push(l) },
    timers,
    now: () => t,
    lagProbe: probe
  })
  return { m, timers, listeners, st, written, logged, advance: (ms: number) => { t += ms } }
}

describe('PerfMonitor', () => {
  it('建立 / 關著:不開計時器、不掛監聽、不取指標(零成本)', async () => {
    const h = monitorHarness()
    expect(h.m.enabled).toBe(false)
    expect(h.timers.pending.size).toBe(0)
    expect(h.listeners.size).toBe(0)
    expect(h.st.metricsCalls).toBe(0)
    expect(await h.m.sample()).toBeNull()
    expect(h.written).toHaveLength(0)
  })

  it('開著:5 秒一筆,JSONL 一行 + app-log 摘要;計數只算增量;stop 拔監聽與計時器', async () => {
    const h = monitorHarness()
    h.m.start()
    expect(h.m.enabled).toBe(true)
    expect(h.st.metricsCalls).toBe(1) // 基準呼叫(CPU% 從這次起算)
    expect(h.listeners.size).toBe(1)
    expect([...h.timers.pending.values()][0].ms).toBe(5000)
    // 視窗內:uiohook 10 個事件、列舉 +2、褻瀆擷取 5 次
    for (const fn of h.listeners) for (let i = 0; i < 10; i++) fn()
    h.st.detect = { ...h.st.detect, enums: 7 }
    h.st.scans = { ...h.st.scans, reveal: snap({ reason: null, captures: 5, ocrRuns: 1, ticks: 5 }) }
    h.advance(5000)
    const s = await h.m.sample()
    expect(s).not.toBeNull()
    expect(s!.windowMs).toBe(5000)
    expect(s!.scenario).toBe('fg-idle')
    expect(s!.uiohook.evPerSec).toBe(2)
    expect(s!.detect.enums).toBe(2)
    expect(s!.reveal).toMatchObject({ state: 'active', capPerSec: 1, ocrPerSec: 0.2 })
    expect(s!.rune.state).toBe('not-poe2')
    expect(s!.cpu.total).toBe(1.5)
    expect(s!.wsMB.total).toBe(200)
    expect(s!.winOcr).toEqual({ running: true, pid: 4242 })
    expect(h.written).toHaveLength(1)
    expect(h.written[0]).not.toContain('\n')
    expect(JSON.parse(h.written[0])).toEqual(JSON.parse(JSON.stringify(s)))
    expect(h.logged.at(-1)).toBe(formatPerfSummary(s!))
    expect(h.m.last).toBe(s)
    // 第二筆:沒有新事件 → 0
    h.advance(5000)
    const s2 = await h.m.sample()
    expect(s2!.uiohook.evPerSec).toBe(0)
    expect(s2!.detect.enums).toBe(0)
    h.m.stop()
    expect(h.m.enabled).toBe(false)
    expect(h.listeners.size).toBe(0)
    expect(h.timers.pending.size).toBe(0)
    expect(await h.m.sample()).toBeNull()
  })

  it('計時器到期 → 取樣後重新排下一次', async () => {
    const h = monitorHarness()
    h.m.start()
    const [id, t] = [...h.timers.pending.entries()][0]
    h.timers.pending.delete(id)
    h.advance(5000)
    t.fn()
    await vi.waitFor(() => { expect(h.written).toHaveLength(1) })
    await vi.waitFor(() => { expect(h.timers.pending.size).toBe(1) })
    h.m.stop()
  })
})

describe('JSONL / 摘要格式', () => {
  it('formatPerfJsonl 是單行合法 JSON,含 schema 版本與情境;摘要以 [perf] 開頭', async () => {
    const h = monitorHarness()
    h.m.start()
    h.advance(5000)
    const s = (await h.m.sample())!
    const line = formatPerfJsonl(s)
    expect(line.split('\n')).toHaveLength(1)
    const o = JSON.parse(line)
    expect(o).toMatchObject({ v: 1, scenario: 'fg-idle', tags: { mode: 'overlay', game: 'foreground' } })
    expect(Object.keys(o)).toEqual(['v', 'ts', 'time', 'windowMs', 'scenario', 'tags', 'cpu', 'wsMB', 'procs', 'lag', 'uiohook', 'reveal', 'rune', 'detect', 'winOcr'])
    expect(o.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)
    const sum = formatPerfSummary(s)
    expect(sum.startsWith('[perf] 情境 fg-idle | CPU 1.5%(Browser 1.2 GPU 0.3)WS 200 MB |')).toBe(true)
    expect(sum).toContain('褻瀆 disabled')
    expect(sum).toContain('WinOcr pid 4242')
    h.m.stop()
  })
})

describe('perf 檔名 + LogFileWriter 共用', () => {
  it('perfFileName / isPerfFile', () => {
    expect(perfFileName(at(2026, 10, 3))).toBe('perf-2026-10-03.log')
    expect(isPerfFile('perf-2026-10-03.log')).toBe(true)
    expect(isPerfFile('perf-2026-10-03.log.1')).toBe(true)
    expect(isPerfFile('exile-appraiser-2026-10-03.log')).toBe(false)
    expect(isPerfFile('perf-notes.txt')).toBe(false)
  })

  it('fileName / isOwnFile:寫進 perf 檔,7 天清除只動 perf 檔;省略 = 原本的記錄檔名', async () => {
    const files = new Map<string, { data: string, mtimeMs: number }>()
    const now = at(2026, 10, 10)
    const fsx: LogFs = {
      mkdir: async () => {},
      readdir: async () => [...files.keys()].map(f => path.basename(f)),
      stat: async (f) => { const e = files.get(f); return e ? { size: Buffer.byteLength(e.data), mtimeMs: e.mtimeMs } : null },
      unlink: async (f) => { files.delete(f) },
      rename: async (a, b) => { files.set(b, files.get(a)!); files.delete(a) },
      openAppend: async (f): Promise<LogAppender> => {
        if (!files.has(f)) files.set(f, { data: '', mtimeMs: now })
        return { write: async (d) => { files.get(f)!.data += d }, close: async () => {} }
      }
    }
    const dir = path.join('X:', 'logs')
    const old = now - 8 * 86_400_000
    files.set(path.join(dir, 'perf-2026-10-01.log'), { data: 'x', mtimeMs: old })
    files.set(path.join(dir, 'exile-appraiser-2026-10-01.log'), { data: 'y', mtimeMs: old })
    const w = new LogFileWriter({ dir, fs: fsx, now: () => now, fileName: perfFileName, isOwnFile: isPerfFile })
    expect(await w.purgeOld()).toEqual(['perf-2026-10-01.log'])
    w.write('{"v":1}')
    w.write('{"v":1,"n":2}')
    await w.idle()
    expect(files.get(path.join(dir, 'perf-2026-10-10.log'))!.data).toBe('{"v":1}\n{"v":1,"n":2}\n')
    expect(files.has(path.join(dir, 'exile-appraiser-2026-10-01.log'))).toBe(true)
    // 預設(記錄檔):不動 perf 檔、寫到 exile-appraiser-<日期>.log
    files.set(path.join(dir, 'perf-2026-10-01.log'), { data: 'x', mtimeMs: old })
    const w2 = new LogFileWriter({ dir, fs: fsx, now: () => now })
    expect(await w2.purgeOld()).toEqual(['exile-appraiser-2026-10-01.log'])
    w2.write('a')
    await w2.idle()
    expect(files.has(path.join(dir, 'exile-appraiser-2026-10-10.log'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('模組計數器(只有 ++)', () => {
  it('GameDetector:列舉與 PowerShell 確認次數', async () => {
    const e0 = detectorCounters.enums
    const p0 = detectorCounters.processProbes
    let fg = true
    const d = new GameDetector({
      currentGame: () => 'poe1',
      windowTitleBy: () => ({ poe1: 'Path of Exile', poe2: 'Path of Exile 2' }),
      onSwitch: () => {},
      isCurrentGameForeground: () => fg,
      listWindowNames: async () => ['Path of Exile 2'],
      processTitles: async () => ['Path of Exile']
    })
    await d.tick() // 前景跳過:不列舉
    expect(detectorCounters.enums).toBe(e0)
    fg = false
    await d.tick() // 列舉 + 候選成立 → PowerShell 確認
    expect(detectorCounters.enums).toBe(e0 + 1)
    expect(detectorCounters.processProbes).toBe(p0 + 1)
  })

  it('PanelScan:擷取次數(sched.captures)與被擋原因(blockCounts);scanSnapshotOf 轉成 ScanSnapshot', async () => {
    const cfg: ScanConfig = { enabled: false, game: 'poe2', region: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, intervalMs: 1000 }
    const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: 2000, height: 1000 } }
    const frame = { w: 64, h: 40, data: new Uint8Array(64 * 40).fill(10) }
    const scan = new RuneshapeScan({
      clock: { now: () => 0, setTimeout: () => 1, clearTimeout: () => {} },
      config: () => cfg,
      env: () => env,
      ocrBusy: () => false,
      capture: async () => ({
        size: { w: 2000, h: 1000 },
        offset: { x: 0, y: 0 },
        client: { w: 2000, h: 1000 },
        fingerprint: () => frame,
        recognize: async () => ({ lines: [], ms: 1 })
      }),
      send: () => {},
      log: () => {}
    })
    await scan.tick()
    await scan.tick()
    expect(scan.blockCounts).toEqual({ disabled: 2 })
    expect(scan.sched.captures).toBe(0)
    cfg.enabled = true
    await scan.tick()
    expect(scan.sched.captures).toBe(1)
    const s = scanSnapshotOf(scan)
    expect(s).toMatchObject({ ticks: 3, captures: 1, blockCounts: { disabled: 2 } })
    expect(s.reason).toBe('stopped') // 迴圈沒 start
  })
})

// ---- IPC 登錄表守門(main.ts 不能在 Node 測試裡載入,改驗原始碼) ----
describe('IPC 登錄表守門:效能診斷', () => {
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

  it.each(['perf-get', 'perf-set', 'perf-open-file'])('%s:invoke + preview: false;不在預覽方法表', (ch) => {
    const e = entry(ch)
    expect(e).toContain("kind: 'invoke'")
    expect(e).toContain('preview: false')
    expect(Object.values(HOST_METHOD_CHANNELS)).not.toContain(ch)
  })

  it('preload 對應;預覽 boot script 沒有 perf 方法', () => {
    expect(preload).toContain("ipcRenderer.invoke('perf-get')")
    expect(preload).toContain("ipcRenderer.invoke('perf-set', on)")
    expect(preload).toContain("ipcRenderer.invoke('perf-open-file')")
    const s = bootScript({ prefix: '/t/' + 'a'.repeat(32) + '/', version: '1.0.0' })
    expect(s).not.toContain('perfGet')
  })

  it('main:關著不啟動(只有 --perf-log 或 perf.json 才 start);capture-bench 改用共用 LagProbe', () => {
    expect(main).toContain("process.argv.includes('--perf-log')")
    expect(main).toMatch(/if \(PERF_ARG \|\| perfSetting\) \{[\s\S]{0,200}perf\.start\(\)/)
    expect(main.match(/perf\.start\(\)/g)).toHaveLength(2) // 啟動條件 + perf-set
    const bench = read('ocr/capture-bench.ts')
    expect(bench).toContain("from '../perf/lag-probe'")
    expect(bench).not.toMatch(/class LagProbe/)
  })
})
