/**
 * exile-appraiser(WP-S2):在遊戲畫面上框選 OCR 辨識區域的幾何純函式(`OcrRegionPicker.vue` 用;`renderer/test/region-geom.test.ts` 測)。
 *
 * 座標系:overlay 視窗的 CSS px(原點 = 遊戲 client 左上;overlay 與 client 對齊),`vp` = `innerWidth × innerHeight`。
 * 存檔的 `ocrRegion` 是 client 比例(0–1)= CSS px ÷ vp,與 DPI 無關(docs/reveal-ocr.md「框選辨識區域」)。
 * 只做型別匯入、不 import Vue / DOM(renderer vitest 是 node 環境、沒有別名)。
 */
import type { OcrRegion } from '@ipc/types'

export interface Pt { x: number, y: number }
export interface Box { x: number, y: number, w: number, h: number }
export interface Size { w: number, h: number }

/** 最小選取框(CSS px) */
export const MIN_BOX = 40
/** 拖曳距離小於這個值 = 單純點一下(不產生新框) */
export const CLICK_SLOP = 3
/** 方向鍵微調:1 px;按住 Shift = 10 px */
export const NUDGE_STEP = 1
export const NUDGE_STEP_FAST = 10

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function clampPt (p: Pt, vp: Size): Pt {
  return { x: clamp(p.x, 0, vp.w), y: clamp(p.y, 0, vp.h) }
}

/** 拖曳中的新框:兩點決定、夾在視窗內(還不套最小尺寸) */
export function dragBox (a: Pt, b: Pt, vp: Size): Box {
  const p = clampPt(a, vp)
  const q = clampPt(b, vp)
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) }
}

/** 一個軸:從錨點往拖曳方向至少 `min`,夾在 [0, max];空間不夠就往反方向補 */
function span (anchor: number, to: number, max: number, min: number): [number, number] {
  const m = Math.min(min, max)
  if (to >= anchor) {
    const hi = clamp(Math.max(to, anchor + m), 0, max)
    return [Math.max(0, Math.min(anchor, hi - m)), hi]
  }
  const lo = clamp(Math.min(to, anchor - m), 0, max)
  return [lo, Math.min(max, Math.max(anchor, lo + m))]
}

/** 放開滑鼠:點一下(移動 < CLICK_SLOP)回 null;否則套最小尺寸(從錨點往拖曳方向延伸) */
export function finishNewBox (a: Pt, b: Pt, vp: Size, min = MIN_BOX): Box | null {
  const p = clampPt(a, vp)
  const q = clampPt(b, vp)
  if (Math.abs(q.x - p.x) < CLICK_SLOP && Math.abs(q.y - p.y) < CLICK_SLOP) return null
  const [x0, x1] = span(p.x, q.x, vp.w, min)
  const [y0, y1] = span(p.y, q.y, vp.h, min)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** 整框夾進視窗(大小超過視窗時縮成視窗大小) */
export function clampBox (b: Box, vp: Size): Box {
  const w = clamp(b.w, 0, vp.w)
  const h = clamp(b.h, 0, vp.h)
  return { x: clamp(b.x, 0, vp.w - w), y: clamp(b.y, 0, vp.h - h), w, h }
}

/** 框內拖曳 = 移動(大小不變,夾在視窗內);方向鍵微調也用這個 */
export function moveBox (start: Box, dx: number, dy: number, vp: Size): Box {
  return clampBox({ ...start, x: start.x + dx, y: start.y + dy }, vp)
}

/** 八個把手:只動把手所在的邊;每邊夾在視窗內,且寬高 ≥ min */
export function resizeBox (start: Box, handle: Handle, dx: number, dy: number, vp: Size, min = MIN_BOX): Box {
  let l = start.x
  let t = start.y
  let r = start.x + start.w
  let b = start.y + start.h
  const mw = Math.min(min, vp.w)
  const mh = Math.min(min, vp.h)
  if (handle.includes('w')) l = clamp(l + dx, 0, r - mw)
  if (handle.includes('e')) r = clamp(r + dx, l + mw, vp.w)
  if (handle.includes('n')) t = clamp(t + dy, 0, b - mh)
  if (handle.includes('s')) b = clamp(b + dy, t + mh, vp.h)
  return { x: l, y: t, w: r - l, h: b - t }
}

/** 方向鍵 → 位移(Shift = 10 px);不是方向鍵回 null */
export function arrowDelta (key: string, shift: boolean): Pt | null {
  const s = shift ? NUDGE_STEP_FAST : NUDGE_STEP
  switch (key) {
    case 'ArrowLeft': return { x: -s, y: 0 }
    case 'ArrowRight': return { x: s, y: 0 }
    case 'ArrowUp': return { x: 0, y: -s }
    case 'ArrowDown': return { x: 0, y: s }
    default: return null
  }
}

/** 方向鍵微調:一般 = 移動;按住 Ctrl = 調整右 / 下邊(寬高,仍 ≥ min) */
export function nudgeBox (b: Box, key: string, mods: { shift: boolean, ctrl: boolean }, vp: Size, min = MIN_BOX): Box | null {
  const d = arrowDelta(key, mods.shift)
  if (!d) return null
  if (mods.ctrl) return resizeBox(b, d.x !== 0 ? 'e' : 's', d.x, d.y, vp, min)
  return moveBox(b, d.x, d.y, vp)
}

/** 把手中心(CSS px) */
export function handlePoint (b: Box, h: Handle): Pt {
  const x = h.includes('w') ? b.x : h.includes('e') ? b.x + b.w : b.x + b.w / 2
  const y = h.includes('n') ? b.y : h.includes('s') ? b.y + b.h : b.y + b.h / 2
  return { x, y }
}

const round4 = (v: number) => Math.round(v * 10000) / 10000

/** CSS px 框 → client 比例(四位小數,夾在 0–1,且 x + w、y + h ≤ 1) */
export function toRegion (b: Box, vp: Size): OcrRegion {
  const x = round4(clamp(b.x / vp.w, 0, 1))
  const y = round4(clamp(b.y / vp.h, 0, 1))
  const w = round4(clamp(b.w / vp.w, 0, 1))
  const h = round4(clamp(b.h / vp.h, 0, 1))
  return { x, y, w: Math.min(w, round4(1 - x)), h: Math.min(h, round4(1 - y)) }
}

/** client 比例 → CSS px 框 */
export function fromRegion (r: OcrRegion, vp: Size): Box {
  return clampBox({ x: r.x * vp.w, y: r.y * vp.h, w: r.w * vp.w, h: r.h * vp.h }, vp)
}

/** 顯示用百分比(整數) */
export function regionPercent (r: OcrRegion): { x: number, y: number, w: number, h: number } {
  const p = (v: number) => Math.round(v * 100)
  return { x: p(r.x), y: p(r.y), w: p(r.w), h: p(r.h) }
}

export interface DetectedGroup {
  rect: { x: number, y: number, w: number, h: number }
  lines: ReadonlyArray<{ h: number }>
}

/**
 * 「上次偵測」參考框:最近一次 OCR 比對結果所有組矩形(client 實體像素)的聯集,
 * 外擴水平每邊 50% 框寬、垂直每邊 2 × 平均行高,換成 client 比例並夾在 0–1。沒有組回 null。
 */
export function detectedRegion (groups: readonly DetectedGroup[], client: Size): OcrRegion | null {
  if (!groups.length || !(client.w > 0 && client.h > 0)) return null
  const x0 = Math.min(...groups.map(g => g.rect.x))
  const y0 = Math.min(...groups.map(g => g.rect.y))
  const x1 = Math.max(...groups.map(g => g.rect.x + g.rect.w))
  const y1 = Math.max(...groups.map(g => g.rect.y + g.rect.h))
  const hs = groups.flatMap(g => g.lines.map(l => l.h)).filter(h => h > 0)
  const lineH = hs.length ? hs.reduce((s, h) => s + h, 0) / hs.length : (y1 - y0) / Math.max(1, groups.length * 2)
  const padX = (x1 - x0) * 0.5
  const padY = lineH * 2
  const l = clamp((x0 - padX) / client.w, 0, 1)
  const t = clamp((y0 - padY) / client.h, 0, 1)
  const r = clamp((x1 + padX) / client.w, 0, 1)
  const b = clamp((y1 + padY) / client.h, 0, 1)
  if (r <= l || b <= t) return null
  const x = round4(l)
  const y = round4(t)
  return { x, y, w: Math.min(round4(r - l), round4(1 - x)), h: Math.min(round4(b - t), round4(1 - y)) }
}
