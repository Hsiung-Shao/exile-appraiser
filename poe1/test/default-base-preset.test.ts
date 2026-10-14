import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import { createPresets, createTradeRequest } from '../src/index'

// 2026-10-15 使用者裁定(與 APT 不同):魔法 / 稀有的武器 / 防具 / 飾品 / 箭袋預設仍是 pseudo preset,但搜尋改查該底材 type(不查類別),不看物等
const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'en' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

const GLOVES = (ilvl: number, extra = '') => `Item Class: Gloves
Rarity: Rare
Gale Grip
Warlock Gloves
--------
Energy Shield: 80
--------
Requirements:
Level: 70
Int: 100
--------
Item Level: ${ilvl}
--------
+40 to maximum Life
+30% to Fire Resistance
${extra}`

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

function build (text: string) {
  const item = parseClipboard(text)._unsafeUnwrap()
  const { presets, active } = createPresets(item, OPTS)
  const preset = presets.find(p => p.id === active)!
  const query = createTradeRequest(preset).query
  return { presets, active, query }
}

beforeAll(async () => { await init('en') })

const category = (q: any) => q.filters.type_filters?.filters.category?.option

describe('魔法 / 稀有底材預設查該底材(preset 不變)', () => {
  it('稀有術士手套物等 86 預設 pseudo、查 type 不查類別', () => {
    const r = build(GLOVES(86))
    expect(r.presets.map(p => p.id)).toEqual(['filters.preset_pseudo', 'filters.preset_base_item'])
    expect(r.active).toBe('filters.preset_pseudo')
    expect(r.query.type).toBe('Warlock Gloves')
    expect(category(r.query)).toBeUndefined()
  })

  it('魔法螺旋戒指預設 pseudo、查 type 不查類別', () => {
    const r = build(RING_MAGIC)
    expect(r.active).toBe('filters.preset_pseudo')
    expect(r.query.type).toBe('Helical Ring')
    expect(category(r.query)).toBeUndefined()
  })

  it('普通動能魔杖維持精確 preset 查 type', () => {
    const r = build(WAND_NORMAL)
    expect(r.active).toBe('filters.preset_exact')
    expect(r.query.type).toBe('Kinetic Wand')
  })

  it('物等 < 82 的稀有手套同樣查 type(不看物等)', () => {
    const r = build(GLOVES(75))
    expect(r.presets.map(p => p.id)).toEqual(['filters.preset_pseudo'])
    expect(r.query.type).toBe('Warlock Gloves')
    expect(category(r.query)).toBeUndefined()
  })

  it('已汙染(成品)手套維持 pseudo、同樣查 type', () => {
    const r = build(GLOVES(86, '--------\nCorrupted\n'))
    expect(r.presets.map(p => p.id)).toEqual(['filters.preset_pseudo'])
    expect(r.query.type).toBe('Warlock Gloves')
  })

  it('稀有珠寶不動、維持查類別', () => {
    const r = build(JEWEL_RARE)
    expect(r.query.type).toBeUndefined()
    expect(category(r.query)).toBe('jewel')
  })
})
