// speedrun 計時器(2026-11-10):Client.txt 進入區域 → 自動開始 / 自動分段。
// 只看「目前這段」的目標區:重回之前的城鎮(傳送點)不觸發。零依賴。
import type { Route } from './routes'
import type { Run } from './run'

export function autoAction (run: Pick<Run, 'phase' | 'index'>, route: Route, area: string): 'start' | 'split' | null {
  if (run.phase === 'idle') return route.autoStart && area === route.startArea ? 'start' : null
  if (run.phase === 'running' && route.autoSplit && area === route.splits[run.index]?.area) return 'split'
  return null
}
