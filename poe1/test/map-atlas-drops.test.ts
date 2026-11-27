import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { createExactStatFilters } from '@/web/price-check/filters/create-stat-filters'
import type { StatFilter } from '@/web/price-check/filters/interfaces'
import { createPresets, createTradeRequest } from '../src/index'

/**
 * 3.30 地圖新增「輿圖掉落物」、「更多聖甲蟲」改名「更多 綢帶」(2026-11-16;2026-11-26 起綢帶只讀不送)。
 * 樣本是使用者實機貼上的繁中文字;英文客戶端那張是合成的(見下方 M7),沒有實機樣本。
 */
const FIXTURE = path.resolve(__dirname, 'fixtures/filter-visibility/map-t16-330-atlas-drops.txt')

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'cmn-Hant' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

function parse (text: string): ParsedItem {
  const result = parseClipboard(text)
  if (result.isErr()) throw new Error(`解析失敗:${result.error}`)
  return result.value
}

function request (item: ParsedItem): any {
  const { presets, active } = createPresets(item, OPTS)
  return createTradeRequest(presets.find(p => p.id === active) ?? presets[0])
}

function statIds (req: any): string[] {
  return (req.query.stats as any[]).flatMap(g => g.filters.map((f: any) => f.id))
}

function shape (filters: StatFilter[]): Array<[string, string, boolean]> {
  return filters.map(f => [f.tag as string, f.statRef, f.disabled])
}

describe('3.30 地圖:輿圖掉落物與更多 綢帶', () => {
  let item: ParsedItem
  let filters: StatFilter[]

  beforeAll(async () => {
    await init('cmn-Hant')
    await loadForLang('cmn-Hant')
    item = parse(fs.readFileSync(FIXTURE, 'utf8'))
    filters = createExactStatFilters(item, item.statsByType, { searchStatRange: 10 })
  }, 180_000)

  // 失敗代表:parser 不認「輿圖掉落物」這行(欄位沒設)
  it('M1 3.30 地圖讀到輿圖掉落物', () => {
    expect((item as any).areaAtlasDrops).toBe(49)
  })

  // 失敗代表:條件沒產生 / 預設被勾選 / 勾選後沒寫進 map_bonus(2026-11-18 使用者:保留但預設不選)
  it('M2 輿圖掉落物保留但預設不勾,勾選後送 map_bonus', () => {
    expect(shape(filters)).toContainEqual(['property', 'Atlas Drops: +#%', true])
    const f = filters.find(x => x.statRef === 'Atlas Drops: +#%')!
    expect(f.tradeId).toEqual(['item.map_atlas_drops'])
    const { presets, active } = createPresets(item, OPTS)
    const preset = presets.find(p => p.id === active) ?? presets[0]
    const pf = (preset.stats as StatFilter[]).find(x => x.statRef === 'Atlas Drops: +#%')!
    expect(pf.disabled).toBe(true)
    expect((createTradeRequest(preset).query.filters as any)?.map_filters?.filters?.map_bonus).toBeUndefined()
    pf.disabled = false
    const min = (createTradeRequest(preset).query.filters as any)?.map_filters?.filters?.map_bonus?.min
    expect(typeof min).toBe('number')
    expect(min).toBeGreaterThan(0)
    expect(min).toBeLessThanOrEqual(49)
  })

  // 失敗代表:「更多 綢帶」被當成未知行,沒進 mapMoreScarabs
  it('M3 「更多 綢帶」讀成更多聖甲蟲欄位', () => {
    expect(item.mapMoreScarabs).toBe(35)
  })

  // 2026-11-26 使用者裁定:More Scarabs 是 3.30 已刪除的聖甲蟲條件(Discord 回報)→ 綢帶不送、不算更多掉落
  // 失敗代表:綢帶又被送成 More Scarabs pseudo
  it('M4 綢帶不送 pseudo,也不再出現 More Scarabs 列', () => {
    const s = shape(filters)
    expect(s.some(x => x[1] === 'More Scarabs: #%')).toBe(false)
    expect(statIds(request(item))).not.toContain('pseudo.pseudo_map_more_scarab_drops')
  })

  // 失敗代表:綢帶仍被當成更多掉落(只有綢帶時稀有度應預設勾選)
  it('M4b 只有綢帶(沒有其他更多掉落)時稀有度預設勾選', () => {
    const text = fs.readFileSync(FIXTURE, 'utf8')
      .replace(/^更多地圖: .*\r?\n/m, '').replace(/^更多通貨: .*\r?\n/m, '')
    const only = parse(text)
    expect(only.mapMoreMaps).toBeUndefined()
    expect(only.mapMoreCurrency).toBeUndefined()
    expect(only.mapMoreScarabs).toBe(35)
    const fs2 = createExactStatFilters(only, only.statsByType, { searchStatRange: 10 })
    expect(shape(fs2)).toContainEqual(['property', 'Item Rarity: +#%', false])
  })

  it('M2b 輿圖掉落物排在物品稀有度之前', () => {
    const refs = filters.map(f => f.statRef)
    expect(refs.indexOf('Atlas Drops: +#%')).toBeGreaterThanOrEqual(0)
    expect(refs.indexOf('Atlas Drops: +#%')).toBeLessThan(refs.indexOf('Item Rarity: +#%'))
  })
})
