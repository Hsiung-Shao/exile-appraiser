import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import { createPresets } from '@/web/price-check/filters/create-presets'
import { createTradeRequest } from '@/web/price-check/trade/pathofexile-trade'
import { MERCENARY_FILTER_LIMIT, queryComplexity } from '@/web/price-check/trade/query-complexity'
import type { FilterGroup, StatFilter } from '@/web/price-check/filters/interfaces'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OPTS = { league: 'Standard', currency: null, collapseListings: 'api' as const, activateStockFilter: false, searchStatRange: 10, useEn: false, merchantOnly: false }
const presetOf = (n: string) => {
  const r = parseClipboard(fs.readFileSync(path.join(HERE, `docs/3.30-issue-${n}.cmn-Hant.txt`), 'utf8'))
  if (r.isErr()) throw new Error(r.error)
  return createPresets(r.value, OPTS).presets[0]
}

beforeAll(async () => {
  await init('cmn-Hant')
  await loadForLang('cmn-Hant')
})

describe('GitHub issue #62 / #63', () => {
  it('#62 史記的毀滅神殿(階級 3)列出來可勾、預設不勾', () => {
    const rooms = presetOf('62').stats as StatFilter[]
    const shrine = rooms.find(f => f.statRef === 'Has Room: Shrine of Unmaking (Tier 3)')
    expect(shrine).toBeDefined()
    expect(shrine!.disabled).toBe(true)
  })

  it('#63 傭兵條件合計超過 4 條就提醒(實測 5 條被拒),停用的群組不算', () => {
    expect(MERCENARY_FILTER_LIMIT).toBe(4)
    const q = (n: number, disabled = false) => ({ stats: [{ type: 'mercenary', disabled, filters: Array(n).fill({ id: 'x' }) }] })
    expect(queryComplexity(q(4))).toBeNull()
    expect(queryComplexity(q(5))).toEqual({ kind: 'mercenary', count: 5, limit: 4 })
    expect(queryComplexity(q(9, true))).toBeNull()
    // 啟用群組裡沒勾的條件(disabled)不算
    expect(queryComplexity({ stats: [{ type: 'mercenary', filters: [{}, {}, { disabled: true }, { disabled: true }, { disabled: true }] }] })).toBeNull()
  })

  it('#63 實機契約書:預設不提醒;只勾一個技能 + 一個輔助不提醒;勾兩個技能(各帶輔助)後提醒', () => {
    const preset = presetOf('63')
    expect(queryComplexity(createTradeRequest(preset.filters, preset.stats).query)).toBeNull()
    // 挑輔助最多的群組(煉獄之擊):沒勾的輔助若被算進去就會超過 4
    const one = preset.stats.filter((s): s is FilterGroup => s.group === 'mercenary').sort((x, y) => y.stats.length - x.stats.length)[0]
    one.meta.disabled = false
    one.stats.find(s => s.tradeId[0].startsWith('mercenary.support_'))!.disabled = false
    expect(queryComplexity(createTradeRequest(preset.filters, preset.stats).query)).toBeNull()
    const skills = preset.stats.filter((s): s is FilterGroup => s.group === 'mercenary').slice(0, 2)
    for (const g of skills) {
      g.meta.disabled = false
      for (const s of g.stats) s.disabled = false
    }
    expect(queryComplexity(createTradeRequest(preset.filters, preset.stats).query)?.kind).toBe('mercenary')
  })
})

describe('GitHub issue #75', () => {
  it('#75 史記地區等級 84 照原值查,不往下截成 80', () => {
    const preset = presetOf('75')
    expect(preset.filters.areaLevel?.value).toBe(84)
    expect((createTradeRequest(preset.filters, preset.stats).query as any).filters.map_filters.filters.area_level.min).toBe(84)
  })

  it('#75 探險日誌地區等級 82 照原值查,不往下截成 81', () => {
    const text = ['物品種類: 探險日誌', '稀有度: 魔法', '探險日誌', '--------', '物品等級: 82', '--------', '地區等級: 82',
      '--------', 'Testing Grounds', '豔陽騎士', 'Testing Grounds (implicit)'].join('\r\n') + '\r\n'
    const r = parseClipboard(text)
    if (r.isErr()) throw new Error(r.error)
    const preset = createPresets(r.value, OPTS).presets[0]
    expect(preset.filters.areaLevel?.value).toBe(82)
    expect((createTradeRequest(preset.filters, preset.stats).query as any).filters.map_filters.filters.area_level.min).toBe(82)
  })
})
