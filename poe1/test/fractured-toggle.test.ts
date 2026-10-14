import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { ModifierType } from '@/parser/modifiers'
import { createPresets, createTradeRequest } from '../src/index'
import { FilterTag, type FilterPreset, type StatFilter } from '@/web/price-check/filters/interfaces'
import { applyFracturedToggle, canToggleFractured, isFracturedOn } from '@/web/price-check/filters/fractured-toggle'
import { FIXTURES_DIR } from './helpers/fixture-harness'

// 查價面板「破裂」切換鈕(T9–T11):破裂詞綴在 explicit ↔ fractured stat id 之間切換。
const EN_DIR = path.join(FIXTURES_DIR, 'en')
const read = (name: string) => fs.readFileSync(path.join(EN_DIR, `${name}.txt`), 'utf8')
const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'en' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}
// ring-rare-01 的破裂詞綴「+# to maximum Life」被 pseudo「+# total maximum Life」吃掉 → 沒有 explicit 列,
// 破裂孿生拿出來當代表列,以一般詞綴呈現(tag explicit、送 explicit id、鈕不亮),點鈕才送 fractured id
const LIFE = '+# to maximum Life'
const LIFE_EXPLICIT = 'explicit.stat_3299347043'
const LIFE_FRACTURED = 'fractured.stat_3299347043'
// 破裂詞綴換成不會被 pseudo 吃掉的那種 → 切換鈕在 explicit 列
const PHYS = 'Adds # to # Physical Damage to Attacks'
const PHYS_EXPLICIT = 'explicit.stat_3032590688'
const PHYS_FRACTURED = 'fractured.stat_3032590688'
const ringPhys = () => read('ring-rare-01').replace(
  '{ Fractured Prefix Modifier "Rapturous" (Tier: 3) — Life }\n+68(60-69) to maximum Life',
  '{ Fractured Prefix Modifier "Glinting" (Tier: 8) — Damage, Physical, Attack }\nAdds 1(1-2) to 3(3-4) Physical Damage to Attacks')
const corrupt = (text: string) => text.replace('--------\nFractured Item', '--------\nCorrupted\n--------\nFractured Item')

function parse (text: string): ParsedItem {
  const r = parseClipboard(text.replace(/\r\n/g, '\n'))
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`)
  return r.value
}
function preset (item: ParsedItem): FilterPreset {
  const { presets, active } = createPresets(item, OPTS)
  return presets.find(p => p.id === active) ?? presets[0]
}
const flat = (p: FilterPreset): StatFilter[] => p.stats.flatMap(s => s.group ? [s.meta, ...s.stats] : [s])
const enabledIds = (request: any): string[] =>
  (request.query.stats as any[]).flatMap(g => g.disabled ? [] : g.filters.filter((f: any) => !f.disabled).map((f: any) => f.id))
const toggles = (item: ParsedItem, p: FilterPreset) => flat(p).filter(f => canToggleFractured(f, item))

beforeAll(async () => {
  await init('en')
})

describe('T9 破裂鈕只在破裂詞綴出現', () => {
  it('破裂詞綴被 pseudo 吃掉時代表列以一般詞綴呈現、鈕預設不亮', () => {
    const item = parse(read('ring-rare-01'))
    expect(item.isFractured).toBe(true)
    const t = toggles(item, preset(item))
    expect(t.map(f => [f.statRef, f.tag, f.hidden])).toEqual([[LIFE, FilterTag.Explicit, undefined]])
    expect(t[0].tradeId).toEqual([LIFE_EXPLICIT])
    expect(isFracturedOn(t[0])).toBe(false)
  })

  it('沒被 pseudo 吃掉的破裂詞綴切換鈕在 explicit 列', () => {
    const item = parse(ringPhys())
    const t = toggles(item, preset(item))
    expect(t.map(f => f.statRef)).toEqual([PHYS])
    expect(t[0].tradeId).toEqual([PHYS_EXPLICIT])
  })

  it('非破裂詞綴、pseudo 合計列與仍隱藏的破裂孿生都沒有切換鈕', () => {
    const item = parse(ringPhys())
    const all = flat(preset(item))
    for (const f of all.filter(f => !(f.statRef === PHYS && f.tag === FilterTag.Explicit))) {
      expect(canToggleFractured(f, item), `${f.statRef}/${f.tag}`).toBe(false)
    }
    // 有 explicit 列時孿生維持隱藏
    expect(all.find(f => f.statRef === PHYS && f.tag === FilterTag.Fractured)?.hidden).toBe('filters.hide_for_crafting')
    const ring = parse(read('ring-rare-01'))
    expect(flat(preset(ring)).filter(f => f.tag === FilterTag.Pseudo).some(f => canToggleFractured(f, ring))).toBe(false)
  })

  it('一般物品沒有切換鈕', () => {
    for (const name of ['jewel-rare-01', 'map-rare-01', 'boots-unique-vestigial-01']) {
      const item = parse(read(name))
      expect(item.isFractured).toBeFalsy()
      expect(toggles(item, preset(item))).toEqual([])
    }
  })

  it('stat 沒有 fractured trade id 時沒有切換鈕', () => {
    const item = parse(ringPhys())
    const phys = toggles(item, preset(item))[0]
    const src = phys.sources[0]
    const noFracStat = { ...src.stat.stat, trade: { ids: { [ModifierType.Explicit]: [PHYS_EXPLICIT] } } }
    const fake: StatFilter = { ...phys, sources: [{ ...src, stat: { ...src.stat, stat: noFracStat } }] }
    expect(canToggleFractured(fake, item)).toBe(false)
  })
})

describe('T10 點破裂改送破裂 id', () => {
  it('被 pseudo 吃掉的代表列:打開送 fractured id,再點換回與原查詢逐字相同', () => {
    const item = parse(read('ring-rare-01'))
    const p = preset(item)
    const row = toggles(item, p)[0]
    row.disabled = false // 使用者已勾選這條
    const before = JSON.stringify(createTradeRequest(p))
    expect(enabledIds(createTradeRequest(p))).toContain(LIFE_EXPLICIT)
    applyFracturedToggle(p.stats, row, true)
    expect(isFracturedOn(row)).toBe(true)
    const on = enabledIds(createTradeRequest(p))
    expect(on).toContain(LIFE_FRACTURED)
    expect(on).not.toContain(LIFE_EXPLICIT)
    applyFracturedToggle(p.stats, row, false)
    expect(JSON.stringify(createTradeRequest(p))).toBe(before)
  })

  for (const [label, text, rowRef, baseId, fracId] of [
    ['explicit 列', ringPhys, PHYS, PHYS_EXPLICIT, PHYS_FRACTURED]
  ] as const) {
    it(`${label}:切換後送 fractured id,再點換回與原查詢逐字相同`, () => {
      const item = parse(text())
      const p = preset(item)
      const row = toggles(item, p).find(f => f.statRef === rowRef)!
      row.disabled = false // 使用者已勾選這條
      const before = JSON.stringify(createTradeRequest(p))
      expect(enabledIds(createTradeRequest(p))).toContain(baseId)

      applyFracturedToggle(p.stats, row, true)
      expect(isFracturedOn(row)).toBe(true)
      const on = enabledIds(createTradeRequest(p))
      expect(on).toContain(fracId)
      expect(on).not.toContain(baseId)

      applyFracturedToggle(p.stats, row, false)
      expect(isFracturedOn(row)).toBe(false)
      expect(JSON.stringify(createTradeRequest(p))).toBe(before)
    })
  }

  it('沒勾選的列按破裂會一併勾選', () => {
    const item = parse(ringPhys())
    const p = preset(item)
    const row = toggles(item, p)[0]
    expect(row.disabled).toBe(true)
    applyFracturedToggle(p.stats, row, true)
    expect(row.disabled).toBe(false)
    expect(enabledIds(createTradeRequest(p))).toContain(PHYS_FRACTURED)
  })

  it('已汙染的破裂物品(沒有隱藏孿生)同樣可切換', () => {
    const item = parse(corrupt(ringPhys()))
    expect(item.isCorrupted).toBe(true)
    const p = preset(item)
    expect(flat(p).some(f => f.tag === FilterTag.Fractured)).toBe(false)
    const row = toggles(item, p)[0]
    applyFracturedToggle(p.stats, row, true)
    expect(enabledIds(createTradeRequest(p))).toContain(PHYS_FRACTURED)
  })
})

describe('T11 PoE1 孿生條件不重複', () => {
  for (const [label, text, rowRef, twinRef, fracId] of [
    ['explicit 列', ringPhys, PHYS, PHYS, PHYS_FRACTURED]
  ] as const) {
    it(`${label}:打開後隱藏孿生取消勾選,fractured id 只送一次`, () => {
      const item = parse(text())
      const p = preset(item)
      const all = flat(p)
      const row = toggles(item, p).find(f => f.statRef === rowRef)!
      const twin = all.find(f => f.statRef === twinRef && f.tag === FilterTag.Fractured)!
      twin.disabled = false // 使用者從隱藏清單勾了孿生
      applyFracturedToggle(p.stats, row, true)
      expect(twin.disabled).toBe(true)
      expect(all.filter(f => !f.disabled && f.tradeId.includes(fracId))).toEqual([row])
      expect(enabledIds(createTradeRequest(p)).filter(id => id === fracId).length).toBe(1)
    })
  }
})
