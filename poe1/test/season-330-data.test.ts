import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { statSourcesTotal, translateStatWithRoll } from '@/parser/modifiers'

/**
 * 3.30 賽季資料回歸:用真實 `data/poe1` 驗證詞綴新舊寫法都解析得到、
 * 資料不再引用交易站已移除的 id、改名 / 新增的物品查得到。
 *
 * ⚠ 兩個語系的資料集不能同時載入,所以 en 與 cmn-Hant 各用一個 describe 依序跑。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(HERE, '../../data/poe1')
const TRADE_IDS_FILE = path.join(HERE, 'docs/trade-stat-ids-3.30.json')

/** 以稀有戒指為範本,把詞綴區段換成指定行。sections 之間用分隔線隔開。 */
function ringText (lang: 'en' | 'cmn-Hant', sections: string[][]): string {
  const head = lang === 'en'
    ? ['Item Class: Rings', 'Rarity: Rare', 'Doom Loop', 'Opal Ring', '--------', 'Requirements:', 'Level: 80', '--------', 'Item Level: 84']
    : ['物品種類: 戒指', '稀有度: 稀有', '末日循環', '蛋白石戒指', '--------', '需求:', '等級: 80', '--------', '物品等級: 84']
  return [...head, ...sections.flatMap(s => ['--------', ...s])].join('\n') + '\n'
}

// D2 的目標詞綴只有 implicit id,用進階複製格式的標頭明確標成固定詞綴
const IMPL_EN = (line: string): string[] => ['{ Implicit Modifier — Damage }', line]
const LIFE_EN = ['{ Prefix Modifier "Prodigal" (Tier: 2) — Life }', '+68(55-68) to maximum Life']
const IMPL_ZH = (line: string): string[] => ['{ 固定詞綴— 傷害 }', line]
const LIFE_ZH = ['{ 前綴 "豐饒的"(階層：1)— 生命 }', '+68(55-68) 最大生命']

function parse (text: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`解析失敗:${r.error}\n${text}`)
  return r.value
}
const refsOf = (item: ParsedItem): string[] => item.statsByType.map(s => s.stat.ref)
const unknownOf = (item: ParsedItem): string[] => item.unknownModifiers.map(u => u.text)

const RARITY_REF = '#% increased Rarity of Items found'
const ALLIES_REF = 'You and nearby Allies deal #% increased Damage'

describe('3.30 詞綴寫法(en)', () => {
  beforeAll(async () => {
    await init('en')
    await loadForLang('en')
  })

  it('D1 新稀有度寫法 "+15% to Item Rarity" 解析成原詞綴', () => {
    const item = parse(ringText('en', [['+15% to Item Rarity', '+68 to maximum Life']]))
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref === RARITY_REF)
    expect(hit, `解析到的 ref:${JSON.stringify(refsOf(item))}`).toBeDefined()
    expect(hit!.stat.trade.ids.explicit).toContain('explicit.stat_3917489142')
  })

  it('D2 "within 6 metres" 新寫法與舊寫法解析到同一個 stat ref', () => {
    const oldItem = parse(ringText('en', [IMPL_EN('You and nearby Allies deal 10% increased Damage'), LIFE_EN]))
    const newItem = parse(ringText('en', [IMPL_EN('You and Allies within 6 metres deal 10% increased Damage'), LIFE_EN]))
    expect(refsOf(oldItem)).toContain(ALLIES_REF)
    expect(unknownOf(newItem)).toEqual([])
    expect(refsOf(newItem)).toContain(ALLIES_REF)
  })

  it('D3 舊稀有度寫法仍可解析', () => {
    const item = parse(ringText('en', [['15% increased Rarity of Items found', '+68 to maximum Life']]))
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toContain(RARITY_REF)
  })

  it('D7 篩選列顯示現行寫法,不顯示被取代的舊寫法', () => {
    const item = parse(ringText('en', [['+15% to Item Rarity', '+68 to maximum Life']]))
    const calc = item.statsByType.find(s => s.stat.ref === RARITY_REF)!
    const shown = translateStatWithRoll(calc, statSourcesTotal(calc.sources, 'sum'))
    expect(shown.string).toBe('#% to Item Rarity')
  })
})

describe('3.30 詞綴寫法(cmn-Hant)', () => {
  beforeAll(async () => {
    await loadForLang('cmn-Hant')
  })

  it('D1 新稀有度寫法 "+15%物品稀有度" 解析成原詞綴', () => {
    const item = parse(ringText('cmn-Hant', [['+15%物品稀有度', '+68 最大生命']]))
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref === RARITY_REF)
    expect(hit, `解析到的 ref:${JSON.stringify(refsOf(item))}`).toBeDefined()
    expect(hit!.stat.trade.ids.explicit).toContain('explicit.stat_3917489142')
  })

  it('D2 "6 公尺內的友方" 新寫法解析成原詞綴', () => {
    const item = parse(ringText('cmn-Hant', [IMPL_ZH('你和 6 公尺內的友方增加 10% 傷害'), LIFE_ZH]))
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toContain(ALLIES_REF)
  })

  it('D3 舊稀有度寫法仍可解析', () => {
    const item = parse(ringText('cmn-Hant', [['增加 15% 物品稀有度', '+68 最大生命']]))
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toContain(RARITY_REF)
  })

  it('D8 3.30 新傳奇藥劑(使用者 2026-11-14 回報的實機剪貼簿)解析得到', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-dreadmaidens-sacrament.cmn-Hant.txt'), 'utf8'))
    expect(item.info.refName).toBe("Dreadmaidens' Sacrament")
    expect(item.info.unique?.base).toBe('Basalt Flask')
    expect(refsOf(item)).toContain('Gain # Charge when you are Hit by an Enemy')
  })

  it('D9 3.30 臟器與新珠寶底材的傳奇(使用者 2026-11-14 回報的實機剪貼簿)解析得到', () => {
    const organ = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-gladiators-heart.cmn-Hant.txt'), 'utf8'))
    expect(organ.info.refName).toBe("Gladiator's Heart")
    expect(parse(fs.readFileSync(path.join(HERE, 'docs/3.30-despots-fist.cmn-Hant.txt'), 'utf8')).info.refName).toBe("Despot's Fist")
    const seed = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-putrid-seed.cmn-Hant.txt'), 'utf8'))
    expect(seed.info.refName).toBe('Putrid Seed')
    expect(seed.info.unique?.base).toBe('Mycelium Core')
  })
})

function readNdjson (lang: string, file: string): any[] {
  return fs.readFileSync(path.join(DATA_DIR, lang, file), 'utf8')
    .split(/\r?\n/).filter(l => l !== '').map(l => JSON.parse(l))
}

describe('3.30 資料檔', () => {
  it('D4 stats.ndjson 不再引用交易站已移除的 id', () => {
    const snap = JSON.parse(fs.readFileSync(TRADE_IDS_FILE, 'utf8')) as { ids: string[], options: Record<string, string[]> }
    const valid = new Set(snap.ids)
    const isValid = (id: string): boolean => {
      if (valid.has(id)) return true
      const m = /^(.*)\|(.+)$/.exec(id)
      return m != null && (snap.options[m[1]] ?? []).includes(m[2])
    }
    const dead = new Set<string>()
    for (const lang of ['en', 'cmn-Hant']) {
      for (const row of readNdjson(lang, 'stats.ndjson')) {
        for (const s of (row.stats ?? [row])) {
          for (const ids of Object.values<string[]>(s.trade?.ids ?? {})) {
            for (const id of ids) {
              if (id.startsWith('pseudo.')) continue
              if (!isValid(id)) dead.add(`${lang}:${id}`)
            }
          }
        }
      }
    }
    expect([...dead].slice(0, 10), `失效引用共 ${dead.size} 筆(只列前 10)`).toEqual([])
    expect(dead.size).toBe(0)
  })

  it('D5 改名與新通貨查得到,舊名已移除', () => {
    const present = ['Soul Core of Might', 'Abyss Thread', 'Cryptic Astrolabe', 'Threaded Delirium Orb']
    const gone = ['Coin of Power', 'Skittering Delirium Orb']
    for (const lang of ['en', 'cmn-Hant']) {
      const items = readNdjson(lang, 'items.ndjson')
      for (const name of present) {
        const row = items.find(r => r.refName === name)
        expect(row, `${lang} 缺 ${name}`).toBeDefined()
        expect(row.tradeTag, `${lang} ${name} 沒有 tradeTag`).toBeTruthy()
      }
      for (const name of gone) {
        expect(items.some(r => r.refName === name), `${lang} 仍有 ${name}`).toBe(false)
      }
    }
  })
})
