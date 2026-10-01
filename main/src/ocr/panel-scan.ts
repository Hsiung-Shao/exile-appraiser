/**
 * exile-appraiser:遊戲畫面上某個面板的**持續掃描骨架**(不 import electron;main vitest 以假時鐘 / 假擷取測)。
 * 2026-10-01 由 WP-R2 的符文塑形掃描(`runeshape-scan.ts`)泛化而來;符文塑形與褻瀆(靈魂之井揭露面板,`reveal-scan.ts`)
 * 各注入自己的 `PanelDetector`,排程 / 暫停條件 / 變化偵測 / 自動定位快取 / 事件節奏都在這裡。
 *
 * 每 `intervalMs`(100–3000,預設 1000;上一次 tick 做完才排下一次)一次:
 *   啟用條件(`scanBlock`)→ 擷取遊戲 client(`captureGameClient`)→ 決定要看哪一塊:
 *     - **manual**:使用者框的區域(優先)。detector `regionFallback` = false(符文)時區域內沒找到面板也**不**改掃全畫面;
 *       = true(褻瀆)時連續 2 次區域內沒有面板 → 進入「退回自動定位」,直到區域的畫面**大幅**變化(或還沒找到面板且 2 秒沒看區域)才回到區域(2026-10-01 第 6 步前是「有變化」)。
 *     - **auto**(沒框區域 / 退回中):記憶體快取的面板區(鍵 = client 大小 + 擷取偏移)。沒有快取時每 `LOCATE_INTERVAL_MS`(3 秒)
 *       最多一次整個 client ×1 OCR → `detector.locate` → 外擴框存進快取;
 *       連續 `AUTO_MISS_LIMIT`(5)次在快取區找不到面板 → 清快取回到低頻定位;快取區有變化且距上次定位 ≥ 30 秒時順便重新定位。
 *   → **變化偵測**(區域縮成寬 64 的灰階縮圖,與上次 OCR 時的縮圖差分;沒變就不 OCR)
 *   → 有變化才 OCR(所有掃描共用同一個 `WinOcr` 行程;別的掃描正在跑 → 這個 tick 直接丟掉,不排隊);
 *     detector `verticalRetry`(符文):WinRT 把區域當成直書 → 同一塊 ×1 找面板 → 只裁面板 ×3 重辨識。
 *   → `detector.classify` 判定有沒有面板並挑出要送的行,廣播事件(座標 = client 實體像素)。
 * 連續 2 次 OCR 沒有面板 → 送空結果(renderer 清掉徽章)。
 *
 * 2026-10-01 效能修正第 6 步(只動排程 / 決策;辨識結果不變;「面板出現」那一刻照舊立即 OCR,docs/reveal-ocr.md「排程與退避」):
 *   - **大幅變化**(`isLargeChange`:縮圖切成 8×8 小塊,任一塊平均差 ≥ 6 或變動比例 ≥ 0.15;門檻依真實截圖推導,見常數註解)
 *     = 面板出現 / 淡入過半 / 換頁 / 鏡頭大幅移動。下面的退避遇到大幅變化一律立即 OCR / 定位並重置。
 *   - **手動區域沒有面板的退避**:送出空結果之後(連續第 2 次無列起),區域「有變化但不大」的 OCR 間隔指數拉長
 *     (掃描間隔 × 2、× 4…,上限 `IDLE_BACKOFF_MAX_MS` 2.5 秒);找到面板立刻回到原行為。
 *   - **褻瀆退回自動定位**:區域畫面**大幅**變化、或(退回中還沒找到面板且)距上次區域 OCR ≥ `FALLBACK_RECHECK_MS`(2 秒)才回到區域
 *     (原本「有變化就回來」,遊戲畫面一動就回去,自動定位永遠輪不到)。
 *   - **自動定位的退避**:沒快取時仍最多每 3 秒擷取一次;連續沒找到 → 定位間隔 3 → 6 → 12 → 15 秒(`locateGapMs`);整個 client 縮圖與
 *     上次定位時幾乎一樣(`isChanged` 為否)也跳過;距上次定位 ≥ `LOCATE_BACKOFF_MAX_MS`(15 秒)必跑;大幅變化立刻定位並重置。
 *   - **共用定位 OCR**(`SharedLocateOcr`,main 建一個給兩個掃描):同一 client 大小 / 擷取偏移 1 秒內的整個 client ×1 只跑一次。
 *   - 第 7 步:**共用擷取**(`SharedCapture`,main 建一個給兩個掃描):同一 client bounds 進行中的擷取一起等、完成後 100 ms 內直接用同一張
 *     (`desktopCapturer.getSources` 每次在 main 執行緒卡 300–480 ms,與縮圖大小無關,見 docs/reveal-ocr.md「擷取與 OCR 傳輸」)。
 *   - tick 一進來就設旗標(`ticking`):讀 tiers.json 的 await 期間 `poke()` 不會再開第二個 tick。
 *   - 與上次送出內容相同的 `rows`(列文字 + 四捨五入座標 + client + fallback)`REPEAT_ROWS_MS`(10 秒)內不重送;狀態轉換一律照送。
 *
 * 暫停(不送事件、保留徽章、清掉差分基準):遊戲不在前景、renderer 回報設定 / 框選層開著(detector `pauseOnPricePanel` 時查價面板開著也算)。
 * 停止(送一次空結果清徽章):停用、不是 PoE2、不是 overlay、沒有遊戲視窗、detector 資料讀不到、使用者按暫停熱鍵。
 * 不送任何鍵盤 / 滑鼠輸入。
 */
import type { OcrRegion, PanelScanEvent, PanelScanRow, RuneshapeStats, RuneshapeTimings, RuneshapeUiState } from '@ipc/types'
import type { OcrTextLine } from '../../../poe2/src/desecration/ocr-text'
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

/** 「大幅變化」看的小塊邊長(縮圖像素;寬 64 的縮圖 = 8 欄) */
export const LARGE_TILE = 8
/**
 * 「大幅變化」門檻(套在 `tileMaxDiff` 的**最大一塊**上)。2026-10-01 以真實截圖推導(`well-of-souls-fullscreen-02`,
 * 縮圖做法同 `grayFingerprint`:寬 64、灰階、單像素差 ≥ 16 算變動;「沒有面板」以同一張截圖的場景塊合成):
 * - 面板出現(整個面板 / 只有詞綴框、綠色 / 暗色背景、區域 = 面板 / 整個 client / 1300×1125 大框):最大一塊平均差 18.3–88.7、變動 0.63–1.0;
 *   **淡入一半**(詞綴框 50% 透明度,暗色背景,最難的情況)仍有 8.3–8.9 / 0.20–0.27。
 * - 鏡頭平移(同一場景位移):2 px 1.6–2.1 / ≤ 0.02、4 px 3.0–3.5 / ≤ 0.08、8 px 6.2–7.3 / 0.11–0.20、16 px 12–15 / 0.25–0.31。
 * → 取平均差 6 或變動 0.15:淡入一半的面板仍判為大幅(餘裕 39% / 35%);待機的小動畫(≤ 4 px)不算;跑動中的鏡頭(≥ 8 px)算大幅 = 照舊每次 OCR。
 * 整塊平均(`frameDiff`)會被面積稀釋(只有詞綴框出現時整個 client 平均差 0.6–2.7),所以看最大一塊。
 */
export const LARGE_DIFF_THRESHOLDS: DiffThresholds = { mean: 6, ratio: 0.15 }

/**
 * 縮圖切成 `tile`×`tile` 小塊,回傳**最大**的一塊平均差與變動比例(兩者各自取最大);邊緣不足半塊的小塊不算
 * (縮圖太小、一塊都湊不滿 → 退回整張 `frameDiff`)。大小不同 → null(當成大幅變化)。
 */
export function tileMaxDiff (a: Fingerprint, b: Fingerprint, tile = LARGE_TILE, pixelDelta = PIXEL_DELTA): { mean: number, changedRatio: number } | null {
  if (a.w !== b.w || a.h !== b.h || a.data.length !== b.data.length || !a.data.length) return null
  let bestMean = 0
  let bestRatio = 0
  let counted = 0
  for (let ty = 0; ty < a.h; ty += tile) {
    const y1 = Math.min(a.h, ty + tile)
    for (let tx = 0; tx < a.w; tx += tile) {
      const x1 = Math.min(a.w, tx + tile)
      const n = (x1 - tx) * (y1 - ty)
      if (n * 2 < tile * tile) continue
      let sum = 0
      let changed = 0
      for (let y = ty; y < y1; y++) {
        const row = y * a.w
        for (let x = tx; x < x1; x++) {
          const d = Math.abs(a.data[row + x] - b.data[row + x])
          sum += d
          if (d >= pixelDelta) changed++
        }
      }
      counted++
      if (sum / n > bestMean) bestMean = sum / n
      if (changed / n > bestRatio) bestRatio = changed / n
    }
  }
  if (!counted) return frameDiff(a, b, pixelDelta)
  return { mean: bestMean, changedRatio: bestRatio }
}

/** 大幅變化(面板出現 / 換頁 / 鏡頭大幅移動);沒有前一張 → 是 */
export function isLargeChange (prev: Fingerprint | null | undefined, cur: Fingerprint, th: DiffThresholds = LARGE_DIFF_THRESHOLDS): boolean {
  if (!prev) return true
  return isChanged(tileMaxDiff(prev, cur), th)
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
  | 'game-inactive' | 'ui-open' | 'no-data'

/** 這幾種「停止」要清掉畫面上的徽章;其餘(失焦、UI 開著)只是暫停,徽章留著 */
export const CLEARING_BLOCKS: ReadonlySet<ScanBlock> = new Set<ScanBlock>(['disabled', 'not-poe2', 'not-overlay', 'no-window', 'user-paused', 'no-data'])

/**
 * `pauseOnPricePanel`:查價面板開著要不要暫停(符文塑形 = 是,限流額度讓給一般查價;
 * 褻瀆 = 否,使用者看揭露面板時常同時開著查價面板)。設定視窗 / 框選層開著一律暫停。
 */
export function scanBlock (cfg: ScanConfig, env: ScanEnv, ui: RuneshapeUiState, userPaused: boolean, pauseOnPricePanel = true): ScanBlock | null {
  if (!cfg.enabled) return 'disabled'
  if (cfg.game !== 'poe2') return 'not-poe2'
  if (!env.overlay) return 'not-overlay'
  if (!env.bounds || !(env.bounds.width > 0 && env.bounds.height > 0)) return 'no-window'
  if (userPaused) return 'user-paused'
  if (!env.gameActive) return 'game-inactive'
  if ((pauseOnPricePanel && ui.panel) || ui.settings || ui.picker) return 'ui-open'
  return null
}

/**
 * 掃描間隔:100–3000 ms,預設 1000(與 renderer `clampRuneshapeInterval` 相同)。
 * 2026-10-01 使用者要求下限由 500 放寬到 100(設定頁 < 500 顯示 CPU 負擔提示);下一次 tick 在上一次做完後才排,不會重疊。
 */
export const DEFAULT_SCAN_INTERVAL_MS = 1000
export const SCAN_INTERVAL_MIN_MS = 100
export const SCAN_INTERVAL_MAX_MS = 3000
export function clampScanInterval (v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_SCAN_INTERVAL_MS
  return Math.min(SCAN_INTERVAL_MAX_MS, Math.max(SCAN_INTERVAL_MIN_MS, Math.round(v)))
}

/** 含 CJK 字的 OCR 行(數字 / 符號雜訊不算) */
const CJK_RE = /[㐀-鿿豈-﫿]/
export function isRowText (text: string): boolean {
  return CJK_RE.test(text)
}

// ---------------- 自動定位參數 ----------------

/** 沒有快取的面板區時,整個 client ×1 定位最多每 3 秒一次 */
export const LOCATE_INTERVAL_MS = 3000
/** 快取區連續 5 次找不到面板 → 清快取 */
export const AUTO_MISS_LIMIT = 5
/** 快取區有變化且距上次定位 ≥ 30 秒 → 順便重新定位(面板列數 / 位置變了) */
export const AUTO_REFRESH_MS = 30_000
/** 區域連續這麼多次 OCR 沒有面板(= 送出空結果那一次)→ detector 允許時退回自動定位 */
export const REGION_FALLBACK_AFTER = 2

/** 自動定位連續沒找到時的間隔上限;距上次定位超過這麼久必跑一次(畫面沒變也跑) */
export const LOCATE_BACKOFF_MAX_MS = 15_000
/** 自動定位連續沒找到 `misses` 次後,下一次定位至少隔多久:≤ 1 次 3 秒、2 次 6 秒、3 次 12 秒、之後 15 秒 */
export function locateGapMs (misses: number): number {
  if (misses <= 1) return LOCATE_INTERVAL_MS
  return Math.min(LOCATE_BACKOFF_MAX_MS, LOCATE_INTERVAL_MS * 2 ** (misses - 1))
}

/** 手動區域連續這麼多次 OCR 沒有列(= 已送出空結果)之後才開始退避(空結果的時機不變) */
export const IDLE_BACKOFF_AFTER = 2
/** 手動區域沒有面板時,「有變化但不大」的 OCR 最長間隔 */
export const IDLE_BACKOFF_MAX_MS = 2500
/** 手動區域連續 `idleOcrs` 次沒有列時,小 / 中變化下兩次 OCR 至少隔多久(0 = 不退避):掃描間隔 × 2、× 4…,上限 2.5 秒 */
export function idleGapMs (idleOcrs: number, intervalMs: number): number {
  if (idleOcrs < IDLE_BACKOFF_AFTER) return 0
  return Math.min(IDLE_BACKOFF_MAX_MS, intervalMs * 2 ** (idleOcrs - IDLE_BACKOFF_AFTER + 1))
}

/** 褻瀆退回自動定位中、還沒找到面板:距上次區域 OCR 這麼久就回區域再看一次(區域畫面大幅變化則立即回) */
export const FALLBACK_RECHECK_MS = 2000

/** 與上次送出內容完全相同的 `rows`:這段時間內不重送(過了照送一次,renderer 的查價興趣 / 耗時顯示不會停住) */
export const REPEAT_ROWS_MS = 10_000

/** 送出內容的簽章:列文字 + 四捨五入座標 + client 大小 + fallback(與上次相同 = 不重送) */
export function rowsSignature (rows: PanelScanRow[], client: { w: number, h: number }, fallback: boolean): string {
  let s = `${client.w}x${client.h}|${fallback ? 1 : 0}`
  for (const r of rows) s += `\n${r.text}\t${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`
  return s
}

/** 兩個掃描共用整個 client ×1 定位 OCR 的時間窗 */
export const SHARED_LOCATE_TTL_MS = 1000

/**
 * 褻瀆與符文塑形的自動定位都是「整個 client、×1、同一個 WinOcr(同語言)」→ 同一 client 大小 / 擷取偏移 / 影像大小
 * 在 `SHARED_LOCATE_TTL_MS` 內只 OCR 一次,另一方直接用那份行資料跑自己的 `detector.locate`(只決定裁切框;
 * 區域 OCR 仍在各自的擷取上做)。main 建一個傳給兩個掃描;沒給 = 各自定位(selftest / 測試)。
 */
export class SharedLocateOcr {
  private last: { key: string, at: number, lines: OcrTextLine[], ms: number } | null = null
  private pending: { key: string, p: Promise<{ lines: OcrTextLine[], ms: number }> } | null = null
  /** 測試 / log:實際 OCR 次數、重用次數 */
  runs = 0
  reuses = 0

  async recognize (cap: ScanCapture, now: number): Promise<{ lines: OcrTextLine[], ms: number, shared: boolean }> {
    const key = `${autoKey(cap)}|${cap.size.w}x${cap.size.h}`
    const copy = (lines: OcrTextLine[]) => lines.map(l => ({ ...l }))
    if (this.pending?.key === key) {
      const r = await this.pending.p
      this.reuses++
      return { lines: copy(r.lines), ms: r.ms, shared: true }
    }
    const last = this.last
    if (last && last.key === key && now >= last.at && now - last.at <= SHARED_LOCATE_TTL_MS) {
      this.reuses++
      return { lines: copy(last.lines), ms: last.ms, shared: true }
    }
    const p = cap.recognize({ x: 0, y: 0, width: cap.size.w, height: cap.size.h }, 1)
    this.pending = { key, p }
    try {
      const r = await p
      this.runs++
      this.last = { key, at: now, lines: r.lines, ms: r.ms }
      return { lines: copy(r.lines), ms: r.ms, shared: false }
    } finally {
      if (this.pending?.p === p) this.pending = null
    }
  }
}

/** 兩個掃描共用同一次擷取的時間窗(從擷取完成起算) */
export const SHARED_CAPTURE_TTL_MS = 100

/**
 * 效能修正第 7 步:褻瀆與符文塑形兩個掃描的擷取共用。同一個 client bounds(螢幕實體像素 x / y / 寬 / 高)
 * 正在擷取 → 一起等同一個 promise;擷取完成後 `SHARED_CAPTURE_TTL_MS`(100 ms)內再要 → 直接給同一張(`ScanCapture` 無狀態,
 * 縮圖 / OCR 都是對同一張影像的純運算)。bounds 不同、過了時間窗 → 重新擷取。擷取失敗不快取(進行中一起等的會拿到同一個錯誤)。
 * 時間窗過了就放掉影像參考(整個螢幕的影像不留在記憶體裡)。main 建一個給兩個掃描;selftest / 測試不經過這裡。
 */
export class SharedCapture {
  private readonly fn: (bounds: PhysRect) => Promise<ScanCapture>
  private readonly clock: ScanClock
  private readonly ttlMs: number
  private last: { key: string, at: number, cap: ScanCapture } | null = null
  private pending: { key: string, p: Promise<ScanCapture> } | null = null
  private dropTimer: unknown = null
  /** 測試 / log:實際擷取次數、共用次數 */
  runs = 0
  reuses = 0

  constructor (capture: (bounds: PhysRect) => Promise<ScanCapture>, opts: { clock?: ScanClock, ttlMs?: number } = {}) {
    this.fn = capture
    this.clock = opts.clock ?? REAL_CLOCK
    this.ttlMs = opts.ttlMs ?? SHARED_CAPTURE_TTL_MS
  }

  readonly capture = async (bounds: PhysRect): Promise<ScanCapture> => {
    const key = `${bounds.x},${bounds.y},${bounds.width}x${bounds.height}`
    if (this.pending?.key === key) {
      const cap = await this.pending.p
      this.reuses++
      return cap
    }
    const now = this.clock.now()
    const last = this.last
    if (last && last.key === key && now >= last.at && now - last.at <= this.ttlMs) {
      this.reuses++
      return last.cap
    }
    const p = this.fn(bounds)
    this.pending = { key, p }
    try {
      const cap = await p
      this.runs++
      this.last = { key, at: this.clock.now(), cap }
      if (this.dropTimer != null) this.clock.clearTimeout(this.dropTimer)
      const mine = this.last
      this.dropTimer = this.clock.setTimeout(() => {
        this.dropTimer = null
        if (this.last === mine) this.last = null
      }, this.ttlMs + 1)
      return cap
    } finally {
      if (this.pending?.p === p) this.pending = null
    }
  }
}

/** 自動定位快取的鍵:client 大小 + 擷取偏移(偏移變了影像座標就平移) */
export function autoKey (cap: { client: { w: number, h: number }, offset: { x: number, y: number } }): string {
  return `${cap.client.w}x${cap.client.h}@${cap.offset.x},${cap.offset.y}`
}

// ---------------- 面板偵測器(符文 / 褻瀆各一個) ----------------

export interface Rect { x: number, y: number, w: number, h: number }

export interface PanelDetector {
  /** log 前綴(`[runeshape]` / `[reveal-scan]`) */
  tag: string
  /** 資料就緒(褻瀆要 tiers.json 的模板索引);回 false → 停止(`no-data`)。省略 = 不需要資料 */
  ready?: () => Promise<boolean>
  /** 整個 client ×1 的 OCR 行裡找面板 → 外擴後的裁切框;找不到回 null */
  locate: (lines: OcrTextLine[], bounds: Rect) => { crop: Rect, count: number } | null
  /** 區域 OCR 的結果:有沒有面板、面板命中數、要送給 renderer 的行(沒有面板 → []) */
  classify: (lines: OcrTextLine[]) => { found: boolean, hits: number, rows: OcrTextLine[] }
  /** WinRT 直書重試(符文塑形面板實測會被當成直書) */
  verticalRetry?: (lines: OcrTextLine[]) => boolean
  /** 手動區域內沒找到面板 → 退回自動定位 */
  regionFallback: boolean
  /** 查價面板開著要不要暫停 */
  pauseOnPricePanel: boolean
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

export interface PanelScanDeps {
  clock?: ScanClock
  config: () => ScanConfig
  env: () => ScanEnv
  /** 別的掃描正在用共用的 WinOcr(忙碌就丟掉這個 tick) */
  ocrBusy: () => boolean
  capture: (bounds: PhysRect) => Promise<ScanCapture>
  send: (ev: PanelScanEvent) => void
  log?: (msg: string) => void
  thresholds?: DiffThresholds
  /** 兩個掃描共用的整個 client ×1 定位 OCR(main 傳同一個);省略 = 各自 OCR */
  locateOcr?: SharedLocateOcr
}

export type TickResult =
  | { kind: 'overlap' }
  | { kind: 'blocked', block: ScanBlock | 'region-outside' }
  | { kind: 'busy' }
  /** auto:還沒找到面板、離上次全畫面定位不到 `LOCATE_INTERVAL_MS` → 這個 tick 不擷取 */
  | { kind: 'locate-wait' }
  /** auto:已擷取,但整個 client 與上次定位時幾乎一樣(`unchanged`)或還在連續沒找到的退避中(`backoff`)→ 不定位 */
  | { kind: 'locate-skip', why: 'unchanged' | 'backoff' }
  /** auto:全畫面 ×1 定位沒找到面板 */
  | { kind: 'locate-miss', timings: RuneshapeTimings }
  | { kind: 'unchanged', mode: 'manual' | 'auto', rect: PhysRect, timings: RuneshapeTimings }
  /** manual:區域沒有面板、畫面有變化但不大 → 退避中,這個 tick 不 OCR(差分基準不動) */
  | { kind: 'backoff', mode: 'manual', rect: PhysRect, waitMs: number, timings: RuneshapeTimings }
  /** `deduped`:有列但與上次送出的完全相同 → 沒送(`sent` 為 null) */
  | { kind: 'ocr', mode: 'manual' | 'auto', rect: PhysRect, rows: number, panelRows: number, sent: PanelScanEvent['reason'] | null, deduped?: boolean, timings: RuneshapeTimings }
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

const rectKey = (cap: { client: { w: number, h: number }, offset: { x: number, y: number } }, r: PhysRect) =>
  `${cap.client.w}x${cap.client.h}@${cap.offset.x},${cap.offset.y}|${r.x},${r.y},${r.width},${r.height}`

export class PanelScan {
  private readonly deps: PanelScanDeps
  private readonly detector: PanelDetector
  private readonly clock: ScanClock
  private timer: unknown = null
  private running = false
  /** tick 進行中(含等 detector 資料);重入保護 */
  private ticking = false
  /** 擷取 / OCR 進行中(共用 WinOcr 的另一個掃描據此丟 tick) */
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
  /** auto:上次「該不該定位」的檢查(含退避跳過);沒快取時的擷取節流看它與 `lastLocateAt` 較晚者,跳過也維持最多每 3 秒擷取一次 */
  private lastLocateCheckAt = Number.NEGATIVE_INFINITY
  /** 最近一次 OCR 的區域有沒有面板(auto 在「畫面沒變」時據此累計找不到的次數) */
  private lastHadPanel = false
  private panel: RuneshapeStats['panel'] = 'unknown'
  private lastMode: 'manual' | 'auto' | null = null
  /** 直書重試裁出來的面板塊(鍵 = 區域鍵);只在記憶體 */
  private tight: { key: string, rect: PhysRect } | null = null
  /** regionFallback:手動區域沒找到面板 → 退回自動定位中;記住當時區域的縮圖,區域畫面大幅變了(或久沒看)就回到區域 */
  private fallback: { key: string, fp: Fingerprint } | null = null
  /** manual:連續幾次區域 OCR 沒有列(退避用;找到面板 / 大幅變化 / 暫停歸零) */
  private idleOcrs = 0
  /** 上次對手動區域 OCR 的時間(退避與褻瀆退回的「久沒看區域」) */
  private lastRegionOcrAt = Number.NEGATIVE_INFINITY
  /** auto:連續幾次自動定位沒找到(定位退避用) */
  private locateMissStreak = 0
  /** auto:上次自動定位時整個 client 的縮圖(與這次比:幾乎一樣就不定位、大幅變化就重置退避) */
  private locateFp: { key: string, fp: Fingerprint } | null = null
  /** 上次送出的 `rows` 簽章與時間(相同內容 `REPEAT_ROWS_MS` 內不重送);送過非 rows 的事件就清掉 */
  private rowsSig = ''
  private rowsSigAt = Number.NEGATIVE_INFINITY
  /** log:上一行 OCR 結果的鍵,與連續相同而略過的次數 */
  private lastLogKey = ''
  private logRepeats = 0
  /** 排程層的計數(不進設定頁統計;測試 / 診斷用) */
  readonly sched = { idleBackoffSkips: 0, locateSkips: 0, locateShared: 0, dedupedRows: 0 }
  readonly stats: Omit<RuneshapeStats, 'active' | 'reason' | 'avgCaptureMs' | 'avgOcrMs' | 'mode' | 'panel' | 'autoRegion' | 'fallback'> & { lastError?: string } = {
    ticks: 0, ocrRuns: 0, skippedUnchanged: 0, skippedBusy: 0, locates: 0, locateMisses: 0
  }

  constructor (deps: PanelScanDeps, detector: PanelDetector) {
    this.deps = deps
    this.detector = detector
    this.clock = deps.clock ?? REAL_CLOCK
  }

  private log (m: string) { (this.deps.log ?? console.log)(m) }
  private get tag (): string { return this.detector.tag }

  /** 掃描中(有 OCR 或擷取在跑);共用 WinOcr 的其他掃描據此丟掉自己的 tick */
  get busy (): boolean { return this.inFlight }

  /** 測試:tick 進行中(含等 detector 資料;`poke()` 此時不插隊) */
  get tickInProgress (): boolean { return this.ticking }

  get paused (): boolean { return this.userPaused }

  /** 測試 / selftest:目前的自動定位快取(影像像素) */
  get autoRegion (): PhysRect | null { return this.auto?.rect ?? null }

  /** 測試:手動區域目前退回自動定位中 */
  get fallingBack (): boolean { return this.fallback != null }

  /** `firstDelayMs`:第一個 tick 延後(兩個掃描同時開著時錯開半個間隔,輪流用 WinOcr) */
  start (firstDelayMs = 0): void {
    if (this.running) return
    this.running = true
    this.schedule(firstDelayMs)
  }

  stop (): void {
    this.running = false
    if (this.timer != null) { this.clock.clearTimeout(this.timer); this.timer = null }
  }

  /** 設定 / UI 狀態改了:不在 tick 中就立刻重新判斷一次(暫停 ↔ 繼續、停用時即時清徽章) */
  poke (): void {
    // tick 進行中(含 `det.ready()` 的 await)不插隊:那個 tick 做完會照常排下一次
    if (!this.running || this.ticking) return
    if (this.timer != null) this.clock.clearTimeout(this.timer)
    this.schedule(0)
  }

  /** 丟掉差分基準與「退回自動定位」狀態,下一個 tick 一定重新 OCR(框選確認後) */
  rescan (): void {
    this.baseline = null
    this.fallback = null
    this.emptyStreak = 0
    this.resetBackoff()
    this.poke()
  }

  /** 退避 / 重送判斷全部回到初始(暫停、框選確認、換模式後) */
  private resetBackoff () {
    this.idleOcrs = 0
    this.locateMissStreak = 0
    this.locateFp = null
    this.rowsSig = ''
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
    this.log(`${this.tag} 使用者${this.userPaused ? '暫停' : '繼續'}自動${this.detector.regionFallback ? '辨識' : '查價'}`)
    this.emit(this.userPaused ? 'user-paused' : 'user-resumed', [], { w: 0, h: 0 })
    this.shown = false
    this.poke()
    return this.userPaused
  }

  /** 設定頁的統計 */
  snapshot (): RuneshapeStats {
    const avg = (a: number[]) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : undefined
    const cfg = this.deps.config()
    const block = scanBlock(cfg, this.deps.env(), this.ui, this.userPaused, this.detector.pauseOnPricePanel)
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
    if (this.fallback) out.fallback = true
    const a = this.auto
    if ((mode === 'auto' || this.fallback) && a && a.client.w > 0 && a.client.h > 0) {
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

  /** 送事件;`rows` 與上次送出的完全相同且未滿 `REPEAT_ROWS_MS` → 不送,回 false。其他 reason(狀態轉換)一律送 */
  private emit (reason: PanelScanEvent['reason'], rows: PanelScanRow[], client: { w: number, h: number }, timings?: RuneshapeTimings, fallback = false): boolean {
    const t = this.clock.now()
    if (reason === 'rows') {
      const sig = rowsSignature(rows, client, fallback)
      if (sig === this.rowsSig && t - this.rowsSigAt < REPEAT_ROWS_MS) {
        this.sched.dedupedRows++
        return false
      }
      this.rowsSig = sig
      this.rowsSigAt = t
    } else {
      this.rowsSig = ''
    }
    const ev: PanelScanEvent = { seq: ++this.seq, ts: t, reason, rows, client }
    if (timings) ev.timings = timings
    if (fallback) ev.fallback = true
    this.deps.send(ev)
    return true
  }

  private clearShown (client: { w: number, h: number } = { w: 0, h: 0 }) {
    if (!this.shown) return
    this.emit('inactive', [], client)
    this.shown = false
  }

  private block (b: ScanBlock | 'region-outside'): TickResult {
    if (b !== this.lastBlock) this.log(`${this.tag} 不掃描:${b}`)
    this.lastBlock = b
    this.baseline = null
    this.emptyStreak = 0
    this.resetBackoff()
    if ((b === 'region-outside' || CLEARING_BLOCKS.has(b)) && b !== 'user-paused') this.clearShown()
    return { kind: 'blocked', block: b }
  }

  private dropAuto (why: string) {
    if (!this.auto) return
    this.log(`${this.tag} 自動定位快取作廢(${why}),回到每 ${LOCATE_INTERVAL_MS / 1000} 秒全畫面定位`)
    this.auto = null
    this.baseline = null
  }

  /** auto:整個影像 ×1 找面板;找到就存快取並回傳框。有 `locateOcr` 時 1 秒內與另一個掃描共用同一次 OCR */
  private async locate (cap: ScanCapture, why: string): Promise<{ rect: PhysRect | null, ms: number }> {
    const t = this.clock.now()
    this.lastLocateAt = t
    this.stats.locates++
    const full: PhysRect = { x: 0, y: 0, width: cap.size.w, height: cap.size.h }
    let lines: OcrTextLine[]
    let shared = false
    if (this.deps.locateOcr) {
      const r = await this.deps.locateOcr.recognize(cap, t)
      lines = r.lines
      shared = r.shared
      if (shared) this.sched.locateShared++
    } else {
      lines = (await cap.recognize(full, 1)).lines
    }
    const loc = this.detector.locate(lines, toRect(full))
    const ms = this.clock.now() - t
    const via = shared ? '(共用另一個掃描剛跑的 ×1 結果)' : ''
    if (!loc) {
      this.stats.locateMisses++
      this.log(`${this.tag} 自動定位(${why}):整張 ${cap.size.w}x${cap.size.h} ×1 ${ms} ms${via},${lines.length} 行,沒找到面板`)
      return { rect: null, ms }
    }
    const rect = toPhys(loc.crop)
    this.auto = { key: autoKey(cap), rect, client: cap.client, offset: cap.offset, misses: 0 }
    this.log(`${this.tag} 自動定位(${why}):整張 ×1 ${ms} ms${via},${loc.count} 行面板 → 區域 (${rect.x},${rect.y} ${rect.width}x${rect.height})`)
    return { rect, ms }
  }

  /**
   * auto 沒快取、已過 3 秒最小間隔:這次要不要真的定位。整個 client 縮圖與上次定位時比:
   * 大幅變化 → 定位並重置退避;距上次定位 ≥ 15 秒 → 定位;幾乎沒變 → 跳過;連續沒找到的退避未滿 → 跳過。
   */
  private locateSkip (key: string, fp: Fingerprint, t: number): 'unchanged' | 'backoff' | null {
    const prev = this.locateFp
    if (!prev || prev.key !== key) return null
    if (isLargeChange(prev.fp, fp)) {
      if (this.locateMissStreak > 1) this.log(`${this.tag} 畫面大幅變化,自動定位退避重置`)
      this.locateMissStreak = 0
      return null
    }
    const since = t - this.lastLocateAt
    if (since >= LOCATE_BACKOFF_MAX_MS) return null
    if (!isChanged(frameDiff(prev.fp, fp), this.deps.thresholds)) return 'unchanged'
    if (since < locateGapMs(this.locateMissStreak)) return 'backoff'
    return null
  }

  /** auto:這個 tick 看完區域仍沒有面板 → 累計;到上限清快取 */
  private autoMiss () {
    if (!this.auto) return
    this.auto.misses++
    if (this.auto.misses >= AUTO_MISS_LIMIT) this.dropAuto(`連續 ${AUTO_MISS_LIMIT} 次找不到面板`)
  }

  /**
   * 對區域 OCR;`verticalRetry`(符文)判定直書時改走 ×1 找面板 → 只裁那塊 ×3。
   * 裁切成功後記住(`tight`,鍵 = 區域鍵):同一個區域之後直接 OCR 那塊,只有那塊找不到面板 / 又變直書時才回到整個區域。
   */
  private async recognizeRows (cap: ScanCapture, rect: PhysRect, key: string, timings: RuneshapeTimings): Promise<{ lines: OcrTextLine[], ms: number }> {
    const vertical = this.detector.verticalRetry
    if (!vertical) {
      const r = await cap.recognize(rect, ocrScale(rect.width, rect.height))
      return { lines: r.lines, ms: r.ms }
    }
    let ms = 0
    if (this.tight?.key === key) {
      const t = this.tight.rect
      const r = await cap.recognize(t, ocrScale(t.width, t.height))
      ms += r.ms
      if (!vertical(r.lines) && this.detector.classify(r.lines).found) {
        timings.retry = 'vertical'
        return { lines: r.lines, ms }
      }
      this.tight = null
    }
    const res = await cap.recognize(rect, ocrScale(rect.width, rect.height))
    ms += res.ms
    if (!vertical(res.lines)) return { lines: res.lines, ms }
    timings.retry = 'vertical'
    const one = await cap.recognize(rect, 1)
    ms += one.ms
    const loc = this.detector.locate(one.lines, toRect(rect))
    if (!loc) {
      this.log(`${this.tag} 區域被 OCR 當成直書,×1 也找不到面板 → 用 ×1 的結果`)
      return { lines: one.lines, ms }
    }
    const crop = toPhys(loc.crop)
    const again = await cap.recognize(crop, ocrScale(crop.width, crop.height))
    ms += again.ms
    const stillVertical = vertical(again.lines)
    this.log(`${this.tag} 區域被 OCR 當成直書 → ×1 找到 ${loc.count} 列,裁 (${crop.x},${crop.y} ${crop.width}x${crop.height}) 重辨識${stillVertical ? '仍是直書,改用 ×1 結果' : ',之後同一區域直接用這塊'}`)
    if (stillVertical) return { lines: one.lines, ms }
    this.tight = { key, rect: crop }
    return { lines: again.lines, ms }
  }

  /** 一次掃描(計時器呼叫;測試直接呼叫)。進入即設 `ticking`,上一個還沒做完(含等 detector 資料)→ overlap */
  async tick (): Promise<TickResult> {
    if (this.ticking) return { kind: 'overlap' }
    this.ticking = true
    try {
      return await this.runTick()
    } finally {
      this.ticking = false
    }
  }

  private async runTick (): Promise<TickResult> {
    this.stats.ticks++
    const cfg = this.deps.config()
    const env = this.deps.env()
    const det = this.detector
    const b = scanBlock(cfg, env, this.ui, this.userPaused, det.pauseOnPricePanel)
    if (b) return this.block(b)
    if (det.ready && !(await det.ready())) return this.block('no-data')
    const mode = cfg.region ? 'manual' : 'auto'
    if (this.lastBlock != null || this.lastMode !== mode) {
      this.log(`${this.tag} 開始掃描(間隔 ${clampScanInterval(cfg.intervalMs)} ms,${mode === 'manual' ? `手動區域 ${JSON.stringify(cfg.region)}` : '自動定位面板'})`)
    }
    this.lastBlock = null
    if (this.lastMode !== mode) {
      this.lastMode = mode
      this.panel = 'unknown'
      this.lastHadPanel = false
      this.fallback = null
      this.resetBackoff()
      if (mode === 'manual') this.auto = null
    }
    if (this.deps.ocrBusy()) {
      this.stats.skippedBusy++
      return { kind: 'busy' }
    }
    const now = this.clock.now
    // 這個 tick 實際看哪一種區域:手動區域退回自動定位中 = auto
    let eff: 'manual' | 'auto' = mode === 'manual' && this.fallback ? 'auto' : mode
    // auto 且沒有快取:低頻定位,沒到時間連擷取都不做
    if (eff === 'auto' && !this.auto && now() - Math.max(this.lastLocateAt, this.lastLocateCheckAt) < LOCATE_INTERVAL_MS) return { kind: 'locate-wait' }
    this.inFlight = true
    const t0 = now()
    try {
      const cap = await this.deps.capture(env.bounds!)
      const captureMs = now() - t0
      this.pushHist(this.capHist, captureMs)
      let rect: PhysRect | null = null
      let regionRect: PhysRect | null = null
      if (mode === 'manual') {
        regionRect = regionSearchRect(cap.size, cfg.region, cap)
        if (!regionRect) {
          if (!det.regionFallback) return this.block('region-outside')
          eff = 'auto'
        } else if (this.fallback) {
          // 退回自動定位中:區域的畫面**大幅**變了(面板可能出現在區域裡了)→ 立刻回到區域;
          // 還沒找到面板且久沒看區域 → 回去再看一次。小變化(遊戲畫面在動)不回,讓自動定位有機會跑
          const fpR = cap.fingerprint(regionRect)
          const k = rectKey(cap, regionRect)
          const large = this.fallback.key !== k || isLargeChange(this.fallback.fp, fpR)
          const recheck = !this.lastHadPanel && now() - this.lastRegionOcrAt >= FALLBACK_RECHECK_MS
          if (large || recheck) {
            this.log(`${this.tag} ${large ? '區域的畫面大幅變化' : `退回自動定位 ${FALLBACK_RECHECK_MS / 1000} 秒仍沒找到面板`},回到手動區域`)
            this.fallback = null
            this.baseline = null
            this.emptyStreak = 0
            if (large) this.idleOcrs = 0
            eff = 'manual'
          }
        } else {
          eff = 'manual'
        }
      }
      const timings: RuneshapeTimings = { captureMs, diffMs: 0, totalMs: 0, mode: eff }
      if (eff === 'manual') {
        rect = regionRect!
      } else {
        if (this.auto && this.auto.key !== autoKey(cap)) this.dropAuto(`遊戲畫面大小 / 位置變了(${autoKey(cap)})`)
        if (this.auto) {
          rect = this.auto.rect
        } else {
          // 手動區域剛退回、還沒到低頻定位的時間(純 auto 已在擷取前擋掉)
          if (now() - Math.max(this.lastLocateAt, this.lastLocateCheckAt) < LOCATE_INTERVAL_MS) return { kind: 'locate-wait' }
          // 定位退避:整個 client 幾乎沒變 / 連續沒找到 → 這次不定位(大幅變化、滿 15 秒照跑)
          const ak = autoKey(cap)
          const fpFull = cap.fingerprint({ x: 0, y: 0, width: cap.size.w, height: cap.size.h })
          const skip = this.locateSkip(ak, fpFull, now())
          if (skip) {
            this.lastLocateCheckAt = now()
            this.sched.locateSkips++
            return { kind: 'locate-skip', why: skip }
          }
          const loc = await this.locate(cap, '尋找面板')
          timings.locateMs = loc.ms
          this.locateFp = { key: ak, fp: fpFull }
          if (loc.rect) {
            this.locateMissStreak = 0
          } else {
            this.locateMissStreak++
            if (this.locateMissStreak >= 2) this.log(`${this.tag} 自動定位連續 ${this.locateMissStreak} 次沒找到,下一次至少隔 ${locateGapMs(this.locateMissStreak) / 1000} 秒(畫面大幅變化立即定位)`)
          }
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
      const key = rectKey(cap, rect)
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
        if (eff === 'auto' && !this.lastHadPanel) this.autoMiss()
        return { kind: 'unchanged', mode: eff, rect, timings }
      }
      // 手動區域沒有面板(已送出空結果)時的退避:有變化但不大 → 拉長 OCR 間隔(差分基準不動,下次仍與上次 OCR 的畫面比);
      // 大幅變化(面板出現 / 淡入過半 / 換頁)→ 立即 OCR 並重置
      if (eff === 'manual' && base && this.idleOcrs >= IDLE_BACKOFF_AFTER) {
        if (isLargeChange(base, fp)) {
          this.idleOcrs = 0
        } else {
          const waitMs = idleGapMs(this.idleOcrs, clampScanInterval(cfg.intervalMs))
          if (now() - this.lastRegionOcrAt < waitMs) {
            timings.totalMs = now() - t0
            this.stats.last = timings
            this.sched.idleBackoffSkips++
            return { kind: 'backoff', mode: 'manual', rect, waitMs, timings }
          }
        }
      }
      // 擷取期間別的掃描開始辨識了 → 讓它先(不設基準,下一個 tick 重來)
      if (this.deps.ocrBusy()) {
        this.stats.skippedBusy++
        return { kind: 'busy' }
      }
      // auto:快取區有變化且久沒定位 → 重新定位(面板變高 / 移位);沒找到就沿用舊快取
      if (eff === 'auto' && timings.locateMs == null && now() - this.lastLocateAt >= AUTO_REFRESH_MS) {
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
      if (eff === 'manual') this.lastRegionOcrAt = t2
      const newKey = rectKey(cap, rect)
      const res = await this.recognizeRows(cap, rect, newKey, timings)
      timings.ocrWallMs = now() - t2
      timings.ocrMs = res.ms
      timings.totalMs = now() - t0
      this.pushHist(this.ocrHist, timings.ocrWallMs)
      this.stats.ocrRuns++
      this.stats.last = timings
      this.lastErrorKind = ''
      const cls = det.classify(res.lines)
      const panelRows = cls.hits
      const rows: PanelScanRow[] = cls.found
        ? cls.rows.map(l => ({ text: l.text, x: l.x + cap.offset.x, y: l.y + cap.offset.y, w: l.w, h: l.h }))
        : []
      this.panel = cls.found ? 'found' : 'not-found'
      this.lastHadPanel = cls.found
      if (eff === 'auto') {
        if (cls.found && this.auto) this.auto.misses = 0
        else if (!cls.found) this.autoMiss()
      } else {
        this.idleOcrs = rows.length ? 0 : this.idleOcrs + 1
      }
      const viaFallback = mode === 'manual' && eff === 'auto'
      // log:結果與上一行相同(同樣的列 / 同樣沒有列)不重複印,下次不同時附上略過次數
      const logKey = `${eff}|${viaFallback ? 1 : 0}|${panelRows}|${rows.length ? rowsSignature(rows, cap.client, viaFallback) : `0/${res.lines.length}`}`
      if (logKey !== this.lastLogKey) {
        const d = timings.diff ? `差分 ${timings.diff.mean}/${(timings.diff.changedRatio * 100).toFixed(2)}%` : '無基準'
        this.log(`${this.tag} #${this.seq + 1} ${eff}${viaFallback ? '(區域退回)' : ''} 區域 ${rect.width}x${rect.height} ×${ocrScale(rect.width, rect.height)}:擷取 ${captureMs} ms、` +
          `${timings.locateMs != null ? `定位 ${timings.locateMs} ms、` : ''}${d}(${timings.diffMs} ms)、OCR ${timings.ocrWallMs} ms(行程內 ${res.ms}${timings.retry ? ',直書重試' : ''})、` +
          `總計 ${timings.totalMs} ms;${res.lines.length} 行 → ${rows.length} 列(面板命中 ${panelRows})` +
          `${this.logRepeats ? `;其間 ${this.logRepeats} 次結果與前一行相同未記` : ''}`)
        this.lastLogKey = logKey
        this.logRepeats = 0
      } else {
        this.logRepeats++
      }
      if (rows.length) {
        this.baseline = { key: newKey, fp }
        this.emptyStreak = 0
        this.shown = true
        const sent = this.emit('rows', rows, cap.client, timings, viaFallback)
        return sent
          ? { kind: 'ocr', mode: eff, rect, rows: rows.length, panelRows, sent: 'rows', timings }
          : { kind: 'ocr', mode: eff, rect, rows: rows.length, panelRows, sent: null, deduped: true, timings }
      }
      // 沒有列:第 1 次不設基準(下一個 tick 一定再 OCR 一次確認),連續第 2 次才送空結果並設基準
      this.emptyStreak++
      if (this.emptyStreak >= 2) {
        // auto 快取剛被清掉 → 基準也不留(下一次換新區域)
        this.baseline = eff === 'auto' && !this.auto ? null : { key: newKey, fp }
        if (this.emptyStreak === 2) {
          this.emit('empty', [], cap.client, timings, viaFallback)
          this.shown = false
          // 手動區域確定沒有面板 → detector 允許時退回自動定位(記住區域畫面,變了就回來)
          if (eff === 'manual' && det.regionFallback && this.emptyStreak >= REGION_FALLBACK_AFTER) {
            this.fallback = { key: newKey, fp }
            this.baseline = null
            this.emptyStreak = 0
            this.log(`${this.tag} 區域內沒找到面板,改用自動定位(區域畫面有變化時回到區域)`)
          }
          return { kind: 'ocr', mode: eff, rect, rows: 0, panelRows, sent: 'empty', timings }
        }
      } else {
        this.baseline = null
      }
      return { kind: 'ocr', mode: eff, rect, rows: 0, panelRows, sent: null, timings }
    } catch (e) {
      const message = e instanceof Error ? `${(e as { kind?: string }).kind ?? ''} ${e.message}`.trim() : String(e)
      this.stats.lastError = message
      // 同一種錯誤只記一次(缺語言包時每秒一行太吵)
      if (message !== this.lastErrorKind) this.log(`${this.tag} 失敗:${message}`)
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
