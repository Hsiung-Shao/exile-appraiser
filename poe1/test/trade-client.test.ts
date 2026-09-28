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

  it('台服 realm 打 pathofexile.tw,且與國際服的限流/快取互不影響', async () => {
    const log: Recorded[] = []
    const http = fakeHttp(() => response(200, { id: 'tw1', result: [], total: 0 }, RATE_HEADERS), log)
    const twCtx = { http, realm: 'tw' as const, latencySeconds: 0, accountName: '' }
    const intlCtx = { ...twCtx, realm: 'intl' as const }

    const request = createTradeRequest(presetFor('tw'))
    await requestTradeResultList(twCtx, request, 'Standard')
    expect(log[0].url).toBe('https://pathofexile.tw/api/trade/search/Standard')

    // 同 body 再查 tw 命中快取(不再發請求);查 intl 則必須真的發
    await requestTradeResultList(twCtx, request, 'Standard')
    expect(log.length).toBe(1)
    await requestTradeResultList(intlCtx, request, 'Standard')
    expect(log.length).toBe(2)
    expect(log[1].url).toBe('https://www.pathofexile.com/api/trade/search/Standard')

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
