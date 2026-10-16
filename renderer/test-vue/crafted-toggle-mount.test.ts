/**
 * 查價面板「一般 / 工藝」二選一(PoE2):FilterModifier 真掛載(每條可見 filter 一個,整份 stats 經 FRACTURED_FILTERS_KEY provide)。
 * 工藝來源的詞綴列出現 data-action=crafted-toggle 的二選一,選工藝 → 改送 crafted id、孿生取消勾選;隨機詞綴列不輸出。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig } from '../src/web/Config'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import Poe2FilterModifier from '../../poe2/src/web/price-check/filters/FilterModifier.vue'
import { FRACTURED_FILTERS_KEY } from '../../poe2/src/web/price-check/filters/fractured-toggle'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe2/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'cmn-Hant' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

// 使用者實際物品(繁中進階格式):第四條是工藝詞綴
const JEWEL = `物品種類: 珠寶
稀有度: 稀有
海怪 裂毀者
藍寶石
--------
物品等級: 80
--------
{ 前綴 "專注的"(階層：1) — 能量護盾 }
增加36(30-50)%來自已裝備法器的能量護盾
{ 前綴 "麻木的"(階層：1) — 傷害,元素,冰冷 }
傷害穿透5(5-10)%冰冷抗性
{ 後綴 "強力之"(階層：1) — 傷害,暴擊 }
增加14(10-20)%暴擊傷害加成
{ 已工藝 後綴 "奪位之"(階層：1) — 傷害,法術,暴擊 }
增加20(10-20)%法術暴擊傷害加成
--------
放置到一個天賦樹的珠寶插槽中以產生效果。右鍵點擊以移出插槽。
--------
備註: ~b/o 28 chaos
`
const SPELL_CRIT = '#% increased Critical Spell Damage Bonus'

beforeAll(async () => {
  await initConfig()
  await Poe2.poe2Adapter.loadData(poe2DataSource(path.join(ROOT, 'data/poe2')), 'cmn-Hant')
}, 300_000)

function click (n: MiniNode) {
  const fn = n.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, detail: 1 })
}

const groups = (c: MiniNode) => findAll(c, byAttr('data-action', 'crafted-toggle'))
const choice = (g: MiniNode, v: 'normal' | 'crafted') => findAll(g, byAttr('data-choice', v))[0]
const pressed = (g: MiniNode) => findAll(g, (n: MiniNode) => n.attrs['aria-pressed'] === 'true').map(n => n.attrs['data-choice'])

describe('一般 / 工藝二選一掛載(PoE2)', () => {
  it('工藝詞綴列有二選一,選工藝改送 crafted id、孿生取消勾選;隨機詞綴列不輸出', async () => {
    const parsed = Poe2.parseClipboard(JEWEL)
    if (parsed.isErr()) throw new Error(String(parsed.error))
    const item = parsed.value
    const { presets, active } = Poe2.createPresets(item, OPTS)
    const preset = presets.find(p => p.id === active)!
    const stats = reactive(preset.stats) as any[]
    const twin = stats.find(f => !f.group && f.tag === 'crafted' && f.statRef === SPELL_CRIT)!
    expect(twin).toBeDefined()
    twin.disabled = false
    const visible = stats.filter(f => !f.group && f.hidden == null)
    const row = visible.find(f => f.statRef === SPELL_CRIT && f.tag === 'explicit')!
    const rowIdx = visible.indexOf(row)

    const errors: unknown[] = []
    const warnings: string[] = []
    const Root = defineComponent({
      setup () {
        provide(FRACTURED_FILTERS_KEY as never, (() => stats) as never)
        return () => h('div', visible.map((f, i) => h('div', { key: i, 'data-row': String(i) }, [h(Poe2FilterModifier as never, { filter: f, item, showSources: false })])))
      }
    })
    const { container, app } = mount(Root, [i18nPlugin()], (a) => {
      a.config.errorHandler = (err) => { errors.push(err) }
      a.config.warnHandler = (msg) => { warnings.push(msg) }
    })
    await nextTick()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])

    // 只有工藝那一列有二選一
    const gs = groups(container)
    expect(gs).toHaveLength(1)
    const rowGroup = () => groups(findAll(container, byAttr('data-row', String(rowIdx)))[0])[0]
    expect(rowGroup()).toBeDefined()
    expect(rowGroup().attrs.role).toBe('group')
    expect(text(choice(rowGroup(), 'normal')).length).toBeGreaterThan(0)
    expect(text(choice(rowGroup(), 'crafted')).length).toBeGreaterThan(0)
    expect(pressed(rowGroup())).toEqual(['normal'])

    click(choice(rowGroup(), 'crafted'))
    await nextTick()
    expect(pressed(rowGroup())).toEqual(['crafted'])
    expect(row.tradeId).toEqual(['crafted.stat_274716455'])
    expect(row.disabled).toBe(false)
    expect(twin.disabled).toBe(true)

    click(choice(rowGroup(), 'normal'))
    await nextTick()
    expect(pressed(rowGroup())).toEqual(['normal'])
    expect(row.tradeId).toEqual(['explicit.stat_274716455'])
    app.unmount()
  })
})
