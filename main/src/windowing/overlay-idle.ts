/**
 * 第五輪 30.4:overlay 視窗閒置隱藏(docs/perf/changes-round5.md 30.4)。
 *
 * electron-overlay-window 的 JS 層在遊戲 attach / focus 時 `showInactive()` 一個**全尺寸、透明、置頂**的視窗疊在遊戲上,
 * 即使查價面板關著、畫面上什麼都沒有也一直在 —— DWM 要合成它,遊戲也因為被視窗蓋住而失去獨占翻頁(independent flip / MPO)。
 * 這裡在「遊戲前景但 overlay 上沒有東西要畫」時把它 `hide()`,有東西要畫時 `showInactive()`(不搶焦點)。
 *
 * **為什麼選 `hide()` 而不是 `setOpacity(0)` / 縮成 1×1**(讀過 `electron-overlay-window` 4.1.0 `dist/index.js` 與 `src/lib/windows.c`):
 * - 原生 hook thread 追蹤的是**遊戲**視窗(前景 / 標題 / 位置事件),與 overlay 視窗顯示與否無關 → attach、focus / blur、moveresize、
 *   原生 `screenshot()`(BitBlt 遊戲 client)都不受影響;熱鍵是 `globalShortcut` / uiohook,也與視窗顯示無關。
 * - `setOpacity(0)` 的視窗仍在 DWM 合成清單裡、仍蓋在遊戲上(省不到 DWM / 獨占翻頁,這正是要省的);縮成 1×1 會跟套件的
 *   `updateOverlayBounds`(moveresize 時把大小設回遊戲大小)打架,也會打亂 renderer 的面板座標(`window.screenX` / `innerWidth`)。
 * - `hide()` 的視窗不參與合成;套件自己在遊戲 blur / detach 時本來就 `hide()`、focus 時 `showInactive()` + `setAlwaysOnTop('screen-saver')`,
 *   我們重新顯示時照它的做法(同一組呼叫);點擊穿透(`setIgnoreMouseEvents`)是視窗樣式,hide / show 不會改變。
 *
 * 與套件共處的規則(避免互相打架):
 * - 只在**遊戲在前景**(`gameFocused`)時才自己藏;遊戲失焦 / detach → 交還給套件(清掉「是我們藏的」旗標、取消計時器)。
 * - 只重新顯示**我們自己藏的**視窗(`idleHidden`);套件藏的(遊戲不在前景)由套件在 focus 時顯示,不越權。
 * - overlay 取得焦點(`interactable`:鎖定查價、overlayKey 開設定、框選層、托盤設定)一律算「要顯示」,而且在
 *   `activateOverlay()`(對視窗 `focus()`)**之前**同步顯示(OverlayWindow 的 setter 先通知這裡)。
 * - 視窗被顯示(套件的 focus / attach,或我們)而目前沒有東西要畫 → 延遲 `hideDelayMs`(預設 500 ms)再藏:
 *   ① 快速切換(面板關了馬上又查價、徽章清掉又出現)不閃爍、不反覆 hide / show;② 藏之前 renderer 已把空白畫面畫出來,
 *   下次顯示時 DWM 留著的最後一幀是空的(不會閃出上一次的面板)。
 * - renderer 還沒回報(啟動 / 重新載入)= 當成要顯示(保守,不藏)。
 *
 * 純邏輯:不 import electron;視窗操作、遊戲前景、計時器全部注入(測試 `main/test/overlay-idle.test.ts` 用假時鐘)。
 */
import type { OverlayContentState } from '@ipc/types'

/** 延遲隱藏的預設時間 */
export const OVERLAY_IDLE_HIDE_DELAY_MS = 500

/** 第 33 步加 `quick`(正則書籤快速面板)、2026-10-08 加 `menu`(懸浮選單);舊 renderer 不送 = false */
const CONTENT_KEYS = ['panel', 'settings', 'picker', 'reveal', 'rune', 'quick', 'menu'] as const

/** renderer 回報的內容有沒有要畫的東西(null = 還沒回報 → 當成有,保守不藏) */
export function overlayContentWanted (c: OverlayContentState | null): boolean {
  if (c == null) return true
  return CONTENT_KEYS.some(k => c[k] === true)
}

/** 要不要顯示 overlay 視窗:overlay 取得焦點(可互動)或 renderer 有東西要畫 */
export function overlayWanted (c: OverlayContentState | null, interactable: boolean): boolean {
  return interactable || overlayContentWanted(c)
}

/** 回報內容的簡短描述(log 用):`panel+reveal` / `none` / `unknown` */
export function describeOverlayContent (c: OverlayContentState | null): string {
  if (c == null) return 'unknown'
  const on = CONTENT_KEYS.filter(k => c[k])
  return on.length ? on.join('+') : 'none'
}

/** 正規化 renderer 送來的回報(IPC 參數不可信;不是物件 = null,缺欄位 / 非 true = false) */
export function sanitizeOverlayContent (v: unknown): OverlayContentState | null {
  if (v == null || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    panel: o.panel === true,
    settings: o.settings === true,
    picker: o.picker === true,
    reveal: o.reveal === true,
    rune: o.rune === true,
    quick: o.quick === true,
    menu: o.menu === true
  }
}

export interface OverlayIdleWindow {
  isVisible: () => boolean
  hide: () => void
  /** 不搶焦點地顯示(main.ts:`showInactive()` + `setAlwaysOnTop(true, 'screen-saver')`,同 electron-overlay-window) */
  showInactive: () => void
}

export interface OverlayIdleDeps {
  win: OverlayIdleWindow
  /** 遊戲視窗在前景(electron-overlay-window `targetHasFocus`) */
  gameFocused: () => boolean
  hideDelayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
  log?: (msg: string) => void
}

export class OverlayIdleHider {
  private content: OverlayContentState | null = null
  private interactable = false
  /** 目前的隱藏是我們做的(遊戲在前景、沒有東西要畫);只有這種情況我們才負責再顯示 */
  private idleHidden = false
  private timer: unknown = null
  private readonly delay: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (t: unknown) => void
  private readonly log: (msg: string) => void
  /** 計數(測試 / log):自己藏了幾次、自己顯示了幾次 */
  readonly counts = { hides: 0, shows: 0 }

  constructor (private readonly deps: OverlayIdleDeps) {
    this.delay = deps.hideDelayMs ?? OVERLAY_IDLE_HIDE_DELAY_MS
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((t) => { clearTimeout(t as ReturnType<typeof setTimeout>) })
    this.log = deps.log ?? (() => {})
  }

  get wanted (): boolean { return overlayWanted(this.content, this.interactable) }
  get hiddenByIdle (): boolean { return this.idleHidden }
  get hidePending (): boolean { return this.timer != null }
  get lastContent (): OverlayContentState | null { return this.content }

  /** renderer 回報內容(IPC `overlay-content`);null = 重新載入中 / 還沒回報(當成要顯示) */
  setContent (c: OverlayContentState | null): void {
    this.content = c
    this.evaluate(`內容 ${describeOverlayContent(c)}`)
  }

  /** overlay 取得 / 交還焦點。取得時同步顯示(必須在 activateOverlay 的 focus() 之前呼叫) */
  setInteractable (v: boolean): void {
    if (this.interactable === v) return
    this.interactable = v
    this.evaluate(v ? 'overlay 取得焦點' : 'overlay 交還焦點')
  }

  /**
   * 熱鍵查價即將讀剪貼簿:我們藏著的話先顯示(renderer 在隱藏期間收不到視窗位置更新,先顯示讓它拿到最新的
   * `window.screenX` / 大小);讀不到物品 = 沒有東西要畫 → 照延遲規則再藏。
   */
  wake (reason: string): void {
    if (this.idleHidden) this.show(reason)
  }

  /** 視窗被顯示(BrowserWindow 'show':套件的 attach / focus,或我們自己) */
  onWindowShown (): void {
    this.idleHidden = false
    if (!this.wanted && this.deps.gameFocused()) this.scheduleHide()
  }

  /**
   * 遊戲取得前景(electron-overlay-window 'focus',套件的處理先跑完):視窗本來就顯示著(例如 overlay 交還焦點)時
   * 套件不會再 show → 不會有 onWindowShown,這裡補判斷要不要藏
   */
  onGameFocus (): void {
    this.evaluate('遊戲取得前景')
  }

  /** 遊戲失焦 / detach:套件會(已經)藏視窗,由它接手;取消我們的計時器與旗標 */
  onGameBlur (): void {
    this.cancelHide()
    this.idleHidden = false
  }

  dispose (): void {
    this.cancelHide()
  }

  private evaluate (reason: string): void {
    if (this.wanted) {
      this.cancelHide()
      if (this.idleHidden) this.show(reason)
      return
    }
    if (!this.idleHidden && this.deps.gameFocused() && this.deps.win.isVisible()) this.scheduleHide()
  }

  private show (reason: string): void {
    this.cancelHide()
    this.idleHidden = false
    // 遊戲已不在前景:交給套件(它在 focus 時會自己顯示);overlay 取得焦點時例外(必須在 focus() 之前顯示)
    if (!this.deps.gameFocused() && !this.interactable) return
    this.counts.shows++
    this.log(`[overlay] 顯示(${reason})`)
    this.deps.win.showInactive()
  }

  private scheduleHide (): void {
    if (this.timer != null) return
    this.timer = this.setTimer(() => {
      this.timer = null
      this.hideNow()
    }, this.delay)
  }

  private cancelHide (): void {
    if (this.timer == null) return
    this.clearTimer(this.timer)
    this.timer = null
  }

  private hideNow (): void {
    if (this.wanted || !this.deps.gameFocused() || !this.deps.win.isVisible()) return
    this.idleHidden = true
    this.counts.hides++
    this.log(`[overlay] 閒置隱藏(遊戲在前景、沒有要畫的東西:${describeOverlayContent(this.content)})`)
    this.deps.win.hide()
  }
}
