/**
 * 查價面板 B 改版 P4(2026-10-14,Q13):兩代 TradeListing / TradeBulk 真掛載。
 * 預設版面(一般 = 方塊、通貨 = 長條)、點 ▦/☰ 換版面並寫進設定、通貨膠囊沿用選擇狀態、只看在線開關改篩選。
 * 交易站回應:PoE2 一般物品走 setup.ts 的錄製檔;其餘(PoE1 search / fetch、兩代 exchange)本檔包一層假回應,不連網。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig, AppConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter, createPresets as poe1CreatePresets } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import { setTradeContextProvider as poe1SetCtx, resetTradeSessions as poe1Reset } from '../../poe1/src/web/price-check/trade/common'
import Poe1Listing from '../../poe1/src/web/price-check/trade/TradeListing.vue'
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

const poe1Ids = Array.from({ length: 4 }, (_, i) => `p1-${i}`)
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
    if (/\/api\/trade\/search\//.test(url)) return json({ id: 'P1Q', result: poe1Ids, total: poe1Ids.length })
    if (/\/api\/trade\/fetch\//.test(url)) {
      return json({
        result: poe1Ids.map((id, i) => ({
          id,
          item: { ilvl: 80 + i, note: `~price ${i + 1} chaos` },
          listing: { indexed: new Date().toISOString(), price: { amount: i + 1, currency: 'chaos', type: '~price' }, account: account(i) }
        }))
      })
    }
    return realFetch(input, init)
  }) as typeof fetch
}, 300_000)

afterEach(() => {
  poe1Reset()
  poe2Reset()
  AppConfig().priceCheck.listingLayout = { item: 'grid', bulk: 'list' }
})

const settle = async (ms = 50) => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise(resolve => setTimeout(resolve, ms))
  for (let i = 0; i < 5; i++) await nextTick()
}

function render (game: 'poe1' | 'poe2', comp: unknown, props: Record<string, unknown>) {
  const service = ref<{ execSearch(): void } | null>(null)
  const errors: unknown[] = []
  const warnings: string[] = []
  const Root = defineComponent({
    setup () {
      provide('builtin-browser', () => {})
      return () => h(comp as never, { ...props, ref: service })
    }
  })
  const { container, app } = mount(Root, [i18nPlugin(game)], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, app, errors, warnings, search: () => service.value!.execSearch() }
}

function click (n: MiniNode) {
  const fn = n.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, detail: 1 })
}
const layoutBtn = (c: MiniNode, mode: 'grid' | 'list') => findAll(c, byAttr('data-layout', mode))[0]
const shown = (c: MiniNode) => findAll(c, byAttr('data-listing-layout')).map(n => n.attrs['data-listing-layout'])

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

describe('一般物品掛單(預設方塊)', () => {
  it('PoE1:預設兩欄小卡片,點長條換回表格列並寫進設定', async () => {
    const item = poe1Item('poe1/test/fixtures/en/ring-rare-01.txt')
    const { filters, stats } = poe1Preset(item)
    const r = render('poe1', Poe1Listing, { filters, stats, item })
    r.search()
    await settle(1200)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(shown(r.container)).toEqual(['grid'])
    expect(layoutBtn(r.container, 'grid').attrs['aria-pressed']).toBe('true')
    const tiles = findAll(r.container, byAttr('data-listing', 'item'))
    expect(tiles.length).toBe(4)
    expect(text(tiles[0])).toContain('1 chaos')
    expect(text(r.container)).toContain('最低 1 chaos')

    click(layoutBtn(r.container, 'list'))
    await settle()
    expect(AppConfig().priceCheck.listingLayout).toEqual({ item: 'list', bulk: 'list' })
    expect(shown(r.container)).toEqual(['list'])
    expect(layoutBtn(r.container, 'list').attrs['aria-pressed']).toBe('true')
    expect(findAll(r.container, byAttr('data-listing', 'item'))).toEqual([])
    expect(findAll(r.container, n => n.tag === 'tr').length).toBeGreaterThan(4)
    r.app.unmount()
  })

  it('PoE2:預設方塊(TradeItem 卡片),點長條改表格列、通貨的設定不受影響', async () => {
    const item = poe2Item('poe2/test/zhTW/fixtures/en/ring-unique-cracklecreep-01.txt')
    const { filters, stats } = poe2Preset(item)
    const r = render('poe2', Poe2Listing, { filters, stats, item })
    r.search()
    await settle(1500)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(shown(r.container)).toEqual(['grid'])
    expect(findAll(r.container, byAttr('data-listing', 'item')).length).toBeGreaterThan(0)
    expect(findAll(r.container, byAttr('data-listing-lowest')).length).toBe(1)

    click(layoutBtn(r.container, 'list'))
    await settle()
    expect(AppConfig().priceCheck.listingLayout).toEqual({ item: 'list', bulk: 'list' })
    expect(shown(r.container)).toEqual(['list'])
    expect(findAll(r.container, byAttr('data-listing', 'item'))).toEqual([])
    r.app.unmount()
  })
})

describe('通貨掛單(預設長條)', () => {
  it('PoE1:預設長條,膠囊沿用選擇與筆數,點方塊寫進設定;只看在線開關改 offline', async () => {
    const item = poe1Item('poe1/test/fixtures/en/currency-01.txt')
    const { filters } = poe1Preset(item)
    const r = render('poe1', Poe1Bulk, { filters, item })
    r.search()
    await settle(1200)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(shown(r.container)).toEqual(['list'])
    const chips = findAll(r.container, byAttr('data-action', 'listing-pay-with'))
    expect(chips.map(c => text(c))).toEqual(['混沌石 · 3', '神聖石 · ?'])
    expect(chips[0].attrs['aria-pressed']).toBe('true')
    expect(findAll(chips[0], n => n.tag === 'img')[0].attrs.src).toBe('/images/chaos.png')

    click(layoutBtn(r.container, 'grid'))
    await settle()
    expect(AppConfig().priceCheck.listingLayout).toEqual({ item: 'grid', bulk: 'grid' })
    expect(shown(r.container)).toEqual(['grid'])
    expect(findAll(r.container, byAttr('data-listing', 'bulk')).length).toBe(3)

    const online = findAll(r.container, byAttr('data-action', 'listing-online-only'))[0]
    expect(online.attrs['aria-pressed']).toBe(filters.trade.offline ? 'false' : 'true')
    const before = filters.trade.offline
    click(online)
    expect(filters.trade.offline).toBe(!before)
    r.app.unmount()
  })

  it('PoE2:三顆膠囊用 PoE2 圖示,點神聖石切換選擇;方塊 / 長條切換寫設定;只看在線改 listingType', async () => {
    const item = poe2Item('poe2/test/zhTW/fixtures/en/currency-01.txt')
    const { filters } = poe2Preset(item)
    filters.trade.listingType = 'online' // 與 CheckedItem 一樣:通貨查詢不支援 securable / available
    const r = render('poe2', Poe2Bulk, { filters, item })
    r.search()
    await settle(1200)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(shown(r.container)).toEqual(['list'])
    const chips = () => findAll(r.container, byAttr('data-action', 'listing-pay-with'))
    expect(chips().length).toBe(3)
    expect(chips().map(c => findAll(c, n => n.tag === 'img')[0].attrs.src)).toEqual(['/images/poe2/exa.png', '/images/poe2/chaos.png', '/images/poe2/divine.png'])
    const pressed = () => chips().map(c => c.attrs['aria-pressed'])
    click(chips()[2])
    await settle()
    expect(pressed()).toEqual(['false', 'false', 'true'])

    click(layoutBtn(r.container, 'grid'))
    await settle()
    expect(AppConfig().priceCheck.listingLayout.bulk).toBe('grid')
    expect(AppConfig().priceCheck.listingLayout.item).toBe('grid')
    const tiles = findAll(r.container, byAttr('data-listing', 'bulk'))
    expect(tiles.length).toBe(3)
    expect(findAll(tiles[0], n => n.tag === 'img')[0].attrs.src).toBe('/images/poe2/divine.png')

    click(findAll(r.container, byAttr('data-action', 'listing-online-only'))[0])
    expect(filters.trade.listingType).toBe('any')
    await nextTick()
    click(findAll(r.container, byAttr('data-action', 'listing-online-only'))[0])
    expect(filters.trade.listingType).toBe('online')
    r.app.unmount()
  })
})
