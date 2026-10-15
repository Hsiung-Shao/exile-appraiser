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
 * 只有遮罩蓋到「數字帶」(上次讀到的數字列;沒讀過 = 整個裁切區)才算蓋住:不讀,沿用上次值;蓋住的格露出部分變了
 * (同一組遮罩比上次被遮時;剛被蓋住時比上次乾淨讀數的字形)→ 送 `peek` 請 renderer 暫時收起格子徽章,ack 後用乾淨畫面重讀
 * (ack 後舊徽章外框還會再遮 `MASK_LINGER_MS` → 延後一個保留期才重看;等太久以時間判斷放棄)。
 * 每個事件都等 renderer 回報遮罩(ack,`drawPending`)才擷取下一張;游標換格(`stash-cursor`,renderer 只畫停的那格 ↔ 畫回全部)沒有 ack →
 * 換格後等下一份倉庫遮罩報告(最多 `MASK_LINGER_MS`)才讀數量。
 *
 * 與褻瀆 / 符文塑形共用 WinOcr(別的掃描忙碌就丟這個 tick)與擷取(`SharedCapture`)。被擋下時的排程同 `panel-scan.ts`:
 * 停用 / 不是 PoE1 → 不排(等 `poke()`);其他原因 10 秒保底。不送任何鍵盤 / 滑鼠輸入。
 */
import type { OcrRegion, RuneshapeUiState, StashScanEvent, StashStats } from '@ipc/types'
import type { OcrTextLang, OcrTextLine } from '../../../poe2/src/desecration/ocr-text'
import { activeSubtab, buttonRects, findSubtabButtons, percentile, stripRect, stripZone, type Rect } from '../../../core/src/stash/detect'
import { cellRects, type StashLayoutFile, type StashSubtab } from '../../../core/src/stash/layout'
import {
  QTY_PARAMS, qtyCropRect, qtyMapSignature, qtyShapeChanged, qtySignatureChanged, qtyWhiteMap, readCellQuantity,
  type DigitTemplates, type QtyRect, type QtyWhiteMap
} from '../../../core/src/stash/quantity'
import {
  BLOCKED_FALLBACK_MS, clampScanInterval, isChanged, isLargeChange, DEFAULT_DIFF_THRESHOLDS,
  type Fingerprint, type ScanCapture, type ScanClock, type ScanEnv
} from './panel-scan'
import { regionSearchRect, type PhysRect } from './strategy'
import { MASK_ACK_TIMEOUT_MS, MASK_LINGER_MS } from './scan-mask'
import type { StashDumpData } from './stash-dump'
import type { StashDumpResult } from '@ipc/types'

export interface StashScanConfig {
  enabled: boolean
  game: 'poe1' | 'poe2'
  intervalMs: number
  /** 使用者框的 OCR 區域(client 比例;2026-10-14 使用者要求可自訂);null / 省略 = 預設按鈕列 `stripRect` */
  region?: OcrRegion | null
  /** 2026-10-15:讀每格堆疊數量(倉庫價值);省略 = 開 */
  readQuantity?: boolean
  /** 伺服器(省略 = 國際服) */
  realm?: 'intl' | 'tw'
  /**
   * 2026-10-15 顯示方式:`auto`(省略 / 預設)= 一直偵測倉庫;`hotkey` = 平常不擷取,按倉庫價格熱鍵(`arm()`)才開始掃描,
   * 收起(倉庫關掉 / 再按一次)或連續 `STASH_ARM_MISS_LIMIT` 次沒偵測到倉庫就解除
   */
  triggerMode?: 'auto' | 'hotkey'
}

/**
 * `not-armed` = 熱鍵顯示模式(`triggerMode: 'hotkey'`)還沒按熱鍵:停止類(不排 tick、不截圖,等 `arm()`)。
 * `user-paused` = 使用者按暫停熱鍵(2026-10-14;暫停當下 `toggleUserPause` 已收掉疊層)。
 * `capture-black` = overlay screenshot 「全黑」鎖存中(全螢幕獨占:overlay 畫不出來,擷取只能走每次卡 main 的 getSources)→ 不擷取;
 * 暫停類(疊層留著),鎖存期滿 / 遊戲 attach / 視窗位置大小改變後恢復(`captureBlackMs`)。
 */
export type StashBlock = 'disabled' | 'not-poe1' | 'not-intl' | 'user-paused' | 'not-armed' | 'not-overlay' | 'no-window' | 'game-inactive' | 'ui-open' | 'capture-black'

/** 這幾種「停止」要收掉疊層;失焦 / UI 開著只是暫停(疊層留著) */
export const STASH_CLEARING_BLOCKS: ReadonlySet<StashBlock> = new Set<StashBlock>(['disabled', 'not-poe1', 'not-intl', 'not-overlay', 'no-window', 'user-paused', 'not-armed'])
/** 功能本身停用 / 台服 / 使用者暫停 / 熱鍵模式未觸發 → 連保底 tick 都不排,等 host-config 的 `poke()`(realm 在 `scanConfigKey` 裡)/ 繼續熱鍵 / `arm()` */
const IDLE_STOP: ReadonlySet<StashBlock> = new Set<StashBlock>(['disabled', 'not-poe1', 'not-intl', 'user-paused', 'not-armed'])

/** `armed` = 熱鍵顯示模式已按熱鍵(auto 模式不看) */
export function stashBlock (cfg: StashScanConfig, env: ScanEnv, ui: RuneshapeUiState, userPaused = false, armed = false): StashBlock | null {
  if (!cfg.enabled) return 'disabled'
  if (cfg.game !== 'poe1') return 'not-poe1'
  // 2026-10-15 使用者裁定:倉庫價格 / 倉庫價值只支援國際服(台服沒有 poe.ninja)→ 完全不掃描(不讀按鈕、不讀數量)
  if (cfg.realm === 'tw') return 'not-intl'
  if (userPaused) return 'user-paused'
  if (cfg.triggerMode === 'hotkey' && !armed) return 'not-armed'
  if (!env.overlay) return 'not-overlay'
  if (!env.bounds || !(env.bounds.width > 0 && env.bounds.height > 0)) return 'no-window'
  if (!env.gameActive) return 'game-inactive'
  if (ui.panel || ui.settings || ui.picker) return 'ui-open'
  return null
}

/**
 * 疊層沒顯示(不在倉庫 / 還沒認到按鈕列)時的最短 tick 間隔(使用者 2026-10-15 裁定):間隔 = max(設定間隔, 這個值);
 * 顯示中照設定間隔,偵測到倉庫的那個 tick 之後立刻回到設定間隔
 */
export const STASH_IDLE_INTERVAL_MS = 3000
/** 熱鍵顯示模式:按熱鍵後連續幾次沒偵測到倉庫(沒顯示的 tick)就解除並提示 */
export const STASH_ARM_MISS_LIMIT = 3

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
  /**
   * overlay screenshot 「全黑」鎖存還剩幾毫秒(main `GameClientCapture.blackLatchRemainingMs`);> 0 → 這個 tick 不擷取(`capture-black`),
   * 保底重看不晚於剩餘時間。省略 = 0(不擋)
   */
  captureBlackMs?: () => number
  send: (ev: StashScanEvent) => void
  /** OCR 語言(按鈕文字繁中 / 英文) */
  textLang?: () => OcrTextLang
  /** 游標停在疊層的格子上(說明框可能蓋住按鈕列 → 沒找到不算 miss,最多 `STASH_HOLD_LIMIT` 次);省略 = 否 */
  holdOnMiss?: () => boolean
  /** 顯示狀態改變(main 依此開關游標輪詢) */
  onShowingChange?: (showing: boolean, state: { subtab: StashSubtab | null, yOffset: number, clientH: number }) => void
  log?: (msg: string) => void
  /** 熱鍵顯示模式:按熱鍵後連續 `STASH_ARM_MISS_LIMIT` 次沒偵測到倉庫 → 已解除(main 顯示「沒有偵測到倉庫」提示) */
  onArmMiss?: () => void
  /** 讀堆疊數量要的版面與數字模板(省略 / 任一回 null = 不讀數量) */
  qty?: { layouts: () => StashLayoutFile | null, templates: () => DigitTemplates | null }
  /** 游標停在格子上 → 這個 tick 不讀數量(遊戲說明框 / 游標上的物品可能蓋住格子);省略 = 否 */
  qtyPaused?: () => boolean
  /** 送出的事件還沒被 renderer 回報遮罩(ack)→ 這個 tick 不擷取(main `ScanMaskStore.pending`);省略 = 不等 */
  drawPending?: () => boolean
  /** 除錯「存下倉庫擷取畫面」:寫檔(main `saveStashDump`),回傳 PNG 路徑;省略 = 不支援 */
  saveDump?: (d: StashDumpData) => Promise<string>
}

/** 「存下倉庫擷取畫面」:等下一次顯示中擷取的上限 */
export const STASH_DUMP_TIMEOUT_MS = 3000
/** 按下時掃描暫停中(設定視窗開著 / 遊戲失焦):等使用者關掉設定回到遊戲的上限 */
export const STASH_DUMP_WAIT_UI_MS = 30_000

/** peek 送出後至少等幾個 tick、且超過 `STASH_PEEK_TIMEOUT_MS` 仍蓋著才放棄(沿用舊值) */
export const STASH_PEEK_LIMIT = 3
/** peek 等待上限(以時間算:ack 最多等 `MASK_ACK_TIMEOUT_MS`、ack 後舊徽章外框再遮 `MASK_LINGER_MS`;間隔再短也不會提早放棄) */
export const STASH_PEEK_TIMEOUT_MS = MASK_ACK_TIMEOUT_MS + MASK_LINGER_MS + 500
/** peek 的 ack 到了之後,等舊徽章外框的保留期過了再重看 */
export const STASH_PEEK_REREAD_DELAY_MS = MASK_LINGER_MS + 50

interface QtyCell {
  /** 上次乾淨讀數時的白色程度圖(像素區座標) */
  clean?: QtyWhiteMap
  /** 上次讀到的數字帶(像素區座標);沒讀過 / 空格 = 整個裁切區 */
  band?: QtyRect
  /** 被遮住時最近一次的簽章 + 遮罩位置(同一組遮罩才互比) */
  masked?: { sig: number[], key: string }
  /** 這格的「要重讀」來自被遮時的比對(重讀 = peek 重讀) */
  peekWant?: boolean
  /**
   * 停止字形比對(code review 第 2 輪,防 peek 循環):peek 重讀出的值與舊值相同 = 字形比對誤判(例如徽章陰影)→
   * 之後剛被蓋住時直接以被蓋住的狀態為新基準;乾淨讀到不同的值才恢復(子頁變更 = 狀態重建)
   */
  shapeOff?: boolean
  /** 連續幾次 peek 重讀沒有讀到新的數量(保險:≥ 2 也停止字形比對) */
  peekNoChange?: number
  /** 最近一次讀成「不確定」的原因(除錯記錄用;讀到數量 / 空格時清掉) */
  why?: QtyWhy
}

/** 除錯記錄:一格讀不到數量的原因 */
export interface QtyWhy { reason: string, raw?: string, confidence: number, margin: number }

const QTY_REASON_ZH: Record<string, string> = {
  'low-confidence': '分數低',
  'missed-digit': '疑似漏讀一位',
  'too-many': '位數過多',
  'leading-zero': '開頭為 0',
  zero: '單獨的 0',
  outside: '超出畫面',
  masked: '被遮住'
}

/**
 * 倉庫價值除錯記錄(2026-10-15 使用者要求):數量讀不到(「?」)的格子與原因,一格一段;全部讀到 / 空格 = 空字串。
 * 從沒讀到、還在等徽章收起重讀的格(`want` 內、沒有 `why`)標「被徽章遮住」。
 */
export function stashUnreadSummary (
  rects: ReadonlyArray<{ refName: string }>,
  values: ReadonlyArray<number | null>,
  cells: ReadonlyArray<{ why?: QtyWhy }>,
  want: ReadonlySet<number>
): string {
  const parts: string[] = []
  for (let i = 0; i < rects.length; i++) {
    if (values[i] != null) continue
    const w = cells[i]?.why
    if (w) {
      const zh = QTY_REASON_ZH[w.reason] ?? w.reason
      parts.push(`#${i + 1} ${rects[i].refName} ${zh}(讀到 ${w.raw || '無'},分數 ${w.confidence.toFixed(2)} / 差 ${w.margin.toFixed(2)})`)
    } else if (want.has(i)) {
      parts.push(`#${i + 1} ${rects[i].refName} 被徽章遮住,等待重讀`)
    }
  }
  return parts.join(';')
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
  /** 開始 peek 的時間(clock) */
  peekAt: number
  /** 像素區(`cap.pixels`)原點:變了 → 白色程度圖 / 數字帶座標作廢 */
  org: { x: number, y: number } | null
  /** 上次送出的(比對要不要再送) */
  sentValues: Array<number | null> | null
  sentPeek: boolean
}

export type StashTickResult =
  | { kind: 'overlap' }
  | { kind: 'blocked', block: StashBlock, retryMs?: number }
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
  /** 熱鍵顯示模式:按了熱鍵(`arm()`)還沒解除 */
  private isArmed = false
  /** arm 之後連續沒偵測到倉庫的 tick 數 */
  private armMisses = 0
  private qty: QtyState | null = null
  private lastQtyMs: number | null = null
  /** 上次寫進記錄的未讀格摘要(含版面鍵;相同不重寫) */
  private lastUnreadLog = ''
  /** 游標換格的時間;等滿 `MASK_LINGER_MS` 前不讀數量 */
  private cursorAt: number | null = null
  /** 「存下倉庫擷取畫面」等待中的請求(沒按 = null,讀數量時只多這一個判斷) */
  private dumpReq: { promise: Promise<StashDumpResult>, finish: (r: StashDumpResult) => void, stopTimer: () => void } | null = null
  /** 效能診斷(perf-monitor `stashSnapshotOf`)用的累計計數:只 `++`,關著零成本 */
  readonly counters = { ticks: 0, captures: 0, ocrRuns: 0, skippedUnchanged: 0, skippedBusy: 0, qtyRuns: 0, qtyCells: 0, qtyPeeks: 0, qtyCursorSkips: 0, qtyMasked: 0, maskWaits: 0 }
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

  /**
   * 除錯「存下倉庫擷取畫面」(IPC `stash-dump`):下一次顯示中、會讀數量的擷取存成 PNG + JSON(`saveDump`)。
   * 停止類原因(停用 / 不是 PoE1 / 台服 / 暫停熱鍵 / 非 overlay / 沒有視窗)或疊層沒顯示 → 立刻回原因;
   * 掃描暫停中(設定開著 / 遊戲失焦)等 `STASH_DUMP_WAIT_UI_MS`,否則 `STASH_DUMP_TIMEOUT_MS`;等待中再按 = 同一個請求。
   */
  requestDump (): Promise<StashDumpResult> {
    if (this.dumpReq) return this.dumpReq.promise
    if (!this.deps.saveDump) return Promise.resolve({ ok: false, reason: 'unsupported' })
    const cfg = this.deps.config()
    const block = stashBlock(cfg, this.deps.env(), this.ui, this.userPaused, this.isArmed)
    if (block && STASH_CLEARING_BLOCKS.has(block)) return Promise.resolve({ ok: false, reason: block })
    if (!this.shown) return Promise.resolve({ ok: false, reason: 'not-showing' })
    if (cfg.readQuantity === false) return Promise.resolve({ ok: false, reason: 'qty-off' })
    const waitMs = block ? STASH_DUMP_WAIT_UI_MS : STASH_DUMP_TIMEOUT_MS
    let resolve!: (r: StashDumpResult) => void
    const promise = new Promise<StashDumpResult>(r => { resolve = r })
    let done = false
    const timer = this.clock.setTimeout(() => { finish({ ok: false, reason: 'timeout' }) }, waitMs)
    const stopTimer = () => { this.clock.clearTimeout(timer) }
    const finish = (r: StashDumpResult) => {
      if (done) return
      done = true
      if (this.dumpReq?.promise === promise) this.dumpReq = null
      stopTimer()
      resolve(r)
    }
    this.dumpReq = { promise, finish, stopTimer }
    this.deps.log?.(`[stash] 等待下一次擷取存檔(最多 ${Math.round(waitMs / 1000)} 秒)`)
    this.poke()
    return promise
  }

  /** 這次讀數量的像素區存檔(`readQuantities` 讀完後;值 / 原因 = 這個 tick 讀完的結果) */
  private dumpCapture (
    shown: { subtab: StashSubtab, yOffset: number, clientW: number, clientH: number },
    cap: ScanCapture,
    px: { data: Uint8Array, width: number, height: number, channels: number, x: number, y: number },
    rects: ReadonlyArray<{ refName: string }>,
    img: QtyRect[],
    crops: QtyRect[],
    masks: QtyRect[],
    st: QtyState,
    baseClientH: number
  ): void {
    const req = this.dumpReq
    const save = this.deps.saveDump
    if (!req || !save) return
    // 寫檔中不再觸發第二次存檔、也不會逾時(再按 = 新的請求)
    this.dumpReq = null
    req.stopTimer()
    const local = (r: QtyRect) => ({ x: r.x - px.x, y: r.y - px.y, w: r.w, h: r.h })
    const data: StashDumpData = {
      ts: this.clock.now(),
      subtab: shown.subtab,
      yOffset: shown.yOffset,
      client: { w: shown.clientW, h: shown.clientH },
      offset: { ...cap.offset },
      origin: { x: px.x, y: px.y },
      baseClientH,
      image: { data: px.data.slice(), width: px.width, height: px.height, channels: px.channels },
      masks: masks.map(m => ({ ...m })),
      cells: rects.map((r, i) => ({
        i,
        refName: r.refName,
        rect: local(img[i]),
        crop: local(crops[i]),
        value: st.values[i],
        pending: st.want.has(i),
        ...(st.cells[i].why ? { why: { ...st.cells[i].why! } } : {})
      }))
    }
    save(data).then(
      (file) => {
        this.deps.log?.(`[stash] 已存擷取畫面 ${file.split(/[\\/]/).pop()}`)
        req.finish({ ok: true, file })
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        this.deps.log?.(`[stash] 存擷取畫面失敗:${message}`)
        req.finish({ ok: false, reason: 'write-failed', message })
      }
    )
  }

  /** 熱鍵顯示模式已按熱鍵(等倉庫 / 顯示中) */
  get armed (): boolean { return this.isArmed }

  /** 熱鍵顯示模式:開始掃描(清差分基準、立刻重看;停用中也保留,啟用後的 `poke()` 就會掃描)。順便清掉使用者暫停 */
  arm (): void {
    this.isArmed = true
    this.armMisses = 0
    this.userPaused = false
    this.baseline = null
    this.deps.log?.('[stash] 熱鍵:開始偵測倉庫')
    this.poke()
  }

  /** 解除(不收疊層;收疊層走 `hotkeyPress` / `hide`) */
  disarm (): void {
    this.isArmed = false
    this.armMisses = 0
  }

  /** 熱鍵顯示模式按下熱鍵:顯示中 = 收起並解除;沒顯示 = `arm()` */
  hotkeyPress (): 'armed' | 'hidden' {
    if (this.shown) {
      this.deps.log?.('[stash] 熱鍵:收起倉庫價格')
      this.hide({ w: this.shown.clientW, h: this.shown.clientH })
      this.disarm()
      return 'hidden'
    }
    this.arm()
    return 'armed'
  }

  private hotkeyMode (): boolean { return this.deps.config().triggerMode === 'hotkey' }

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

  /**
   * 游標換格(main `StashCursor` 送 `stash-cursor`):renderer 會重畫徽章(只留停的那格 ↔ 畫回全部),這個重畫沒有 ack →
   * 固定等滿 `MASK_LINGER_MS` 才讀數量,免得截到「徽章已畫、遮罩未回報」的畫面把徽章上的價格讀成數量。
   * code review 第 2 輪:不因「收到一份遮罩報告」提早解除 —— 換格前就在路上的舊報告分不出來;renderer 重畫 + 回報約一幀,遠小於 300 ms,
   * 而游標停在格上本來就不讀,只多等這一段。(另一個做法是讓 renderer 回報帶 cursor 序號,但要改三個掃描層共用的遮罩回報器,不划算)
   */
  cursorMoved (): void {
    if (!this.shown) return
    this.cursorAt = this.clock.now()
  }

  /**
   * renderer 回報倉庫層遮罩(`scan-mask` source `stash`)。只有帶 seq(ack)且正在等 peek(徽章收起)時才排重看,
   * 並延後一個遮罩保留期(舊徽章外框還會再遮 `MASK_LINGER_MS`);其他報告不插 tick(瀏覽倉庫時報告很密,不可繞過掃描間隔)
   */
  maskReported (rep: { seq?: number }): void {
    if (rep.seq != null && this.qty?.peek) this.pokeIn(STASH_PEEK_REREAD_DELAY_MS)
  }

  private pokeIn (ms: number): void {
    if (!this.running || this.ticking) return
    this.schedule(ms)
  }

  /** 游標換格後還沒滿 `MASK_LINGER_MS` */
  private cursorSettling (): boolean {
    if (this.cursorAt == null) return false
    if (this.clock.now() - this.cursorAt >= MASK_LINGER_MS) { this.cursorAt = null; return false }
    return true
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
        // 熱鍵顯示模式這個 tick 剛解除(收起 / 沒偵測到倉庫)→ 同 not-armed,不再排(等下一次 arm)
        const hotkey = this.hotkeyMode()
        if (hotkey && !this.isArmed) {
          this.idleBlocked = true
          // 狀態列顯示「等待熱鍵」(不必再跑一次被擋的 tick)
          if (this.lastBlock !== 'not-armed') { this.lastBlock = 'not-armed'; this.deps.log?.('[stash] 暫停:not-armed') }
          return
        }
        const blockedDelay = res.kind === 'blocked' && res.retryMs != null ? Math.min(BLOCKED_FALLBACK_MS, res.retryMs) : BLOCKED_FALLBACK_MS
        const interval = clampScanInterval(this.deps.config().intervalMs)
        // 沒顯示時套閒置下限;熱鍵模式 armed(使用者剛按熱鍵在等倉庫)照設定間隔
        if (this.timer == null) this.schedule(blocked ? blockedDelay : this.shown || hotkey ? interval : Math.max(interval, STASH_IDLE_INTERVAL_MS))
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
    if (this.dumpReq) this.dumpReq.finish({ ok: false, reason: 'not-showing' })
    this.missStreak = 0
    this.holdStreak = 0
    // 熱鍵顯示模式:疊層收起(倉庫關掉 / 再按熱鍵 / 停止類原因)= 解除,下次要再按熱鍵
    if (this.isArmed && this.hotkeyMode()) this.disarm()
    this.emit('hide', client, ocrMs)
    return 'hide'
  }

  /** 一個 tick(測試直接呼叫) */
  async tick (): Promise<StashTickResult> {
    if (this.ticking) return { kind: 'overlap' }
    this.ticking = true
    this.counters.ticks++
    try {
      const res = await this.runTick()
      this.countArmMiss(res)
      return res
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.deps.log?.(`[stash] 掃描失敗:${message}`)
      return { kind: 'error', message }
    } finally {
      this.ticking = false
      this.inFlight = false
    }
  }

  /** 熱鍵顯示模式:armed 但這個 tick 結束時沒顯示(沒找到按鈕 / 畫面沒變 / 不是碎片頁)→ 累計;達上限解除並提示 */
  private countArmMiss (res: StashTickResult): void {
    if (!this.isArmed) return
    if (this.shown) { this.armMisses = 0; return }
    if (res.kind !== 'ocr' && res.kind !== 'unchanged') return
    if (!this.hotkeyMode()) return
    if (++this.armMisses < STASH_ARM_MISS_LIMIT) return
    this.disarm()
    this.deps.log?.(`[stash] 熱鍵:連續 ${STASH_ARM_MISS_LIMIT} 次沒有偵測到倉庫,停止偵測`)
    this.deps.onArmMiss?.()
  }

  /** 被擋下:記錄狀態(lastBlock / log / 計數)、作廢差分基準;停止類原因收掉疊層(暫停類留著) */
  private blockedResult (block: StashBlock, retryMs?: number): StashTickResult {
    if (block !== this.lastBlock) {
      this.deps.log?.(block === 'capture-black'
        ? '[stash] 暫停:capture-black(遊戲畫面擷取全黑,可能是全螢幕獨占;期滿 / 遊戲 attach / 視窗改變後再試)'
        : `[stash] 暫停:${block}`)
    }
    this.lastBlock = block
    this.blockCounts[block] = (this.blockCounts[block] ?? 0) + 1
    this.baseline = null
    if (STASH_CLEARING_BLOCKS.has(block) && this.shown) {
      this.hide({ w: this.shown.clientW, h: this.shown.clientH })
    }
    return retryMs != null ? { kind: 'blocked', block, retryMs } : { kind: 'blocked', block }
  }

  private async runTick (): Promise<StashTickResult> {
    const cfg = this.deps.config()
    const env = this.deps.env()
    const block = stashBlock(cfg, env, this.ui, this.userPaused, this.isArmed)
    if (block) return this.blockedResult(block)
    // overlay screenshot 全黑鎖存(全螢幕獨占):overlay 畫不出來,擷取只會走每次卡 main 300–480 ms 的 getSources → 不擷取
    const blackMs = this.deps.captureBlackMs?.() ?? 0
    if (blackMs > 0) return this.blockedResult('capture-black', blackMs)
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
    // 熱鍵顯示模式:await 期間收起 / 解除了 → 不畫
    if (cfg.triggerMode === 'hotkey' && !this.isArmed) return this.blockedResult('not-armed')
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
    if (!shown || cfg.readQuantity === false || !layouts || !templates || !cap.pixels) {
      this.qty = null
      if (this.dumpReq) this.dumpReq.finish({ ok: false, reason: cfg.readQuantity === false ? 'qty-off' : 'no-data' })
      return null
    }
    const key = `${shown.subtab}|${shown.yOffset}|${shown.clientW}x${shown.clientH}@${cap.offset.x},${cap.offset.y}`
    const rects = cellRects(layouts, shown.subtab, shown.clientH, shown.yOffset)
    if (fresh || this.qty?.key !== key) {
      this.qty = {
        key, cells: rects.map(() => ({})), values: rects.map(() => null), want: new Set(rects.keys()),
        peek: false, peekTries: 0, peekAt: 0, org: null, sentValues: null, sentPeek: false
      }
    }
    const st = this.qty!
    // 游標停在格上:遊戲說明框 / 游標上的物品可能蓋住格子 → 這次不讀也不更新基準(第一次顯示除外:打開倉庫的瞬間不會有說明框)
    if (!fresh && this.deps.qtyPaused?.()) { this.counters.qtyCursorSkips++; return null }
    // 游標剛換格:renderer 重畫的徽章可能還沒回報遮罩
    if (!fresh && this.cursorSettling()) { this.counters.qtyCursorSkips++; return null }

    const t0 = performance.now()
    // 影像座標(client − 擷取偏移);一次取整個格子區的像素
    const img = rects.map(r => ({ x: r.x - cap.offset.x, y: r.y - cap.offset.y, w: r.w, h: r.h }))
    const crops = img.map(r => qtyCropRect(r, shown.clientH, templates.baseClientH))
    const bx0 = Math.floor(Math.min(...crops.map(c => c.x))) - 2
    const by0 = Math.floor(Math.min(...crops.map(c => c.y))) - 2
    // 右界含漏讀檢查的延伸裁切(`QTY_PARAMS.extW` 基準像素):否則最右欄的三位數延伸區出界 → 永遠不確定
    const bx1 = Math.ceil(Math.max(...crops.map(c => c.x + c.w)) + QTY_PARAMS.extW * (shown.clientH / templates.baseClientH)) + 2
    const by1 = Math.ceil(Math.max(...crops.map(c => c.y + c.h))) + 2
    const px = cap.pixels({ x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 })
    if (st.org && (st.org.x !== px.x || st.org.y !== px.y)) {
      // 像素區原點變了:存的圖 / 數字帶座標作廢 → 全部重讀
      st.cells = rects.map(() => ({}))
      st.want = new Set(rects.keys())
    }
    st.org = { x: px.x, y: px.y }
    const local = (r: QtyRect): QtyRect => ({ x: r.x - px.x, y: r.y - px.y, w: r.w, h: r.h })
    const masks = (cap.maskRects ?? []).map(local)
    const hits = (list: readonly QtyRect[], r: QtyRect) => list.filter(m => m.x < r.x + r.w && r.x < m.x + m.w && m.y < r.y + r.h && r.y < m.y + m.h)
    let reads = 0
    let needPeek = false
    for (let i = 0; i < rects.length; i++) {
      const cell = local(img[i])
      const c = local(crops[i])
      const cs = st.cells[i]
      // 裁切區內的遮罩(徽章像素一律不算、也不拿來讀);蓋到數字帶才算「蓋住數字」
      const inCrop = hits(masks, c)
      const cur = qtyWhiteMap(px, cell, shown.clientH, templates.baseClientH)
      const sig = qtyMapSignature(cur, inCrop)
      if (hits(inCrop, cs.band ?? c).length) {
        this.counters.qtyMasked++
        // 被我們的徽章蓋住:不讀。露出的部分有變 → 數量可能改了 → 要 peek 重讀:
        // 同一組遮罩 → 比上次被遮時的簽章;剛被蓋住 / 遮罩換了位置 → 比上次乾淨讀數的字形(NCC,不受徽章陰影變暗影響)
        const mkey = inCrop.map(m => `${m.x},${m.y},${m.w},${m.h}`).join(';')
        // 停止字形比對的格(見 `QtyCell.shapeOff`):剛被蓋住時直接以被蓋住的狀態為新基準
        if (cs.masked && cs.masked.key === mkey) {
          if (qtySignatureChanged(cs.masked.sig, sig)) { st.want.add(i); cs.peekWant = true }
        } else if (!cs.clean || (!cs.shapeOff && qtyShapeChanged(cs.clean, cur, inCrop))) {
          st.want.add(i)
          if (cs.clean) cs.peekWant = true
        }
        cs.masked = { sig, key: mkey }
        if (st.want.has(i)) needPeek = true
        continue
      }
      cs.masked = undefined
      if (!st.want.has(i) && cs.clean && !qtySignatureChanged(qtyMapSignature(cs.clean, inCrop), sig)) continue
      const r = readCellQuantity(px, cell, templates, { clientH: shown.clientH, mask: inCrop })
      if (r.reason === 'masked') {
        // 數字延伸到遮罩底下(例如位數變多):當成蓋住,等 peek
        cs.band = r.band
        st.want.add(i)
        needPeek = true
        continue
      }
      // 空格只認 `empty`;單獨的 0、超出影像、不確定 → null
      const prev = st.values[i]
      const next = r.reason === 'ok' ? r.qty : r.reason === 'empty' ? 0 : null
      if (cs.peekWant) {
        // peek 重讀:值沒變 = 被遮時的比對誤判 → 停止這格的字形比對;連續 2 次沒讀到新數量(含讀不到)也停止
        const noNew = next === prev || next == null
        cs.peekNoChange = noNew ? (cs.peekNoChange ?? 0) + 1 : 0
        if (next === prev || cs.peekNoChange >= 2) cs.shapeOff = true
        else if (!noNew) cs.shapeOff = false
      } else if (next !== prev && next != null) {
        cs.shapeOff = false
        cs.peekNoChange = 0
      }
      cs.peekWant = false
      cs.why = next == null ? { reason: r.reason, raw: r.raw, confidence: r.confidence, margin: r.margin } : undefined
      st.values[i] = next
      cs.clean = cur
      cs.band = r.band
      st.want.delete(i)
      reads++
    }
    const ms = Math.round((performance.now() - t0) * 10) / 10
    if (needPeek) {
      if (!st.peek) {
        st.peek = true
        st.peekTries = 0
        st.peekAt = this.clock.now()
        this.counters.qtyPeeks++
      } else if (++st.peekTries > STASH_PEEK_LIMIT && this.clock.now() - st.peekAt > STASH_PEEK_TIMEOUT_MS) {
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
    if (this.dumpReq) this.dumpCapture(shown, cap, px, rects, img, crops, masks, st, templates.baseClientH)
    // 除錯記錄:讀不到的格與原因有變才寫一行(子頁 / 版面換了 = 狀態重建,也會重寫)
    const unread = stashUnreadSummary(rects, st.values, st.cells, st.want)
    const unreadKey = `${key}|${unread}`
    if (unreadKey !== this.lastUnreadLog) {
      this.lastUnreadLog = unreadKey
      if (unread) this.deps.log?.(`[stash] 數量未讀 ${unread.split(';').length} 格(${shown.subtab}):${unread}`)
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
