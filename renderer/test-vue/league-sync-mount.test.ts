/**
 * 2026-11-09 使用者回報:標題列聯盟與掛單「線上」選單的聯盟不同步。
 * 真掛載兩代 CheckedItem:標題列(全域 `useLeagues().selectedId`)改 → 物品搜尋聯盟跟著改;選單(`filters.trade.league`)改 → 寫回標題列。
 * 聯盟清單與交易站回應都是假回應,不連網。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig, AppConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import { useLeagues } from '../src/web/background/Leagues'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import { setTradeContextProvider as poe1SetCtx } from '../../poe1/src/web/price-check/trade/common'
import Poe1CheckedItem from '../../poe1/src/web/price-check/CheckedItem.vue'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import Poe2CheckedItem from '../../poe2/src/web/price-check/CheckedItem.vue'
import { mount } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const fx = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const LEAGUES = ['Allflame', 'Standard']

function i18nPlugin (game: 'poe1' | 'poe2') {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/${game}/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
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
    if (/\/api\/leagues/.test(url)) return json(LEAGUES.map(id => ({ id, rules: [] })))
    if (/\/api\/trade2\/data\/leagues/.test(url)) return json({ result: LEAGUES.map(id => ({ id, realm: 'poe2', text: id })) })
    if (/\/api\/trade2?\/(search|exchange)\//.test(url)) return json({ id: 'Q', result: [], total: 0 })
    return realFetch(input, init)
  }) as typeof fetch
}, 300_000)
afterAll(() => { globalThis.fetch = realFetch })

const settle = async (ms = 50) => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise(resolve => setTimeout(resolve, ms))
  for (let i = 0; i < 5; i++) await nextTick()
}

function render (game: 'poe1' | 'poe2', comp: unknown, item: unknown) {
  const inst = ref<Record<string, any> | null>(null)
  const errors: unknown[] = []
  const Root = defineComponent({
    setup () {
      provide('builtin-browser', () => {})
      const it = shallowRef(item)
      return () => h(comp as never, { item: it.value, advancedCheck: true, ref: inst })
    }
  })
  const { app } = mount(Root, [i18nPlugin(game)], (a) => { a.config.errorHandler = (err) => { errors.push(err) } })
  return { app, errors, inst }
}

async function useGame (game: 'poe1' | 'poe2') {
  AppConfig().realm = 'intl'
  AppConfig().game = game
  AppConfig().leagueId = 'Allflame'
  await settle()
  const leagues = useLeagues()
  await leagues.load()
  await settle()
  expect(leagues.selectedId.value, '前提:聯盟清單已載入').toBe('Allflame')
  return leagues
}

const cases = [
  { game: 'poe1' as const, comp: Poe1CheckedItem, item: () => poe1Parse(fx('poe1/test/fixtures/en/ring-rare-01.txt'))._unsafeUnwrap() },
  {
    game: 'poe2' as const,
    comp: Poe2CheckedItem,
    item: () => {
      const r = Poe2.parseClipboard(fx('poe2/test/zhTW/fixtures/en/amulet-unique-oduuns-idol-01.txt'))
      if (r.isErr()) throw new Error(String(r.error))
      return r.value
    }
  }
]

describe('標題列聯盟 ↔ 掛單選單聯盟同步', () => {
  for (const c of cases) {
    it(`${c.game}:標題列換聯盟 → 物品搜尋聯盟跟著換`, async () => {
      const leagues = await useGame(c.game)
      const p = render(c.game, c.comp, c.item())
      await settle()
      expect(p.inst.value!.itemFilters.trade.league).toBe('Allflame')
      leagues.selectedId.value = 'Standard'
      await settle()
      expect(p.inst.value!.itemFilters.trade.league).toBe('Standard')
      expect(p.errors).toEqual([])
      p.app.unmount()
    })

    it(`${c.game}:選單換聯盟 → 標題列跟著換`, async () => {
      const leagues = await useGame(c.game)
      const p = render(c.game, c.comp, c.item())
      await settle()
      p.inst.value!.itemFilters.trade.league = 'Standard'
      await settle()
      expect(leagues.selectedId.value).toBe('Standard')
      expect(AppConfig().leagueId).toBe('Standard')
      expect(p.errors).toEqual([])
      p.app.unmount()
    })
  }
})
