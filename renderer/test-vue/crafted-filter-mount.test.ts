/**
 * 查價面板「排除工藝詞綴」按鈕:兩代 FiltersBlock 真掛載。
 * filters.craftedMods 存在 → 多一顆 FilterBtnLogical(文字 ppz.crafted_filter.exclude),點擊切換 disabled;不存在 → 不輸出。
 * craftedMods 由測試直接放進 filters(UI 行為與 createFilters 何時建立分開測;建立條件在 poe1 / poe2 的 crafted-filter.test.ts)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig } from '../src/web/Config'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter, createPresets as poe1CreatePresets } from '../../poe1/src/index'
import { parseClipboard as poe1Parse } from '@/parser'
import Poe1FiltersBlock from '../../poe1/src/web/price-check/filters/FiltersBlock.vue'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import Poe2FiltersBlock from '../../poe2/src/web/price-check/filters/FiltersBlock.vue'
import { mount, text, findAll, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const KEY = 'ppz.crafted_filter.exclude'

function readI18n (lang: string) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
}
// 字串還沒加時 vue-i18n 回鍵名本身;兩種都能找到按鈕(字串是否齊全另由 crafted-filter-i18n.test.ts 守)
const LABEL: string = readI18n('cmn-Hant').ppz?.crafted_filter?.exclude ?? KEY

function i18nPlugin (game: 'poe1' | 'poe2') {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/${game}/${lang}/app_i18n.json`), 'utf8')),
    ...readI18n(lang)
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'en' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

const POE1_RING = fs.readFileSync(path.join(ROOT, 'poe1/test/fixtures/en/ring-rare-01.txt'), 'utf8').replace(/\r\n/g, '\n')
const POE2_HELMET = fs.readFileSync(path.join(ROOT, 'poe2/test/zhTW/fixtures/en/helmet-rare-kamasan-tiara-01.txt'), 'utf8').replace(/\r\n/g, '\n')

beforeAll(async () => {
  await initConfig()
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  await Poe2.poe2Adapter.loadData(poe2DataSource(path.join(ROOT, 'data/poe2')), 'en')
}, 300_000)

const CASES = [
  {
    game: 'poe1' as const,
    comp: Poe1FiltersBlock,
    build: () => {
      const item = poe1Parse(POE1_RING)._unsafeUnwrap()
      const { presets, active } = poe1CreatePresets(item, OPTS)
      return { item, preset: presets.find(p => p.id === active)! as any }
    }
  },
  {
    game: 'poe2' as const,
    comp: Poe2FiltersBlock,
    build: () => {
      const parsed = Poe2.parseClipboard(POE2_HELMET)
      if (parsed.isErr()) throw new Error(String(parsed.error))
      const item = parsed.value
      const { presets, active } = Poe2.createPresets(item, OPTS)
      return { item, preset: presets.find(p => p.id === active)! as any }
    }
  }
]

function renderBlock (game: 'poe1' | 'poe2', comp: unknown, preset: any, item: unknown, craftedMods: { disabled: boolean } | undefined) {
  const errors: unknown[] = []
  const warnings: string[] = []
  const stats = reactive(preset.stats) as any[]
  const raw = { ...preset.filters }
  if (craftedMods) raw.craftedMods = craftedMods
  else delete raw.craftedMods
  const filters = reactive(raw) as any
  const Root = defineComponent({
    setup () {
      return () => h(comp as never, { presets: [{ id: preset.id, active: true }], filters, stats, item })
    }
  })
  const { container, app } = mount(Root, [i18nPlugin(game)], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, app, errors, warnings, filters }
}

const craftedBtns = (c: MiniNode) => findAll(c, (n: MiniNode) => n.tag === 'button' && text(n).includes(LABEL))

function click (n: MiniNode) {
  const fn = n.attrs.onClick as ((e: unknown) => void) | undefined
  expect(typeof fn).toBe('function')
  fn!({ preventDefault () {}, detail: 1 })
}

describe('排除工藝詞綴按鈕掛載', () => {
  for (const { game, comp, build } of CASES) {
    it(`${game}:有 craftedMods 時出現排除按鈕,點擊切換 disabled`, async () => {
      const { item, preset } = build()
      const { container, app, errors, warnings, filters } = renderBlock(game, comp, preset, item, { disabled: true })
      await nextTick()
      expect(errors).toEqual([])
      expect(warnings).toEqual([])
      expect(craftedBtns(container)).toHaveLength(1)
      click(craftedBtns(container)[0])
      await nextTick()
      expect(filters.craftedMods.disabled).toBe(false)
      click(craftedBtns(container)[0])
      await nextTick()
      expect(filters.craftedMods.disabled).toBe(true)
      app.unmount()
    })

    it(`${game}:沒有 craftedMods 時不輸出排除按鈕`, async () => {
      const { item, preset } = build()
      const { container, app, errors } = renderBlock(game, comp, preset, item, undefined)
      await nextTick()
      expect(errors).toEqual([])
      expect(craftedBtns(container)).toHaveLength(0)
      app.unmount()
    })
  }
})
