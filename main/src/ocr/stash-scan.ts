/**
 * PoE1 倉庫價格疊層(Stash-Ninja 式,參考 Exile-UI,MIT):偵測倉庫「碎片」頁開著、目前在哪個子頁。
 * 不 import electron(main vitest 以假時鐘 / 假擷取測)。
 *
 * 物品身分**不靠 OCR**(格子裡只有圖示 + 數量):固定版面表(`data/poe1/stash/layouts.json`)依位置對應,renderer 畫每格徽章。
 * 這裡只看倉庫面板頂端的子頁按鈕列(`core/src/stash/detect.ts` `stripRect`,約 883 × 159 @1432):
 *   擷取 → 按鈕列灰階縮圖與上次 OCR 時比對,沒變就不 OCR → 有變化才 OCR(×3)→ `findSubtabButtons`(四顆按鈕文字至少 3 顆、
 *   由文字高度推資料夾偏移)→ 每顆按鈕文字 p99 亮度 → `activeSubtab`(目前子頁的文字較亮)→ 狀態變了才送 `stash-scan-result`。
 * 沒找到按鈕:游標在倉庫面板內(遊戲說明框可能蓋住按鈕列,`holdOnMiss`)→ 維持原狀;否則連續 2 次才送 `hide`。
 *
 * 與褻瀆 / 符文塑形共用 WinOcr(別的掃描忙碌就丟這個 tick)與擷取(`SharedCapture`)。被擋下時的排程同 `panel-scan.ts`:
 * 停用 / 不是 PoE1 → 不排(等 `poke()`);其他原因 10 秒保底。不送任何鍵盤 / 滑鼠輸入。
 */
import type { RuneshapeUiState, StashScanEvent, StashStats } from '@ipc/types'
import type { OcrTextLang, OcrTextLine } from '../../../poe2/src/desecration/ocr-text'
import { activeSubtab, buttonRects, findSubtabButtons, percentile, stripRect, type Rect } from '../../../core/src/stash/detect'
import type { StashSubtab } from '../../../core/src/stash/layout'
import {
  BLOCKED_FALLBACK_MS, clampScanInterval, isChanged, isLargeChange, DEFAULT_DIFF_THRESHOLDS,
  type Fingerprint, type ScanCapture, type ScanClock, type ScanEnv
} from './panel-scan'
import type { PhysRect } from './strategy'

export interface StashScanConfig {
  enabled: boolean
  game: 'poe1' | 'poe2'
  intervalMs: number
}

export type StashBlock = 'disabled' | 'not-poe1' | 'not-overlay' | 'no-window' | 'game-inactive' | 'ui-open'

/** 這幾種「停止」要收掉疊層;失焦 / UI 開著只是暫停(疊層留著) */
export const STASH_CLEARING_BLOCKS: ReadonlySet<StashBlock> = new Set<StashBlock>(['disabled', 'not-poe1', 'not-overlay', 'no-window'])
/** 功能本身停用 → 連保底 tick 都不排,等 host-config 的 `poke()` */
const IDLE_STOP: ReadonlySet<StashBlock> = new Set<StashBlock>(['disabled', 'not-poe1'])

export function stashBlock (cfg: StashScanConfig, env: ScanEnv, ui: RuneshapeUiState): StashBlock | null {
  if (!cfg.enabled) return 'disabled'
  if (cfg.game !== 'poe1') return 'not-poe1'
  if (!env.overlay) return 'not-overlay'
  if (!env.bounds || !(env.bounds.width > 0 && env.bounds.height > 0)) return 'no-window'
  if (!env.gameActive) return 'game-inactive'
  if (ui.panel || ui.settings || ui.picker) return 'ui-open'
  return null
}

/** 連續幾次沒找到按鈕(且游標不在倉庫面板內)才收掉 */
export const STASH_MISS_LIMIT = 2

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
  /** 游標在倉庫面板內(說明框可能蓋住按鈕列 → 沒找到不算 miss);省略 = 否 */
  holdOnMiss?: () => boolean
  /** 顯示狀態改變(main 依此開關游標輪詢) */
  onShowingChange?: (showing: boolean, state: { subtab: StashSubtab | null, yOffset: number, clientH: number }) => void
  log?: (msg: string) => void
}

export type StashTickResult =
  | { kind: 'overlap' }
  | { kind: 'blocked', block: StashBlock }
  | { kind: 'busy' }
  | { kind: 'unchanged' }
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
  private seq = 0
  private shown: { subtab: StashSubtab, yOffset: number, clientW: number, clientH: number } | null = null
  private lastBlock: StashBlock | null = null
  private lastOcrMs: number | null = null
  private ocrCount = 0

  constructor (deps: StashScanDeps) {
    this.deps = deps
    this.clock = deps.clock ?? REAL_CLOCK
  }

  /** 擷取 / OCR 進行中(共用 WinOcr 的其他掃描據此丟 tick) */
  get busy (): boolean { return this.inFlight }
  get showing (): boolean { return this.shown != null }

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
      ocrCount: this.ocrCount
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

  private emit (reason: StashScanEvent['reason'], client: { w: number, h: number }, ocrMs?: number): StashScanEvent {
    const ev: StashScanEvent = {
      seq: ++this.seq,
      ts: this.clock.now(),
      reason,
      subtab: reason === 'show' ? this.shown!.subtab : null,
      yOffset: reason === 'show' ? this.shown!.yOffset : 0,
      client,
      ...(ocrMs != null ? { ocrMs } : {})
    }
    this.deps.send(ev)
    this.deps.onShowingChange?.(reason === 'show', { subtab: ev.subtab, yOffset: ev.yOffset, clientH: client.h })
    return ev
  }

  private hide (client: { w: number, h: number }, ocrMs?: number): StashScanEvent['reason'] | null {
    if (!this.shown) return null
    this.shown = null
    this.emit('hide', client, ocrMs)
    return 'hide'
  }

  /** 一個 tick(測試直接呼叫) */
  async tick (): Promise<StashTickResult> {
    if (this.ticking) return { kind: 'overlap' }
    this.ticking = true
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

  private async runTick (): Promise<StashTickResult> {
    const cfg = this.deps.config()
    const env = this.deps.env()
    const block = stashBlock(cfg, env, this.ui)
    if (block !== this.lastBlock) {
      if (block) this.deps.log?.(`[stash] 暫停:${block}`)
      else if (this.lastBlock) this.deps.log?.('[stash] 繼續掃描')
    }
    this.lastBlock = block
    if (block) {
      // 停止 → 收掉疊層;暫停(失焦 / UI 開著)→ 留著,但差分基準作廢(回來時重看一次)
      this.baseline = null
      if (STASH_CLEARING_BLOCKS.has(block) && this.shown) {
        this.hide({ w: this.shown.clientW, h: this.shown.clientH })
      }
      return { kind: 'blocked', block }
    }
    if (this.deps.ocrBusy()) return { kind: 'busy' }

    this.inFlight = true
    const cap = await this.deps.capture(env.bounds!)
    const client = cap.client
    const strip = toImage(stripRect(client.h), cap.offset)
    const fp = cap.fingerprint(strip)
    const key = `${client.w}x${client.h}@${cap.offset.x},${cap.offset.y}`
    const prev = this.baseline?.key === key ? this.baseline.fp : null
    // 畫面沒變:狀態不會變(子頁 / 開關都會改變按鈕列)
    if (prev && !isChanged(this.diff(prev, fp), DEFAULT_DIFF_THRESHOLDS) && !isLargeChange(prev, fp)) {
      return { kind: 'unchanged' }
    }
    if (this.deps.ocrBusy()) return { kind: 'busy' }

    const { lines, ms } = await cap.recognize(strip, 3)
    this.ocrCount++
    this.lastOcrMs = ms
    this.baseline = { key, fp }
    const clientLines = lines.map((l: OcrTextLine) => ({ text: l.text, x: l.x + cap.offset.x, y: l.y + cap.offset.y, w: l.w, h: l.h }))
    const lang = this.deps.textLang?.() ?? 'zh'
    const match = findSubtabButtons(clientLines, client.h, lang)

    if (!match.found) {
      const held = this.shown != null && this.deps.holdOnMiss?.() === true
      if (held) return { kind: 'ocr', found: false, subtab: this.shown!.subtab, held: true, sent: null, ms }
      this.missStreak++
      const sent = this.missStreak >= STASH_MISS_LIMIT ? this.hide(client, ms) : null
      return { kind: 'ocr', found: false, subtab: null, held: false, sent, ms }
    }
    this.missStreak = 0

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
    const same = this.shown && this.shown.subtab === subtab && this.shown.yOffset === match.yOffset &&
      this.shown.clientW === client.w && this.shown.clientH === client.h
    if (same) return { kind: 'ocr', found: true, subtab, held: false, sent: null, ms }
    this.shown = { subtab, yOffset: match.yOffset, clientW: client.w, clientH: client.h }
    this.deps.log?.(`[stash] 碎片頁:${subtab}${match.yOffset ? `(資料夾偏移 ${match.yOffset})` : ''},OCR ${ms} ms`)
    this.emit('show', client, ms)
    return { kind: 'ocr', found: true, subtab, held: false, sent: 'show', ms }
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
