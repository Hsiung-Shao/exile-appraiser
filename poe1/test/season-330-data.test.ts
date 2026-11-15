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

  it('D23 en:Twice Corrupted 視為已汙染', () => {
    expect(parse(ringText('en', [LIFE_EN, ['Twice Corrupted']])).isCorrupted).toBe(true)
    expect(parse(ringText('en', [LIFE_EN, ['Corrupted']])).isCorrupted).toBe(true)
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

  it('D11 3.30 新傳奇胸甲(使用者 2026-11-14 回報的范迪戈之革):沒有未解析詞綴,新詞綴不是只找相同數值', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-hide-of-the-vendigo.cmn-Hant.txt'), 'utf8'))
    expect(item.info.refName).toBe('Hide of the Vendigo')
    expect(unknownOf(item)).toEqual([])
    const speed = item.statsByType.find(s => s.stat.ref === "#% increased Attack Speed if you've used an Attack Movement Skill Recently")
    expect(speed?.stat.better).toBe(1)
  })

  it('D12 臟器名稱帶「高階」前綴(使用者 2026-11-14 回報)解析成原臟器', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-greater-hollowed-skull.cmn-Hant.txt'), 'utf8'))
    expect(item.info.refName).toBe('Hollowed Skull')
  })

  it('D13 3.30 新變異寶石 火球．輻射(使用者 2026-11-14 回報)解析得到,帶交易站分支', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-fireball-of-radiation.cmn-Hant.txt'), 'utf8'))
    expect(item.info.refName).toBe('Fireball of Radiation')
    expect(item.info.tradeDisc).toBe('alt_x')
    expect(item.info.gem).toMatchObject({ transfigured: true, normalVariant: 'Fireball' })
  })

  it('D14 黑暗君主(使用者 2026-11-15 回報):「喚醒幽魂(...)的最大數量加倍」3.30 進階寫法解析得到', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-the-dark-monarch.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toContain('Maximum number of Raised Spectres is Doubled\nCannot have Minions other than Raised Spectres')
  })

  it('D15 臟器的固定詞綴(使用者 2026-11-15 回報的五件)解析成帶交易站 implicit id 的詞綴', () => {
    const items = fs.readFileSync(path.join(HERE, 'docs/3.30-viscera.cmn-Hant.txt'), 'utf8').split(/\r?\n====\r?\n/).map(parse)
    const want: Array<[string, string, string, number]> = [
      ["Noble's Head", '#% more Damage against Undead Monsters', 'implicit.stat_2844915624', 8],
      ['Crescent Blade', '#% of Physical Damage from Hits taken as Cold Damage', 'implicit.stat_1871056256', 6],
      ["Overseer's Whip", "Minions have #% increased Movement Speed if you've used a Minion Skill Recently", 'implicit.stat_1371407912', 32],
      ['Hollowed Skull', '+# Physical Damage taken from Hits per Level', 'implicit.stat_3652380199', -1],
      ["Gladiator's Heart", 'Gain # Rage on Melee Hit', 'implicit.stat_2709367754', 2]
    ]
    expect(items.map(i => i.info.refName)).toEqual(want.map(w => w[0]))
    items.forEach((item, i) => {
      expect(unknownOf(item), want[i][0]).toEqual([])
      expect(item.statsByType.map(s => [s.type, s.stat.ref]), want[i][0]).toEqual([['implicit', want[i][1]]])
      expect(item.statsByType[0].stat.trade.ids.implicit, want[i][0]).toContain(want[i][2])
      expect(item.statsByType[0].sources[0].stat.roll?.value, want[i][0]).toBe(want[i][3])
    })
  })

  it('D16 帶入名稱前的零寬空白 U+200B(GitHub issue #4 / #7 的實機文字)不影響解析', () => {
    const text = fs.readFileSync(path.join(HERE, 'docs/3.30-reverberation-rod.cmn-Hant.txt'), 'utf8')
    const real = text.replace(/的 (?=\S+輔助 輔助)/g, '的 ​')
    expect(real).not.toBe(text)
    const item = parse(real)
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toContain('Socketed Gems are Supported by Level # Spell Echo (Random Support Gem)')
  })

  it('D17 GitHub issue #8 / #9 的實機物品:傳奇繁中改名(馬拉凱的輪迴)與「+# 點命中」寫法', () => {
    const loop = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-malachais-loop.cmn-Hant.txt'), 'utf8'))
    expect(loop.info.refName).toBe("Malachai's Loop")
    const gloves = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-warlock-gloves-accuracy.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(gloves)).toEqual([])
    expect(refsOf(gloves)).toContain('+# to Accuracy Rating')
  })

  it('D18 破裂的「+#%物品稀有度」(使用者 2026-11-15 貼的實機手套)解析成原詞綴並帶破裂 id', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-fractured-rarity-gloves.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref === RARITY_REF)
    expect(hit?.type).toBe('fractured')
    expect(hit?.stat.trade.ids.fractured).toContain('fractured.stat_3917489142')
  })

  it('D19「賦予等級 # 的 技能」3.30 寫法(GitHub issue #10 #11 的實機文字,名稱前有零寬空白)解析得到', () => {
    const item = parse(ringText('cmn-Hant', [['賦予等級 5 的 ​凍傷 — 無法使用的值', '賦予等級 20 的 ​嗜血 — 無法使用的值', '+68 最大生命']]))
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toContain('Grants Level # Frostbite Skill')
    expect(refsOf(item)).toContain('Grants Level # Thirst for Blood Skill')
  })

  it('D20 輔助寶石詞綴同時帶舊 id 與 effect_ 新 id(苦夢:交易站用舊 id 搜尋 0 筆、新 id 2919 筆,2026-11-15 實測)', () => {
    const item = parse(ringText('cmn-Hant', [['插槽中的寶石被等級 15 的 ​寒冰刺骨輔助 輔助', '+68 最大生命']]))
    const hit = item.statsByType.find(s => s.stat.ref === 'Socketed Gems are Supported by Level # Bonechill (Random Support Gem)')
    expect(hit?.stat.trade.ids.explicit).toEqual(['explicit.indexable_support_115', 'explicit.effect_3024539694'])
  })

  it('D21 使用者 2026-11-15 貼的四張 3.30 實機地圖沒有未解析詞綴(0.3.9「區域內含有一座蜃景」沒掛隨機 id)', () => {
    const mirage = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-map-mirage.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(mirage)).toEqual([])
    expect(mirage.statsByType.find(s => s.stat.ref === 'Area contains an Empowered Mirage which covers the entire Map')?.stat.trade.ids.explicit).toContain('explicit.stat_2436559047')
    for (const f of ['buried-sentinel', 'katash-summoner', 'always-ignite']) {
      expect(unknownOf(parse(fs.readFileSync(path.join(HERE, `docs/3.30-map-${f}.cmn-Hant.txt`), 'utf8'))), f).toEqual([])
    }
  })

  it('D23「二次汙染」(3.30 新狀態,clientstrings ItemPopupDoubleCorrupted;使用者 2026-11-15 回報預設成未汙染)視為已汙染', () => {
    expect(parse(ringText('cmn-Hant', [LIFE_ZH, ['二次汙染']])).isCorrupted).toBe(true)
    expect(parse(ringText('cmn-Hant', [LIFE_ZH, ['已汙染']])).isCorrupted).toBe(true)
    expect(parse(ringText('cmn-Hant', [LIFE_ZH])).isCorrupted).toBe(false)
    expect(parse(fs.readFileSync(path.join(HERE, 'docs/3.30-map-mirage.cmn-Hant.txt'), 'utf8')).isCorrupted).toBe(true)
  })

  it('D24 軍閥行軍(GitHub issue #15,台服 0.3.9 的實機文字)「插槽中的寶石被等級 25 的 神聖祝福輔助 輔助」解析得到並帶 effect_ id', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-march-of-the-legion.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType.flatMap(s => s.stat.trade.ids.explicit ?? [])).toContain('explicit.effect_3161048706')
  })

  it('D10「插槽中的寶石被等級 # 的 X輔助 輔助」3.30 寫法(使用者 2026-11-14 回報的混響)沒有未解析詞綴', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-reverberation-rod.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    for (const gem of ['Spell Echo', 'Controlled Destruction', 'Arcane Surge']) {
      expect(refsOf(item)).toContain(`Socketed Gems are Supported by Level # ${gem} (Random Support Gem)`)
    }
  })
})

function readNdjson (lang: string, file: string): any[] {
  return fs.readFileSync(path.join(DATA_DIR, lang, file), 'utf8')
    .split(/\r?\n/).filter(l => l !== '').map(l => JSON.parse(l))
}

describe('3.30 資料檔', () => {
  it('D22 阿茲瓦特史記的「保險箱之殿 (階級 1)」(GitHub issue #14,遊戲檔的房間名)對得到 Strongbox Chamber', () => {
    const room = readNdjson('cmn-Hant', 'stats.ndjson').flatMap(r => r.stats ?? [r]).find(s => s.ref === 'Has Room: Strongbox Chamber (Tier 1)')
    expect(room.matchers.filter((m: any) => !m.superseded).map((m: any) => m.string)).toEqual(['保險箱之殿 (階級 1)'])
    expect(room.matchers.map((m: any) => m.string)).toContain('寶箱之殿 (階級 1)')
  })

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
