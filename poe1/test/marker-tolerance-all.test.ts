import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { ModifierType } from '@/parser/modifiers'
import { tryParseTranslation } from '@/parser/stat-translations'

/**
 * 3.30 進階複製在帶入的名稱後加不帶資訊的 `(...)`:
 * 資料裡舊式具名括號的進階寫法換成 `(...)`(前有無空白)都要回到原列,不明句子仍要顯示原文。
 *
 * ⚠ 兩個語系的資料集不能同時載入,所以 en 與 cmn-Hant 各用一個 describe 依序跑。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(HERE, '../../data/poe1')
const readDoc = (name: string): string => fs.readFileSync(path.join(HERE, 'docs', name), 'utf8')

const RSG = '(Random Support Gem)'

function parse (text: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`解析失敗:${r.error}\n${text}`)
  return r.value
}
const unknownOf = (item: ParsedItem): string[] => item.unknownModifiers.map(u => u.text)
/** 物品上每一條詞綴解析出的 stat ref(依詞綴逐條,不合併同 ref)。 */
const refsOf = (item: ParsedItem): string[] => {
  const fromMods = item.newMods.flatMap(m => m.stats.map(s => s.stat.ref))
  return fromMods.length ? fromMods : item.statsByType.map(s => s.stat.ref)
}
const rsgRefsOf = (item: ParsedItem): string[] => refsOf(item).filter(r => r.endsWith(RSG))

// 禁忌軍帽的繁中實機樣本(issue #43):兩條輔助寶石詞綴 + 全能力
const SHAKO_ZH = readDoc('3.30-issue-43.cmn-Hant.txt')

const SHAKO_EN = [
  'Item Class: Helmets', 'Rarity: Unique', 'Forbidden Shako', 'Great Crown', '--------',
  'Armour: 160', 'Energy Shield: 33', '--------',
  'Requirements:', 'Level: 68', 'Str: 59', 'Int: 59', '--------',
  'Sockets: W ', '--------', 'Item Level: 85', '--------',
  '{ Unique Modifier — Gem }',
  'Socketed Gems are Supported by Level 30(25-35) Efficacy(...)',
  '{ Unique Modifier — Attribute }',
  '+25(25-30) to all Attributes',
  '(Attributes are Strength, Dexterity, and Intelligence)'
].join('\n') + '\n'

const RARE_HELM_ZH = (modLine: string): string => [
  '物品種類: 頭部', '稀有度: 稀有', '末日皇冠', '強化巨盔', '--------',
  '物品等級: 85', '--------',
  '{ 後綴 "狂怒之"(階層：1) }', modLine
].join('\n') + '\n'

const UNIQUE_HELM_ZH = (modLine: string): string => [
  '物品種類: 頭部', '稀有度: 傳奇', '禁忌軍帽', '強化巨盔', '--------',
  '物品等級: 85', '--------',
  '{ 傳奇詞綴 }', modLine
].join('\n') + '\n'

const MONARCH_EN = [
  'Item Class: Helmets', 'Rarity: Unique', 'The Dark Monarch', "Lich's Circlet", '--------',
  'Energy Shield: 217 (augmented)', '--------',
  'Requirements:', 'Level: 84', 'Int: 224', '--------',
  'Sockets: B-B W', '--------', 'Item Level: 86', '--------',
  '{ Unique Modifier }',
  'Maximum number of Animated Weapons (...) is Doubled',
  'Cannot have Minions other than Animated Weapons (...)'
].join('\n') + '\n'

// 把進階寫法裡每個括號標記換成 (...):tight 緊貼前一個字、spaced 前面恰好一個空白
const MARKER = /\([^)#]*\)/
const MARKERS_G = / ?\([^)#]*\)/g
const variantsOf = (adv: string): Array<[string, string]> => [
  ['緊貼', adv.replace(MARKERS_G, '(...)')],
  ['一個空白', adv.replace(MARKERS_G, ' (...)')]
]

/** 資料檔一行 = 單一 stat,或群組(resolve + stats)。 */
interface DataStat { ref: string, matchers: Array<{ string: string, advanced?: string }>, trade: { ids: Record<string, string[]> } }
function readStatLines (lang: 'en' | 'cmn-Hant'): Array<{ refs: Set<string>, stats: DataStat[] }> {
  const text = fs.readFileSync(path.join(DATA_DIR, lang, 'stats.ndjson'), 'utf8')
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const obj = JSON.parse(line)
    const stats: DataStat[] = obj.stats ?? [obj]
    return { refs: new Set(stats.map(s => s.ref)), stats }
  })
}

/** M4:每個帶標記的進階寫法換成 (...) 都要回到原列;回傳檢查數與失敗清單。 */
function sweepMarkers (lang: 'en' | 'cmn-Hant'): { checked: number, failures: string[] } {
  let checked = 0
  const failures: string[] = []
  for (const { refs, stats } of readStatLines(lang)) {
    for (const stat of stats) {
      const modType = Object.keys(stat.trade?.ids ?? {})[0] as ModifierType | undefined
      if (!modType) continue
      // 主對話裁決(2026-11-20):傭兵列的括號是「(Tier: N)」階級、不是名稱標記,不在容錯範圍
      if ((stat as { mercenary?: unknown }).mercenary) continue
      const tag = modType
      for (const m of stat.matchers) {
        if (!m.advanced || !MARKER.test(m.advanced)) continue
        checked++
        for (const [kind, variant] of variantsOf(m.advanced)) {
          const found = tryParseTranslation({ string: variant, unscalable: false }, modType, undefined)
          if (!found) failures.push(`[${kind}/${tag}] 解析不到:${JSON.stringify(variant)}`)
          else if (!refs.has(found.stat.ref)) failures.push(`[${kind}/${tag}] 配到別列「${found.stat.ref}」:${JSON.stringify(variant)}`)
        }
      }
    }
  }
  return { checked, failures }
}

describe('(...) 標記容忍全量(en)', () => {
  beforeAll(async () => {
    await init('en')
    await loadForLang('en')
  })

  it('M2 英文同一句解析成隨機輔助寶石', () => {
    const item = parse(SHAKO_EN)
    expect(unknownOf(item)).toEqual([])
    expect(rsgRefsOf(item)).toHaveLength(1)
  })

  it('M4 en 每個帶標記的進階寫法換成 (...) 都回到原列', () => {
    const { checked, failures } = sweepMarkers('en')
    expect(checked, '實際檢查到的 matcher 數').toBeGreaterThan(1000)
    expect(failures, `失敗 ${failures.length} 條,前 20:\n${failures.slice(0, 20).join('\n')}`).toEqual([])
  }, 120_000)

  it('M6 兩行詞綴不被第一行搶走', () => {
    const item = parse(MONARCH_EN)
    expect(unknownOf(item)).toEqual([])
    expect(item.newMods.some(m => m.stats.some(s => s.translation.string.includes('\n')))).toBe(true)
  })
})

describe('(...) 標記容忍全量(cmn-Hant)', () => {
  beforeAll(async () => {
    await init('cmn-Hant')
    await loadForLang('cmn-Hant')
  })

  it('M1 禁忌軍帽的兩條輔助寶石詞綴可解析', () => {
    const item = parse(SHAKO_ZH)
    expect(unknownOf(item)).toEqual([])
    expect(rsgRefsOf(item)).toHaveLength(2)
  })

  it('M3 標記前有無空白都可解析', () => {
    const spaced = SHAKO_ZH.replaceAll('(...) 輔助', ' (...) 輔助')
    expect(spaced).not.toBe(SHAKO_ZH)
    const item = parse(spaced)
    expect(unknownOf(item)).toEqual([])
    expect(rsgRefsOf(item)).toEqual(rsgRefsOf(parse(SHAKO_ZH)))
    expect(rsgRefsOf(item)).toHaveLength(2)
  })

  it('M4 cmn-Hant 每個帶標記的進階寫法換成 (...) 都回到原列', () => {
    const { checked, failures } = sweepMarkers('cmn-Hant')
    expect(checked, '實際檢查到的 matcher 數').toBeGreaterThan(1000)
    expect(failures, `失敗 ${failures.length} 條,前 20:\n${failures.slice(0, 20).join('\n')}`).toEqual([])
  }, 120_000)

  it('M5 資料沒有進階寫法的詞綴加 (...) 仍可解析', () => {
    const item = parse(RARE_HELM_ZH('+25(25-30) 全能力(...)'))
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toContain('+# to all Attributes')
  })

  it('M7 沒有標記的不明句子仍是未解析', () => {
    const line = '這是一條不存在的詞綴 12'
    expect(unknownOf(parse(UNIQUE_HELM_ZH(line)))).toEqual([line])
  })

  it('M8 帶標記但仍不認得的句子未解析時顯示原文', () => {
    const line = '這是一條不存在的詞綴(...) 12'
    expect(unknownOf(parse(UNIQUE_HELM_ZH(line)))).toEqual([line])
  })

  it('N1 繁中客戶端顯示英文名的通貨可解析', () => {
    const text = readDoc('3.30-issue-46.cmn-Hant.txt')
    expect(text).toContain("Originator's Exalted Orb")
    const item = parse(text.replace("Originator's Exalted Orb", 'Exalted Orb'))
    expect(item.info.refName).toBe('Exalted Orb')
  })

  it('N2 資料沒有的英文名仍回 item.unknown', () => {
    const r = parseClipboard(readDoc('3.30-issue-46.cmn-Hant.txt'))
    expect(r.isErr()).toBe(true)
    if (r.isErr()) expect(r.error).toBe('item.unknown')
  })
})
