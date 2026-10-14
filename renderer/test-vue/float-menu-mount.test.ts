/**
 * 懸浮選單真掛載(2026-10-08 起;2026-10-15 改 A 版指令面板,F6–F8):搜尋框聚焦、分組順序、篩選膠囊與搜尋、鍵盤、
 * 市況列(錄製快照 / 沒資料)、倉庫本頁價值佔位、辨識開關、正則書籤 PoE1 / PoE2、工具(設定 / 速查表 / 拆粉排行)、
 * 標題列聯盟切換與限流點。資料讀 repo、不連網、不送任何輸入(點擊 / 按鍵只呼叫元件的事件處理)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { createNinjaClient, toSnapshot } from '@exile-appraiser/core/ninja'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import { AppConfig, initConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import { useLeagues } from '../src/web/background/Leagues'
import { ensureStateLoaded, useRegexStore } from '../src/web/regex/store'
import FloatMenu from '../src/web/overlay/FloatMenu.vue'
import { floatMenuChip, floatMenuQuery, floatMenuSection, floatMenuSel } from '../src/web/overlay/float-menu-state'
import { tradeSession } from '@poe1/trade/common'
import { mount, text, findAll, byAttr, focusedNode, type MiniNode } from './mini-dom'
const TEST_LEAGUE = 'Forbidden Rites'

const ROOT = path.resolve(__dirname, '../..')

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe2/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const settle = async (ms = 30) => { for (let i = 0; i < 5; i++) { await nextTick(); await new Promise(r => setTimeout(r, ms)) } }
const byAction = (c: MiniNode, a: string) => findAll(c, byAttr('data-action', a))
const one = (c: MiniNode, name: string, value: string) => findAll(c, byAttr(name, value))[0]
function call (n: MiniNode | undefined, ev: string, arg: unknown = { preventDefault () {}, stopPropagation () {} }) {
  expect(n).toBeTruthy()
  const fn = n!.attrs[ev] as ((e: unknown) => void) | undefined
  expect(typeof fn, ev).toBe('function')
  fn!(arg)
}
const click = (n: MiniNode | undefined) => { call(n, 'onClick') }
const key = (c: MiniNode, k: string) => { call(one(c, 'data-menu', 'search'), 'onKeydown', { key: k, preventDefault () {}, stopPropagation () {} }) }
const groups = (c: MiniNode) => findAll(c, byAttr('data-group')).map(n => n.attrs['data-group'])
const selected = (c: MiniNode) => findAll(c, byAttr('data-sel', 'true')).map(n => n.attrs['data-item'])

function render () {
  const errors: unknown[] = []
  const warnings: string[] = []
  const events: string[] = []
  const Root = defineComponent({
    setup: () => () => h(FloatMenu, {
      settingsOpen: false,
      onClose: (r: string) => { events.push(`close:${r}`) },
      onSettings: () => { events.push('settings') },
      onOpenTab: (tab: string) => { events.push(`open-tab:${tab}`) }
    })
  })
  const { container, app } = mount(Root, [i18nPlugin()], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, app, errors, warnings, events }
}
function reset () {
  floatMenuSection.value = ''
  floatMenuChip.value = 'all'
  floatMenuQuery.value = ''
  floatMenuSel.value = null
}

beforeAll(async () => {
  await initConfig()
  await ensureStateLoaded()
  // 市況列用:poe.ninja 快取先放好(錄製檔 → 快照;Host 純瀏覽器模式存記憶體),之後換到國際服 + 聯盟時讀快取
  const response = (body: string): HttpResponse => ({ ok: true, status: 200, headers: new Headers(), json: async () => JSON.parse(body), text: async () => body })
  const http: HttpFetch = async (url) => {
    const file = path.join(ROOT, 'core/test/recordings/ninja/poe2', 'exchange_' + new URL(url).searchParams.get('type') + '.json')
    return fs.existsSync(file) ? response(fs.readFileSync(file, 'utf8')) : { ...response('x'), ok: false, status: 404 }
  }
  const snap = toSnapshot(await createNinjaClient({ http, game: 'poe2', league: TEST_LEAGUE, sleep: async () => {}, now: () => 1 }).fetchAll({ exchange: ['Currency'], item: [] }))
  await Host.ninjaCacheSave('poe2', TEST_LEAGUE, JSON.stringify(snap))
  const store = useRegexStore()
  store.ui.bookmarks.splice(0, store.ui.bookmarks.length,
    { name: '地圖一', page: 'map_mods', game: 'poe2', mode: 'any', lang: 'zh', keys: [], alt: [], hotkey: 'F6' } as never,
    { name: '碑牌探險', page: 'map_mods', game: 'poe2', mode: 'any', lang: 'zh', keys: [], alt: [] } as never,
    { name: 'PoE1 書籤', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [] } as never)
}, 120_000)

describe('F7 選單掛載(PoE2)', () => {
  it('搜尋框聚焦;分組順序 市況 → 倉庫 → 辨識 → 書籤 → 工具;設定 emit settings、✕ emit close', async () => {
    reset()
    const { container, errors, warnings, events, app } = render()
    await settle()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    // onMounted 沒 focus → 叫出選單後打字進不了搜尋框
    expect(focusedNode()).toBe(one(container, 'data-menu', 'search'))
    expect(groups(container)).toEqual(['market', 'stash', 'scan', 'bookmarks', 'tools'])
    const s = text(container)
    for (const w of ['流亡鑑價', '市況', '倉庫本頁價值', '自動辨識', '正則書籤', '工具', '設定', '速查表', '拆粉排行']) expect(s, w).toContain(w)
    // PoE2 倉庫本頁價值淡化並說明只在 PoE1 可用
    expect(one(container, 'data-menu', 'stash').attrs['data-disabled']).toBe('true')
    expect(text(one(container, 'data-menu', 'stash'))).toContain('只在 PoE1 碎片頁可用')
    click(byAction(container, 'menu-settings')[0])
    click(byAction(container, 'menu-close')[0])
    expect(events).toEqual(['settings', 'close:✕'])
    app.unmount()
  })

  it('拆粉排行 emit open-tab dust;前往正則 emit open-tab regex', async () => {
    reset()
    const { container, errors, events, app } = render()
    await settle()
    click(byAction(container, 'menu-dust')[0])
    click(byAction(container, 'menu-goto-regex')[0])
    expect(events).toEqual(['open-tab:dust', 'open-tab:regex'])
    expect(errors).toEqual([])
    app.unmount()
  })

  it('篩選膠囊與搜尋:書籤膠囊只剩書籤組;搜尋「碑牌」只剩那一列;沒有符合 → 提示', async () => {
    reset()
    const { container, errors, app } = render()
    await settle()
    click(one(container, 'data-chip', 'bookmark'))
    await settle()
    expect(groups(container)).toEqual(['bookmarks'])
    expect(one(container, 'data-chip', 'bookmark').attrs['aria-pressed']).toBe('true')
    call(one(container, 'data-menu', 'search'), 'onInput', { target: { value: '碑牌' } })
    await settle()
    expect(findAll(container, byAttr('data-menu', 'bm-item')).map(n => n.attrs['data-bm'])).toEqual(['碑牌探險'])
    call(one(container, 'data-menu', 'search'), 'onInput', { target: { value: 'zzz不存在' } })
    await settle()
    expect(findAll(container, byAttr('data-menu', 'no-match'))).toHaveLength(1)
    expect(errors).toEqual([])
    app.unmount()
  })

  it('鍵盤:↓ 從第一列往下、End 到最後(拆粉排行)、Enter 執行', async () => {
    reset()
    const { container, errors, events, app } = render()
    await settle()
    key(container, 'ArrowDown')
    await settle()
    expect(selected(container)).toEqual(['scan:revealAutoEnabled'])
    key(container, 'ArrowDown')
    await settle()
    expect(selected(container)).toEqual(['scan:runeshapeEnabled'])
    key(container, 'End')
    await settle()
    expect(selected(container)).toEqual(['tool:dust'])
    key(container, 'Enter')
    expect(events).toEqual(['open-tab:dust'])
    expect(errors).toEqual([])
    app.unmount()
  })

  it('正則書籤:預設目前遊戲(PoE2),切 PoE1 改「點一下複製」;熱鍵顯示在列上', async () => {
    reset()
    const { container, errors, app } = render()
    await settle()
    let items = findAll(container, byAttr('data-menu', 'bm-item'))
    expect(items.map(n => n.attrs['data-bm'])).toEqual(['地圖一', '碑牌探險'])
    expect(text(items[0])).toContain('F6')
    expect(text(container)).toContain('目前遊戲 · 點一下貼進遊戲')
    click(one(container, 'data-game', 'poe1'))
    await settle()
    items = findAll(container, byAttr('data-menu', 'bm-item'))
    expect(items.map(n => n.attrs['data-bm'])).toEqual(['PoE1 書籤'])
    expect(text(container)).toContain('不是目前的遊戲 · 點一下複製')
    expect(errors).toEqual([])
    app.unmount()
  })

  it('速查表:工具列展開 → 內建 3.29 版縮圖;再點收起', async () => {
    reset()
    const { container, errors, app } = render()
    await settle()
    expect(findAll(container, byAttr('data-menu', 'sheet'))).toEqual([])
    click(byAction(container, 'menu-sheet')[0])
    await settle()
    expect(errors).toEqual([])
    expect(text(one(container, 'data-menu', 'sheet-name'))).toBe('內建 3.29 版')
    expect(byAction(container, 'sheet-remove')).toEqual([])
    const img = findAll(one(container, 'data-menu', 'sheet'), (n: MiniNode) => n.tag === 'img')[0]
    expect(String(img.attrs.src)).toMatch(/cheatsheets\/syndicate-3\.29\.webp$/)
    click(byAction(container, 'menu-sheet')[0])
    await settle()
    expect(findAll(container, byAttr('data-menu', 'sheet'))).toEqual([])
    app.unmount()
  })

  it('辨識開關依目前遊戲:PoE2 褻瀆 / 符文、PoE1 倉庫價格 / 格子名稱;點了寫入設定、標開 / 關', async () => {
    const config = AppConfig()
    const saved = { game: config.game, reveal: config.revealAutoEnabled, rune: config.runeshapeEnabled, stash: config.stashPricesEnabled, names: config.stashShowNames }
    try {
      config.game = 'poe2'
      config.runeshapeEnabled = false
      reset()
      let r = render()
      await settle()
      let sw = findAll(r.container, byAttr('role', 'switch'))
      expect(sw.map(n => n.attrs['data-toggle'])).toEqual(['revealAutoEnabled', 'runeshapeEnabled'])
      expect(text(r.container)).toContain('自動辨識 · PoE2')
      expect(sw[1].attrs['aria-checked']).toBe('false')
      click(sw[1])
      await settle()
      expect(config.runeshapeEnabled).toBe(true)
      sw = findAll(r.container, byAttr('role', 'switch'))
      expect(sw[1].attrs['aria-checked']).toBe('true')
      expect(text(sw[1])).toContain('開')
      r.app.unmount()

      config.game = 'poe1'
      config.stashShowNames = true
      r = render()
      await settle()
      sw = findAll(r.container, byAttr('role', 'switch'))
      expect(sw.map(n => n.attrs['data-toggle'])).toEqual(['stashPricesEnabled', 'stashShowNames'])
      expect(text(r.container)).toContain('自動辨識 · PoE1')
      // PoE1 倉庫本頁價值是佔位(讀數量功能還沒做)
      expect(text(one(r.container, 'data-menu', 'stash'))).toContain('讀取數量功能完成後提供')
      click(sw[1])
      await settle()
      expect(config.stashShowNames).toBe(false)
      expect(r.errors).toEqual([])
      r.app.unmount()
    } finally {
      Object.assign(config, { game: saved.game, revealAutoEnabled: saved.reveal, runeshapeEnabled: saved.rune, stashPricesEnabled: saved.stash, stashShowNames: saved.names })
    }
  })
})

describe('F6 市況列', () => {
  const ninjaRequests = () => ((globalThis as Record<string, unknown>).__requests as Array<{ url: string }>).filter(r => r.url.includes('poe.ninja'))

  it('台服(target null)→ 尚無資料 + 台服說明,不上網', async () => {
    const config = AppConfig()
    try {
      config.realm = 'tw'
      reset()
      const before = ninjaRequests().length
      const { container, errors, app } = render()
      await settle()
      const market = one(container, 'data-menu', 'market')
      expect(market.attrs['data-state']).toBe('none')
      expect(text(market)).toContain('尚無資料')
      expect(text(market)).toContain('台服沒有 poe.ninja 價格')
      expect(ninjaRequests().length).toBe(before)
      expect(errors).toEqual([])
      app.unmount()
    } finally {
      config.realm = 'intl'
    }
    // 原始碼守門:選單絕不觸發 poe.ninja 抓價(第 30.8 步閒置降耗)
    const src = fs.readFileSync(path.join(ROOT, 'renderer/src/web/overlay/FloatMenu.vue'), 'utf8')
    expect(src).not.toContain('queuePricesFetch')
    expect(src).not.toMatch(/\.load\(\s*true\s*\)/)
  })

  it('國際服有快取:1 神聖石 = 611 崇高石 + 走勢圖(崇高列反算 +25.3%);仍不上網', async () => {
    AppConfig().game = 'poe2'
    await useLeagues().load()
    await settle()
    reset()
    const before = ninjaRequests().length
    const { container, errors, app } = render()
    await settle(60)
    const market = one(container, 'data-menu', 'market')
    expect(market.attrs['data-state']).toBe('ok')
    expect(text(market)).toMatch(/1 神聖石 = 611 崇高石/)
    expect(findAll(market, byAttr('data-sparkline'))).toHaveLength(1)
    expect(text(market)).toContain('+25.3%')
    expect(ninjaRequests().length).toBe(before)
    expect(errors).toEqual([])
    app.unmount()
  })
})

describe('F8 聯盟切換與限流點', () => {
  it('換聯盟寫入設定 leagueId', async () => {
    const config = AppConfig()
    const saved = config.leagueId
    try {
      reset()
      const { container, errors, app } = render()
      await settle()
      const sel = one(container, 'data-menu', 'league')
      expect(sel.tag).toBe('select')
      call(sel, 'onChange', { target: { value: 'Standard' } })
      expect(config.leagueId).toBe('Standard')
      expect(errors).toEqual([])
      app.unmount()
    } finally {
      config.leagueId = saved
    }
  })

  it('429 等待中:限流點變 wait 並顯示秒數', async () => {
    reset()
    const { container, app } = render()
    await settle()
    expect(one(container, 'data-menu', 'rate').attrs['data-tone']).toBe('ok')
    Host.rateLimitWait.value = { seconds: 9, seq: Host.rateLimitWait.value.seq + 1 }
    await settle()
    const dot = one(container, 'data-menu', 'rate')
    expect(dot.attrs['data-tone']).toBe('wait')
    expect(text(dot)).toMatch(/[89]s/)
    Host.rateLimitWait.value = { seconds: 0, seq: Host.rateLimitWait.value.seq + 1 }
    app.unmount()
  })

  it('PoE1 交易站有請求在排隊:限流點變 busy', async () => {
    const config = AppConfig()
    const savedGame = config.game
    try {
      config.game = 'poe1'
      reset()
      const { container, app } = render()
      await settle()
      expect(one(container, 'data-menu', 'rate').attrs['data-tone']).toBe('ok')
      // 每條規則 1 / 5 秒:第一次借走額度、第二次排隊(5 秒後自己放行,不送任何請求)
      const rl = [...tradeSession(config.realm).limits.SEARCH][0]
      void rl.wait()
      void rl.wait()
      await settle()
      expect(one(container, 'data-menu', 'rate').attrs['data-tone']).toBe('busy')
      app.unmount()
    } finally {
      config.game = savedGame
    }
  })
})
