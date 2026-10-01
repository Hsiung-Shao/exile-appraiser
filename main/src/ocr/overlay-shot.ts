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
}

export interface GameClientCapture<I> {
  capture: (bounds: PhysRect) => Promise<ClientCapture<I>>
  /** log / 測試:overlay 成功次數、各原因的退回次數 */
  stats: { overlay: number, fallback: Partial<Record<OverlayShotFallback, number>> }
}

/** 擷取遊戲 client 區:先試 overlay `screenshot()`,不行就退回 getSources(每種原因只記一次 log) */
export function createGameClientCapture<I extends CropImage<I>> (deps: OverlayCaptureDeps<I>): GameClientCapture<I> {
  const logged = new Set<OverlayShotFallback>()
  const stats: GameClientCapture<I>['stats'] = { overlay: 0, fallback: {} }
  const fall = (bounds: PhysRect, reason: OverlayShotFallback, detail?: string) => {
    stats.fallback[reason] = (stats.fallback[reason] ?? 0) + 1
    if (!logged.has(reason)) {
      logged.add(reason)
      deps.log?.(`[capture] overlay screenshot 不可用(${reason}${detail ? `:${detail}` : ''}),改用 desktopCapturer(同原因不再記錄)`)
    }
    return deps.fallback(bounds)
  }
  const capture = async (bounds: PhysRect): Promise<ClientCapture<I>> => {
    if (!(bounds.width > 0 && bounds.height > 0)) throw new Error('no-game-window')
    const shot = deps.screenshot
    if (!shot) return deps.fallback(bounds)
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
    return {
      image: plan.full ? img : img.crop(plan.crop),
      offset: plan.offset,
      client: { w: bounds.width, h: bounds.height }
    }
  }
  return { capture, stats }
}
