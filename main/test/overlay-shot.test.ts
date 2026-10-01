// 效能修正第 17 步:OCR 擷取改用 overlay `screenshot()` 的決策與退回(mock 原生擷取;不啟動 Electron)
import { describe, expect, it, vi } from 'vitest'
import {
  clientCropOnDisplay, createGameClientCapture, looksBlack, planOverlayShot,
  type ClientCapture, type PhysRect
} from '../src/ocr/overlay-shot'

/** 假的 NativeImage:記下來源 Buffer 與裁切 */
class FakeImg {
  constructor (readonly buf: Buffer, readonly w: number, readonly h: number, readonly crops: PhysRect[] = []) {}
  crop (r: PhysRect): FakeImg { return new FakeImg(this.buf, this.w, this.h, [...this.crops, r]) }
}

const PRIMARY: PhysRect = { x: 0, y: 0, width: 2560, height: 1440 }
const SECONDARY: PhysRect = { x: -1440, y: -1114, width: 1440, height: 2560 }

/** 寬 × 高的 BGRA,每個像素都是灰 (40,40,40,255);`black` = 指定矩形內全 0 */
function bgra (w: number, h: number, black?: PhysRect): Buffer {
  const b = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const z = black && x >= black.x && x < black.x + black.width && y >= black.y && y < black.y + black.height
      b[o] = z ? 0 : 40; b[o + 1] = z ? 0 : 40; b[o + 2] = z ? 0 : 40; b[o + 3] = 255
    }
  }
  return b
}

/** getSources 路徑的替身:回傳形狀相同、image 標記為 'sources' */
function fakeSources () {
  return vi.fn(async (bounds: PhysRect): Promise<ClientCapture<FakeImg>> => {
    const c = clientCropOnDisplay(bounds, PRIMARY)
    if (!c) throw new Error('no-game-window')
    return { image: new FakeImg(Buffer.from('sources'), c.x1 - c.x0, c.y1 - c.y0), offset: { x: c.x0 - bounds.x, y: c.y0 - bounds.y }, client: { w: bounds.width, h: bounds.height } }
  })
}

function setup (opts: { shot?: () => Buffer, shotBounds?: PhysRect, displays?: PhysRect[] } = {}) {
  const fallback = fakeSources()
  const log = vi.fn()
  const fromBitmap = vi.fn((buf: Buffer, w: number, h: number) => new FakeImg(buf, w, h))
  const displays = opts.displays ?? [PRIMARY]
  const cap = createGameClientCapture<FakeImg>({
    screenshot: opts.shot,
    shotBounds: () => opts.shotBounds ?? { x: 0, y: 0, width: 0, height: 0 },
    // 與 capture.ts pickDisplay 相同:含中心點的螢幕,否則重疊最大的
    display: (b) => {
      const cx = b.x + b.width / 2; const cy = b.y + b.height / 2
      const hit = displays.find(d => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height)
      if (hit) return hit
      let best: PhysRect | null = null; let area = 0
      for (const d of displays) {
        const c = clientCropOnDisplay(b, d)
        const a = c ? (c.x1 - c.x0) * (c.y1 - c.y0) : 0
        if (a > area) { area = a; best = d }
      }
      return best
    },
    fromBitmap,
    fallback,
    log
  })
  return { cap, fallback, log, fromBitmap }
}

describe('clientCropOnDisplay', () => {
  it('client 完全在螢幕內 = 整個 client', () => {
    expect(clientCropOnDisplay({ x: 100, y: 50, width: 800, height: 600 }, PRIMARY)).toEqual({ x0: 100, y0: 50, x1: 900, y1: 650 })
  })
  it('左邊跑出螢幕 → 只留螢幕內', () => {
    expect(clientCropOnDisplay({ x: -300, y: 10, width: 1000, height: 500 }, PRIMARY)).toEqual({ x0: 0, y0: 10, x1: 700, y1: 510 })
  })
  it('副螢幕(負座標)', () => {
    expect(clientCropOnDisplay({ x: -1440, y: -1114, width: 2000, height: 1125 }, SECONDARY)).toEqual({ x0: -1440, y0: -1114, x1: 0, y1: 11 })
  })
  it('沒有交集 → null', () => {
    expect(clientCropOnDisplay({ x: -32000, y: -32000, width: 1400, height: 1000 }, PRIMARY)).toBeNull()
  })
})

describe('looksBlack', () => {
  it('全 0 = 黑;很暗但非 0 不算黑', () => {
    expect(looksBlack(Buffer.alloc(64 * 36 * 4), 64, { x: 0, y: 0, width: 64, height: 36 })).toBe(true)
    const dark = Buffer.alloc(64 * 36 * 4, 1)
    expect(looksBlack(dark, 64, { x: 0, y: 0, width: 64, height: 36 })).toBe(false)
  })
  it('只看指定矩形(螢幕外的黑邊不算)', () => {
    const b = bgra(100, 50, { x: 0, y: 0, width: 30, height: 50 })
    expect(looksBlack(b, 100, { x: 0, y: 0, width: 30, height: 50 })).toBe(true)
    expect(looksBlack(b, 100, { x: 30, y: 0, width: 70, height: 50 })).toBe(false)
  })
  it('alpha 不影響判斷', () => {
    const b = Buffer.alloc(8 * 8 * 4)
    for (let i = 3; i < b.length; i += 4) b[i] = 255
    expect(looksBlack(b, 8, { x: 0, y: 0, width: 8, height: 8 })).toBe(true)
  })
})

describe('planOverlayShot', () => {
  const b = { x: 0, y: 23, width: 2560, height: 1369 }
  it('尺寸對、在螢幕內 → 整張不裁', () => {
    expect(planOverlayShot(b, b, PRIMARY, 2560 * 1369 * 4)).toEqual({ ok: true, crop: { x: 0, y: 0, width: 2560, height: 1369 }, full: true, offset: { x: 0, y: 0 } })
  })
  it('Buffer 長度不符 → size-mismatch', () => {
    expect(planOverlayShot(b, b, PRIMARY, 2560 * 1369 * 4 - 4)).toEqual({ ok: false, reason: 'size-mismatch' })
  })
  it('原生記得的 bounds 與遊戲 bounds 不同 → bounds-mismatch', () => {
    expect(planOverlayShot(b, { ...b, width: 1920 }, PRIMARY, 1920 * 1369 * 4)).toEqual({ ok: false, reason: 'bounds-mismatch' })
  })
  it('沒有螢幕 → no-display', () => {
    expect(planOverlayShot(b, b, null, 2560 * 1369 * 4)).toEqual({ ok: false, reason: 'no-display' })
  })
})

describe('createGameClientCapture', () => {
  it('成功:BGRA 直接組圖、不裁、offset 0,不呼叫 getSources', async () => {
    const b = { x: 0, y: 23, width: 200, height: 100 }
    const buf = bgra(200, 100)
    const { cap, fallback, fromBitmap, log } = setup({ shot: () => buf, shotBounds: b })
    const r = await cap.capture(b)
    expect(fromBitmap).toHaveBeenCalledWith(buf, 200, 100)
    expect(r.image.buf).toBe(buf)
    expect(r.image.crops).toEqual([])
    expect(r.offset).toEqual({ x: 0, y: 0 })
    expect(r.client).toEqual({ w: 200, h: 100 })
    expect(fallback).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(cap.stats).toEqual({ overlay: 1, fallback: {} })
  })

  it('部分在螢幕外:裁切與 offset 與 getSources 路徑一致(螢幕外的黑邊不觸發全黑退回)', async () => {
    const b = { x: -300, y: 10, width: 1000, height: 500 }
    // BitBlt 對螢幕外的部分是 0
    const buf = bgra(1000, 500, { x: 0, y: 0, width: 300, height: 500 })
    const { cap, fallback } = setup({ shot: () => buf, shotBounds: b })
    const r = await cap.capture(b)
    const ref = await fallback(b)
    expect(r.image.crops).toEqual([{ x: 300, y: 0, width: 700, height: 500 }])
    expect(r.offset).toEqual(ref.offset)
    expect(r.offset).toEqual({ x: 300, y: 0 })
    expect([r.image.crops[0].width, r.image.crops[0].height]).toEqual([ref.image.w, ref.image.h])
    expect(r.client).toEqual(ref.client)
    expect(cap.stats.overlay).toBe(1)
  })

  it('跨兩個螢幕:只留含中心點的螢幕那塊(與 getSources 路徑相同)', async () => {
    const b = { x: -1440, y: -1114, width: 2000, height: 1125 }
    const buf = bgra(2000, 1125)
    const { cap } = setup({ shot: () => buf, shotBounds: b, displays: [PRIMARY, SECONDARY] })
    const r = await cap.capture(b)
    expect(r.image.crops).toEqual([{ x: 0, y: 0, width: 1440, height: 1125 }])
    expect(r.offset).toEqual({ x: 0, y: 0 })
  })

  it('原生 throw → 退回 getSources,同原因只記一次 log', async () => {
    const b = { x: 0, y: 0, width: 200, height: 100 }
    const { cap, fallback, log } = setup({ shot: () => { throw new Error('Not implemented on your platform.') }, shotBounds: b })
    const r1 = await cap.capture(b)
    await cap.capture(b)
    expect(r1.image.buf.toString()).toBe('sources')
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain('throw')
    expect(cap.stats.fallback).toEqual({ throw: 2 })
  })

  it('尺寸不符 → 退回', async () => {
    const b = { x: 0, y: 0, width: 200, height: 100 }
    const { cap, fallback, log } = setup({ shot: () => bgra(100, 100), shotBounds: b })
    expect((await cap.capture(b)).image.buf.toString()).toBe('sources')
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain('size-mismatch')
  })

  it('遊戲 bounds 與原生記得的不同(剛移動)→ 退回', async () => {
    const b = { x: 0, y: 0, width: 200, height: 100 }
    const { cap, fallback } = setup({ shot: () => bgra(200, 100), shotBounds: { ...b, x: 5 } })
    await cap.capture(b)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(cap.stats.fallback).toEqual({ 'bounds-mismatch': 1 })
  })

  it('全黑(全螢幕獨占 / 硬體 overlay)→ 退回;各原因各記一次 log', async () => {
    const b = { x: 0, y: 0, width: 200, height: 100 }
    let black = true
    const { cap, fallback, log } = setup({ shot: () => black ? Buffer.alloc(200 * 100 * 4) : bgra(200, 100), shotBounds: b })
    await cap.capture(b)
    await cap.capture(b)
    black = false
    const ok = await cap.capture(b)
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain('black')
    expect(ok.image.buf.toString()).not.toBe('sources')
    expect(cap.stats).toEqual({ overlay: 1, fallback: { black: 2 } })
  })

  it('沒有 screenshot(視窗模式)→ 一律 getSources,不記 log', async () => {
    const b = { x: 0, y: 0, width: 200, height: 100 }
    const { cap, fallback, log } = setup({ shotBounds: b })
    await cap.capture(b)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it('client 不在任何螢幕上 → 交給 getSources(它會 throw no-game-window,行為不變),不呼叫原生', async () => {
    const b = { x: -32000, y: -32000, width: 1400, height: 1000 }
    const shot = vi.fn(() => bgra(1400, 1000))
    const { cap } = setup({ shot, shotBounds: b })
    await expect(cap.capture(b)).rejects.toThrow('no-game-window')
    expect(shot).not.toHaveBeenCalled()
  })

  it('bounds 無效 → no-game-window', async () => {
    const { cap } = setup({ shot: () => Buffer.alloc(0) })
    await expect(cap.capture({ x: 0, y: 0, width: 0, height: 0 })).rejects.toThrow('no-game-window')
  })
})
