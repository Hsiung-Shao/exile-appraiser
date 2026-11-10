/** 計時器顯示時機(2026-11-09;獨立一檔:Config 只需要這些,不能 import timer-state(它在載入時就讀設定 → 循環)) */
export type TimerDisplay = 'active' | 'always' | 'off'
export const TIMER_DISPLAYS: readonly TimerDisplay[] = ['active', 'always', 'off']

export function timerVisible (display: TimerDisplay, running: boolean, elapsedMs: number): boolean {
  if (display === 'off') return false
  return display === 'always' || running || elapsedMs > 0
}
