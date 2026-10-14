/**
 * 查價面板「一般 / 破裂」二選一(2026-10-14;B 改版由單一切換鈕改成二選一):兩代 FilterModifierFractured 真掛載(每條 filter 一個,與 FilterModifier 掛法相同)。
 * 破裂詞綴那列有二選一,選破裂 → aria-pressed 移到「破裂」、filter 改送 fractured id、隱藏孿生取消勾選;選一般 → 送回 explicit;非破裂列不輸出。
 * ⚠ 不掛整個 FilterModifier:數值輸入框的 v-model 要 addEventListener,mini-dom 沒有;接線改由最後一案的原始碼守門。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter, createPresets as poe1CreatePresets } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import Poe1Fractured from '../../poe1/src/web/price-check/filters/FilterModifierFractured.vue'
import { FRACTURED_FILTERS_KEY as POE1_KEY } from '../../poe1/src/web/price-check/filters/fractured-toggle'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import Poe2Fractured from '../../poe2/src/web/price-check/filters/FilterModifierFractured.vue'
import { FRACTURED_FILTERS_KEY as POE2_KEY } from '../../poe2/src/web/price-check/filters/fractured-toggle'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')

function i18nPlugin (game: 'poe1' | 'poe2') {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/${game}/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'en' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

// PoE1:英文 fixture 的破裂詞綴換成不會被 pseudo 吃掉的「Adds # to # Physical Damage to Attacks」
const POE1_RING = fs.readFileSync(path.join(ROOT, 'poe1/test/fixtures/en/ring-rare-01.txt'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('{ Fractured Prefix Modifier "Rapturous" (Tier: 3) — Life }\n+68(60-69) to maximum Life',
    '{ Fractured Prefix Modifier "Glinting" (Tier: 8) — Damage, Physical, Attack }\nAdds 1(1-2) to 3(3-4) Physical Damage to Attacks')
// PoE2:已汙染頭盔,破裂 + 工藝的稀有度詞綴(explicit 列,沒有隱藏孿生);再把混沌抗性也改成破裂(pseudo 列)
const POE2_HELMET = fs.readFileSync(path.join(ROOT, 'poe2/test/zhTW/fixtures/en/helmet-rare-kamasan-tiara-01.txt'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('{ Suffix Modifier "of Bameth"', '{ Fractured Suffix Modifier "of Bameth"')

beforeAll(async () => {
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  await Poe2.poe2Adapter.loadData(poe2DataSource(path.join(ROOT, 'data/poe2')), 'en')
}, 300_000)

function click (n: MiniNode) {
  const fn = n.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, detail: 1 })
}

function renderRows (game: 'poe1' | 'poe2', comp: unknown, key: symbol, item: unknown, stats: any[]) {
  const errors: unknown[] = []
  const warnings: string[] = []
  const Root = defineComponent({
    setup () {
      provide(key as never, (() => stats) as never)
      return () => h('div', stats.map((f, i) => h('div', { key: i, 'data-row': String(i) }, [h(comp as never, { filter: f, item })])))
    }
  })
  const { container, app } = mount(Root, [i18nPlugin(game)], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, app, errors, warnings }
}

const groups = (c: MiniNode) => findAll(c, byAttr('data-action', 'fractured-toggle'))
const choice = (g: MiniNode, v: 'normal' | 'fractured') => findAll(g, byAttr('data-choice', v))[0]
const pressed = (g: MiniNode) => findAll(g, (n: MiniNode) => n.attrs['aria-pressed'] === 'true').map(n => n.attrs['data-choice'])

describe('一般 / 破裂二選一掛載', () => {
  it('PoE1:破裂詞綴列有二選一,選破裂改送 fractured id、孿生取消勾選,選一般還原', async () => {
    const item = poe1Parse(POE1_RING)._unsafeUnwrap()
    const { presets, active } = poe1CreatePresets(item, OPTS)
    const preset = presets.find(p => p.id === active)!
    const stats = reactive(preset.stats.filter(s => !s.group)) as any[]
    const twin = stats.find(f => f.tag === 'fractured')!
    twin.disabled = false
    const { container, app, errors, warnings } = renderRows('poe1', Poe1Fractured, POE1_KEY as symbol, item, stats)
    await nextTick()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    const gs = groups(container)
    expect(gs.length).toBe(1)
    expect(gs[0].attrs.role).toBe('group')
    expect(text(choice(gs[0], 'normal'))).toBe('一般')
    expect(text(choice(gs[0], 'fractured'))).toBe('破裂')
    expect(pressed(gs[0])).toEqual(['normal'])
    const row = stats.find(f => f.statRef === 'Adds # to # Physical Damage to Attacks' && f.tag === 'explicit')!

    click(choice(gs[0], 'fractured'))
    await nextTick()
    expect(pressed(groups(container)[0])).toEqual(['fractured'])
    expect(row.tradeId).toEqual(['fractured.stat_3032590688'])
    expect(row.disabled).toBe(false)
    expect(twin.disabled).toBe(true)

    click(choice(groups(container)[0], 'fractured'))
    await nextTick()
    expect(row.tradeId).toEqual(['fractured.stat_3032590688'])

    click(choice(groups(container)[0], 'normal'))
    await nextTick()
    expect(pressed(groups(container)[0])).toEqual(['normal'])
    expect(row.tradeId).toEqual(['explicit.stat_3032590688'])
    app.unmount()
  })

  it('PoE2:破裂的 explicit 列與 pseudo 列各有二選一,選了只切那一列', async () => {
    const parsed = Poe2.parseClipboard(POE2_HELMET)
    if (parsed.isErr()) throw new Error(String(parsed.error))
    const item = parsed.value
    const { presets, active } = Poe2.createPresets(item, OPTS)
    const preset = presets.find(p => p.id === active)!
    const stats = reactive(preset.stats) as any[]
    const { container, app, errors, warnings } = renderRows('poe2', Poe2Fractured, POE2_KEY as symbol, item, stats)
    await nextTick()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    const gs = groups(container)
    expect(gs.length).toBe(2)
    for (const g of gs) expect(pressed(g)).toEqual(['normal'])
    const chaos = stats.find(f => f.statRef === '#% total to Chaos Resistance')!
    const chaosIdx = stats.indexOf(chaos)
    const chaosGroup = () => groups(findAll(container, byAttr('data-row', String(chaosIdx)))[0])[0]

    click(choice(chaosGroup(), 'fractured'))
    await nextTick()
    expect(groups(container).map(g => pressed(g)[0]).sort()).toEqual(['fractured', 'normal'])
    expect(chaos.tradeId.every((id: string) => id.startsWith('fractured.'))).toBe(true)
    click(choice(chaosGroup(), 'normal'))
    await nextTick()
    expect(chaos.tradeId).toEqual(['pseudo.pseudo_total_chaos_resistance'])
    app.unmount()
  })

  it('兩代 FilterModifier / FiltersBlock 都接上切換鈕', () => {
    for (const game of ['poe1', 'poe2']) {
      const dir = path.join(ROOT, `${game}/src/web/price-check/filters`)
      const mod = fs.readFileSync(path.join(dir, 'FilterModifier.vue'), 'utf8')
      expect(mod).toMatch(/import FilterModifierFractured from ["']\.\/FilterModifierFractured\.vue["']/)
      expect(mod).toContain('<filter-modifier-fractured')
      const block = fs.readFileSync(path.join(dir, 'FiltersBlock.vue'), 'utf8')
      expect(block).toMatch(/provide\(FRACTURED_FILTERS_KEY, \(\) => props\.stats\)/)
    }
  })
})
