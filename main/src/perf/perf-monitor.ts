/**
 * 第 29 步:內建效能診斷(`--perf-log` 參數或「設定 › 記錄 › 效能」開關;預設關)。
 *
 * 開著時每 `PERF_SAMPLE_MS`(5 秒)記一筆:
 * - `app.getAppMetrics()` 各行程 type / CPU% / 工作集與加總(CPU% = Electron `percentCPUUsage`,自上次取樣起的平均,
 *   單核 100% 為基準 → 多核忙碌時可超過 100%;工作集 MB);
 * - 事件迴圈卡頓 p95 / 最長(`LagProbe`,每 `PERF_LAG_INTERVAL_MS` 一次 setTimeout);
 * - uiohook 每秒事件數(開著時才掛 `input` 監聽)、uiohookGate 是否持有;
 * - 兩個 PanelScan(褻瀆 reveal / 符文 rune)與 PoE1 倉庫 StashScan(B8)每秒擷取 / OCR 次數、被擋下的原因統計;
 * - B8:renderer 回報(IPC `perf-renderer`,`RendererPerfAccumulator`):longtask、rAF 幀間隔、查價延遲、背景圖預先處理耗時;
 * - GameDetector 視窗列舉 / PowerShell 確認次數;overlay 視窗是否 visible;WinOcr PowerShell 行程在不在(pid);
 * - **情境標記**(`deriveScenario`):遊戲在不在 / 前景、查價面板、設定視窗、褻瀆 / 符文 OCR、背景圖、overlay / window 模式。
 * 寫到 app-log 一行摘要(`[perf] …`)與 `userData/logs/perf-<YYYY-MM-DD>.log`(JSONL,一行一筆;
 * 沿用 app-log 的 `LogFileWriter`:非同步寫、20 MB 輪替、保留 7 天)。
 *
 * **關閉時零成本**:不開計時器、不掛監聽、不建物件;各模組的計數器只有 `++`(GameDetector `detectorCounters`、
 * PanelScan `sched.captures` / `blockCounts`)。本檔不 import electron(main vitest 以假資料測)。
 */
import { LagProbe, type LagSummary } from './lag-probe'
import { dateStamp, timeStamp } from '../app-log'
import type { PerfRendererReport, PerfSummarySection } from '@ipc/types'

export const PERF_SAMPLE_MS = 5000
/** 效能診斷的卡頓探針間隔(capture-bench 用 4 ms;常駐診斷取疏一點,探針本身的 CPU 才不會干擾量測) */
export const PERF_LAG_INTERVAL_MS = 20
/** JSONL 每筆的 schema 版本(2 = B8:加 `stash` / `renderer`、情境 `+stash`) */
export const PERF_SCHEMA = 2

// ---------------- 檔名 ----------------

export const perfFileName = (ms: number) => `perf-${dateStamp(ms)}.log`
const PERF_FILE_RE = /^perf-\d{4}-\d{2}-\d{2}\.log(\.1)?$/
/** 是不是效能診斷的檔(輪替 / 7 天清除只動這些) */
export const isPerfFile = (name: string) => PERF_FILE_RE.test(name)

// ---------------- 行程指標 ----------------

/** `app.getAppMetrics()` 一筆的子集(測試給假的) */
export interface AppMetricLike {
  pid: number
  type: string
  name?: string
  serviceName?: string
  cpu: { percentCPUUsage: number }
  /** KB */
  memory: { workingSetSize: number }
}

export interface PerfProc {
  pid: number
  type: string
  name?: string
  cpu: number
  wsMB: number
}

export interface ProcAggregate {
  procs: PerfProc[]
  cpu: { total: number, byType: Record<string, number> }
  wsMB: { total: number, byType: Record<string, number> }
}

const r1 = (n: number) => Math.round(n * 10) / 10
const finite = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/** 純函式:各行程 → CPU% / 工作集(MB)逐行程、依 type 加總、全部加總(小數一位) */
export function aggregateProcs (metrics: readonly AppMetricLike[]): ProcAggregate {
  const procs: PerfProc[] = []
  const cpuBy: Record<string, number> = {}
  const wsBy: Record<string, number> = {}
  let cpuT = 0
  let wsT = 0
  for (const m of metrics) {
    const cpu = finite(m.cpu?.percentCPUUsage)
    const ws = finite(m.memory?.workingSetSize) / 1024
    const p: PerfProc = { pid: m.pid, type: m.type, cpu: r1(cpu), wsMB: r1(ws) }
    const nm = m.name ?? m.serviceName
    if (nm) p.name = nm
    procs.push(p)
    cpuBy[m.type] = (cpuBy[m.type] ?? 0) + cpu
    wsBy[m.type] = (wsBy[m.type] ?? 0) + ws
    cpuT += cpu
    wsT += ws
  }
  for (const k of Object.keys(cpuBy)) { cpuBy[k] = r1(cpuBy[k]); wsBy[k] = r1(wsBy[k]) }
  return { procs, cpu: { total: r1(cpuT), byType: cpuBy }, wsMB: { total: r1(wsT), byType: wsBy } }
}

// ---------------- 掃描速率 ----------------

/** 一個 PanelScan 在某時刻的累計計數與狀態 */
export interface ScanSnapshot {
  /** 目前被擋的原因;null = 正在掃描;'stopped' = 掃描迴圈沒啟動(window 模式) */
  reason: string | null
  ticks: number
  captures: number
  ocrRuns: number
  locates: number
  skippedUnchanged: number
  skippedBusy: number
  blockCounts: Readonly<Record<string, number>>
}

export interface ScanRates {
  /** 'active' = 正在掃描;其他 = 取樣當下被擋的原因 */
  state: string
  ticks: number
  capPerSec: number
  ocrPerSec: number
  locates: number
  skippedUnchanged: number
  skippedBusy: number
  /** 這個取樣視窗內被擋下的 tick,依原因 */
  blocked: Record<string, number>
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** 純函式:兩次累計 → 這個取樣視窗的次數 / 每秒(`prev` 省略 = 從 0 起算) */
export function scanRates (prev: ScanSnapshot | null, cur: ScanSnapshot, windowMs: number): ScanRates {
  const d = (k: 'ticks' | 'captures' | 'ocrRuns' | 'locates' | 'skippedUnchanged' | 'skippedBusy') => Math.max(0, cur[k] - (prev?.[k] ?? 0))
  const sec = windowMs > 0 ? windowMs / 1000 : 1
  const blocked: Record<string, number> = {}
  for (const [k, v] of Object.entries(cur.blockCounts)) {
    const n = v - (prev?.blockCounts[k] ?? 0)
    if (n > 0) blocked[k] = n
  }
  return {
    state: cur.reason ?? 'active',
    ticks: d('ticks'),
    capPerSec: r2(d('captures') / sec),
    ocrPerSec: r2(d('ocrRuns') / sec),
    locates: d('locates'),
    skippedUnchanged: d('skippedUnchanged'),
    skippedBusy: d('skippedBusy'),
    blocked
  }
}

// ---------------- 情境標記 ----------------

export type GameState = 'absent' | 'background' | 'foreground' | 'unknown'

export interface ScenarioInput {
  mode: 'overlay' | 'window'
  /** overlay:遊戲視窗是否 attach;window 模式沒有綁定 → null */
  gameAttached: boolean | null
  /** overlay:遊戲視窗是否在前景;window → null */
  gameForeground: boolean | null
  /** overlay:renderer 回報的查價面板 / 設定 / 框選層(`runeshape-ui-state`);還沒收到 / window → null */
  ui: { panel: boolean, settings: boolean, picker: boolean } | null
  /** 兩個掃描目前被擋的原因(null = 正在掃描;'stopped' = 沒啟動) */
  revealReason: string | null
  runeReason: string | null
  /** B8:PoE1 倉庫掃描目前被擋的原因(同上;省略 = 沒有這個掃描 = 關) */
  stashReason?: string | null
  /** 設定檔的背景圖:開著且選了圖 = true;讀不到 = null */
  bg: boolean | null
  /** overlay / 備援視窗是否 visible */
  windowVisible: boolean
}

export interface ScenarioTags {
  mode: 'overlay' | 'window'
  game: GameState
  panel: boolean | null
  settings: boolean | null
  picker: boolean | null
  /** OCR 功能開著(啟用 + PoE2 + overlay + 沒被使用者暫停;遊戲失焦 / 面板開著的暫時停也算開) */
  revealOcr: boolean
  runeOcr: boolean
  /** B8:PoE1 倉庫價格 OCR 開著(啟用 + PoE1 + overlay;暫時停也算開) */
  stashOcr: boolean
  bg: boolean | null
  windowVisible: boolean
}

/** 這些原因 = OCR 功能關著(不是暫時停) */
const OCR_OFF: ReadonlySet<string> = new Set(['disabled', 'not-poe2', 'not-poe1', 'not-overlay', 'user-paused', 'no-data', 'stopped'])
export const ocrOn = (reason: string | null) => !OCR_OFF.has(reason ?? '')

/**
 * 純函式:目前狀態 → 情境標記與情境鍵。情境鍵 = 基本情境 + 附加:
 *   `window` / `no-game` / `game-bg` / `fg-idle` / `panel` / `settings` / `picker`
 *   + `+reveal`(褻瀆 OCR 開)+ `+rune`(符文 OCR 開)+ `+stash`(PoE1 倉庫價格 OCR 開,B8)+ `+bg`(背景圖開且查價面板或設定開著;window 模式看視窗是否顯示)
 * 與 `scripts/perf-scenario.mjs` 的情境清單 / `docs/perf/README.md`「情境定義」對應。
 */
export function deriveScenario (s: ScenarioInput): { key: string, tags: ScenarioTags } {
  const game: GameState = s.mode === 'window' || s.gameAttached == null
    ? 'unknown'
    : !s.gameAttached ? 'absent' : s.gameForeground ? 'foreground' : 'background'
  const tags: ScenarioTags = {
    mode: s.mode,
    game,
    panel: s.ui ? s.ui.panel : null,
    settings: s.ui ? s.ui.settings : null,
    picker: s.ui ? s.ui.picker : null,
    revealOcr: ocrOn(s.revealReason),
    runeOcr: ocrOn(s.runeReason),
    stashOcr: s.stashReason === undefined ? false : ocrOn(s.stashReason),
    bg: s.bg,
    windowVisible: s.windowVisible
  }
  let base: string
  if (s.mode === 'window') base = 'window'
  else if (game === 'absent' || game === 'unknown') base = 'no-game'
  else if (tags.picker) base = 'picker'
  else if (tags.settings) base = 'settings'
  else if (tags.panel) base = 'panel'
  else if (game === 'background') base = 'game-bg'
  else base = 'fg-idle'
  let key = base
  if (tags.revealOcr) key += '+reveal'
  if (tags.runeOcr) key += '+rune'
  if (tags.stashOcr) key += '+stash'
  const bgShown = s.mode === 'window' ? s.windowVisible : Boolean(tags.panel || tags.settings)
  if (tags.bg && bgShown) key += '+bg'
  return { key, tags }
}

// ---------------- 一筆取樣 ----------------

export interface PerfSample {
  v: number
  ts: number
  /** 本機時間 `YYYY-MM-DD HH:MM:SS.mmm` */
  time: string
  /** 這筆涵蓋的時間(ms,上一筆到這一筆) */
  windowMs: number
  scenario: string
  tags: ScenarioTags
  cpu: ProcAggregate['cpu']
  wsMB: ProcAggregate['wsMB']
  procs: PerfProc[]
  lag: LagSummary
  uiohook: { evPerSec: number, running: boolean, holders: number }
  reveal: ScanRates
  rune: ScanRates
  /** B8:PoE1 倉庫價格掃描 */
  stash: ScanRates
  detect: { enums: number, processProbes: number, running: boolean }
  winOcr: { running: boolean, pid?: number }
  /** B8:這段時間 renderer 回報的指標(沒有回報 = null:預覽端 / renderer 還沒收到開關事件) */
  renderer: RendererPerfSummary | null
}

/** JSONL 一行(保證沒有換行) */
export function formatPerfJsonl (s: PerfSample): string {
  return JSON.stringify(s)
}

const scanPart = (label: string, r: ScanRates) => r.state === 'active' || r.capPerSec > 0 || r.ocrPerSec > 0
  ? `${label} 擷取 ${r.capPerSec}/s OCR ${r.ocrPerSec}/s${r.state === 'active' ? '' : `(${r.state})`}`
  : `${label} ${r.state}`

/**
 * B8:摘要依區塊分列(設定 › 記錄 › 效能逐列顯示;一行摘要 = 情境 + 這些區塊以 ` | ` 串起):
 * 行程 / main 卡頓(+ uiohook)/ renderer / 查價 / 辨識(PoE1 倉庫 + PoE2 褻瀆 / 符文)/ 背景圖 / 系統(列舉、視窗、WinOcr)
 */
export function perfSummarySections (s: PerfSample): PerfSummarySection[] {
  const types = Object.entries(s.cpu.byType).map(([k, v]) => `${k} ${v}`).join(' ')
  const r = s.renderer
  const renderer = !r
    ? '沒有回報'
    : `longtask ${r.longTask.n} 次 ${r.longTask.totalMs} ms(最長 ${r.longTask.maxMs})· ` +
      (r.frames.n > 0 ? `幀間隔 p95 ${r.frames.p95} / 最長 ${r.frames.max} ms` : '幀間隔 沒量(視窗隱藏 / 沒有內容)')
  const query = !r || (r.query.n === 0 && r.query.parse.n === 0)
    ? '沒有查價'
    : `${r.query.n} 次 · 解析 p50 ${r.query.parse.p50} · 第一筆結果 p50 ${r.query.first.p50} / p95 ${r.query.first.p95} / 最長 ${r.query.first.max} ms`
  const bg = !r || (r.bg.redraws === 0 && r.bg.adopts === 0 && r.bg.loads === 0)
    ? '沒有重畫'
    : `重畫 ${r.bg.redraws} · 快取換上 ${r.bg.adopts} · 載入 ${r.bg.loads}(${r.bg.load.max} ms)· ` +
      `繪製 ${r.bg.draw.max} · 編碼 ${r.bg.encode.max} · 解碼 ${r.bg.decode.max} ms`
  return [
    { key: 'proc', text: `CPU ${s.cpu.total}%(${types})WS ${s.wsMB.total} MB` },
    { key: 'lag', text: `卡頓 p95 ${s.lag.p95} / 最長 ${s.lag.max} ms · uiohook ${s.uiohook.evPerSec}/s${s.uiohook.running ? '(持有中)' : ''}` },
    { key: 'renderer', text: renderer },
    { key: 'query', text: query },
    { key: 'scan', text: `${scanPart('倉庫', s.stash)} · ${scanPart('褻瀆', s.reveal)} · ${scanPart('符文', s.rune)}` },
    { key: 'bg', text: bg },
    {
      key: 'sys',
      text: `列舉 ${s.detect.enums}${s.detect.processProbes ? ` + PS ${s.detect.processProbes}` : ''} · 視窗 ${s.tags.windowVisible ? '顯示' : '隱藏'}` +
        `${s.winOcr.running ? ` · WinOcr pid ${s.winOcr.pid ?? '?'}` : ''}`
    }
  ]
}

/** app-log 一行摘要(`[perf] ` 開頭) */
export function formatPerfSummary (s: PerfSample): string {
  return `[perf] 情境 ${s.scenario} | ` + perfSummarySections(s).map(x => x.text).join(' | ')
}

// ---------------- renderer 指標(B8) ----------------

/** 一組耗時的分位數(ms,小數一位) */
export interface Quantiles { n: number, p50: number, p95: number, max: number }
type Q3 = Omit<Quantiles, 'n'>

export interface RendererPerfSummary {
  /** 這筆取樣收到幾份 renderer 回報 */
  reports: number
  longTask: { n: number, totalMs: number, maxMs: number }
  /** 多份回報的 p95 取最大(保守),n 加總 */
  frames: { n: number, p95: number, max: number }
  /** n = 有第一筆結果的查價次數 */
  query: { n: number, parse: Quantiles, first: Q3 }
  bg: { redraws: number, adopts: number, loads: number, load: Q3, draw: Q3, encode: Q3, decode: Q3 }
}

/** 每個耗時陣列最多留幾筆(renderer 不可信:避免一次塞爆記憶體) */
export const RENDERER_ARRAY_CAP = 500

const nonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const numArr = (v: unknown): number[] | null => (Array.isArray(v) && v.every(nonNeg) ? (v as number[]).slice(-RENDERER_ARRAY_CAP) : null)

/** 不可信的 payload → 合法的報告;任何欄位不合法 → null(整份丟掉) */
export function validRendererReport (v: unknown): PerfRendererReport | null {
  if (v == null || typeof v !== 'object') return null
  const o = v as Record<string, any>
  const lt = o.longTask
  const fr = o.frames
  const bg = o.bg
  if (!nonNeg(o.windowMs) || !lt || !nonNeg(lt.n) || !nonNeg(lt.totalMs) || !nonNeg(lt.maxMs)) return null
  if (!fr || !nonNeg(fr.n) || !nonNeg(fr.p95) || !nonNeg(fr.max)) return null
  const parseMs = numArr(o.query?.parseMs)
  const firstMs = numArr(o.query?.firstMs)
  if (!parseMs || !firstMs) return null
  if (!bg || !nonNeg(bg.redraws) || !nonNeg(bg.adopts) || !nonNeg(bg.loads)) return null
  const loadMs = numArr(bg.loadMs)
  const drawMs = numArr(bg.drawMs)
  const encodeMs = numArr(bg.encodeMs)
  const decodeMs = numArr(bg.decodeMs)
  if (!loadMs || !drawMs || !encodeMs || !decodeMs) return null
  return {
    windowMs: o.windowMs,
    longTask: { n: lt.n, totalMs: lt.totalMs, maxMs: lt.maxMs },
    frames: { n: fr.n, p95: fr.p95, max: fr.max },
    query: { parseMs, firstMs },
    bg: { redraws: bg.redraws, adopts: bg.adopts, loads: bg.loads, loadMs, drawMs, encodeMs, decodeMs }
  }
}

/** 純函式:耗時陣列 → p50 / p95 / 最長(nearest-rank;空 = 0) */
export function quantiles (values: readonly number[]): Quantiles {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, max: 0 }
  const v = [...values].sort((a, b) => a - b)
  const at = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))]
  return { n: v.length, p50: r1(at(0.5)), p95: r1(at(0.95)), max: r1(v[v.length - 1]) }
}
const q3 = (values: readonly number[]): Q3 => { const { p50, p95, max } = quantiles(values); return { p50, p95, max } }

/**
 * main 端:renderer 回報(IPC `perf-renderer`)驗證後累加,取樣時 `drain()` 成摘要並清空。
 * renderer 的回報週期與 main 取樣不同步,所以一筆取樣可能含 0 / 1 / 2 份;次數 / 總時間加總、耗時陣列串接(各 `RENDERER_ARRAY_CAP` 筆)。
 */
export class RendererPerfAccumulator {
  private acc: PerfRendererReport | null = null
  private reports = 0

  add (v: unknown): void {
    const r = validRendererReport(v)
    if (!r) return
    this.reports++
    const a = this.acc
    if (!a) { this.acc = r; return }
    const cat = (x: number[], y: number[]) => x.concat(y).slice(-RENDERER_ARRAY_CAP)
    this.acc = {
      windowMs: a.windowMs + r.windowMs,
      longTask: { n: a.longTask.n + r.longTask.n, totalMs: a.longTask.totalMs + r.longTask.totalMs, maxMs: Math.max(a.longTask.maxMs, r.longTask.maxMs) },
      frames: { n: a.frames.n + r.frames.n, p95: Math.max(a.frames.p95, r.frames.p95), max: Math.max(a.frames.max, r.frames.max) },
      query: { parseMs: cat(a.query.parseMs, r.query.parseMs), firstMs: cat(a.query.firstMs, r.query.firstMs) },
      bg: {
        redraws: a.bg.redraws + r.bg.redraws,
        adopts: a.bg.adopts + r.bg.adopts,
        loads: a.bg.loads + r.bg.loads,
        loadMs: cat(a.bg.loadMs, r.bg.loadMs),
        drawMs: cat(a.bg.drawMs, r.bg.drawMs),
        encodeMs: cat(a.bg.encodeMs, r.bg.encodeMs),
        decodeMs: cat(a.bg.decodeMs, r.bg.decodeMs)
      }
    }
  }

  /** 取出這段時間的摘要並清空;沒有任何回報 = null */
  drain (): RendererPerfSummary | null {
    const a = this.acc
    const n = this.reports
    this.acc = null
    this.reports = 0
    if (!a) return null
    return {
      reports: n,
      longTask: { n: a.longTask.n, totalMs: r1(a.longTask.totalMs), maxMs: r1(a.longTask.maxMs) },
      frames: { n: a.frames.n, p95: r1(a.frames.p95), max: r1(a.frames.max) },
      query: { n: a.query.firstMs.length, parse: quantiles(a.query.parseMs), first: q3(a.query.firstMs) },
      bg: {
        redraws: a.bg.redraws,
        adopts: a.bg.adopts,
        loads: a.bg.loads,
        load: q3(a.bg.loadMs),
        draw: q3(a.bg.drawMs),
        encode: q3(a.bg.encodeMs),
        decode: q3(a.bg.decodeMs)
      }
    }
  }
}

/** 設定檔文字 → 背景圖開著且選了圖(情境標記用;main 在啟動與 config-save 時更新記憶體裡的值,不再每筆取樣讀檔);壞 JSON = null */
export function bgActiveFromConfigText (text: string): boolean | null {
  try {
    const c = JSON.parse(text) as { bg?: { enabled?: unknown, file?: unknown } } | null
    return c?.bg?.enabled !== false && typeof c?.bg?.file === 'string' && c.bg.file !== ''
  } catch { return null }
}

// ---------------- 監測器 ----------------

export interface PerfTimers {
  set: (fn: () => void, ms: number) => unknown
  clear: (h: unknown) => void
}
const REAL_TIMERS: PerfTimers = {
  set: (fn, ms) => {
    const h = setTimeout(fn, ms)
    ;(h as { unref?: () => void }).unref?.()
    return h
  },
  clear: (h) => { clearTimeout(h as ReturnType<typeof setTimeout>) }
}

export interface PerfMonitorDeps {
  metrics: () => readonly AppMetricLike[]
  scenario: () => ScenarioInput | Promise<ScenarioInput>
  /** stash = B8 的 PoE1 倉庫掃描(省略 = 沒有,記 'stopped') */
  scans: () => { reveal: ScanSnapshot, rune: ScanSnapshot, stash?: ScanSnapshot }
  /** B8:取出這段時間 renderer 回報的摘要(`RendererPerfAccumulator.drain`);省略 = 不記 */
  renderer?: () => RendererPerfSummary | null
  uiohook: () => { running: boolean, holders: number }
  /** 開著時掛、關掉時拔(uiohook `input` 事件);省略 = 不計 */
  hookEvents?: { on: (fn: () => void) => void, off: (fn: () => void) => void }
  detector: () => { enums: number, processProbes: number, running: boolean }
  winOcr: () => { running: boolean, pid?: number }
  /** JSONL 一行 → perf 檔 */
  write: (line: string) => void
  /** 一行摘要 → app-log */
  log: (line: string) => void
  timers?: PerfTimers
  now?: () => number
  lagProbe?: LagProbe
  sampleMs?: number
}

export class PerfMonitor {
  private timer: unknown = null
  private on = false
  private busy = false
  private hookCount = 0
  private lastAt = 0
  private prevScans: { reveal: ScanSnapshot, rune: ScanSnapshot, stash?: ScanSnapshot } | null = null
  private prevDetect = { enums: 0, processProbes: 0 }
  private lastSample: PerfSample | null = null
  private readonly timers: PerfTimers
  private readonly now: () => number
  private readonly probe: LagProbe
  private readonly sampleMs: number
  private readonly onHook = () => { this.hookCount++ }

  constructor (private readonly d: PerfMonitorDeps) {
    this.timers = d.timers ?? REAL_TIMERS
    this.now = d.now ?? Date.now
    this.probe = d.lagProbe ?? new LagProbe(PERF_LAG_INTERVAL_MS)
    this.sampleMs = d.sampleMs ?? PERF_SAMPLE_MS
  }

  get enabled (): boolean { return this.on }
  get last (): PerfSample | null { return this.lastSample }
  get intervalMs (): number { return this.sampleMs }

  start (): void {
    if (this.on) return
    this.on = true
    this.hookCount = 0
    this.lastAt = this.now()
    // 基準:之後每筆只算這段時間內的增量;getAppMetrics 第一次呼叫的 CPU% 沒有意義(Electron 從這次起算)
    try { this.d.metrics() } catch { /* 取不到下一筆再試 */ }
    this.prevScans = this.d.scans()
    this.d.renderer?.() // 開始前累積的回報不算
    const det = this.d.detector()
    this.prevDetect = { enums: det.enums, processProbes: det.processProbes }
    this.d.hookEvents?.on(this.onHook)
    this.probe.start()
    this.d.log(`[perf] 效能診斷開始(每 ${this.sampleMs / 1000} 秒一筆)`)
    this.schedule()
  }

  stop (): void {
    if (!this.on) return
    this.on = false
    if (this.timer != null) { this.timers.clear(this.timer); this.timer = null }
    this.d.hookEvents?.off(this.onHook)
    this.probe.stop()
    this.probe.drain()
    this.prevScans = null
    this.d.log('[perf] 效能診斷停止')
  }

  private schedule (): void {
    this.timer = this.timers.set(() => {
      this.timer = null
      void this.sample().finally(() => { if (this.on && this.timer == null) this.schedule() })
    }, this.sampleMs)
  }

  /** 取一筆(計時器呼叫;測試直接呼叫)。關著 / 上一筆還沒做完 → null */
  async sample (): Promise<PerfSample | null> {
    if (!this.on || this.busy) return null
    this.busy = true
    try {
      const scenarioIn = await this.d.scenario()
      if (!this.on) return null
      const t = this.now()
      const windowMs = Math.max(1, t - this.lastAt)
      this.lastAt = t
      const agg = aggregateProcs(this.d.metrics())
      const scans = this.d.scans()
      const det = this.d.detector()
      const sc = deriveScenario(scenarioIn)
      const hook = this.d.uiohook()
      const hooks = this.hookCount
      this.hookCount = 0
      const s: PerfSample = {
        v: PERF_SCHEMA,
        ts: t,
        time: `${dateStamp(t)} ${timeStamp(t)}`,
        windowMs,
        scenario: sc.key,
        tags: sc.tags,
        cpu: agg.cpu,
        wsMB: agg.wsMB,
        procs: agg.procs,
        lag: this.probe.drain(),
        uiohook: { evPerSec: r2(hooks / (windowMs / 1000)), running: hook.running, holders: hook.holders },
        reveal: scanRates(this.prevScans?.reveal ?? null, scans.reveal, windowMs),
        rune: scanRates(this.prevScans?.rune ?? null, scans.rune, windowMs),
        stash: scanRates(this.prevScans?.stash ?? null, scans.stash ?? STOPPED_SNAPSHOT, windowMs),
        detect: {
          enums: Math.max(0, det.enums - this.prevDetect.enums),
          processProbes: Math.max(0, det.processProbes - this.prevDetect.processProbes),
          running: det.running
        },
        winOcr: this.d.winOcr(),
        renderer: this.d.renderer?.() ?? null
      }
      this.prevScans = scans
      this.prevDetect = { enums: det.enums, processProbes: det.processProbes }
      this.lastSample = s
      try { this.d.write(formatPerfJsonl(s)) } catch { /* 寫檔層自己回報 */ }
      this.d.log(formatPerfSummary(s))
      return s
    } catch (e) {
      this.d.log(`[perf] 取樣失敗:${e instanceof Error ? e.message : String(e)}`)
      return null
    } finally {
      this.busy = false
    }
  }
}

const STOPPED_SNAPSHOT: ScanSnapshot = Object.freeze({
  reason: 'stopped', ticks: 0, captures: 0, ocrRuns: 0, locates: 0, skippedUnchanged: 0, skippedBusy: 0, blockCounts: Object.freeze({})
}) as ScanSnapshot

/** B8:PoE1 StashScan 的公開欄位 → ScanSnapshot(沒有整畫面定位 → locates 0;迴圈沒啟動 = 'stopped') */
export function stashSnapshotOf (scan: {
  isRunning: boolean
  snapshot: () => { block: string | null }
  counters: { ticks: number, captures: number, ocrRuns: number, skippedUnchanged: number, skippedBusy: number }
  blockCounts: Readonly<Partial<Record<string, number>>>
}): ScanSnapshot {
  const blockCounts: Record<string, number> = {}
  for (const [k, v] of Object.entries(scan.blockCounts)) if (typeof v === 'number') blockCounts[k] = v
  const c = scan.counters
  return {
    reason: scan.isRunning ? scan.snapshot().block : 'stopped',
    ticks: c.ticks,
    captures: c.captures,
    ocrRuns: c.ocrRuns,
    locates: 0,
    skippedUnchanged: c.skippedUnchanged,
    skippedBusy: c.skippedBusy,
    blockCounts
  }
}

/** PanelScan 的公開欄位 → ScanSnapshot(main.ts 用;測試另給假的) */
export function scanSnapshotOf (scan: {
  snapshot: () => { reason?: string, active: boolean, ticks: number, ocrRuns: number, locates: number, skippedUnchanged: number, skippedBusy: number }
  sched: { captures: number }
  blockCounts: Readonly<Partial<Record<string, number>>>
}): ScanSnapshot {
  const st = scan.snapshot()
  const blockCounts: Record<string, number> = {}
  for (const [k, v] of Object.entries(scan.blockCounts)) if (typeof v === 'number') blockCounts[k] = v
  return {
    reason: st.active ? null : (st.reason ?? 'unknown'),
    ticks: st.ticks,
    captures: scan.sched.captures,
    ocrRuns: st.ocrRuns,
    locates: st.locates,
    skippedUnchanged: st.skippedUnchanged,
    skippedBusy: st.skippedBusy,
    blockCounts
  }
}
