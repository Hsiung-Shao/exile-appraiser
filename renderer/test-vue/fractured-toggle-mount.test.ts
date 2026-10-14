/**
 * 查價面板「破裂」切換鈕(2026-10-14):兩代 FilterModifierFractured 真掛載(每條 filter 一個,與 FilterModifier 掛法相同)。
 * 破裂詞綴那列有按鈕,點了 aria-pressed / 高亮 class 變化、filter 改送 fractured id、隱藏孿生取消勾選;非破裂列不輸出按鈕。
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

const buttons = (c: MiniNode) => findAll(c, byAttr('data-action', 'fractured-toggle'))
const classes = (n: MiniNode) => String(n.attrs.class ?? '').split(/\s+/)

describe('破裂切換鈕掛載', () => {
  it('PoE1:破裂詞綴列有按鈕,點了高亮並改送 fractured id、孿生取消勾選,再點還原', async () => {
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
    const btns = buttons(container)
    expect(btns.length).toBe(1)
    expect(text(btns[0])).toBe('破裂')
    expect(btns[0].attrs['aria-pressed']).toBe('false')
    const offClass = classes(btns[0])
    const row = stats.find(f => f.statRef === 'Adds # to # Physical Damage to Attacks' && f.tag === 'explicit')!

    click(btns[0])
    await nextTick()
    const on = buttons(container)[0]
    expect(on.attrs['aria-pressed']).toBe('true')
    expect(classes(on).length).toBe(offClass.length + 1)
    expect(row.tradeId).toEqual(['fractured.stat_3032590688'])
    expect(row.disabled).toBe(false)
    expect(twin.disabled).toBe(true)

    click(on)
    await nextTick()
    expect(buttons(container)[0].attrs['aria-pressed']).toBe('false')
    expect(classes(buttons(container)[0])).toEqual(offClass)
    expect(row.tradeId).toEqual(['explicit.stat_3032590688'])
    app.unmount()
  })

  it('PoE2:破裂的 explicit 列與 pseudo 列各有按鈕,點了只切那一列', async () => {
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
    const btns = buttons(container)
    expect(btns.length).toBe(2)
    for (const b of btns) expect(b.attrs['aria-pressed']).toBe('false')
    const chaos = stats.find(f => f.statRef === '#% total to Chaos Resistance')!
    const chaosIdx = stats.indexOf(chaos)
    const chaosBtn = buttons(findAll(container, byAttr('data-row', String(chaosIdx)))[0])[0]

    click(chaosBtn)
    await nextTick()
    expect(buttons(container).map(b => b.attrs['aria-pressed']).sort()).toEqual(['false', 'true'])
    expect(chaos.tradeId.every((id: string) => id.startsWith('fractured.'))).toBe(true)
    click(buttons(findAll(container, byAttr('data-row', String(chaosIdx)))[0])[0])
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
