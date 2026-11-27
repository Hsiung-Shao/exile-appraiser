/** 計時器顯示時機(2026-11-09;獨立一檔:Config 只需要這些,不能 import timer-state(它在載入時就讀設定 → 循環)) */
export type TimerDisplay = 'active' | 'always' | 'off'
export const TIMER_DISPLAYS: readonly TimerDisplay[] = ['active', 'always', 'off']

export function timerVisible (display: TimerDisplay, running: boolean, elapsedMs: number): boolean {
  if (display === 'off') return false
  return display === 'always' || running || elapsedMs > 0
}

/** 2026-11-28 計時器模式:speedrun(分段)/ stopwatch 一般計時器(碼表)/ countdown 倒數計時 */
export type TimerMode = 'speedrun' | 'stopwatch' | 'countdown'
export const TIMER_MODES: readonly TimerMode[] = ['speedrun', 'stopwatch', 'countdown']

/** 音效:file '' = 內建嗶聲,否則 userData/timer-sounds 裡的檔名;volume 0–1 */
export interface TimerSound { file: string, volume: number }

// 與 main/src/backgrounds.ts 的 SOUND_FILE_RE 相同(main / renderer 各一份)
const SOUND_FILE_RE = /^[^\\/:*?"<>|.\x00-\x1f][^\\/:*?"<>|\x00-\x1f]{0,199}\.(mp3|ogg|wav|m4a)$/i
export function normSoundFile (v: unknown): string {
  return typeof v === 'string' && SOUND_FILE_RE.test(v) && !v.includes('..') ? v : ''
}

export function normTimerSound (v: unknown): TimerSound {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const vol = typeof o.volume === 'number' && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : 0.7
  return { file: normSoundFile(o.file), volume: vol }
}

/** 整數夾在 [min, max];不是數字 → def */
export function clampInt (v: unknown, min: number, max: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def
}
