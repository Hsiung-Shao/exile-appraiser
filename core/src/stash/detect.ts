// PoE1 倉庫碎片頁的偵測純函式:OCR 子頁按鈕列 → 是不是碎片頁、整體上下偏移(倉庫頁放在資料夾內時下移);
// 按鈕亮度 → 目前在哪個子頁。版面位置以 1440 基準等比換算(與 layout.ts 同一套,Exile-UI stash-ninja 的規則)。
// 零依賴:main(esbuild)以相對路徑 import。
import type { StashSubtab } from './layout'

export type StashTextLang = 'zh' | 'en'
export interface Rect { x: number, y: number, w: number, h: number }
/** client 實體像素 */
export interface TextLine { text: string, x: number, y: number, w: number, h: number }

/** 畫面左到右四顆子頁按鈕(GGPK clientstrings `FragmentStashSubTab{Other,Scarab,Betrayal,Eldritch}`) */
export const SUBTAB_LABELS: Record<StashTextLang, readonly [string, string, string, string]> = {
  zh: ['一般', '聖甲蟲', '不滅之火', '異能'],
  en: ['General', 'Scarab', 'Allflame', 'Eldritch']
}
/** 第 4 顆(異能)沒有版面 → null */
export const BUTTON_SUBTABS: readonly [StashSubtab, StashSubtab, StashSubtab, null] = ['general', 'scarabs', 'allflame', null]

const BASE = 1440
const at = (v: number, h: number) => Math.floor(v / BASE * h)

/**
 * OCR 掃描條(按鈕列 ± 資料夾偏移;寬 = 倉庫面板寬 h × 37/60)。y 150–268 / 1440:按鈕文字中心 201、資料夾內 +47 = 248
 * (文字下緣約 260 仍在內);下緣不超過聖甲蟲第一列徽章頂端(約 269),免得換格 / 價格載入觸發重 OCR。
 */
export function stripRect (clientH: number): Rect {
  const y = at(150, clientH)
  return { x: 0, y, w: Math.floor(clientH * 37 / 60), h: at(268, clientH) - y }
}

/** 倉庫頁在資料夾內時,整個內容下移(Exile-UI `in_folder` = +47 / 1440) */
export function folderOffset (clientH: number): number {
  return at(47, clientH)
}

export function buttonRects (clientH: number, yOffset = 0): [Rect, Rect, Rect, Rect] {
  const y = at(186, clientH) + yOffset
  const w = at(152, clientH)
  const h = at(36, clientH)
  const r = (k: number): Rect => ({ x: at(116 + 168 * k, clientH), y, w, h })
  return [r(0), r(1), r(2), r(3)]
}

export interface ButtonMatch {
  found: boolean
  /** 命中的按鈕顆數(0–4) */
  matched: number
  /** 整體下移量(client 像素;0 或 `folderOffset`) */
  yOffset: number
}

/** 按鈕文字的垂直中心(1440 基準;真實錄影量到 199.6–202.6) */
const TEXT_CENTER_Y = 201
const X_TOLERANCE = 40
const SNAP_TOLERANCE = 12

export function findSubtabButtons (lines: readonly TextLine[], clientH: number, lang: StashTextLang): ButtonMatch {
  const labels = SUBTAB_LABELS[lang]
  const rects = buttonRects(clientH, 0)
  const xTol = X_TOLERANCE / BASE * clientH
  const centers: number[] = []
  for (let k = 0; k < 4; k++) {
    const cx = rects[k].x + rects[k].w / 2
    let best: TextLine | null = null
    let bestD = Infinity
    for (const l of lines) {
      if (l.text.replace(/\s+/g, '') !== labels[k]) continue
      const d = Math.abs(l.x + l.w / 2 - cx)
      if (d <= xTol && d < bestD) { best = l; bestD = d }
    }
    if (best) centers.push(best.y + best.h / 2)
  }
  const matched = centers.length
  if (matched < 3) return { found: false, matched, yOffset: 0 }
  centers.sort((a, b) => a - b)
  const median = matched % 2 ? centers[(matched - 1) / 2] : (centers[matched / 2 - 1] + centers[matched / 2]) / 2
  const raw = median - TEXT_CENTER_Y / BASE * clientH
  const tol = SNAP_TOLERANCE / BASE * clientH
  for (const snap of [0, folderOffset(clientH)]) {
    if (Math.abs(raw - snap) <= tol) return { found: true, matched, yOffset: snap }
  }
  return { found: false, matched, yOffset: 0 }
}

export function percentile (gray: Uint8Array, q: number): number {
  if (!gray.length) return 0
  const s = Array.from(gray).sort((a, b) => a - b)
  return s[Math.floor(q * (s.length - 1))]
}

/** 目前子頁的按鈕文字較亮(真實錄影:p99 158–162 vs 其他 141–144) */
const ACTIVE_MARGIN = 8

export function activeSubtab (p99: readonly number[]): StashSubtab | null {
  if (p99.length !== 4) return null
  let top = 0
  for (let k = 1; k < 4; k++) if (p99[k] > p99[top]) top = k
  const second = Math.max(...p99.filter((_, k) => k !== top))
  if (p99[top] - second < ACTIVE_MARGIN) return null
  return BUTTON_SUBTABS[top]
}
