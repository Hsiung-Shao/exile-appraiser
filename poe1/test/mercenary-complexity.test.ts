import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { createPresets } from '@/web/price-check/filters/create-presets'
import { createTradeRequest } from '@/web/price-check/trade/pathofexile-trade'
import { countQueryFilters, isQueryTooComplex, QUERY_FILTER_LIMIT } from '@/web/price-check/trade/query-complexity'
import type { FilterGroup, FilterPreset } from '@/web/price-check/filters/interfaces'
import { runFixture, FIXTURES_DIR } from './helpers/fixture-harness'

// 2026-11-18 使用者要求:查傭兵契約書時,條件多到可能被交易站拒絕(Query is too complex)要提醒
const SAMPLE = path.join(FIXTURES_DIR, 'synthetic', 'mercenary-warrant-spark-5supports.txt')
const OPTS = { league: 'Standard', currency: null, collapseListings: 'api' as const, activateStockFilter: false, searchStatRange: 10, useEn: false, merchantOnly: false }

let preset: FilterPreset
let spark: FilterGroup

beforeAll(async () => {
  await init('cmn-Hant')
  await loadForLang('cmn-Hant')
  const outcome = runFixture({ name: 'mercenary-warrant-spark-5supports', language: 'cmn-Hant', text: fs.readFileSync(SAMPLE, 'utf8'), expectedPath: '' })
  if (outcome.kind !== 'parsed') throw new Error(outcome.error)
  preset = createPresets(outcome.item, OPTS).presets[0]
  spark = preset.stats.find((s): s is FilterGroup => s.group === 'mercenary' && s.meta.statRef === 'Spark')!
})

const count = () => countQueryFilters(createTradeRequest(preset.filters, preset.stats).query)

describe('查詢條件數(交易站複雜度提醒)', () => {
  it('門檻是 30(實測 30 條以內匿名可查、43 條被拒)', () => {
    expect(QUERY_FILTER_LIMIT).toBe(30)
  })

  it('只算有啟用的群組裡的條件', () => {
    const q = { stats: [{ type: 'and', filters: [{ id: 'a' }, { id: 'b' }] }, { type: 'and', disabled: true, filters: [{ id: 'c' }] }] }
    expect(countQueryFilters(q as any)).toBe(2)
    expect(isQueryTooComplex(q as any)).toBe(false)
  })

  it('預設篩選不超過門檻;勾了電球 6 連結後超過、提醒', () => {
    expect(isQueryTooComplex(createTradeRequest(preset.filters, preset.stats).query)).toBe(false)
    spark.meta.disabled = false
    spark.stats.find(s => s.tradeId[0] === 'item.mercenary_6link')!.disabled = false
    expect(count()).toBeGreaterThan(QUERY_FILTER_LIMIT)
    expect(isQueryTooComplex(createTradeRequest(preset.filters, preset.stats).query)).toBe(true)
  })
})
