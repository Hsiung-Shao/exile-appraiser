/**
 * 查價面板統一「機制」分段按鈕(計畫 rustling-shimmying-charm M13):兩代 FilterModifier 真掛載(每條可見 filter 一個,整份 stats 經 FRACTURED_FILTERS_KEY provide)。
 * 有其他機制的詞綴列出現 data-action=mechanism 的分段按鈕,點選後 tradeId 換成該機制 id;pseudo 等只有一般的列不輸出。
 * 取代 crafted-toggle-mount.test.ts(工藝二選一由本元件接手)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig, AppConfig } from '../src/web/Config'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter, createPresets as poe1CreatePresets } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import Poe1FilterModifier from '../../poe1/src/web/price-check/filters/FilterModifier.vue'
import { FRACTURED_FILTERS_KEY as POE1_KEY } from '../../poe1/src/web/price-check/filters/fractured-toggle'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import Poe2FilterModifier from '../../poe2/src/web/price-check/filters/FilterModifier.vue'
import { FRACTURED_FILTERS_KEY as POE2_KEY } from '../../poe2/src/web/price-check/filters/fractured-toggle'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const readI18n = (lang: string) => JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
// 字串還沒加時 vue-i18n 回鍵名本身(字串是否齊全由 mechanism-i18n.test.ts 守)
const label = (v: string): string => readI18n('cmn-Hant').ppz?.mechanism?.[v] ?? `ppz.mechanism.${v}`

function i18nPlugin (game: 'poe1' | 'poe2') {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/${game}/${lang}/app_i18n.json`), 'utf8')),
    ...readI18n(lang)
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const opts = (clientLanguage: 'en' | 'cmn-Hant') => ({
  league: 'Standard', realm: 'intl' as const, clientLanguage, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
})

// PoE1:破裂生命(可見 explicit 列)+ 工藝冰冷抗性
const POE1_RING = fs.readFileSync(path.join(ROOT, 'poe1/test/fixtures/en/ring-rare-01.txt'), 'utf8').replace(/\r\n/g, '\n')
// PoE2:使用者胸甲(精魂列可見;偽屬性合計列可見)
const POE2_CHEST = `物品種類: 胸甲
稀有度: 稀有
末日的 真實之衛
惡徒護甲
--------
品質: +9% (augmented)
護甲值: 558 (augmented)
閃避值: 511 (augmented)
--------
需求: 等級 65, 67 力量, 67 敏捷
--------
插槽: S S
--------
物品等級: 82
--------
增加36%護甲值、閃避和能量護盾 (rune)
--------
{ 固定詞綴 — 生命 }
+72(60-80)最大生命
--------
{ 前綴 "運動員的"(階層：5) — 生命 }
+139(120-149)最大生命
{ 前綴 "淑女的"(階層：8) }
+31(30-33)精魂
{ 前綴 "老兵的"(階層：4) — 護甲,閃避 }
+17(17-23)護甲值
+17(15-21)閃避值
增加24(21-26)%護甲值和閃避
{ 後綴 "北極熊之"(階層：3) — 元素,冰冷,抗性 }
+34(31-35)%冰冷抗性
{ 後綴 "電之"(階層：2) — 元素,閃電,抗性 }
+40(36-40)%閃電抗性
{ 已工藝 後綴 "火山之"(階層：3) — 元素,火焰,抗性 }
+34(31-35)%火焰抗性
`

beforeAll(async () => {
  await initConfig()
  // 2026-10-16:機制按鈕改由「機制」開關控制(預設關),本檔測按鈕行為 → 先打開開關
  ;(AppConfig('price-check') as any).showMechanism = true
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  await Poe2.poe2Adapter.loadData(poe2DataSource(path.join(ROOT, 'data/poe2')), 'cmn-Hant')
}, 300_000)

function click (n: MiniNode) {
  const fn = n.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, detail: 1 })
}

const groups = (c: MiniNode) => findAll(c, byAttr('data-action', 'mechanism'))
const choices = (g: MiniNode) => findAll(g, (n: MiniNode) => n.attrs['data-choice'] != null).map(n => String(n.attrs['data-choice']))
const choice = (g: MiniNode, v: string) => findAll(g, byAttr('data-choice', v))[0]
const pressed = (g: MiniNode) => findAll(g, (n: MiniNode) => n.attrs['aria-pressed'] === 'true').map(n => n.attrs['data-choice'])

function renderRows (game: 'poe1' | 'poe2', comp: unknown, key: symbol, item: unknown, stats: any[], visible: any[]) {
  const errors: unknown[] = []
  const warnings: string[] = []
  const Root = defineComponent({
    setup () {
      provide(key as never, (() => stats) as never)
      return () => h('div', visible.map((f, i) => h('div', { key: i, 'data-row': String(i) }, [h(comp as never, { filter: f, item, showSources: false })])))
    }
  })
  const { container, app } = mount(Root, [i18nPlugin(game)], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  const rowGroup = (i: number) => groups(findAll(container, byAttr('data-row', String(i)))[0])[0] as MiniNode | undefined
  return { container, app, errors, warnings, rowGroup }
}

describe('機制分段按鈕掛載', () => {
  it('PoE2:精魂列有一般 / 破裂 / 工藝 / 褻瀆 / 增幅,點褻瀆改送 desecrated id、點一般送回;偽屬性列不輸出', async () => {
    const parsed = Poe2.parseClipboard(POE2_CHEST)
    if (parsed.isErr()) throw new Error(String(parsed.error))
    const item = parsed.value
    const { presets, active } = Poe2.createPresets(item, opts('cmn-Hant'))
    const preset = presets.find(p => p.id === active)!
    const stats = reactive(preset.stats) as any[]
    const visible = stats.filter(f => f.hidden == null && f.tag !== 'property')
    const spirit = visible.find(f => f.statRef === '# to Spirit')!
    expect(spirit).toBeDefined()
    const spiritIdx = visible.indexOf(spirit)
    const pseudoIdx = visible.map((f, i) => [f, i] as const).filter(([f]) => f.tag === 'pseudo').map(([, i]) => i)
    expect(pseudoIdx.length).toBeGreaterThan(0)

    const { app, errors, warnings, rowGroup } = renderRows('poe2', Poe2FilterModifier, POE2_KEY as symbol, item, stats, visible)
    await nextTick()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    for (const i of pseudoIdx) expect(rowGroup(i), '偽屬性列不應有機制按鈕').toBeUndefined()

    const g = () => rowGroup(spiritIdx)!
    expect(rowGroup(spiritIdx), '精魂列應有機制按鈕').toBeDefined()
    expect(g().attrs.role).toBe('group')
    expect(choices(g())).toEqual(['normal', 'fractured', 'crafted', 'desecrated', 'rune'])
    for (const v of choices(g())) expect(text(choice(g(), v))).toBe(label(v))
    expect(pressed(g())).toEqual(['normal'])

    click(choice(g(), 'desecrated'))
    await nextTick()
    expect(pressed(g())).toEqual(['desecrated'])
    expect(spirit.tradeId.length).toBeGreaterThan(0)
    expect(spirit.tradeId.every((id: string) => id.startsWith('desecrated.'))).toBe(true)
    expect(spirit.disabled).toBe(false)

    click(choice(g(), 'normal'))
    await nextTick()
    expect(pressed(g())).toEqual(['normal'])
    expect(spirit.tradeId.every((id: string) => id.startsWith('explicit.'))).toBe(true)
    app.unmount()
  })

  it('PoE1:破裂生命列有不限 / 一般 / 破裂 / 工藝,點工藝改送 crafted id;偽屬性列不輸出', async () => {
    const item = poe1Parse(POE1_RING)._unsafeUnwrap()
    const { presets, active } = poe1CreatePresets(item, opts('en'))
    const preset = presets.find(p => p.id === active)!
    const stats = reactive(preset.stats.filter(s => !s.group)) as any[]
    const visible = stats.filter(f => f.hidden == null)
    const life = visible.find(f => f.statRef === '+# to maximum Life' && f.tag !== 'pseudo')!
    expect(life).toBeDefined()
    const lifeIdx = visible.indexOf(life)
    const pseudoIdx = visible.map((f, i) => [f, i] as const).filter(([f]) => f.tag === 'pseudo').map(([, i]) => i)
    expect(pseudoIdx.length).toBeGreaterThan(0)

    const { app, errors, warnings, rowGroup } = renderRows('poe1', Poe1FilterModifier, POE1_KEY as symbol, item, stats, visible)
    await nextTick()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    for (const i of pseudoIdx) expect(rowGroup(i), '偽屬性列不應有機制按鈕').toBeUndefined()

    const g = () => rowGroup(lifeIdx)!
    expect(rowGroup(lifeIdx), '生命列應有機制按鈕').toBeDefined()
    expect(choices(g())).toEqual(['any', 'normal', 'fractured', 'crafted'])
    expect(pressed(g())).toEqual(['any'])

    click(choice(g(), 'crafted'))
    await nextTick()
    expect(pressed(g())).toEqual(['crafted'])
    expect(life.tradeId).toEqual(['crafted.stat_3299347043'])
    expect(life.disabled).toBe(false)
    app.unmount()
  })

  it('兩代 FilterModifier 接上機制元件、PoE2 不再接工藝二選一', () => {
    for (const game of ['poe1', 'poe2']) {
      const dir = path.join(ROOT, `${game}/src/web/price-check/filters`)
      const mod = fs.readFileSync(path.join(dir, 'FilterModifier.vue'), 'utf8')
      expect(mod).toMatch(/import FilterModifierMechanism from ["']\.\/FilterModifierMechanism\.vue["']/)
      expect(mod).toContain('<filter-modifier-mechanism')
      expect(mod).not.toContain('FilterModifierCrafted')
    }
  })
})
