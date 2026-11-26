// GitHub issue #76 / #77 — 英文客戶端(#76 是實機樣本;#77 英文依 GGPK 字串組的)
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
const OPTS = { league: 'Standard', currency: null, collapseListings: 'api' as const, activateStockFilter: false, searchStatRange: 10, useEn: true, merchantOnly: false }
const parse = (file: string) => {
  const r = parseClipboard(fs.readFileSync(path.join(HERE, 'docs', file), 'utf8'))
  if (r.isErr()) throw new Error(r.error)
  return r.value
}

beforeAll(async () => {
  await init('en')
  await loadForLang('en')
})

describe('GitHub issue #76 Facetor\'s Lens(英文實機樣本)', () => {
  it('Stored Experience 送 misc_filters.stored_experience.min', () => {
    const item = parse('3.30-issue-76.en.txt')
    expect(item.storedExperience).toBe(500_000_000)
    const preset = createPresets(item, OPTS).presets[0]
    const q = createTradeRequest(preset.filters, preset.stats).query as { filters: any }
    expect(q.filters.misc_filters.filters.stored_experience).toEqual({ min: 500_000_000 })
  })
})

describe('GitHub issue #77 Pure Talent(英文)', () => {
  it('單職業寫法全部認得、不送通用詞綴 id', () => {
    const item = parse('3.30-issue-77-synth.en.txt')
    expect(item.unknownModifiers.map(m => m.text)).toEqual([])
    const preset = createPresets(item, OPTS).presets[0]
    expect((preset.stats as StatFilter[]).flatMap(f => f.tradeId ?? [])).toEqual([])
  })
})
