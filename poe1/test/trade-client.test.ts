import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import { withRetryAfter, parseRetryAfter } from '@exile-appraiser/core/http'
import { tradeSession, resetTradeSessions } from '@/web/price-check/trade/common'
import { requestTradeResultList, requestResults } from '@/web/price-check/trade/pathofexile-trade'
import { createPresets, createTradeRequest, searchPrices, bulkPrices, bulkHaveCurrencies } from '../src/index'
import { listFixtures, runFixture } from './helpers/fixture-harness'
import type { ParsedItem } from '@/parser/ParsedItem'

/**
 * 交易層在**離線**下的行為:請求走注入的 HttpFetch,所以這裡用錄製/合成的回應驗證
 * search → fetch 分批、快取、`X-Rate-Limit-*` 對齊、429 Retry-After、每個 realm 各自的狀態。
 * 沒有任何真實網路請求。
 */
interface Recorded { url: string, init?: any }

function response (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  const h = new Headers(headers)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: h,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

function fakeHttp (handler: (url: string, init?: any) => HttpResponse, log: Recorded[] = []): HttpFetch {
  return async (url, init) => {
    log.push({ url, init })
    return handler(url, init)
  }
}

const RATE_HEADERS = {
  'x-rate-limit-rules': 'Ip',
  'x-rate-limit-ip': '8:10:60,15:60:120,60:300:1800',
  'x-rate-limit-ip-state': '1:10:0,1:60:0,1:300:0'
}

function fetchBody (ids: string[]) {
  return {
    result: ids.map(id => ({
      id,
      item: { ilvl: 84, note: '~price 5 chaos' },
      listing: {
        indexed: new Date().toISOString(),
        price: { amount: 5, currency: 'chaos', type: '~price' },
        account: { name: 'seller', lastCharacterName: 'Seller', online: {} }
      }
    }))
  }
}

let item: ParsedItem
beforeAll(async () => {
  await init('cmn-Hant')
  const fx = (await listFixtures('cmn-Hant')).find(f => f.name === 'map-rare-01')!
  const outcome = await runFixture(fx)
  if (outcome.kind !== 'parsed') throw new Error(outcome.error)
  item = outcome.item
})
afterEach(() => resetTradeSessions())

function presetFor (realm: 'intl' | 'tw') {
  const { presets, active } = createPresets(item, {
    league: 'Standard', realm, clientLanguage: 'cmn-Hant', searchStatRange: 10,
    currency: null, collapseListings: 'api', activateStockFilter: false, merchantOnly: false
  })
  return presets.find(p => p.id === active) ?? presets[0]
}

describe('search → fetch', () => {
  it('打對 host、POST JSON、分兩批各 10 筆、結果順序正確', async () => {
    const log: Recorded[] = []
    const ids = Array.from({ length: 25 }, (_, i) => `id${i}`)
    const http = fakeHttp((url) => {
      if (url.includes('/api/trade/search/')) return response(200, { id: 'abc', result: ids, total: 25 }, RATE_HEADERS)
      const m = url.match(/\/fetch\/([^?]+)\?query=abc$/)!
      return response(200, fetchBody(m[1].split(',')), RATE_HEADERS)
    }, log)
    const ctx = { http, realm: 'intl' as const, latencySeconds: 0, accountName: '' }

    const { search, results } = await searchPrices(ctx, presetFor('intl'))
    expect(search.id).toBe('abc')
    expect(log[0].url).toBe('https://www.pathofexile.com/api/trade/search/Standard')
    expect(log[0].init.method).toBe('POST')
    expect(JSON.parse(log[0].init.body).query).toBeDefined()
    expect(log.slice(1).map(r => r.url)).toEqual([
      'https://www.pathofexile.com/api/trade/fetch/' + ids.slice(0, 10).join(',') + '?query=abc',
      'https://www.pathofexile.com/api/trade/fetch/' + ids.slice(10, 20).join(',') + '?query=abc'
    ])
    expect(results.map(r => r.id)).toEqual(ids.slice(0, 20))
    expect(results[0].priceAmount).toBe(5)
  })

  it('台服:每個群組只送台服交易站清單有的 id(台服不認得的 id 會讓整個查詢回 Invalid query,2026-11-15 實測);選項型 id 以 | 前的部分比對', async () => {
    const group = { type: 'count' as const, value: { min: 1 }, filters: [{ id: 'explicit.indexable_support_1' }, { id: 'explicit.effect_9' }] }
    const body = (): any => ({ query: { status: { option: 'available' }, stats: [{ type: 'and', filters: [{ id: 'explicit.stat_1' }, { id: 'implicit.stat_404' }, { id: 'enchant.stat_7|49' }] }, group, { type: 'not', filters: [{ id: 'fractured.stat_404' }] }, { type: 'count', value: { min: 1 }, filters: [{ id: 'explicit.stat_404' }] }, { type: 'count', value: { min: 1, max: 1 }, filters: [{ id: 'explicit.stat_1' }, { id: 'explicit.stat_404' }] }, { type: 'mercenary', value: { min: 3 }, filters: [{ id: 'explicit.stat_1' }, { id: 'explicit.stat_404' }] }] }, sort: { price: 'asc' } })
    const twStats = { result: [{ id: 'explicit', entries: [{ id: 'explicit.indexable_support_1', text: 'a' }, { id: 'explicit.stat_1', text: 'b' }] }, { id: 'enchant', entries: [{ id: 'enchant.stat_7', text: 'c' }] }] }
    const sent = (log: Recorded[]) => log.filter(r => r.url.includes('/search/')).map(r => JSON.parse(r.init.body).query.stats[1].filters.map((f: any) => f.id))

    const log: Recorded[] = []
    const http = fakeHttp(url => url.endsWith('/api/trade/data/stats') ? response(200, twStats) : response(200, { id: 'x', result: [], total: 0 }, RATE_HEADERS), log)
    const twCtx = { http, realm: 'tw' as const, latencySeconds: 0, accountName: '' }
    await requestTradeResultList(twCtx, body(), 'Standard')
    await requestTradeResultList(twCtx, { ...body(), sort: { price: 'desc' } }, 'Standard')
    expect(sent(log)).toEqual([['explicit.indexable_support_1'], ['explicit.indexable_support_1']])
    expect(log.filter(r => r.url === 'https://pathofexile.tw/api/trade/data/stats')).toHaveLength(1) // 清單每個 session 只抓一次
    // and 群組拿掉台服沒有的、選項型 id 留著;清空的 not、一個都不剩的 count 整組拿掉;
    // 帶數量的群組(count 有 max、傭兵加權)少一個 id 語意就變了 → 整組拿掉
    expect(JSON.parse(log.find(r => r.url.includes('/search/'))!.init.body).query.stats).toEqual([
      { type: 'and', filters: [{ id: 'explicit.stat_1' }, { id: 'enchant.stat_7|49' }] },
      { type: 'count', value: { min: 1 }, filters: [{ id: 'explicit.indexable_support_1' }] }
    ])

    // 國際服不抓清單、原樣送
    const log2: Recorded[] = []
    await requestTradeResultList({ ...twCtx, http: fakeHttp(() => response(200, { id: 'y', result: [], total: 0 }, RATE_HEADERS), log2), realm: 'intl' as const }, body(), 'Standard')
    expect(log2.map(r => r.url)).toEqual(['https://www.pathofexile.com/api/trade/search/Standard'])
    expect(sent(log2)).toEqual([['explicit.indexable_support_1', 'explicit.effect_9']])

    // 清單抓不到(或台服兩個都沒有)→ 原樣送
    resetTradeSessions()
    const log3: Recorded[] = []
    await requestTradeResultList({ ...twCtx, http: fakeHttp(url => url.endsWith('/data/stats') ? response(500, {}) : response(200, { id: 'z', result: [], total: 0 }, RATE_HEADERS), log3) }, body(), 'Standard')
    expect(sent(log3)).toEqual([['explicit.indexable_support_1', 'explicit.effect_9']])
  })

  it('台服清單:並行只抓一次;抓不到 1 分鐘內不再試、之後重抓;成功後 6 小時重抓', async () => {
    const body = (n: number): any => ({ query: { status: { option: 'available' }, stats: [{ type: 'and', filters: [{ id: 'explicit.stat_1' }] }] }, sort: { price: 'asc' }, n })
    let ok = false
    const log: Recorded[] = []
    const http = fakeHttp(url => url.endsWith('/data/stats')
      ? (ok ? response(200, { result: [{ entries: [{ id: 'explicit.stat_1' }] }] }) : response(500, {}))
      : response(200, { id: 'x', result: [], total: 0 }, RATE_HEADERS), log)
    const ctx = { http, realm: 'tw' as const, latencySeconds: 0, accountName: '' }
    const lists = () => log.filter(r => r.url.endsWith('/data/stats')).length
    const real = Date.now
    let now = 1_000_000
    Date.now = () => now
    try {
      await Promise.all([requestTradeResultList(ctx, body(1), 'Standard'), requestTradeResultList(ctx, body(2), 'Standard')])
      expect(lists()).toBe(1)
      now += 30_000
      await requestTradeResultList(ctx, body(3), 'Standard')
      expect(lists()).toBe(1)
      ok = true
      now += 31_000
      await requestTradeResultList(ctx, body(4), 'Standard')
      expect(lists()).toBe(2)
      now += 5 * 60 * 60 * 1000
      await requestTradeResultList(ctx, body(5), 'Standard')
      expect(lists()).toBe(2)
      now += 61 * 60 * 1000
      await requestTradeResultList(ctx, body(6), 'Standard')
      expect(lists()).toBe(3)
    } finally {
      Date.now = real
    }
  })

  it('台服 realm 打 pathofexile.tw,且與國際服的限流/快取互不影響', async () => {
    const log: Recorded[] = []
    const http = fakeHttp(() => response(200, { id: 'tw1', result: [], total: 0 }, RATE_HEADERS), log)
    const twCtx = { http, realm: 'tw' as const, latencySeconds: 0, accountName: '' }
    const intlCtx = { ...twCtx, realm: 'intl' as const }

    const request = createTradeRequest(presetFor('tw'))
    await requestTradeResultList(twCtx, request, 'Standard')
    // 台服會先抓一次交易站 id 清單(這個假回應不是清單 → 視為抓不到、原樣送);以下只看 search 請求
    const searches = () => log.filter(r => r.url.includes('/search/'))
    expect(searches()[0].url).toBe('https://pathofexile.tw/api/trade/search/Standard')

    // 同 body 再查 tw 命中快取(不再發請求);查 intl 則必須真的發
    await requestTradeResultList(twCtx, request, 'Standard')
    expect(searches().length).toBe(1)
    await requestTradeResultList(intlCtx, request, 'Standard')
    expect(searches().length).toBe(2)
    expect(searches()[1].url).toBe('https://www.pathofexile.com/api/trade/search/Standard')

    expect(tradeSession('tw').limits.SEARCH).not.toBe(tradeSession('intl').limits.SEARCH)
  })

  it('依 X-Rate-Limit-* 標頭對齊限流規則(視窗加上延遲補償)', async () => {
    const http = fakeHttp(() => response(200, { id: 'x', result: [], total: 0 }, RATE_HEADERS))
    const ctx = { http, realm: 'intl' as const, latencySeconds: 2, accountName: '' }
    await requestTradeResultList(ctx, createTradeRequest(presetFor('intl')), 'Standard')
    const limits = [...tradeSession('intl').limits.SEARCH].map(l => `${l.max}:${l.window}`).sort()
    expect(limits).toEqual(['15:62', '60:302', '8:12'])
  })

  it('API 回 error 物件時丟出其 message(例如 Query is too complex)', async () => {
    const http = fakeHttp(() => response(400, { error: { code: 2, message: 'Query is too complex.' } }))
    const ctx = { http, realm: 'intl' as const, latencySeconds: 0, accountName: '' }
    await expect(requestTradeResultList(ctx, createTradeRequest(presetFor('intl')), 'Standard'))
      .rejects.toThrow('Query is too complex.')
  })

  it('requestResults 的快取鍵含 realm', async () => {
    const log: Recorded[] = []
    const http = fakeHttp((url) => response(200, fetchBody(url.match(/fetch\/([^?]+)/)![1].split(','))), log)
    await requestResults({ http, realm: 'intl', latencySeconds: 0, accountName: '' }, 'q', ['a', 'b'])
    await requestResults({ http, realm: 'intl', latencySeconds: 0, accountName: '' }, 'q', ['a', 'b'])
    await requestResults({ http, realm: 'tw', latencySeconds: 0, accountName: '' }, 'q', ['a', 'b'])
    expect(log.map(r => new URL(r.url).host)).toEqual(['www.pathofexile.com', 'pathofexile.tw'])
  })
})

describe('bulk(大宗交易)', () => {
  it('have 的選擇照上游規則', () => {
    expect(bulkHaveCurrencies({ info: { refName: 'Chaos Orb' } } as ParsedItem)).toEqual(['divine'])
    expect(bulkHaveCurrencies({ info: { refName: 'Divine Orb' } } as ParsedItem)).toEqual(['chaos'])
    expect(bulkHaveCurrencies({ info: { refName: 'Exalted Orb' } } as ParsedItem)).toEqual(['divine', 'chaos'])
  })

  it('打 /api/trade/exchange 並帶 have/want', async () => {
    const log: Recorded[] = []
    const http = fakeHttp(() => response(200, { id: 'ex', result: {}, total: 0 }, RATE_HEADERS), log)
    const preset = presetFor('tw')
    const fakeCurrency = { ...item, info: { ...item.info, refName: 'Exalted Orb', tradeTag: 'exalted' } } as ParsedItem
    const { request } = await bulkPrices({ http, realm: 'tw', latencySeconds: 0, accountName: '' }, fakeCurrency, preset.filters)
    expect(log[0].url).toBe('https://pathofexile.tw/api/trade/exchange/Standard')
    expect(request.query.want).toEqual(['exalted'])
    expect(request.query.have).toEqual(['divine', 'chaos'])
  })
})

describe('429 Retry-After', () => {
  it('parseRetryAfter 支援秒數與 HTTP 日期,缺少時用預設', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '7' }))).toBe(7)
    expect(parseRetryAfter(new Headers())).toBe(60)
    const inFuture = new Date(Date.now() + 5000).toUTCString()
    expect(parseRetryAfter(new Headers({ 'retry-after': inFuture }))).toBeGreaterThanOrEqual(4)
  })

  it('withRetryAfter 等待後重試一次;超過上限就不等', async () => {
    let calls = 0
    const waits: number[] = []
    const base: HttpFetch = async () => {
      calls++
      return calls === 1 ? response(429, {}, { 'retry-after': '3' }) : response(200, { ok: true })
    }
    const http = withRetryAfter(base, { sleep: async ms => { waits.push(ms) }, maxWaitSeconds: 10 })
    const res = await http('https://example.invalid/x')
    expect(res.status).toBe(200)
    expect(waits).toEqual([3000])

    calls = 0
    const tooLong = withRetryAfter(async () => { calls++; return response(429, {}, { 'retry-after': '120' }) },
      { sleep: async () => { throw new Error('不應等待') }, maxWaitSeconds: 60 })
    expect((await tooLong('https://example.invalid/x')).status).toBe(429)
    expect(calls).toBe(1)
  })
})
