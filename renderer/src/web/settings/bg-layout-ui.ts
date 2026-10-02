/**
 * 第 26 步(2026-10-03):設定 › 一般 › 背景「顯示位置與填滿方式」預覽框的純函式(BgLayoutEditor.vue 用;測試 renderer/test/background.test.ts)。
 */
import { BG_LAYOUT_DEFAULT, type BgLayout } from '../bg-bake'
import type { BgHost } from '../useTheme'

/** 沒量過容器大小時的代表長寬比(寬 / 高):查價面板 ≈ 窄長條(overlay 全高)、設定視窗 = 預設 50rem × 38rem */
export const BG_PREVIEW_FALLBACK_RATIO: Readonly<Record<BgHost, number>> = { panel: 0.5, settings: 50 / 38 }
/** 預覽框:高 9em,寬照比例,最寬 15em(超過就改縮高) */
export const BG_PREVIEW_H_EM = 9
export const BG_PREVIEW_W_MAX_EM = 15

/** 預覽框大小(em);ratio = 寬 / 高(夾在 1:4 – 4:1) */
export function previewBoxEm (ratio: number): { w: number, h: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? Math.min(4, Math.max(0.25, ratio)) : 1
  const w = BG_PREVIEW_H_EM * r
  if (w <= BG_PREVIEW_W_MAX_EM) return { w: Math.round(w * 100) / 100, h: BG_PREVIEW_H_EM }
  return { w: BG_PREVIEW_W_MAX_EM, h: Math.round((BG_PREVIEW_W_MAX_EM / r) * 100) / 100 }
}

/** 指標位置 → 焦點(0–100 整數,夾在框內) */
export function pointerToFocus (clientX: number, clientY: number, rect: { left: number, top: number, width: number, height: number }): { x: number, y: number } {
  const f = (v: number, a: number, len: number) => len > 0 ? Math.min(100, Math.max(0, Math.round(((v - a) / len) * 100))) : 50
  return { x: f(clientX, rect.left, rect.width), y: f(clientY, rect.top, rect.height) }
}

/** 預覽框上的方向鍵:每次 1%(Shift 10%),夾在 0–100;其他鍵 → null */
export function bgLayoutKeyStep (l: BgLayout, key: string, shift: boolean): Partial<BgLayout> | null {
  const step = shift ? 10 : 1
  const c = (v: number) => Math.min(100, Math.max(0, v))
  switch (key) {
    case 'ArrowLeft': return { x: c(l.x - step) }
    case 'ArrowRight': return { x: c(l.x + step) }
    case 'ArrowUp': return { y: c(l.y - step) }
    case 'ArrowDown': return { y: c(l.y + step) }
    default: return null
  }
}

/** 是否完全是預設值(「還原」按鈕停用) */
export function isDefaultBgLayout (l: BgLayout): boolean {
  const d = BG_LAYOUT_DEFAULT
  return l.x === d.x && l.y === d.y && l.fit === d.fit && l.zoom === d.zoom
}
