/**
 * exile-appraiser(WP-S):擷取遊戲 client 區 + OCR 前處理(裁切 / 放大)。
 *
 * - 擷取用 `desktopCapturer` 的**整個螢幕**縮圖(`types: ['screen']`,thumbnailSize = 該螢幕實體像素),
 *   再用 `GameWindow.bounds`(electron-overlay-window 的 targetBounds = client 區的螢幕實體像素)減掉螢幕原點裁出 client 區。
 *   不用 window 縮圖:含邊框、位移不定。全螢幕獨占模式可能拿到黑畫面(docs/reveal-ocr.md,建議無邊框視窗)。
 * - 影像處理只用 Electron `nativeImage`(runtime 沒有 sharp)。
 */
import { desktopCapturer, screen, type Display, type NativeImage } from 'electron'
import type { OcrRegion } from '@ipc/types'
// 兩段式:幾何 / 倍率的純函式搬到 strategy.ts(不 import electron,main vitest 可測)
import { ocrScale, regionRect, type PhysRect, type RecognizeRect } from './strategy'
import type { WinOcr } from './WinOcr'
// WP-R2:符文塑形掃描的縮圖差分
import { FINGERPRINT_WIDTH, bgraToGray, type Fingerprint, type ScanCapture } from './runeshape-scan'

export { ocrScale, regionRect, type PhysRect }

/** 螢幕的實體像素矩形(`nativeOrigin` 是 Electron 新版才有的欄位;沒有就以 DIP × scaleFactor 推) */
export function displayPhysRect (d: Display): PhysRect {
  const origin = (d as Display & { nativeOrigin?: { x: number, y: number } }).nativeOrigin ??
    { x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor) }
  return {
    x: origin.x,
    y: origin.y,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor)
  }
}

/** 含 client 中心點的螢幕;都不含時取重疊面積最大的 */
function pickDisplay (bounds: PhysRect): { display: Display, rect: PhysRect } | null {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  let best: { display: Display, rect: PhysRect, area: number } | null = null
  for (const display of screen.getAllDisplays()) {
    const rect = displayPhysRect(display)
    if (cx >= rect.x && cx < rect.x + rect.width && cy >= rect.y && cy < rect.y + rect.height) return { display, rect }
    const ix = Math.max(0, Math.min(rect.x + rect.width, bounds.x + bounds.width) - Math.max(rect.x, bounds.x))
    const iy = Math.max(0, Math.min(rect.y + rect.height, bounds.y + bounds.height) - Math.max(rect.y, bounds.y))
    if (!best || ix * iy > best.area) best = { display, rect, area: ix * iy }
  }
  return best && best.area > 0 ? { display: best.display, rect: best.rect } : null
}

/** 擷取遊戲 client 區(回傳 client 實體像素大小的影像;跨出螢幕的部分裁掉,`offset` = 影像左上在 client 內的位置) */
export async function captureGameClient (bounds: PhysRect): Promise<{ image: NativeImage, offset: { x: number, y: number }, client: { w: number, h: number } }> {
  if (!(bounds.width > 0 && bounds.height > 0)) throw new Error('no-game-window')
  const picked = pickDisplay(bounds)
  if (!picked) throw new Error('no-game-window')
  const { display, rect } = picked
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: rect.width, height: rect.height },
    fetchWindowIcons: false
  })
  const source = sources.find(s => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined)
  if (!source || source.thumbnail.isEmpty()) throw new Error('capture-failed')
  const thumb = source.thumbnail
  const size = thumb.getSize()
  // 縮圖應等於實體大小;不等時(驅動 / 縮放怪況)按比例換算
  const sx = size.width / rect.width
  const sy = size.height / rect.height
  const x0 = Math.max(bounds.x, rect.x)
  const y0 = Math.max(bounds.y, rect.y)
  const x1 = Math.min(bounds.x + bounds.width, rect.x + rect.width)
  const y1 = Math.min(bounds.y + bounds.height, rect.y + rect.height)
  const crop = {
    x: Math.round((x0 - rect.x) * sx),
    y: Math.round((y0 - rect.y) * sy),
    width: Math.round((x1 - x0) * sx),
    height: Math.round((y1 - y0) * sy)
  }
  if (crop.width <= 0 || crop.height <= 0) throw new Error('capture-failed')
  let image = thumb.crop(crop)
  if (sx !== 1 || sy !== 1) image = image.resize({ width: x1 - x0, height: y1 - y0, quality: 'best' })
  return { image, offset: { x: x0 - bounds.x, y: y0 - bounds.y }, client: { w: bounds.width, h: bounds.height } }
}

/** JPEG 品質:放大後的白灰字邊緣 q95 仍逐字正確(--ocr-selftest 驗過);toPNG 對 5760×3240 要 1.3–1.6 秒,toJPEG 約 0.1 秒 */
export const OCR_JPEG_QUALITY = 95

/** 裁切 + 放大 → JPEG;`offset` = 裁切左上(影像像素),OCR 座標 ÷ scale + offset = 影像座標 */
export function prepare (img: NativeImage, region: OcrRegion | null | undefined, scale?: number): { image: Buffer, scale: number, offset: { x: number, y: number } } {
  const size = img.getSize()
  return prepareRect(img, regionRect({ w: size.width, h: size.height }, region), scale)
}

/** 兩段式:`smartRecognize` 用的「對影像某塊以某倍率 OCR」;行座標換回影像像素(÷ scale + 裁切偏移) */
export function rectRecognizer (img: NativeImage, ocr: () => WinOcr): RecognizeRect {
  return async (rect, scale) => {
    const prep = prepareRect(img, rect, scale)
    const res = await ocr().recognize(prep.image)
    return {
      ms: res.ms,
      lines: res.lines.map(l => ({
        text: l.text,
        x: l.x / prep.scale + prep.offset.x,
        y: l.y / prep.scale + prep.offset.y,
        w: l.w / prep.scale,
        h: l.h / prep.scale
      }))
    }
  }
}

/**
 * WP-R2:影像某塊 → 寬 `width` 的灰階縮圖(符文塑形掃描的變化偵測)。
 * `resize` 用 'good'(比 'best' 快;只拿來比對前後差異,不給 OCR)。
 */
export function grayFingerprint (img: NativeImage, rect: PhysRect, width = FINGERPRINT_WIDTH): Fingerprint {
  const size = img.getSize()
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y)))
  const r = {
    x,
    y,
    width: Math.max(1, Math.min(size.width - x, Math.round(rect.width))),
    height: Math.max(1, Math.min(size.height - y, Math.round(rect.height)))
  }
  const w = Math.max(1, Math.min(width, r.width))
  const h = Math.max(1, Math.round(r.height * w / r.width))
  const small = img.crop(r).resize({ width: w, height: h, quality: 'good' })
  const s = small.getSize()
  return bgraToGray(small.toBitmap(), s.width, s.height)
}

/** WP-R2:把一次擷取包成掃描迴圈要的形狀(`runeshape-scan.ts` 不碰 electron) */
export function toScanCapture (cap: { image: NativeImage, offset: { x: number, y: number }, client: { w: number, h: number } }, ocr: () => WinOcr): ScanCapture {
  const size = cap.image.getSize()
  return {
    size: { w: size.width, h: size.height },
    offset: cap.offset,
    client: cap.client,
    fingerprint: rect => grayFingerprint(cap.image, rect),
    recognize: rectRecognizer(cap.image, ocr)
  }
}

/** 兩段式:以影像像素矩形裁切(會夾在影像內)+ 放大 → JPEG;`scale` 省略 = `ocrScale` */
export function prepareRect (img: NativeImage, rect: PhysRect, scale?: number): { image: Buffer, scale: number, offset: { x: number, y: number } } {
  const size = img.getSize()
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y)))
  const r: PhysRect = {
    x,
    y,
    width: Math.max(1, Math.min(size.width - x, Math.round(rect.width))),
    height: Math.max(1, Math.min(size.height - y, Math.round(rect.height)))
  }
  const cropped = (r.x === 0 && r.y === 0 && r.width === size.width && r.height === size.height) ? img : img.crop(r)
  const s = scale ?? ocrScale(r.width, r.height)
  const scaled = s === 1 ? cropped : cropped.resize({ width: r.width * s, height: r.height * s, quality: 'best' })
  return { image: scaled.toJPEG(OCR_JPEG_QUALITY), scale: s, offset: { x: r.x, y: r.y } }
}
