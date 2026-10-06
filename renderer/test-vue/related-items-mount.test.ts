/**
 * 查價面板旁的「相關物品」真掛載(PoE1 = APT 移植、PoE2 = EE2 移植):Boss 碎片 → 同組碎片(自己高亮)+ 可換物品,
 * 沒有價格時顯示「?」;不在任何一組的物品不輸出任何東西;無錯誤 / Vue 警告。資料讀 repo、不連網。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import * as Poe2 from '@poe2-entry'
import { nodeDataSource as poe2DataSource } from '../../poe2/src/assets/data/node-source'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter } from '../../poe1/src/index'
import { parseClipboard as parsePoe1 } from '@/parser'
import RelatedItems from '@poe1/related-items/RelatedItems.vue'
import { initConfig } from '../src/web/Config'
import { mount, text, findAll, byAttr, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')

function render (component: unknown, item: unknown, clickPosition = 'stash') {
  const errors: unknown[] = []
  const warnings: string[] = []
  const Root = defineComponent({ setup: () => () => h(component as never, { item, clickPosition }) })
  const { container } = mount(Root, [], (a) => {
    a.config.errorHandler = (err) => { errors.push(err) }
    a.config.warnHandler = (msg) => { warnings.push(msg) }
  })
  return { container, errors, warnings }
}

const panelOf = (c: MiniNode) => findAll(c, byAttr('data-panel', 'related-items'))

beforeAll(async () => {
  expect(fs.existsSync(path.join(ROOT, 'data/poe1/item-drop.json'))).toBe(true)
  await initConfig()
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'en')
  await Poe2.poe2Adapter.loadData(poe2DataSource(path.join(ROOT, 'data/poe2')), 'en')
}, 300_000)

describe('PoE1 RelatedItems(APT)', () => {
  it('Sacrifice at Dawn:四片碎片 + 可換物品,沒價格顯示「?」', async () => {
    const parsed = parsePoe1('Item Class: Map Fragments\nRarity: Normal\nSacrifice at Dawn\n--------\nCan be used in a personal Map Device to add modifiers to a Map.')
    const { container, errors, warnings } = render(RelatedItems, parsed._unsafeUnwrap())
    await nextTick()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    const panel = panelOf(container)
    expect(panel.length).toBe(1)
    const s = text(panel[0])
    for (const name of ['Sacrifice at Dawn', 'Sacrifice at Midnight', 'Sacrifice at Noon', 'Sacrifice at Dusk', "Atziri's Promise"]) {
      expect(s).toContain(name)
    }
    expect(s).toContain('?')
  })

  it('不在任何一組(Chaos Orb)→ 不輸出', async () => {
    const parsed = parsePoe1('Item Class: Stackable Currency\nRarity: Currency\nChaos Orb\n--------\nStack Size: 1/20')
    const { container, errors } = render(RelatedItems, parsed._unsafeUnwrap())
    await nextTick()
    expect(errors).toEqual([])
    expect(panelOf(container)).toEqual([])
  })
})

describe('PoE2 RelatedItems(EE2)', () => {
  it('Primary Calamity Fragment:三片碎片 + 可換物品', async () => {
    const parsed = Poe2.parseClipboard('Item Class: Pinnacle Keys\nRarity: Normal\nPrimary Calamity Fragment')
    const { container, errors, warnings } = render(Poe2.RelatedItems, parsed._unsafeUnwrap(), 'inventory')
    await nextTick()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    const panel = panelOf(container)
    expect(panel.length).toBe(1)
    const s = text(panel[0])
    for (const name of ['Primary Calamity Fragment', 'Secondary Calamity Fragment', 'Tertiary Calamity Fragment', 'Prism of Belief']) {
      expect(s).toContain(name)
    }
  })
})

describe('App.vue 接線', () => {
  const app = fs.readFileSync(path.join(ROOT, 'renderer/src/web/App.vue'), 'utf8')
  it('兩代切換、只在國際服、overlay 側欄 + window 模式查價區下方', () => {
    expect(app).toMatch(/relatedItemsComponent: computed\(\(\) => loadedGame\.value === 'poe2' \? Poe2\.RelatedItems : RelatedItems\)/)
    expect(app).toMatch(/showRelated: computed\(\(\) => Boolean\(.*AppConfig\(\)\.realm === 'intl'/)
    expect(app.match(/:is="relatedItemsComponent"/g)?.length).toBe(2)
    expect(app).toContain('click-position="window"')
  })
  it('PoE2 入口有匯出、宣告有對應', () => {
    expect(fs.readFileSync(path.join(ROOT, 'poe2/src/renderer-entry.ts'), 'utf8')).toContain('export { default as RelatedItems }')
    expect(fs.readFileSync(path.join(ROOT, 'renderer/src/web/games/poe2-entry.d.ts'), 'utf8')).toContain('export declare const RelatedItems')
  })
})
