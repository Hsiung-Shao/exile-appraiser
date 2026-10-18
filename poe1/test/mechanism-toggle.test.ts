import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { ModifierType } from '@/parser/modifiers'
import { FilterTag, type FilterPreset, type StatFilter } from '@/web/price-check/filters/interfaces'
import { createPresets, createTradeRequest } from '../src/index'

// 查價面板「詞綴全部列出 + 統一機制選擇」(PoE1,計畫 rustling-shimmying-charm M5、M6–M11、M15)。
// 2026-10-16 契約變更:「一般」只排除這列來源本身的機制(破裂 / 工藝),一般隨機列不排除。
// PoE1 只考慮破裂 / 工藝。新模組 mechanism-toggle 用動態 import:還沒實作時呈現為斷言失敗。
const MOD_PATH = '@/web/price-check/filters/mechanism-toggle'
async function mech (): Promise<any> {
  let m: any = null
  try {
    m = await import(/* @vite-ignore */ MOD_PATH)
  } catch {
    m = null
  }
  for (const fn of ['mechanismOptions', 'mechanismMode', 'selectMechanism']) {
    expect(m?.[fn], `mechanism-toggle 模組尚未提供 ${fn}`).toBeTypeOf('function')
  }
  return m
}

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'en' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

// 自造稀有戒指:生命 + 火焰 / 冰冷抗性全被偽屬性合計吃掉
const RING = `Item Class: Rings
Rarity: Rare
Doom Loop
Ruby Ring
--------
Requirements:
Level: 40
--------
Item Level: 84
--------
{ Prefix Modifier "Rapturous" (Tier: 3) — Life }
+68(60-69) to maximum Life
{ Suffix Modifier "of the Salamander" (Tier: 2) — Elemental, Fire, Resistance }
+40(36-41)% to Fire Resistance
{ Suffix Modifier "of the Polar Bear" (Tier: 3) — Elemental, Cold, Resistance }
+33(30-35)% to Cold Resistance
`
// 破裂生命(可見 explicit 列)+ 工藝冰冷抗性(Master Crafted,被偽屬性吃掉)
const CRAFTED_RING = fs.readFileSync(path.join(__dirname, 'fixtures/en/ring-rare-01.txt'), 'utf8').replace(/\r\n/g, '\n')

const LIFE = '+# to maximum Life'
const FIRE = '+#% to Fire Resistance'
const COLD = '+#% to Cold Resistance'
const N = { life: '3299347043', fire: '3372524247', cold: '4220027924' }
const id = (mech: string, n: string) => `${mech}.stat_${n}`

function build (text: string) {
  const item = parseClipboard(text)._unsafeUnwrap()
  const { presets, active } = createPresets(item, OPTS)
  const preset: FilterPreset = presets.find(p => p.id === active) ?? presets[0]
  const stats = preset.stats.filter(s => !s.group) as StatFilter[]
  return { item, preset, stats }
}
function row (stats: StatFilter[], ref: string, srcType: ModifierType, visible = false): StatFilter | undefined {
  return stats.find(f =>
    f.statRef === ref &&
    f.tag !== FilterTag.Pseudo &&
    f.tag !== FilterTag.Property &&
    (!visible || f.hidden == null) &&
    f.sources.length > 0 &&
    f.sources.every(s => s.modifier.info.type === srcType))
}
const groupsOf = (preset: FilterPreset): any[] => createTradeRequest(preset).query.stats as any[]
const sentIds = (groups: any[]): string[] => groups.flatMap(g => g.filters.map((f: any) => f.id))
const enabledIds = (groups: any[]): string[] => groups
  .filter(g => !g.disabled && g.type !== 'not')
  .flatMap(g => g.filters.filter((f: any) => !f.disabled).map((f: any) => f.id))
const notGroups = (groups: any[]) => groups.filter(g => g.type === 'not')
const notIds = (groups: any[]): string[] => notGroups(groups).flatMap(g => g.filters.map((f: any) => f.id))

beforeAll(async () => { await init('en') })

describe('PoE1 詞綴全部列出', () => {
  it('M5 被偽屬性吃掉的生命、火焰、冰冷抗性各有可見未勾選的列並標 fromAggregate', () => {
    const { stats } = build(RING)
    for (const ref of [LIFE, FIRE, COLD]) {
      const f = row(stats, ref, ModifierType.Explicit, true)
      expect(f, `${ref} 應有自己的可見列`).toBeDefined()
      expect(f!.disabled).toBe(true)
      expect((f as any).fromAggregate).toBe(true)
    }
  })

  it('M5 預設查詢不送新列出的詞綴、偽屬性勾選照舊、沒有 not 群組', () => {
    const { preset, stats } = build(RING)
    expect(stats.filter(f => (f as any).fromAggregate === true).length, '應有 fromAggregate 新列').toBeGreaterThanOrEqual(3)
    const groups = groupsOf(preset)
    for (const n of [N.life, N.fire, N.cold]) expect(sentIds(groups)).not.toContain(id('explicit', n))
    expect(enabledIds(groups)).toEqual(expect.arrayContaining(['pseudo.pseudo_total_elemental_resistance', 'pseudo.pseudo_total_life']))
    expect(notGroups(groups)).toHaveLength(0)
  })

  it('M5 被偽屬性吃掉的工藝冰冷抗性也有可見未勾選的列', () => {
    const { stats } = build(CRAFTED_RING)
    const f = row(stats, COLD, ModifierType.Crafted, true)
    expect(f, '工藝冰冷抗性應有自己的可見列').toBeDefined()
    expect(f!.disabled).toBe(true)
  })
})

describe('PoE1 機制選項', () => {
  it('M6 破裂生命列只列不限 / 一般 / 破裂 / 工藝', async () => {
    const m = await mech()
    const { stats } = build(CRAFTED_RING)
    const life = row(stats, LIFE, ModifierType.Fractured, true)
    expect(life).toBeDefined()
    expect(m.mechanismOptions(life)).toEqual(['any', 'normal', 'fractured', 'crafted'])
  })

  it('M7 有固定 id 的生命不列 implicit,也沒有褻瀆 / 增幅', async () => {
    const m = await mech()
    const { stats } = build(CRAFTED_RING)
    const opts = m.mechanismOptions(row(stats, LIFE, ModifierType.Fractured, true)) as string[]
    expect(opts).not.toContain('implicit')
    expect(opts).not.toContain('enchant')
    expect(opts).not.toContain('desecrated')
    expect(opts).not.toContain('rune')
  })

  it('M6 pseudo 列不給選項', async () => {
    const m = await mech()
    const { stats } = build(CRAFTED_RING)
    const pseudo = stats.find(f => f.tag === FilterTag.Pseudo && f.hidden == null)!
    expect(m.mechanismOptions(pseudo)).toEqual([])
  })

  it('M11 工藝冰冷抗性列預設為工藝', async () => {
    const m = await mech()
    const { stats } = build(CRAFTED_RING)
    const f = row(stats, COLD, ModifierType.Crafted)
    expect(f, '工藝冰冷抗性應有列').toBeDefined()
    expect(f!.tradeId).toEqual([id('crafted', N.cold)])
    expect(m.mechanismMode(f)).toBe('crafted')
    expect(m.mechanismDefault(f)).toBe('crafted')
    expect(m.mechanismOptions(f)).toEqual(['any', 'normal', 'fractured', 'crafted'])
  })

  it('M18 破裂生命列(送 explicit id)預設為不限(2026-10-18)', async () => {
    const m = await mech()
    const { stats } = build(CRAFTED_RING)
    const life = row(stats, LIFE, ModifierType.Fractured, true)!
    expect(m.mechanismMode(life)).toBe('any')
    expect(m.mechanismDefault(life)).toBe('any')
  })
})

describe('PoE1 選機制與一般模式排除', () => {
  it('M8 生命選工藝改送 crafted id 並勾選,選破裂改送 fractured id,選回一般送回 explicit', async () => {
    const m = await mech()
    const { preset, stats } = build(CRAFTED_RING)
    const life = row(stats, LIFE, ModifierType.Fractured, true)!
    m.selectMechanism(stats, life, 'crafted')
    expect(life.tradeId).toEqual([id('crafted', N.life)])
    expect(life.disabled).toBe(false)
    expect(enabledIds(groupsOf(preset))).toContain(id('crafted', N.life))
    m.selectMechanism(stats, life, 'fractured')
    expect(life.tradeId).toEqual([id('fractured', N.life)])
    expect(m.mechanismMode(life)).toBe('fractured')
    m.selectMechanism(stats, life, 'normal')
    expect(life.tradeId).toEqual([id('explicit', N.life)])
    expect(life.disabled).toBe(false)
  })

  it('M9 勾選一般的破裂生命:not 群組恰好只含破裂 id', async () => {
    const m = await mech()
    const { preset, stats } = build(CRAFTED_RING)
    const life = row(stats, LIFE, ModifierType.Fractured, true)!
    m.selectMechanism(stats, life, 'normal')
    life.disabled = false
    const groups = groupsOf(preset)
    expect(enabledIds(groups)).toContain(id('explicit', N.life))
    expect(notGroups(groups)).toHaveLength(1)
    expect(notIds(groups)).toEqual([id('fractured', N.life)])
  })

  it('M18 勾選不限(預設)的破裂生命:沒有 not 群組;選一般再選回不限也一樣', async () => {
    const m = await mech()
    const { preset, stats } = build(CRAFTED_RING)
    const life = row(stats, LIFE, ModifierType.Fractured, true)!
    life.disabled = false
    let groups = groupsOf(preset)
    expect(enabledIds(groups)).toContain(id('explicit', N.life))
    expect(notGroups(groups)).toHaveLength(0)
    m.selectMechanism(stats, life, 'normal')
    expect(m.mechanismMode(life)).toBe('normal')
    expect(notGroups(groupsOf(preset))).toHaveLength(1)
    m.selectMechanism(stats, life, 'any')
    expect(m.mechanismMode(life)).toBe('any')
    groups = groupsOf(preset)
    expect(life.tradeId).toEqual([id('explicit', N.life)])
    expect(notGroups(groups)).toHaveLength(0)
  })

  it('M10 破裂生命與工藝冰冷抗性都勾選一般:合併成一個 not 群組、各只含自己的機制 id', async () => {
    const m = await mech()
    const { preset, stats } = build(CRAFTED_RING)
    const life = row(stats, LIFE, ModifierType.Fractured, true)!
    const cold = row(stats, COLD, ModifierType.Crafted)
    expect(cold, '工藝冰冷抗性應有列').toBeDefined()
    for (const f of [life, cold!]) {
      m.selectMechanism(stats, f, 'normal')
      f.disabled = false
    }
    const groups = groupsOf(preset)
    expect(notGroups(groups)).toHaveLength(1)
    expect(notIds(groups).sort()).toEqual([id('crafted', N.cold), id('fractured', N.life)].sort())
  })

  it('M15 勾選一般隨機的生命、火焰抗性:不加任何 not 群組', async () => {
    await mech()
    const { preset, stats } = build(RING)
    for (const ref of [LIFE, FIRE]) {
      const f = row(stats, ref, ModifierType.Explicit, true)
      expect(f, `${ref} 應有可見列`).toBeDefined()
      f!.disabled = false
    }
    const groups = groupsOf(preset)
    expect(enabledIds(groups)).toEqual(expect.arrayContaining([id('explicit', N.life), id('explicit', N.fire)]))
    expect(notGroups(groups)).toHaveLength(0)
  })

  it('M9 勾選但模式為工藝的列不產生 not 群組', async () => {
    const m = await mech()
    const { preset, stats } = build(CRAFTED_RING)
    const cold = row(stats, COLD, ModifierType.Crafted)
    expect(cold, '工藝冰冷抗性應有列').toBeDefined()
    m.selectMechanism(stats, cold, 'crafted')
    expect(cold!.disabled).toBe(false)
    expect(notGroups(groupsOf(preset))).toHaveLength(0)
  })
})
