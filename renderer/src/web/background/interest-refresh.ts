/**
 * 第 30.8 步(閒置降耗):「最近一次有人查價後 `spanMs` 內」才定期呼叫 `refresh` 的計時器,取代 `Prices.ts` 原本常駐的
 * 4 分鐘 `setInterval`(原本沒人查價時每 4 分鐘也喚醒一次,`load()` 進去才因 20 分鐘閘門 return)。
 *
 * - `touch()`(有人查價):記下時間;沒有計時器就開一個每 `intervalMs` 的 interval(已經有就沿用,不重設節奏)。
 * - interval 觸發:距上次 `touch` 超過 `spanMs`(與 `Prices.ts` `load()` 的閘門同一個 `>` 判斷)→ 關掉計時器、不呼叫;否則呼叫 `refresh`。
 * - 下次查價 `touch()` 會再開;查價當下的抓取由呼叫端自己做(`queuePricesFetch` → `load()`,資料過期就立即抓)。
 * 零依賴(不 import Vue / Host),renderer 單元測試以假計時器直接測。
 */
export interface RefreshTimers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (h: unknown) => void
  now: () => number
}

const REAL_TIMERS: RefreshTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => { clearInterval(h as ReturnType<typeof setInterval>) },
  now: () => Date.now()
}

export interface InterestRefresh {
  /** 有人查價:記下時間,需要時開計時器。`at` 省略 = 現在 */
  touch: (at?: number) => void
  /** 目前有沒有計時器 */
  readonly active: boolean
  /** 關掉計時器(測試 / 結束用) */
  stop: () => void
}

export function createInterestRefresh (opts: { intervalMs: number, spanMs: number, refresh: () => void, timers?: RefreshTimers }): InterestRefresh {
  const timers = opts.timers ?? REAL_TIMERS
  let handle: unknown = null
  let lastInterest = Number.NEGATIVE_INFINITY

  function stop () {
    if (handle != null) timers.clearInterval(handle)
    handle = null
  }

  function onInterval () {
    if (timers.now() - lastInterest > opts.spanMs) {
      stop()
      return
    }
    opts.refresh()
  }

  return {
    touch (at?: number) {
      lastInterest = at ?? timers.now()
      if (handle == null) handle = timers.setInterval(onInterval, opts.intervalMs)
    },
    get active () { return handle != null },
    stop
  }
}
