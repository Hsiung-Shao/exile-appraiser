/**
 * exile-appraiser(WP-S):擷取遊戲 client 區 + OCR 前處理(裁切 / 放大)。
 *
 * - 擷取(第 17 步起)先用 electron-overlay-window 的 `OverlayController.screenshot()`(原生 BitBlt 遊戲 client 區,同步、2560×1369 約 17–49 ms),
 *   不行(throw / 尺寸不符 / 全黑 / 視窗模式)才退回 `desktopCapturer` 的**整個螢幕**縮圖(`captureGameClientViaSources`,
 *   每次卡 main 300–600 ms)。兩條路裁切規則相同(`clientCropOnDisplay`),送進 OCR 的像素逐位元相同(docs/reveal-ocr.md「擷取與 OCR 傳輸」)。
 * - getSources 路徑:`types: ['screen']`,thumbnailSize = 該螢幕實體像素,
 *   再用 `GameWindow.bounds`(electron-overlay-window 的 targetBounds = client 區的螢幕實體像素)減掉螢幕原點裁出 client 區。
 *   不用 window 縮圖:含邊框、位移不定。全螢幕獨占模式可能拿到黑畫面(docs/reveal-ocr.md,建議無邊框視窗)。
 * - 影像處理只用 Electron `nativeImage`(runtime 沒有 sharp)。
 */
import { desktopCapturer, nativeImage, screen, type Display, type NativeImage } from 'electron'
import type { OcrRegion } from '@ipc/types'
// 兩段式:幾何 / 倍率的純函式搬到 strategy.ts(不 import electron,main vitest 可測)
import { ocrScale, regionRect, type PhysRect, type RecognizeRect } from './strategy'
import type { WinOcr } from './WinOcr'
// 第 17 步:overlay 原生擷取(決策是純函式,main vitest 可測)
import { clientCropOnDisplay, createGameClientCapture, type ClientCapture, type GameClientCapture } from './overlay-shot'
// WP-R2:面板掃描(符文塑形 / 褻瀆)的縮圖差分
import { FINGERPRINT_WIDTH, bgraToGray, type Fingerprint, type ScanCapture } from './panel-scan'
// 第 18 步:遮掉我們自己畫在遊戲上的徽章 / 提示(擷取後、OCR / 差分前)
import { clipRects, fillMaskRects, fingerprintIgnore, type MaskRect } from './scan-mask'

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
export function pickDisplay (bounds: PhysRect): { display: Display, rect: PhysRect } | null {
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

/**
 * 擷取遊戲 client 區(desktopCapturer 整個螢幕縮圖;回傳 client 實體像素大小的影像;跨出螢幕的部分裁掉,`offset` = 影像左上在 client 內的位置)。
 * 第 17 步起是 overlay `screenshot()` 的後援(`createGameClientCapture`)。
 */
export async function captureGameClientViaSources (bounds: PhysRect): Promise<ClientCapture<NativeImage>> {
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
  const c = clientCropOnDisplay(bounds, rect)
  if (!c) throw new Error('capture-failed')
  const { x0, y0, x1, y1 } = c
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

/**
 * 第 17 步:OCR 掃描用的擷取(main 建一個給 `SharedCapture`)。`screenshot` = `OverlayController.screenshot()`
 * (overlay 模式才有;視窗模式不傳 → 一律 getSources,反正掃描在視窗模式不跑),`shotBounds` = `OverlayController.targetBounds`。
 * 原生 BGRA 直接 `nativeImage.createFromBitmap`(實測 BitBlt 的 alpha 全是 255;fixture 比對送進 OCR 的 JPEG 與 getSources 路徑逐位元組相同,docs/reveal-ocr.md「擷取與 OCR 傳輸」)。
 */
export function createOverlayClientCapture (opts: {
  screenshot?: () => Buffer
  shotBounds: () => PhysRect
  log?: (msg: string) => void
}): GameClientCapture<NativeImage> {
  return createGameClientCapture<NativeImage>({
    screenshot: opts.screenshot,
    shotBounds: opts.shotBounds,
    display: b => pickDisplay(b)?.rect ?? null,
    fromBitmap: (buf, width, height) => nativeImage.createFromBitmap(buf, { width, height }),
    fallback: captureGameClientViaSources,
    log: opts.log
  })
}

/**
 * JPEG 品質:放大後的白灰字邊緣 q95 仍逐字正確(--ocr-selftest 驗過);toPNG 對 5760×3240 要 1.3–1.6 秒,toJPEG 約 0.1 秒。
 * 效能修正第 7 步評估過把放大 / JPEG 移出 main 執行緒,都會改變 OCR 結果而不採用(docs/reveal-ocr.md「擷取與 OCR 傳輸」):
 * 送 ×1 給 PowerShell 用 `BitmapTransform` 放大(Cubic / Fant / Linear / NearestNeighbor 四種)、甚至同一張 'best' 放大圖改送無損 BMP,
 * 辨識文字都會變;utilityProcess / worker 沒有 `nativeImage`,換別的縮放 / 編碼器位元組必不同。→ 維持 `resize({ quality: 'best' })` + `toJPEG(95)`。
 */
export const OCR_JPEG_QUALITY = 95

/** 裁切 + 放大 → JPEG;`offset` = 裁切左上(影像像素),OCR 座標 ÷ scale + offset = 影像座標 */
export function prepare (img: NativeImage, region: OcrRegion | null | undefined, scale?: number): { image: Buffer, scale: number, offset: { x: number, y: number } } {
  const size = img.getSize()
  return prepareRect(img, regionRect({ w: size.width, h: size.height }, region), scale)
}

/**
 * 兩段式:`smartRecognize` 用的「對影像某塊以某倍率 OCR」;行座標換回影像像素(÷ scale + 裁切偏移)。
 * 第 18 步 `mask`:影像像素的遮罩矩形(徽章等),裁切後、放大前填掉(`prepareRect`)。
 */
export function rectRecognizer (img: NativeImage, ocr: () => WinOcr, mask?: MaskRect[]): RecognizeRect {
  return async (rect, scale) => {
    const prep = prepareRect(img, rect, scale, mask)
    // 第 7 步:只要行(掃描 / smartRecognize 都不看 words)→ 腳本不輸出 words
    const res = await ocr().recognize(prep.image, { words: false })
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
 * 第 18 步 `mask`:遮罩蓋到的縮圖像素標成不比(`Fingerprint.ignore`;縮圖本身不填色)。
 */
export function grayFingerprint (img: NativeImage, rect: PhysRect, width = FINGERPRINT_WIDTH, mask?: MaskRect[]): Fingerprint {
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
  const fp = bgraToGray(small.toBitmap(), s.width, s.height)
  const ign = mask?.length ? fingerprintIgnore(mask, r, s.width, s.height) : undefined
  if (ign) fp.ignore = ign
  return fp
}

/**
 * WP-R2:把一次擷取包成掃描迴圈要的形狀(`runeshape-scan.ts` 不碰 electron)。
 * 第 18 步 `mask`:這次擷取要遮掉的矩形(影像像素,main `ScanMaskStore.imageRects` 在擷取當下算好);空 / 省略 = 與之前完全相同。
 */
export function toScanCapture (cap: { image: NativeImage, offset: { x: number, y: number }, client: { w: number, h: number } }, ocr: () => WinOcr, mask?: MaskRect[]): ScanCapture {
  const size = cap.image.getSize()
  const m = mask?.length ? mask : undefined
  return {
    size: { w: size.width, h: size.height },
    offset: cap.offset,
    client: cap.client,
    fingerprint: rect => grayFingerprint(cap.image, rect, FINGERPRINT_WIDTH, m),
    recognize: rectRecognizer(cap.image, ocr, m),
    masked: m?.length ?? 0
  }
}

/**
 * 兩段式:以影像像素矩形裁切(會夾在影像內)+ 放大 → JPEG;`scale` 省略 = `ocrScale`。
 * 第 18 步 `mask`(影像像素):與裁切塊有交集時,裁切後先把那幾塊填掉(`fillMaskRects`,外緣中位色 + 邊緣漸變)再放大;
 * 沒有交集 → 影像位元組與之前完全相同(不經 toBitmap / createFromBitmap)。
 */
export function prepareRect (img: NativeImage, rect: PhysRect, scale?: number, mask?: MaskRect[]): { image: Buffer, scale: number, offset: { x: number, y: number } } {
  const size = img.getSize()
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y)))
  const r: PhysRect = {
    x,
    y,
    width: Math.max(1, Math.min(size.width - x, Math.round(rect.width))),
    height: Math.max(1, Math.min(size.height - y, Math.round(rect.height)))
  }
  let cropped = (r.x === 0 && r.y === 0 && r.width === size.width && r.height === size.height) ? img : img.crop(r)
  const local = mask?.length ? clipRects(mask.map(m => ({ x: m.x - r.x, y: m.y - r.y, w: m.w, h: m.h })), r.width, r.height) : []
  if (local.length) {
    const bmp = cropped.toBitmap()
    // 點陣大小與裁切塊不符(不該發生;縮放因子怪況)→ 不遮,照原圖
    if (bmp.length === r.width * r.height * 4) {
      fillMaskRects(bmp, r.width, r.height, local)
      cropped = nativeImage.createFromBitmap(bmp, { width: r.width, height: r.height })
    }
  }
  const s = scale ?? ocrScale(r.width, r.height)
  const scaled = s === 1 ? cropped : cropped.resize({ width: r.width * s, height: r.height * s, quality: 'best' })
  return { image: scaled.toJPEG(OCR_JPEG_QUALITY), scale: s, offset: { x: r.x, y: r.y } }
}
