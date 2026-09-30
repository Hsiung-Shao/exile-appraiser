// exile-appraiser(WP-S2):框選 OCR 辨識區域的幾何(`src/web/overlay/region-geom.ts`)。
import { describe, expect, it } from 'vitest'
import {
  HANDLES, MIN_BOX, arrowDelta, clampBox, detectedRegion, dragBox, finishNewBox, fromRegion, handlePoint,
  moveBox, nudgeBox, regionPercent, resizeBox, toRegion, type Box
} from '../src/web/overlay/region-geom'

const VP = { w: 2000, h: 1125 }
const BOX: Box = { x: 380, y: 500, w: 550, h: 280 }

describe('新框', () => {
  it('兩點決定框,反方向拖也正規化;夾在視窗內', () => {
    expect(dragBox({ x: 930, y: 780 }, { x: 380, y: 500 }, VP)).toEqual(BOX)
    expect(dragBox({ x: 1900, y: 1000 }, { x: 2300, y: 1400 }, VP)).toEqual({ x: 1900, y: 1000, w: 100, h: 125 })
    expect(dragBox({ x: -50, y: -10 }, { x: 60, y: 70 }, VP)).toEqual({ x: 0, y: 0, w: 60, h: 70 })
  })
  it('放開:點一下(< 3 px)不產生框', () => {
    expect(finishNewBox({ x: 500, y: 500 }, { x: 502, y: 501 }, VP)).toBeNull()
    expect(finishNewBox({ x: 380, y: 500 }, { x: 930, y: 780 }, VP)).toEqual(BOX)
  })
  it('最小尺寸 40×40:從錨點往拖曳方向延伸;貼邊時往反方向補', () => {
    expect(finishNewBox({ x: 100, y: 100 }, { x: 110, y: 105 }, VP)).toEqual({ x: 100, y: 100, w: MIN_BOX, h: MIN_BOX })
    expect(finishNewBox({ x: 100, y: 100 }, { x: 90, y: 95 }, VP)).toEqual({ x: 60, y: 60, w: MIN_BOX, h: MIN_BOX })
    expect(finishNewBox({ x: 1995, y: 1120 }, { x: 2000, y: 1125 }, VP)).toEqual({ x: 1960, y: 1085, w: MIN_BOX, h: MIN_BOX })
    expect(finishNewBox({ x: 5, y: 5 }, { x: 0, y: 0 }, VP)).toEqual({ x: 0, y: 0, w: MIN_BOX, h: MIN_BOX })
  })
})

describe('移動', () => {
  it('大小不變,夾在視窗內', () => {
    expect(moveBox(BOX, 20, -30, VP)).toEqual({ ...BOX, x: 400, y: 470 })
    expect(moveBox(BOX, -1000, -1000, VP)).toEqual({ ...BOX, x: 0, y: 0 })
    expect(moveBox(BOX, 5000, 5000, VP)).toEqual({ ...BOX, x: 2000 - 550, y: 1125 - 280 })
  })
  it('clampBox:比視窗大 → 縮成視窗', () => {
    expect(clampBox({ x: -10, y: 50, w: 3000, h: 100 }, VP)).toEqual({ x: 0, y: 50, w: 2000, h: 100 })
  })
})

describe('八個把手', () => {
  const cases: Array<[string, number, number, Box]> = [
    ['nw', -10, -20, { x: 370, y: 480, w: 560, h: 300 }],
    ['n', -10, -20, { x: 380, y: 480, w: 550, h: 300 }],
    ['ne', 10, -20, { x: 380, y: 480, w: 560, h: 300 }],
    ['e', 10, 99, { x: 380, y: 500, w: 560, h: 280 }],
    ['se', 10, 20, { x: 380, y: 500, w: 560, h: 300 }],
    ['s', 99, 20, { x: 380, y: 500, w: 550, h: 300 }],
    ['sw', -10, 20, { x: 370, y: 500, w: 560, h: 300 }],
    ['w', -10, 99, { x: 370, y: 500, w: 560, h: 280 }]
  ]
  it.each(cases)('%s', (h, dx, dy, want) => {
    expect(resizeBox(BOX, h as never, dx, dy, VP)).toEqual(want)
  })
  it('HANDLES 恰好八個,把手中心在邊角 / 邊中點', () => {
    expect(HANDLES).toHaveLength(8)
    expect(handlePoint(BOX, 'nw')).toEqual({ x: 380, y: 500 })
    expect(handlePoint(BOX, 'se')).toEqual({ x: 930, y: 780 })
    expect(handlePoint(BOX, 'n')).toEqual({ x: 655, y: 500 })
    expect(handlePoint(BOX, 'w')).toEqual({ x: 380, y: 640 })
  })
  it('縮到比最小尺寸小 → 停在 40;拉出視窗 → 停在邊界', () => {
    expect(resizeBox(BOX, 'e', -1000, 0, VP)).toEqual({ ...BOX, w: MIN_BOX })
    expect(resizeBox(BOX, 'nw', 1000, 1000, VP)).toEqual({ x: 930 - MIN_BOX, y: 780 - MIN_BOX, w: MIN_BOX, h: MIN_BOX })
    expect(resizeBox(BOX, 'se', 5000, 5000, VP)).toEqual({ x: 380, y: 500, w: 2000 - 380, h: 1125 - 500 })
    expect(resizeBox(BOX, 'nw', -5000, -5000, VP)).toEqual({ x: 0, y: 0, w: 930, h: 780 })
  })
})

describe('方向鍵微調', () => {
  it('1 px;Shift = 10 px;其他鍵 null', () => {
    expect(arrowDelta('ArrowLeft', false)).toEqual({ x: -1, y: 0 })
    expect(arrowDelta('ArrowDown', true)).toEqual({ x: 0, y: 10 })
    expect(arrowDelta('Enter', false)).toBeNull()
  })
  it('一般 = 移動、Ctrl = 改右 / 下邊;都夾在視窗與最小尺寸內', () => {
    expect(nudgeBox(BOX, 'ArrowRight', { shift: false, ctrl: false }, VP)).toEqual({ ...BOX, x: 381 })
    expect(nudgeBox(BOX, 'ArrowUp', { shift: true, ctrl: false }, VP)).toEqual({ ...BOX, y: 490 })
    expect(nudgeBox(BOX, 'ArrowRight', { shift: true, ctrl: true }, VP)).toEqual({ ...BOX, w: 560 })
    expect(nudgeBox(BOX, 'ArrowUp', { shift: false, ctrl: true }, VP)).toEqual({ ...BOX, h: 279 })
    expect(nudgeBox({ x: 0, y: 0, w: 40, h: 40 }, 'ArrowLeft', { shift: true, ctrl: true }, VP)).toEqual({ x: 0, y: 0, w: 40, h: 40 })
    expect(nudgeBox({ x: 0, y: 0, w: 40, h: 40 }, 'ArrowLeft', { shift: true, ctrl: false }, VP)).toEqual({ x: 0, y: 0, w: 40, h: 40 })
    expect(nudgeBox(BOX, 'a', { shift: false, ctrl: false }, VP)).toBeNull()
  })
})

describe('比例換算', () => {
  it('CSS px ↔ client 比例(四位小數),與視窗大小無關', () => {
    const r = toRegion(BOX, VP)
    expect(r).toEqual({ x: 0.19, y: 0.4444, w: 0.275, h: 0.2489 })
    const back = fromRegion(r, VP)
    expect(Math.abs(back.x - BOX.x)).toBeLessThan(0.5)
    expect(Math.abs(back.h - BOX.h)).toBeLessThan(0.5)
    // 同一比例在 1920×1080 的 client 上
    expect(fromRegion(r, { w: 1920, h: 1080 }).x).toBeCloseTo(364.8, 5)
    expect(regionPercent(r)).toEqual({ x: 19, y: 44, w: 28, h: 25 })
  })
  it('夾在 0–1,且 x + w、y + h 不超過 1', () => {
    const r = toRegion({ x: 1999.99, y: 1100, w: 50, h: 100 }, VP)
    expect(r.x + r.w).toBeLessThanOrEqual(1)
    expect(r.y + r.h).toBeLessThanOrEqual(1)
    expect(toRegion({ x: 0, y: 0, w: 2000, h: 1125 }, VP)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    const odd = toRegion({ x: 1333.33, y: 750.4, w: 666.67, h: 374.6 }, VP)
    expect(odd.x + odd.w).toBeLessThanOrEqual(1)
    expect(odd.y + odd.h).toBeLessThanOrEqual(1)
  })
})

describe('上次偵測參考框', () => {
  const client = { w: 2000, h: 1125 }
  const groups = [
    { rect: { x: 500, y: 560, w: 200, h: 50 }, lines: [{ h: 20 }, { h: 20 }] },
    { rect: { x: 520, y: 640, w: 160, h: 20 }, lines: [{ h: 20 }] }
  ]
  it('聯集 → 水平每邊 50% 框寬、垂直每邊 2 × 平均行高', () => {
    // 聯集 500–700 × 560–660;外擴 100 / 40 → 400–800 × 520–700
    const r = detectedRegion(groups, client)!
    expect(r.x).toBe(0.2)
    expect(r.w).toBe(0.2)
    expect(r.y).toBeCloseTo(520 / 1125, 4)
    expect(r.h).toBeCloseTo(180 / 1125, 4)
  })
  it('夾在 0–1', () => {
    const r = detectedRegion([{ rect: { x: 10, y: 5, w: 1900, h: 1110 }, lines: [{ h: 30 }] }], client)!
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
  it('沒有組 / client 大小為 0 → null', () => {
    expect(detectedRegion([], client)).toBeNull()
    expect(detectedRegion(groups, { w: 0, h: 0 })).toBeNull()
  })
})
