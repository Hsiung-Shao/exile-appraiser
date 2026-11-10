// speedrun 計時器(2026-11-10):一次跑的狀態機(LiveSplit 慣例,只算真實時間 RTA)。
// 紀錄寫法(審查 2026-11-10 第 2 輪):開始時把路線的 PB / 金段存成快照 `base`;
// 每次分段 / 撤銷都由「快照 + 這次的分段時間」重算路線的 PB / 金段(`apply`)→
// - 紀錄隨分段立刻寫進路線(跟著設定檔存),不靠重設 / 關閉流程(自動換遊戲重啟、換路線都不會丟)
// - 撤銷誤按的分段會連同紀錄一起還原
// - 畫面一律跟快照比(跑完創 PB 那一刻仍看得到比舊 PB 快多少)
// 規則:這段比快照的金段快 → 金段;前一段被跳過的段時間不可靠,不算。跑完且總時間比快照 PB 快(或沒有 PB)→ PB = 這次的累計。
// 狀態放在物件欄位上(方法透過 this 改),renderer 用 reactive() 包起來就追得到。零依賴。
import type { Route } from './routes'

export type RunPhase = 'idle' | 'running' | 'paused' | 'finished'
export interface RecordSnapshot { pb: Array<number | null> | null, golds: Array<number | null> }
export interface Run {
  readonly phase: RunPhase
  /** 目前在跑第幾段(0 起);finished 時 = splits.length */
  readonly index: number
  /** 每段完成時的累計毫秒;沒到 / 跳過 = null */
  readonly splitTimes: Array<number | null>
  /** 這次開始時路線的 PB / 金段(畫面比較用);idle 時沒有意義 */
  readonly base: RecordSnapshot
  start (): void
  split (): void
  undo (): void
  skip (): void
  pause (): void
  resume (): void
  reset (): void
  elapsed (): number
}

/**
 * `route` 可以是函式:每次操作才取目前的路線(renderer 的路線物件會被設定檔重新套用換掉,run 不綁物件身分;審查 2026-11-10)
 */
export function createRun (routeOf: Route | (() => Route), now: () => number): Run {
  const R = typeof routeOf === 'function' ? routeOf : () => routeOf
  const blank = () => R().splits.map(() => null as number | null)
  const run = {
    phase: 'idle' as RunPhase,
    index: 0,
    splitTimes: blank(),
    base: { pb: null, golds: [] } as RecordSnapshot,
    /** 暫停前累計的毫秒 */
    acc: 0,
    /** 這段開始跑的時間點 */
    since: 0,
    /** 跑完的時間點(finished 時 elapsed 停在這裡;撤銷後時間照真實時間接下去) */
    endAt: 0,
    elapsed (): number {
      if (this.phase === 'running') return this.acc + now() - this.since
      if (this.phase === 'finished') return this.acc + this.endAt - this.since
      return this.acc
    },
    /** 快照 + 這次的分段 → 路線的 PB / 金段 */
    apply (): void {
      const golds = [...this.base.golds]
      for (let i = 0; i < golds.length; i++) {
        const seg = segmentTime(this, i)
        if (seg != null && (golds[i] == null || seg < golds[i]!)) golds[i] = seg
      }
      R().golds = golds
      const total = this.phase === 'finished' ? this.splitTimes[this.splitTimes.length - 1] : null
      const pbTotal = this.base.pb?.[this.base.pb.length - 1]
      R().pb = total != null && (pbTotal == null || total < pbTotal) ? [...this.splitTimes] : this.base.pb && [...this.base.pb]
    },
    start (): void {
      if (this.phase !== 'idle') return
      const r = R()
      this.base = { pb: r.pb && [...r.pb], golds: r.splits.map((_, i) => r.golds[i] ?? null) }
      this.splitTimes = blank()
      this.index = 0
      this.acc = 0
      this.since = now()
      this.phase = 'running'
      R().attempts++
    },
    split (): void {
      if (this.phase !== 'running' || this.index >= R().splits.length) return
      this.splitTimes[this.index] = this.elapsed()
      this.index++
      if (this.index >= R().splits.length) {
        this.endAt = now()
        this.phase = 'finished'
      }
      this.apply()
    },
    undo (): void {
      if (this.index === 0 || this.phase === 'idle') return
      // 跑完後撤銷:acc / since 沒動過 → 時間照真實時間接下去(跑完到撤銷之間也算)
      if (this.phase === 'finished') this.phase = 'running'
      this.index--
      this.splitTimes[this.index] = null
      this.apply()
    },
    skip (): void {
      // 最後一段不能跳(沒有終點時間)
      if (this.phase !== 'running' || this.index >= R().splits.length - 1) return
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
    reset (): void {
      this.phase = 'idle'
      this.index = 0
      this.acc = 0
      this.splitTimes = blank()
    }
  }
  return run
}

/** 畫面比較用的紀錄:跑著(含暫停 / 跑完)= 開始時的快照;沒在跑 = 路線目前的紀錄 */
export function comparison (run: Run, route: Route): RecordSnapshot {
  return run.phase === 'idle' ? { pb: route.pb, golds: route.golds } : run.base
}

export function deltaAt (run: Run, route: Route, i: number): number | null {
  const t = run.splitTimes[i]
  const p = comparison(run, route).pb?.[i]
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

/** 這段是不是新金段(比開始時的最佳段快,或當時還沒有最佳段) */
export function isGoldSegment (run: Run, route: Route, i: number): boolean {
  const seg = segmentTime(run, i)
  const g = comparison(run, route).golds[i]
  return seg != null && (g == null || seg < g)
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
