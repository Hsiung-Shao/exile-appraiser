import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { mechanismVisible } from '@/web/price-check/filters/mechanism-toggle'
import type { StatFilter } from '@/web/price-check/filters/interfaces'
import { createPresets, createTradeRequest } from '../../../../src/index'
import { setupTests } from '../../../vitest.setup'

// 2026-11-28 使用者要求 PoE2 比照 PoE1:「已汙染」照實篩;來源是破裂的詞綴列一律顯示機制切換
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../zhTW/fixtures/en')
const read = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf8')

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'en' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

function parse (text: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`)
  return r.value
}

function activePreset (item: ParsedItem) {
  const { presets, active } = createPresets(item, OPTS)
  return presets.find(p => p.id === active)!
}

const corrupted = (q: any) => q.filters?.misc_filters?.filters?.corrupted
// 卡瑪薩頭冠樣本把智慧後綴改成破裂
const fracturedTiara = () => parse(read('helmet-rare-kamasan-tiara-01.txt')
  .replace('{ Suffix Modifier "of Genius"', '{ Fractured Suffix Modifier "of Genius"'))

describe('PoE2 汙染篩選照按鈕送出、破裂列顯示機制切換', () => {
  beforeAll(async () => {
    setupTests({ language: 'en' })
    await init('en')
  }, 180_000)

  it('已汙染寶石預設送 corrupted = true', () => {
    const item = parse(read('gem-skill-01.txt'))
    expect(corrupted(createTradeRequest(activePreset(item), item).query)).toEqual({ option: 'true' })
  })

  it('已汙染裝備切成未汙染送 corrupted = false', () => {
    const item = fracturedTiara()
    const preset = activePreset(item)
    expect(corrupted(createTradeRequest(preset, item).query)).toEqual({ option: 'true' })
    preset.filters.corrupted!.value = false
    expect(corrupted(createTradeRequest(preset, item).query)).toEqual({ option: 'false' })
  })

  it('破裂智慧那列不開機制開關也顯示', () => {
    const row = activePreset(fracturedTiara()).stats
      .find((s: StatFilter) => s.text === '# to Intelligence')!
    expect(mechanismVisible(row, false)).toBe(true)
  })

  it('一般隨機詞綴列在機制開關關著時不顯示', () => {
    const row = activePreset(fracturedTiara()).stats
      .find((s: StatFilter) => s.text === '#% to Chaos Resistance')!
    expect(mechanismVisible(row, false)).toBe(false)
    expect(mechanismVisible(row, true)).toBe(true)
  })
})
