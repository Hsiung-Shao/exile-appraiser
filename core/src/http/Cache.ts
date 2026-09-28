import type { RateLimiter } from './RateLimiter'
import hash from 'object-hash'

const CACHE_TTL = 300

export class Cache {
  private cached = new Map<string, unknown>()
  private currency = ''

  get<T = unknown> (key: unknown): T | undefined {
    const _key = hash.sha1(JSON.parse(JSON.stringify(key)))
    return this.cached.get(_key) as T | undefined
  }

  set<T = unknown> (key: unknown, value: T, ttl: number): void {
    const _key = hash.sha1(JSON.parse(JSON.stringify(key)))
    this.cached.set(_key, value)

    setTimeout(() => {
      this.cached.delete(_key)
    }, ttl * 1000)
  }

  /**
   * Exiled Exchange 2(PoE2)的增補,邏輯照抄:交易結果換算用的幣別變了就整個清掉,
   * 否則會拿到以舊幣別換算的快取價格。PoE1 的呼叫端不會用到。
   */
  purgeIfDifferentCurrency (currency: string | undefined): void {
    if (!currency || this.currency === currency) return
    this.currency = currency
    this.cached.clear()
  }

  static deriveTtl (...limits: RateLimiter[]): number {
    return (limits.length) ? CACHE_TTL : 0
  }
}
