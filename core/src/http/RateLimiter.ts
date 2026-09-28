/* eslint-disable @typescript-eslint/no-floating-promises,
                  @typescript-eslint/promise-function-async,
                  @typescript-eslint/return-await */

// 移植自 Awakened PoE Trade `renderer/src/web/price-check/trade/RateLimiter.ts`。
// 唯一的改動:拿掉 Vue 的 shallowReactive / shallowRef,讓它能在 Node(CLI、測試)
// 與任何前端框架下使用。`queue` 保留 `{ value }` 形狀是為了讓 diff 對上游最小。
// UI 要顯示限流狀態時,用 `subscribe()` 收變更通知再自行包成響應式。

export class RateLimiter {
  stack: ResourceHandle[] = []
  queue = { value: 0 }
  private _listeners = new Set<() => void>()

  /** 每次 stack / queue 變動時通知(給 UI 用;core 內部不依賴它)。回傳取消函式。 */
  subscribe (cb: () => void): () => void {
    this._listeners.add(cb)
    return () => { this._listeners.delete(cb) }
  }

  private _notify () {
    for (const cb of this._listeners) cb()
  }

  private _destroyed = false

  constructor (
    public max: number,
    public window: number
  ) {}

  wait (borrow = true) {
    return this._wait(borrow)
  }

  private async _wait (borrow: boolean): Promise<void> {
    if (this._destroyed) throw new Error('RateLimiter is no longer active')

    if (this.isFullyUtilized) {
      this.queue.value++
      this._notify()
      try {
        await this.stack[0].promise
      } finally {
        this.queue.value--
        this._notify()
      }
      return this._wait(borrow)
    } else {
      if (borrow) {
        this.push()
      }
    }
  }

  private push () {
    const handle = new ResourceHandle(this.window * 1000, () => {
      const idx = this.stack.indexOf(handle)
      if (idx !== -1) {
        this.stack.splice(idx, 1)
        this._notify()
      }
    })
    this.stack.push(handle)
    this._notify()
  }

  static async waitMulti (limiters: Iterable<RateLimiter>): Promise<void> {
    const _limiters = Array.from(limiters)

    try {
      await Promise.all(_limiters.map(rl => rl.wait(false)))
    } catch (e) {
      if (e instanceof Error && e.message === 'RateLimiter is no longer active') {
        return this.waitMulti(limiters)
      } else {
        throw e
      }
    }

    if (_limiters.every(rl => !rl.isFullyUtilized)) {
      _limiters.forEach(rl => { rl.wait() })
    } else {
      return this.waitMulti(limiters)
    }
  }

  static estimateTime (count: number, limiters: Iterable<RateLimiter>, ignoreState = false): number {
    // NOTE: Cannot handle existing queue in simulation, because
    //       entries in queue can depend on other limiters in `waitMulti` call.
    //       It means that time returned by `estimateTime` will be increased
    //       multiple times between calls until queue is cleared.

    let simulation: Array<{ max: number, window: number, stack: number[] }>
    {
      const now = Date.now()
      simulation = Array.from(limiters).map(l => ({
        max: l.max,
        window: l.window,
        stack: ignoreState
          ? []
          : l.stack
              .map(entry => entry.releasedAt - now)
              .sort((a, b) => a - b)
      }))
    }

    let total = 0
    while (count--) {
      while (simulation.some(limit => limit.stack.length >= limit.max)) {
        const waitTime = simulation.reduce((ms, limit) =>
          (limit.stack.length >= limit.max)
            ? Math.max(limit.stack[0] - total, ms) : ms, 0)

        total += waitTime

        for (const limit of simulation) {
          limit.stack = limit.stack.filter(time => time > total)
        }
      }

      for (const limit of simulation) {
        limit.stack.push(total + limit.window * 1000)
      }
    }

    return total
  }

  isEqualLimit (other: { max: number, window: number }) {
    return this.max === other.max &&
      this.window === other.window
  }

  get isFullyUtilized () {
    return !this.available
  }

  get available () {
    return Math.max(this.max - this.stack.length, 0)
  }

  destroy () {
    this._destroyed = true
    if (this.queue.value) {
      // shortcircuit awaiters in queue
      this.stack[0].cancel(new Error('RateLimiter is no longer active'))
    }
  }

  toString () {
    return `RateLimiter<max=${this.max}:window=${this.window}>: (stack=${this.stack.length},queue=${this.queue.value})`
  }
}

class ResourceHandle {
  public borrowedAt: number
  public releasedAt: number
  public promise: Promise<void>

  private _tmid!: ReturnType<typeof setTimeout>
  private _cb: () => void
  private _resolve!: () => void
  private _reject!: (reason?: unknown) => void

  constructor (millis: number, cb: () => void) {
    this.borrowedAt = Date.now()
    this.releasedAt = this.borrowedAt + millis
    this._cb = cb
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject

      this._tmid = setTimeout(() => {
        this._cb()
        this._resolve()
      }, millis)
    })
  }

  public cancel (reason?: unknown) {
    clearTimeout(this._tmid)
    this._cb()
    this._reject(reason)
  }
}
