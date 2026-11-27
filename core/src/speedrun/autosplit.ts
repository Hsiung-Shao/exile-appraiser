// speedrun 計時器(2026-11-10):Client.txt 進入區域 → 自動開始 / 自動分段。
// 平常只看「目前這段」的目標區:重回之前的城鎮(傳送點)不觸發。
// 2026-11-28 中途開始:這次還沒分過任何一段時,進入後面任一段的目標區 → 跳到那段分段(中間段記成跳過,run.jumpTo)。零依賴。
import type { Route } from './routes'
import type { Run } from './run'

export function autoAction (run: Pick<Run, 'phase' | 'index' | 'splitTimes'>, route: Route, area: string): 'start' | { split: number } | null {
  if (run.phase === 'idle') return route.autoStart && area === route.startArea ? 'start' : null
  if (run.phase !== 'running' || !route.autoSplit) return null
  if (run.splitTimes.every(t => t == null)) {
    for (let j = run.index; j < route.splits.length; j++) if (route.splits[j].area === area) return { split: j }
    return null
  }
  return area === route.splits[run.index]?.area ? { split: run.index } : null
}
