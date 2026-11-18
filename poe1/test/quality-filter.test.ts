import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { createPresets, createTradeRequest } from '../src/index'

// 2026-11-18 使用者:武器 / 防具查價時品質要能自己輸入(例:只看高品質的價格);樣本是使用者實機貼上的稀有胸甲
const FIXTURE = path.resolve(__dirname, 'fixtures/quality/body-armour-q20-rare.txt')

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'cmn-Hant' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

function parse (text: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`)
  return r.value
}

const quality = (q: any) => q.filters?.misc_filters?.filters?.quality

describe('武器 / 防具的品質條件', () => {
  let item: ParsedItem

  beforeAll(async () => {
    await init('cmn-Hant')
    await loadForLang('cmn-Hant')
    item = parse(fs.readFileSync(FIXTURE, 'utf8'))
  }, 180_000)

  // 失敗代表:偽屬性預設下沒有品質膠囊可調(原本只有精確預設才有)
  it('Q1 每個預設都有品質條件,值 = 物品品質、預設不勾、不送查詢', () => {
    const { presets } = createPresets(item, OPTS)
    for (const p of presets) {
      expect(p.filters.quality, p.id).toEqual({ value: 20, disabled: true })
      expect(quality(createTradeRequest(p).query), p.id).toBeUndefined()
    }
  })

  // 失敗代表:輸入的品質沒送到 misc_filters.quality.min
  it('Q2 勾選並改成 28 後送 quality.min = 28', () => {
    const { presets, active } = createPresets(item, OPTS)
    const preset = presets.find(p => p.id === active)!
    preset.filters.quality!.disabled = false
    preset.filters.quality!.value = 28
    expect(quality(createTradeRequest(preset).query)).toEqual({ min: 28 })
  })

  // 失敗代表:沒有品質行的裝備就沒有膠囊,想查高品質版本時無處輸入
  it('Q3 沒有品質的防具也有品質條件(值 0、預設不勾)', () => {
    const text = fs.readFileSync(FIXTURE, 'utf8').replace(/品質: \+20% \(augmented\)\r?\n/, '')
    const noQ = parse(text)
    const { presets, active } = createPresets(noQ, OPTS)
    expect(presets.find(p => p.id === active)!.filters.quality).toEqual({ value: 0, disabled: true })
  })

  // GitHub issue #31:品質 30% 的頭盔,想把品質和詞綴一起篩;失敗代表品質 > 20 時偽屬性預設沒自動勾品質
  it('Q4 品質超過 20(issue #31 的 30% 頭盔)每個預設都自動勾品質、送 quality.min = 30', async () => {
    await init('en')
    const helm = parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/quality/helmet-q30-issue-31.en.txt'), 'utf8'))
    const { presets } = createPresets(helm, { ...OPTS, clientLanguage: 'en' as const })
    for (const p of presets) {
      expect(p.filters.quality, p.id).toEqual({ value: 30, disabled: false })
      expect(quality(createTradeRequest(p).query), p.id).toEqual({ min: 30 })
    }
  }, 180_000)
})
