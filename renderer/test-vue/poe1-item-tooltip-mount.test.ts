/**
 * P6:PoE1 查價結果懸停浮窗真掛載(TradeItem.vue + TooltipItem.vue,2026-10-15)。
 * 長條 / 方塊 × 關閉 / 按住 Shift / 始終:tippy 目標、設定、keybind 需按住 Shift、懸停才掛物品卡片。
 * 物品資料來自 poe1/test/docs/fetchResponses.json(國際服錄製、已剝帳號),不連網;tippy 換成記錄呼叫的替身。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig, AppConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter, createPresets as poe1CreatePresets } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import { setTradeContextProvider as poe1SetCtx, resetTradeSessions as poe1Reset } from '../../poe1/src/web/price-check/trade/common'
import { parseFetchItem } from '../../poe1/src/web/price-check/trade/display-item'
import Poe1TradeItem from '../../poe1/src/web/price-check/trade/TradeItem.vue'
import Poe1Listing from '../../poe1/src/web/price-check/trade/TradeListing.vue'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const tippyLog = vi.hoisted(() => ({
  created: [] as Array<{ target: unknown, options: Record<string, unknown>, calls: string[] }>
}))
vi.mock('tippy.js', () => {
  const tippy = Object.assign((target: unknown, options: Record<string, unknown>) => {
    const rec = { target, options, calls: [] as string[] }
    tippyLog.created.push(rec)
    return new Proxy({}, { get: (_t, k) => (k === 'state' ? { isEnabled: true, isVisible: false } : () => { rec.calls.push(String(k)) }) })
  }, { setDefaultProps: () => {} })
  return { default: tippy }
})

const ROOT = path.resolve(__dirname, '../..')
const REC = JSON.parse(fs.readFileSync(path.join(ROOT, 'poe1/test/docs/fetchResponses.json'), 'utf8')) as { result: Array<{ id: string, item: any, listing: any }> }

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe1/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const listeners: Record<string, Array<(e: unknown) => void>> = {}
let item: ReturnType<typeof poe1Item>
function poe1Item () {
  return poe1Parse(fs.readFileSync(path.join(ROOT, 'poe1/test/fixtures/en/ring-rare-01.txt'), 'utf8').replace(/\r\n/g, '\n'))._unsafeUnwrap()
}

beforeAll(async () => {
  await initConfig()
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  item = poe1Item()
  const g = globalThis as unknown as { addEventListener: unknown, removeEventListener: unknown }
  g.addEventListener = (type: string, fn: (e: unknown) => void) => { (listeners[type] ??= []).push(fn) }
  g.removeEventListener = (type: string, fn: (e: unknown) => void) => {
    listeners[type] = (listeners[type] ?? []).filter(f => f !== fn)
  }
}, 300_000)

afterEach(() => {
  tippyLog.created.length = 0
  for (const k of Object.keys(listeners)) delete listeners[k]
  AppConfig().priceCheck.itemHoverTooltip = 'keybind'
})

const settle = async () => { for (let i = 0; i < 5; i++) await nextTick() }

function result (n = 0) {
  const r = REC.result[n]
  return {
    id: r.id, itemLevel: String(r.item.ilvl), relativeDate: '1h', priceAmount: 1, priceCurrency: 'chaos',
    isMine: false, hasNote: true, hasFee: false, accountName: 'seller1', accountStatus: 'online' as const, ign: 'Seller1',
    listedTimes: 1, displayItem: parseFetchItem(r.item)
  }
}

function renderItem (layout: 'grid' | 'list', n = 0) {
  const filters = reactive({ itemLevel: { value: 80 } }) as any
  const errors: unknown[] = []
  const Root = defineComponent({
    setup: () => () => layout === 'list'
      ? h('table', [h('tbody', [h(Poe1TradeItem as never, { result: result(n), item, filters, layout })])])
      : h('div', { class: 'listing-grid' }, [h(Poe1TradeItem as never, { result: result(n), item, filters, layout })])
  })
  const { container, app } = mount(Root, [i18nPlugin()], (a) => { a.config.errorHandler = (err) => { errors.push(err) } })
  return { container, app, errors }
}

const targetOf = (c: MiniNode, layout: 'grid' | 'list') =>
  layout === 'list' ? findAll(c, byAttr('data-listing-row'))[0] : findAll(c, byAttr('data-listing', 'item'))[0]
const hover = (n: MiniNode) => (n.attrs.onMouseenter as () => void)()

describe('P6 PoE1 懸停浮窗掛載', () => {
  for (const layout of ['list', 'grid'] as const) {
    it(`${layout}:始終懸停 → tippy 掛在該筆掛單上(interactive、左側、掛 body)`, async () => {
      AppConfig().priceCheck.itemHoverTooltip = 'always'
      const r = renderItem(layout)
      await settle()
      expect(r.errors).toEqual([])
      expect(tippyLog.created.length).toBe(1)
      const { target, options, calls } = tippyLog.created[0]
      expect(target).toBe(targetOf(r.container, layout))
      expect(options).toMatchObject({ interactive: true, placement: 'left', theme: 'item-tooltip', trigger: 'mouseenter' })
      expect((options.appendTo as () => unknown)()).toBe(document.body)
      expect(options.content).toBe(findAll(r.container, byAttr('data-tooltip-content'))[0])
      expect(calls).not.toContain('disable')
      r.app.unmount()
      expect(tippyLog.created[0].calls).toContain('destroy')
    })

    it(`${layout}:關閉 → 不建 tippy、不畫浮窗掛點`, async () => {
      AppConfig().priceCheck.itemHoverTooltip = 'off'
      const r = renderItem(layout)
      await settle()
      expect(tippyLog.created.length).toBe(0)
      expect(findAll(r.container, byAttr('data-tooltip-content'))).toEqual([])
      hover(targetOf(r.container, layout))
      await settle()
      expect(findAll(r.container, byAttr('data-tooltip', 'item'))).toEqual([])
      r.app.unmount()
    })

    it(`${layout}:按住 Shift 才啟用(掛載時停用,放開再停用)`, async () => {
      AppConfig().priceCheck.itemHoverTooltip = 'keybind'
      const r = renderItem(layout)
      await settle()
      expect(tippyLog.created.length).toBe(1)
      const calls = tippyLog.created[0].calls
      expect(calls).toEqual(['disable'])
      hover(targetOf(r.container, layout))
      for (const fn of listeners.keydown ?? []) fn({ key: 'Shift' })
      expect(calls).toEqual(['disable', 'enable', 'show'])
      for (const fn of listeners.keyup ?? []) fn({ key: 'Shift' })
      expect(calls).toEqual(['disable', 'enable', 'show', 'hide', 'disable'])
      r.app.unmount()
      expect(listeners.keydown ?? []).toEqual([])
    })
  }

  it('懸停後才掛物品卡片:名稱、詞綴、tier、分區', async () => {
    AppConfig().priceCheck.itemHoverTooltip = 'always'
    const r = renderItem('list')
    await settle()
    expect(findAll(r.container, byAttr('data-tooltip', 'item'))).toEqual([])
    hover(targetOf(r.container, 'list'))
    await settle()
    const card = findAll(r.container, byAttr('data-tooltip', 'item'))[0]
    expect(text(findAll(card, byAttr('data-tooltip-title'))[0])).toContain('Sorrow Turn')
    expect(text(card)).toContain('+74 to maximum Life')
    expect(text(card)).toContain('P1')
    expect(findAll(card, byAttr('data-section')).map(n => n.attrs['data-section'])).toEqual(['itemProps', 'implicitMods', 'explicitMods'])
    expect(r.errors).toEqual([])
    r.app.unmount()
  })
})

describe('P6 TradeListing 兩種版面都掛浮窗', () => {
  const ids = REC.result.slice(0, 4).map(r => r.id)
  let realFetch: typeof fetch
  beforeAll(() => {
    poe1SetCtx(() => ({ http: Host.httpFetch, realm: 'intl' as const, latencySeconds: 0, accountName: undefined }))
    realFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
      if (/\/api\/trade\/search\//.test(url)) return json({ id: 'P1Q', result: ids, total: ids.length })
      if (/\/api\/trade\/fetch\//.test(url)) {
        // 前兩筆同一個賣家同價 → TradeListing 合併成一列(listedTimes 2)
        return json({
          result: REC.result.slice(0, 4).map((r, i) => ({
            ...r,
            listing: {
              ...r.listing,
              fee: undefined,
              indexed: new Date().toISOString(),
              price: { amount: 2, currency: 'chaos', type: '~price' },
              account: i < 2 ? { name: 'sellerA', lastCharacterName: 'SellerA', online: null } : r.listing.account
            }
          }))
        })
      }
      return realFetch(input, init)
    }) as typeof fetch
  })
  afterEach(() => poe1Reset())

  for (const layout of ['grid', 'list'] as const) {
    it(`${layout}:每筆掛單一個 tippy,合併掛單只有第一筆`, async () => {
      AppConfig().priceCheck.itemHoverTooltip = 'always'
      AppConfig().priceCheck.listingLayout = { item: layout, bulk: 'list' }
      const { presets, active } = poe1CreatePresets(item, {
        league: 'Standard', realm: 'intl', clientLanguage: 'en', searchStatRange: 10, currency: null,
        collapseListings: 'api', activateStockFilter: false, merchantOnly: false
      })
      const p = presets.find(x => x.id === active)!
      const filters = reactive(p.filters) as any
      let service: { execSearch(): void } | null = null
      const Root = defineComponent({
        setup: () => () => h(Poe1Listing as never, { filters, stats: reactive(p.stats), item, ref: (v: unknown) => { service = v as never } })
      })
      const errors: unknown[] = []
      const { container, app } = mount(Root, [i18nPlugin()], (a) => {
        a.config.errorHandler = (err) => { errors.push(err) }
        a.provide('builtin-browser', () => {})
      })
      tippyLog.created.length = 0
      service!.execSearch()
      await new Promise(resolve => setTimeout(resolve, 1200))
      await settle()
      expect(errors).toEqual([])
      const rows = layout === 'grid' ? findAll(container, byAttr('data-listing', 'item')) : findAll(container, byAttr('data-listing-row'))
      // 四筆合併成三列,每列一個 tippy;合併那列懸停顯示第一筆
      expect(rows.length).toBe(3)
      // 物品浮窗的 tippy(線上篩選的提示也用 tippy,不算)每列剛好一個
      const alive = tippyLog.created.filter(c => c.options?.theme === 'item-tooltip' && !c.calls.includes('destroy'))
      expect(alive.length).toBe(3)
      expect(rows.every(row => alive.some(c => c.target === row))).toBe(true)
      hover(rows[0])
      await settle()
      expect(text(findAll(container, byAttr('data-tooltip-title'))[0])).toContain('Sorrow Turn')
      app.unmount()
      AppConfig().priceCheck.listingLayout = { item: 'grid', bulk: 'list' }
    })
  }
})
