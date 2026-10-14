/**
 * 倉庫價值(2026-10-15)疊層真掛載 V11:收 main 的 show(帶每格數量)→ 徽章顯示小計、讀不到的格單價 +「?」、空格不畫、
 * 右側「本頁價值」卡、停格明細卡(單價 / 數量 / 小計)、共用狀態寫進 stash-value.ts、peek 收起格子徽章、每個事件都回報遮罩 ack。
 * poe.ninja 價格 = core/test/recordings/ninja 的 Scarab / Currency 錄製檔(存進 Host 快取;不連網);PoE1 聯盟清單在這裡補一個假回應。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { createNinjaClient, toSnapshot } from '@exile-appraiser/core/ninja'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import type { ScanMaskReport, StashCursorEvent, StashScanEvent } from '@ipc/types'
import { AppConfig, initConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import { useLeagues } from '../src/web/background/Leagues'
import { usePoeninja } from '../src/web/background/Prices'
import { loadedGame } from '../src/web/games/active'
import StashPrices from '../src/web/overlay/StashPrices.vue'
import { stashValue } from '../src/web/overlay/stash-value'
import { parseStashLayouts } from '../../core/src/stash/layout'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const LEAGUE = 'Allflame'
const LAYOUTS = parseStashLayouts(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/layouts.json'), 'utf8')))
const N = LAYOUTS.subtabs.scarabs.length

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
let cursorCb: ((e: StashCursorEvent) => void) | null = null
const masks: ScanMaskReport[] = []
const saved: Record<string, unknown> = {}
const origFetch = globalThis.fetch

beforeAll(async () => {
  // PoE1 聯盟清單(test-vue setup 只錄了 PoE2 的)
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
  const snap = toSnapshot(await createNinjaClient({ http, game: 'poe1', league: LEAGUE, sleep: async () => {}, now: () => Date.now() }).fetchAll({ exchange: ['Currency', 'Scarab'], item: [] }))
  await Host.ninjaCacheSave('poe1', LEAGUE, JSON.stringify(snap))
  await usePoeninja().load()
  // 掃描事件 / 游標 / 遮罩回報接到測試
  ;(Host as Record<string, unknown>).onStashScanResult = (cb: (e: StashScanEvent) => void) => { scanCb = cb; return () => { scanCb = null } }
  ;(Host as Record<string, unknown>).onStashCursor = (cb: (e: StashCursorEvent) => void) => { cursorCb = cb; return () => { cursorCb = null } }
  ;(Host as Record<string, unknown>).scanMask = (r: ScanMaskReport) => { masks.push(r) }
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
function show (quantities?: Array<number | null>, peek?: boolean) {
  scanCb!({ seq: ++seq, ts: 0, reason: 'show', subtab: 'scarabs', yOffset: 0, client: { w: 1280, h: 900 }, quantities, ...(peek ? { peek } : {}) })
}

describe('V11 倉庫價值疊層', () => {
  // 第 0 格 3 個、第 1 格讀不到、第 2 格空格,其餘各 1 個(三格都挑 poe.ninja 有價格的,錄製檔不是每種聖甲蟲都有)
  const okIdx = () => LAYOUTS.subtabs.scarabs.map((c, i) => [c.refName, i] as const).filter(([r]) => usePoeninja().priceOf(r).status === 'ok').map(([, i]) => i)
  let idx: number[] = []
  let qty: Array<number | null> = []
  beforeAll(() => {
    idx = okIdx().slice(0, 3)
    expect(idx).toHaveLength(3)
    qty = Array(N).fill(1)
    qty[idx[0]] = 3
    qty[idx[1]] = null
    qty[idx[2]] = 0
  })

  it('小計徽章、讀不到的「?」、空格不畫、本頁價值卡與共用狀態、ack', async () => {
    const { container, app, errors } = render()
    await settle()
    expect(scanCb).toBeTypeOf('function')
    show(qty)
    await settle(40)
    const badges = all(container, 'badge')
    // 空格沒藏 → N 枚
    expect(badges).toHaveLength(N - 1)
    const byRef = new Map(badges.map(b => [b.attrs['data-ref'], b]))
    const [c0, c1, c2] = idx.map(i => LAYOUTS.subtabs.scarabs[i])
    expect(byRef.get(c0.refName)!.attrs['data-qty']).toBe('3')
    expect(byRef.has(c2.refName)).toBe(false)
    expect(findAll(byRef.get(c1.refName)!, byAttr('data-stash', 'qty-unknown'))).toHaveLength(1)
    // 本頁價值卡:總價 + 已讀 / 未讀
    const card = all(container, 'value')[0]
    expect(card).toBeTruthy()
    expect(text(card)).toContain('本頁價值')
    expect(text(card)).toContain(`${N - 2} 格已讀 · 1 格數量未讀`)
    expect(stashValue.value).toMatchObject({ subtab: 'scarabs', known: N - 2, unknown: 1 })
    expect(stashValue.value!.totalChaos).toBeGreaterThan(0)
    // 每個事件處理完都回報遮罩並帶 seq(main 等 ack 才擷取下一張)
    expect(masks.filter(m => m.source === 'stash').map(m => m.seq)).toContain(seq)
    expect(errors).toEqual([])
    app.unmount()
    // 卸載 = 共用狀態清掉(選單回佔位)
    expect(stashValue.value).toBeNull()
  })

  it('停格明細卡:單價 / 數量 / 小計(小計 = 單價 × 數量)', async () => {
    const { container, app, errors } = render()
    await settle()
    show(qty)
    await settle(40)
    const target = LAYOUTS.subtabs.scarabs[idx[0]].refName
    cursorCb!({ refName: target })
    await settle(40)
    const badges = all(container, 'badge')
    expect(badges).toHaveLength(1)
    const card = badges[0]
    const unit = text(all(card, 'unit-price')[0])
    const count = text(all(card, 'qty')[0])
    const sub = text(all(card, 'subtotal')[0])
    expect(unit).toContain('單價')
    expect(count).toContain('× 3')
    expect(sub).toContain('小計')
    // 小計 = 單價 × 3(同單位 C 時)
    const num = (s: string) => Number(s.replace(/[^\d.]/g, ''))
    // 有價格的格:小計一定有值(沒算出來會是「—」)
    expect(sub).not.toContain('—')
    if (unit.endsWith('C') && sub.endsWith('C')) expect(num(sub)).toBeCloseTo(num(unit) * 3, 0)
    // 停在空格上也畫(看得到這格是什麼)
    cursorCb!({ refName: LAYOUTS.subtabs.scarabs[idx[2]].refName })
    await settle(40)
    expect(all(container, 'badge')[0].attrs['data-qty']).toBe('0')
    expect(errors).toEqual([])
    app.unmount()
  })

  it('peek → 格子徽章收起(本頁價值卡留著);下一個不帶 peek 的 show → 回來', async () => {
    const { container, app } = render()
    await settle()
    show(qty)
    await settle(40)
    cursorCb!({ refName: null })
    show(qty, true)
    await settle(40)
    expect(all(container, 'badge')).toHaveLength(0)
    expect(all(container, 'value')).toHaveLength(1)
    show(qty)
    await settle(40)
    expect(all(container, 'badge').length).toBe(N - 1)
    app.unmount()
  })

  it('沒有數量(關閉讀數量)→ 每格單價、沒有本頁價值卡', async () => {
    const { container, app } = render()
    await settle()
    show(undefined)
    await settle(40)
    expect(all(container, 'badge')).toHaveLength(N)
    expect(all(container, 'value')).toHaveLength(0)
    expect(stashValue.value).toBeNull()
    app.unmount()
  })
})
