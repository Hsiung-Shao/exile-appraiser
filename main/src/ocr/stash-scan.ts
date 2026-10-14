/**
 * PoE1 倉庫價格疊層(Stash-Ninja 式,參考 Exile-UI,MIT):偵測倉庫「碎片」頁開著、目前在哪個子頁。
 * 不 import electron(main vitest 以假時鐘 / 假擷取測)。
 *
 * 物品身分**不靠 OCR**(格子裡只有圖示 + 數量):固定版面表(`data/poe1/stash/layouts.json`)依位置對應,renderer 畫每格徽章。
 * 這裡只看倉庫面板頂端的子頁按鈕列(`core/src/stash/detect.ts` `stripRect`;使用者自訂區域 `region` 夾在 `stripZone` 內):
 *   擷取 → 按鈕列灰階縮圖與上次 OCR 時比對,沒變就不 OCR → 有變化才 OCR(×3)→ `findSubtabButtons`(四顆按鈕文字至少 3 顆、
 *   由文字高度推資料夾偏移)→ 每顆按鈕文字 p99 亮度 → `activeSubtab`(目前子頁的文字較亮)→ 狀態變了才送 `stash-scan-result`。
 * 沒找到按鈕:游標停在已顯示子頁的格子上(遊戲說明框可能蓋住按鈕列,`holdOnMiss`)→ 維持原狀,但連續最多 `STASH_HOLD_LIMIT` 次;
 * 否則連續 2 次才送 `hide`。疊層顯示中沒找到按鈕時作廢差分基準(下一 tick 一定重 OCR,畫面靜止也收得掉);沒顯示時照常差分。
 *
 * 2026-10-15 倉庫價值:顯示中且開著「讀取堆疊數量」(`readQuantity`)時,同一張擷取對版面每格讀左上角的堆疊數量
 * (core `quantity.ts` 數字模板比對,不用 WinOCR):第一次顯示讀全部格;之後每格以便宜的簽章(數字區白色程度)比對,變了才重讀那一格;
 * 游標停在格子上(遊戲說明框 / 游標上的物品可能蓋住格子)→ 這個 tick 不讀。我們自己的徽章會蓋住數字(擷取截得到 overlay):
 * 蓋到的格不讀,沿用上次值;蓋到的格露出部分變了(數量可能改了)→ 送 `peek` 請 renderer 暫時收起格子徽章,ack 後用乾淨畫面重讀。
 * 每個事件都等 renderer 回報遮罩(ack,`drawPending`)才擷取下一張。
 *
 * 與褻瀆 / 符文塑形共用 WinOcr(別的掃描忙碌就丟這個 tick)與擷取(`SharedCapture`)。被擋下時的排程同 `panel-scan.ts`:
 * 停用 / 不是 PoE1 → 不排(等 `poke()`);其他原因 10 秒保底。不送任何鍵盤 / 滑鼠輸入。
 */
import type { OcrRegion, RuneshapeUiState, StashScanEvent, StashStats } from '@ipc/types'
import type { OcrTextLang, OcrTextLine } from '../../../poe2/src/desecration/ocr-text'
import { activeSubtab, buttonRects, findSubtabButtons, percentile, stripRect, stripZone, type Rect } from '../../../core/src/stash/detect'
import { cellRects, type StashLayoutFile, type StashSubtab } from '../../../core/src/stash/layout'
import {
  qtyCellSignature, qtyCropRect, qtySignatureChanged, readCellQuantity, type DigitTemplates, type QtyRect
} from '../../../core/src/stash/quantity'
import {
  BLOCKED_FALLBACK_MS, clampScanInterval, isChanged, isLargeChange, DEFAULT_DIFF_THRESHOLDS,
  type Fingerprint, type ScanCapture, type ScanClock, type ScanEnv
} from './panel-scan'
import { regionSearchRect, type PhysRect } from './strategy'

export interface StashScanConfig {
  enabled: boolean
  game: 'poe1' | 'poe2'
  intervalMs: number
  /** 使用者框的 OCR 區域(client 比例;2026-10-14 使用者要求可自訂);null / 省略 = 預設按鈕列 `stripRect` */
  region?: OcrRegion | null
  /** 2026-10-15:讀每格堆疊數量(倉庫價值);省略 = 開 */
  readQuantity?: boolean
}

/** `user-paused` = 使用者按暫停熱鍵(2026-10-14;暫停當下 `toggleUserPause` 已收掉疊層) */
export type StashBlock = 'disabled' | 'not-poe1' | 'user-paused' | 'not-overlay' | 'no-window' | 'game-inactive' | 'ui-open'

/** 這幾種「停止」要收掉疊層;失焦 / UI 開著只是暫停(疊層留著) */
export const STASH_CLEARING_BLOCKS: ReadonlySet<StashBlock> = new Set<StashBlock>(['disabled', 'not-poe1', 'not-overlay', 'no-window', 'user-paused'])
/** 功能本身停用 / 使用者暫停 → 連保底 tick 都不排,等 host-config 的 `poke()` / 繼續熱鍵 */
const IDLE_STOP: ReadonlySet<StashBlock> = new Set<StashBlock>(['disabled', 'not-poe1', 'user-paused'])

export function stashBlock (cfg: StashScanConfig, env: ScanEnv, ui: RuneshapeUiState, userPaused = false): StashBlock | null {
  if (!cfg.enabled) return 'disabled'
  if (cfg.game !== 'poe1') return 'not-poe1'
  if (userPaused) return 'user-paused'
  if (!env.overlay) return 'not-overlay'
  if (!env.bounds || !(env.bounds.width > 0 && env.bounds.height > 0)) return 'no-window'
  if (!env.gameActive) return 'game-inactive'
  if (ui.panel || ui.settings || ui.picker) return 'ui-open'
  return null
}

/** 「沒找到子頁按鈕」診斷記錄的最小間隔 */
export const STASH_MISS_LOG_MS = 30_000

/** 連續幾次沒找到按鈕(且沒被維持)才收掉 */
export const STASH_MISS_LIMIT = 2
/** 連續維持(held)上限:超過後照常累計 miss(游標停在格上按 Esc 關倉庫時不卡住);找到按鈕歸零 */
export const STASH_HOLD_LIMIT = 5

export interface StashScanDeps {
  clock?: ScanClock
  config: () => StashScanConfig
  env: () => ScanEnv
  /** 別的掃描正在用共用的 WinOcr */
  ocrBusy: () => boolean
  capture: (bounds: PhysRect) => Promise<ScanCapture>
  send: (ev: StashScanEvent) => void
  /** OCR 語言(按鈕文字繁中 / 英文) */
  textLang?: () => OcrTextLang
  /** 游標停在疊層的格子上(說明框可能蓋住按鈕列 → 沒找到不算 miss,最多 `STASH_HOLD_LIMIT` 次);省略 = 否 */
  holdOnMiss?: () => boolean
  /** 顯示狀態改變(main 依此開關游標輪詢) */
  onShowingChange?: (showing: boolean, state: { subtab: StashSubtab | null, yOffset: number, clientH: number }) => void
  log?: (msg: string) => void
  /** 讀堆疊數量要的版面與數字模板(省略 / 任一回 null = 不讀數量) */
  qty?: { layouts: () => StashLayoutFile | null, templates: () => DigitTemplates | null }
  /** 游標停在格子上 → 這個 tick 不讀數量(遊戲說明框 / 游標上的物品可能蓋住格子);省略 = 否 */
  qtyPaused?: () => boolean
  /** 送出的事件還沒被 renderer 回報遮罩(ack)→ 這個 tick 不擷取(main `ScanMaskStore.pending`);省略 = 不等 */
  drawPending?: () => boolean
}

/** peek 送出後最多等幾個 tick 讓徽章收起(遮罩一直沒清掉 → 放棄,沿用舊值) */
export const STASH_PEEK_LIMIT = 3

interface QtyCell {
  /** 上次在沒被遮住時讀數量的簽章 */
  clean?: number[]
  /** 被遮住時最近一次的簽章 + 遮罩位置(遮罩位置變了 = 重設基準,不算數量變化) */
  masked?: { sig: number[], key: string }
}

interface QtyState {
  key: string
  cells: QtyCell[]
  values: Array<number | null>
  /** 要讀(第一次 / 變了)但還沒讀的格 */
  want: Set<number>
  /** 已送 peek、等 renderer 收起徽章 */
  peek: boolean
  peekTries: number
  /** 上次送出的(比對要不要再送) */
  sentValues: Array<number | null> | null
  sentPeek: boolean
}

export type StashTickResult =
  | { kind: 'overlap' }
  | { kind: 'blocked', block: StashBlock }
  | { kind: 'busy' }
  | { kind: 'unchanged' }
  | { kind: 'mask-wait' }
  | { kind: 'ocr', found: boolean, subtab: StashSubtab | null, held: boolean, sent: StashScanEvent['reason'] | null, ms: number }
  | { kind: 'error', message: string }

const REAL_CLOCK: ScanClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => { clearTimeout(h as ReturnType<typeof setTimeout>) }
}

/** client 矩形 → 擷取影像矩形(減掉擷取偏移) */
function toImage (r: Rect, offset: { x: number, y: number }): PhysRect {
  return { x: r.x - offset.x, y: r.y - offset.y, width: r.w, height: r.h }
}

function intersect (a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/**
 * 這個 tick 要 OCR 的影像矩形:使用者框的區域(client 比例)換成 client 像素後與 `stripZone`(按鈕可能出現的範圍)取交集;
 * 沒框 / 交集為空 → 預設 `stripRect`。最後減擷取偏移並夾在影像內。`clamped` = 使用者區域被縮小(交集 ≠ 原區域)。
 */
export function stashOcrRect (
  size: { w: number, h: number },
  region: OcrRegion | null | undefined,
  client: { w: number, h: number },
  offset: { x: number, y: number }
): { rect: PhysRect, clamped: Rect | null, outside: boolean } {
  let r: Rect = stripRect(client.h)
  let clamped: Rect | null = null
  let outside = false
  // client 像素(regionSearchRect 以 client 當影像、偏移 0 → 規則與其他掃描相同)
  const user = regionSearchRect(client, region, { client, offset: { x: 0, y: 0 } })
  if (user) {
    const u: Rect = { x: user.x, y: user.y, w: user.width, h: user.height }
    const inZone = intersect(u, stripZone(client.w, client.h))
    if (inZone) {
      r = inZone
      if (inZone.x !== u.x || inZone.y !== u.y || inZone.w !== u.w || inZone.h !== u.h) clamped = inZone
    } else {
      outside = true
    }
  }
  const img = intersect(toImageRect(r, offset), { x: 0, y: 0, w: size.w, h: size.h }) ?? toImageRect(r, offset)
  return { rect: { x: img.x, y: img.y, width: img.w, height: img.h }, clamped, outside }
}

function toImageRect (r: Rect, offset: { x: number, y: number }): Rect {
  return { x: r.x - offset.x, y: r.y - offset.y, w: r.w, h: r.h }
}

export class StashScan {
  private readonly deps: StashScanDeps
  private readonly clock: ScanClock
  private timer: unknown = null
  private running = false
  private ticking = false
  private inFlight = false
  private idleBlocked = false
  private ui: RuneshapeUiState = { panel: false, settings: false, picker: false }
  private baseline: { key: string, fp: Fingerprint } | null = null
  private missStreak = 0
  private holdStreak = 0
  private seq = 0
  private shown: { subtab: StashSubtab, yOffset: number, clientW: number, clientH: number } | null = null
  private lastBlock: StashBlock | null = null
  private lastOcrMs: number | null = null
  /** 「沒找到按鈕」診斷記錄的上次時間(節流) */
  private lastMissLogAt = -Infinity
  private lastClampLogKey: string | null = null
  private ocrCount = 0
  private userPaused = false
  private qty: QtyState | null = null
  private lastQtyMs: number | null = null
  /** 效能診斷(perf-monitor `stashSnapshotOf`)用的累計計數:只 `++`,關著零成本 */
  readonly counters = { ticks: 0, captures: 0, ocrRuns: 0, skippedUnchanged: 0, skippedBusy: 0, qtyRuns: 0, qtyCells: 0, qtyPeeks: 0, qtyCursorSkips: 0, maskWaits: 0 }
  /** 效能診斷:被 `stashBlock` 擋下的 tick 依原因累計 */
  readonly blockCounts: Partial<Record<StashBlock, number>> = {}

  constructor (deps: StashScanDeps) {
    this.deps = deps
    this.clock = deps.clock ?? REAL_CLOCK
  }

  /** 擷取 / OCR 進行中(共用 WinOcr 的其他掃描據此丟 tick) */
  get busy (): boolean { return this.inFlight }
  get showing (): boolean { return this.shown != null }
  /** 掃描迴圈是否啟動(效能診斷:沒啟動 = 'stopped') */
  get isRunning (): boolean { return this.running }

  start (firstDelayMs = 0): void {
    if (this.running) return
    this.running = true
    this.schedule(firstDelayMs)
  }

  stop (): void {
    this.running = false
    if (this.timer != null) this.clock.clearTimeout(this.timer)
    this.timer = null
  }

  /** 狀態可能改變(host-config、前景、UI):立刻重看(tick 進行中不插隊) */
  poke (): void {
    if (!this.running || this.ticking) return
    this.schedule(0)
  }

  /** 視窗事件:只在被擋下時才立刻重看 */
  wake (): void {
    if (this.idleBlocked) this.poke()
  }

  /** 使用者暫停中(暫停熱鍵) */
  get paused (): boolean { return this.userPaused }

  /** 暫停熱鍵(2026-10-14,語意同 PanelScan):暫停 = 立刻收掉疊層(送 hide)、不再掃描;繼續 = 立刻重看。回傳切換後的狀態 */
  toggleUserPause (): boolean {
    this.userPaused = !this.userPaused
    this.baseline = null
    this.deps.log?.(`[stash] 使用者${this.userPaused ? '暫停' : '繼續'}倉庫價格`)
    if (this.userPaused && this.shown) this.hide({ w: this.shown.clientW, h: this.shown.clientH })
    this.poke()
    return this.userPaused
  }

  /** 設成指定的暫停狀態;已經是這個狀態就不動。回傳設定後的狀態 */
  setUserPause (paused: boolean): boolean {
    if (this.userPaused !== paused) this.toggleUserPause()
    return this.userPaused
  }

  setUiState (s: RuneshapeUiState): void {
    this.ui = { panel: s.panel === true, settings: s.settings === true, picker: s.picker === true }
    this.poke()
  }

  snapshot (): StashStats {
    return {
      block: this.lastBlock,
      showing: this.shown != null,
      subtab: this.shown?.subtab ?? null,
      lastOcrMs: this.lastOcrMs,
      ocrCount: this.ocrCount,
      lastQtyMs: this.lastQtyMs,
      qtyCells: this.counters.qtyCells
    }
  }

  private schedule (ms: number): void {
    if (this.timer != null) this.clock.clearTimeout(this.timer)
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      void this.tick().then(res => {
        if (!this.running) return
        const blocked = res.kind === 'blocked'
        this.idleBlocked = blocked
        if (blocked && IDLE_STOP.has(res.block)) return
        if (this.timer == null) this.schedule(blocked ? BLOCKED_FALLBACK_MS : clampScanInterval(this.deps.config().intervalMs))
      })
    }, ms)
  }

  private emit (reason: StashScanEvent['reason'], client: { w: number, h: number }, ocrMs?: number, opts: { qtyOnly?: boolean, qtyMs?: number } = {}): StashScanEvent {
    const ev: StashScanEvent = {
      seq: ++this.seq,
      ts: this.clock.now(),
      reason,
      subtab: reason === 'show' ? this.shown!.subtab : null,
      yOffset: reason === 'show' ? this.shown!.yOffset : 0,
      client,
      ...(ocrMs != null ? { ocrMs } : {})
    }
    if (reason === 'show' && this.qty) {
      ev.quantities = this.qty.values.slice()
      if (opts.qtyMs != null) ev.qtyMs = opts.qtyMs
      if (this.qty.peek) ev.peek = true
      this.qty.sentValues = ev.quantities
      this.qty.sentPeek = this.qty.peek
    }
    this.deps.send(ev)
    // 只有數量變了(同子頁):顯示狀態沒變,不通知(游標輪詢不用重設)
    if (!opts.qtyOnly) this.deps.onShowingChange?.(reason === 'show', { subtab: ev.subtab, yOffset: ev.yOffset, clientH: client.h })
    return ev
  }

  private hide (client: { w: number, h: number }, ocrMs?: number): StashScanEvent['reason'] | null {
    if (!this.shown) return null
    this.shown = null
    this.qty = null
    this.missStreak = 0
    this.holdStreak = 0
    this.emit('hide', client, ocrMs)
    return 'hide'
  }

  /** 一個 tick(測試直接呼叫) */
  async tick (): Promise<StashTickResult> {
    if (this.ticking) return { kind: 'overlap' }
    this.ticking = true
    this.counters.ticks++
    try {
      return await this.runTick()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.deps.log?.(`[stash] 掃描失敗:${message}`)
      return { kind: 'error', message }
    } finally {
      this.ticking = false
      this.inFlight = false
    }
  }

  /** 被擋下:記錄狀態(lastBlock / log / 計數)、作廢差分基準;停止類原因收掉疊層(暫停類留著) */
  private blockedResult (block: StashBlock): StashTickResult {
    if (block !== this.lastBlock) this.deps.log?.(`[stash] 暫停:${block}`)
    this.lastBlock = block
    this.blockCounts[block] = (this.blockCounts[block] ?? 0) + 1
    this.baseline = null
    if (STASH_CLEARING_BLOCKS.has(block) && this.shown) {
      this.hide({ w: this.shown.clientW, h: this.shown.clientH })
    }
    return { kind: 'blocked', block }
  }

  private async runTick (): Promise<StashTickResult> {
    const cfg = this.deps.config()
    const env = this.deps.env()
    const block = stashBlock(cfg, env, this.ui, this.userPaused)
    if (block) return this.blockedResult(block)
    if (this.lastBlock) { this.deps.log?.('[stash] 繼續掃描'); this.lastBlock = null }
    if (this.deps.ocrBusy()) { this.counters.skippedBusy++; return { kind: 'busy' } }
    // renderer 還沒畫完上一個事件(遮罩沒 ack)→ 擷取可能截到還沒遮的徽章
    if (this.deps.drawPending?.()) { this.counters.maskWaits++; return { kind: 'mask-wait' } }

    this.inFlight = true
    this.counters.captures++
    const cap = await this.deps.capture(env.bounds!)
    const client = cap.client
    // 使用者框的區域優先,但夾在按鈕可能出現的範圍內(R1:框整個畫面 → 整張 ×3 OCR、也截到自己的徽章);交集為空 → 預設按鈕列
    const ocr = stashOcrRect(cap.size, cfg.region, client, cap.offset)
    this.logRegionClamp(cfg.region, ocr)
    const strip = ocr.rect
    const fp = cap.fingerprint(strip)
    const key = `${client.w}x${client.h}@${cap.offset.x},${cap.offset.y}|${strip.x},${strip.y},${strip.width},${strip.height}`
    const prev = this.baseline?.key === key ? this.baseline.fp : null
    // 畫面沒變:狀態不會變(子頁 / 開關都會改變按鈕列)
    if (prev && !isChanged(this.diff(prev, fp), DEFAULT_DIFF_THRESHOLDS) && !isLargeChange(prev, fp)) {
      this.counters.skippedUnchanged++
      if (this.shown) this.updateQuantities(cap)
      return { kind: 'unchanged' }
    }
    if (this.deps.ocrBusy()) { this.counters.skippedBusy++; return { kind: 'busy' } }

    const { lines, ms } = await cap.recognize(strip, 3)
    this.ocrCount++
    this.counters.ocrRuns++
    this.lastOcrMs = ms
    const clientLines = lines.map((l: OcrTextLine) => ({ text: l.text, x: l.x + cap.offset.x, y: l.y + cap.offset.y, w: l.w, h: l.h }))
    const lang = this.deps.textLang?.() ?? 'zh'
    const match = findSubtabButtons(clientLines, client.h, lang)

    if (!match.found) {
      // 診斷:認到 ≥ 1 顆但判定失敗(像碎片頁但沒過門檻 / 偏移對不上)時記下 OCR 文字,最多每 30 秒一次(實機回報「徽章沒出現」時查得到原因)
      const now = this.clock.now()
      if (match.matched > 0 && now - this.lastMissLogAt >= STASH_MISS_LOG_MS) {
        this.lastMissLogAt = now
        this.deps.log?.(`[stash] 沒找到子頁按鈕(認到 ${match.matched} 顆,client ${client.w}×${client.h}):` +
          clientLines.map(l => l.text.replace(/\s+/g, '')).join(' | ').slice(0, 200))
      }
      // 疊層顯示中(含 held / miss 累計期間)作廢差分基準(B1):畫面靜止也要重 OCR,否則 miss 累計不到上限、疊層收不掉;
      // 沒顯示時照常記下這次縮圖(N1):平常玩遊戲畫面沒變就不 OCR
      this.baseline = this.shown ? null : { key, fp }
      const held = this.shown != null && this.holdStreak < STASH_HOLD_LIMIT && this.deps.holdOnMiss?.() === true
      if (held) {
        this.holdStreak++
        return { kind: 'ocr', found: false, subtab: this.shown!.subtab, held: true, sent: null, ms }
      }
      this.missStreak++
      const sent = this.missStreak >= STASH_MISS_LIMIT ? this.hide(client, ms) : null
      return { kind: 'ocr', found: false, subtab: null, held: false, sent, ms }
    }
    this.baseline = { key, fp }
    this.missStreak = 0
    this.holdStreak = 0

    let subtab: StashSubtab | null = null
    if (cap.gray) {
      const p99 = buttonRects(client.h, match.yOffset).map(r => percentile(cap.gray!(toImage(r, cap.offset)), 0.99))
      subtab = activeSubtab(p99)
    }
    if (!subtab) {
      // 異能 / 判不出目前子頁 → 不畫
      const sent = this.hide(client, ms)
      return { kind: 'ocr', found: true, subtab: null, held: false, sent, ms }
    }
    // tick 進行中(await 期間)使用者按了暫停 → 不畫(下一輪被 user-paused 擋下並收掉)
    if (this.userPaused) return this.blockedResult('user-paused')
    const same = this.shown && this.shown.subtab === subtab && this.shown.yOffset === match.yOffset &&
      this.shown.clientW === client.w && this.shown.clientH === client.h
    if (same) {
      this.updateQuantities(cap)
      return { kind: 'ocr', found: true, subtab, held: false, sent: null, ms }
    }
    this.shown = { subtab, yOffset: match.yOffset, clientW: client.w, clientH: client.h }
    this.qty = null
    this.deps.log?.(`[stash] 碎片頁:${subtab}${match.yOffset ? `(資料夾偏移 ${match.yOffset})` : ''},OCR ${ms} ms`)
    const q = this.readQuantities(cap, true)
    this.emit('show', client, ms, { qtyMs: q?.ms })
    return { kind: 'ocr', found: true, subtab, held: false, sent: 'show', ms }
  }

  /** 顯示中:讀數量(只讀變了的格);數量 / peek 狀態跟上次送的不同 → 再送一次同子頁的 show。開關關掉 → 送一次不帶數量的 show */
  private updateQuantities (cap: ScanCapture): void {
    if (!this.shown) return
    const had = this.qty != null
    const q = this.readQuantities(cap, false)
    const client = { w: this.shown.clientW, h: this.shown.clientH }
    if (!this.qty) {
      if (had) this.emit('show', client, undefined, { qtyOnly: true })
      return
    }
    const st = this.qty
    const sent = st.sentValues
    const changed = sent == null || st.peek !== st.sentPeek || st.values.some((v, i) => v !== sent[i])
    if (changed) this.emit('show', client, undefined, { qtyOnly: true, qtyMs: q?.ms })
  }

  /**
   * 讀這張擷取的格子數量,更新 `this.qty`。`fresh` = 剛切到這個子頁(全部要讀)。
   * 不讀(關閉 / 沒有模板 / 擷取不支援)→ `this.qty = null`、回 null;游標停在格上 → 什麼都不動、回 null。
   */
  private readQuantities (cap: ScanCapture, fresh: boolean): { ms: number } | null {
    const shown = this.shown
    const cfg = this.deps.config()
    const layouts = this.deps.qty?.layouts() ?? null
    const templates = this.deps.qty?.templates() ?? null
    if (!shown || cfg.readQuantity === false || !layouts || !templates || !cap.pixels) { this.qty = null; return null }
    const key = `${shown.subtab}|${shown.yOffset}|${shown.clientW}x${shown.clientH}@${cap.offset.x},${cap.offset.y}`
    const rects = cellRects(layouts, shown.subtab, shown.clientH, shown.yOffset)
    if (fresh || this.qty?.key !== key) {
      this.qty = { key, cells: rects.map(() => ({})), values: rects.map(() => null), want: new Set(rects.keys()), peek: false, peekTries: 0, sentValues: null, sentPeek: false }
    }
    const st = this.qty!
    // 游標停在格上:遊戲說明框 / 游標上的物品可能蓋住格子 → 這次不讀也不更新基準(第一次顯示除外:打開倉庫的瞬間不會有說明框)
    if (!fresh && this.deps.qtyPaused?.()) { this.counters.qtyCursorSkips++; return null }

    const t0 = performance.now()
    // 影像座標(client − 擷取偏移);一次取整個格子區的像素
    const img = rects.map(r => ({ x: r.x - cap.offset.x, y: r.y - cap.offset.y, w: r.w, h: r.h }))
    const crops = img.map(r => qtyCropRect(r, shown.clientH, templates.baseClientH))
    const bx0 = Math.floor(Math.min(...crops.map(c => c.x))) - 2
    const by0 = Math.floor(Math.min(...crops.map(c => c.y))) - 2
    const bx1 = Math.ceil(Math.max(...crops.map(c => c.x + c.w))) + 2
    const by1 = Math.ceil(Math.max(...crops.map(c => c.y + c.h))) + 2
    const px = cap.pixels({ x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 })
    const local = (r: QtyRect): QtyRect => ({ x: r.x - px.x, y: r.y - px.y, w: r.w, h: r.h })
    const masks = (cap.maskRects ?? []).map(local)
    let reads = 0
    let needPeek = false
    for (let i = 0; i < rects.length; i++) {
      const cell = local(img[i])
      const c = local(crops[i])
      const hit = masks.filter(m => m.x < c.x + c.w && c.x < m.x + m.w && m.y < c.y + c.h && c.y < m.y + m.h)
      const sig = qtyCellSignature(px, cell, shown.clientH, templates.baseClientH, hit)
      const cs = st.cells[i]
      if (hit.length) {
        // 被我們的徽章蓋住:不讀。露出的部分跟上次(同一組遮罩)比有變 → 數量可能改了 → 要 peek 重讀
        const mkey = hit.map(m => `${m.x},${m.y},${m.w},${m.h}`).join(';')
        if (cs.masked && cs.masked.key === mkey && qtySignatureChanged(cs.masked.sig, sig)) st.want.add(i)
        cs.masked = { sig, key: mkey }
        if (st.want.has(i)) needPeek = true
        continue
      }
      cs.masked = undefined
      if (!st.want.has(i) && !qtySignatureChanged(cs.clean, sig)) continue
      const r = readCellQuantity(px, cell, templates, { clientH: shown.clientH })
      st.values[i] = r.reason === 'ok' ? r.qty : r.reason === 'empty' ? 0 : null
      cs.clean = sig
      st.want.delete(i)
      reads++
    }
    const ms = Math.round((performance.now() - t0) * 10) / 10
    if (needPeek) {
      if (!st.peek) {
        st.peek = true
        st.peekTries = 0
        this.counters.qtyPeeks++
      } else if (++st.peekTries > STASH_PEEK_LIMIT) {
        // 遮罩一直沒清掉(renderer 沒收起 / 沒回報)→ 放棄這次,沿用舊值
        this.deps.log?.(`[stash] 徽章遮住的格子等不到收起,沿用舊數量(${st.want.size} 格)`)
        st.want.clear()
        st.peek = false
      }
    } else if (st.peek) {
      st.peek = false
    }
    if (reads) {
      this.counters.qtyRuns++
      this.counters.qtyCells += reads
      this.lastQtyMs = ms
      if (fresh) this.deps.log?.(`[stash] 讀數量 ${reads} 格,${ms} ms`)
    }
    return { ms }
  }

  /** 自訂區域被縮小 / 完全在範圍外:同一個區域值只記一次 */
  private logRegionClamp (region: OcrRegion | null | undefined, ocr: { clamped: Rect | null, outside: boolean }): void {
    if (!region) { this.lastClampLogKey = null; return }
    if (!ocr.clamped && !ocr.outside) return
    const key = `${region.x},${region.y},${region.w},${region.h}`
    if (key === this.lastClampLogKey) return
    this.lastClampLogKey = key
    if (ocr.clamped) {
      const c = ocr.clamped
      this.deps.log?.(`[stash] 自訂 OCR 區域超出按鈕列範圍,已縮到 ${c.x},${c.y} ${c.w}×${c.h}(client px)`)
    } else {
      this.deps.log?.('[stash] 自訂 OCR 區域完全不在按鈕列範圍內,改用預設位置')
    }
  }

  private diff (a: Fingerprint, b: Fingerprint): { mean: number, changedRatio: number } | null {
    if (a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length) return null
    let sum = 0
    let changed = 0
    for (let i = 0; i < a.data.length; i++) {
      const d = Math.abs(a.data[i] - b.data[i])
      sum += d
      if (d >= 16) changed++
    }
    return { mean: sum / a.data.length, changedRatio: changed / a.data.length }
  }
}
