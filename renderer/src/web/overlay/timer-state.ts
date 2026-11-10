/**
 * 計時器狀態(2026-11-09 移植 APT 碼表;2026-11-10 改成 speedrun 式:分段 / 個人最佳 / 金段 / Client.txt 自動分段)。
 * 計時規則在 core `speedrun/run.ts`(一次跑的狀態機,直接改路線的 PB / 金段 / 嘗試次數 → 跟著設定檔存)。
 * 熱鍵(main `timer-action`)、懸浮選單、計時器元件都經這裡;App 只有一個 run,綁目前遊戲的路線。
 */
import { computed, reactive, watch } from 'vue'
import type { TimerAction } from '@ipc/types'
import { AppConfig } from '../Config'
import { createRun, type Run } from '../../../../core/src/speedrun/run'
import { autoAction } from '../../../../core/src/speedrun/autosplit'
import type { Route } from '../../../../core/src/speedrun/routes'

export { TIMER_DISPLAYS, timerVisible, type TimerDisplay } from './timer-display'

/** 目前遊戲的路線(設定裡的 reactive 物件;run 直接改它的 PB / 金段 → 設定檔跟著存) */
export function currentRoute (): Route {
  const c = AppConfig()
  return c.speedrun[c.game]
}

/**
 * 每個遊戲一個 run,建立後不再換:run 每次操作才取目前的路線,不綁路線物件身分
 * (設定檔被瀏覽器預覽重新套用、設定頁改分段時路線物件會換掉,不能因此重設進行中的計時;審查 2026-11-10)
 */
const runs = new Map<string, Run>()
export const appRun = computed<Run>(() => {
  const game = AppConfig().game
  let run = runs.get(game)
  if (!run) {
    run = reactive(createRun(() => AppConfig().speedrun[game], () => Date.now())) as Run
    runs.set(game, run)
  }
  return run
})

// 分段數改了(設定頁增刪段 / 還原內建):進行中的這次對不上新清單 → 重設(紀錄已隨分段寫進路線,不會丟)
watch(() => currentRoute().splits.length, () => { appRun.value.reset() })

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

/** Client.txt 進入區域 → 自動開始 / 自動分段 */
export function timerArea (area: string): void {
  const run = appRun.value
  const act = autoAction(run, currentRoute(), area)
  if (act === 'start') run.start()
  else if (act === 'split') run.split()
  if (act) console.log(`[speedrun] 自動${act === 'start' ? '開始' : '分段'}:${area}`)
}
