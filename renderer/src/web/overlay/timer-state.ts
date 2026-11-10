/**
 * 計時器狀態(2026-11-09 移植 APT 碼表;2026-11-10 改成 speedrun 式:分段 / 個人最佳 / 金段 / Client.txt 自動分段)。
 * 計時規則在 core `speedrun/run.ts`(一次跑的狀態機,直接改路線的 PB / 金段 / 嘗試次數 → 跟著設定檔存)。
 * 熱鍵(main `timer-action`)、懸浮選單、計時器元件都經這裡;App 只有一個 run,綁目前遊戲的路線。
 */
import { computed, reactive } from 'vue'
import type { TimerAction } from '@ipc/types'
import { AppConfig, flushConfigSave } from '../Config'
import { createRun, type Run } from '../../../../core/src/speedrun/run'
import { autoAction } from '../../../../core/src/speedrun/autosplit'
import type { Route } from '../../../../core/src/speedrun/routes'

export type TimerDisplay = 'active' | 'always' | 'off'
export const TIMER_DISPLAYS: readonly TimerDisplay[] = ['active', 'always', 'off']

export function timerVisible (display: TimerDisplay, running: boolean, elapsedMs: number): boolean {
  if (display === 'off') return false
  return display === 'always' || running || elapsedMs > 0
}

/** 目前遊戲的路線(設定裡的 reactive 物件;run 直接改它的 PB / 金段 → 設定檔跟著存) */
export function currentRoute (): Route {
  const c = AppConfig()
  return c.speedrun[c.game]
}

/** 換遊戲 / 換分段清單(路線物件換掉)才重建;同一條路線上的改動不重建 */
export const appRun = computed<Run>(() => reactive(createRun(currentRoute(), () => Date.now())) as Run)

export function timerAction (a: TimerAction): void {
  const run = appRun.value
  switch (a) {
    case 'toggle':
      // LiveSplit:沒在跑 = 開始、暫停中 = 繼續、跑著 = 分段;跑完要先重設
      if (run.phase === 'idle') run.start()
      else if (run.phase === 'paused') run.resume()
      else if (run.phase === 'running') run.split()
      break
    case 'pause':
      if (run.phase === 'running') run.pause()
      else if (run.phase === 'paused') run.resume()
      break
    case 'reset': run.reset(); break
    case 'undo': run.undo(); break
    case 'skip': run.skip(); break
  }
}

// 關閉程式 / 重新整理前結算這次的金段 / PB(LiveSplit 關閉時也會問要不要存)
if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => {
  const r = appRun.value
  if (r.phase === 'idle') return
  r.settle()
  flushConfigSave()
})

/** Client.txt 進入區域 → 自動開始 / 自動分段 */
export function timerArea (area: string): void {
  const run = appRun.value
  const act = autoAction(run, currentRoute(), area)
  if (act === 'start') run.start()
  else if (act === 'split') run.split()
  if (act) console.log(`[speedrun] 自動${act === 'start' ? '開始' : '分段'}:${area}`)
}
