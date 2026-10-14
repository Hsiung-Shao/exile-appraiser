import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { createPresets, createTradeRequest } from '../src/index'
import type { FilterPreset, StatFilter } from '@/web/price-check/filters/interfaces'
import { applyFracturedToggle, canToggleFractured, isFracturedOn } from '@/web/price-check/filters/fractured-toggle'

// 2026-10-14 使用者實機回報:PoE1 稀有戒指的破裂智慧只出現在「已隱藏」清單 → 破裂詞綴預設要在可見清單、帶切換鈕、不重複。
// 照截圖組的剪貼簿:破裂智慧(被 pseudo「+# total to Intelligence」吃掉)+ 兩條冰冷抗性(pseudo x2)
const RING = `Item Class: Rings
Rarity: Rare
Doom Loop
Opal Ring
--------
Requirements:
Level: 80
--------
Item Level: 84
--------
{ Implicit Modifier — Elemental, Damage }
17(10-15)% increased Elemental Damage
--------
{ Prefix Modifier "Rapturous" (Tier: 3) — Life }
+68(60-69) to maximum Life
{ Fractured Suffix Modifier "of the Prodigy" (Tier: 3) — Attribute }
+31(28-33) to Intelligence
{ Suffix Modifier "of the Ice" (Tier: 2) — Elemental, Cold, Resistance }
+41(36-41)% to Cold Resistance
{ Suffix Modifier "of the Salamander" (Tier: 2) — Elemental, Fire, Resistance }
+40(36-41)% to Fire Resistance
{ Master Crafted Suffix Modifier "of Craft" (Rank: 2) — Elemental, Cold, Resistance }
+29(26-30)% to Cold Resistance
--------
Fractured Item
`
const INT = '+# to Intelligence'
const INT_IDS = ['explicit.stat_328541901', 'fractured.stat_328541901']
const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'en' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}
const flat = (p: FilterPreset): StatFilter[] => p.stats.flatMap(s => s.group ? [s.meta, ...s.stats] : [s])
function build (text = RING): { item: ParsedItem, preset: FilterPreset } {
  const item = parseClipboard(text)._unsafeUnwrap()
  const { presets, active } = createPresets(item, OPTS)
  return { item, preset: presets.find(p => p.id === active)! }
}

beforeAll(async () => { await init('en') })

describe('破裂詞綴預設可見', () => {
  it('破裂智慧有一列在可見清單(不在已隱藏)且帶切換鈕', () => {
    const { item, preset } = build()
    expect(item.isFractured).toBe(true)
    const rows = flat(preset).filter(f => f.statRef === INT && f.hidden == null)
    expect(rows.length).toBe(1)
    expect(canToggleFractured(rows[0], item)).toBe(true)
  })

  it('同一條破裂詞綴只有一列可見(explicit / fractured id 不重複)', () => {
    const { preset } = build()
    const visible = flat(preset).filter(f => f.hidden == null && f.tradeId.some(id => INT_IDS.includes(id)))
    expect(visible.length).toBe(1)
  })

  it('切換鈕只出現在破裂詞綴本身那一列(pseudo 合計列沒有)', () => {
    const { item, preset } = build()
    expect(flat(preset).filter(f => canToggleFractured(f, item)).map(f => f.statRef)).toEqual([INT])
  })

  it('讓破裂詞綴可見不改變預設查詢', () => {
    const { preset } = build()
    const req = JSON.stringify(createTradeRequest(preset))
    for (const f of flat(preset)) f.hidden = 'x'
    expect(JSON.stringify(createTradeRequest(preset))).toBe(req)
  })

  it('已汙染(沒有孿生)時退而在唯一來源的 pseudo 列給鈕,關閉回 pseudo id', () => {
    const { item, preset } = build(RING.replace('--------\nFractured Item', '--------\nCorrupted\n--------\nFractured Item'))
    expect(item.isCorrupted).toBe(true)
    const t = flat(preset).filter(f => canToggleFractured(f, item))
    expect(t.map(f => [f.statRef, f.tag, f.hidden])).toEqual([['+# total to Intelligence', 'pseudo', undefined]])
    const row = t[0]
    row.disabled = false
    const before = JSON.stringify(createTradeRequest(preset))
    applyFracturedToggle(preset.stats, row, true)
    expect(isFracturedOn(row)).toBe(true)
    expect(row.tradeId).toEqual(['fractured.stat_328541901'])
    applyFracturedToggle(preset.stats, row, false)
    expect(JSON.stringify(createTradeRequest(preset))).toBe(before)
  })

  it('未汙染時 pseudo 合計列不給鈕(由破裂孿生列代表)', () => {
    const { item, preset } = build()
    expect(flat(preset).some(f => f.tag === 'pseudo' && canToggleFractured(f, item))).toBe(false)
  })
})
