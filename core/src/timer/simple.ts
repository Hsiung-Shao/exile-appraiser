// 2026-11-28 計時器的「一般計時器(碼表)」與「倒數計時」模式(speedrun 模式在 ../speedrun/run.ts)。
// 只算真實時間;狀態放在物件欄位上(方法透過 this 改),renderer 用 reactive() 包起來就追得到。零依賴。

export type SimplePhase = 'idle' | 'running' | 'paused' | 'finished'

export function createSimpleTimer (now: () => number) {
  return {
    phase: 'idle' as SimplePhase,
    /** 倒數時長;null = 碼表 */
    durationMs: null as number | null,
    acc: 0,
    since: 0,
    elapsed (): number {
      const e = this.phase === 'running' ? this.acc + now() - this.since : this.acc
      return this.durationMs == null ? e : Math.min(e, this.durationMs)
    },
    remaining (): number | null {
      return this.durationMs == null ? null : Math.max(0, this.durationMs - this.elapsed())
    },
    /** 從 0 開始(只在 idle / finished) */
    start (durationMs: number | null): void {
      if (this.phase !== 'idle' && this.phase !== 'finished') return
      this.durationMs = durationMs
      this.acc = 0
      this.since = now()
      this.phase = 'running'
    },
    pause (): void {
      if (this.phase !== 'running') return
      this.acc = this.elapsed()
      this.phase = 'paused'
    },
    resume (): void {
      if (this.phase !== 'paused') return
      this.since = now()
      this.phase = 'running'
    },
    reset (): void {
      this.phase = 'idle'
      this.acc = 0
    },
    /** 倒數跑著且歸零 → finished,只在轉換那一次回 true(播音效用) */
    check (): boolean {
      if (this.phase !== 'running' || this.durationMs == null || this.remaining()! > 0) return false
      this.acc = this.durationMs
      this.phase = 'finished'
      return true
    }
  }
}
export type SimpleTimer = ReturnType<typeof createSimpleTimer>

/** 碼表提醒:跨過 interval 的倍數才 true(interval ≤ 0 = 不提醒) */
export function alertCrossed (prevMs: number, nowMs: number, intervalMs: number): boolean {
  return intervalMs > 0 && Math.floor(nowMs / intervalMs) > Math.floor(prevMs / intervalMs)
}
