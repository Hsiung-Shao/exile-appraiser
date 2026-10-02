// renderer/src/web/background/host-fetch.ts:AbortSignal → requestId + fetchAbort(IPC http-abort)的轉接。
// 假 host(不需要 Electron / 瀏覽器);另驗 core 的 withRetryAfter 不會把中止 / 逾時錯誤當成可重試。
import { describe, expect, it, vi } from 'vitest'
import { fetchViaHost, newRequestId } from '../src/web/background/host-fetch'
import { withRetryAfter, type HttpFetch } from '@exile-appraiser/core/http'
import { NINJA_TIMEOUT_MS, createNinjaClient } from '@exile-appraiser/core/ninja'

function fakeHost () {
  const calls: Array<{ url: string, init: any }> = []
  const aborts: string[] = []
  const pending = new Map<string, { resolve: (v: any) => void, reject: (e: unknown) => void }>()
  const host = {
    fetch: vi.fn((url: string, init?: any) => {
      calls.push({ url, init })
      return new Promise<any>((resolve, reject) => { pending.set(init?.requestId ?? url, { resolve, reject }) })
    }),
    fetchAbort: vi.fn(async (id: string) => {
      aborts.push(id)
      // main 端:中止 → invoke reject 一般 Error
      pending.get(id)?.reject(new Error(`Error invoking remote method 'http-fetch': Error: request aborted: poe.ninja/x`))
      return true
    })
  }
  return { host, calls, aborts, pending }
}

const RESULT = { status: 200, statusText: 'OK', headers: [] as Array<[string, string]>, body: 'ok' }

describe('fetchViaHost', () => {
  it('沒帶 signal:參數原樣轉交(與以前完全相同,不加 requestId)', async () => {
    const { host, calls, pending } = fakeHost()
    const init = { method: 'POST' as const, body: '{}' }
    const p = fetchViaHost(host, 'https://x/a', init)
    pending.get('https://x/a')!.resolve(RESULT)
    await expect(p).resolves.toBe(RESULT)
    expect(calls[0].init).toBe(init)
    const p2 = fetchViaHost(host, 'https://x/b')
    pending.get('https://x/b')!.resolve(RESULT)
    await p2
    expect(calls[1].init).toBeUndefined()
  })

  it('帶 signal:改帶 requestId(signal 不送過 IPC);正常完成不送 fetchAbort', async () => {
    const { host, calls, aborts, pending } = fakeHost()
    const ctrl = new AbortController()
    const p = fetchViaHost(host, 'https://x/a', { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    const sent = calls[0].init
    expect(sent.signal).toBeUndefined()
    expect(sent.headers).toEqual({ Accept: 'application/json' })
    expect(typeof sent.requestId).toBe('string')
    pending.get(sent.requestId)!.resolve(RESULT)
    await expect(p).resolves.toBe(RESULT)
    ctrl.abort()
    expect(aborts).toEqual([])
  })

  it('signal abort → 立即以 signal.reason reject,並送 fetchAbort(requestId) 給 main', async () => {
    const { host, calls, aborts } = fakeHost()
    const ctrl = new AbortController()
    const p = fetchViaHost(host, 'https://x/a', { signal: ctrl.signal })
    ctrl.abort()
    const err = await p.catch(e => e)
    expect(err).toBe(ctrl.signal.reason)
    expect((err as Error).name).toBe('AbortError')
    expect(aborts).toEqual([calls[0].init.requestId])
  })

  it('已中止的 signal:不送請求', async () => {
    const { host, calls } = fakeHost()
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(fetchViaHost(host, 'https://x/a', { signal: ctrl.signal })).rejects.toBe(ctrl.signal.reason)
    expect(calls).toHaveLength(0)
  })

  it('舊 host 沒有 fetchAbort:照樣在 renderer 端 reject', async () => {
    const { host } = fakeHost()
    const ctrl = new AbortController()
    const p = fetchViaHost({ fetch: host.fetch }, 'https://x/a', { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toBe(ctrl.signal.reason)
  })

  it('newRequestId 每次不同且符合 main 端格式', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newRequestId()))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_.:-]{1,80}$/)
  })
})

describe('withRetryAfter 對中止 / 逾時不重試(行為不變)', () => {
  it('AbortError / 逾時 Error 直接丟出,只呼叫一次', async () => {
    const sleep = vi.fn(async () => {})
    for (const mk of [() => Object.assign(new Error('aborted'), { name: 'AbortError' }), () => new Error('request timed out after 30000 ms: poe.ninja/x')]) {
      const http = vi.fn<HttpFetch>(async () => { throw mk() })
      await expect(withRetryAfter(http, { sleep })('https://x')).rejects.toThrow()
      expect(http).toHaveBeenCalledTimes(1)
    }
    expect(sleep).not.toHaveBeenCalled()
  })

  it('429 + Retry-After 仍等待後重試一次,init(含 signal)原樣傳下去', async () => {
    const sleep = vi.fn(async () => {})
    const ctrl = new AbortController()
    const responses = [new Response('', { status: 429, headers: { 'retry-after': '2' } }), new Response('ok', { status: 200 })]
    const http = vi.fn<HttpFetch>(async () => responses.shift()!)
    const r = await withRetryAfter(http, { sleep })('https://x', { signal: ctrl.signal })
    expect(r.status).toBe(200)
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(http).toHaveBeenCalledTimes(2)
    expect(http.mock.calls[1][1]?.signal).toBe(ctrl.signal)
  })
})

describe('ninja client 把 signal 交給 http(換聯盟中止會傳到 main)', () => {
  it('fetchAll 的 signal 出現在每個請求的 init;中止 → 丟 signal.reason', async () => {
    const ctrl = new AbortController()
    const inits: any[] = []
    const client = createNinjaClient({
      game: 'poe1',
      league: 'Standard',
      intervalMs: 0,
      sleep: async () => {},
      http: async (_url, init) => {
        inits.push(init)
        ctrl.abort()
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }
    })
    await expect(client.fetchAll(undefined, { signal: ctrl.signal })).rejects.toBe(ctrl.signal.reason)
    expect(inits).toHaveLength(1)
    expect(inits[0]).toEqual({ headers: { Accept: 'application/json' }, timeoutMs: NINJA_TIMEOUT_MS, signal: ctrl.signal })
  })

  it('沒有 signal:init 與以前相同', async () => {
    const inits: any[] = []
    const client = createNinjaClient({
      game: 'poe1',
      league: 'Standard',
      intervalMs: 0,
      sleep: async () => {},
      http: async (_url, init) => { inits.push(init); throw new Error('offline') }
    })
    await expect(client.fetchAll()).rejects.toThrow(/poe\.ninja/)
    expect(inits[0]).toEqual({ headers: { Accept: 'application/json' }, timeoutMs: NINJA_TIMEOUT_MS })
  })

  it('code review 第 B 批:ninja 的 timeoutMs(120 秒)經 fetchViaHost 原樣送到 main(有 / 沒有 signal 都是)', async () => {
    expect(NINJA_TIMEOUT_MS).toBe(120_000)
    const { host, calls, pending } = fakeHost()
    const ctrl = new AbortController()
    const client = createNinjaClient({
      game: 'poe1',
      league: 'Standard',
      intervalMs: 0,
      sleep: async () => {},
      http: async (url, init) => {
        const p = fetchViaHost(host, url, init)
        const sent = calls[calls.length - 1].init
        pending.get(sent?.requestId ?? url)!.resolve({ status: 500, statusText: 'x', headers: [], body: '' })
        return await p.then(r => ({ ok: false, status: r.status, headers: new Headers(), json: async () => null, text: async () => '' }))
      }
    })
    await expect(client.fetchAll({ exchange: ['Currency'], item: [] }, { signal: ctrl.signal })).rejects.toThrow()
    expect(calls[0].init.timeoutMs).toBe(120_000)
    expect(calls[0].init.signal).toBeUndefined()
    const { host: host2, calls: calls2, pending: pending2 } = fakeHost()
    const p = fetchViaHost(host2, 'https://poe.ninja/x', { headers: {}, timeoutMs: NINJA_TIMEOUT_MS })
    pending2.get('https://poe.ninja/x')!.resolve(RESULT)
    await p
    expect(calls2[0].init.timeoutMs).toBe(120_000)
  })
})
