/**
 * PoE1 地圖詞綴檢查(移植 APT map-check,MIT):標記規則、以 ref 為鍵、適用物品、詞綴清單、過時提示、設定頁清單。
 * 真實 data/poe1(繁中)+ 真實地圖剪貼簿;不連網、不送輸入。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import { nodeDataSource as poe1DataSource } from '../../poe1/src/assets/data/node-source'
import { poe1Adapter } from '../../poe1/src/index'
import { ItemCategory, ItemRarity, parseClipboard, type ParsedItem } from '@/parser'
import { ModifierType } from '@/parser/modifiers'
import { areaModRows, decisionCreate, decisionHasColor, filterAreaMods, isMapLike, isOutdated, nextDecision, StatTag, type MapCheckConfig } from '@poe1/map-check/common'
import { prepareMapStat } from '@poe1/map-check/prepare-map-stats'
import MapCheck from '@poe1/map-check/MapCheck.vue'
import SettingsMaps from '@poe1/map-check/settings-maps.vue'
import { mount, text, findAll, type MiniNode } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')

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
const config = (selectedStats: MapCheckConfig['selectedStats'] = []): MapCheckConfig => reactive({ profile: 1, showNewStats: false, selectedStats })

function mountMap (item: ParsedItem, cfg: MapCheckConfig) {
  const errors: unknown[] = []
  const warns: string[] = []
  const Root = defineComponent({ setup: () => () => h(MapCheck, { item, config: cfg }) })
  const m = mount(Root, [i18nPlugin()], (a) => { a.config.errorHandler = (e) => { errors.push(e) }; a.config.warnHandler = (msg) => { warns.push(msg) } })
  return { ...m, errors, warns }
}
const statButtons = (n: MiniNode) => findAll(n, (x: MiniNode) => x.tag === 'button' && findAll(x, (y: MiniNode) => y.tag === 'span').length > 0)

beforeAll(async () => {
  await poe1Adapter.loadData(poe1DataSource(path.join(ROOT, 'data/poe1')), 'cmn-Hant')
}, 300_000)

describe('標記規則(T1)', () => {
  it('點一下依序 無 → 危險 → 警告 → 好 → 已看過 → 危險', () => {
    const seq = ['-']
    for (let i = 0; i < 5; i++) seq.push(nextDecision(seq[seq.length - 1]))
    expect(seq).toEqual(['-', 'd', 'w', 'g', 's', 'd'])
  })
  it('三組設定檔各存一格,改 II 不動 I', () => {
    expect(decisionCreate('w', 2, 'd--')).toBe('dw-')
    expect(decisionCreate('g', 1)).toBe('g--')
    expect(decisionHasColor('dws', 1)).toBe(true)
    expect(decisionHasColor('dws', 3)).toBe(false)
    expect(decisionHasColor('---', 1)).toBe(false)
  })
})

describe('以 ref 為鍵(T2)', () => {
  it('3.30 新舊兩種繁中寫法 → 同一個 ref、同一個標記', async () => {
    const refs = ['區域會包含一座含有整張地圖的強化蜃景', '區域內含有一座蜃景'].map(line => {
      const calc = parse(mapWith([line])).statsByType.filter(c => c.type === ModifierType.Explicit)
      expect(calc.length, line).toBe(1)
      return prepareMapStat(calc[0]).ref
    })
    expect(refs[0]).toBe('Area contains an Empowered Mirage which covers the entire Map')
    expect(refs[1]).toBe(refs[0])
    for (const line of ['區域會包含一座含有整張地圖的強化蜃景', '區域內含有一座蜃景']) {
      const m = mountMap(parse(mapWith([line])), config([{ ref: refs[0], decision: 'd--' }]))
      await nextTick()
      expect(findAll(m.container, (n: MiniNode) => typeof n.attrs.class === 'string' && n.attrs.class.includes('fa-skull-crossbones')).length, line).toBe(1)
      m.app.unmount()
    }
  })
})

describe('適用物品(T3)', () => {
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

describe('詞綴清單(T4、T9)', () => {
  it('只列隨機詞綴,點一下寫進目前設定檔', async () => {
    const item = parse(MAP_RARE)
    const cfg = config()
    const m = mountMap(item, cfg)
    await nextTick()
    expect(m.errors).toEqual([])
    expect(m.warns).toEqual([])
    const s = text(m.container)
    expect(s).toContain('核息')
    expect(s).not.toContain('開創者的記憶')
    const buttons = statButtons(m.container)
    const explicit = item.statsByType.filter(c => c.type === ModifierType.Explicit)
    expect(buttons.length).toBe(explicit.length)
    ;(buttons[0].attrs.onClick as () => void)()
    expect(cfg.selectedStats).toEqual([{ ref: prepareMapStat(explicit[0]).ref, decision: 'd--' }])
    ;(buttons[0].attrs.onClick as () => void)()
    expect(cfg.selectedStats[0].decision).toBe('w--')
    m.app.unmount()
  })

  it('認不出的隨機詞綴照列', async () => {
    const m = mountMap(parse(mapWith(['區域內含有不穩定的惡魔觸手', '這一行不是任何詞綴 123'])), config())
    await nextTick()
    expect(text(m.container)).toContain('這一行不是任何詞綴 123')
    expect(text(m.container)).toContain('無法辨識的詞綴')
    m.app.unmount()
  })
})

describe('過時提示(T5)', () => {
  it('有顏色的標記對不到資料才算過時;已看過不算', () => {
    expect(isOutdated(1, { ref: 'No such stat #', decision: 'd--' })).toBe(true)
    expect(isOutdated(1, { ref: 'No such stat #', decision: 's--' })).toBe(false)
    expect(isOutdated(1, { ref: 'Monsters reflect #% of Physical Damage', decision: 'd--' })).toBe(false)
  })
  it('畫面出現過時提示', async () => {
    const m = mountMap(parse(MAP_RARE), config([{ ref: 'No such stat #', decision: 'd--' }]))
    await nextTick()
    expect(text(m.container)).toContain('有些屬性的敘述已經改過')
    m.app.unmount()
  })
})

describe('設定頁清單(T10、T12)', () => {
  it('一個 ref 一列;3.30 新地圖詞綴與劫盜詞綴在清單上', () => {
    const rows = areaModRows()
    expect(new Set(rows.map(r => r.ref)).size).toBe(rows.length)
    expect(rows.find(r => r.ref === "Area contains an Evocator of K'Tash")).toBeDefined()
    expect(rows.find(r => r.ref === 'Monsters gain # Endurance Charge every 20 seconds')).toBeDefined()
    expect(rows.some(r => r.tag === StatTag.HeistExclusive)).toBe(true)
    // 繁中資料:顯示第一個沒被取代的寫法
    expect(rows.find(r => r.ref === 'Area contains an Empowered Mirage which covers the entire Map')?.matchStr).toBe('區域內含有一座蜃景')
  })

  it('搜尋(空白分隔都要命中)與只看已標記', () => {
    const rows = areaModRows()
    const hit = filterAreaMods(rows, '反射 物理', false, new Set())
    expect(hit.length).toBeGreaterThan(0)
    expect(hit.every(r => r.matchStr.includes('反射') && r.matchStr.includes('物理'))).toBe(true)
    const marked = new Set(["Area contains an Evocator of K'Tash"])
    expect(filterAreaMods(rows, '', true, marked).map(r => r.ref)).toEqual(["Area contains an Evocator of K'Tash"])
  })

  it('設定頁掛上:過時的標記排最上面,沒有錯誤', async () => {
    const cfg = config([{ ref: 'No such stat #', decision: 'd--' }])
    const errors: unknown[] = []
    const Root = defineComponent({ setup: () => () => h(SettingsMaps, { config: cfg }) })
    const m = mount(Root, [i18nPlugin()], (a) => { a.config.errorHandler = (e) => { errors.push(e) } })
    await nextTick()
    expect(errors).toEqual([])
    const s = text(m.container)
    expect(s).toContain('No such stat #')
    expect(s.indexOf('No such stat #')).toBeLessThan(s.indexOf('核息'))
    m.app.unmount()
  })
})
