/**
 * 計時器狀態(2026-11-09 移植 APT 碼表;2026-11-10 改成 speedrun 式:分段 / 個人最佳 / 金段 / Client.txt 自動分段)。
 * 計時規則在 core `speedrun/run.ts`(一次跑的狀態機,直接改路線的 PB / 金段 / 嘗試次數 → 跟著設定檔存)。
 * 熱鍵(main `timer-action`)、懸浮選單、計時器元件都經這裡;每個遊戲一個 run,不綁路線物件(每次操作才取目前的路線)。
 */
import { computed, reactive, watch } from 'vue'
import type { TimerAction } from '@ipc/types'
import { AppConfig } from '../Config'
import { createRun, type Run } from '../../../../core/src/speedrun/run'
import { autoAction } from '../../../../core/src/speedrun/autosplit'
import type { Route } from '../../../../core/src/speedrun/routes'
import { createSimpleTimer, type SimpleTimer } from '../../../../core/src/timer/simple'

export { TIMER_DISPLAYS, timerVisible, type TimerDisplay } from './timer-display'

/** 2026-11-28 一般計時器 / 倒數計時(兩個模式共用一個;切模式時重設,見下方 watch) */
export const simpleTimer = reactive(createSimpleTimer(() => Date.now())) as SimpleTimer
watch(() => AppConfig().timerMode, () => { simpleTimer.reset() })

/** 非 speedrun:開始 = 從 0 開始(倒數用設定的時長);跑著 = 暫停;暫停中 = 繼續 */
function simpleAction (a: TimerAction): void {
  const c = AppConfig()
  const t = simpleTimer
  if (a === 'toggle') {
    if (t.phase === 'idle' || t.phase === 'finished') t.start(c.timerMode === 'countdown' ? c.timerCountdownSec * 1000 : null)
    else if (t.phase === 'running') t.pause()
    else t.resume()
  } else if (a === 'pause') {
    if (t.phase === 'running') t.pause()
    else if (t.phase === 'paused') t.resume()
  } else if (a === 'reset') t.reset()
  // undo / skip 只有 speedrun 有
}

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

/**
 * 進行中的這次要重設的情況(紀錄已隨分段寫進路線,重設不會丟):
 * - 分段數或任一段觸發區域改了(設定頁增刪 / 改區域 / 還原內建):對不上新清單,且路線紀錄已被 `replaceSplits` 清掉
 * - 紀錄從「有」變成「全空」(另一端按了清除紀錄):不重設的話,下一次分段會用開始時的快照把紀錄寫回去(審查 2026-11-10 第 3 輪)
 * 換遊戲不算(那是另一個 run)。
 */
const routeShape = () => {
  const c = AppConfig()
  const r = c.speedrun[c.game]
  return { game: c.game, areas: r.splits.map(s => s.area ?? '').join('|') + `#${r.splits.length}`, cleared: r.pb == null && r.golds.every(g => g == null) }
}
watch(routeShape, (now, before) => {
  if (now.game !== before.game) return
  // 紀錄被清空只在「開始時的快照本來有紀錄」才算外部清除:快照本來就空時(第一次跑),
  // 撤銷第一段會讓路線回到全空,那是 apply 的正確結果,不能重設(審查 2026-11-10 第 4 輪)
  const run = appRun.value
  const baseHad = run.base.pb != null || run.base.golds.some(g => g != null)
  if (now.areas !== before.areas || (now.cleared && !before.cleared && baseHad)) run.reset()
})

/** 這次暫停是切窗造成的(回到遊戲才自動繼續;手動操作過就不算) */
let focusPausedRun: Run | null = null

/**
 * 2026-11-20 使用者裁定:遊戲與自己的 overlay 都沒有焦點(切到別的視窗)→ 暫停,回來自動繼續。
 * 手動暫停的不自動繼續。
 */
export function timerFocus (focused: boolean): void {
  // 切窗暫停只給 speedrun(倒數常拿來計遊戲外的事,切出去不該停)
  if (AppConfig().timerMode !== 'speedrun') return
  const run = appRun.value
  if (!focused) {
    if (run.phase !== 'running') return
    run.pause()
    focusPausedRun = run
  } else if (focusPausedRun) {
    // 記的是哪個 run(每個遊戲一個):中途換了遊戲也只繼續當初暫停的那個
    focusPausedRun.resume()
    focusPausedRun = null
  }
}

export function timerAction (a: TimerAction): void {
  // main:overlay 視窗失焦且焦點不在遊戲(從自己的面板切到別的視窗;這條路沒有 focus-change)
  if (a === 'away' || a === 'back') { timerFocus(a === 'back'); return }
  if (AppConfig().timerMode !== 'speedrun') { simpleAction(a); return }
  const run = appRun.value
  focusPausedRun = null
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
  if (AppConfig().timerMode !== 'speedrun') return
  const run = appRun.value
  // 切窗暫停中(常在讀圖時切出去)進了目標區:照樣分段,分完仍暫停
  const away = focusPausedRun === run && run.phase === 'paused'
  const act = autoAction(away ? { phase: 'running', index: run.index, splitTimes: run.splitTimes } : run, currentRoute(), area)
  if (act === 'start') run.start()
  else if (act) {
    if (away) run.resume()
    // 中途開始:還沒分過任何一段就進了後面的目標區 → 跳到那段(中間段記成跳過,這次不寫個人最佳)
    if (act.split > run.index) { console.log(`[speedrun] 中途開始:跳過 ${act.split - run.index} 段`); run.jumpTo(act.split) }
    run.split()
    if (away) run.pause()
  }
  if (act) console.log(`[speedrun] 自動${act === 'start' ? '開始' : '分段'}:${area}`)
}
