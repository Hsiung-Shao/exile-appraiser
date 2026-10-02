/**
 * 設定視窗的大小 / 位置與獨立字級(第 21 步,2026-10-02;使用者裁定:拖曳邊角調整並記住、設定視窗獨立字級)。
 * 全部是純函式 / 小型狀態機,不碰 DOM 與 Vue,單元測試在 `renderer/test/settings-window-geom.test.ts`。
 *
 * - `SettingsWindowRect`(CSS px,相對 overlay 左上角)只在 overlay 模式套用;null = 現行置中預設。
 * - 夾回(`clampSettingsRect`)只影響顯示,不回寫設定:換解析度 / DPI 縮小後又放大時,原本記住的大小還在。
 * - 字級 `settingsFontSize`(11–24 px,null = 跟隨全域 fsBase)只作用在設定視窗根元素:
 *   根元素重定義 `--fs-base` 與由它推導的 `--fs-*`(pobtools.css 的 `--fs-*` 在 :root 就算好了,
 *   只改 `--fs-base` 子元素拿到的 `--fs-xs` 等仍是全域值,所以要整組重定義,見 `settingsFsVars`)。
 */

export interface SettingsWindowRect {
  w: number
  h: number
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

/** 最小大小(CSS px);overlay 比它小時改成填滿 overlay */
export const SETTINGS_MIN_W = 480
export const SETTINGS_MIN_H = 360

export const SETTINGS_FS_MIN = 11
export const SETTINGS_FS_MAX = 24

const MIN: Size = { w: SETTINGS_MIN_W, h: SETTINGS_MIN_H }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 設定檔讀進來的值 → 合法矩形或 null(壞值 / 缺欄 = null = 置中預設;太小的拉到最小值;取整數) */
export function normSettingsWindow (v: unknown): SettingsWindowRect | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!finite(o.w) || !finite(o.h) || !finite(o.x) || !finite(o.y)) return null
  if (o.w <= 0 || o.h <= 0) return null
  // 荒謬的大數(手改設定檔)當成沒設
  if (Math.abs(o.x) > 100000 || Math.abs(o.y) > 100000 || o.w > 100000 || o.h > 100000) return null
  return {
    w: Math.max(SETTINGS_MIN_W, Math.round(o.w)),
    h: Math.max(SETTINGS_MIN_H, Math.round(o.h)),
    x: Math.round(o.x),
    y: Math.round(o.y)
  }
}

/** 設定檔讀進來的字級 → 11–24 的整數或 null(跟隨) */
export function normSettingsFontSize (v: unknown): number | null {
  if (!finite(v)) return null
  return Math.min(SETTINGS_FS_MAX, Math.max(SETTINGS_FS_MIN, Math.round(v)))
}

/**
 * 把矩形夾進 overlay 可視範圍(view = overlay 的 CSS 寬高)。
 * 大小:不小於最小值(view 比最小值小時 = view)、不大於 view;位置:整個視窗留在 view 內(負座標 / 超出都推回)。
 */
export function clampSettingsRect (r: SettingsWindowRect, view: Size, min: Size = MIN): SettingsWindowRect {
  const vw = Math.max(0, Math.floor(view.w))
  const vh = Math.max(0, Math.floor(view.h))
  const w = Math.round(Math.min(vw, Math.max(Math.min(min.w, vw), r.w)))
  const h = Math.round(Math.min(vh, Math.max(Math.min(min.h, vh), r.h)))
  const x = Math.round(Math.min(vw - w, Math.max(0, r.x)))
  const y = Math.round(Math.min(vh - h, Math.max(0, r.y)))
  return { w, h, x, y }
}

/** 拖曳的把手:move = 標題列;其餘 = 四邊 + 四角 */
export type DragEdge = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const RESIZE_EDGES: readonly DragEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** 把手對應的游標 */
export function edgeCursor (edge: DragEdge): string {
  switch (edge) {
    case 'n': case 's': return 'ns-resize'
    case 'e': case 'w': return 'ew-resize'
    case 'ne': case 'sw': return 'nesw-resize'
    case 'nw': case 'se': return 'nwse-resize'
    default: return 'move'
  }
}

/**
 * 拖曳中的矩形:從開始時的矩形 `start` 依把手與位移(dx, dy)算出,再夾進 view。
 * 拉左 / 上邊時固定對邊(右 / 下)不動 —— 縮到最小值後再拉,視窗不會被推著走。
 */
export function dragRect (start: SettingsWindowRect, edge: DragEdge, dx: number, dy: number, view: Size, min: Size = MIN): SettingsWindowRect {
  if (edge === 'move') return clampSettingsRect({ ...start, x: start.x + dx, y: start.y + dy }, view, min)
  const vw = Math.max(0, Math.floor(view.w))
  const vh = Math.max(0, Math.floor(view.h))
  const minW = Math.min(min.w, vw)
  const minH = Math.min(min.h, vh)
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (edge.includes('w')) left = Math.max(0, Math.min(right - minW, start.x + dx))
  if (edge.includes('e')) right = Math.min(vw, Math.max(left + minW, start.x + start.w + dx))
  if (edge.includes('n')) top = Math.max(0, Math.min(bottom - minH, start.y + dy))
  if (edge.includes('s')) bottom = Math.min(vh, Math.max(top + minH, start.y + start.h + dy))
  return clampSettingsRect({ x: left, y: top, w: right - left, h: bottom - top }, view, min)
}

/**
 * 拖曳狀態機(元件用 pointer events 驅動):拖曳中只更新 live(畫面),`end` 時才呼叫 onCommit 一次
 * = 拖曳結束才寫設定,不每幀寫;沒動(只是點一下)不寫。`cancel`(pointercancel / 失焦)不寫。
 */
export interface RectDrag {
  readonly active: boolean
  /** 拖曳中的即時矩形(沒在拖 = null) */
  readonly live: SettingsWindowRect | null
  start (edge: DragEdge, rect: SettingsWindowRect, px: number, py: number, view: Size): void
  move (px: number, py: number): SettingsWindowRect | null
  end (px?: number, py?: number): SettingsWindowRect | null
  cancel (): void
}

export function createRectDrag (onCommit: (r: SettingsWindowRect) => void, onLive?: (r: SettingsWindowRect | null) => void): RectDrag {
  let st: { edge: DragEdge, rect: SettingsWindowRect, px: number, py: number, view: Size } | null = null
  let live: SettingsWindowRect | null = null
  const setLive = (r: SettingsWindowRect | null) => { live = r; onLive?.(r) }
  return {
    get active () { return st !== null },
    get live () { return live },
    start (edge, rect, px, py, view) {
      st = { edge, rect: { ...rect }, px, py, view: { ...view } }
      setLive({ ...rect })
    },
    move (px, py) {
      if (!st) return null
      const r = dragRect(st.rect, st.edge, px - st.px, py - st.py, st.view)
      setLive(r)
      return r
    },
    end (px, py) {
      if (!st) return null
      const r = px !== undefined && py !== undefined ? dragRect(st.rect, st.edge, px - st.px, py - st.py, st.view) : (live ?? st.rect)
      const moved = r.x !== st.rect.x || r.y !== st.rect.y || r.w !== st.rect.w || r.h !== st.rect.h
      st = null
      setLive(null)
      if (moved) onCommit(r)
      return moved ? r : null
    },
    cancel () {
      st = null
      setLive(null)
    }
  }
}

/** 標題列按下的目標是不是按鈕 / 輸入元件(在它們上面按下不開始移動) */
export function isInteractiveTarget (el: { closest?: (sel: string) => unknown } | null): boolean {
  if (!el || typeof el.closest !== 'function') return false
  return el.closest('button, input, select, textarea, a, label, [role="button"], [data-no-drag]') != null
}

/**
 * 點暗幕關閉的判斷:按下(pointerdown)與 click 的目標都是暗幕本身才關。
 * 在視窗內按下(含標題列移動、邊角調整大小)、拖到暗幕上放開 → click 的 target 是共同祖先 = 暗幕,
 * 靠「按下時在不在暗幕上」擋下;調整大小用 setPointerCapture,click 落在把手上,也不會是暗幕。
 */
export function createBackdropGuard () {
  let pressedOnBackdrop = false
  return {
    down (targetIsBackdrop: boolean) { pressedOnBackdrop = targetIsBackdrop },
    /** click 時呼叫;回傳 true = 該關 */
    click (targetIsBackdrop: boolean): boolean {
      const close = pressedOnBackdrop && targetIsBackdrop
      pressedOnBackdrop = false
      return close
    }
  }
}

// ---- 獨立字級 ----

/** 有效字級:null = 跟隨全域 */
export function effectiveSettingsFs (own: number | null, globalFs: number): number {
  return own ?? globalFs
}

/**
 * 設定視窗根元素要寫的 CSS 變數(inline style);跟隨全域 → null(不輸出任何東西 = 與改版前逐像素相同)。
 * `--fs-*` 公式與 pobtools.css `:root` 相同;`--app-fs-base` = 全域字級,給「不該跟著縮放的東西」
 * (浮動視窗預設大小、徽章外觀預覽)用。根元素的 `font-size` 由 CSS `.settings-window.fs-own` 設,
 * 不放進這裡:同一組變數也綁在設定視窗 Teleport 到 body 的提示框 / 對話框上,那些元素有自己的 font-size。
 */
export function settingsFsVars (own: number | null, globalFs: number): Record<string, string> | null {
  const fs = normSettingsFontSize(own)
  if (fs == null) return null
  return {
    '--fs-base': `${fs}px`,
    '--fs-2xs': `${fs - 3}px`,
    '--fs-xs': `${fs - 2}px`,
    '--fs-sm': `${fs - 1}px`,
    '--fs-md': `${fs}px`,
    '--fs-lg': `${fs + 2}px`,
    '--fs-xl': `${fs + 7}px`,
    '--app-fs-base': `${globalFs}px`
  }
}

/**
 * 有獨立字級(`settingsFsVars` 不是 null)→ 'fs-own'(code review 第 C 批):設定視窗根元素與 Teleport 到 body 的
 * Regex 對話框 / 提示框都加,共用控制項的補高規則(SettingsWindow.vue `:is(.settings-window, .rx-modal, .rx-tip).fs-own`)才套得到。
 */
export function settingsFsClass (vars: Record<string, string> | null | undefined): 'fs-own' | undefined {
  return vars != null ? 'fs-own' : undefined
}

/** 快速調整:+1 / −1(從目前有效字級起算,夾在 11–24);reset → null(跟隨) */
export function stepSettingsFs (own: number | null, globalFs: number, action: 'inc' | 'dec' | 'reset'): number | null {
  if (action === 'reset') return null
  const cur = effectiveSettingsFs(own, globalFs)
  return normSettingsFontSize(cur + (action === 'inc' ? 1 : -1))
}

export interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey?: boolean
}

/** Ctrl + = / + / − / 0(含數字鍵盤)→ 動作;其他(含 Alt / Meta 組合)→ null */
export function settingsFsShortcut (e: KeyLike): 'inc' | 'dec' | 'reset' | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null
  if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') return 'inc'
  if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') return 'dec'
  if (!e.shiftKey && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) return 'reset'
  return null
}

/** Ctrl + 滾輪 → 動作(往上 = 放大);deltaY 0 → null */
export function settingsFsWheel (e: { ctrlKey: boolean, altKey: boolean, metaKey: boolean, deltaY: number }): 'inc' | 'dec' | null {
  if (!e.ctrlKey || e.altKey || e.metaKey || e.deltaY === 0) return null
  return e.deltaY < 0 ? 'inc' : 'dec'
}
