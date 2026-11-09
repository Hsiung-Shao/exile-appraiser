/**
 * 計時器(2026-11-09,移植 APT `stopwatch/WidgetTimer.vue` 的計時規則,MIT):
 * 暫停期間不計時;停止時歸零 = 0;跑著時歸零 = 從 0 繼續跑。
 * 狀態放在物件欄位上,`reactive()` 包起來後 Vue 追得到 `running`(App 的單例 `appTimer`)。
 */
import { reactive } from 'vue'

export type TimerDisplay = 'active' | 'always' | 'off'
export const TIMER_DISPLAYS: readonly TimerDisplay[] = ['active', 'always', 'off']

export function createTimer (now: () => number) {
  return {
    running: false,
    /** 上次暫停 / 歸零前累計的毫秒 */
    acc: 0,
    /** 這段開始跑的時間點 */
    since: 0,
    start () {
      if (this.running) return
      this.since = now()
      this.running = true
    },
    stop () {
      if (!this.running) return
      this.acc += now() - this.since
      this.running = false
    },
    toggle () {
      if (this.running) this.stop()
      else this.start()
    },
    reset () {
      this.acc = 0
      this.since = now()
    },
    elapsedMs (): number {
      return this.acc + (this.running ? now() - this.since : 0)
    }
  }
}

export function formatHms (ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`
}

export function timerVisible (display: TimerDisplay, running: boolean, elapsedMs: number): boolean {
  if (display === 'off') return false
  return display === 'always' || running || elapsedMs > 0
}

/** App 唯一的計時器(熱鍵、懸浮選單、計時器元件共用) */
export const appTimer = reactive(createTimer(() => Date.now()))
