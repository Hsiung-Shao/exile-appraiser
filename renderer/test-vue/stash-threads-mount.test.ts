/**
 * 3.30 綢帶頁疊層真掛載 T11:收 main 的 show(subtab 'threads')→ 10 枚徽章(綢帶名稱、都有 poe.ninja 價格)、沒有錯誤。
 * poe.ninja 價格 = core/test/recordings/ninja 的 Currency / Fragment / Thread 錄製檔(存進 Host 快取;不連網);PoE1 聯盟清單在這裡補一個假回應。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { createNinjaClient, toSnapshot } from '@exile-appraiser/core/ninja'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import type { StashCursorEvent, StashScanEvent } from '@ipc/types'
import { AppConfig, initConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import { useLeagues } from '../src/web/background/Leagues'
import { usePoeninja } from '../src/web/background/Prices'
import { loadedGame } from '../src/web/games/active'
import StashPrices from '../src/web/overlay/StashPrices.vue'
import { mount, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const LEAGUE = 'Allflame'
const THREADS = [
  'Ultimatum Thread', 'Ritual Thread', 'Legion Thread', 'Incursion Thread', 'Expedition Thread',
  'Breach Thread', 'Blight Thread', 'Betrayal Thread', 'Bestiary Thread', 'Abyss Thread'
]

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe2/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}
const settle = async (ms = 20) => { for (let i = 0; i < 6; i++) { await nextTick(); await new Promise(r => setTimeout(r, ms)) } }
const all = (c: MiniNode, v: string) => findAll(c, byAttr('data-stash', v))

let scanCb: ((e: StashScanEvent) => void) | null = null
const saved: Record<string, unknown> = {}
const origFetch = globalThis.fetch

beforeAll(async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (/\/api\/leagues\?/.test(url)) return new Response(JSON.stringify([{ id: LEAGUE, rules: [], event: false }]), { status: 200 })
    return await origFetch(input, init)
  }) as typeof fetch
  await initConfig()
  const config = AppConfig()
  Object.assign(saved, { game: config.game, realm: config.realm, leagueId: config.leagueId, names: config.stashShowNames })
  config.game = 'poe1'
  config.realm = 'intl'
  config.stashShowNames = false
  loadedGame.value = 'poe1'
  await useLeagues().load()
  config.leagueId = LEAGUE
  const response = (body: string): HttpResponse => ({ ok: true, status: 200, headers: new Headers(), json: async () => JSON.parse(body), text: async () => body })
  const http: HttpFetch = async (url) => {
    const file = path.join(ROOT, 'core/test/recordings/ninja', 'exchange_' + new URL(url).searchParams.get('type') + '.json')
    return fs.existsSync(file) ? response(fs.readFileSync(file, 'utf8')) : { ...response('x'), ok: false, status: 404 }
  }
  const snap = toSnapshot(await createNinjaClient({ http, game: 'poe1', league: LEAGUE, sleep: async () => {}, now: () => Date.now() }).fetchAll({ exchange: ['Currency', 'Fragment', 'Thread'], item: [] }))
  await Host.ninjaCacheSave('poe1', LEAGUE, JSON.stringify(snap))
  await usePoeninja().load()
  ;(Host as Record<string, unknown>).onStashScanResult = (cb: (e: StashScanEvent) => void) => { scanCb = cb; return () => { scanCb = null } }
  ;(Host as Record<string, unknown>).onStashCursor = (_cb: (e: StashCursorEvent) => void) => () => {}
  ;(Host as Record<string, unknown>).scanMask = () => {}
}, 120_000)

afterAll(() => {
  globalThis.fetch = origFetch
  Object.assign(AppConfig(), { game: saved.game, realm: saved.realm, leagueId: saved.leagueId, stashShowNames: saved.names })
})

function render () {
  const errors: unknown[] = []
  const Root = defineComponent({ setup: () => () => h(StashPrices) })
  const { container, app } = mount(Root, [i18nPlugin()], (a) => { a.config.errorHandler = (err) => { errors.push(err) } })
  return { container, app, errors }
}

let seq = 0
function show (subtab: string) {
  scanCb!({ seq: ++seq, ts: 0, reason: 'show', subtab: subtab as 'general', yOffset: 0, client: { w: 1280, h: 900 } })
}

describe('T11 疊層畫出綢帶頁徽章', () => {
  it('show threads → 10 枚徽章、是 10 種綢帶、都有 poe.ninja 價格', async () => {
    const { container, app, errors } = render()
    await settle()
    expect(scanCb).toBeTypeOf('function')
    show('threads')
    await settle(40)
    const badges = all(container, 'badge')
    // 版面沒有 threads / 疊層不認 subtab → 0 枚或丟錯
    expect(badges).toHaveLength(10)
    expect(badges.map(b => b.attrs['data-ref']).sort()).toEqual([...THREADS].sort())
    // 沒抓 Thread 類別 / 鍵對不上 → 全部「無價」
    expect(badges.map(b => b.attrs['data-status'])).toEqual(Array(10).fill('ok'))
    expect(errors).toEqual([])
    app.unmount()
  })
  it('綢帶 → 一般 → 綢帶:切換後徽章集合跟著換', async () => {
    const { container, app, errors } = render()
    await settle()
    show('threads')
    await settle(40)
    expect(all(container, 'badge')).toHaveLength(10)
    show('general')
    await settle(40)
    const general = all(container, 'badge')
    // 一般頁 52 格(3.30),不會殘留綢帶
    expect(general).toHaveLength(52)
    expect(general.some(b => String(b.attrs['data-ref']).endsWith(' Thread'))).toBe(false)
    show('threads')
    await settle(40)
    expect(all(container, 'badge')).toHaveLength(10)
    expect(errors).toEqual([])
    app.unmount()
  })
})
