import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { statSourcesTotal, translateStatWithRoll } from '@/parser/modifiers'
import { createPresets } from '@/web/price-check/filters/create-presets'
import { createTradeRequest } from '@/web/price-check/trade/pathofexile-trade'

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

  it('D17v GitHub issue #32 的實機文字:禁忌烈焰「Allocates Instruments of Justice」(交易站 3.30 新給 id)解析得到、帶交易站 id', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-32.en.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType[0].stat.trade.ids.explicit).toEqual(['explicit.stat_1190333629|3154'])
  })

  it('D21b en:規則 27 的另一句 "Slaying Enemies has a #% increased chance to spawn a Beyond Portal" 解析成原詞綴', () => {
    const item = parse(ringText('en', [['{ Suffix Modifier "of Testing" (Tier: 1) }', 'Slaying Enemies has a 100% increased chance to spawn a Beyond Portal']]))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType[0].stat.trade.ids.explicit).toContain('explicit.stat_3036422124')
  })

  // #36–#38 的英文樣本不是實機剪貼簿:照繁中實機文字的結構、用 GGPK 英文字串組的。
  // #36 的名稱「Raised Spiders」沿用既有英文資料與交易站文字;英文客戶端若像繁中改帶技能名(Raise Spiders)這條守不到,要等實機樣本
  it('D17y en:#36 黑暗君主「Raised Spiders (...)」、#38 后冠的臟器固定詞綴都解析得到', () => {
    const monarch = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-36.en.txt'), 'utf8'))
    expect(unknownOf(monarch)).toEqual([])
    expect(monarch.statsByType.at(-1)!.stat.trade.ids.explicit).toEqual(['explicit.stat_56473917|5'])
    const crown = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-38.en.txt'), 'utf8'))
    expect(unknownOf(crown)).toEqual([])
    expect(crown.statsByType[0].stat.trade.ids.implicit).toEqual(['implicit.stat_2994988431', 'implicit.stat_3376335115'])
  })

  it('D17z en:#37「Superior Fated Titan Plate」+「Unidentified (Tier 5)」解析成泰坦之鎧、帶階級與命運', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-37.en.txt'), 'utf8'))
    expect([item.info.refName, item.isUnidentified, item.unidentifiedTier, item.isFated]).toEqual(['Titan Plate', true, 5, true])
  })

  // 2026-11-18 使用者回報英文地圖無法查詢:「Map contains Al-Hezmin's Citadel(...)」名稱後沒空白,失敗代表進階寫法又對不上
  it('D17x 英文實機地圖「Map contains Al-Hezmin\'s Citadel(...)」解析得到、帶交易站 id', () => {
    const map = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-map-citadel.en.txt'), 'utf8'))
    expect(unknownOf(map)).toEqual([])
    expect(map.statsByType.find(s => s.stat.ref.startsWith("Map contains Al-Hezmin's Citadel"))?.stat.trade.ids.implicit).toEqual(['implicit.stat_2563183002|3'])
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
  it('D17y GitHub issue #36 的實機文字:黑暗君主「異蛛復甦(...)的最大數量加倍」(繁中帶入的是技能名)解析成交易站的蜘蛛選項', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-36.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType.at(-1)!.stat.trade.ids.explicit).toEqual(['explicit.stat_56473917|5'])
  })

  it('D17z GitHub issue #37 的實機文字:「精良的 命運 泰坦之鎧」+「未鑑定(階級 5)」解析得到,查詢帶未鑑定、階級、命運', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-37.cmn-Hant.txt'), 'utf8'))
    expect([item.info.refName, item.isUnidentified, item.unidentifiedTier, item.isFated]).toEqual(['Titan Plate', true, 5, true])
    const preset = createPresets(item, { league: 'Standard', currency: null, collapseListings: 'api', activateStockFilter: false, searchStatRange: 10, useEn: false, merchantOnly: false }).presets[0]
    const misc = (createTradeRequest(preset.filters, preset.stats).query.filters as any).misc_filters.filters
    expect([misc.identified, misc.unidentified_tier, misc.fated]).toEqual([{ option: 'false' }, { min: 5 }, { option: 'true' }])
  })

  it('D17z2 沒有階級的未鑑定稀有物品照舊:不帶階級 / 命運,未鑑定條件預設不送', () => {
    const text = fs.readFileSync(path.join(HERE, 'docs/3.30-issue-37.cmn-Hant.txt'), 'utf8').replace('精良的 命運 ', '精良的 ').replace('未鑑定(階級 5)', '未鑑定')
    const item = parse(text)
    expect([item.info.refName, item.isUnidentified, item.unidentifiedTier, item.isFated]).toEqual(['Titan Plate', true, undefined, undefined])
    const preset = createPresets(item, { league: 'Standard', currency: null, collapseListings: 'api', activateStockFilter: false, searchStatRange: 10, useEn: false, merchantOnly: false }).presets[0]
    expect(JSON.stringify(createTradeRequest(preset.filters, preset.stats).query)).not.toMatch(/identified|fated/)
  })

  it('D17zz GitHub issue #38 的實機文字:巫會之后冠「有 12(10-12)% 更多最大物理攻擊傷害」(臟器專用 stat)解析得到,兩個固定詞綴 id 都送', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-38.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType[0].stat.trade.ids.implicit).toEqual(['implicit.stat_2994988431', 'implicit.stat_3376335115'])
    const preset = createPresets(item, { league: 'Standard', currency: null, collapseListings: 'api', activateStockFilter: false, searchStatRange: 10, useEn: false, merchantOnly: false }).presets[0]
    const count = createTradeRequest(preset.filters, preset.stats).query.stats.find(g => g.type === 'count')!
    expect(count.filters.map(f => f.id)).toEqual(['implicit.stat_2994988431', 'implicit.stat_3376335115'])
  })

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

  it('D17b 珠寶「+#% 單手近戰武器暴擊加成」寫法(使用者 2026-11-15 實機珠寶)解析得到', () => {
    const jewel = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-viridian-jewel-1h-crit-multi.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(jewel)).toEqual([])
    expect(refsOf(jewel)).toContain('+#% to Critical Strike Multiplier with One Handed Melee Weapons')
  })

  it('D17c GGPK 比對補的繁中寫法(2026-11-15):新舊寫法都解析成同一條,減少的寫法數值為負', () => {
    const item = parse(ringText('cmn-Hant', [['+30% 弓暴擊加成', '持弓時 +30% 暴擊加成', '減少 12% 祭祀神壇出現特殊獎勵的機率']]))
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toContain('+#% to Critical Strike Multiplier with Bows')
    const ritual = item.statsByType.find(s => s.stat.ref === '#% increased chance of Ritual Altars with Special Rewards')
    expect(ritual?.sources[0].stat.roll?.value).toBe(-12)
  })

  it('D17d 箭袋固定詞綴「箭矢穿透一個額外目標」(句子沒有數字,使用者 2026-11-16 實機箭袋)解析得到並帶兩個固定詞綴 id', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-penetrating-quiver.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref === 'Arrows Pierce an additional Target')
    expect(hit?.type).toBe('implicit')
    expect(hit?.stat.trade.ids.implicit).toEqual(['implicit.stat_3423006863', '{empty}implicit.stat_3492025235'])
  })

  it('D17e 3.30 壁壘地圖的固定詞綴(進階複製「地圖含有巴倫的壁壘(...)」,2026-11-16 回報的實機地圖)解析得到並帶選項 id', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-map-baran-citadel.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref.startsWith("Map contains Baran's Citadel"))
    expect(hit?.type).toBe('implicit')
    expect(hit?.stat.trade.ids.implicit).toEqual(['implicit.stat_2563183002|1'])
    expect(item.areaAtlasDrops).toBe(81)
  })

  it('D17f 3.30 史記的改名房間「創造之搖籃 (階級 3)」(2026-11-16 回報;文字依截圖重組,不是實機剪貼簿)解析得到', () => {
    const item = parse(['物品種類: 雜項地圖物品', '稀有度: 普通', '阿茲瓦特史記', '--------', '區域等級: 80', '--------', '物品等級: 80', '--------', '開啟房間：', '祭祀之巔 (階級 3)', '神話之殿 (階級 3)', '阿茲瓦特之巔', '創造之搖籃 (階級 3)', '異常研究所 (階級 1)', '--------', '可在阿茲瓦特神殿使用。'].join('\n') + '\n')
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType.find(s => s.stat.ref === 'Has Room: Throne of Atziri (Tier 3)')?.stat.trade.ids.pseudo).toEqual(['pseudo.pseudo_temple_queens_chambers_3'])
    // 裂痕房間階級 1:遊戲內叫「異常研究所」(交易站叫 Splinter Research Lab;上游那一列是壞的)
    expect(item.statsByType.find(s => s.stat.ref === 'Has Room: Splinter Research Lab (Tier 1)')?.stat.trade).toMatchObject({ ids: { pseudo: ['pseudo.pseudo_temple_breach_room_1'] }, option: true })
  })

  it('D17g GitHub issue #18–#23 的實機文字(0.3.11 仍未解析):隨機技能寶石「(...)」、新寶石 連結：秘能、希望之絃、傭兵輔助改名', () => {
    const read = (n: number): ParsedItem => parse(fs.readFileSync(path.join(HERE, `docs/3.30-issue-${n}.cmn-Hant.txt`), 'utf8'))
    const amulet = read(18)
    expect(unknownOf(amulet)).toEqual([])
    expect(amulet.statsByType.find(s => s.stat.ref === '+# to Level of all Summon Reaper Gems (Random Skill Gem)')?.stat.trade.ids.explicit).toEqual(['explicit.indexable_skill_246'])
    expect(read(19).info.refName).toBe('Arcane Link')
    const thread = read(20)
    expect(unknownOf(thread)).toEqual([])
    expect(thread.statsByType.find(s => s.stat.ref === 'Only affects Passives in Massive Ring')?.stat.trade.ids.explicit).toEqual(['explicit.stat_3642528642|5'])
    expect(refsOf(thread)).toContain('+#% to all Elemental Resistances')
    const warrant = read(23)
    expect(unknownOf(warrant)).toEqual([])
    expect(warrant.mercenarySkills!.filter(g => g.some(s => s.stat.ref === 'Increased Area of Effect'))).toHaveLength(3)
  })

  it('D17h GitHub issue #2 #6 #13 #17 的原始樣本(先前沒有測試守住)沒有未解析詞綴', () => {
    // #2、#13 的回報只有標題,用標題那一行;#6、#17 是回報裡的實機剪貼簿
    const lines = parse(ringText('cmn-Hant', [['增加 21(20-21)% 生命回復率', '賦予等級 30 的 ​精準 — 無法使用的值']]))
    expect(unknownOf(lines)).toEqual([])
    expect(refsOf(lines)).toContain('Grants Level # Precision Skill')
    const organ = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-6.cmn-Hant.txt'), 'utf8'))
    expect(organ.info.refName).toBe('Prosthetic Leg')
    expect(unknownOf(organ)).toEqual([])
    const map = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-17.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(map)).toEqual([])
    expect(map.statsByType.find(s => s.stat.ref.startsWith("Map contains Al-Hezmin's Citadel"))?.stat.trade.ids.implicit).toEqual(['implicit.stat_2563183002|3'])
  })

  it('D17i GGPK 3.30 物品描述檔的另一種繁中句子(規則 20,沒有實機樣本)解析成原詞綴', () => {
    const item = parse(ringText('cmn-Hant', [['不能被中毒', '插槽中寶石等級 +2', '貧血時 +10% 法術傷害格擋率', '非暴擊獲得 1 顆暴擊球', '增加 12% 拆除陷阱速度']]))
    expect(unknownOf(item)).toEqual([])
    expect(refsOf(item)).toEqual(expect.arrayContaining([
      'Cannot be Poisoned', '+# to Level of Socketed Gems', '+#% Chance to Block Spell Damage while on Low Life',
      'Gain a Power Charge on Non-Critical Strike', '#% increased Trap Disarmament speed'
    ]))
  })

  it('D17j 惡鬼轉世還沒吞噬寶石的寫法(使用者 2026-11-17 貼的實機文字;規則 21)解析成原詞綴、數值 4', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-reborn-hunger.cmn-Hant.txt'), 'utf8'))
    expect(item.info.refName).toBe('The Hungry Loop')
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref.startsWith('Consumes Socketed Uncorrupted Support Gems'))
    expect(hit?.stat.trade.ids.explicit).toEqual(['explicit.stat_3221550523'])
    expect(hit?.sources[0].stat.roll?.value).toBe(4)
  })

  it('D17k 同一條詞綴依數值的其他寫法(規則 21,沒有實機樣本):減少的數值為負、100% 的寫法數值 100', () => {
    const item = parse(ringText('cmn-Hant', [['若近期沒有擊殺，減少 12% 命中值', '擊中時致盲敵人', '+68 最大生命']]))
    expect(unknownOf(item)).toEqual([])
    const roll = (ref: string) => item.statsByType.find(s => s.stat.ref === ref)?.sources[0].stat.roll?.value
    expect(roll("#% increased Accuracy Rating if you haven't Killed Recently")).toBe(-12)
    expect(roll('#% chance to Blind Enemies on hit')).toBe(100)
  })

  it('D17l 規則 21 的負值寫法沒有 negate handler({0:+d},遊戲直接印負號)→ 數值照原樣為負,不被翻成正(審查 2026-11-17)', () => {
    const text = fs.readFileSync(path.join(HERE, 'docs/3.30-issue-17.cmn-Hant.txt'), 'utf8').replace('增加怪物 100% 範圍效果', '怪物 -5% 防止壓抑法術傷害的總量')
    const item = parse(text)
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType.find(s => s.stat.ref === 'Monsters prevent +#% of Suppressed Spell Damage')?.sources[0].stat.roll?.value).toBe(-5)
  })

  it('D17m GitHub issue #26 的實機文字:3.30 新流派「淵井之軍」的契約書解析得到、篩選建得出來、查詢帶這個流派的類型', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-26.cmn-Hant.txt'), 'utf8'))
    expect(item.mercenaryBuild?.refName).toBe('Chaplain of the Well')
    expect(unknownOf(item)).toEqual([])
    const preset = createPresets(item, { league: 'Standard', currency: null, collapseListings: 'api', activateStockFilter: false, searchStatRange: 10, useEn: false, merchantOnly: false }).presets[0]
    expect(preset.stats.filter(s => 'group' in s && s.group === 'mercenary').length + preset.stats.filter(s => !('group' in s)).length).toBeGreaterThan(0)
    expect(JSON.stringify(createTradeRequest(preset.filters, preset.stats).query)).toContain('AbyssalTemplar')
  })

  it('D17p GitHub issue #17 留言「未鑑定時也是」:未鑑定的壁壘地圖(依 #17 實機文字拿掉隨機詞綴)也解析得到壁壘固定詞綴', () => {
    const text = ['物品種類: 地圖', '稀有度: 稀有', '地圖（階級 16）', '--------', '物品等級: 83', '--------', '怪物等級：83', '--------',
      '{ 固定詞綴 }', '地圖含有奧赫茲明的壁壘(...) — 無法使用的值', '--------', '未鑑定', '--------',
      '透過個人的地圖裝置來使用這張地圖以前往這個階級或更低的該地圖。每張地圖只能被使用一次。'].join('\n') + '\n'
    const item = parse(text)
    expect(item.isUnidentified).toBe(true)
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType.find(s => s.stat.ref.startsWith("Map contains Al-Hezmin's Citadel"))?.stat.trade.ids.implicit).toEqual(['implicit.stat_2563183002|3'])
  })

  it('D17q 希望之絃「只會影響大(...)範圍內的天賦」(使用者 2026-11-18 截圖;文字照截圖改寫 issue #20 的實機樣本)解析成大範圍', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-thread-of-hope-large.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType.find(s => s.stat.ref === 'Only affects Passives in Large Ring')?.stat.trade.ids.explicit).toEqual(['explicit.stat_3642528642|3'])
    expect(item.statsByType.find(s => s.stat.ref === '+#% to all Elemental Resistances')?.sources[0].stat.roll?.value).toBe(-12)
  })

  it('D17r 希望之絃「只會影響巨大(...)範圍內的天賦」與 issue #20 的無括號寫法都解析成巨大範圍(大範圍有「(...)」的實機截圖,巨大是同理推論)', () => {
    const text = fs.readFileSync(path.join(HERE, 'docs/3.30-issue-20.cmn-Hant.txt'), 'utf8')
    for (const t of [text, text.replace('只會影響巨大範圍內的天賦', '只會影響巨大(...)範圍內的天賦')]) {
      const item = parse(t)
      expect(unknownOf(item)).toEqual([])
      expect(item.statsByType.find(s => s.stat.ref === 'Only affects Passives in Massive Ring')?.stat.trade.ids.explicit).toEqual(['explicit.stat_3642528642|5'])
    }
  })

  it('D17s 淵井之軍契約書(使用者 2026-11-18 貼的實機文字):3.30 的新傭兵技能(深淵噴濺、深淵噴濺．引爆、淵底之力、瓦爾．雷鳴重擊)都解析得到', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-warrant-chaplain-2.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(item.mercenarySkills?.map(g => g[0].stat.ref)).toEqual(['Abyssal Spray', 'Abyssal Spray Detonation', 'Power of the Depths', 'Vaal Smite', 'Envy', 'Flame Dash'])
  })

  it('D17t 傭兵契約書裡認不得的技能整段列為未解析,不再靜默丟掉(規則 7)', () => {
    const text = fs.readFileSync(path.join(HERE, 'docs/3.30-warrant-chaplain-2.cmn-Hant.txt'), 'utf8').replace('烈焰衝刺', '不存在的技能').replace('忌妒', '另一個不存在的技能')
    expect(unknownOf(parse(text))).toEqual(expect.arrayContaining(['不存在的技能', '高階快速施放(階層：3) [不存在的技能]', '另一個不存在的技能']))
  })

  it('D17u GitHub issue #34 的實機文字:禁忌血肉「配置 荒野化身」(3.30 天賦繁中改名,舊名獸性化身)解析得到、帶交易站 id', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-34.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType[0].stat.ref).toBe('Allocates Avatar of the Wilds if you have the matching modifier on Forbidden Flame')
    expect(item.statsByType[0].stat.trade.ids.explicit).toEqual(['explicit.stat_2460506030|55509'])
  })

  it('D17w GitHub issue #35 的實機文字:禁忌烈焰「配置 無端暴力」(3.30 改名,舊名免費暴力)解析得到、帶交易站 id', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-35.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType[0].stat.trade.ids.explicit).toEqual(['explicit.stat_1190333629|27864'])
  })

  it('D17n GitHub issue #29 的實機文字:永恆珠寶「授銜7260個硬幣以紀念卡斯皮羅(...)」(3.30 句型)解析得到、帶交易站 id、數值 7260', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-issue-29.cmn-Hant.txt'), 'utf8'))
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref === 'Commissioned # coins to commemorate Caspiro')
    expect(hit?.stat.trade.ids.explicit).toEqual(['explicit.pseudo_timeless_jewel_caspiro'])
    expect(hit?.sources[0].stat.roll?.value).toBe(7260)
  })

  it('D17o GitHub issue #28 玫瑰的傳承(只有截圖,照截圖的兩行組進階格式):塑界者的毀滅解析成交易站的第 1 個選項', () => {
    const item = parse(ringText('cmn-Hant', [['{ 傳奇詞綴 }', '賦予等級 20 召喚塑界者的記憶', '賦予等級 20 塑界者的毀滅(...)， 供塑界者的記憶使用 — 無法使用的值']]))
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref.startsWith('Grants Level 20 Summon Shaper Memory'))
    expect(hit?.stat.trade.ids.explicit).toEqual(['explicit.stat_367775264'])
    expect(hit?.sources[0].stat.roll?.value).toBe(1)
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

  it('D21b 規則 27:交易站同一個 id 的另一句「擊殺敵人增加 #% 機率產生超越傳送門」(類型掃描 2026-11-18 找到,沒有實機樣本)解析成原詞綴', () => {
    const item = parse(ringText('cmn-Hant', [['{ 後綴 "測試之"(階層：1) }', '擊殺敵人增加 100% 機率產生超越傳送門']]))
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType[0].stat.trade.ids.explicit).toContain('explicit.stat_3036422124')
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

  it('D25 臟器「巫會之后冠」(使用者 2026-11-15 貼的實機文字):三條固定詞綴都解析得到(0.3.9 海洋球那條沒掛固定 id)', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-coven-queens-crown.cmn-Hant.txt'), 'utf8'))
    expect(item.info.refName).toBe("Coven Queen's Crown")
    expect(unknownOf(item)).toEqual([])
    const brine = item.statsByType.find(s => s.stat.ref === '#% chance to gain a Brine Charge instead of an Endurance Charge')
    expect(brine?.type).toBe('implicit')
    expect(brine?.stat.trade.ids.implicit).toContain('implicit.stat_3682839745')
  })

  it('D26 鈷藍珠寶「增加 #% 殘酷的效果」(GitHub issue #16;舊版就有的物品詞綴,交易站有隨機 / 破裂 id)解析得到', () => {
    const item = parse(ringText('cmn-Hant', [LIFE_ZH, ['{ 後綴 "殘酷之"(階層：1) }', '增加 6(6-10)% 殘酷的效果']]))
    expect(unknownOf(item)).toEqual([])
    const hit = item.statsByType.find(s => s.stat.ref === '#% increased Effect of Cruelty')
    expect(hit?.stat.trade.ids.explicit).toEqual(['explicit.stat_1123294660'])
  })

  it('D27 傳奇珠寶「腐敗之種」(使用者 2026-11-15 貼的實機文字):洗出的四個塗油天賦解析成附魔詞綴、帶選項型 id', () => {
    const item = parse(fs.readFileSync(path.join(HERE, 'docs/3.30-putrid-seed.cmn-Hant.txt'), 'utf8'))
    expect(item.info.refName).toBe('Putrid Seed')
    expect(unknownOf(item)).toEqual([])
    const grown = item.statsByType.filter(s => s.stat.ref.startsWith('1 Added Passive Skill is '))
    expect(grown.map(s => [s.stat.ref, s.type, s.stat.trade.ids.enchant])).toEqual([
      ['1 Added Passive Skill is Careful Counterattack', 'enchant', ['enchant.stat_3599615742|59976']],
      ['1 Added Passive Skill is Flow of Battle', 'enchant', ['enchant.stat_3599615742|56330']],
      ['1 Added Passive Skill is Indiscriminate Revenge', 'enchant', ['enchant.stat_3599615742|4918']],
      ['1 Added Passive Skill is Practised Reapplication', 'enchant', ['enchant.stat_3599615742|37425']]
    ])
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

  it('D22b 3.30 史記房間改名:新名為唯一有效寫法、舊名仍保留(兩個語系)', () => {
    const table: Array<[string, string, string, string, string]> = [
      ['Has Room: Royal Meeting Room (Tier 1)', '王室宴客室 (階級 1)', '創造之搖籃 (階級 1)', 'Royal Meeting Room (Tier 1)', 'Cradle of Creation (Tier 1)'],
      ['Has Room: Hall of Lords (Tier 2)', '權貴殿堂 (階級 2)', '創造之搖籃 (階級 2)', 'Hall of Lords (Tier 2)', 'Cradle of Creation (Tier 2)'],
      ['Has Room: Throne of Atziri (Tier 3)', '阿茲里宴殿 (階級 3)', '創造之搖籃 (階級 3)', 'Throne of Atziri (Tier 3)', 'Cradle of Creation (Tier 3)'],
      ['Has Room: Omnitect Forge (Tier 2)', '全能冶煉室 (階級 2)', '皇家熔爐 (階級 2)', 'Omnitect Forge (Tier 2)', 'Royal Forge (Tier 2)'],
      ['Has Room: Omnitect Reactor Plant (Tier 2)', '全能反應廠 (階級 2)', '宏偉反應爐 (階級 2)', 'Omnitect Reactor Plant (Tier 2)', 'Grand Reactor (Tier 2)']
    ]
    const stats = {
      'cmn-Hant': readNdjson('cmn-Hant', 'stats.ndjson').flatMap(r => r.stats ?? [r]),
      en: readNdjson('en', 'stats.ndjson').flatMap(r => r.stats ?? [r])
    }
    for (const [ref, zhOld, zhNew, enOld, enNew] of table) {
      for (const [lang, oldName, newName] of [['cmn-Hant', zhOld, zhNew], ['en', enOld, enNew]] as const) {
        const row = stats[lang].find(s => s.ref === ref)
        expect(row, `${lang} ${ref}`).toBeDefined()
        expect(row.matchers.filter((m: any) => !m.superseded).map((m: any) => m.string), `${lang} ${ref}`).toEqual([newName])
        expect(row.matchers.map((m: any) => m.string), `${lang} ${ref}`).toContain(oldName)
      }
    }
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
