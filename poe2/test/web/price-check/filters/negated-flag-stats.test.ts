import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import type { StatFilter } from '@/web/price-check/filters/interfaces'
import { createPresets, createTradeRequest } from '../../../../src/index'
import { setupTests } from '../../../vitest.setup'

// 2026-11-28 使用者回報:物品上「敵人擊中你的閃電傷害相當不幸」,查價器顯示「相當幸運」。
// 沒有數字的反向寫法(不幸 / 厄運):交易站同一個 id,不幸 = 負值(實查 max -1 有物品、min 1 沒有)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const LUCKY_ID = 'explicit.stat_4224965099'

const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'cmn-Hant' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

const item = (lines: string[], head: string[]) => [...head, '--------', '物品等級: 80', '--------', ...lines].join('\r\n') + '\r\n'
const ZH_HEAD = ['物品種類: 胸甲', '稀有度: 稀有', '災厄 外衣', '符煉華貴環甲']
const EN_HEAD = ['Item Class: Body Armours', 'Rarity: Rare', 'Doom Shell', 'Runemastered Ornate Ringmail']

function parse (text: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`)
  return r.value
}
/** 勾起那條詞綴的列 → 回傳列與查詢裡它的 filter */
function rowAndQuery (it: ParsedItem, ids: string[]) {
  const { presets, active } = createPresets(it, OPTS)
  const preset = presets.find(p => p.id === active)!
  const row = preset.stats.find((s: StatFilter) => ids.includes(s.statRef ? (s as any).tradeId?.[0] ?? '' : '') || (s as any).tradeId?.some((x: string) => ids.includes(x)))
  if (!row) throw new Error('找不到詞綴列:' + preset.stats.map((s: any) => s.text).join(' | '))
  row.disabled = false
  const q = createTradeRequest(preset, it).query
  const f = q.stats.flatMap((g: any) => g.filters).find((x: any) => ids.includes(x.id))
  return { row, f }
}

describe('沒有數字的反向詞綴(繁中)', () => {
  beforeAll(async () => {
    setupTests({ language: 'cmn-Hant' })
    await init('cmn-Hant')
  }, 180_000)

  it('L1 不幸的詞綴篩選列顯示原句', () => {
    const { row } = rowAndQuery(parse(item(['敵人擊中你的閃電傷害相當不幸'], ZH_HEAD)), [LUCKY_ID])
    expect(row.text).toBe('敵人擊中你的閃電傷害相當不幸')
  })

  it('L2 不幸的詞綴查詢只查負值', () => {
    const { f } = rowAndQuery(parse(item(['敵人擊中你的閃電傷害相當不幸'], ZH_HEAD)), [LUCKY_ID])
    expect(f.value).toEqual({ max: -1 })
  })

  it('L3 幸運寫法不變:原句、不帶範圍', () => {
    const { row, f } = rowAndQuery(parse(item(['敵人擊中你的閃電傷害相當幸運'], ZH_HEAD)), [LUCKY_ID])
    expect(row.text).toBe('敵人擊中你的閃電傷害相當幸運')
    expect(f.value?.min ?? null).toBe(null)
    expect(f.value?.max ?? null).toBe(null)
  })

  it('L5 同類的反向寫法都適用(文字是反向原句、查詢帶 max -1)', () => {
    const rows = fs.readFileSync(path.join(ROOT, 'data/poe2/cmn-Hant/stats.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))
    const cases = rows.flatMap((s: any) => (s.matchers ?? [])
      // 同一條詞綴另有正向寫法的才算(只有一種寫法的「沒有能力值需求」交易站是正值,見 L6)
      .filter((m: any) => m.negate && m.value == null && !m.string.includes('#') && !m.superseded &&
        s.matchers.some((x: any) => !x.negate && x.value == null && x.string !== m.string))
      .map((m: any) => ({ text: m.string as string, ids: Object.values(s.trade?.ids ?? {}).flat() as string[] })))
      .filter(c => c.ids.length)
    expect(cases.length).toBe(6)
    const bad: string[] = []
    for (const c of cases) {
      let got: { row: StatFilter, f: any }
      // 只有符文 id 的詞綴照遊戲寫法加「 (rune)」
      const lines = c.text.split('\n').map((l: string) => c.ids.every((id: string) => id.startsWith('rune.')) ? `${l} (rune)` : l)
      try { got = rowAndQuery(parse(item(lines, ZH_HEAD)), c.ids) } catch (e) { bad.push(`${c.text}:${(e as Error).message.slice(0, 60)}`); continue }
      if (got.row.text !== c.text || got.f?.value?.max !== -1) bad.push(`${c.text}:文字「${got.row.text}」、查詢 ${JSON.stringify(got.f?.value)}`)
    }
    expect(bad).toEqual([])
  })
})

describe('只有一種寫法的「沒有能力值需求」(繁中)', () => {
  beforeAll(async () => {
    setupTests({ language: 'cmn-Hant' })
    await init('cmn-Hant')
  }, 180_000)

  // 審查第 1 輪:資料只有標 negate 的一句,實查交易站 min 1 有 2685 筆、max -1 為 0 筆
  it('L6 裝備沒有能力值需求不帶 max -1', () => {
    const { f } = rowAndQuery(parse(item(['裝備沒有能力值需求'], ZH_HEAD)), ['explicit.stat_2480151124'])
    expect(f.value?.max ?? null).toBe(null)
  })
})

describe('沒有數字的反向詞綴(英文)', () => {
  beforeAll(async () => {
    setupTests({ language: 'en' })
    await init('en')
  }, 180_000)

  it('L4 英文 Unlucky 與繁中查詢相同(max -1)', () => {
    const { row, f } = rowAndQuery(parse(item(['Lightning Damage of Enemies Hitting you is Unlucky'], EN_HEAD)), [LUCKY_ID])
    expect(row.text).toBe('Lightning Damage of Enemies Hitting you is Unlucky')
    expect(f.value).toEqual({ max: -1 })
  })
})
