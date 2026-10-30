import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { nodeDataSource } from '@/assets/data/node-source'
import { parseFetchItem, type DisplayItem, type DisplayLine, type FetchItem } from '@/web/price-check/trade/display-item'
import { __displayZhTest, buildDisplayZhData, configureDisplayZh, translateDisplayItem, type DisplayZhData } from '@/web/price-check/trade/display-zh'

/**
 * 查價結果浮窗的屬性名繁中化:催化劑品質類型、無形性、記憶絲縷(使用者回報仍是英文)。錄製檔以外的最小 fetch item,不連網。
 */
const DATA = path.resolve(__dirname, '../../data/poe1')
const read = (rel: string) => fs.readFileSync(path.join(DATA, rel), 'utf8')
const source = nodeDataSource(DATA)

let data: DisplayZhData
beforeAll(async () => {
  await init('en')
  data = buildDisplayZhData(read('en/stats.ndjson'), read('cmn-Hant/stats.ndjson'), read('cmn-Hant/items.ndjson'), {
    tradeStatsTw: read('trade/tw/stats.json'),
    itemClasses: read('item-classes/item-classes.json')
  })
})
afterEach(() => {
  configureDisplayZh(undefined)
  __displayZhTest.reset(source)
})

type Prop = NonNullable<FetchItem['properties']>[number]
const propLines = (d: DisplayItem): DisplayLine[] => [...(d.nameBlock ?? []), ...(d.itemProps ?? [])]
const vals = (l: DisplayLine | undefined) => (l?.values ?? []).map(v => [v.text, v.color])

/** 第一個 property(空值)會被當成類別行,所以目標屬性放在它後面 */
function translateWith(base: Partial<FetchItem>, classLine: string, target: Prop) {
  const item: FetchItem = {
    name: 'Test Name', typeLine: 'Test Base', baseType: 'Test Base', frameType: 2, identified: true,
    ...base,
    properties: [{ name: classLine, values: [] }, target]
  }
  const before = parseFetchItem(item)!
  const after = translateDisplayItem(before, item, data).display
  return { before, after }
}

/** 翻譯前英文行的位置 → 翻譯後同位置那行 */
function pair(before: DisplayItem, after: DisplayItem, enText: string) {
  const b = propLines(before)
  const i = b.findIndex(l => l.text === enText)
  expect(i, `翻譯前應有屬性行「${enText}」`).toBeGreaterThanOrEqual(0)
  return { b: b[i], a: propLines(after)[i] }
}

describe('Q 屬性名繁中化', () => {
  it('催化劑品質類型屬性行換成繁中,數值與顏色不變', () => {
    const { before, after } = translateWith({ typeLine: 'Two-Stone Ring', baseType: 'Two-Stone Ring' }, 'Ring',
      { name: 'Quality (Attribute Modifiers)', values: [['+20%', 1]], displayMode: 0, type: 6 })
    const { b, a } = pair(before, after, 'Quality (Attribute Modifiers): ')
    expect(a.text).toBe('品質 (能力值詞綴): ')
    expect(vals(a)).toEqual(vals(b))
    expect(vals(a)[0][0]).toBe('+20%')
  })

  it('18 種品質類型都有繁中', () => {
    const expected: Array<[string, string]> = [
      ['Quality (Elemental Damage Modifiers)', '品質 (元素傷害詞綴)'],
      ['Quality (Caster Modifiers)', '品質 (法術詞綴)'],
      ['Quality (Attack Modifiers)', '品質 (攻擊詞綴)'],
      ['Quality (Defence Modifiers)', '品質 (防禦詞綴)'],
      ['Quality (Life and Mana Modifiers)', '品質 (生命和魔力詞綴)'],
      ['Quality (Resistance Modifiers)', '品質 (抗性詞綴)'],
      ['Quality (Attribute Modifiers)', '品質 (能力值詞綴)'],
      ['Quality (Physical and Chaos Damage Modifiers)', '品質 (物理和混沌傷害詞綴)'],
      ['Quality (Speed Modifiers)', '品質 (速度詞綴)'],
      ['Quality (Critical Modifiers)', '品質 (暴擊詞綴)'],
      ['Quality (Quantity)', '品質 (數量)'],
      ['Quality (Rarity)', '品質(稀有度)'],
      ['Quality (Pack Size)', '品質(怪物群大小)'],
      ['Quality (Divination Cards)', '品質(命運卡)'],
      ['Quality (Scarabs)', '品質(聖甲蟲)'],
      ['Quality (Currency)', '品質(通貨)'],
      ['Quality (Prefix Modifiers)', '品質(前綴)'],
      ['Quality (Suffix Modifiers)', '品質(後綴)']
    ]
    expect(expected).toHaveLength(18)
    const got = expected.map(([en]) => [en, data.stringZh?.get(en)])
    expect(got).toEqual(expected)
  })

  it('無形性屬性行換成繁中,數值不變', () => {
    const { before, after } = translateWith({ typeLine: 'Two-Stone Ring', baseType: 'Two-Stone Ring' }, 'Ring',
      { name: 'Intangibility', values: [['32%', 1]], displayMode: 0 })
    const { b, a } = pair(before, after, 'Intangibility: ')
    expect(a.text).toBe('無形性: ')
    expect(vals(a)).toEqual(vals(b))
    expect(vals(a)[0][0]).toBe('32%')
  })

  it('記憶絲縷屬性行換成繁中,數值不變', () => {
    const { before, after } = translateWith({ typeLine: 'Sorcerer Boots', baseType: 'Sorcerer Boots' }, 'Boots',
      { name: 'Memory Strands', values: [['63', 1]], displayMode: 0 })
    const { b, a } = pair(before, after, 'Memory Strands: ')
    expect(a.text).toBe('記憶絲縷: ')
    expect(vals(a)).toEqual(vals(b))
    expect(vals(a)[0][0]).toBe('63')
  })

  it('資料檔字串每筆 en / zh 皆非空且不含標記字元', () => {
    const json = JSON.parse(read('item-classes/item-classes.json')) as { strings: Array<{ id?: string, en: unknown, zh: unknown }> }
    expect(Array.isArray(json.strings)).toBe(true)
    expect(json.strings.length).toBeGreaterThan(0)
    const bad: string[] = []
    for (const s of json.strings) {
      for (const k of ['en', 'zh'] as const) {
        const v = s[k]
        if (typeof v !== 'string' || v.trim() === '' || /[[\]{}]/.test(v)) bad.push(`${s.id ?? '?'}.${k}=${JSON.stringify(v)}`)
      }
    }
    expect(bad).toEqual([])
  })
})
