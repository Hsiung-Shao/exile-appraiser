// PoE1 倉庫碎片頁的偵測純函式:OCR 子頁按鈕列 → 是不是碎片頁、整體上下偏移(倉庫頁放在資料夾內時下移);
// 按鈕亮度 → 目前在哪個子頁。版面位置以 1440 基準等比換算(與 layout.ts 同一套,Exile-UI stash-ninja 的規則)。
// 零依賴:main(esbuild)以相對路徑 import。
import type { StashSubtab } from './layout'

export type StashTextLang = 'zh' | 'en'
export interface Rect { x: number, y: number, w: number, h: number }
/** client 實體像素 */
export interface TextLine { text: string, x: number, y: number, w: number, h: number }

/**
 * 用來判定碎片頁開著的子頁按鈕文字,左到右(GGPK clientstrings `FragmentStashSubTab{Other,Betrayal,Eldritch}`)。
 * 只有第一顆「一般」有版面;不滅之火(2026-10-14 使用者決定不做)、異能只當偵測錨點。
 * 聖甲蟲(`FragmentStashSubTabScarab`)2026-11-07 起不比對:3.30 移除聖甲蟲,按鈕列可能少一顆、其他按鈕左移。
 */
export const SUBTAB_LABELS: Record<StashTextLang, readonly [string, string, string]> = {
  zh: ['一般', '不滅之火', '異能'],
  en: ['General', 'Allflame', 'Eldritch']
}
/** 「一般」固定在最左的按鈕槽 */
export const GENERAL_SLOT = 0
/** 按鈕槽數(3.29 = 一般 / 聖甲蟲 / 不滅之火 / 異能 四顆) */
export const BUTTON_SLOTS = 4
/** 至少認到幾顆按鈕文字才算碎片頁(目前子頁的文字 OCR 常漏讀 → 允許漏一顆) */
export const MIN_BUTTONS = 2

const BASE = 1440
const at = (v: number, h: number) => Math.floor(v / BASE * h)

/**
 * OCR 掃描條(按鈕列 ± 資料夾偏移;寬 = 倉庫面板寬 h × 37/60)。y 170–268 / 1440(上緣 170 = 倉庫頁籤字下緣:切到頁籤字的一半時
 * Windows OCR 排版錯亂、按鈕只讀到 0–1 顆,使用者 2560×1440 實機截圖重現,2026-10-14):按鈕文字中心 201、資料夾內 +47 = 248
 * (文字下緣約 260 仍在內);下緣 268 不再往下(2026-10-14 依當時聖甲蟲頁第一列徽章頂端約 269 定的,維持不動)。
 */
export function stripRect (clientH: number): Rect {
  const y = at(170, clientH)
  return { x: 0, y, w: Math.floor(clientH * 37 / 60), h: at(268, clientH) - y }
}

/** 預設掃描條換成 client 比例(設定頁 / 框選層顯示「目前區域」用;使用者沒框過時 main 用的就是這一塊) */
export function defaultStripRegion (clientW: number, clientH: number): { x: number, y: number, w: number, h: number } {
  const s = stripRect(clientH)
  return { x: s.x / clientW, y: s.y / clientH, w: s.w / clientW, h: s.h / clientH }
}

/** 倉庫頁在資料夾內時,整個內容下移(Exile-UI `in_folder` = +47 / 1440) */
export function folderOffset (clientH: number): number {
  return at(47, clientH)
}

/**
 * 子頁按鈕可能出現的範圍(client 像素):x 0 – h × 37/60、y 120 – 268 / 1440。
 * 使用者自訂 OCR 區域的上限(框太大 → 整張 ×3 OCR、也截到自己的徽章)。下緣不加資料夾偏移:資料夾內按鈕文字下緣約 260 仍在內,
 * 再往下是格子區(實機截圖:122–268 繁中 / 資料夾 / 英文都認到 ≥ 3 顆)。
 */
export function stripZone (clientW: number, clientH: number): Rect {
  const y = at(120, clientH)
  return { x: 0, y, w: Math.min(Math.max(0, clientW), Math.floor(clientH * 37 / 60)), h: at(268, clientH) - y }
}

/** 四個按鈕槽(左到右;3.30 少一顆時最右那槽是空的) */
export function buttonRects (clientH: number, yOffset = 0): [Rect, Rect, Rect, Rect] {
  const y = at(186, clientH) + yOffset
  const w = at(152, clientH)
  const h = at(36, clientH)
  const r = (k: number): Rect => ({ x: at(116 + 168 * k, clientH), y, w, h })
  return [r(0), r(1), r(2), r(3)]
}

export interface ButtonMatch {
  found: boolean
  /** 命中的按鈕顆數(0–3) */
  matched: number
  /** 整體下移量(client 像素;0 或 `folderOffset`) */
  yOffset: number
  /** 命中的按鈕槽(0–3,左到右遞增;沒找到 = []) */
  slots: number[]
}

/** 按鈕文字的垂直中心(1440 基準;真實錄影量到 199.6–202.6) */
const TEXT_CENTER_Y = 201
const X_TOLERANCE = 40
const SNAP_TOLERANCE = 12

/**
 * 按鈕文字 → 碎片頁開著?(2026-11-07 放寬,為 3.30 拿掉聖甲蟲按鈕預作準備)
 * 每個標籤可落在四個按鈕槽任一個(x 容差 40/1440),命中的槽位要照標籤順序左到右遞增、至少 `MIN_BUTTONS` 顆;
 * 「一般」只能在最左那槽。文字高度推資料夾偏移(同前)。
 */
export function findSubtabButtons (lines: readonly TextLine[], clientH: number, lang: StashTextLang): ButtonMatch {
  const labels = SUBTAB_LABELS[lang]
  const centersX = buttonRects(clientH, 0).map(r => r.x + r.w / 2)
  const xTol = X_TOLERANCE / BASE * clientH
  const tol = SNAP_TOLERANCE / BASE * clientH
  const rowYs = [0, folderOffset(clientH)].map(off => TEXT_CENTER_Y / BASE * clientH + off)
  const hits: Array<{ slot: number, cy: number, k: number }> = []
  for (let k = 0; k < labels.length; k++) {
    let best: { slot: number, cy: number, d: number } | null = null
    for (const l of lines) {
      // 不分大小寫:英文介面的按鈕是小型大寫字,OCR 讀成全大寫(GENERAL / ALLFLAME…;使用者實機截圖,2026-10-14)
      if (l.text.replace(/\s+/g, '').toUpperCase() !== labels[k].toUpperCase()) continue
      // 只收按鈕列高度(不在 / 在資料夾內)的文字:自訂區域可能框到頁籤列,同名頁籤(「一般」)不可搶走槽位(code review 2026-11-07)
      const cy = l.y + l.h / 2
      if (!rowYs.some(y => Math.abs(cy - y) <= tol)) continue
      const cx = l.x + l.w / 2
      for (let slot = 0; slot < BUTTON_SLOTS; slot++) {
        const d = Math.abs(cx - centersX[slot])
        if (d <= xTol && (!best || d < best.d)) best = { slot, cy: l.y + l.h / 2, d }
      }
    }
    if (!best) continue
    hits.push({ slot: best.slot, cy: best.cy, k })
  }
  const matched = hits.length
  // 失敗也照實回報 matched:stash-scan 只在 matched > 0 時記「沒找到子頁按鈕」與 OCR 文字(3.30 實機回報查原因用)
  const fail = { found: false, matched, yOffset: 0, slots: [] }
  if (hits.some(h => h.k === 0 && h.slot !== GENERAL_SLOT)) return fail
  if (matched < MIN_BUTTONS) return fail
  for (let i = 1; i < matched; i++) if (hits[i].slot <= hits[i - 1].slot) return fail
  const centers = hits.map(h => h.cy).sort((a, b) => a - b)
  const median = matched % 2 ? centers[(matched - 1) / 2] : (centers[matched / 2 - 1] + centers[matched / 2]) / 2
  const raw = median - TEXT_CENTER_Y / BASE * clientH
  for (const snap of [0, folderOffset(clientH)]) {
    if (Math.abs(raw - snap) <= tol) return { found: true, matched, yOffset: snap, slots: hits.map(h => h.slot) }
  }
  return fail
}

export function percentile (gray: Uint8Array, q: number): number {
  if (!gray.length) return 0
  const s = Array.from(gray).sort((a, b) => a - b)
  return s[Math.floor(q * (s.length - 1))]
}

/** 子頁判定要比亮度的按鈕槽:「一般」那槽 + 其他有認到文字的槽(3.30 空著的槽不比) */
export function compareSlots (match: ButtonMatch): number[] {
  return [GENERAL_SLOT, ...match.slots.filter(s => s !== GENERAL_SLOT)]
}

/** 目前子頁的按鈕文字較亮(真實錄影:p99 158–162 vs 其他 141–144) */
const ACTIVE_MARGIN = 8

/**
 * p99 依 `compareSlots` 的順序:[一般, ...其他有文字的槽]。一般比其他每一顆都亮 ≥ 8 → 'general';
 * 其他子頁(3.29 的聖甲蟲 / 不滅之火、異能)或判不出 → null(不畫)。
 */
export function activeSubtab (p99: readonly number[]): StashSubtab | null {
  if (p99.length < 2) return null
  const second = Math.max(...p99.slice(1))
  return p99[0] - second >= ACTIVE_MARGIN ? 'general' : null
}
