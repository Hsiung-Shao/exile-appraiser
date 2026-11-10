// speedrun 計時器(2026-11-10):一次跑的狀態機(LiveSplit 慣例,只算真實時間 RTA)。
// 金段 / 個人最佳**在重設(或關閉程式)時才結算**(`settle`),跑的過程中一直跟舊 PB 比:
// - 撤銷誤按的分段不會污染金段 / PB(審查 2026-11-10)
// - 跑完創新 PB 的那一刻,差值仍顯示這次比舊 PB 快多少
// 結算規則:每段比金段快 → 更新(前一段被跳過的段時間不可靠,不更新);跑完且總時間比 PB 快(或還沒有 PB)→ PB 換成這次的累計。
// 狀態放在物件欄位上(方法透過 this 改),renderer 用 reactive() 包起來就追得到。零依賴。
import type { Route } from './routes'

export type RunPhase = 'idle' | 'running' | 'paused' | 'finished'
export interface Run {
  readonly phase: RunPhase
  /** 目前在跑第幾段(0 起);finished 時 = splits.length */
  readonly index: number
  /** 每段完成時的累計毫秒;沒到 / 跳過 = null */
  readonly splitTimes: Array<number | null>
  start (): void
  split (): void
  undo (): void
  skip (): void
  pause (): void
  resume (): void
  /** 先結算(`settle`)再回到 idle */
  reset (): void
  /** 把這次的金段 / PB 寫進路線(同一次只結算一次;重設與關閉程式時呼叫) */
  settle (): void
  elapsed (): number
}

export function createRun (route: Route, now: () => number): Run {
  const blank = () => route.splits.map(() => null as number | null)
  const run = {
    phase: 'idle' as RunPhase,
    index: 0,
    splitTimes: blank(),
    /** 暫停前累計的毫秒 */
    acc: 0,
    /** 這段開始跑的時間點 */
    since: 0,
    /** 跑完的時間點(finished 時 elapsed 停在這裡;撤銷後時間照真實時間接下去) */
    endAt: 0,
    /** 這次已結算 */
    settled: true,
    elapsed (): number {
      if (this.phase === 'running') return this.acc + now() - this.since
      if (this.phase === 'finished') return this.acc + this.endAt - this.since
      return this.acc
    },
    start (): void {
      if (this.phase !== 'idle') return
      this.splitTimes = blank()
      this.index = 0
      this.acc = 0
      this.since = now()
      this.phase = 'running'
      this.settled = false
      route.attempts++
    },
    split (): void {
      if (this.phase !== 'running' || this.index >= route.splits.length) return
      this.splitTimes[this.index] = this.elapsed()
      this.index++
      if (this.index >= route.splits.length) {
        this.endAt = now()
        this.phase = 'finished'
      }
    },
    undo (): void {
      if (this.index === 0 || this.phase === 'idle') return
      // 跑完後撤銷:acc / since 沒動過 → 時間照真實時間接下去(跑完到撤銷之間也算)
      if (this.phase === 'finished') this.phase = 'running'
      this.index--
      this.splitTimes[this.index] = null
    },
    skip (): void {
      // 最後一段不能跳(沒有終點時間)
      if (this.phase !== 'running' || this.index >= route.splits.length - 1) return
      this.splitTimes[this.index] = null
      this.index++
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
    settle (): void {
      if (this.settled) return
      this.settled = true
      for (let i = 0; i < route.splits.length; i++) {
        const seg = segmentTime(this, i)
        if (seg != null && (route.golds[i] == null || seg < route.golds[i]!)) route.golds[i] = seg
      }
      if (this.phase === 'finished') {
        const total = this.splitTimes[this.splitTimes.length - 1]
        const pbTotal = route.pb?.[route.pb.length - 1]
        if (total != null && (pbTotal == null || total < pbTotal)) route.pb = [...this.splitTimes]
      }
    },
    reset (): void {
      this.settle()
      this.phase = 'idle'
      this.index = 0
      this.acc = 0
      this.splitTimes = blank()
    }
  }
  return run
}

export function deltaAt (run: Run, route: Route, i: number): number | null {
  const t = run.splitTimes[i]
  const p = route.pb?.[i]
  return t == null || p == null ? null : t - p
}

/** 這段花的時間;前一段沒有時間(跳過)→ null */
export function segmentTime (run: Pick<Run, 'splitTimes'>, i: number): number | null {
  const t = run.splitTimes[i]
  if (t == null) return null
  if (i === 0) return t
  const prev = run.splitTimes[i - 1]
  return prev == null ? null : t - prev
}

/** 這段是不是新金段(比路線上的最佳段快,或還沒有最佳段);還沒結算時用來上色 */
export function isGoldSegment (run: Run, route: Route, i: number): boolean {
  const seg = segmentTime(run, i)
  return seg != null && (route.golds[i] == null || seg < route.golds[i]!)
}

export function sumOfBest (route: Route): number | null {
  if (!route.golds.length || route.golds.some(g => g == null)) return null
  return route.golds.reduce<number>((a, g) => a + g!, 0)
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** `M:SS.cc`,滿一小時 `H:MM:SS.cc`;百分之一秒無條件捨去 */
export function formatRunTime (ms: number): string {
  const cs = Math.floor(Math.max(0, ms) / 10)
  const s = Math.floor(cs / 100)
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  const tail = `${p2(s % 60)}.${p2(cs % 100)}`
  return h ? `${h}:${p2(m)}:${tail}` : `${m}:${tail}`
}

/** `+1.2` / `−0.8`(U+2212);一位小數、絕對值無條件捨去;一分鐘以上 `+1:05` */
export function formatDelta (ms: number): string {
  const sign = ms < 0 ? '−' : '+'
  const ds = Math.floor(Math.abs(ms) / 100)
  const s = Math.floor(ds / 10)
  if (s >= 60) return `${sign}${Math.floor(s / 60)}:${p2(s % 60)}`
  return `${sign}${s}.${ds % 10}`
}
