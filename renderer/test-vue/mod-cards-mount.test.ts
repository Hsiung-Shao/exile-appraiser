/**
 * 查價面板 B 改版(2026-10-14)詞綴卡片:兩代 FiltersBlock 真掛載。
 * 可見詞綴分「詞綴」/「偽屬性(總和)」兩張卡(標題 + 已選數)、每列開關(role=switch)等同勾選、最小 / 最大範圍膠囊、偽屬性列「來自 N 條詞綴」。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig } from '../src/web/Config'
import { splitModCards } from '../src/web/price-panel/mod-cards'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter, createPresets as poe1CreatePresets } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import Poe1FiltersBlock from '../../poe1/src/web/price-check/filters/FiltersBlock.vue'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import Poe2FiltersBlock from '../../poe2/src/web/price-check/filters/FiltersBlock.vue'
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

const POE1_RING = fs.readFileSync(path.join(ROOT, 'poe1/test/fixtures/en/ring-rare-01.txt'), 'utf8')
const POE2_HELMET = fs.readFileSync(path.join(ROOT, 'poe2/test/zhTW/fixtures/en/helmet-rare-kamasan-tiara-01.txt'), 'utf8')

beforeAll(async () => {
  await initConfig()
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  await Poe2.poe2Adapter.loadData(poe2DataSource(path.join(ROOT, 'data/poe2')), 'en')
}, 300_000)

function renderBlock (game: 'poe1' | 'poe2', comp: unknown, preset: any, item: unknown) {
  const errors: unknown[] = []
  const warnings: string[] = []
  const stats = reactive(preset.stats) as any[]
  const filters = reactive(preset.filters)
  const Root = defineComponent({
    setup () {
      return () => h(comp as never, { presets: [{ id: preset.id, active: true }], filters, stats, item })
    }
  })
  const { container, app } = mount(Root, [i18nPlugin(game)], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, app, errors, warnings, stats }
}

const card = (c: MiniNode, id: string) => findAll(c, byAttr('data-card', id))[0]
const switches = (c: MiniNode) => findAll(c, (n: MiniNode) => n.attrs.role === 'switch')

function clickSwitch (n: MiniNode) {
  const fn = n.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, detail: 1 })
}

const CASES = [
  {
    game: 'poe1' as const,
    comp: Poe1FiltersBlock,
    build: () => {
      const item = poe1Parse(POE1_RING.replace(/\r\n/g, '\n'))._unsafeUnwrap()
      const { presets, active } = poe1CreatePresets(item, OPTS)
      return { item, preset: presets.find(p => p.id === active)! }
    }
  },
  {
    game: 'poe2' as const,
    comp: Poe2FiltersBlock,
    build: () => {
      const parsed = Poe2.parseClipboard(POE2_HELMET.replace(/\r\n/g, '\n'))
      if (parsed.isErr()) throw new Error(String(parsed.error))
      const item = parsed.value
      const { presets, active } = Poe2.createPresets(item, OPTS)
      return { item, preset: presets.find(p => p.id === active)! }
    }
  }
]

describe('詞綴卡片掛載', () => {
  for (const { game, comp, build } of CASES) {
    it(`${game}:可見詞綴分兩張卡,標題顯示已選數`, async () => {
      const { item, preset } = build()
      const { container, app, errors, warnings, stats } = renderBlock(game, comp, preset, item)
      await nextTick()
      expect(errors).toEqual([])
      expect(warnings).toEqual([])
      const visible = stats.filter((s: any) => !(s.group ? s.meta.hidden : s.hidden))
      const split = splitModCards(visible)
      expect(split.mods.rows.length).toBeGreaterThan(0)
      expect(split.pseudo.rows.length).toBeGreaterThan(0)
      const mods = card(container, 'mods')
      const pseudo = card(container, 'pseudo')
      expect(text(findAll(mods, byAttr('data-part', 'card-title'))[0])).toBe('詞綴')
      expect(text(findAll(pseudo, byAttr('data-part', 'card-title'))[0])).toBe('偽屬性(總和)')
      expect(text(findAll(mods, byAttr('data-part', 'card-count'))[0])).toBe(`${split.mods.selected} / ${split.mods.rows.length} 選用`)
      expect(text(findAll(pseudo, byAttr('data-part', 'card-count'))[0])).toBe(`${split.pseudo.selected} / ${split.pseudo.rows.length} 選用`)
      expect(switches(mods).length).toBe(split.mods.rows.length)
      expect(switches(pseudo).length).toBe(split.pseudo.rows.length)
      app.unmount()
    })

    it(`${game}:開關等同勾選,點了切換 filter.disabled 與 aria-checked`, async () => {
      const { item, preset } = build()
      const { container, app, stats } = renderBlock(game, comp, preset, item)
      await nextTick()
      const visible = stats.filter((s: any) => !s.group && !s.hidden)
      const first = visible[0]
      const sw = () => switches(card(container, first.tag === 'pseudo' ? 'pseudo' : 'mods'))[0]
      const before = first.disabled
      expect(sw().attrs['aria-checked']).toBe(before ? 'false' : 'true')
      clickSwitch(sw())
      await nextTick()
      expect(first.disabled).toBe(!before)
      expect(sw().attrs['aria-checked']).toBe(before ? 'true' : 'false')
      clickSwitch(sw())
      await nextTick()
      expect(first.disabled).toBe(before)
      app.unmount()
    })

    it(`${game}:有數值的列有最小–最大範圍膠囊,偽屬性列標來源條數`, async () => {
      const { item, preset } = build()
      const { container, app, stats } = renderBlock(game, comp, preset, item)
      await nextTick()
      const ranges = findAll(container, byAttr('data-part', 'range'))
      const withRoll = stats.filter((s: any) => !s.group && !s.hidden && s.roll != null && !s.oils)
      expect(ranges.length).toBe(withRoll.length)
      for (const r of ranges) expect(findAll(r, n => n.tag === 'input').length).toBe(2)
      const pseudoRow = stats.find((s: any) => !s.group && !s.hidden && s.tag === 'pseudo')!
      expect(text(card(container, 'pseudo'))).toContain(`來自 ${pseudoRow.sources.length} 條詞綴`)
      app.unmount()
    })
  }
})
