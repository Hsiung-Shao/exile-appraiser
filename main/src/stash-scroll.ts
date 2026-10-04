/**
 * 倉庫頁籤捲動:遊戲在前景時 Ctrl + 滾輪 → 送 ← / → 切換倉庫頁籤(2026-10-01,第 15 步,使用者核准、預設開)。
 *
 * 移植自 Awakened PoE Trade `main/src/shortcuts/Shortcuts.ts`(MIT,Copyright (c) 2020 Alexander Drozdov)
 * 的 `uIOhook.on('wheel', …)` 與 `isStashArea`;`uiSidebarWidth` 取自同專案 `main/src/windowing/GameWindow.ts`。
 * Exiled Exchange 2(PoE2)上游兩者逐字相同(ee2-patched `main/src/shortcuts/Shortcuts.ts` / `GameWindow.ts`),PoE2 沿用同一組比例。
 *
 * 規則(與 APT 相同):
 * - 只在 Ctrl 按著、遊戲視窗在前景(`GameWindow.isActive`)、開關開著時處理。
 * - 游標在倉庫格子區(遊戲 client 左側 370/600 × 高度寬的側欄內,且 y 在高度 154/1600 ~ 1192/1600 之間)→ 不送(交給遊戲)。
 * - 其他位置:rotation > 0(滾輪往下)→ ArrowRight、< 0 → ArrowLeft、0 → 不送。
 * - overlay 取得焦點(查價面板可點擊 / 設定開著)時 `isActive` 已是 false → 不觸發,不干擾面板內的滾動。
 *
 * exile-appraiser:
 * - 判斷寫成純函式 `stashScrollKey`(有測試),`StashScroll` 只做接線。
 * - **只在 overlay 模式**建立(window 模式沒有遊戲視窗可追)。
 * - uiohook 掛鉤(`uiohook-gate.ts`)折衷:功能開著時,遊戲在前景期間 acquire 一份;失焦 / 遊戲視窗 detach / 功能關閉 /
 *   dispose 時 release。關閉時完全維持第 5 步行為(只有查價面板追蹤期間才開掛鉤)。gate 歸零後延遲 5 秒才 stop,前景抖動不會頻繁 start / stop。
 * - 送鍵用注入的 `tap`(main.ts 給 uiohook `keyTap`);**單元測試只給假的 tap,不送任何真實輸入**。
 * - **第五輪 30.1(使用者裁定)**:有 `ctrl` 來源(`ctrl-watch.ts`,不靠掛鉤輪詢 Ctrl)時,改成「開著 + 遊戲前景 + **按住 Ctrl**」才持有掛鉤,
 *   放開 Ctrl / 失焦 / detach 就 release(gate 歸零後照樣延遲 5 秒 stop,連續 Ctrl + 滾輪不會反覆 start / stop)。
 *   只有遊戲前景 + 功能開著時才請 `ctrl` 來源輪詢(`setWanted`)。`ctrl` 回報 `unavailable`(沒有 PowerShell 等)→ 退回上一條的舊行為。
 *   掛鉤開始時 libuiohook 以 `GetAsyncKeyState` 初始化修飾鍵(`initialize_modifiers`),所以先按 Ctrl 再開掛鉤,wheel 事件的 `ctrlKey` 仍正確。
 * - **第 33 步**:正則書籤一鍵貼進遊戲會自己送 Ctrl+F / Ctrl+V(`regex-paste.ts`),Ctrl 輪詢器看得到這個 Ctrl。
 *   送鍵期間 `quietCtrl(true)` → 掛鉤持有狀態凍結在當下(不因自己送的 Ctrl 去 acquire / release),`quietCtrl(false)` 後照實際 Ctrl 重新判斷。
 */
import type { CtrlState } from './ctrl-watch'

export type StashScrollKey = 'ArrowRight' | 'ArrowLeft'

export interface StashBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WheelLike {
  x: number
  y: number
  rotation: number
  ctrlKey: boolean
}

/** 遊戲側欄(倉庫)寬(APT `GameWindow.uiSidebarWidth`:800×600 時 370 px,依高度等比) */
export function stashSidebarWidth (height: number): number {
  return Math.round(height * 370 / 600)
}

/** 游標是否在倉庫格子區(APT `isStashArea`;座標 = 螢幕實體像素,bounds = 遊戲 client 區) */
export function isStashArea (mouse: { x: number, y: number }, bounds: StashBounds | null | undefined): boolean {
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return false
  if (mouse.x > bounds.x + stashSidebarWidth(bounds.height)) return false
  return mouse.y > bounds.y + bounds.height * 154 / 1600 &&
    mouse.y < bounds.y + bounds.height * 1192 / 1600
}

/** 這次滾輪事件要送的鍵;不送回 null */
export function stashScrollKey (
  e: WheelLike,
  s: { enabled: boolean, gameActive: boolean, bounds: StashBounds | null | undefined }
): StashScrollKey | null {
  if (!e.ctrlKey || !s.gameActive || !s.enabled) return null
  if (isStashArea(e, s.bounds)) return null
  if (e.rotation > 0) return 'ArrowRight'
  if (e.rotation < 0) return 'ArrowLeft'
  return null
}

export interface StashScrollGame {
  readonly isActive: boolean
  readonly bounds: StashBounds | null | undefined
  on: (event: 'active-change', listener: (isActive: boolean) => void) => unknown
}

/** 第五輪 30.1:要不要持有 uiohook 掛鉤(純函式)。`ctrl` 省略 = 沒有 Ctrl 來源 = 改版前行為(前景期間一直持有) */
export function stashScrollShouldHold (s: {
  disposed: boolean
  enabled: boolean
  detached: boolean
  gameActive: boolean
  ctrl?: CtrlState
  /** 第 33 步:自己送鍵中(忽略 Ctrl 變化,維持 `held`) */
  quiet?: boolean
  /** 目前是否持有(`quiet` 時沿用) */
  held?: boolean
}): boolean {
  if (s.disposed || !s.enabled || s.detached || !s.gameActive) return false
  if (s.ctrl == null || s.ctrl === 'unavailable') return true
  if (s.quiet) return s.held ?? false
  return s.ctrl === 'down'
}

/** 第五輪 30.1:Ctrl 狀態來源(`ctrl-watch.ts` `CtrlWatcher`) */
export interface StashCtrlSource {
  readonly state: CtrlState
  setWanted: (on: boolean) => void
  onState: (fn: (s: CtrlState) => void) => void
}

export interface StashScrollDeps {
  game: StashScrollGame
  gate: { acquire: () => void, release: () => void }
  /** 註冊 uiohook 'wheel' 監聽(只在建構時呼叫一次;掛鉤沒在跑時不會有事件) */
  onWheel: (fn: (e: WheelLike) => void) => void
  /** 遊戲視窗 attach / detach(electron-overlay-window);detach 不一定伴隨 blur,所以另外聽 */
  onAttach?: (fn: () => void) => void
  onDetach?: (fn: () => void) => void
  tap: (key: StashScrollKey) => void
  /** 第五輪 30.1:Ctrl 狀態來源;省略 = 遊戲前景期間一直持有(改版前) */
  ctrl?: StashCtrlSource
  log?: (msg: string) => void
}

export class StashScroll {
  private enabled = false
  private detached = false
  private held = false
  private disposed = false
  /** 第 33 步:自己送鍵中(正則書籤貼上) */
  private quiet = false
  private readonly log: (msg: string) => void

  constructor (private readonly deps: StashScrollDeps) {
    this.log = deps.log ?? ((msg) => { console.log(msg) })
    deps.game.on('active-change', () => { this.sync() })
    deps.onAttach?.(() => { this.detached = false; this.sync() })
    deps.onDetach?.(() => { this.detached = true; this.sync() })
    deps.onWheel((e) => { this.handleWheel(e) })
    deps.ctrl?.onState(() => { this.sync() })
  }

  /** host-config:`stashScroll !== false`(只在 overlay 模式建立本物件) */
  setEnabled (enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.log(`[stash-scroll] ${enabled ? '開啟' : '關閉'}`)
    this.sync()
  }

  /** 結束 / 重新啟動前:放掉持有的掛鉤,之後不再 acquire */
  dispose (): void {
    this.disposed = true
    this.sync()
  }

  /** 第 33 步:自己送 Ctrl 組合鍵期間凍結掛鉤持有狀態;結束後照實際 Ctrl 重新判斷 */
  quietCtrl (on: boolean): void {
    if (this.quiet === on) return
    this.quiet = on
    if (!on) this.sync()
  }

  /** 目前是否持有 uiohook 掛鉤 */
  get holding (): boolean { return this.held }

  private get shouldHold (): boolean {
    return stashScrollShouldHold({
      disposed: this.disposed,
      enabled: this.enabled,
      detached: this.detached,
      gameActive: this.deps.game.isActive,
      ctrl: this.deps.ctrl?.state,
      quiet: this.quiet,
      held: this.held
    })
  }

  private sync (): void {
    // 只有遊戲前景 + 功能開著時才需要知道 Ctrl(其他時候輪詢器停著,閒置一段時間後關掉)
    this.deps.ctrl?.setWanted(!this.disposed && this.enabled && !this.detached && this.deps.game.isActive)
    const want = this.shouldHold
    if (want === this.held) return
    this.held = want
    if (want) this.deps.gate.acquire()
    else this.deps.gate.release()
  }

  private handleWheel (e: WheelLike): void {
    const key = stashScrollKey(e, {
      enabled: this.enabled && !this.disposed && !this.detached,
      gameActive: this.deps.game.isActive,
      bounds: this.deps.game.bounds
    })
    if (key) this.deps.tap(key)
  }
}
