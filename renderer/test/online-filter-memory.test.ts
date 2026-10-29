// 查價掛單卡「線上」選單自動記住(2026-10-29 使用者要求):純函式、設定往返與接線守門(M1–M7、M11)。
// 掛載行為(M8–M10)在 renderer/test-vue/online-filter-memory-mount.test.ts。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest, defaultPriceCheck } from '../src/web/Config'
import {
  applyPoe1Memory,
  applyPoe2Memory,
  defaultOnlineFilterMemory,
  normOnlineFilterMemory,
  rememberPoe1,
  rememberPoe2,
  type OnlineFilterMemory
} from '../src/web/price-panel/online-filter-memory'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 各代「沒記過」時 createFilters 給的 trade 預設 */
const poe1Trade = () => ({ offline: false, listed: null as string | null })
const poe2Trade = () => ({ listingType: 'securable', listed: undefined as string | undefined, currency: undefined as string | undefined })
const poe1Widget = () => ({ onlineFilterMemory: defaultOnlineFilterMemory(), merchantOnly: true, defaultCurrency: null as string | null })
const poe2Widget = () => ({ onlineFilterMemory: defaultOnlineFilterMemory() })

describe('M1 沒記過', () => {
  it('沒記過時 PoE1 與 PoE2 查詢條件與改版前相同', () => {
    const mem = defaultOnlineFilterMemory()
    expect(mem).toEqual({ poe1: {}, poe2: {} })
    const t1 = poe1Trade()
    applyPoe1Memory(t1, mem)
    expect(t1).toEqual({ offline: false, listed: null })
    for (const api of ['trade', 'bulk'] as const) {
      const t2 = poe2Trade()
      applyPoe2Memory(t2, api, mem)
      expect(t2).toEqual({ listingType: 'securable', listed: undefined, currency: undefined })
    }
  })
  it('預設記憶每次都是新物件(改一份不影響下一份)', () => {
    const a = defaultOnlineFilterMemory()
    a.poe1.offline = true
    expect(defaultOnlineFilterMemory().poe1).toEqual({})
  })
})

describe('M2 PoE1 套用', () => {
  it('PoE1 記住的離線與上架時間套到新查詢', () => {
    const mem: OnlineFilterMemory = { poe1: { offline: true, listed: '1week' }, poe2: {} }
    const t = poe1Trade()
    applyPoe1Memory(t, mem)
    expect(t.offline).toBe(true)
    expect(t.listed).toBe('1week')
  })
  it('只記過一欄時另一欄保持查詢原值', () => {
    const t = { offline: false, listed: '3days' as string | null }
    applyPoe1Memory(t, { poe1: { offline: true }, poe2: {} })
    expect(t).toEqual({ offline: true, listed: '3days' })
    const t2 = { offline: true, listed: null as string | null }
    applyPoe1Memory(t2, { poe1: { listed: '1day' }, poe2: {} })
    expect(t2).toEqual({ offline: true, listed: '1day' })
  })
  it('記成「任何時間」(null)會蓋掉原值,不當成沒記過', () => {
    const t = { offline: false, listed: '3days' as string | null }
    applyPoe1Memory(t, { poe1: { listed: null }, poe2: {} })
    expect(t.listed).toBeNull()
  })
  it('PoE2 的記憶不會影響 PoE1 查詢', () => {
    const t = poe1Trade()
    applyPoe1Memory(t, { poe1: {}, poe2: { listed: '1week', tradeListing: 'any' } })
    expect(t).toEqual({ offline: false, listed: null })
  })
})

describe('M3 PoE1 寫入', () => {
  it('PoE1 選單改值寫進設定,沒出現在 patch 的欄位不動', () => {
    const w = poe1Widget()
    rememberPoe1(w, { offline: true })
    expect(w.onlineFilterMemory.poe1).toEqual({ offline: true })
    expect(w.merchantOnly).toBe(true)
    expect(w.defaultCurrency).toBeNull()

    rememberPoe1(w, { listed: '1week' })
    expect(w.onlineFilterMemory.poe1).toEqual({ offline: true, listed: '1week' })

    rememberPoe1(w, { merchantOnly: false })
    expect(w.merchantOnly).toBe(false)
    expect(w.onlineFilterMemory.poe1).toEqual({ offline: true, listed: '1week' })

    rememberPoe1(w, { currency: 'divine' })
    expect(w.defaultCurrency).toBe('divine')
    expect(w.merchantOnly).toBe(false)
    expect(w.onlineFilterMemory.poe1).toEqual({ offline: true, listed: '1week' })
    expect(w.onlineFilterMemory.poe2).toEqual({})
  })
  it('patch 帶 null 代表選了「任何」,要存 null 而不是略過', () => {
    const w = poe1Widget()
    rememberPoe1(w, { listed: '1week', currency: 'chaos' })
    rememberPoe1(w, { listed: null, currency: null })
    expect(w.onlineFilterMemory.poe1.listed).toBeNull()
    expect(w.defaultCurrency).toBeNull()
  })
  it('一次寫多欄', () => {
    const w = poe1Widget()
    rememberPoe1(w, { offline: true, listed: '2months' })
    expect(w.onlineFilterMemory.poe1).toEqual({ offline: true, listed: '2months' })
  })
  it('寫入後套到新查詢得到同樣的值', () => {
    const w = poe1Widget()
    rememberPoe1(w, { offline: true, listed: '2weeks' })
    const t = poe1Trade()
    applyPoe1Memory(t, w.onlineFilterMemory)
    expect(t).toEqual({ offline: true, listed: '2weeks' })
  })
})

describe('M4 PoE2 一般與大宗分開記', () => {
  it('PoE2 一般與大宗的掛單類型分開記', () => {
    const w = poe2Widget()
    rememberPoe2(w, 'trade', { listingType: 'online' })
    rememberPoe2(w, 'bulk', { listingType: 'any' })
    expect(w.onlineFilterMemory.poe2.tradeListing).toBe('online')
    expect(w.onlineFilterMemory.poe2.bulkListing).toBe('any')

    const tradeQ = poe2Trade()
    applyPoe2Memory(tradeQ, 'trade', w.onlineFilterMemory)
    expect(tradeQ.listingType).toBe('online')
    const bulkQ = { listingType: 'online', listed: undefined, currency: undefined }
    applyPoe2Memory(bulkQ, 'bulk', w.onlineFilterMemory)
    expect(bulkQ.listingType).toBe('any')
  })
  it('只記大宗時一般查詢維持 securable,只記一般時大宗查詢不動', () => {
    const w = poe2Widget()
    rememberPoe2(w, 'bulk', { listingType: 'onlineleague' })
    const tradeQ = poe2Trade()
    applyPoe2Memory(tradeQ, 'trade', w.onlineFilterMemory)
    expect(tradeQ.listingType).toBe('securable')

    const w2 = poe2Widget()
    rememberPoe2(w2, 'trade', { listingType: 'available' })
    const bulkQ = { listingType: 'online', listed: undefined, currency: undefined }
    applyPoe2Memory(bulkQ, 'bulk', w2.onlineFilterMemory)
    expect(bulkQ.listingType).toBe('online')
  })
  it('上架時間與通貨不分一般 / 大宗,兩種 api 都套', () => {
    const w = poe2Widget()
    rememberPoe2(w, 'trade', { listed: '1week', currency: 'divine' })
    for (const api of ['trade', 'bulk'] as const) {
      const q = poe2Trade()
      applyPoe2Memory(q, api, w.onlineFilterMemory)
      expect(q.listed).toBe('1week')
      expect(q.currency).toBe('divine')
    }
  })
})

describe('M5 PoE2 任何時間 / 任何通貨', () => {
  it('PoE2 任何時間與任何通貨存 null,套用回 undefined', () => {
    const w = poe2Widget()
    rememberPoe2(w, 'trade', { listed: '1week', currency: 'divine' })
    expect(w.onlineFilterMemory.poe2).toMatchObject({ listed: '1week', currency: 'divine' })

    rememberPoe2(w, 'trade', { listed: undefined, currency: undefined })
    expect(w.onlineFilterMemory.poe2.listed).toBeNull()
    expect(w.onlineFilterMemory.poe2.currency).toBeNull()

    const q = { listingType: 'securable', listed: '3days' as string | undefined, currency: 'chaos' as string | undefined }
    applyPoe2Memory(q, 'trade', w.onlineFilterMemory)
    expect(q.listed).toBeUndefined()
    expect(q.currency).toBeUndefined()
  })
  it('patch 沒帶 listed / currency 時不動已記的值', () => {
    const w = poe2Widget()
    rememberPoe2(w, 'trade', { listed: '1week', currency: 'divine' })
    rememberPoe2(w, 'trade', { listingType: 'any' })
    expect(w.onlineFilterMemory.poe2).toMatchObject({ tradeListing: 'any', listed: '1week', currency: 'divine' })
  })
  it('沒記過上架時間時保留查詢原值,不被清成 undefined', () => {
    const q = { listingType: 'securable', listed: '3days' as string | undefined, currency: 'chaos' as string | undefined }
    applyPoe2Memory(q, 'trade', { poe1: {}, poe2: { tradeListing: 'online' } })
    expect(q).toEqual({ listingType: 'online', listed: '3days', currency: 'chaos' })
  })
})

describe('M6 壞值逐欄丟棄', () => {
  it('壞值逐欄丟棄,同物件的好欄位保留', () => {
    const out = normOnlineFilterMemory({
      poe1: { listed: 'xx', offline: 'yes' },
      poe2: { tradeListing: 'onlineleague', bulkListing: 'securable', currency: 'mirror', listed: '1day' }
    })
    expect(out.poe1).not.toHaveProperty('listed')
    expect(out.poe1).not.toHaveProperty('offline')
    expect(out.poe2).not.toHaveProperty('tradeListing')
    expect(out.poe2).not.toHaveProperty('bulkListing')
    expect(out.poe2).not.toHaveProperty('currency')
    expect(out.poe2.listed).toBe('1day')
  })
  it('好值原樣保留(含 null 與 false)', () => {
    const good = {
      poe1: { offline: false, listed: null },
      poe2: { tradeListing: 'any', bulkListing: 'onlineleague', listed: null, currency: 'exalted_divine' }
    }
    expect(normOnlineFilterMemory(good)).toEqual(good)
  })
  it('所有合法列舉值都通過', () => {
    for (const listed of ['1day', '3days', '1week', '2weeks', '1month', '2months']) {
      expect(normOnlineFilterMemory({ poe1: { listed }, poe2: { listed } })).toEqual({ poe1: { listed }, poe2: { listed } })
    }
    for (const tradeListing of ['available', 'securable', 'online', 'any']) {
      expect(normOnlineFilterMemory({ poe2: { tradeListing } }).poe2.tradeListing).toBe(tradeListing)
    }
    for (const bulkListing of ['onlineleague', 'online', 'any']) {
      expect(normOnlineFilterMemory({ poe2: { bulkListing } }).poe2.bulkListing).toBe(bulkListing)
    }
    for (const currency of ['exalted', 'chaos', 'divine', 'exalted_divine']) {
      expect(normOnlineFilterMemory({ poe2: { currency } }).poe2.currency).toBe(currency)
    }
  })
  it('大宗專用值不能出現在一般欄位,一般專用值不能出現在大宗欄位', () => {
    expect(normOnlineFilterMemory({ poe2: { tradeListing: 'onlineleague' } }).poe2).toEqual({})
    expect(normOnlineFilterMemory({ poe2: { bulkListing: 'securable' } }).poe2).toEqual({})
    expect(normOnlineFilterMemory({ poe2: { bulkListing: 'available' } }).poe2).toEqual({})
  })
  it('非物件輸入回預設', () => {
    for (const v of [undefined, null, 'x', 3, true, []]) expect(normOnlineFilterMemory(v)).toEqual({ poe1: {}, poe2: {} })
  })
  it('某一代不是物件時只有那一代回空', () => {
    expect(normOnlineFilterMemory({ poe1: 5, poe2: { listed: '1day' } })).toEqual({ poe1: {}, poe2: { listed: '1day' } })
    expect(normOnlineFilterMemory({ poe1: { offline: true }, poe2: 'x' })).toEqual({ poe1: { offline: true }, poe2: {} })
  })
})

describe('M7 設定檔往返', () => {
  it('有值的記憶往返後相同', () => {
    const mem = {
      poe1: { offline: true, listed: '1week' },
      poe2: { tradeListing: 'online', bulkListing: 'any', listed: null, currency: 'divine' }
    }
    const { config, serialized } = _roundTripForTest(JSON.stringify({ priceCheck: { onlineFilterMemory: mem } }))
    expect((config.priceCheck as any).onlineFilterMemory).toEqual(mem)
    expect(JSON.parse(serialized).priceCheck.onlineFilterMemory).toEqual(mem)
  })
  it('舊設定檔沒有這個鍵時得到空記憶並寫進檔', () => {
    expect((defaultPriceCheck() as any).onlineFilterMemory).toEqual({ poe1: {}, poe2: {} })
    for (const raw of [null, '{"game":"poe1"}', '{"priceCheck":{"showSeller":"ign"}}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect((config.priceCheck as any).onlineFilterMemory).toEqual({ poe1: {}, poe2: {} })
      expect(JSON.parse(serialized).priceCheck.onlineFilterMemory).toEqual({ poe1: {}, poe2: {} })
    }
  })
  it('載入時壞值被濾掉', () => {
    const raw = JSON.stringify({ priceCheck: { onlineFilterMemory: { poe1: { listed: 'xx', offline: true }, poe2: { currency: 'mirror' } } } })
    expect((_roundTripForTest(raw).config.priceCheck as any).onlineFilterMemory).toEqual({ poe1: { offline: true }, poe2: {} })
    expect((_roundTripForTest('{"priceCheck":{"onlineFilterMemory":"bad"}}').config.priceCheck as any).onlineFilterMemory).toEqual({ poe1: {}, poe2: {} })
  })
  it('預設設定的記憶物件不共用', () => {
    const a = defaultPriceCheck() as any
    expect(a.onlineFilterMemory).toEqual({ poe1: {}, poe2: {} })
    expect(a.onlineFilterMemory).toEqual({ poe1: {}, poe2: {} })
    a.onlineFilterMemory.poe1.offline = true
    expect((defaultPriceCheck() as any).onlineFilterMemory.poe1).toEqual({})
  })
  it('PoE1 的僅限商人與通貨沿用既有欄位往返', () => {
    const { config } = _roundTripForTest('{"priceCheck":{"merchantOnly":false,"defaultCurrency":"divine"}}')
    expect(config.priceCheck.merchantOnly).toBe(false)
    expect(config.priceCheck.defaultCurrency).toBe('divine')
  })
})

describe('M11 接線守門', () => {
  // 聯盟(filters.league)與大宗專用的「聯盟在線」(onlineInLeague)不在記憶範圍,仍可 v-model
  const RAW_MODEL = /v-model(?::\w+)?(?:\.\w+)*\s*=\s*"filters(?:\.trade)?\.(offline|listed|merchantOnly|currency|listingType)"/g
  // 匯入可能折行:`import { a, rememberPoe1 } from '…/online-filter-memory'`
  const importOf = (name: string) => new RegExp(String.raw`import\s*\{[^}]*\b${name}\b[^}]*\}\s*from\s*['"][^'"]*online-filter-memory['"]`)
  const rawModels = (src: string) => [...src.matchAll(RAW_MODEL)].map(m => m[0])

  it('PoE1 選單的離線 / 上架時間 / 僅限商人 / 通貨不再用裸 v-model', () => {
    const src = read('poe1/src/web/price-check/trade/OnlineFilterCore.vue')
    expect(rawModels(src)).toEqual([])
    expect(src).toMatch(/v-model="filters\.league"/) // 聯盟仍是 v-model,守門 regex 沒有過寬
  })
  it('PoE2 選單的掛單類型 / 上架時間 / 通貨不再用裸 v-model', () => {
    const src = read('poe2/src/web/price-check/trade/OnlineFilter.vue')
    expect(rawModels(src)).toEqual([])
    expect(src).toMatch(/v-model="filters\.trade\.league"/)
  })
  it('守門 regex 能抓到裸 v-model(自檢)', () => {
    expect(rawModels('<UiRadio v-model="filters.listed" value="1day" />')).toHaveLength(1)
    expect(rawModels('<ui-radio v-model="filters.trade.currency" value="chaos" />')).toHaveLength(1)
    expect(rawModels('<ui-radio v-model="filters.trade.league" :value="l" />')).toHaveLength(0)
  })
  it('PoE1 選單與大宗匯入並呼叫 rememberPoe1', () => {
    for (const f of ['poe1/src/web/price-check/trade/OnlineFilterCore.vue', 'poe1/src/web/price-check/trade/TradeBulk.vue']) {
      const src = read(f)
      expect(src, f).toMatch(importOf('rememberPoe1'))
      expect(src, f).toMatch(/\brememberPoe1\(/)
    }
  })
  it('PoE2 選單與大宗匯入並呼叫 rememberPoe2', () => {
    for (const f of ['poe2/src/web/price-check/trade/OnlineFilter.vue', 'poe2/src/web/price-check/trade/TradeBulk.vue']) {
      const src = read(f)
      expect(src, f).toMatch(importOf('rememberPoe2'))
      expect(src, f).toMatch(/\brememberPoe2\(/)
    }
  })
  it('兩代 CheckedItem 在建立 preset 後套用記憶', () => {
    const p1 = read('poe1/src/web/price-check/CheckedItem.vue')
    expect(p1).toMatch(importOf('applyPoe1Memory'))
    expect(p1).toMatch(/\bapplyPoe1Memory\(/)
    const p2 = read('poe2/src/web/price-check/CheckedItem.vue')
    expect(p2).toMatch(importOf('applyPoe2Memory'))
    expect(p2).toMatch(/\bapplyPoe2Memory\(/)
  })
  it('PoE2「只看崇高 + 神聖」一次性按鈕不呼叫寫入記憶', () => {
    const src = read('poe2/src/web/price-check/trade/TradeListing.vue')
    const m = /execFilterExaltDivine:\s*\(\)\s*=>\s*\{([^}]*)\}/.exec(src)
    expect(m, '找得到 execFilterExaltDivine').toBeTruthy()
    expect(m![1]).toContain('currency')
    expect(m![1]).not.toMatch(/remember/)
  })
})
