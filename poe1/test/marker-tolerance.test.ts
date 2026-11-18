import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'

/**
 * 3.30 進階複製在帶入的名稱後面加 `(...)` 標記:
 * 不論標記在句中何處、前面有無空白,都要解析成與沒有標記相同的固定詞綴,且不得進未解析。
 *
 * ⚠ 兩個語系的資料集不能同時載入,所以 en 與 cmn-Hant 各用一個 describe 依序跑。
 */
function mapText (lang: 'en' | 'cmn-Hant', implicitLine: string): string {
  const lines = lang === 'en'
    ? [
        'Item Class: Maps', 'Rarity: Rare', 'Foul Bearing', 'Map (Tier 16)', '--------',
        'Item Quantity: +58% (augmented)', '--------', 'Item Level: 83', '--------',
        'Monster Level: 83', '--------', '{ Implicit Modifier }', implicitLine, '--------',
        '{ Suffix Modifier "of Frenzy" (Tier: 1) }', 'Monsters gain a Frenzy Charge on Hit'
      ]
    : [
        '物品種類: 地圖', '稀有度: 稀有', '毀滅祈願', '地圖（階級 16）', '--------',
        '物品數量: +81% (augmented)', '--------', '物品等級: 83', '--------',
        '怪物等級：83', '--------', '{ 固定詞綴 }', implicitLine, '--------',
        '{ 後綴 "狂怒之"(階層：1) }', '怪物擊中時獲得 1 顆狂怒球'
      ]
  return lines.join('\n') + '\n'
}

function parse (text: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`解析失敗:${r.error}\n${text}`)
  return r.value
}

/** 斷言固定詞綴解析成預期的交易站 id,且沒有任何未解析詞綴。 */
function expectImplicit (lang: 'en' | 'cmn-Hant', line: string, expectedId: string): void {
  const item = parse(mapText(lang, line))
  expect(item.unknownModifiers.map(u => u.text), `未解析詞綴:${line}`).toEqual([])
  const hit = item.statsByType.find(s => s.type === 'implicit')
  expect(hit, `找不到固定詞綴:${line}`).toBeDefined()
  expect(hit!.stat.trade.ids.implicit).toEqual([expectedId])
}

const CITADEL = 'implicit.stat_2563183002'
const OCCUPIED = 'implicit.stat_3624393862'

describe('(...) 標記容忍(en)', () => {
  beforeAll(async () => {
    await init('en')
    await loadForLang('en')
  })

  const citadels = [['Baran', 1], ['Veritania', 2], ['Al-Hezmin', 3], ['Drox', 4]] as const
  const citadelForms = [
    ["Citadel(...)", '標記緊貼句尾'],
    ["Citadel (...)", '標記前有一個空白'],
    ["Citadel", '沒有標記']
  ] as const

  describe.each(citadels)('T1 壁壘 %s', (name, n) => {
    it.each(citadelForms)(`Map contains ${name}'s %s(%s)`, (tail) => {
      expectImplicit('en', `Map contains ${name}'s ${tail}`, `${CITADEL}|${n}`)
    })
  })

  const occupiers = [['Enslaver', 1], ['Eradicator', 2], ['Constrictor', 3], ['Purifier', 4]] as const
  const occupyForms = [
    ['(...)', '標記緊貼名稱'],
    [' (...)', '標記前有一個空白'],
    ['', '沒有標記']
  ] as const

  describe.each(occupiers)('T2b 佔據 %s', (name, n) => {
    it.each(occupyForms)(`Map is occupied by The ${name}%s(%s)`, (mark) => {
      expectImplicit('en', `Map is occupied by The ${name}${mark}`, `${OCCUPIED}|${n}`)
    })
  })

  it('T2c 行尾接「 — Unscalable Value」結果相同', () => {
    expectImplicit('en', "Map contains Baran's Citadel(...) — Unscalable Value", `${CITADEL}|1`)
  })
})

describe('(...) 標記容忍(cmn-Hant)', () => {
  beforeAll(async () => {
    await init('cmn-Hant')
    await loadForLang('cmn-Hant')
  })

  const citadels = [['巴倫', 1], ['維羅提尼亞', 2], ['奧赫茲明', 3], ['圖拉克斯', 4]] as const
  const citadelForms = [
    ['的壁壘(...)', '標記緊貼句尾'],
    ['的壁壘 (...)', '標記前有一個空白'],
    ['的壁壘', '沒有標記']
  ] as const

  describe.each(citadels)('T1b 壁壘 %s', (name, n) => {
    it.each(citadelForms)(`地圖含有${name}%s(%s)`, (tail) => {
      expectImplicit('cmn-Hant', `地圖含有${name}${tail}`, `${CITADEL}|${n}`)
    })
  })

  const occupiers = [['奴役', 1], ['根除', 2], ['干擾', 3], ['淨化', 4]] as const
  const occupyForms = [
    ['(...)', '', '標記在名稱後、佔據前'],
    ['', '(...)', '標記在句尾'],
    ['', '', '沒有標記']
  ] as const

  describe.each(occupiers)('T2 佔據 %s', (name, n) => {
    it.each(occupyForms)(`地圖被異界．${name}%s佔據%s(%s)`, (mid, tail) => {
      expectImplicit('cmn-Hant', `地圖被異界．${name}${mid}佔據${tail}`, `${OCCUPIED}|${n}`)
    })
  })

  it('T2c 行尾接「 — 無法使用的值」結果相同', () => {
    expectImplicit('cmn-Hant', '地圖含有巴倫的壁壘(...) — 無法使用的值', `${CITADEL}|1`)
  })
})
