import type { HttpFetch } from './HttpClient'

/**
 * 429 處理(借自 poenavi):讀 `Retry-After` 等待後**重試一次**;沒給就等 60 秒;上限可調。
 * 上游 APT 的限流器已會對齊 `X-Rate-Limit-*`,正常情況下不會撞 429;
 * 會撞到的典型情境是使用者同時開著 APT / EE2 共用同一個 IP 額度。
 *
 * 做成 HttpFetch 的裝飾器,交易層與測試都不必知道它的存在。
 */
export interface RetryAfterOptions {
  /** 最多等待幾秒;超過就不等、直接把 429 回應丟回去。預設 60。 */
  maxWaitSeconds?: number
  /** 等待實作(測試可注入假的)。 */
  sleep?: (ms: number) => Promise<void>
  /** 每次等待前通知(UI 顯示「限流中,x 秒後重試」)。 */
  onWait?: (seconds: number) => void
}

export function parseRetryAfter (headers: Headers, fallbackSeconds = 60): number {
  const raw = headers.get('retry-after')
  if (!raw) return fallbackSeconds
  const n = Number(raw)
  if (Number.isFinite(n) && n >= 0) return n
  const at = Date.parse(raw)
  if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000))
  return fallbackSeconds
}

export function withRetryAfter (http: HttpFetch, opts: RetryAfterOptions = {}): HttpFetch {
  const maxWait = opts.maxWaitSeconds ?? 60
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  return async (url, init) => {
    const first = await http(url, init)
    if (first.status !== 429) return first
    const seconds = parseRetryAfter(first.headers)
    if (seconds > maxWait) return first
    opts.onWait?.(seconds)
    await sleep(seconds * 1000)
    return http(url, init)
  }
}
