/**
 * APT 式懸浮選單(2026-10-08)的純函式:位置正規化 / 夾進畫面、速查表放大框、書籤列的遊戲切換規則。
 *
 * 位置存設定 `floatMenu: { x, y } | null`:選單左上角在 overlay(= 遊戲 client)內的比例 0–1;null = 左上角預設。
 * 換解析度 / DPI 時顯示前夾回畫面內(不回寫設定),拖曳放開才寫。
 */
import type { RegexGame } from '@exile-appraiser/regex'

export interface FloatMenuPos { x: number, y: number }

/** 預設位置(左上角,與 APT WidgetMenu 相同的 tl 錨點)的 CSS px 邊距 */
export const FLOAT_MENU_MARGIN = 24

/** 設定檔讀進來的值 → 合法位置(壞值 / 缺欄位 = null = 預設) */
export function normFloatMenuPos (v: unknown): FloatMenuPos | null {
  if (v == null || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
  return ok(o.x) && ok(o.y) ? { x: o.x, y: o.y } : null
}

/** 設定值 + 畫面 + 選單大小 → 實際 CSS px 左上角(夾進畫面,至少留 4 px;選單比畫面大 = 貼左上) */
export function floatMenuPlace (
  pos: FloatMenuPos | null,
  view: { w: number, h: number },
  menu: { w: number, h: number }
): { left: number, top: number } {
  const want = pos
    ? { left: pos.x * view.w, top: pos.y * view.h }
    : { left: FLOAT_MENU_MARGIN, top: FLOAT_MENU_MARGIN }
  const pad = 4
  const clamp = (v: number, size: number, max: number) => Math.round(Math.max(pad, Math.min(v, max - size - pad)))
  return { left: clamp(want.left, menu.w, view.w), top: clamp(want.top, menu.h, view.h) }
}

/** 拖曳後的 CSS px 左上角 → 存檔用比例(先夾進畫面;小數 4 位) */
export function floatMenuPosOf (
  place: { left: number, top: number },
  view: { w: number, h: number },
  menu: { w: number, h: number }
): FloatMenuPos {
  const p = floatMenuPlace({ x: place.left / Math.max(1, view.w), y: place.top / Math.max(1, view.h) }, view, menu)
  const r = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000
  return { x: r(p.left / Math.max(1, view.w)), y: r(p.top / Math.max(1, view.h)) }
}

/**
 * 速查表放大框:選單右側(選單在畫面右半 = 左側)到畫面邊緣,上下留邊。
 * 回傳 CSS px 矩形;圖片在框內等比例縮放(object-fit: contain)。
 */
export function sheetZoomRect (
  menu: { left: number, top: number, w: number, h: number },
  view: { w: number, h: number },
  gap = 16
): { left: number, top: number, w: number, h: number } {
  const margin = 24
  const rightSpace = view.w - (menu.left + menu.w) - gap - margin
  const leftSpace = menu.left - gap - margin
  const top = margin
  const h = Math.max(120, view.h - margin * 2)
  if (rightSpace >= leftSpace) {
    const left = menu.left + menu.w + gap
    return { left, top, w: Math.max(120, rightSpace), h }
  }
  return { left: margin, top, w: Math.max(120, leftSpace), h }
}

/** 書籤列:目前遊戲的書籤 = 貼進遊戲;另一代 = 只複製(貼進不是那款的遊戲沒有意義) */
export function bookmarkActionFor (listGame: RegexGame, currentGame: RegexGame): 'paste' | 'copy' {
  return listGame === currentGame ? 'paste' : 'copy'
}
