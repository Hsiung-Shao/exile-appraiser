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
    expect(snap.schema).toBe(3)
    // WP-R2:PoE1 沒有 exalted 匯率
    expect(result.exaltedRate).toBeUndefined()
    expect(snap.exaltedRate).toBeNull()
    // 第 24 步(schema 3):item overview 也存走勢(sparkLine);沒有成交量
    expect(snap.prices['unique|Sundance|Clasped Boots']).toEqual({ c: 1, n: 97, lc: false, id: 'sundance-clasped-boots', t: 'UniqueArmour', s: [0, -27, -26, -35, 0, 0, 0], sc: 0 })
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
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: 'Sin Trek', baseType: 'Stealth Boots' })?.entry).toMatchObject({ c: 1, n: 217, lc: false, id: 'sin-trek-stealth-boots', t: 'UniqueArmour' })
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
    // WP-R2:primary 是 exalted → 1 ex = factor chaos
    expect(chaosFactor({ core: { primary: 'exalted', rates: { chaos: 3, divine: 0.1 } } })).toEqual({ factor: 3, chaosPerDivine: 30, chaosPerExalted: 3 })
    // WP-R2:primary divine + rates.exalted → 1 ex = rates.chaos / rates.exalted;primary chaos + rates.exalted → 1 / rates.exalted
    expect(chaosFactor({ core: { primary: 'divine', rates: { chaos: 10, exalted: 400 } } })).toEqual({ factor: 10, chaosPerDivine: 10, chaosPerExalted: 0.025 })
    expect(chaosFactor({ core: { primary: 'chaos', rates: { exalted: 4 } } })).toEqual({ factor: 1, chaosPerDivine: undefined, chaosPerExalted: 0.25 })
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
  const snap: NinjaSnapshot = { schema: 3, game: 'poe1', league: 'Hardcore Allflame', fetchedAt: 1_000_000, divineRate: 300, exaltedRate: null, prices: { 'currency|Divine Orb': { c: 300, n: 0, lc: false, t: 'Currency' } } }

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
    // WP-R2:schema 1(沒有 exaltedRate 的舊快取)、第 24 步之前的 schema 2(沒有走勢 / 成交量)與未來的 schema 4 一律丟棄
    expect(parseSnapshot(JSON.stringify({ ...snap, schema: 1 }), 'poe1', 'Hardcore Allflame')).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...snap, schema: 2 }), 'poe1', 'Hardcore Allflame')).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...snap, schema: 4 }), 'poe1', 'Hardcore Allflame')).toBeNull()
    // 使用者 userData 裡 WP-R2 之前寫的真實舊快取格式(schema 1、沒有 exaltedRate)
    const legacy = '{"schema":1,"game":"poe2","league":"Forbidden Rites","fetchedAt":1790668051310,"divineRate":8.18,"prices":{"currency|Exalted Orb":{"c":0.01590192,"n":0,"lc":false,"t":"Currency","id":"exalted-orb"}}}'
    expect(parseSnapshot(legacy, 'poe2', 'Forbidden Rites')).toBeNull()
    expect(await cache.load('poe1', 'Allflame')).toBeNull()
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

// ---- WP-R2:PoE2 exchange 真實回應(recordings/ninja/poe2/,2026-09-30 Forbidden Rites;格式說明見 docs/ninja-poe2.md) ----
describe('PoE2 exchange 錄製檔', () => {
  const DIR2 = path.join(DIR, 'poe2')
  const LEAGUE2 = 'Forbidden Rites'
  const TYPES2 = ['Runes', 'SoulCores', 'UncutGems', 'Currency']
  const read2 = (file: string) => fs.readFileSync(path.join(DIR2, file), 'utf8')
  const doc = (type: string) => JSON.parse(read2(`exchange_${type}.json`))
  /** 以錄製檔回應;沒錄的類別 404(只算 failedTypes) */
  const http2: HttpFetch = async (url) => {
    const u = new URL(url)
    expect(u.pathname).toBe('/poe2/api/economy/exchange/current/overview')
    expect(u.searchParams.get('league')).toBe(LEAGUE2)
    const file = `exchange_${u.searchParams.get('type')}.json`
    if (!fs.existsSync(path.join(DIR2, file))) return response(404, 'not found')
    return response(200, read2(file))
  }
  /** 七個類別同一次錄製,匯率相同:1 div = 610.9 ex = 9.61 c */
  const RATE_CHAOS = 9.61
  const RATE_EXALTED = 610.9
  /** WP-R2 §2:符文塑形面板實際出現的合金 / 熔劑 / 傳承輔助寶石 */
  const TYPES2_LATER = ['Verisium', 'Expedition', 'LineageSupportGems']

  it('_meta.json:七個類別各一個原樣回應', () => {
    const meta = JSON.parse(read2('_meta.json'))
    expect(meta.game).toBe('poe2')
    expect(meta.league).toBe(LEAGUE2)
    expect(Object.keys(meta.files).sort()).toEqual([...TYPES2, ...TYPES2_LATER].map(t => `exchange_${t}.json`).sort())
    for (const [file, info] of Object.entries<{ url: string, status: number, bytes: number }>(meta.files)) {
      expect(info.url).toMatch(/^https:\/\/poe\.ninja\/poe2\/api\/economy\/exchange\/current\/overview\?league=Forbidden%20Rites&type=/)
      expect(info.status).toBe(200)
      expect(Buffer.byteLength(read2(file))).toBe(info.bytes)
    }
  })

  it('回應格式:core 以 divine 計價、rates 有 exalted / chaos;lines 與 items 以字串 id 對接', () => {
    for (const type of [...TYPES2, ...TYPES2_LATER]) {
      const d = doc(type)
      const rates = { exalted: RATE_EXALTED, chaos: RATE_CHAOS }
      expect(Object.keys(d).sort()).toEqual(['core', 'items', 'lines'])
      expect(d.core).toMatchObject({ primary: 'divine', secondary: 'chaos', rates })
      expect(d.core.items.map((i: { id: string }) => i.id)).toEqual(['divine', 'exalted', 'chaos'])
      expect(d.lines.every((l: { id: unknown }) => typeof l.id === 'string')).toBe(true)
      const ids = new Set(d.items.map((i: { id: string }) => i.id))
      expect(d.lines.every((l: { id: string }) => ids.has(l.id))).toBe(true)
    }
  })

  it('chaosFactor:1 divine = 9.61c、1 exalted = 9.61 / 610.9 c', () => {
    const f = chaosFactor(doc('Runes'))
    expect(f.factor).toBe(RATE_CHAOS)
    expect(f.chaosPerDivine).toBe(RATE_CHAOS)
    expect(f.chaosPerExalted).toBeCloseTo(RATE_CHAOS / RATE_EXALTED, 12)
  })

  it('解析:每一列都收(價 = primaryValue × 9.61),鍵 currency|<英文名>', () => {
    for (const type of TYPES2) {
      const d = doc(type)
      const parsed = parseExchangeOverview(d, type)
      expect(parsed.lines).toHaveLength(d.lines.length)
      expect(parsed.chaosPerExalted).toBeCloseTo(RATE_CHAOS / RATE_EXALTED, 12)
      expect(parsed.lines.every(l => l.key.startsWith('currency|') && l.type === type && l.count === 0)).toBe(true)
    }
    const runes = parseExchangeOverview(doc('Runes'), 'Runes')
    expect(runes.lines.find(l => l.key === "currency|Aldur's Legacy")).toMatchObject({ chaos: 385.3 * RATE_CHAOS, detailsId: 'aldurs-legacy' })
    // 0.001637 divine ≈ 1 exalted(同 Currency 的 exalted 列;0.001637 × 610.9 = 1.0000433)
    expect(runes.lines.find(l => l.key === 'currency|Ancient Rune of Control')!.chaos / (RATE_CHAOS / RATE_EXALTED)).toBeCloseTo(1.0000433, 5)
    const cores = parseExchangeOverview(doc('SoulCores'), 'SoulCores')
    expect(cores.lines.find(l => l.key === "currency|Atziri's Soul Core of Alacrity")?.chaos).toBeCloseTo(0.3056 * RATE_CHAOS, 10)
  })

  it('WP-R2 §2:合金在 Verisium、奇術熔劑在 Expedition(名稱帶等級,錄製時有 13~20 級);符文技能寶石不在 LineageSupportGems', () => {
    const ver = parseExchangeOverview(doc('Verisium'), 'Verisium')
    expect(ver.lines.find(l => l.key === 'currency|Adaptive Alloy')).toMatchObject({ chaos: 0.08164 * RATE_CHAOS, detailsId: 'adaptive-alloy' })
    const exp = parseExchangeOverview(doc('Expedition'), 'Expedition')
    const flux = exp.lines.map(l => l.key).filter(k => k.startsWith('currency|Thaumaturgic Flux')).sort()
    expect(flux).toEqual([13, 14, 15, 16, 17, 18, 19, 20].map(n => `currency|Thaumaturgic Flux (Level ${n})`))
    const lineage = parseExchangeOverview(doc('LineageSupportGems'), 'LineageSupportGems').lines.map(l => l.key)
    for (const n of ['Conductive Runes', 'Concussive Runes', 'Repulsion', 'Frostflame Nova']) expect(lineage).not.toContain(`currency|${n}`)
  })

  it('未切割寶石:名稱帶等級 `Uncut Skill Gem (Level 20)`,每個等級一列', () => {
    const gems = parseExchangeOverview(doc('UncutGems'), 'UncutGems')
    const keys = gems.lines.map(l => l.key)
    expect(keys).toContain('currency|Uncut Skill Gem (Level 20)')
    expect(keys).toContain('currency|Uncut Spirit Gem (Level 20)')
    expect(keys).toContain('currency|Uncut Support Gem (Level 5)')
    expect(keys.every(k => /^currency\|Uncut (Skill|Spirit|Support) Gem \(Level \d+\)$/.test(k))).toBe(true)
    expect(gems.lines.find(l => l.key === 'currency|Uncut Skill Gem (Level 20)')).toMatchObject({ chaos: 6.27 * RATE_CHAOS, detailsId: 'uncut-skill-gem-level-20' })
  })

  it('fetchAll:divineRate / exaltedRate 取 core;Exalted Orb 列與匯率一致;快照 schema 3 往返', async () => {
    const client = createNinjaClient({ http: http2, game: 'poe2', league: LEAGUE2, sleep: async () => {}, now: () => 5 })
    const r = await client.fetchAll({ exchange: TYPES2, item: [] })
    expect(r.fetchedTypes).toEqual(TYPES2)
    expect(r.divineRate).toBe(RATE_CHAOS)
    expect(r.exaltedRate).toBeCloseTo(RATE_CHAOS / RATE_EXALTED, 12)
    // Currency 的 Exalted Orb 列 = 0.001637 divine;與 core 匯率差 < 0.1%
    expect(r.prices.get('currency|Exalted Orb')!.chaos / r.exaltedRate!).toBeCloseTo(1, 3)
    expect(r.prices.get('currency|Chaos Orb')).toMatchObject({ chaos: 1 })
    const snap = toSnapshot(r)
    expect(snap).toMatchObject({ schema: 3, game: 'poe2', league: LEAGUE2, divineRate: RATE_CHAOS })
    expect(snap.exaltedRate).toBeCloseTo(RATE_CHAOS / RATE_EXALTED, 12)
    expect(parseSnapshot(JSON.stringify(snap), 'poe2', LEAGUE2)).toEqual(snap)
    expect(lookupPrice(snap, { ns: 'ITEM', name: "Aldur's Legacy" })?.entry.c).toBeCloseTo(385.3 * RATE_CHAOS, 10)
  })

  it('exaltedRate 後援:core 沒有 rates.exalted 時用 Exalted Orb 列(只限 PoE2)', async () => {
    const body = JSON.stringify({
      core: { primary: 'divine', rates: { chaos: 10 } },
      items: [{ id: 'exalted', name: 'Exalted Orb' }],
      lines: [{ id: 'exalted', primaryValue: 0.002 }]
    })
    const http: HttpFetch = async () => response(200, body)
    const cats = { exchange: ['Currency'], item: [] }
    const poe2 = await createNinjaClient({ http, game: 'poe2', league: 'X', sleep: async () => {} }).fetchAll(cats)
    expect(poe2.exaltedRate).toBeCloseTo(0.02, 12)
    const poe1 = await createNinjaClient({ http, game: 'poe1', league: 'X', sleep: async () => {} }).fetchAll(cats)
    expect(poe1.exaltedRate).toBeUndefined()
  })
})

// ---- 第 24 步:查價面板「通貨價格區」—— 走勢、每小時成交量、成交量最大的對手通貨(快照 schema 3) ----
describe('走勢與成交量(第 24 步)', () => {
  const RATE_CHAOS2 = 9.61
  const read2 = (file: string) => fs.readFileSync(path.join(DIR, 'poe2', file), 'utf8')

  it('PoE1 exchange:volumePrimaryValue(primary = chaos)原值即 chaos、maxVolume*、走勢與 totalChange', () => {
    const cards = parseExchangeOverview(JSON.parse(read('exchange_DivinationCard.json')), 'DivinationCard')
    expect(cards.lines.find(l => l.key === 'card|Arrogance of the Vaal')).toMatchObject({
      chaos: 1.31, volumeChaos: 2.83, maxVolumeCurrency: 'chaos', maxVolumeRate: 0.7647,
      sparkline: [-9.95, 7.51, -71.47, -78.85, -61.91, -1.24, -81.69], sparklineChange: -81.69
    })
    const cur = parseExchangeOverview(JSON.parse(read('exchange_Currency.json')), 'Currency')
    expect(cur.lines.find(l => l.key === 'currency|Divine Orb')).toMatchObject({
      chaos: 371.7, volumeChaos: 1450816, maxVolumeCurrency: 'chaos', sparklineChange: 1.02
    })
    // 錄製檔每一列都有成交量與走勢
    expect(cur.lines.every(l => l.volumeChaos !== undefined && l.sparkline?.length === 7 && l.maxVolumeCurrency)).toBe(true)
  })

  it('PoE2 exchange:volumePrimaryValue(primary = divine)× rates.chaos', () => {
    const runes = parseExchangeOverview(JSON.parse(read2('exchange_Runes.json')), 'Runes')
    const aldur = runes.lines.find(l => l.key === "currency|Aldur's Legacy")!
    expect(aldur.volumeChaos).toBeCloseTo(13228 * RATE_CHAOS2, 8)
    expect(aldur).toMatchObject({ maxVolumeCurrency: 'divine', maxVolumeRate: 0.002596, sparklineChange: 15.12 })
    expect(aldur.sparkline).toEqual([17.25, 19.04, 19, 18.89, 17.68, 14.87, 15.12])
  })

  it('item overview:sparkLine 與 totalChange 保留、沒有成交量欄位', () => {
    const armour = parseItemOverview(JSON.parse(read('item_UniqueArmour.json')), 'UniqueArmour')
    const sundance = armour.lines.find(l => l.key === 'unique|Sundance|Clasped Boots')!
    expect(sundance).toMatchObject({ sparkline: [0, -27, -26, -35, 0, 0, 0], sparklineChange: 0 })
    expect(sundance.volumeChaos).toBeUndefined()
    expect(sundance.maxVolumeCurrency).toBeUndefined()
  })

  it('容忍缺欄位 / 非數值:沒有就不帶,null 點保留為 null', () => {
    const parsed = parseExchangeOverview({
      core: { primary: 'chaos', rates: { divine: 0.005 } },
      items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      lines: [
        { id: 'a', primaryValue: 2, sparkline: { totalChange: 'x', data: [1, null, 'y', 3] }, volumePrimaryValue: null, maxVolumeCurrency: 5 },
        { id: 'b', primaryValue: 3, volumePrimaryValue: 0 }
      ]
    }, 'Currency')
    const a = parsed.lines.find(l => l.key === 'currency|A')!
    expect(a.sparkline).toEqual([1, null, null, 3])
    expect(a.sparklineChange).toBeUndefined()
    expect(a.volumeChaos).toBeUndefined()
    expect(a.maxVolumeCurrency).toBeUndefined()
    const b = parsed.lines.find(l => l.key === 'currency|B')!
    expect(b).toMatchObject({ volumeChaos: 0 })
    // 快照:全 null 的走勢不存;volume 0 照存
    const snap = toSnapshot({
      game: 'poe1', league: 'X', fetchedAt: 1, divineRate: 200,
      prices: new Map([['currency|A', { ...a, sparkline: [null, null] }], ['currency|B', b]]),
      fetchedTypes: ['Currency'], failedTypes: []
    })
    expect(snap.prices['currency|A']).toEqual({ c: 2, n: 0, lc: false, t: 'Currency' })
    expect(snap.prices['currency|B']).toEqual({ c: 3, n: 0, lc: false, t: 'Currency', v: 0 })
  })

  it('PoE2 fetchAll → toSnapshot → JSON → parseSnapshot:s / sc / v / mv 往返,v 只留 3 位小數', async () => {
    const http: HttpFetch = async (url) => {
      const file = 'exchange_' + new URL(url).searchParams.get('type') + '.json'
      if (!fs.existsSync(path.join(DIR, 'poe2', file))) return response(404, 'not found')
      return response(200, read2(file))
    }
    const r = await createNinjaClient({ http, game: 'poe2', league: 'Forbidden Rites', sleep: async () => {}, now: () => 7 })
      .fetchAll({ exchange: ['Runes', 'Currency'], item: [] })
    const snap = toSnapshot(r)
    expect(snap.schema).toBe(3)
    expect(snap.prices["currency|Aldur's Legacy"]).toEqual({
      c: 385.3 * RATE_CHAOS2, n: 0, lc: false, id: 'aldurs-legacy', t: 'Runes',
      s: [17.25, 19.04, 19, 18.89, 17.68, 14.87, 15.12], sc: 15.12, v: Math.round(13228 * RATE_CHAOS2 * 1000) / 1000, mv: 'divine'
    })
    // 合成的 Chaos Orb 列沒有走勢 / 成交量
    expect(snap.prices['currency|Chaos Orb']).toEqual({ c: 1, n: 999, lc: false, t: 'Currency', id: 'chaos-orb' })
    const back = parseSnapshot(JSON.stringify(snap), 'poe2', 'Forbidden Rites')
    expect(back).toEqual(snap)
    expect(lookupPrice(back, { ns: 'ITEM', name: 'Divine Orb' })?.entry).toMatchObject({ c: RATE_CHAOS2, mv: 'chaos', sc: 23.46 })
  })
})

describe('lookupPrice:同名傳奇第一筆索引與原線性掃描逐鍵相同', () => {
  /** 原實作(線性掃描 + find,判斷式照搬),當 oracle */
  function legacyFirst (prices: Record<string, unknown>, name: string, links: number): string | undefined {
    const prefix = `unique|${name}|`
    return Object.keys(prices).find(k => k.startsWith(prefix) && (k.endsWith('|6L') === (links >= 6)))
  }

  it('錄製快照:每個傳奇名 × 連結數 0/5/6,結果與原線性掃描相同', async () => {
    const { http } = recordingHttp()
    const { sleep } = noSleep()
    const result = await createNinjaClient({ http, game: 'poe1', league: LEAGUE, sleep, now: () => 1_000_000 }).fetchAll()
    const snap = toSnapshot(result)
    const names = new Set<string>(['', 'No Such Unique', 'Sundance|Clasped'])
    for (const k of Object.keys(snap.prices)) if (k.startsWith('unique|')) names.add(k.split('|')[1])
    expect(names.size).toBeGreaterThan(20)
    for (const name of names) {
      for (const links of [0, 5, 6]) {
        const want = legacyFirst(snap.prices, name, links)
        const got = lookupPrice(snap, { ns: 'UNIQUE', name, links })
        // 無 baseType 且 variant 空:candidateKeys 只剩「同名第一筆」一個候選
        expect(got?.key).toBe(want && snap.prices[want] ? want : undefined)
      }
    }
  })

  it('合成快照:名稱含 | / 6L 排在前面 / 同名多基底,第一筆照 Object.keys 順序', () => {
    const e = { c: 1, n: 10, lc: false, t: 'UniqueArmour' }
    const prices: Record<string, typeof e> = {}
    for (const k of [
      'currency|Divine Orb',
      'unique|Foo|Zeta Base|6L', // 6L 先出現
      'unique|Foo|Zeta Base',
      'unique|Foo|Alpha Base',
      'unique|Foo|Alpha Base|6L',
      'unique|Foo|Bar|Baz', // 名稱 `Foo|Bar` 的基底 Baz;同時是名稱 `Foo` 的另一筆基底「Bar|Baz」
      'unique|Foo|Bar|Baz|6L',
      'unique|Foo2|Base',
      'unique|Foo|',
      'unique||Empty'
    ]) prices[k] = e
    const snap = { prices }
    for (const name of ['Foo', 'Foo|Bar', 'Foo2', 'Fo', 'Foo|', '', 'Zeta Base']) {
      for (const links of [0, 6]) {
        const want = legacyFirst(prices, name, links)
        expect(lookupPrice(snap, { ns: 'UNIQUE', name, links })?.key).toBe(want)
      }
    }
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: 'Foo', links: 6 })?.key).toBe('unique|Foo|Zeta Base|6L')
    expect(lookupPrice(snap, { ns: 'UNIQUE', name: 'Foo', links: 0 })?.key).toBe('unique|Foo|Zeta Base')
  })
})
