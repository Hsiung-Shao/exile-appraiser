/**
 * 查價掛單卡「線上」選單自動記住(2026-10-29 使用者要求)的掛載測試(M8–M10、M13–M15)。
 * 純函式與設定往返在 renderer/test/online-filter-memory.test.ts。
 * 交易站回應:PoE1 / 兩代 exchange 本檔包一層假回應,不連網(同 listing-layout-mount.test.ts)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive, ref, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig, AppConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import { defaultOnlineFilterMemory, type OnlineFilterMemory } from '../src/web/price-panel/online-filter-memory'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter, createPresets as poe1CreatePresets } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import { setTradeContextProvider as poe1SetCtx, resetTradeSessions as poe1Reset } from '../../poe1/src/web/price-check/trade/common'
import Poe1OnlineFilterCore from '../../poe1/src/web/price-check/trade/OnlineFilterCore.vue'
import Poe1CheckedItem from '../../poe1/src/web/price-check/CheckedItem.vue'
import Poe1Bulk from '../../poe1/src/web/price-check/trade/TradeBulk.vue'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import { resetTradeSessions as poe2Reset } from '../../poe2/src/web/price-check/trade/common'
import Poe2Listing from '../../poe2/src/web/price-check/trade/TradeListing.vue'
import Poe2Bulk from '../../poe2/src/web/price-check/trade/TradeBulk.vue'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const fx = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

function i18nPlugin (game: 'poe1' | 'poe2') {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/${game}/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const OPTS = {
  league: 'Forbidden Rites', realm: 'intl' as const, clientLanguage: 'en' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const account = (i: number) => ({ name: `seller${i}`, lastCharacterName: `Seller${i}`, online: i % 2 ? {} : null })
const exchange = (currencies: string[]) => ({
  id: 'XCHG',
  total: currencies.length * 3,
  result: Object.fromEntries(currencies.flatMap((cur, c) => [1, 2, 3].map(i => [`${cur}${i}`, {
    id: `${cur}${i}`,
    listing: {
      indexed: new Date().toISOString(),
      account: account(i),
      offers: [{ exchange: { currency: cur, amount: (c + 1) * i }, item: { amount: 1, stock: 10 * i } }]
    }
  }])))
})

let realFetch: typeof fetch
beforeAll(async () => {
  await initConfig()
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  await Poe2.poe2Adapter.loadData(poe2DataSource(path.join(ROOT, 'data/poe2')), 'en')
  const ctx = () => ({ http: Host.httpFetch, realm: 'intl' as const, latencySeconds: 0, accountName: undefined })
  poe1SetCtx(ctx)
  Poe2.setTradeContextProvider(ctx)
  Poe2.setHostOptionsProvider(() => ({ uiLanguage: 'cmn-Hant' as const, itemHoverTooltip: 'off' as const }))
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (/\/api\/trade2?\/exchange\//.test(url)) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return json(exchange(body.query.have))
    }
    if (/\/api\/trade\/search\//.test(url)) return json({ id: 'P1Q', result: ['p1-0'], total: 1 })
    if (/\/api\/trade\/fetch\//.test(url)) {
      return json({ result: [{ id: 'p1-0', item: { ilvl: 80 }, listing: { indexed: new Date().toISOString(), price: { amount: 1, currency: 'chaos', type: '~price' }, account: account(0) } }] })
    }
    return realFetch(input, init)
  }) as typeof fetch
}, 300_000)

/** priceCheck 設定;`onlineFilterMemory` 由實作補進 Config,這裡用寬型別讀寫 */
const cfg = () => AppConfig().priceCheck as unknown as {
  onlineFilterMemory?: OnlineFilterMemory
  merchantOnly: boolean
  defaultCurrency: string | null
}
/** 讀記憶用 `?.`:實作前拿到 undefined 會是斷言失敗(預期值 vs undefined),不是 TypeError */
const mem = () => cfg().onlineFilterMemory

beforeEach(() => {
  cfg().onlineFilterMemory = defaultOnlineFilterMemory()
  cfg().merchantOnly = true
  cfg().defaultCurrency = null
})
afterEach(() => {
  poe1Reset()
  poe2Reset()
})

const settle = async (ms = 50) => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise(resolve => setTimeout(resolve, ms))
  for (let i = 0; i < 5; i++) await nextTick()
}

function render (game: 'poe1' | 'poe2', comp: unknown, props: Record<string, unknown> | (() => Record<string, unknown>)) {
  const inst = ref<Record<string, any> | null>(null)
  const errors: unknown[] = []
  const warnings: string[] = []
  const Root = defineComponent({
    setup () {
      provide('builtin-browser', () => {})
      return () => h(comp as never, { ...(typeof props === 'function' ? props() : props), ref: inst })
    }
  })
  const { container, app } = mount(Root, [i18nPlugin(game)], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, app, errors, warnings, inst, search: () => inst.value!.execSearch() }
}

function click (n: MiniNode) {
  const fn = n.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, detail: 1 })
}
const buttonWith = (c: MiniNode, label: string) => {
  const hits = findAll(c, n => n.tag === 'button' && text(n).includes(label))
  expect(hits.length, `找不到按鈕「${label}」`).toBe(1)
  return hits[0]
}
const onlineSwitch = (c: MiniNode) => findAll(c, byAttr('data-action', 'listing-online-only'))[0]

function poe1Item (file: string) {
  return poe1Parse(fx(file))._unsafeUnwrap()
}
function poe2Item (file: string) {
  const r = Poe2.parseClipboard(fx(file))
  if (r.isErr()) throw new Error(String(r.error))
  return r.value
}
function poe1Preset (item: ReturnType<typeof poe1Item>) {
  const { presets, active } = poe1CreatePresets(item, OPTS)
  const p = presets.find(x => x.id === active)!
  return { filters: reactive(p.filters) as any, stats: reactive(p.stats) as any[] }
}
function poe2Preset (item: ReturnType<typeof poe2Item>) {
  const { presets, active } = Poe2.createPresets(item, OPTS)
  const p = presets.find((x: { id: string }) => x.id === active)!
  return { filters: reactive(p.filters) as any, stats: reactive(p.stats) as any[] }
}

describe('M8 PoE1 選單記住後換物品沿用', () => {
  it('PoE1 在選單選「至多 1 週」後換物品,新物品查詢條件沿用', async () => {
    const ringA = poe1Item('poe1/test/fixtures/en/ring-rare-01.txt')
    const { filters } = poe1Preset(ringA)
    expect(filters.trade.listed, '前提:沒記過時 listed 為 null').toBeNull()

    const menu = render('poe1', Poe1OnlineFilterCore, { filters: filters.trade, api: 'trade' })
    await settle()
    expect(menu.errors).toEqual([])
    expect(menu.warnings).toEqual([])
    click(buttonWith(menu.container, '1 個禮拜前'))
    await settle()
    expect(filters.trade.listed).toBe('1week')
    expect(mem()?.poe1?.listed).toBe('1week')
    menu.app.unmount()

    // 換物品:同一個 CheckedItem 先看戒指、再換成珠寶,兩次的 active preset 都要帶 1week
    const item = shallowRef(ringA)
    const panel = render('poe1', Poe1CheckedItem, () => ({ item: item.value, advancedCheck: true }))
    await settle()
    expect(panel.errors).toEqual([])
    expect(panel.inst.value!.itemFilters.trade.listed).toBe('1week')

    item.value = poe1Item('poe1/test/fixtures/en/jewel-rare-01.txt')
    await settle()
    expect(panel.errors).toEqual([])
    expect(panel.inst.value!.itemFilters.trade.listed).toBe('1week')
    panel.app.unmount()
  })

  it('PoE1 記住離線開關後新物品的 offline 也是 true', async () => {
    const ring = poe1Item('poe1/test/fixtures/en/ring-rare-01.txt')
    const { filters } = poe1Preset(ring)
    const menu = render('poe1', Poe1OnlineFilterCore, { filters: filters.trade, api: 'trade' })
    await settle()
    click(buttonWith(menu.container, '離線與在線'))
    await settle()
    expect(filters.trade.offline).toBe(true)
    expect(mem()?.poe1?.offline).toBe(true)
    // 上游切離線會順便把上架時間改成「至多 2 個月」,記憶要一起記
    expect(filters.trade.listed).toBe('2months')
    expect(mem()?.poe1?.listed).toBe('2months')
    menu.app.unmount()

    const panel = render('poe1', Poe1CheckedItem, { item: ring, advancedCheck: true })
    await settle()
    expect(panel.errors).toEqual([])
    expect(panel.inst.value!.itemFilters.trade.offline).toBe(true)
    expect(panel.inst.value!.itemFilters.trade.listed).toBe('2months')
    panel.app.unmount()
  })
})

describe('M9 程式自己改的值不記', () => {
  it('PoE2 大宗查詢把 securable 改成 online 不會被記住', async () => {
    const item = poe2Item('poe2/test/zhTW/fixtures/en/currency-01.txt')
    const { filters } = poe2Preset(item)
    expect(filters.trade.listingType, '前提:新查詢預設 securable').toBe('securable')
    const r = render('poe2', Poe2Bulk, { filters, item })
    r.search()
    await settle(1200)
    expect(r.errors).toEqual([])
    expect(filters.trade.listingType, '前提:大宗查詢確實把 securable 正規化成 online').toBe('online')
    expect(mem()?.poe2).toEqual({})
    expect(mem()?.poe1).toEqual({})
    r.app.unmount()
  })
})

describe('M10 一次性按鈕不記', () => {
  it('PoE2「只看崇高 + 神聖」只改查詢、不寫入記憶', async () => {
    const item = poe2Item('poe2/test/zhTW/fixtures/en/ring-unique-cracklecreep-01.txt')
    const { filters, stats } = poe2Preset(item)
    expect(filters.trade.currency).toBeUndefined()
    const r = render('poe2', Poe2Listing, { filters, stats, item })
    await settle()
    expect(r.errors).toEqual([])
    r.inst.value!.execFilterExaltDivine()
    await settle()
    expect(filters.trade.currency).toBe('exalted_divine')
    expect(mem()?.poe2).toEqual({})
    r.app.unmount()
  })
})

describe('M15 PoE1 選「任何通貨」後換不可工藝物品', () => {
  it('PoE1 在選單選「任何通貨」後換另一件地圖,通貨仍是任何', async () => {
    const mapA = poe1Item('poe1/test/fixtures/en/map-rare-01.txt')
    const mapB = poe1Item('poe1/test/fixtures/en/map-blighted-rare-01.txt')
    const { filters } = poe1Preset(mapA)
    expect(filters.trade.currency, '前提:不可工藝的非傳奇物品,上游強制 chaos_divine').toBe('chaos_divine')
    expect(poe1Preset(mapB).filters.trade.currency, '前提:第二件也會被強制').toBe('chaos_divine')

    const menu = render('poe1', Poe1OnlineFilterCore, { filters: filters.trade, api: 'trade' })
    await settle()
    expect(menu.errors).toEqual([])
    click(buttonWith(menu.container, '任何通貨'))
    await settle()
    expect(filters.trade.currency).toBeNull()
    expect(mem()?.poe1?.currency).toBeNull()
    menu.app.unmount()

    const item = shallowRef(mapA)
    const panel = render('poe1', Poe1CheckedItem, () => ({ item: item.value, advancedCheck: true }))
    await settle()
    expect(panel.errors).toEqual([])
    expect(panel.inst.value!.itemFilters.trade.currency).toBeNull()

    item.value = mapB
    await settle()
    expect(panel.errors).toEqual([])
    expect(panel.inst.value!.itemFilters.trade.currency).toBeNull()
    panel.app.unmount()
  })
})

describe('M14 PoE1 大宗切離線連同上架時間一起記', () => {
  it('PoE1 大宗選單切離線再切回,記憶的離線與上架時間一起變', async () => {
    const item = poe1Item('poe1/test/fixtures/en/currency-01.txt')
    const { filters } = poe1Preset(item)
    const menu = render('poe1', Poe1OnlineFilterCore, { filters: filters.trade, api: 'bulk' })
    await settle()
    expect(menu.errors).toEqual([])
    click(buttonWith(menu.container, '離線與在線'))
    await settle()
    expect(filters.trade.offline).toBe(true)
    expect(mem()?.poe1).toEqual({ offline: true, listed: '2months' })
    click(buttonWith(menu.container, '離線與在線'))
    await settle()
    expect(filters.trade.offline).toBe(false)
    expect(mem()?.poe1).toEqual({ offline: false, listed: null })
    menu.app.unmount()
  })

  it('PoE1 大宗卡片只看在線切離線再切回,記憶的離線與上架時間一起變', async () => {
    const item = poe1Item('poe1/test/fixtures/en/currency-01.txt')
    const { filters } = poe1Preset(item)
    const r = render('poe1', Poe1Bulk, { filters, item })
    r.search()
    await settle(1200)
    expect(r.errors).toEqual([])
    expect(filters.trade.offline).toBe(false)
    click(onlineSwitch(r.container))
    await settle()
    expect(filters.trade.offline).toBe(true)
    expect(mem()?.poe1).toEqual({ offline: true, listed: '2months' })
    click(onlineSwitch(r.container))
    await settle()
    expect(filters.trade.offline).toBe(false)
    expect(mem()?.poe1).toEqual({ offline: false, listed: null })
    r.app.unmount()
  })
})

describe('M13 PoE2 大宗卡片「只看在線」開關寫入記憶', () => {
  it('PoE2 大宗切只看在線只記大宗的掛單類型', async () => {
    const item = poe2Item('poe2/test/zhTW/fixtures/en/currency-01.txt')
    const { filters } = poe2Preset(item)
    filters.trade.listingType = 'online'
    const r = render('poe2', Poe2Bulk, { filters, item })
    r.search()
    await settle(1200)
    expect(r.errors).toEqual([])
    click(onlineSwitch(r.container))
    await settle()
    expect(filters.trade.listingType).toBe('any')
    expect(mem()?.poe2?.bulkListing).toBe('any')
    expect(mem()?.poe2).not.toHaveProperty('tradeListing')
    click(onlineSwitch(r.container))
    await settle()
    expect(filters.trade.listingType).toBe('online')
    expect(mem()?.poe2?.bulkListing).toBe('online')
    r.app.unmount()
  })
})
