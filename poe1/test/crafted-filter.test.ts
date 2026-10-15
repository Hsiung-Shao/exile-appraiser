import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import { ModifierType } from '@/parser/modifiers'
import { createPresets, createTradeRequest } from '../src/index'

// 查價面板「排除工藝詞綴」:稀有 / 魔法、可工藝類別、本身沒有工藝詞綴時才有 filters.craftedMods(預設 disabled = 不排除)
const CRAFTED_ID = 'pseudo.pseudo_number_of_crafted_mods'
const FIXTURES = path.join(__dirname, 'fixtures/en')
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, `${name}.txt`), 'utf8').replace(/\r\n/g, '\n')

function opts (realm: 'intl' | 'tw' = 'intl') {
  return {
    league: 'Standard', realm, clientLanguage: 'en' as const, searchStatRange: 10,
    currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
  }
}

const JEWEL_RARE = `Item Class: Jewels
Rarity: Rare
Chimera Eye
Cobalt Jewel
--------
Limited to: 1 Cobalt Jewel
--------
Requirements:
Level: 1
--------
Item Level: 84
--------
13% increased Spell Damage
4% increased Attack Speed
`

const RING_MAGIC = `Item Class: Rings
Rarity: Magic
Helical Ring of the Whelpling
--------
Requirements:
Level: 60
--------
Item Level: 84
--------
+30 to maximum Life
`

const WAND_NORMAL = `Item Class: Wands
Rarity: Normal
Kinetic Wand
--------
Wand
Physical Damage: 20-40
Critical Strike Chance: 8.00%
Attacks per Second: 1.40
--------
Requirements:
Level: 70
Int: 200
--------
Item Level: 85
`

function build (text: string, realm: 'intl' | 'tw' = 'intl') {
  const item = parseClipboard(text)._unsafeUnwrap()
  const { presets, active } = createPresets(item, opts(realm))
  const preset = presets.find(p => p.id === active)!
  return { preset, filters: preset.filters as any }
}

function andFilters (query: any): any[] {
  const and = (query.stats as any[]).find(g => g.type === 'and')
  return and ? and.filters : []
}
const allStatIds = (query: any): string[] => (query.stats as any[]).flatMap(g => g.filters.map((f: any) => f.id))

beforeAll(async () => { await init('en') })

describe('PoE1 排除工藝詞綴篩選', () => {
  it('C1 無工藝稀有珠寶提供排除切換且預設不排除', () => {
    const { filters } = build(JEWEL_RARE)
    expect(filters.craftedMods).toEqual({ disabled: true })
  })

  it('C2 預設不排除時查詢不含工藝數量條件', () => {
    const { preset } = build(JEWEL_RARE)
    const query = createTradeRequest(preset).query
    expect(allStatIds(query)).not.toContain(CRAFTED_ID)
  })

  it('C3 切成排除後查詢加上工藝數量上限 0', () => {
    const { preset, filters } = build(JEWEL_RARE)
    expect(filters.craftedMods).toBeDefined()
    filters.craftedMods.disabled = false
    const query = createTradeRequest(preset).query
    expect(andFilters(query)).toContainEqual(expect.objectContaining({ id: CRAFTED_ID, value: { max: 0 } }))
    expect(allStatIds(query).filter(id => id === CRAFTED_ID)).toHaveLength(1)
  })

  it('C4 物品本身有工藝詞綴時不提供切換', () => {
    // ring-rare-01 帶 Master Crafted Suffix Modifier;先確認 parser 真的認出工藝詞綴,避免假綠
    const item = parseClipboard(fixture('ring-rare-01'))._unsafeUnwrap()
    expect(item.newMods.some(m => m.info.type === ModifierType.Crafted)).toBe(true)
    const { filters } = build(fixture('ring-rare-01'))
    expect(filters.craftedMods).toBeUndefined()
  })

  it('C5 魔法戒指也提供切換且預設不排除', () => {
    const { filters } = build(RING_MAGIC)
    expect(filters.craftedMods).toEqual({ disabled: true })
  })

  it('C6 普通魔杖不提供切換', () => {
    expect(build(WAND_NORMAL).filters.craftedMods).toBeUndefined()
  })

  it('C6 傳奇靴子不提供切換', () => {
    expect(build(fixture('boots-unique-vestigial-01')).filters.craftedMods).toBeUndefined()
  })

  it('C6 通貨不提供切換', () => {
    expect(build(fixture('currency-01')).filters.craftedMods).toBeUndefined()
  })

  it('C7 稀有地圖不提供切換', () => {
    expect(build(fixture('map-rare-01')).filters.craftedMods).toBeUndefined()
  })

  it('C9 台服切成排除後查詢帶相同工藝數量 id', () => {
    const { preset, filters } = build(JEWEL_RARE, 'tw')
    expect(filters.craftedMods).toEqual({ disabled: true })
    filters.craftedMods.disabled = false
    const query = createTradeRequest(preset).query
    expect(andFilters(query)).toContainEqual(expect.objectContaining({ id: CRAFTED_ID, value: { max: 0 } }))
  })
})
