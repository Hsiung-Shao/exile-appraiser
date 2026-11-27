import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { mechanismVisible } from '@/web/price-check/filters/mechanism-toggle'
import type { StatFilter } from '@/web/price-check/filters/interfaces'
import { createPresets, createTradeRequest } from '../src/index'

// 2026-11-28 使用者回報(截圖組的樣本):已汙染寶石選「已汙染」仍混進未汙染;破裂暴擊率的單手錘找不到「查破裂」的切換
const doc = (name: string) => fs.readFileSync(path.resolve(__dirname, 'docs', name), 'utf8')

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'cmn-Hant' as const, searchStatRange: 10,
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

describe('汙染篩選照按鈕送出', () => {
  beforeAll(async () => {
    await init('cmn-Hant')
    await loadForLang('cmn-Hant')
  }, 180_000)

  it('已汙染寶石預設送 corrupted = true', () => {
    const preset = activePreset(parse(doc('corrupted-gem-rf.cmn-Hant.txt')))
    expect(corrupted(createTradeRequest(preset).query)).toEqual({ option: 'true' })
  })

  it('已汙染寶石切成未汙染送 corrupted = false', () => {
    const preset = activePreset(parse(doc('corrupted-gem-rf.cmn-Hant.txt')))
    preset.filters.corrupted!.value = false
    expect(corrupted(createTradeRequest(preset).query)).toEqual({ option: 'false' })
  })

  it('破裂暴擊率那列不開機制開關也顯示破裂選項', () => {
    const preset = activePreset(parse(doc('fractured-crit-mace.cmn-Hant.txt')))
    const rows = preset.stats.filter((s): s is StatFilter => !s.group && s.text === '增加 #% 暴擊率' && s.hidden == null)
    expect(rows).toHaveLength(1)
    expect(mechanismVisible(rows[0], false)).toBe(true)
  })

  it('一般隨機詞綴列在機制開關關著時不顯示', () => {
    const preset = activePreset(parse(doc('fractured-crit-mace.cmn-Hant.txt')))
    const cold = preset.stats.find((s): s is StatFilter => !s.group && s.text === '附加 # 至 # 冰冷傷害')!
    expect(mechanismVisible(cold, false)).toBe(false)
    expect(mechanismVisible(cold, true)).toBe(true)
  })
})
