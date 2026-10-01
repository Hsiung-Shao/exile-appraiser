/**
 * uiohook 全域掛鉤的引用計數開關(效能修正第 5 步,2026-10-01)。
 *
 * 原本啟動就 `uIOhook.start()` 直到結束:掛鉤開著時,系統上每個滑鼠移動 / 按鍵都會在 main thread 經 threadsafe function
 * 建 JS 物件並 emit(`uiohook-napi/src/lib/addon.c` `dispatch_proc` / `tsfn_to_js_proxy`),不論有沒有監聽者。
 * 唯一的監聽者是 `WidgetAreaTracker`(查價面板開著時的 mousemove / mousedown),所以改成**有人要才開**:
 * - `acquire()`:計數 +1;沒在跑就 start(start 是同步的,回來時 LL hook 已裝好);排定中的延遲 stop 取消。
 * - `release()`:計數 -1(不會小於 0),歸零後延遲 `stopDelayMs` 才 stop,避免面板開關抖動頻繁 start / stop。
 * - `shutdown()`:結束 / 重新啟動用,不管計數一律 stop,之後 acquire 不再 start。
 * window 模式沒有 WidgetAreaTracker → 從不 start。
 *
 * 送鍵(`keyTap` / `keyToggle`)**不需要**掛鉤:`AddonKeyTap` → `hook_post_event`(libuiohook/src/windows/post_event.c)
 * → 靜態對照表 `scancode_to_keycode`(input_helper.c)→ `SendInput`,不碰 hook thread 或 start 時載入的鍵盤配置,
 * 所以送鍵不 acquire。
 *
 * hook 與計時器可注入 / 用假時鐘測(`main/test/uiohook-gate.test.ts`)。
 */
import { uIOhook } from 'uiohook-napi'

export interface HookControl {
  start: () => void
  stop: () => void
}

export interface UiohookGateOptions {
  /** 計數歸零後延遲多久才 stop(毫秒);0 = 立即 */
  stopDelayMs?: number
  log?: (msg: string, err?: unknown) => void
}

export const DEFAULT_STOP_DELAY_MS = 5000

export class UiohookGate {
  private count = 0
  private running = false
  private closed = false
  private stopTimer: ReturnType<typeof setTimeout> | undefined
  private readonly stopDelayMs: number
  private readonly log: (msg: string, err?: unknown) => void

  constructor (private readonly hook: HookControl, opts: UiohookGateOptions = {}) {
    this.stopDelayMs = opts.stopDelayMs ?? DEFAULT_STOP_DELAY_MS
    this.log = opts.log ?? ((msg, err) => { if (err === undefined) console.log(msg); else console.error(msg, err) })
  }

  /** 目前持有者數 */
  get holders (): number { return this.count }
  /** 掛鉤是否在跑(start 成功且尚未 stop) */
  get isRunning (): boolean { return this.running }

  acquire (): void {
    if (this.closed) return
    this.count++
    this.cancelStop()
    if (this.running) return
    try {
      this.hook.start()
      this.running = true
      this.log(`[uiohook] start(持有者 ${this.count})`)
    } catch (e) {
      this.log('[uiohook] start failed', e)
    }
  }

  release (): void {
    if (this.count === 0) return
    this.count--
    if (this.count > 0 || this.closed) return
    this.cancelStop()
    if (this.stopDelayMs <= 0) {
      this.stopNow()
      return
    }
    this.stopTimer = setTimeout(() => {
      this.stopTimer = undefined
      if (this.count === 0) this.stopNow()
    }, this.stopDelayMs)
  }

  /** 結束 / 重新啟動:不管計數一律 stop,之後不再 start */
  shutdown (): void {
    this.closed = true
    this.count = 0
    this.cancelStop()
    // 跟原本一樣無條件呼叫:沒在跑時原生 AddonStop 直接 return(addon.c `is_worker_running == false`)
    try { this.hook.stop() } catch {}
    this.running = false
  }

  private stopNow (): void {
    if (!this.running) return
    try {
      this.hook.stop()
      this.log('[uiohook] stop(沒有持有者)')
    } catch (e) {
      this.log('[uiohook] stop failed', e)
    }
    this.running = false
  }

  private cancelStop (): void {
    if (this.stopTimer === undefined) return
    clearTimeout(this.stopTimer)
    this.stopTimer = undefined
  }
}

/** main 行程共用的一份(WidgetAreaTracker acquire / release;main.ts 結束 / 重新啟動時 shutdown) */
export const uiohookGate = new UiohookGate(uIOhook)
