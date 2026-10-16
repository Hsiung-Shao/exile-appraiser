/**
 * 2026-10-16 查價面板「原始詞綴」卡片(可折疊、預設收起)與底部「機制」開關(預設關):兩代 FiltersBlock 真掛載(R3–R7、R10)。
 * 呈現改動不影響查詢:收起 / 展開、開關切換前後 createTradeRequest 相同。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig, AppConfig } from '../src/web/Config'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter, createPresets as poe1CreatePresets } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import Poe1FiltersBlock from '../../poe1/src/web/price-check/filters/FiltersBlock.vue'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import Poe2FiltersBlock from '../../poe2/src/web/price-check/filters/FiltersBlock.vue'
import { selectMechanism } from '../../poe2/src/web/price-check/filters/mechanism-toggle'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const readI18n = (lang: string) => JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
// 字串還沒加時 vue-i18n 回鍵名本身(字串是否齊全由 raw-card.test.ts 守)
const RAW_TITLE: string = readI18n('cmn-Hant').ppz?.mod_cards?.raw ?? 'ppz.mod_cards.raw'

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

// 使用者胸甲(2026-10-16):被偽屬性 / 防禦合計吃掉的詞綴、符文詞綴都是新列出的原始詞綴
const CHEST = `物品種類: 胸甲
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
const POE1_RING = fs.readFileSync(path.join(ROOT, 'poe1/test/fixtures/en/ring-rare-01.txt'), 'utf8').replace(/\r\n/g, '\n')

beforeAll(async () => {
  await initConfig()
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  await Poe2.poe2Adapter.loadData(poe2DataSource(path.join(ROOT, 'data/poe2')), 'cmn-Hant')
}, 300_000)

const widget = () => AppConfig('price-check') as any
beforeEach(() => { widget().showMechanism = false })

function buildChest () {
  const parsed = Poe2.parseClipboard(CHEST)
  if (parsed.isErr()) throw new Error(String(parsed.error))
  const item = parsed.value
  const { presets, active } = Poe2.createPresets(item, opts('cmn-Hant'))
  return { item, preset: presets.find(p => p.id === active)! as any }
}

function buildRing () {
  const item = poe1Parse(POE1_RING)._unsafeUnwrap()
  const { presets, active } = poe1CreatePresets(item, opts('en'))
  return { item, preset: presets.find(p => p.id === active)! as any }
}

/** 掛 FiltersBlock;state 可整組替換(換物品) */
function renderBlock (game: 'poe1' | 'poe2', comp: unknown, built: { item: unknown, preset: any }) {
  const errors: unknown[] = []
  const warnings: string[] = []
  const mk = (b: { item: unknown, preset: any }) => ({
    item: b.item,
    preset: b.preset,
    stats: reactive(b.preset.stats) as any[],
    filters: reactive(b.preset.filters)
  })
  const state = shallowRef(mk(built))
  const Root = defineComponent({
    setup () {
      return () => h(comp as never, {
        presets: [{ id: state.value.preset.id, active: true }],
        filters: state.value.filters,
        stats: state.value.stats,
        item: state.value.item
      })
    }
  })
  const { container, app } = mount(Root, [i18nPlugin(game)], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return {
    container,
    app,
    errors,
    warnings,
    get stats () { return state.value.stats },
    swap (b: { item: unknown, preset: any }) { state.value = mk(b) }
  }
}

function click (n: MiniNode | undefined) {
  expect(n, '找不到要點的元素').toBeDefined()
  const fn = n!.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, detail: 1 })
}

const card = (c: MiniNode, id: string) => findAll(c, byAttr('data-card', id))[0] as MiniNode | undefined
const toggleOf = (cd: MiniNode | undefined) => (cd ? findAll(cd, byAttr('data-part', 'card-toggle'))[0] : undefined) as MiniNode | undefined
const switches = (c: MiniNode) => findAll(c, (n: MiniNode) => n.attrs.role === 'switch')
const mechGroups = (c: MiniNode) => findAll(c, byAttr('data-action', 'mechanism'))
const mechToggle = (c: MiniNode) => findAll(c, byAttr('data-action', 'mechanism-visible'))[0] as MiniNode | undefined
const rawRows = (stats: any[]) => stats.filter(s => !s.group && s.hidden == null && s.revealed && s.tag !== 'pseudo')

describe('原始詞綴卡(PoE2 胸甲)', () => {
  it('R3 原始詞綴卡預設收起、看不到列,點標題後展開出現原始詞綴列', async () => {
    const r = renderBlock('poe2', Poe2FiltersBlock, buildChest())
    await nextTick()
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    const expected = rawRows(r.stats).length
    expect(expected).toBeGreaterThan(0)
    const raw = card(r.container, 'raw')
    expect(raw, '應有 data-card="raw" 的卡').toBeDefined()
    expect(text(raw!)).toContain(RAW_TITLE)
    const tg = toggleOf(raw)
    expect(tg, '原始詞綴卡標題應是 card-toggle 按鈕').toBeDefined()
    expect(tg!.tag).toBe('button')
    expect(tg!.attrs['aria-expanded']).toBe('false')
    expect(switches(raw!)).toHaveLength(0)
    expect(findAll(raw!, byAttr('data-part', 'card-count')).length).toBe(1)

    click(tg)
    await nextTick()
    const raw2 = card(r.container, 'raw')!
    expect(toggleOf(raw2)!.attrs['aria-expanded']).toBe('true')
    expect(switches(raw2)).toHaveLength(expected)
    r.app.unmount()
  })

  it('R3 原始詞綴卡在詞綴卡與偽屬性卡之間,原始詞綴列不在詞綴卡', async () => {
    const r = renderBlock('poe2', Poe2FiltersBlock, buildChest())
    await nextTick()
    const order = findAll(r.container, (n: MiniNode) => n.attrs['data-card'] != null).map(n => n.attrs['data-card'])
    expect(order).toEqual(['mods', 'raw', 'pseudo'])
    const visibleNonRaw = r.stats.filter(s => s.hidden == null && !s.revealed && s.tag !== 'pseudo')
    expect(switches(card(r.container, 'mods')!)).toHaveLength(visibleNonRaw.length)
    r.app.unmount()
  })

  it('R4 展開後換物品,原始詞綴卡回到收起', async () => {
    const r = renderBlock('poe2', Poe2FiltersBlock, buildChest())
    await nextTick()
    click(toggleOf(card(r.container, 'raw')))
    await nextTick()
    expect(toggleOf(card(r.container, 'raw'))?.attrs['aria-expanded']).toBe('true')
    r.swap(buildChest())
    await nextTick()
    await nextTick()
    expect(toggleOf(card(r.container, 'raw'))?.attrs['aria-expanded']).toBe('false')
    expect(switches(card(r.container, 'raw')!)).toHaveLength(0)
    r.app.unmount()
  })
})

describe('機制開關(PoE2 胸甲)', () => {
  it('R5 開關預設關:詞綴卡與展開後的原始詞綴卡都沒有機制按鈕', async () => {
    const r = renderBlock('poe2', Poe2FiltersBlock, buildChest())
    await nextTick()
    expect(widget().showMechanism).toBe(false)
    const tg = mechToggle(r.container)
    expect(tg, '底部應有 data-action="mechanism-visible" 的開關').toBeDefined()
    click(toggleOf(card(r.container, 'raw')))
    await nextTick()
    expect(mechGroups(r.container)).toHaveLength(0)
    r.app.unmount()
  })

  it('R6 打開機制開關後出現機制按鈕,並寫入設定 showMechanism', async () => {
    const r = renderBlock('poe2', Poe2FiltersBlock, buildChest())
    await nextTick()
    click(mechToggle(r.container))
    await nextTick()
    expect(widget().showMechanism).toBe(true)
    expect(mechGroups(r.container).length).toBeGreaterThan(0)
    click(mechToggle(r.container))
    await nextTick()
    expect(widget().showMechanism).toBe(false)
    expect(mechGroups(r.container)).toHaveLength(0)
    r.app.unmount()
  })

  it('R7 開關關著時,非一般模式的列仍顯示機制按鈕、其他列不顯示', async () => {
    const built = buildChest()
    const stats = built.preset.stats as any[]
    const spirit = stats.find(s => s.statRef === '# to Spirit' && s.hidden == null && s.tag !== 'pseudo')
    expect(spirit).toBeDefined()
    selectMechanism(stats, spirit, 'crafted')
    expect(spirit.tradeId.every((id: string) => id.startsWith('crafted.'))).toBe(true)
    const r = renderBlock('poe2', Poe2FiltersBlock, built)
    await nextTick()
    const gs = mechGroups(r.container)
    expect(gs).toHaveLength(1)
    expect(findAll(gs[0], (n: MiniNode) => n.attrs['aria-pressed'] === 'true').map(n => n.attrs['data-choice'])).toEqual(['crafted'])
    r.app.unmount()
  })
})

describe('R10 查詢不受呈現影響', () => {
  it('展開 / 收起原始詞綴卡、切換機制開關前後,預設查詢完全相同', async () => {
    const built = buildChest()
    const before = JSON.stringify(Poe2.createTradeRequest(built.preset, built.item as any))
    const fresh = buildChest()
    expect(JSON.stringify(Poe2.createTradeRequest(fresh.preset, fresh.item as any))).toBe(before)
    const r = renderBlock('poe2', Poe2FiltersBlock, built)
    await nextTick()
    click(toggleOf(card(r.container, 'raw')))
    await nextTick()
    click(mechToggle(r.container))
    await nextTick()
    click(mechToggle(r.container))
    await nextTick()
    click(toggleOf(card(r.container, 'raw')))
    await nextTick()
    expect(JSON.stringify(Poe2.createTradeRequest(built.preset, built.item as any))).toBe(before)
    r.app.unmount()
  })
})

describe('PoE1 原始詞綴卡', () => {
  it('PoE1 戒指(被偽屬性吃掉的工藝冰冷抗性等)有收起的原始詞綴卡與機制開關', async () => {
    const r = renderBlock('poe1', Poe1FiltersBlock, buildRing())
    await nextTick()
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(rawRows(r.stats).length).toBeGreaterThan(0)
    const raw = card(r.container, 'raw')
    expect(raw, '應有 data-card="raw" 的卡').toBeDefined()
    expect(toggleOf(raw)?.attrs['aria-expanded']).toBe('false')
    expect(mechToggle(r.container), '底部應有機制開關').toBeDefined()
    click(toggleOf(raw))
    await nextTick()
    expect(switches(card(r.container, 'raw')!)).toHaveLength(rawRows(r.stats).length)
    r.app.unmount()
  })
})
