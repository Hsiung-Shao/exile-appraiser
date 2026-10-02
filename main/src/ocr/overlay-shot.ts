/**
 * exile-appraiser(效能修正第 17 步):OCR 擷取改用 electron-overlay-window 的 `OverlayController.screenshot()`。
 * 這個檔不 import electron(main vitest 可測);electron 端的接線在 `capture.ts`。
 *
 * `screenshot()`(原生 `windows.c` `ow_screenshot`):`GetDC(GetDesktopWindow())` → 32 bpp top-down `CreateDIBSection` →
 * `BitBlt SRCCOPY`,在呼叫執行緒同步完成,只擷取**目前 attach 的視窗的 client 區**(位置 = `ClientToScreen(hwnd)`、
 * 寬高 = 原生最後收到的 attach / moveresize bounds),回傳 BGRA Buffer(長度 = 寬 × 高 × 4)。非 win32 直接 throw。
 *
 * 為了讓辨識結果與 `desktopCapturer.getSources` 路徑相同:
 * - 裁切規則共用 `clientCropOnDisplay`:只留「含 client 中心點的那個螢幕」內的部分,`offset` = 影像左上在 client 內的位置
 *   (跨兩個螢幕 / 部分在螢幕外時與 getSources 路徑完全一致;BitBlt 對螢幕外的部分是黑的,也一併裁掉)。
 * - 任何一點不確定就退回 getSources(`OverlayShotFallback`):原生 throw、Buffer 長度不符、遊戲 bounds 與原生記得的不同、
 *   擷取結果全黑(全螢幕獨占 / 硬體 overlay 時 BitBlt 可能拿到黑畫面;用 `looksBlack` 抽樣判斷)。每種原因只記一次 log。
 * - code review 第 B 批:
 *   - 鎖存:同一原因(throw / size-mismatch / black)**連續** `LATCH_AFTER`(3)次 → 停用 overlay 路徑(直接 getSources,
 *     不再每 tick 先付一次同步 BitBlt + 整張 BGRA Buffer),直到 `reset()`(遊戲 attach)、bounds 改變、或 `LATCH_RETRY_MS`(30 秒)
 *     後再試一次(再失敗立刻再鎖 30 秒);成功一次就清掉連續計數。
 *   - bounds 不符:擷取前**重讀**原生的 bounds(`shotBounds()`)當這次擷取的 bounds(tick 開始到擷取之間視窗移動過 → 用現在的位置,
 *     結果的 `client` / `offset` 也照它算,呼叫端一律看結果不看傳入值);不再因此退回最慢的 getSources。
 */

export interface PhysRect { x: number, y: number, width: number, height: number }

/** 擷取結果(getSources 路徑與 overlay 路徑同形) */
export interface ClientCapture<I> {
  image: I
  /** 影像左上在 client 內的位置(遊戲視窗部分在螢幕外 / 跨螢幕時非 0) */
  offset: { x: number, y: number }
  client: { w: number, h: number }
}

/** NativeImage 用到的部分(測試給假的) */
export interface CropImage<I> {
  crop: (r: PhysRect) => I
}

export type OverlayShotFallback = 'throw' | 'bounds-mismatch' | 'size-mismatch' | 'black' | 'no-display'

/**
 * client 區落在螢幕 `display`(實體像素)內的部分,以**螢幕座標**表示(getSources 與 overlay 兩條路共用)。
 * 沒有交集回 null。
 */
export function clientCropOnDisplay (bounds: PhysRect, display: PhysRect): { x0: number, y0: number, x1: number, y1: number } | null {
  const x0 = Math.max(bounds.x, display.x)
  const y0 = Math.max(bounds.y, display.y)
  const x1 = Math.min(bounds.x + bounds.width, display.x + display.width)
  const y1 = Math.min(bounds.y + bounds.height, display.y + display.height)
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null
  return { x0, y0, x1, y1 }
}

/**
 * 含 client 中心點的螢幕;都不含時取重疊面積最大的;完全沒有重疊回 -1(`capture.ts` `pickDisplay` 與提示視窗選螢幕共用)。
 * `rects` = 各螢幕的實體像素矩形(順序 = `screen.getAllDisplays()`)。
 */
export function pickDisplayIndex (bounds: PhysRect, rects: readonly PhysRect[]): number {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  let best = -1
  let bestArea = 0
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]
    if (cx >= rect.x && cx < rect.x + rect.width && cy >= rect.y && cy < rect.y + rect.height) return i
    const ix = Math.max(0, Math.min(rect.x + rect.width, bounds.x + bounds.width) - Math.max(rect.x, bounds.x))
    const iy = Math.max(0, Math.min(rect.y + rect.height, bounds.y + bounds.height) - Math.max(rect.y, bounds.y))
    if (best < 0 || ix * iy > bestArea) { best = i; bestArea = ix * iy }
  }
  return best >= 0 && bestArea > 0 ? best : -1
}

/**
 * BGRA 影像某塊是不是「全黑」:在矩形內取 `cols × rows` 個等距點,B / G / R 全部 ≤ `maxLevel` 才算。
 * 只用來判斷 BitBlt 有沒有拿到畫面(全螢幕獨占、螢幕外都是 0);真實遊戲畫面就算很暗,576 個點全是 0 的機率極低,
 * 真的是全黑畫面(讀取畫面)退回 getSources 也只是多花一次擷取。
 */
export function looksBlack (bgra: Uint8Array, width: number, rect: PhysRect, cols = 32, rows = 18, maxLevel = 0): boolean {
  if (rect.width <= 0 || rect.height <= 0) return true
  for (let j = 0; j < rows; j++) {
    const y = rect.y + Math.min(rect.height - 1, Math.floor((j + 0.5) * rect.height / rows))
    for (let i = 0; i < cols; i++) {
      const x = rect.x + Math.min(rect.width - 1, Math.floor((i + 0.5) * rect.width / cols))
      const o = (y * width + x) * 4
      if (bgra[o] > maxLevel || bgra[o + 1] > maxLevel || bgra[o + 2] > maxLevel) return false
    }
  }
  return true
}

/**
 * 一次 overlay 擷取的決策(純函式):成功 → client 內要裁的矩形與 offset;失敗 → 退回原因。
 * `shotBounds` = 原生 `screenshot()` 用的 bounds(= `OverlayController.targetBounds`,與原生 `last_reported_bounds` 來自同一個事件)。
 */
export function planOverlayShot (
  bounds: PhysRect,
  shotBounds: PhysRect,
  display: PhysRect | null,
  bufLength: number
): { ok: true, crop: PhysRect, full: boolean, offset: { x: number, y: number } } | { ok: false, reason: OverlayShotFallback } {
  if (shotBounds.x !== bounds.x || shotBounds.y !== bounds.y || shotBounds.width !== bounds.width || shotBounds.height !== bounds.height) {
    return { ok: false, reason: 'bounds-mismatch' }
  }
  if (bufLength !== bounds.width * bounds.height * 4) return { ok: false, reason: 'size-mismatch' }
  const c = display ? clientCropOnDisplay(bounds, display) : null
  if (!c) return { ok: false, reason: 'no-display' }
  const crop = { x: c.x0 - bounds.x, y: c.y0 - bounds.y, width: c.x1 - c.x0, height: c.y1 - c.y0 }
  const full = crop.x === 0 && crop.y === 0 && crop.width === bounds.width && crop.height === bounds.height
  return { ok: true, crop, full, offset: { x: crop.x, y: crop.y } }
}

export interface OverlayCaptureDeps<I extends CropImage<I>> {
  /** `OverlayController.screenshot()`;省略 = 沒有 overlay(視窗模式)→ 一律 getSources */
  screenshot?: () => Buffer
  /** 原生擷取用的 bounds(`OverlayController.targetBounds`) */
  shotBounds: () => PhysRect
  /** 含 client 中心點的螢幕(實體像素);都不含時取重疊最大的;沒有重疊 null(= getSources 路徑的 `pickDisplay`) */
  display: (bounds: PhysRect) => PhysRect | null
  /** BGRA → 影像(`nativeImage.createFromBitmap`) */
  fromBitmap: (bgra: Buffer, width: number, height: number) => I
  /** 退回的擷取(getSources) */
  fallback: (bounds: PhysRect) => Promise<ClientCapture<I>>
  log?: (msg: string) => void
  /** 時鐘(鎖存 30 秒用;測試給假的) */
  now?: () => number
}

export interface GameClientCapture<I> {
  capture: (bounds: PhysRect) => Promise<ClientCapture<I>>
  /** 遊戲重新 attach:清掉鎖存與連續失敗計數,下一次擷取重新試 overlay 路徑 */
  reset: () => void
  /** log / 測試:overlay 成功次數、各原因的退回次數、鎖存期間直接走 getSources 的次數 */
  stats: { overlay: number, fallback: Partial<Record<OverlayShotFallback, number>>, latched: number }
  /** 測試:目前是否鎖存(停用 overlay 路徑)中 */
  readonly isLatched: boolean
}

/** 同一原因連續失敗幾次就停用 overlay 路徑 */
export const LATCH_AFTER = 3
/** 停用後多久再試一次 overlay 路徑 */
export const LATCH_RETRY_MS = 30_000
/** 會鎖存的原因(都是付過 / 會付 BitBlt 才知道失敗的;bounds-mismatch / no-display 不會連續發生在同一 bounds) */
const LATCHABLE: ReadonlySet<OverlayShotFallback> = new Set(['throw', 'size-mismatch', 'black'])

const rectKey = (r: PhysRect) => `${r.x},${r.y},${r.width}x${r.height}`

/** 擷取遊戲 client 區:先試 overlay `screenshot()`,不行就退回 getSources(每種原因只記一次 log;同原因連續 3 次鎖存) */
export function createGameClientCapture<I extends CropImage<I>> (deps: OverlayCaptureDeps<I>): GameClientCapture<I> {
  const now = deps.now ?? Date.now
  const logged = new Set<OverlayShotFallback>()
  const stats: GameClientCapture<I>['stats'] = { overlay: 0, fallback: {}, latched: 0 }
  /** 連續失敗(同一原因);換原因從 1 重算,成功清掉 */
  let streak: { reason: OverlayShotFallback, n: number } | null = null
  /** 鎖存中:鎖住時的 bounds 與時間 */
  let latch: { key: string, at: number, reason: OverlayShotFallback } | null = null
  const fall = (bounds: PhysRect, reason: OverlayShotFallback, detail?: string) => {
    stats.fallback[reason] = (stats.fallback[reason] ?? 0) + 1
    if (!logged.has(reason)) {
      logged.add(reason)
      deps.log?.(`[capture] overlay screenshot 不可用(${reason}${detail ? `:${detail}` : ''}),改用 desktopCapturer(同原因不再記錄)`)
    }
    if (LATCHABLE.has(reason)) {
      streak = streak?.reason === reason ? { reason, n: streak.n + 1 } : { reason, n: 1 }
      if (streak.n >= LATCH_AFTER) {
        latch = { key: rectKey(bounds), at: now(), reason }
        deps.log?.(`[capture] overlay screenshot 連續 ${streak.n} 次 ${reason} → 停用 ${LATCH_RETRY_MS / 1000} 秒(遊戲 attach / 視窗位置大小改變時立刻再試)`)
      }
    } else {
      streak = null
    }
    return deps.fallback(bounds)
  }
  const capture = async (requested: PhysRect): Promise<ClientCapture<I>> => {
    if (!(requested.width > 0 && requested.height > 0)) throw new Error('no-game-window')
    const shot = deps.screenshot
    if (!shot) return deps.fallback(requested)
    // 擷取前重讀原生記得的 bounds(tick 開始後視窗移動過 → 用現在的位置;無效時沿用傳入值,planOverlayShot 會判 bounds-mismatch)
    const sb = deps.shotBounds()
    const bounds = sb.width > 0 && sb.height > 0 ? { x: sb.x, y: sb.y, width: sb.width, height: sb.height } : requested
    if (latch) {
      if (latch.key !== rectKey(bounds)) {
        deps.log?.('[capture] 遊戲視窗位置 / 大小改變,重新試 overlay screenshot')
        latch = null
        streak = null
      } else if (now() - latch.at < LATCH_RETRY_MS && now() >= latch.at) {
        stats.latched++
        return deps.fallback(bounds)
      } else {
        // 期滿再試一次:再失敗一次就立刻重新鎖存
        streak = { reason: latch.reason, n: LATCH_AFTER - 1 }
        latch = null
      }
    }
    const display = deps.display(bounds)
    // 沒有任何螢幕含這個 client:getSources 路徑會 throw no-game-window,交給它(行為相同)
    if (!display) return deps.fallback(bounds)
    let buf: Buffer
    try {
      buf = shot()
    } catch (e) {
      return fall(bounds, 'throw', e instanceof Error ? e.message : String(e))
    }
    const plan = planOverlayShot(bounds, deps.shotBounds(), display, buf.length)
    if (!plan.ok) return fall(bounds, plan.reason)
    if (looksBlack(buf, bounds.width, plan.crop)) return fall(bounds, 'black')
    const img = deps.fromBitmap(buf, bounds.width, bounds.height)
    stats.overlay++
    streak = null
    return {
      image: plan.full ? img : img.crop(plan.crop),
      offset: plan.offset,
      client: { w: bounds.width, h: bounds.height }
    }
  }
  const reset = () => {
    if (latch) deps.log?.('[capture] 遊戲重新 attach,重新試 overlay screenshot')
    latch = null
    streak = null
  }
  return { capture, reset, stats, get isLatched () { return latch != null } }
}
