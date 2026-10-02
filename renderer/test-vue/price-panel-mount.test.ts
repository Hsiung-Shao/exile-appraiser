/**
 * 2026-10-03 使用者回報「PoE2 查價某些物品面板一片空白」的回歸測試:三件真實複製文字(poe2/test/zhTW/fixtures/cmn-Hant/
 * jewel-unique-{unid-sapphire,grand-spectrum,unid-ruby}-01.txt)掛進與 App.vue 相同的查價區結構
 * (ErrorBoundary > UnidentifiedResolver + CheckedItem),元件不得拋錯、面板不得空白。
 *
 * 根因:未鑑定傳奇(A / C)時 PoE2 CheckedItem 的 `noUniqueSelection` 整塊不畫,上游靠 PriceCheckWindow.vue 的
 * UnidentifiedResolver 先選傳奇,本專案移植時沒掛 → 標題列下面什麼都沒有,也沒有任何錯誤。
 * 另外驗 ErrorBoundary:子元件拋錯 → 畫錯誤框 + `[renderer-error]` 帶堆疊寫進 log(console → main log)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { ok } from 'neverthrow'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource } from '../../poe2/src/assets/data/node-source'
import { initConfig, AppConfig } from '../src/web/Config'
import { Host } from '../src/web/background/IPC'
import ErrorBoundary from '../src/web/ui/ErrorBoundary.vue'
// 同一個檔案(poe2 的 `@/web/price-check/trade/common`):每個案例重設限流狀態,不讓前一件的請求擋住下一件
import { resetTradeSessions } from '../../poe2/src/web/price-check/trade/common'
import { mount, text, findAll, byAttr } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const FIXTURES = path.join(ROOT, 'poe2/test/zhTW/fixtures/cmn-Hant')
const readFixture = (name: string) => fs.readFileSync(path.join(FIXTURES, `${name}.txt`), 'utf8')
const requests = (globalThis as unknown as { __requests: Array<{ method: string, url: string, body?: string }> }).__requests

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe2/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({
    legacy: false,
    locale: 'cmn-Hant',
    fallbackLocale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') }
  })
}

const settle = async (ms = 50) => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise(resolve => setTimeout(resolve, ms))
  for (let i = 0; i < 5; i++) await nextTick()
}

/** 與 App.vue 查價區相同的結構(ErrorBoundary > UnidentifiedResolver + CheckedItem;onIdentify 換掉物品) */
function panel (clipboard: string) {
  const parsed = Poe2.parseClipboard(clipboard)
  if (parsed.isErr()) throw new Error(`解析失敗:${parsed.error}`)
  const item = shallowRef(parsed.value)
  const identified: unknown[] = []
  const Root = defineComponent({
    setup () {
      provide('builtin-browser', () => {}) // App.vue 同樣 provide(openTradeSite)
      return () => h(ErrorBoundary, { resetKey: 1, where: 'test' }, {
        default: () => [
          h(Poe2.UnidentifiedResolver, {
            key: 'u1',
            item: item.value,
            onIdentify: (next: Poe2.Poe2ParsedItem) => { identified.push(next); item.value = ok(next).value }
          }),
          h(Poe2.CheckedItem, { key: 1, item: item.value, advancedCheck: true })
        ]
      })
    }
  })
  const errors: unknown[] = []
  const warnings: string[] = []
  const { app, container } = mount(Root, [i18nPlugin()], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, errors, warnings, identified, item, app }
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  await initConfig()
  await Poe2.poe2Adapter.loadData(nodeDataSource(path.join(ROOT, 'data/poe2')), 'cmn-Hant')
  const ctx = () => ({ http: Host.httpFetch, realm: AppConfig().realm, latencySeconds: 0, accountName: undefined })
  Poe2.setTradeContextProvider(ctx)
  Poe2.setHostOptionsProvider(() => ({ uiLanguage: AppConfig().uiLanguage, itemHoverTooltip: 'off' as const }))
}, 300_000)

afterEach(() => {
  consoleError?.mockRestore()
  resetTradeSessions()
})

function spyErrors () {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => consoleError.mock.calls.map(c => c.map(String).join(' '))
}

describe('未鑑定傳奇珠寶(使用者回報 A / C)', () => {
  for (const [name, base, baseZh] of [
    ['jewel-unique-unid-sapphire-01', 'Sapphire', '藍寶石'],
    ['jewel-unique-unid-ruby-01', 'Ruby', '紅寶石']
  ] as const) {
    it(`${name}:不再空白,列出可能的傳奇;選定後顯示篩選並以傳奇名 + 基底 + 未鑑定查詢`, async () => {
      const logged = spyErrors()
      const { container, errors, warnings, identified, app } = panel(readFixture(name))
      await settle()
      const before = text(container)
      expect(before, '面板不得空白').not.toBe('')
      expect(before).toContain(baseZh)
      expect(before).toContain('是哪一個')
      const buttons = findAll(container, n => n.tag === 'button' && typeof n.attrs.onClick === 'function')
      expect(buttons.length, '至少一個可能的傳奇').toBeGreaterThanOrEqual(1)
      expect(before).toContain('巨光譜') // 兩個基底都有 Grand Spectrum

      // 選第一個(= 上游 select:物品換成那個傳奇的 info,其餘不動)
      const requestsBefore = requests.length
      ;(buttons[0].attrs.onClick as () => void)()
      await settle(1500)
      expect(identified).toHaveLength(1)
      const after = text(container)
      expect(after).not.toContain('是哪一個')
      expect(after).toContain('未鑑定') // 篩選列:未鑑定
      const search = requests.slice(requestsBefore).find(r => r.method === 'POST' && r.url.includes('/api/trade2/search/'))
      expect(search, '選定後自動查價(鎖定查價的傳奇一律自動搜尋)').toBeTruthy()
      const query = JSON.parse(search!.body!)
      expect(query.query.type).toBe(base)
      expect(query.query.name).toMatch(/^[\x20-\x7e]+$/) // 國際服送英文名
      expect(query.query.filters.misc_filters.filters.identified).toEqual({ option: 'false' })
      expect(errors).toEqual([])
    expect(warnings, 'Vue 警告').toEqual([])
      expect(warnings, 'Vue 警告').toEqual([])
      expect(logged().filter(l => l.includes('[renderer-error]'))).toEqual([])
      expect(findAll(container, byAttr('data-error', 'component'))).toEqual([])
      app.unmount()
    })
  }
})

describe('已鑑定、已汙染傳奇珠寶(使用者回報 B)', () => {
  it('jewel-unique-grand-spectrum-01:物品名、篩選、查詢結果都畫出來,沒有錯誤', async () => {
    const logged = spyErrors()
    const requestsBefore = requests.length
    const { container, errors, warnings, identified, app } = panel(readFixture('jewel-unique-grand-spectrum-01'))
    await settle(1500)
    const out = text(container)
    expect(identified).toEqual([]) // 已鑑定:不顯示選擇列
    expect(out).not.toContain('是哪一個')
    expect(out).toContain('巨光譜')
    expect(out).toContain('已汙染')
    const search = requests.slice(requestsBefore).find(r => r.method === 'POST' && r.url.includes('/api/trade2/search/'))
    expect(search).toBeTruthy()
    expect(JSON.parse(search!.body!).query).toMatchObject({ name: 'Grand Spectrum', type: 'Emerald' })
    expect(requests.slice(requestsBefore).some(r => r.url.includes('/api/trade2/fetch/'))).toBe(true)
    expect(out).toMatch(/regal|alch/) // 錄製的結果列
    expect(errors).toEqual([])
    expect(warnings, 'Vue 警告').toEqual([])
    expect(logged().filter(l => l.includes('[renderer-error]'))).toEqual([])
    app.unmount()
  })
})

describe('ErrorBoundary', () => {
  const Boom = defineComponent({
    props: { when: { type: String, required: true } },
    setup (props) {
      if (props.when === 'setup') throw new TypeError('boom in setup')
      return () => { if (props.when === 'render') throw new TypeError('boom in render'); return h('p', 'fine') }
    }
  })

  for (const when of ['setup', 'render'] as const) {
    it(`子元件在 ${when} 拋錯 → 錯誤框(只顯示第一個錯誤)+ [renderer-error] 帶元件路徑與堆疊`, async () => {
      const logged = spyErrors()
      const { container, app } = mount(defineComponent({
        setup: () => () => h(ErrorBoundary, { resetKey: 1, where: 'test' }, { default: () => [h('h1', 'kept?'), h(Boom, { when })] })
      }), [i18nPlugin()])
      await settle()
      const box = findAll(container, byAttr('data-error', 'component'))
      expect(box).toHaveLength(1)
      expect(text(box[0])).toContain(`TypeError: boom in ${when}`)
      expect(text(box[0])).toContain('查價面板發生錯誤')
      expect(text(container)).not.toContain('kept?') // 出錯時整塊換成錯誤框
      const lines = logged().filter(l => l.includes('[renderer-error]'))
      expect(lines.length).toBeGreaterThanOrEqual(1)
      expect(lines[0]).toMatch(new RegExp(`\\[renderer-error\\] test .*ErrorBoundary.*TypeError: boom in ${when}`))
      expect(lines[0]).toMatch(/\n {4}at /) // 堆疊
      app.unmount()
    })
  }

  it('沒有錯誤時原樣畫出內容,不多包任何元素', async () => {
    const { container, app } = mount(defineComponent({
      setup: () => () => h(ErrorBoundary, { resetKey: 1 }, { default: () => [h('h1', 'a'), h('p', 'b')] })
    }), [i18nPlugin()])
    await settle()
    // Fragment 的頭尾錨點是空文字節點(真 DOM 也一樣),不算包裝元素
    expect(container.children.filter(c => !(c.tag === '#text' && c.text === '')).map(c => c.tag)).toEqual(['h1', 'p'])
    app.unmount()
  })

  it('換物品(resetKey 變了)清掉錯誤重畫', async () => {
    spyErrors()
    const key = shallowRef(1)
    const when = shallowRef<'render' | 'none'>('render')
    const { container, app } = mount(defineComponent({
      setup: () => () => h(ErrorBoundary, { resetKey: key.value }, { default: () => [h(Boom, { when: when.value })] })
    }), [i18nPlugin()])
    await settle()
    expect(findAll(container, byAttr('data-error', 'component'))).toHaveLength(1)
    when.value = 'none'
    key.value = 2
    await settle()
    expect(findAll(container, byAttr('data-error', 'component'))).toEqual([])
    expect(text(container)).toBe('fine')
    app.unmount()
  })
})

describe('接線守門', () => {
  const app = fs.readFileSync(path.join(ROOT, 'renderer/src/web/App.vue'), 'utf8')
  it('App.vue 查價區包 ErrorBoundary,PoE2 掛 UnidentifiedResolver 並以 identify 換掉物品', () => {
    expect(app).toMatch(/<error-boundary v-else-if="parsed\?\.isOk\(\) && leagueId && supported" :reset-key="itemKey"/)
    expect(app).toMatch(/<component :is="unidentifiedResolverComponent"[^>]*@identify="onIdentify"/)
    expect(app).toContain("loadedGame.value === 'poe2' ? Poe2.UnidentifiedResolver : null")
    expect(app).toMatch(/onIdentify \(identified[^)]*\) \{[\s\S]*?parsed\.value = ok\(identified\)/)
  })
  it('renderer main.ts 裝了 Vue errorHandler 與 window 未捕捉錯誤記錄', () => {
    const main = fs.readFileSync(path.join(ROOT, 'renderer/src/main.ts'), 'utf8')
    expect(main).toContain('installWindowErrorLogging(window)')
    expect(main).toContain('installVueErrorHandler(app)')
  })
})
