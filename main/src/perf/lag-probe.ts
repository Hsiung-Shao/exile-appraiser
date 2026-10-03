/**
 * 事件迴圈卡頓探針(第 29 步由 `ocr/capture-bench.ts` 抽出,讓 `--capture-bench` 與效能診斷 `perf-monitor.ts` 共用;
 * capture-bench 本身是開發版限定的動態 import,不能從正式版的啟動路徑載入)。
 *
 * 每 `intervalMs` 排一次 setTimeout,記錄「實際間隔 − intervalMs」= 那段時間 main 執行緒被佔住多久(ms)。
 * - capture-bench:`intervalMs = 4`(預設,與抽出前逐字相同),量完用 `maxLag(t0, t1)` 看某段時間的最長卡頓。
 * - 效能診斷:較疏的間隔(`PERF_LAG_INTERVAL_MS`)+ `drain()` 每個取樣視窗取 p95 / 最長並清空(記憶體不累積);
 *   計時器 `unref`,不會讓程式因為探針而不結束。**只在效能診斷開著時才 start**(關閉 = 零成本)。
 * ⚠ Windows 預設計時器解析度約 15.6 ms:20 ms 的 setTimeout 實際約 31 ms 觸發,閒置時的卡頓 ≈ 11–12 ms 是底噪(看情境間差值與最長值)。
 * 時鐘與計時器可注入(測試用假的)。
 */

export interface LagProbeClock {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
}

const REAL_CLOCK: LagProbeClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms)
    // 探針不該讓行程保持存活
    ;(h as { unref?: () => void }).unref?.()
    return h
  },
  clearTimeout: (h) => { clearTimeout(h as ReturnType<typeof setTimeout>) }
}

/** 一個取樣視窗的卡頓摘要(ms,小數一位);沒有樣本 → n = 0、其餘 0 */
export interface LagSummary {
  n: number
  p95: number
  max: number
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** 純函式:一串卡頓值 → p95 / 最長(負值當 0) */
export function summarizeLag (lags: readonly number[]): LagSummary {
  if (!lags.length) return { n: 0, p95: 0, max: 0 }
  const s = lags.map(v => (v > 0 ? v : 0)).sort((a, b) => a - b)
  const p95 = s[Math.min(s.length - 1, Math.floor(0.95 * s.length))]
  return { n: s.length, p95: r1(p95), max: r1(s[s.length - 1]) }
}

export class LagProbe {
  private samples: Array<{ t: number, lag: number }> = []
  private last = 0
  private timer: unknown = null
  private readonly clock: LagProbeClock

  constructor (readonly intervalMs = 4, clock?: LagProbeClock) {
    this.clock = clock ?? REAL_CLOCK
  }

  get running (): boolean { return this.timer != null }

  start () {
    if (this.timer != null) return
    this.last = this.clock.now()
    const tick = () => {
      const now = this.clock.now()
      this.samples.push({ t: now, lag: now - this.last - this.intervalMs })
      this.last = now
      this.timer = this.clock.setTimeout(tick, this.intervalMs)
    }
    this.timer = this.clock.setTimeout(tick, this.intervalMs)
  }

  stop () {
    if (this.timer != null) this.clock.clearTimeout(this.timer)
    this.timer = null
  }

  /** capture-bench:`[t0, t1 + 30]` 之間最長的卡頓 */
  maxLag (t0: number, t1: number): number {
    let m = 0
    for (const s of this.samples) if (s.t >= t0 && s.t <= t1 + 30 && s.lag > m) m = s.lag
    return m
  }

  /** 效能診斷:取出目前累積的樣本摘要並清空 */
  drain (): LagSummary {
    const out = summarizeLag(this.samples.map(s => s.lag))
    this.samples = []
    return out
  }
}
