/**
 * 第 33 步:正則書籤快捷存取的純函式(不 import Vue / DOM;`renderer/test/regex-quick.test.ts` 測)。
 * - `placeBookmarkBar`:設定視窗旁那排書籤擺哪裡(跟第 21 步設定視窗的位置 / 大小走,不重疊、不超出 overlay)。
 * - `quickPanelKey`:快速面板的鍵盤操作(上下 / Home / End / PageUp / PageDown / Enter / Esc / 1–9)。
 * - `quickNoticeKey`:只複製沒貼上時的提示字串鍵(`ppz.regex.quick_reason_*`)。
 */

export interface Rect { x: number, y: number, w: number, h: number }
export interface Size { w: number, h: number }

export type BarSide = 'right' | 'left' | 'top' | 'bottom' | 'none'

export interface BarPlacement {
  side: BarSide
  /** 直排(左右兩側)或橫排(上下) */
  dir: 'column' | 'row'
  x: number
  y: number
  w: number
  h: number
  /** 內容放不下(直排:書籤列比可用高度高)→ 捲動 */
  scroll: boolean
}

/** 書籤列與設定視窗的間距、離 overlay 邊緣的最小距離(CSS px) */
export const BAR_GAP = 8
export const BAR_MARGIN = 8

export interface BarWant {
  /** 直排寬 */
  colW: number
  /** 直排內容的自然高度(標題 + 全部書籤) */
  colH: number
  /** 直排至少要多高才值得放(標題 + 約兩列) */
  minColH: number
  /** 橫排高 */
  rowH: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * 依設定視窗(`win`,相對 overlay 的 CSS px)與 overlay 大小(`view`)決定書籤列的位置:
 * 1. 右側放得下直排(寬 colW、高至少 minColH)→ 右側,頂端對齊設定視窗、往上推到不超出畫面;內容比可用高度高 → 捲動。
 * 2. 否則左側(同規則)。
 * 3. 否則設定視窗上方一條橫排(寬 = 設定視窗寬,橫向捲動);再不行下方。
 * 4. 四邊都沒空間(設定視窗幾乎佔滿 overlay)→ `none`(不顯示,避免蓋住設定視窗)。
 */
export function placeBookmarkBar (win: Rect, view: Size, want: BarWant, gap = BAR_GAP, margin = BAR_MARGIN): BarPlacement {
  const availH = Math.max(0, view.h - margin * 2)
  const right = view.w - (win.x + win.w) - gap - margin
  const left = win.x - gap - margin
  const top = win.y - gap - margin
  const bottom = view.h - (win.y + win.h) - gap - margin
  const colOk = availH >= want.minColH
  const column = (side: 'right' | 'left'): BarPlacement => {
    const h = Math.min(want.colH, availH)
    const y = clamp(win.y, margin, view.h - margin - h)
    const x = side === 'right' ? win.x + win.w + gap : win.x - gap - want.colW
    return { side, dir: 'column', x: Math.round(x), y: Math.round(y), w: Math.round(want.colW), h: Math.round(h), scroll: want.colH > h }
  }
  if (colOk && right >= want.colW) return column('right')
  if (colOk && left >= want.colW) return column('left')
  const row = (side: 'top' | 'bottom'): BarPlacement => {
    const w = Math.min(win.w, view.w - margin * 2)
    const x = clamp(win.x, margin, view.w - margin - w)
    const y = side === 'top' ? win.y - gap - want.rowH : win.y + win.h + gap
    return { side, dir: 'row', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(want.rowH), scroll: true }
  }
  if (top >= want.rowH) return row('top')
  if (bottom >= want.rowH) return row('bottom')
  return { side: 'none', dir: 'row', x: 0, y: 0, w: 0, h: 0, scroll: false }
}

/** 兩個矩形是否重疊(測試 / 守門用;相鄰不算) */
export function rectsOverlap (a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export interface QuickKeyResult {
  sel: number
  /** run = 執行目前選的;close = 關閉;null = 只移動選擇或不處理 */
  action: 'run' | 'close' | null
  /** 這個鍵有沒有被面板用掉(用掉的要 preventDefault) */
  handled: boolean
}

/** 快速面板的鍵盤操作。`sel` = 目前選的列(沒有書籤時 -1);上下循環、Home / End、PageUp / PageDown 跳 5 列(不循環)、1–9 直接執行第 N 筆 */
export function quickPanelKey (sel: number, count: number, key: string): QuickKeyResult {
  if (key === 'Escape') return { sel, action: 'close', handled: true }
  if (count <= 0) return { sel: -1, action: null, handled: key === 'Enter' || key.startsWith('Arrow') }
  const cur = sel >= 0 && sel < count ? sel : 0
  switch (key) {
    case 'ArrowDown': return { sel: sel < 0 ? 0 : (cur + 1) % count, action: null, handled: true }
    case 'ArrowUp': return { sel: sel < 0 ? count - 1 : (cur - 1 + count) % count, action: null, handled: true }
    case 'Home': return { sel: 0, action: null, handled: true }
    case 'End': return { sel: count - 1, action: null, handled: true }
    case 'PageDown': return { sel: Math.min(count - 1, cur + 5), action: null, handled: true }
    case 'PageUp': return { sel: Math.max(0, cur - 5), action: null, handled: true }
    case 'Enter': return { sel: cur, action: 'run', handled: true }
  }
  if (/^[1-9]$/.test(key)) {
    const n = Number(key) - 1
    return n < count ? { sel: n, action: 'run', handled: true } : { sel: cur, action: null, handled: true }
  }
  return { sel: cur, action: null, handled: false }
}

/** 執行結果(main `RegexPasteResult` 加上 renderer 端才有的原因) */
export type QuickReason = 'window-mode' | 'no-game' | 'game-inactive' | 'focus-timeout' | 'busy' | 'empty' | 'missing' | 'preview' | 'copy-failed'

export interface QuickOutcome {
  pasted: boolean
  copied: boolean
  reason?: QuickReason
}

/** 沒貼上時的提示字串鍵(貼上了 = null:設定 / 面板已關、焦點在遊戲) */
export function quickNoticeKey (o: QuickOutcome): string | null {
  if (o.pasted) return null
  return `ppz.regex.quick_reason_${(o.reason ?? 'copy-failed').replace(/-/g, '_')}`
}

/** 全部原因(i18n 守門用) */
export const QUICK_REASONS: readonly QuickReason[] = ['window-mode', 'no-game', 'game-inactive', 'focus-timeout', 'busy', 'empty', 'missing', 'preview', 'copy-failed']
