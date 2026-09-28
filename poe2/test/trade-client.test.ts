import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import { tradeSession, resetTradeSessions } from '@/web/price-check/trade/common'
import { requestTradeResultList, requestResults } from '@/web/price-check/trade/pathofexile-trade'
import { createPresets, createTradeRequest, searchPrices, bulkPrices, bulkHaveCurrencies } from '../src/index'
import { setupTests } from './vitest.setup'
import { listFixtures, runFixture } from './zhTW/helpers/fixture-harness'
import type { ParsedItem } from '@/parser/ParsedItem'

/**
 * PoE2 交易層在**離線**下的行為(抄 poe1/test/trade-client.test.ts,換成 `/api/trade2/*`):
 * 請求走注入的 HttpFetch,用合成的回應驗證 search → fetch 分批、快取、`X-Rate-Limit-*` 對齊、
 * 每個 realm 各自的狀態。沒有任何真實網路請求。(429 Retry-After 屬 core,poe1 那份已測。)
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
      item: { ilvl: 80, name: '', typeLine: 'Kamasan Tiara', baseType: 'Kamasan Tiara', note: '~price 5 exalted' },
      listing: {
        indexed: new Date().toISOString(),
        price: { amount: 5, currency: 'exalted', type: '~price' },
        account: { name: 'seller', lastCharacterName: 'Seller', online: {} }
      }
    }))
  }
}

let item: ParsedItem
beforeAll(async () => {
  setupTests({ language: 'cmn-Hant' })
  await init('cmn-Hant')
  const fx = (await listFixtures('cmn-Hant')).find(f => f.name === 'helmet-rare-kamasan-tiara-01')!
  const outcome = runFixture(fx)
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

describe('search → fetch(/api/trade2)', () => {
  it('打對 host 與 trade2 路徑、POST JSON、分兩批各 10 筆、結果順序正確', async () => {
    const log: Recorded[] = []
    const ids = Array.from({ length: 25 }, (_, i) => `id${i}`)
    const http = fakeHttp((url) => {
      if (url.includes('/api/trade2/search/')) return response(200, { id: 'abc', result: ids, total: 25 }, RATE_HEADERS)
      const m = url.match(/\/api\/trade2\/fetch\/([^?]+)\?query=abc$/)!
      return response(200, fetchBody(m[1].split(',')), RATE_HEADERS)
    }, log)
    const ctx = { http, realm: 'intl' as const, latencySeconds: 0, accountName: '' }

    const { search, results } = await searchPrices(ctx, presetFor('intl'), item)
    expect(search.id).toBe('abc')
    expect(log[0].url).toBe('https://www.pathofexile.com/api/trade2/search/Standard')
    expect(log[0].init.method).toBe('POST')
    expect(JSON.parse(log[0].init.body).query).toBeDefined()
    expect(log.slice(1).map(r => r.url)).toEqual([
      'https://www.pathofexile.com/api/trade2/fetch/' + ids.slice(0, 10).join(',') + '?query=abc',
      'https://www.pathofexile.com/api/trade2/fetch/' + ids.slice(10, 20).join(',') + '?query=abc'
    ])
    expect(results.map(r => r.id)).toEqual(ids.slice(0, 20))
    expect(results[0].priceAmount).toBe(5)
    // 上游 PoE2 會把交易站通貨代碼轉成顯示用代碼;這裡只確認金額與「有價」
    expect(results[0].priceCurrency).not.toBe('no price')
  })

  it('台服 realm 打 pathofexile.tw/api/trade2,且與國際服的限流/快取互不影響', async () => {
    const log: Recorded[] = []
    const http = fakeHttp(() => response(200, { id: 'tw1', result: [], total: 0 }, RATE_HEADERS), log)
    const twCtx = { http, realm: 'tw' as const, latencySeconds: 0, accountName: '' }
    const intlCtx = { ...twCtx, realm: 'intl' as const }

    const request = createTradeRequest(presetFor('tw'), item)
    await requestTradeResultList(twCtx, request, '標準模式')
    expect(log[0].url).toBe(`https://pathofexile.tw/api/trade2/search/${encodeURIComponent('標準模式')}`)

    // 同 body 再查 tw 命中快取(不再發請求);查 intl 則必須真的發
    await requestTradeResultList(twCtx, request, '標準模式')
    expect(log.length).toBe(1)
    await requestTradeResultList(intlCtx, request, 'Standard')
    expect(log.length).toBe(2)
    expect(log[1].url).toBe('https://www.pathofexile.com/api/trade2/search/Standard')

    expect(tradeSession('tw').limits.SEARCH).not.toBe(tradeSession('intl').limits.SEARCH)
  })

  it('依 X-Rate-Limit-* 標頭對齊限流規則(視窗加上延遲補償)', async () => {
    const http = fakeHttp(() => response(200, { id: 'x', result: [], total: 0 }, RATE_HEADERS))
    const ctx = { http, realm: 'intl' as const, latencySeconds: 2, accountName: '' }
    await requestTradeResultList(ctx, createTradeRequest(presetFor('intl'), item), 'Standard')
    const limits = [...tradeSession('intl').limits.SEARCH].map(l => `${l.max}:${l.window}`).sort()
    expect(limits).toEqual(['15:62', '60:302', '8:12'])
  })

  it('API 回 error 物件時丟出其 message(例如 Query is too complex)', async () => {
    const http = fakeHttp(() => response(400, { error: { code: 2, message: 'Query is too complex.' } }))
    const ctx = { http, realm: 'intl' as const, latencySeconds: 0, accountName: '' }
    await expect(requestTradeResultList(ctx, createTradeRequest(presetFor('intl'), item), 'Standard'))
      .rejects.toThrow('Query is too complex.')
  })

  it('requestResults 的快取鍵含 realm', async () => {
    const log: Recorded[] = []
    const http = fakeHttp((url) => response(200, fetchBody(url.match(/fetch\/([^?]+)/)![1].split(','))), log)
    await requestResults({ http, realm: 'intl', latencySeconds: 0, accountName: '' }, 'q', ['a', 'b'])
    await requestResults({ http, realm: 'intl', latencySeconds: 0, accountName: '' }, 'q', ['a', 'b'])
    await requestResults({ http, realm: 'tw', latencySeconds: 0, accountName: '' }, 'q', ['a', 'b'])
    expect(log.map(r => new URL(r.url).host)).toEqual(['www.pathofexile.com', 'pathofexile.tw'])
    expect(log.every(r => new URL(r.url).pathname.startsWith('/api/trade2/fetch/'))).toBe(true)
  })

  it('isMine 依 ctx.accountName 判定', async () => {
    const http = fakeHttp((url) => response(200, fetchBody(url.match(/fetch\/([^?]+)/)![1].split(','))))
    const [mine] = await requestResults({ http, realm: 'intl', latencySeconds: 0, accountName: 'seller' }, 'q', ['m'])
    expect(mine.isMine).toBe(true)
  })
})

describe('bulk(大宗交易,/api/trade2/exchange)', () => {
  it('have 的選擇照上游 bulk-api.ts 規則', () => {
    expect(bulkHaveCurrencies({ info: { refName: 'Exalted Orb' } } as ParsedItem)).toEqual(['divine', 'chaos'])
    expect(bulkHaveCurrencies({ info: { refName: 'Chaos Orb' } } as ParsedItem)).toEqual(['divine', 'exalted'])
    expect(bulkHaveCurrencies({ info: { refName: 'Divine Orb' } } as ParsedItem)).toEqual(['exalted', 'chaos'])
    expect(bulkHaveCurrencies({ info: { refName: 'Orb of Annulment' } } as ParsedItem)).toEqual(['divine', 'exalted', 'chaos'])
  })

  it('打 /api/trade2/exchange 並帶 have/want', async () => {
    const log: Recorded[] = []
    const http = fakeHttp(() => response(200, { id: 'ex', result: {}, total: 0 }, RATE_HEADERS), log)
    const preset = presetFor('tw')
    const fakeCurrency = { ...item, info: { ...item.info, refName: 'Exalted Orb', tradeTag: 'exalted' } } as ParsedItem
    const { request } = await bulkPrices({ http, realm: 'tw', latencySeconds: 0, accountName: '' }, fakeCurrency, preset.filters)
    expect(log[0].url).toBe('https://pathofexile.tw/api/trade2/exchange/Standard')
    expect(request.query.want).toEqual(['exalted'])
    expect(request.query.have).toEqual(['divine', 'chaos'])
  })
})
