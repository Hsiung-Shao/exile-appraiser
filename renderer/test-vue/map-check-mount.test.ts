/**
 * PoE1 地圖詞綴檢查(移植 APT map-check,MIT;2026-11-18 起依正則書籤上色):
 * 適用物品、只列隨機詞綴、書籤命中的上色、新舊寫法、換書籤、沒有書籤的提示。真實 data/poe1(繁中)+ data/regex;不連網、不送輸入。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { pageKeysOf, parseRegexCatalogue, type RegexBookmark } from '@exile-appraiser/regex'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter } from '../../poe1/src/index'
import { ItemCategory, ItemRarity, parseClipboard, type ParsedItem } from '@/parser'
import { ModifierType } from '@/parser/modifiers'
import { isMapLike } from '@poe1/map-check/common'
import MapCheck from '@poe1/map-check/MapCheck.vue'
import { bookmarkMarks, markOfStat } from '../src/web/map-check-bookmark'
import { mount, text, findAll, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const pages = parseRegexCatalogue(fs.readFileSync(path.join(ROOT, 'data/regex/regex_poe1.json'), 'utf8'), 'poe1').pages

function i18nPlugin () {
  const load = (lang: string) => ({
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `data/poe1/${lang}/app_i18n.json`), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  })
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}

const MAP_RARE = fs.readFileSync(path.join(ROOT, 'poe1/test/fixtures/cmn-Hant/map-rare-01.txt'), 'utf8')
/** 稀有地圖,詞綴區換成指定行(一般複製格式) */
const mapWith = (lines: string[]) => [
  '物品種類: 地圖', '稀有度: 稀有', '死寂禮拜', '地圖（階級 16）', '--------', '物品數量: +84% (augmented)', '--------',
  '物品等級: 83', '--------', '怪物等級：83', '--------', ...lines, '--------',
  '透過個人的地圖裝置來使用這張地圖以前往這個階級或更低的該地圖。每張地圖只能被使用一次。'
].join('\n')
const parse = (t: string) => parseClipboard(t)._unsafeUnwrap()

function bookmark (name: string, mode: RegexBookmark['mode'], ids: string[]): RegexBookmark {
  const p = pages.find(x => x.id === 'map_mods')!
  return { name, page: 'map_mods', game: 'poe1', mode, lang: 'zh', ...pageKeysOf(p, ids.map(id => p.entries.findIndex(e => e.id === id))) }
}

function mountMap (item: ParsedItem, b: RegexBookmark | null, names: string[] = b ? [b.name] : []) {
  const errors: unknown[] = []
  const warns: string[] = []
  const picked: string[] = []
  const marks = bookmarkMarks(pages, b ?? undefined)
  const Root = defineComponent({
    setup: () => () => h(MapCheck, {
      item, bookmarks: names, bookmark: b?.name ?? null,
      markOf: (stat: { matchers: Array<{ string: string }> }) => markOfStat(marks, stat.matchers),
      'onUpdate:bookmark': (n: string) => { picked.push(n) }
    })
  })
  const m = mount(Root, [i18nPlugin()], (a) => { a.config.errorHandler = (e) => { errors.push(e) }; a.config.warnHandler = (msg) => { warns.push(msg) } })
  return { ...m, errors, warns, picked }
}
const byIcon = (cls: string) => (n: MiniNode) => typeof n.attrs.class === 'string' && n.attrs.class.includes(cls)
const rows = (n: MiniNode) => findAll(n, (x: MiniNode) => x.attrs['data-mark'] !== undefined)

beforeAll(async () => {
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'cmn-Hant')
}, 300_000)

describe('適用物品', () => {
  const fake = (category: ItemCategory | undefined, rarity: ItemRarity, refName = 'X') => ({ category, rarity, info: { refName } }) as unknown as ParsedItem
  it('非傳奇地圖、契約、藍圖、邀請、探險日誌 → 是;傳奇地圖、裝備 → 不是', () => {
    expect(isMapLike(parse(MAP_RARE))).toBe(true)
    expect(isMapLike(fake(ItemCategory.HeistContract, ItemRarity.Normal))).toBe(true)
    expect(isMapLike(fake(ItemCategory.HeistBlueprint, ItemRarity.Rare))).toBe(true)
    expect(isMapLike(fake(ItemCategory.Invitation, ItemRarity.Normal))).toBe(true)
    expect(isMapLike(fake(undefined, ItemRarity.Rare, 'Expedition Logbook'))).toBe(true)
    expect(isMapLike(fake(ItemCategory.Map, ItemRarity.Unique))).toBe(false)
    expect(isMapLike(fake(ItemCategory.Ring, ItemRarity.Rare))).toBe(false)
  })
})

describe('依書籤上色(R1、R2)', () => {
  it('排除書籤勾到的那一列標紅,其餘不上色;只列隨機詞綴', async () => {
    const item = parse(MAP_RARE)
    const m = mountMap(item, bookmark('危險', 'none', ['MapMonsterMultipleProjectilesWorlds']))
    await nextTick()
    expect(m.errors).toEqual([])
    expect(m.warns).toEqual([])
    expect(text(m.container)).not.toContain('開創者的記憶')
    const r = rows(m.container)
    expect(r.length).toBe(item.statsByType.filter(c => c.type === ModifierType.Explicit).length)
    expect(r.filter(x => x.attrs['data-mark'] === 'bad').map(text)).toEqual([expect.stringContaining('額外投射物')])
    expect(r.filter(x => x.attrs['data-mark'] === 'good')).toEqual([])
    expect(findAll(m.container, byIcon('fa-skull-crossbones')).length).toBe(1)
    m.app.unmount()
  })

  it('包含書籤勾到的標綠', async () => {
    const m = mountMap(parse(MAP_RARE), bookmark('想要', 'any', ['MapMonsterMultipleProjectilesWorlds']))
    await nextTick()
    expect(rows(m.container).filter(x => x.attrs['data-mark'] === 'good').length).toBe(1)
    m.app.unmount()
  })

  it('認不出的隨機詞綴照列', async () => {
    const m = mountMap(parse(mapWith(['區域內含有不穩定的惡魔觸手', '這一行不是任何詞綴 123'])), null)
    await nextTick()
    expect(text(m.container)).toContain('這一行不是任何詞綴 123')
    expect(text(m.container)).toContain('無法辨識的詞綴')
    m.app.unmount()
  })
})

describe('3.30 新舊寫法(R3)', () => {
  it('現行與 superseded 兩種繁中寫法的地圖都被同一個書籤標紅', async () => {
    const b = bookmark('危險', 'none', ['MapPoisoningMapWorlds'])
    for (const line of ['被怪物擊中時中毒', '怪物擊中時造成中毒']) {
      const item = parse(mapWith([line]))
      expect(item.statsByType.filter(c => c.type === ModifierType.Explicit).length, line).toBe(1)
      const m = mountMap(item, b)
      await nextTick()
      expect(rows(m.container).map(x => x.attrs['data-mark']), line).toEqual(['bad'])
      m.app.unmount()
    }
  })
})

describe('換書籤與沒有書籤(R5)', () => {
  it('選單列出書籤,選了就往外送名稱', async () => {
    const m = mountMap(parse(MAP_RARE), bookmark('危險', 'none', ['MapPoisoningMapWorlds']), ['危險', '想要'])
    await nextTick()
    const sel = findAll(m.container, (n: MiniNode) => n.tag === 'select')
    expect(sel.length).toBe(1)
    expect(findAll(sel[0], (n: MiniNode) => n.tag === 'option').map(text)).toEqual(['危險', '想要'])
    ;(sel[0].attrs.onChange as (e: unknown) => void)({ target: { value: '想要' } })
    expect(m.picked).toEqual(['想要'])
    m.app.unmount()
  })

  it('沒有可用書籤 → 提示到正則存書籤,詞綴照列不上色', async () => {
    const m = mountMap(parse(MAP_RARE), null, [])
    await nextTick()
    expect(m.errors).toEqual([])
    expect(text(m.container)).toContain('正則')
    expect(rows(m.container).every(x => x.attrs['data-mark'] === '')).toBe(true)
    m.app.unmount()
  })
})
