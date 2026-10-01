// main/src/http.ts:session fetch 的逾時 / 中止 / 錯誤形狀 / cookie patch 範圍(mock electron,不啟動 Electron、不連外網)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  fetch: null as null | ((url: string, init: any) => Promise<any>),
  onHeadersReceived: [] as any[][]
}))

vi.mock('electron', () => ({
  app: { userAgentFallback: 'UA-test exile-appraiser/0.0.0' },
  session: {
    defaultSession: {
      fetch: (url: string, init: any) => state.fetch!(url, init),
      webRequest: { onHeadersReceived: (...args: any[]) => { state.onHeadersReceived.push(args) } }
    }
  }
}))

import {
  hostFetch, abortHostFetch, abortKeyOf, normTimeoutMs, inflightCount, installCookiePatch,
  COOKIE_PATCH_URLS, DEFAULT_FETCH_TIMEOUT_MS
} from '../src/http'

/** 假 fetch:永不回應,但跟真的一樣在 signal abort 時 reject AbortError。 */
function hangingFetch () {
  const calls: Array<{ url: string, init: any }> = []
  state.fetch = (url, init) => {
    calls.push({ url, init })
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted.')
        e.name = 'AbortError'
        reject(e)
      })
    })
  }
  return calls
}

function okResponse (status = 200, body = 'ok', headers: Array<[string, string]> = [['content-type', 'text/plain']]) {
  return {
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'OK',
    headers: new Headers(headers),
    text: async () => body
  }
}

beforeEach(() => { state.fetch = null })
afterEach(() => { vi.useRealTimers() })

describe('hostFetch 逾時', () => {
  it('預設 30 秒逾時;假 fetch 永不回 → reject 一般 Error(訊息含逾時)', async () => {
    vi.useFakeTimers()
    const calls = hangingFetch()
    const p = hostFetch('https://poe.ninja/poe1/api/x')
    const assertion = expect(p).rejects.toThrow(/timed out after 30000 ms: poe\.ninja\/poe1\/api\/x/)
    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS - 1)
    expect(calls[0].init.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(calls[0].init.signal.aborted).toBe(true)
    const err = await p.catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('Error') // 不是 AbortError:與網路錯誤同形狀
  })

  it('timeoutMs 覆寫;body 讀取卡住也會逾時', async () => {
    vi.useFakeTimers()
    state.fetch = async () => ({ status: 200, statusText: 'OK', headers: new Headers(), text: () => new Promise<string>(() => {}) })
    const p = hostFetch('https://www.pathofexile.com/api/trade/data/stats', { timeoutMs: 5_000 })
    const assertion = expect(p).rejects.toThrow(/timed out after 5000 ms/)
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
  })

  it('normTimeoutMs:非數字 → 30 秒;夾在 1 秒 ~ 5 分鐘', () => {
    expect(normTimeoutMs(undefined)).toBe(30_000)
    expect(normTimeoutMs('5000')).toBe(30_000)
    expect(normTimeoutMs(Number.NaN)).toBe(30_000)
    expect(normTimeoutMs(10)).toBe(1_000)
    expect(normTimeoutMs(10_000_000)).toBe(300_000)
    expect(normTimeoutMs(45_000)).toBe(45_000)
  })
})

describe('hostFetch 中止(http-abort)', () => {
  it('帶 abort key → abortHostFetch 取消進行中的 session fetch,reject 一般 Error', async () => {
    const calls = hangingFetch()
    const key = abortKeyOf({ source: 'electron' }, 'req-1')!
    const p = hostFetch('https://poe.ninja/poe1/api/x', {}, key)
    expect(inflightCount()).toBe(1)
    expect(abortHostFetch(key)).toBe(true)
    const err = await p.catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/request aborted: poe\.ninja/)
    expect(calls[0].init.signal.aborted).toBe(true)
    expect(inflightCount()).toBe(0)
    expect(abortHostFetch(key)).toBe(false) // 已結束
  })

  it('鍵含來源 / 預覽 cid:別人的 requestId 中止不到;不合法 id → 不可中止', async () => {
    hangingFetch()
    const mine = abortKeyOf({ source: 'preview', clientId: 'tabA' }, 'r1')
    const p = hostFetch('https://poe.ninja/x', {}, mine)
    expect(abortHostFetch(abortKeyOf({ source: 'preview', clientId: 'tabB' }, 'r1'))).toBe(false)
    expect(abortHostFetch(abortKeyOf({ source: 'electron' }, 'r1'))).toBe(false)
    expect(abortKeyOf({ source: 'electron' }, 42)).toBeUndefined()
    expect(abortKeyOf({ source: 'electron' }, 'bad id!')).toBeUndefined()
    expect(abortHostFetch(undefined)).toBe(false)
    expect(abortHostFetch(mine)).toBe(true)
    await expect(p).rejects.toThrow(/aborted/)
  })

  it('正常完成後從 inflight 移除;計時器清掉(不會事後逾時)', async () => {
    vi.useFakeTimers()
    state.fetch = async () => okResponse()
    const key = abortKeyOf({ source: 'electron' }, 'done')!
    const r = await hostFetch('https://poe.ninja/x', {}, key)
    expect(r.body).toBe('ok')
    expect(inflightCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('hostFetch 行為不變', () => {
  it('結果形狀、標頭處理、User-Agent、送出參數與以前相同(另加 signal)', async () => {
    const seen: any[] = []
    state.fetch = async (url, init) => { seen.push({ url, init }); return okResponse(200, '{"a":1}', [['x-rate-limit-ip', '1:1:1']]) }
    const r = await hostFetch('https://www.pathofexile.com/api/trade/search/Standard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'x', Origin: 'y', 'Sec-Fetch-Mode': 'z' },
      body: '{}',
      timeoutMs: 10_000,
      requestId: 'abc'
    })
    expect(r).toEqual({ status: 200, statusText: 'OK', headers: [['x-rate-limit-ip', '1:1:1']], body: '{"a":1}' })
    const { signal, ...rest } = seen[0].init
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(rest).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'UA-test exile-appraiser/0.0.0' },
      body: '{}',
      credentials: 'include',
      redirect: 'follow',
      referrerPolicy: 'no-referrer-when-downgrade'
    })
  })

  it('429 照樣回傳(Retry-After 由 renderer 的 withRetryAfter 處理,main 不重試)', async () => {
    let n = 0
    state.fetch = async () => { n++; return okResponse(429, 'slow down', [['retry-after', '3']]) }
    const r = await hostFetch('https://www.pathofexile.com/api/trade/fetch/x')
    expect(r.status).toBe(429)
    expect(r.headers).toEqual([['retry-after', '3']])
    expect(n).toBe(1)
  })

  it('網路錯誤原樣丟出;白名單外 → refused host', async () => {
    state.fetch = async () => { throw new TypeError('net::ERR_CONNECTION_RESET') }
    await expect(hostFetch('https://poe.ninja/x')).rejects.toThrow('net::ERR_CONNECTION_RESET')
    await expect(hostFetch('https://evil.example/x')).rejects.toThrow('refused host: evil.example')
    await expect(hostFetch('http://poe.ninja/x')).rejects.toThrow('refused host')
  })
})

describe('installCookiePatch', () => {
  it('只掛在交易站 / poe.ninja / Cloudflare 挑戰網域;剝 Partitioned 的邏輯不變', () => {
    state.onHeadersReceived.length = 0
    installCookiePatch()
    expect(state.onHeadersReceived).toHaveLength(1)
    const [filter, listener] = state.onHeadersReceived[0]
    expect(filter).toEqual({ urls: [...COOKIE_PATCH_URLS] })
    // 涵蓋 http.ts ALLOWED_HOSTS 三個主機(match pattern 的 *.host 含 host 本身)
    for (const host of ['www.pathofexile.com', 'pathofexile.tw', 'poe.ninja']) {
      expect(COOKIE_PATCH_URLS.some(p => {
        const h = /^\*:\/\/(\*\.)?([^/]+)\/\*$/.exec(p)!
        return h[1] ? host === h[2] || host.endsWith('.' + h[2]) : host === h[2]
      }), host).toBe(true)
    }
    const next = vi.fn()
    listener({ responseHeaders: { 'set-cookie': ['cf_clearance=abc; Path=/; Secure; Partitioned; SameSite=None'] } }, next)
    expect(next).toHaveBeenCalledWith({ responseHeaders: { 'set-cookie': ['cf_clearance=abc; Path=/; Secure; SameSite=None'] } })
    const next2 = vi.fn()
    listener({ responseHeaders: { 'content-type': ['text/html'] } }, next2)
    expect(next2).toHaveBeenCalledWith({ responseHeaders: { 'content-type': ['text/html'] } })
  })
})
