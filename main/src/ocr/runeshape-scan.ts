/**
 * exile-appraiser(WP-R2):PoE2 符文塑形面板自動查價的掃描迴圈(不 import electron;main vitest 以假時鐘 / 假擷取測)。
 *
 * 每 `runeshapeIntervalMs`(500–3000,預設 1000)一次:
 *   啟用條件(`scanBlock`)→ 擷取遊戲 client(`captureGameClient`)→ 決定要看哪一塊:
 *     - **manual**:使用者框的 `runeshapeRegion`(優先;區域內沒找到面板也**不**改掃全畫面,只在設定頁顯示「區域內沒找到面板」)。
 *     - **auto**(沒框區域):記憶體快取的面板區(鍵 = client 大小 + 擷取偏移)。沒有快取時每 `LOCATE_INTERVAL_MS`(3 秒)
 *       最多一次整個 client ×1 OCR → `locateRunePanel`(≥ 2 列面板格式的列、右緣對齊)→ 外擴框存進快取;
 *       連續 `AUTO_MISS_LIMIT`(5)次在快取區找不到面板列 → 清快取回到低頻定位;快取區有變化且距上次定位 ≥ 30 秒時順便重新定位(面板列數變了)。
 *   → **變化偵測**(區域縮成寬 64 的灰階縮圖,與上次 OCR 時的縮圖差分;沒變就不 OCR)
 *   → 有變化才 ×3 OCR(與揭露面板共用同一個 `WinOcr` 行程;揭露面板正在辨識 → 這個 tick 直接丟掉,不排隊);
 *     WinRT 把區域當成直書(`looksVertical`)→ 同一塊 ×1 找面板列 → 只裁面板列 ×3 重辨識。
 *   → 至少 1 列面板格式(`isPanelRow`)才算「有列」,廣播 `runeshape-scan-result`(含 CJK 的行、client 實體像素座標;名稱比對與查價在 renderer)。
 * 連續 2 次 OCR 沒有列 → 送空結果(renderer 清掉徽章)。
 *
 * 暫停(不送事件、保留徽章、清掉差分基準):遊戲不在前景、renderer 回報查價面板 / 設定 / 框選層開著。
 * 停止(送一次空結果清徽章):停用、不是 PoE2、不是 overlay、沒有遊戲視窗、使用者按暫停熱鍵。
 * 不送任何鍵盤 / 滑鼠輸入。
 */
import type { OcrRegion, RuneshapeScanEvent, RuneshapeScanRow, RuneshapeStats, RuneshapeTimings, RuneshapeUiState } from '@ipc/types'
import type { OcrTextLine } from '../../../poe2/src/desecration/ocr-text'
import { isPanelRow, locateRunePanel, looksVertical } from '../../../poe2/src/runeshape/row-format'
import { ocrScale, regionSearchRect, toPhys, toRect, type PhysRect } from './strategy'

// ---------------- 變化偵測(純函式) ----------------

/** 灰階縮圖(每像素 0–255) */
export interface Fingerprint {
  w: number
  h: number
  data: Uint8Array
}

/** 縮圖寬(高依比例);64 × 約 40 = 2–3 千像素,差分 < 1 ms */
export const FINGERPRINT_WIDTH = 64
/** 單一像素灰階差 ≥ 這個值才算「變了」 */
export const PIXEL_DELTA = 16

export interface DiffThresholds {
  /** 平均絕對差(0–255)≥ 這個值 = 有變化 */
  mean: number
  /** 變動像素比例 ≥ 這個值 = 有變化(64×40 約 10 個像素;游標移過、滑鼠指到的列反白都會超過) */
  ratio: number
}
/** 平均差 2:每像素 ±3 的雜訊(平均約 1.7)不算;整塊亮度變 2 以上(面板淡入 / 換頁)算 */
export const DEFAULT_DIFF_THRESHOLDS: DiffThresholds = { mean: 2, ratio: 0.004 }

/** BGRA(`nativeImage.toBitmap()` 的格式)→ 灰階(ITU-R BT.601 近似,整數運算) */
export function bgraToGray (bgra: Uint8Array | Buffer, w: number, h: number): Fingerprint {
  const n = w * h
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    data[i] = (bgra[o] * 29 + bgra[o + 1] * 150 + bgra[o + 2] * 77) >> 8
  }
  return { w, h, data }
}

/** 兩張縮圖的差;大小不同 → null(一律當成有變化) */
export function frameDiff (a: Fingerprint, b: Fingerprint, pixelDelta = PIXEL_DELTA): { mean: number, changedRatio: number } | null {
  if (a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length || !a.data.length) return null
  let sum = 0
  let changed = 0
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i])
    sum += d
    if (d >= pixelDelta) changed++
  }
  return { mean: sum / a.data.length, changedRatio: changed / a.data.length }
}

export function isChanged (d: { mean: number, changedRatio: number } | null, th: DiffThresholds = DEFAULT_DIFF_THRESHOLDS): boolean {
  return d == null || d.mean >= th.mean || d.changedRatio >= th.ratio
}

// ---------------- 啟用 / 暫停條件(純函式) ----------------

export interface ScanConfig {
  enabled: boolean
  game: 'poe1' | 'poe2'
  /** 使用者框的面板區域;null = 自動定位 */
  region: OcrRegion | null
  intervalMs: number
}

export interface ScanEnv {
  overlay: boolean
  /** 遊戲視窗在前景 */
  gameActive: boolean
  /** 遊戲 client 區(螢幕實體像素);沒綁定 = null */
  bounds: PhysRect | null
}

export type ScanBlock =
  | 'disabled' | 'not-poe2' | 'not-overlay' | 'no-window' | 'user-paused'
  | 'game-inactive' | 'ui-open'

/** 這幾種「停止」要清掉畫面上的徽章;其餘(失焦、UI 開著)只是暫停,徽章留著 */
export const CLEARING_BLOCKS: ReadonlySet<ScanBlock> = new Set<ScanBlock>(['disabled', 'not-poe2', 'not-overlay', 'no-window', 'user-paused'])

export function scanBlock (cfg: ScanConfig, env: ScanEnv, ui: RuneshapeUiState, userPaused: boolean): ScanBlock | null {
  if (!cfg.enabled) return 'disabled'
  if (cfg.game !== 'poe2') return 'not-poe2'
  if (!env.overlay) return 'not-overlay'
  if (!env.bounds || !(env.bounds.width > 0 && env.bounds.height > 0)) return 'no-window'
  if (userPaused) return 'user-paused'
  if (!env.gameActive) return 'game-inactive'
  if (ui.panel || ui.settings || ui.picker) return 'ui-open'
  return null
}

/** 掃描間隔:500–3000 ms,預設 1000(與 renderer `clampRuneshapeInterval` 相同) */
export const DEFAULT_SCAN_INTERVAL_MS = 1000
export function clampScanInterval (v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_SCAN_INTERVAL_MS
  return Math.min(3000, Math.max(500, Math.round(v)))
}

/** 含 CJK 字的 OCR 行(數字 / 符號雜訊不算);要送出還得整批至少 1 列 `isPanelRow` */
const CJK_RE = /[㐀-鿿豈-﫿]/
export function isRowText (text: string): boolean {
  return CJK_RE.test(text)
}

// ---------------- 自動定位參數 ----------------

/** 沒有快取的面板區時,整個 client ×1 定位最多每 3 秒一次 */
export const LOCATE_INTERVAL_MS = 3000
/** 快取區連續 5 次找不到面板列 → 清快取 */
export const AUTO_MISS_LIMIT = 5
/** 快取區有變化且距上次定位 ≥ 30 秒 → 順便重新定位(面板列數 / 位置變了) */
export const AUTO_REFRESH_MS = 30_000

/** 自動定位快取的鍵:client 大小 + 擷取偏移(偏移變了影像座標就平移) */
export function autoKey (cap: { client: { w: number, h: number }, offset: { x: number, y: number } }): string {
  return `${cap.client.w}x${cap.client.h}@${cap.offset.x},${cap.offset.y}`
}

// ---------------- 迴圈 ----------------

/** 一次擷取(electron 端由 `captureGameClient` 的 NativeImage 包成這個形狀;測試給假的) */
export interface ScanCapture {
  /** 擷取影像大小(影像像素) */
  size: { w: number, h: number }
  /** 影像左上在 client 內的位置(遊戲視窗部分在螢幕外時非 0) */
  offset: { x: number, y: number }
  client: { w: number, h: number }
  /** 影像某塊的灰階縮圖 */
  fingerprint: (rect: PhysRect) => Fingerprint
  /** 影像某塊以某倍率 OCR;行座標 = 影像像素 */
  recognize: (rect: PhysRect, scale: number) => Promise<{ lines: OcrTextLine[], ms: number }>
}

export interface ScanClock {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
}

export interface RuneshapeScanDeps {
  clock?: ScanClock
  config: () => ScanConfig
  env: () => ScanEnv
  /** 揭露面板 OCR 正在跑(共用同一個 WinOcr;忙碌就丟掉這個 tick) */
  ocrBusy: () => boolean
  capture: (bounds: PhysRect) => Promise<ScanCapture>
  send: (ev: RuneshapeScanEvent) => void
  log?: (msg: string) => void
  thresholds?: DiffThresholds
}

export type TickResult =
  | { kind: 'overlap' }
  | { kind: 'blocked', block: ScanBlock | 'region-outside' }
  | { kind: 'busy' }
  /** auto:還沒找到面板、離上次全畫面定位不到 `LOCATE_INTERVAL_MS` → 這個 tick 不擷取 */
  | { kind: 'locate-wait' }
  /** auto:全畫面 ×1 定位沒找到面板 */
  | { kind: 'locate-miss', timings: RuneshapeTimings }
  | { kind: 'unchanged', mode: 'manual' | 'auto', rect: PhysRect, timings: RuneshapeTimings }
  | { kind: 'ocr', mode: 'manual' | 'auto', rect: PhysRect, rows: number, panelRows: number, sent: RuneshapeScanEvent['reason'] | null, timings: RuneshapeTimings }
  | { kind: 'error', message: string }

const REAL_CLOCK: ScanClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => { clearTimeout(h as ReturnType<typeof setTimeout>) }
}

const AVG_WINDOW = 20

interface AutoRegion {
  key: string
  /** 影像像素 */
  rect: PhysRect
  client: { w: number, h: number }
  offset: { x: number, y: number }
  misses: number
}

export class RuneshapeScan {
  private readonly deps: RuneshapeScanDeps
  private readonly clock: ScanClock
  private timer: unknown = null
  private running = false
  private inFlight = false
  private ui: RuneshapeUiState = { panel: false, settings: false, picker: false }
  private userPaused = false
  /** 上次**採用**的 OCR 時的縮圖(與區域 / client 大小綁在一起) */
  private baseline: { key: string, fp: Fingerprint } | null = null
  private emptyStreak = 0
  /** renderer 目前可能顯示著徽章(送過非空的列、之後沒送過清除) */
  private shown = false
  private lastBlock: ScanBlock | 'region-outside' | null | undefined = undefined
  private seq = 0
  private lastErrorKind = ''
  private readonly capHist: number[] = []
  private readonly ocrHist: number[] = []
  /** auto:目前快取的面板區(只在記憶體) */
  private auto: AutoRegion | null = null
  private lastLocateAt = Number.NEGATIVE_INFINITY
  /** 最近一次 OCR 的區域有沒有面板列(auto 在「畫面沒變」時據此累計找不到的次數) */
  private lastHadPanel = false
  private panel: RuneshapeStats['panel'] = 'unknown'
  private lastMode: 'manual' | 'auto' | null = null
  /** 直書重試裁出來的面板塊(鍵 = 區域鍵);只在記憶體 */
  private tight: { key: string, rect: PhysRect } | null = null
  readonly stats: Omit<RuneshapeStats, 'active' | 'reason' | 'avgCaptureMs' | 'avgOcrMs' | 'mode' | 'panel' | 'autoRegion'> & { lastError?: string } = {
    ticks: 0, ocrRuns: 0, skippedUnchanged: 0, skippedBusy: 0, locates: 0, locateMisses: 0
  }

  constructor (deps: RuneshapeScanDeps) {
    this.deps = deps
    this.clock = deps.clock ?? REAL_CLOCK
  }

  private log (m: string) { (this.deps.log ?? console.log)(m) }

  /** 掃描中(有 OCR 或擷取在跑);揭露面板 OCR 可以據此決定要不要等 */
  get busy (): boolean { return this.inFlight }

  get paused (): boolean { return this.userPaused }

  /** 測試 / selftest:目前的自動定位快取(影像像素) */
  get autoRegion (): PhysRect | null { return this.auto?.rect ?? null }

  start (): void {
    if (this.running) return
    this.running = true
    this.schedule(0)
  }

  stop (): void {
    this.running = false
    if (this.timer != null) { this.clock.clearTimeout(this.timer); this.timer = null }
  }

  /** 設定 / UI 狀態改了:不在 tick 中就立刻重新判斷一次(暫停 ↔ 繼續、停用時即時清徽章) */
  poke (): void {
    if (!this.running || this.inFlight) return
    if (this.timer != null) this.clock.clearTimeout(this.timer)
    this.schedule(0)
  }

  setUiState (s: RuneshapeUiState): void {
    const next = { panel: Boolean(s?.panel), settings: Boolean(s?.settings), picker: Boolean(s?.picker) }
    if (next.panel === this.ui.panel && next.settings === this.ui.settings && next.picker === this.ui.picker) return
    this.ui = next
    this.poke()
  }

  /** 暫停熱鍵:切換並立刻通知 renderer(暫停 = 清徽章) */
  toggleUserPause (): boolean {
    this.userPaused = !this.userPaused
    this.baseline = null
    this.emptyStreak = 0
    this.log(`[runeshape] 使用者${this.userPaused ? '暫停' : '繼續'}自動查價`)
    this.emit(this.userPaused ? 'user-paused' : 'user-resumed', [], { w: 0, h: 0 })
    this.shown = false
    this.poke()
    return this.userPaused
  }

  /** 設定頁的統計 */
  snapshot (): RuneshapeStats {
    const avg = (a: number[]) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : undefined
    const cfg = this.deps.config()
    const block = scanBlock(cfg, this.deps.env(), this.ui, this.userPaused)
    const mode = cfg.region ? 'manual' : 'auto'
    const out: RuneshapeStats = {
      ...this.stats,
      active: this.running && block == null,
      reason: this.running ? (block ?? undefined) : 'stopped',
      avgCaptureMs: avg(this.capHist),
      avgOcrMs: avg(this.ocrHist),
      mode,
      // 換了模式(框選 / 清除區域)之後還沒掃過 → unknown
      panel: this.lastMode === mode ? this.panel : 'unknown'
    }
    const a = this.auto
    if (mode === 'auto' && a && a.client.w > 0 && a.client.h > 0) {
      const r4 = (v: number) => Math.round(v * 10000) / 10000
      out.autoRegion = {
        x: r4((a.rect.x + a.offset.x) / a.client.w),
        y: r4((a.rect.y + a.offset.y) / a.client.h),
        w: r4(a.rect.width / a.client.w),
        h: r4(a.rect.height / a.client.h)
      }
    }
    return out
  }

  private schedule (ms: number) {
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      void this.tick().finally(() => {
        if (this.running && this.timer == null) this.schedule(clampScanInterval(this.deps.config().intervalMs))
      })
    }, ms)
  }

  private emit (reason: RuneshapeScanEvent['reason'], rows: RuneshapeScanRow[], client: { w: number, h: number }, timings?: RuneshapeTimings) {
    const ev: RuneshapeScanEvent = { seq: ++this.seq, ts: this.clock.now(), reason, rows, client }
    if (timings) ev.timings = timings
    this.deps.send(ev)
  }

  private clearShown (client: { w: number, h: number } = { w: 0, h: 0 }) {
    if (!this.shown) return
    this.emit('inactive', [], client)
    this.shown = false
  }

  private block (b: ScanBlock | 'region-outside'): TickResult {
    if (b !== this.lastBlock) this.log(`[runeshape] 不掃描:${b}`)
    this.lastBlock = b
    this.baseline = null
    this.emptyStreak = 0
    if ((b === 'region-outside' || CLEARING_BLOCKS.has(b)) && b !== 'user-paused') this.clearShown()
    return { kind: 'blocked', block: b }
  }

  private dropAuto (why: string) {
    if (!this.auto) return
    this.log(`[runeshape] 自動定位快取作廢(${why}),回到每 ${LOCATE_INTERVAL_MS / 1000} 秒全畫面定位`)
    this.auto = null
    this.baseline = null
  }

  /** auto:整個影像 ×1 找面板;找到就存快取並回傳框 */
  private async locate (cap: ScanCapture, why: string): Promise<{ rect: PhysRect | null, ms: number }> {
    const t = this.clock.now()
    this.lastLocateAt = t
    this.stats.locates++
    const full: PhysRect = { x: 0, y: 0, width: cap.size.w, height: cap.size.h }
    const res = await cap.recognize(full, 1)
    const loc = locateRunePanel(res.lines, toRect(full))
    const ms = this.clock.now() - t
    if (!loc) {
      this.stats.locateMisses++
      this.log(`[runeshape] 自動定位(${why}):整張 ${cap.size.w}x${cap.size.h} ×1 ${ms} ms,${res.lines.length} 行,沒找到面板`)
      return { rect: null, ms }
    }
    const rect = toPhys(loc.crop)
    this.auto = { key: autoKey(cap), rect, client: cap.client, offset: cap.offset, misses: 0 }
    this.log(`[runeshape] 自動定位(${why}):整張 ×1 ${ms} ms,${loc.rows.length} 列面板列 → 區域 (${rect.x},${rect.y} ${rect.width}x${rect.height})`)
    return { rect, ms }
  }

  /** auto:這個 tick 看完區域仍沒有面板列 → 累計;到上限清快取 */
  private autoMiss () {
    if (!this.auto) return
    this.auto.misses++
    if (this.auto.misses >= AUTO_MISS_LIMIT) this.dropAuto(`連續 ${AUTO_MISS_LIMIT} 次找不到面板列`)
  }

  /**
   * 對區域 OCR;直書時改走 ×1 找面板列 → 只裁那塊 ×3。
   * 裁切成功後記住(`tight`,鍵 = 區域鍵):同一個區域之後直接 OCR 那塊,只有那塊找不到面板列 / 又變直書時才回到整個區域。
   */
  private async recognizeRows (cap: ScanCapture, rect: PhysRect, key: string, timings: RuneshapeTimings): Promise<{ lines: OcrTextLine[], ms: number }> {
    let ms = 0
    if (this.tight?.key === key) {
      const t = this.tight.rect
      const r = await cap.recognize(t, ocrScale(t.width, t.height))
      ms += r.ms
      if (!looksVertical(r.lines) && r.lines.some(l => isPanelRow(l.text))) {
        timings.retry = 'vertical'
        return { lines: r.lines, ms }
      }
      this.tight = null
    }
    const res = await cap.recognize(rect, ocrScale(rect.width, rect.height))
    ms += res.ms
    if (!looksVertical(res.lines)) return { lines: res.lines, ms }
    timings.retry = 'vertical'
    const one = await cap.recognize(rect, 1)
    ms += one.ms
    const loc = locateRunePanel(one.lines, toRect(rect))
    if (!loc) {
      this.log('[runeshape] 區域被 OCR 當成直書,×1 也找不到面板列 → 用 ×1 的結果')
      return { lines: one.lines, ms }
    }
    const crop = toPhys(loc.crop)
    const again = await cap.recognize(crop, ocrScale(crop.width, crop.height))
    ms += again.ms
    const vertical = looksVertical(again.lines)
    this.log(`[runeshape] 區域被 OCR 當成直書 → ×1 找到 ${loc.rows.length} 列,裁 (${crop.x},${crop.y} ${crop.width}x${crop.height}) 重辨識${vertical ? '仍是直書,改用 ×1 結果' : ',之後同一區域直接用這塊'}`)
    if (vertical) return { lines: one.lines, ms }
    this.tight = { key, rect: crop }
    return { lines: again.lines, ms }
  }

  /** 一次掃描(計時器呼叫;測試直接呼叫) */
  async tick (): Promise<TickResult> {
    if (this.inFlight) return { kind: 'overlap' }
    this.stats.ticks++
    const cfg = this.deps.config()
    const env = this.deps.env()
    const b = scanBlock(cfg, env, this.ui, this.userPaused)
    if (b) return this.block(b)
    const mode = cfg.region ? 'manual' : 'auto'
    if (this.lastBlock != null || this.lastMode !== mode) {
      this.log(`[runeshape] 開始掃描(間隔 ${clampScanInterval(cfg.intervalMs)} ms,${mode === 'manual' ? `手動區域 ${JSON.stringify(cfg.region)}` : '自動定位面板'})`)
    }
    this.lastBlock = null
    if (this.lastMode !== mode) {
      this.lastMode = mode
      this.panel = 'unknown'
      this.lastHadPanel = false
      if (mode === 'manual') this.auto = null
    }
    if (this.deps.ocrBusy()) {
      this.stats.skippedBusy++
      return { kind: 'busy' }
    }
    const now = this.clock.now
    // auto 且沒有快取:低頻定位,沒到時間連擷取都不做
    if (mode === 'auto' && !this.auto && now() - this.lastLocateAt < LOCATE_INTERVAL_MS) return { kind: 'locate-wait' }
    this.inFlight = true
    const t0 = now()
    try {
      const cap = await this.deps.capture(env.bounds!)
      const captureMs = now() - t0
      this.pushHist(this.capHist, captureMs)
      const timings: RuneshapeTimings = { captureMs, diffMs: 0, totalMs: 0, mode }
      let rect: PhysRect | null
      if (mode === 'manual') {
        rect = regionSearchRect(cap.size, cfg.region, cap)
        if (!rect) return this.block('region-outside')
      } else {
        if (this.auto && this.auto.key !== autoKey(cap)) this.dropAuto(`遊戲畫面大小 / 位置變了(${autoKey(cap)})`)
        if (this.auto) {
          rect = this.auto.rect
        } else {
          const loc = await this.locate(cap, '尋找面板')
          timings.locateMs = loc.ms
          if (!loc.rect) {
            this.panel = 'not-found'
            this.lastHadPanel = false
            this.baseline = null
            timings.totalMs = now() - t0
            this.stats.last = timings
            // 快取因畫面大小改變被清掉時,舊徽章可能還在
            if (this.shown) {
              this.emit('empty', [], cap.client, timings)
              this.shown = false
            }
            return { kind: 'locate-miss', timings }
          }
          rect = loc.rect
        }
      }
      const key = `${cap.client.w}x${cap.client.h}@${cap.offset.x},${cap.offset.y}|${rect.x},${rect.y},${rect.width},${rect.height}`
      const t1 = now()
      let fp = cap.fingerprint(rect)
      const base = this.baseline?.key === key ? this.baseline.fp : null
      const diff = base ? frameDiff(base, fp) : null
      timings.diffMs = now() - t1
      if (diff) timings.diff = { mean: Math.round(diff.mean * 100) / 100, changedRatio: Math.round(diff.changedRatio * 10000) / 10000 }
      if (base && !isChanged(diff, this.deps.thresholds)) {
        timings.totalMs = now() - t0
        this.stats.skippedUnchanged++
        this.stats.last = timings
        if (mode === 'auto' && !this.lastHadPanel) this.autoMiss()
        return { kind: 'unchanged', mode, rect, timings }
      }
      // 擷取期間揭露面板開始辨識了 → 讓它先(不設基準,下一個 tick 重來)
      if (this.deps.ocrBusy()) {
        this.stats.skippedBusy++
        return { kind: 'busy' }
      }
      // auto:快取區有變化且久沒定位 → 重新定位(面板變高 / 移位);沒找到就沿用舊快取
      if (mode === 'auto' && timings.locateMs == null && now() - this.lastLocateAt >= AUTO_REFRESH_MS) {
        const old = rect
        const loc = await this.locate(cap, '定期重新定位')
        timings.locateMs = loc.ms
        if (loc.rect) {
          rect = loc.rect
        } else if (this.auto) {
          rect = old
        }
        if (rect !== old) fp = cap.fingerprint(rect)
      }
      const t2 = now()
      const newKey = `${cap.client.w}x${cap.client.h}@${cap.offset.x},${cap.offset.y}|${rect.x},${rect.y},${rect.width},${rect.height}`
      const res = await this.recognizeRows(cap, rect, newKey, timings)
      timings.ocrWallMs = now() - t2
      timings.ocrMs = res.ms
      timings.totalMs = now() - t0
      this.pushHist(this.ocrHist, timings.ocrWallMs)
      this.stats.ocrRuns++
      this.stats.last = timings
      this.lastErrorKind = ''
      const cjk = res.lines.filter(l => isRowText(l.text))
      const panelRows = cjk.filter(l => isPanelRow(l.text)).length
      // 沒有任何面板格式的列 → 不是面板(地上物品標籤、其他 UI 的中文字),當成沒有列
      const rows: RuneshapeScanRow[] = panelRows > 0
        ? cjk.map(l => ({ text: l.text, x: l.x + cap.offset.x, y: l.y + cap.offset.y, w: l.w, h: l.h }))
        : []
      this.panel = panelRows > 0 ? 'found' : 'not-found'
      this.lastHadPanel = panelRows > 0
      if (mode === 'auto') {
        if (panelRows > 0 && this.auto) this.auto.misses = 0
        else if (panelRows === 0) this.autoMiss()
      }
      const d = timings.diff ? `差分 ${timings.diff.mean}/${(timings.diff.changedRatio * 100).toFixed(2)}%` : '無基準'
      this.log(`[runeshape] #${this.seq + 1} ${mode} 區域 ${rect.width}x${rect.height} ×${ocrScale(rect.width, rect.height)}:擷取 ${captureMs} ms、` +
        `${timings.locateMs != null ? `定位 ${timings.locateMs} ms、` : ''}${d}(${timings.diffMs} ms)、OCR ${timings.ocrWallMs} ms(行程內 ${res.ms}${timings.retry ? ',直書重試' : ''})、` +
        `總計 ${timings.totalMs} ms;${res.lines.length} 行 → ${rows.length} 列(面板列 ${panelRows})`)
      if (rows.length) {
        this.baseline = { key: newKey, fp }
        this.emptyStreak = 0
        this.shown = true
        this.emit('rows', rows, cap.client, timings)
        return { kind: 'ocr', mode, rect, rows: rows.length, panelRows, sent: 'rows', timings }
      }
      // 沒有列:第 1 次不設基準(下一個 tick 一定再 OCR 一次確認),連續第 2 次才送空結果並設基準
      this.emptyStreak++
      if (this.emptyStreak >= 2) {
        // auto 快取剛被清掉 → 基準也不留(下一次換新區域)
        this.baseline = mode === 'auto' && !this.auto ? null : { key: newKey, fp }
        if (this.emptyStreak === 2) {
          this.emit('empty', [], cap.client, timings)
          this.shown = false
          return { kind: 'ocr', mode, rect, rows: 0, panelRows, sent: 'empty', timings }
        }
      } else {
        this.baseline = null
      }
      return { kind: 'ocr', mode, rect, rows: 0, panelRows, sent: null, timings }
    } catch (e) {
      const message = e instanceof Error ? `${(e as { kind?: string }).kind ?? ''} ${e.message}`.trim() : String(e)
      this.stats.lastError = message
      // 同一種錯誤只記一次(缺語言包時每秒一行太吵)
      if (message !== this.lastErrorKind) this.log(`[runeshape] 失敗:${message}`)
      this.lastErrorKind = message
      this.baseline = null
      return { kind: 'error', message }
    } finally {
      this.inFlight = false
    }
  }

  private pushHist (a: number[], v: number) {
    a.push(v)
    if (a.length > AVG_WINDOW) a.shift()
  }
}
