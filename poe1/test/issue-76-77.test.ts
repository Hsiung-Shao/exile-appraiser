// GitHub issue #76(寶石匠的稜鏡「已儲存經驗」沒送進查詢)與 #77(純才 3.30 單職業寫法認不出)— 繁中客戶端
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import { createPresets } from '@/web/price-check/filters/create-presets'
import { createTradeRequest } from '@/web/price-check/trade/pathofexile-trade'
import type { StatFilter } from '@/web/price-check/filters/interfaces'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OPTS = { league: 'Standard', currency: null, collapseListings: 'api' as const, activateStockFilter: false, searchStatRange: 10, useEn: false, merchantOnly: false }
const parse = (file: string) => {
  const r = parseClipboard(fs.readFileSync(path.join(HERE, 'docs', file), 'utf8'))
  if (r.isErr()) throw new Error(r.error)
  return r.value
}

beforeAll(async () => {
  await init('cmn-Hant')
  await loadForLang('cmn-Hant')
})

describe('GitHub issue #77 純才(繁中實機樣本)', () => {
  it('3.30 單職業寫法全部認得,沒有未解析詞綴', () => {
    const item = parse('3.30-issue-77.cmn-Hant.txt')
    expect(item.unknownModifiers.map(m => m.text)).toEqual([])
  })
  it('第二行不再被當成通用詞綴送出錯的 id(攻擊偷取生命、暴擊率…)', () => {
    const preset = createPresets(parse('3.30-issue-77.cmn-Hant.txt'), OPTS).presets[0]
    const ids = (preset.stats as StatFilter[]).flatMap(f => f.tradeId ?? [])
    expect(ids).toEqual([])
    const q = createTradeRequest(preset.filters, preset.stats).query
    expect(JSON.stringify(q.stats)).not.toContain('explicit.')
  })
})

describe('GitHub issue #76 寶石匠的稜鏡(繁中,依 GGPK 字串組的樣本)', () => {
  it('解析已儲存經驗(千分位逗號)並以原值當最低值查', () => {
    const item = parse('3.30-issue-76-synth.cmn-Hant.txt')
    expect(item.storedExperience).toBe(500_000_000)
    const preset = createPresets(item, OPTS).presets[0]
    expect(preset.filters.storedExperience).toEqual({ value: 500_000_000, disabled: false })
    const q = createTradeRequest(preset.filters, preset.stats).query as { filters: any }
    expect(q.filters.misc_filters.filters.stored_experience).toEqual({ min: 500_000_000 })
  })
})
