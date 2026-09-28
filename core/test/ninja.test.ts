/**
 * poe.ninja 價格源:以真實回應錄製檔(`recordings/ninja/`,2026-09-28 Allflame 抓一次,見 `_meta.json`)驗證
 * 解析、鍵、divine 匯率、低信心、同鍵合併、請求間隔、中止、快照與 TTL、查詢與詳細頁網址。
 * 規則出處:PobTools `host/warehouse_ninja.cpp` / `warehouse_pricing.cpp`、APT `renderer/src/web/background/Prices.ts`。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HttpFetch, HttpResponse } from '../src/http/HttpClient'
import {
  NINJA_CATEGORIES, NINJA_CACHE_TTL_MS, chaosFactor, createMemoryNinjaCache, createNinjaClient, gemKey,
  isFresh, lookupPrice, ninjaCacheFileName, ninjaDetailsUrl, ninjaLeagueSlug, parseExchangeOverview,
  parseItemOverview, parseSnapshot, toSnapshot, uniqueKey, type NinjaFetchResult, type NinjaSnapshot
} from '../src/ninja'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'recordings/ninja')
const LEAGUE = 'Allflame'

function read (file: string): string {
  return fs.readFileSync(path.join(DIR, file), 'utf8')
}

function response (status: number, body: string): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => JSON.parse(body),
    text: async () => body
  }
}

/** 依網址回錄製檔;`override` 可改寫/弄壞某個類別。 */
function recordingHttp (override: Record<string, { status: number, body: string }> = {}) {
  const urls: string[] = []
  const http: HttpFetch = async (url) => {
    urls.push(url)
    const u = new URL(url)
    const type = u.searchParams.get('type')!
    const kind = u.pathname.includes('/exchange/') ? 'exchange' : 'item'
    const o = override[`${kind}_${type}`]
    if (o) return response(o.status, o.body)
    const file = `${kind}_${type}.json`
    if (!fs.existsSync(path.join(DIR, file))) return response(404, 'not found')
    return response(200, read(file))
  }
  return { http, urls }
}

function noSleep () {
  const calls: number[] = []
  return { sleep: async (ms: number) => { calls.push(ms) }, calls }
}

describe('recordings', () => {
  it('_meta.json 列出每個錄製檔的來源網址與原始大小', () => {
    const meta = JSON.parse(read('_meta.json'))
    expect(meta.league).toBe(LEAGUE)
    for (const [file, info] of Object.entries<{ url: string, status: number }>(meta.files)) {
      expect(fs.existsSync(path.join(DIR, file))).toBe(true)
      expect(info.url).toMatch(/^https:\/\/poe\.ninja\/poe1\/api\/economy\//)
      expect(info.status).toBe(200)
    }
  })

  it('PoE1 type=Catalyst 回空:催化劑在 Currency 類(所以類別清單不列 Catalyst)', () => {
    expect(parseExchangeOverview(JSON.parse(read('exchange_Catalyst.json')), 'Catalyst').lines).toHaveLength(0)
    const currency = parseExchangeOverview(JSON.parse(read('exchange_Currency.json')), 'Currency')
    expect(currency.lines.some(l => l.key === 'currency|Tainted Catalyst')).toBe(true)
    expect(NINJA_CATEGORIES.poe1.exchange).not.toContain('Catalyst')
  })
})

describe('fetchAll(PoE1 錄製檔)', () => {
  const { http, urls } = recordingHttp()
  const { sleep, calls } = noSleep()
  const client = createNinjaClient({ http, game: 'poe1', league: LEAGUE, sleep, now: () => 1_000_000 })
  let result!: NinjaFetchResult
  beforeAll(async () => { result = await client.fetchAll() })

  it('照順序打 exchange 12 類 + item 8 類,每個請求之間等 300ms', () => {
    const expected = [
      ...NINJA_CATEGORIES.poe1.exchange.map(t => `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=Allflame&type=${t}`),
      ...NINJA_CATEGORIES.poe1.item.map(t => `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Allflame&type=${t}`)
    ]
    expect(urls).toEqual(expected)
    expect(calls).toEqual(new Array(expected.length - 1).fill(300))
    expect(result.fetchedTypes).toHaveLength(20)
    expect(result.failedTypes).toEqual([])
    expect(result.fetchedAt).toBe(1_000_000)
  })

  it('divine 匯率取 exchange core.rates(1 / 0.002691)', () => {
    expect(result.divineRate).toBeCloseTo(1 / 0.002691, 6)
    expect(Math.round(result.divineRate!)).toBe(372)
  })

  it('傳奇鍵 unique|name|baseType,保留 detailsId / icon / sparkline', () => {
    const s = result.prices.get('unique|Sundance|Clasped Boots')!
    expect(s).toMatchObject({ chaos: 1, count: 97, lowConfidence: false, type: 'UniqueArmour', detailsId: 'sundance-clasped-boots' })
    expect(s.icon).toMatch(/^https:\/\/web\.poecdn\.com\/gen\/image\//)
    expect(s.sparkline).toEqual([0, -27, -26, -35, 0, 0, 0])
  })

  it('6L 自成一鍵;同鍵多列以 count 大者勝(同數保留先到的)', () => {
    // Sage's Robe 6L 三列:count 1(170982c)、1(55755c)、2(1041c) → 2 勝
    expect(result.prices.get(uniqueKey("Foulborn Dialla's Malefaction", "Sage's Robe", 6))).toMatchObject({ chaos: 1041, count: 2, lowConfidence: true })
    // 非 6L 兩列:count 7(20629c)、6(310.8c) → 7 勝
    expect(result.prices.get(uniqueKey("Foulborn Dialla's Malefaction", "Sage's Robe"))).toMatchObject({ chaos: 20629, count: 7, lowConfidence: false })
    // 5L 不自成一鍵:併入無連結鍵,count 50 的 9c 勝過 5L count 2 的 51.5c
    expect(result.prices.get(uniqueKey("Shavronne's Wrappings", "Occultist's Vestment"))).toMatchObject({ chaos: 9, count: 50 })
    expect(result.prices.get(uniqueKey("Shavronne's Wrappings", "Occultist's Vestment", 6))).toMatchObject({ chaos: 272.5, count: 10 })
  })

  it('寶石鍵歸到 ninja 級距,同級距以 count 大者勝', () => {
    // 5c(count 29, 200718c)與 4c(count 21, 6393c)都落在 1|0|c
    expect(result.prices.get(gemKey('Awakened Enlighten Support', 5, 0, true))).toMatchObject({ chaos: 200718, count: 29 })
    expect(gemKey('Awakened Enlighten Support', 5, 0, true)).toBe('gem|Awakened Enlighten Support|1|0|c')
    // 3/23c(count 47)、1/23c(count 1)、4/23c(count 1)同在 1|23|c
    expect(result.prices.get('gem|Invert the Rules Support|1|23|c')).toMatchObject({ chaos: 20.8, count: 47 })
  })

  it('低信心 = 0 < count < 5', () => {
    expect(result.prices.get('gem|Awakened Enlighten Support|1|20')).toMatchObject({ count: 2, lowConfidence: true })
    const five = [...result.prices.values()].filter(l => l.count === 5)
    expect(five.length).toBeGreaterThan(0)
    expect(five.every(l => !l.lowConfidence)).toBe(true)
    expect([...result.prices.values()].every(l => l.lowConfidence === (l.count > 0 && l.count < 5))).toBe(true)
  })

  it('exchange:currency| / card| 鍵,價 = primaryValue × factor;Chaos Orb 固定 1', () => {
    expect(result.prices.get('currency|Divine Orb')).toMatchObject({ chaos: 371.7, count: 0, lowConfidence: false, detailsId: 'divine-orb', type: 'Currency' })
    expect(result.prices.get('card|Arrogance of the Vaal')).toMatchObject({ chaos: 1.31, type: 'DivinationCard', detailsId: 'arrogance-of-the-vaal' })
    expect(result.prices.get('currency|Chaos Orb')).toMatchObject({ chaos: 1, count: 999 })
    expect(result.prices.get('currency|Divine Orb')!.icon).toMatch(/^https:\/\/web\.poecdn\.com\/gen\/image\//)
  })

  it('PoE1 Map overview 沒有 mapTier → 照 C++ 規則全數略過;傳奇地圖以 unique| 鍵收錄', () => {
    expect([...result.prices.keys()].some(k => k.startsWith('map|'))).toBe(false)
    expect(result.prices.get(uniqueKey('Replica Cortex', 'Map (Tier 16)'))).toMatchObject({ type: 'UniqueMap' })
  })

  it('快照:toSnapshot → JSON → parseSnapshot 往返', () => {
    const snap = toSnapshot(result)
    expect(snap.schema).toBe(1)
    expect(snap.prices['unique|Sundance|Clasped Boots']).toEqual({ c: 1, n: 97, lc: false, id: 'sundance-clasped-boots', t: 'UniqueArmour' })
    const back = parseSnapshot(JSON.stringify(snap), 'poe1', LEAGUE)
    expect(back).toEqual(snap)
  })

  it('查詢:UNIQUE 有/無 baseType、APT variant、GEM variant、ITEM,及 ninja 詳細頁網址', () => {
    const snap = toSnapshot(result)
    const sundance = lookupPrice(snap, { ns: 'UNIQUE', name: 'Sundance', baseType: 'Clasped Boots' })!
    expect(sundance.entry.c).toBe(1)
    expect(ninjaDetailsUrl('poe1', LEAGUE, sundance, { name: 'Sundance' }))
      .toBe('https://poe.ninja/poe1/economy/allflame/unique-armours/sundance-clasped-boots')
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: 'Sundance' })?.key).toBe('unique|Sundance|Clasped Boots')
    // 無頭驗證用的 fixture(poe1/test/fixtures/cmn-Hant/boots-unique-vestigial-02 = Sin Trek / Stealth Boots,dust 15175)
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: 'Sin Trek', baseType: 'Stealth Boots' })?.entry).toEqual({ c: 1, n: 217, lc: false, id: 'sin-trek-stealth-boots', t: 'UniqueArmour' })
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: 'Sundance', variant: 'Clasped Boots' })?.key).toBe('unique|Sundance|Clasped Boots')
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: 'Tabula Rasa', variant: 'Simple Robe, 6L' })?.entry.c).toBe(4)
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: "Shavronne's Wrappings", links: 6 })?.entry.c).toBe(272.5)
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: 'Sundance', baseType: 'Wrong Boots' })).toBeNull()
    expect(lookupPrice(snap, { ns: 'GEM', name: 'Awakened Enlighten Support', variant: '5c' })?.entry.c).toBe(200718)
    expect(lookupPrice(snap, { ns: 'ITEM', name: 'Divine Orb' })?.entry.c).toBe(371.7)
    expect(lookupPrice(snap, { ns: 'DIVINATION_CARD', name: 'Arrogance of the Vaal' })?.entry.c).toBe(1.31)
    expect(lookupPrice(snap, { ns: 'CAPTURED_BEAST', name: 'x' })).toBeNull()
  })
})

describe('解析規則(合成回應)', () => {
  it('null 欄位容忍:缺名稱/價格的列略過,其他列照收;PoE2 primaryValue × core.rates.chaos', () => {
    const doc = {
      core: { primary: 'divine', rates: { chaos: 10 } },
      lines: [
        { name: null, chaosValue: 5 },
        { name: 'A', chaosValue: null, primaryValue: 2, baseType: null, count: null, listingCount: 3, links: null, icon: null, detailsId: null },
        { name: 'B', chaosValue: null, primaryValue: null },
        null,
        { name: 'C', primaryValue: 0.5, baseType: 'Ring', count: 12 }
      ]
    }
    const { lines, chaosPerDivine } = parseItemOverview(doc, 'UniqueAccessories')
    expect(chaosPerDivine).toBe(10)
    expect(lines.map(l => [l.key, l.chaos, l.count, l.lowConfidence])).toEqual([
      ['unique|A|', 20, 3, true],
      ['unique|C|Ring', 5, 12, false]
    ])
  })

  it('chaosFactor:沒有 core = 1;primary chaos → divine 匯率 1/rates.divine;divine 缺 rates.chaos → 0', () => {
    expect(chaosFactor({ lines: [] })).toEqual({ factor: 1 })
    expect(chaosFactor({ core: { primary: 'chaos', rates: { divine: 0.005 } } })).toEqual({ factor: 1, chaosPerDivine: 200 })
    expect(chaosFactor({ core: { primary: 'divine', rates: {} } })).toEqual({ factor: 0 })
    expect(chaosFactor({ core: { primary: 'exalted', rates: { chaos: 3, divine: 0.1 } } })).toEqual({ factor: 3, chaosPerDivine: 30 })
    expect(() => parseExchangeOverview({ core: { primary: 'divine', rates: {} }, lines: [] }, 'Currency')).toThrow()
  })

  it('exchange id 可以是數字或字串', () => {
    const doc = { items: [{ id: 1, name: 'One' }, { id: 'two', name: 'Two' }], lines: [{ id: 1, primaryValue: 3 }, { id: 'two', primaryValue: 4 }, { id: 3, primaryValue: 5 }] }
    expect(parseExchangeOverview(doc, 'Currency').lines.map(l => [l.key, l.chaos])).toEqual([['currency|One', 3], ['currency|Two', 4]])
  })

  it('PoE1 缺 core 時用 Divine Orb 列當匯率,< 30c 不採信', async () => {
    const mk = (divine: number) => recordingHttp({
      exchange_Currency: { status: 200, body: JSON.stringify({ items: [{ id: 'd', name: 'Divine Orb' }], lines: [{ id: 'd', primaryValue: divine }] }) }
    })
    const cats = { exchange: ['Currency'], item: [] }
    const hi = await createNinjaClient({ http: mk(150).http, game: 'poe1', league: LEAGUE, sleep: async () => {} }).fetchAll(cats)
    expect(hi.divineRate).toBe(150)
    const lo = await createNinjaClient({ http: mk(20).http, game: 'poe1', league: LEAGUE, sleep: async () => {} }).fetchAll(cats)
    expect(lo.divineRate).toBeUndefined()
    const poe2 = await createNinjaClient({ http: mk(150).http, game: 'poe2', league: LEAGUE, sleep: async () => {} }).fetchAll(cats)
    expect(poe2.divineRate).toBeUndefined()
  })

  it('單一類別失敗只記錄;全部失敗才丟錯', async () => {
    const { http } = recordingHttp({ exchange_Oil: { status: 500, body: '' }, exchange_Fossil: { status: 200, body: 'not json' } })
    const r = await createNinjaClient({ http, game: 'poe1', league: LEAGUE, sleep: async () => {} }).fetchAll()
    expect(r.failedTypes.map(f => f.type)).toEqual(['Oil', 'Fossil'])
    expect(r.fetchedTypes).toHaveLength(18)
    const allFail: HttpFetch = async () => response(503, '')
    await expect(createNinjaClient({ http: allFail, game: 'poe1', league: LEAGUE, sleep: async () => {} }).fetchAll())
      .rejects.toThrow(/全部類別都失敗/)
  })

  it('AbortSignal:中止後不再送請求', async () => {
    const { http, urls } = recordingHttp()
    const ctrl = new AbortController()
    const client = createNinjaClient({
      http,
      game: 'poe1',
      league: LEAGUE,
      sleep: async () => { if (urls.length === 2) ctrl.abort(new Error('stop')) }
    })
    await expect(client.fetchAll(undefined, { signal: ctrl.signal })).rejects.toThrow('stop')
    expect(urls).toHaveLength(2)
  })
})

describe('快取與 TTL', () => {
  const snap: NinjaSnapshot = { schema: 1, game: 'poe1', league: 'Hardcore Allflame', fetchedAt: 1_000_000, divineRate: 300, prices: { 'currency|Divine Orb': { c: 300, n: 0, lc: false, t: 'Currency' } } }

  it('isFresh:15 分鐘內為新鮮', () => {
    expect(NINJA_CACHE_TTL_MS).toBe(15 * 60 * 1000)
    expect(isFresh(snap, undefined, 1_000_000)).toBe(true)
    expect(isFresh(snap, undefined, 1_000_000 + NINJA_CACHE_TTL_MS - 1)).toBe(true)
    expect(isFresh(snap, undefined, 1_000_000 + NINJA_CACHE_TTL_MS)).toBe(false)
    expect(isFresh(snap, undefined, 999_999)).toBe(false) // 時鐘倒退不當新鮮
    expect(isFresh(null)).toBe(false)
  })

  it('記憶體快取:依 game + league 分開;schema / game / league 不符一律 null', async () => {
    const cache = createMemoryNinjaCache()
    await cache.save('poe1', 'Hardcore Allflame', snap)
    expect(await cache.load('poe1', 'Hardcore Allflame')).toEqual(snap)
    expect(await cache.load('poe2', 'Hardcore Allflame')).toBeNull()
    expect(await cache.load('poe1', 'Allflame')).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...snap, schema: 2 }), 'poe1', 'Hardcore Allflame')).toBeNull()
    expect(parseSnapshot('{broken', 'poe1', 'Hardcore Allflame')).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...snap, prices: {} }), 'poe1', 'Hardcore Allflame')).toBeNull()
  })

  it('快取檔名只留安全字元;聯盟 slug 照 APT', () => {
    expect(ninjaCacheFileName('poe1', 'Hardcore Allflame')).toBe('poe1_Hardcore_Allflame.json')
    expect(ninjaCacheFileName('poe2', '')).toBe('poe2_league.json')
    expect(ninjaLeagueSlug('Allflame')).toBe('allflame')
    expect(ninjaLeagueSlug('Hardcore Allflame')).toBe('allflamehc')
    expect(ninjaLeagueSlug('Standard')).toBe('standard')
    expect(ninjaLeagueSlug('Hardcore')).toBe('hardcore')
  })
})
