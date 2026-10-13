/**
 * PoE1 倉庫價格疊層:游標停在哪一格(renderer 據此只留該格徽章、放大顯示,不蓋住遊戲說明框)。
 * 只在「疊層顯示中 + 遊戲前景」時每 `intervalMs` 讀一次游標位置(`screen.getCursorScreenPoint` 由 main 注入,
 * 不裝鍵盤滑鼠掛鉤、不送任何輸入),換格才送事件;其他時候沒有計時器。
 * 另提供 `onCell()`:游標停在已顯示子頁的某一格(遊戲說明框只在游標停在物品格上才出現、可能蓋住子頁按鈕列
 * → 掃描沒找到按鈕時維持原狀);`inPanel()`(整個倉庫面板,含頁籤列)保留但不拿來維持(點別的倉庫頁籤時會誤留)。
 */
import type { StashCursorEvent } from '@ipc/types'
import { cellRects, hitCell, type CellRect, type StashLayoutFile, type StashSubtab } from '../../core/src/stash/layout'
import type { ScanClock } from './ocr/panel-scan'
import type { PhysRect } from './ocr/strategy'

export const STASH_CURSOR_INTERVAL_MS = 80

/** 倉庫面板範圍(client 像素;寬 = h × 37/60,與 Exile-UI 相同;下緣約 1040 / 1440) */
export function stashPanelContains (clientH: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < Math.floor(clientH * 37 / 60) && y < Math.floor(1040 / 1440 * clientH)
}

export interface StashCursorDeps {
  clock?: ScanClock
  /** 游標(螢幕實體像素) */
  cursor: () => { x: number, y: number }
  /** 遊戲 client(螢幕實體像素);沒綁定 = null */
  bounds: () => PhysRect | null
  /** 遊戲在前景 */
  active: () => boolean
  layouts: () => StashLayoutFile | null
  send: (e: StashCursorEvent) => void
  intervalMs?: number
}

const REAL_CLOCK: ScanClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => { clearTimeout(h as ReturnType<typeof setTimeout>) }
}

export class StashCursor {
  private readonly deps: StashCursorDeps
  private readonly clock: ScanClock
  private timer: unknown = null
  private state: { subtab: StashSubtab, yOffset: number, clientH: number } | null = null
  private cells: CellRect[] = []
  private last: string | null = null

  constructor (deps: StashCursorDeps) {
    this.deps = deps
    this.clock = deps.clock ?? REAL_CLOCK
  }

  /** 計時器有沒有在跑(測試 / perf 用) */
  get polling (): boolean { return this.timer != null }

  /** 疊層顯示狀態改變(null = 收起) */
  setShown (state: { subtab: StashSubtab, yOffset: number, clientH: number } | null): void {
    this.state = state
    const file = state ? this.deps.layouts() : null
    this.cells = state && file ? cellRects(file, state.subtab, state.clientH, state.yOffset) : []
    this.refresh()
  }

  /** 遊戲前景改變等:重新決定要不要輪詢 */
  refresh (): void {
    const want = this.state != null && this.cells.length > 0 && this.deps.active()
    if (want && this.timer == null) this.loop(0)
    if (!want) {
      if (this.timer != null) this.clock.clearTimeout(this.timer)
      this.timer = null
      this.publish(null)
    }
  }

  stop (): void {
    this.state = null
    this.cells = []
    this.refresh()
  }

  /** 游標在倉庫面板內(client 座標;沒有遊戲視窗 = 否) */
  inPanel (): boolean {
    const p = this.clientPoint()
    return p != null && stashPanelContains(p.h, p.x, p.y)
  }

  /** 游標停在已顯示子頁的某一格(疊層沒顯示 / 沒有遊戲視窗 = 否) */
  onCell (): boolean {
    if (!this.state || this.cells.length === 0) return false
    const p = this.clientPoint()
    return p != null && hitCell(this.cells, p.x, p.y) != null
  }

  private clientPoint (): { x: number, y: number, h: number } | null {
    const b = this.deps.bounds()
    if (!b || !(b.width > 0 && b.height > 0)) return null
    const c = this.deps.cursor()
    return { x: c.x - b.x, y: c.y - b.y, h: b.height }
  }

  private loop (ms: number): void {
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      if (!this.state || !this.deps.active()) { this.refresh(); return }
      const p = this.clientPoint()
      this.publish(p ? hitCell(this.cells, p.x, p.y)?.refName ?? null : null)
      this.loop(this.deps.intervalMs ?? STASH_CURSOR_INTERVAL_MS)
    }, ms)
  }

  private publish (refName: string | null): void {
    if (refName === this.last) return
    this.last = refName
    this.deps.send({ refName })
  }
}
