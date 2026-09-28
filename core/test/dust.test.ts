/**
 * 拆粉(WP-B):公式(APT 逐字)、資料解析、交叉比對(英文名 + 基底對接)、排行(效率 / 催化劑 / 無價 / 低信心 / gold 估值)、
 * 交易站查詢、面板記憶狀態。
 * 金標:poe1 parser 回歸網 `boots-unique-vestigial-02.expected.json`(Sin Trek,disenchantValue 6.07,ilvl 85,q0)的
 * `dustEquivalent` 15175 —— 同一個公式在 Parser.ts 算出的數。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CATALYSTS_FOR_Q20, cheapestCatalyst, crossCheck, defaultDustUiState, dustAt, dustIlvlMultiplier, dustTradeRequest,
  dustUniquesFromNdjson, filterRanked, indexPoeDust, inherentInfluencesFromPoeDust, isJewellery, parseDustUiState, parsePoeDust, rankUniques,
  renderCrossCheckMarkdown, serializeDustUiState, toggleDustMark, type DustUnique, type PoeDustRow
} from '../src/dust'
import { parseItemOverview, parseExchangeOverview } from '../src/ninja'
import type { NinjaSnapshot, NinjaSnapshotEntry } from '../src/ninja'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('dustAt(APT calcDisenchantDust 逐字)', () => {
  it('金標:boots-unique-vestigial-02 = 15175(ilvl 85、q0)', () => {
    const fx = JSON.parse(read('poe1/test/fixtures/cmn-Hant/boots-unique-vestigial-02.expected.json'))
    expect(fx.dustEquivalent).toBe(15175)
    expect(fx.itemLevel).toBe(85)
    expect(fx.quality ?? 0).toBe(0)
    expect(fx.influences).toEqual([])
    expect(fx.isCorrupted).toBe(false)
    expect(dustAt(fx.info.unique.disenchantValue, { ilvl: fx.itemLevel, quality: fx.quality ?? 0 })).toBe(fx.dustEquivalent)
  })

  it('金標:boots-unique-vestigial-01 = 5400', () => {
    const fx = JSON.parse(read('poe1/test/fixtures/cmn-Hant/boots-unique-vestigial-01.expected.json'))
    expect(dustAt(fx.info.unique.disenchantValue, { ilvl: fx.itemLevel, quality: fx.quality ?? 0 })).toBe(fx.dustEquivalent)
  })

  it('base(ilvl) 分段:46 以下 50、68 = 100、84 以上 500', () => {
    expect(dustIlvlMultiplier(1)).toBe(250)
    expect(dustIlvlMultiplier(46)).toBe(250)
    // 47:50 + 2 + floor(3/11)=0 → 52
    expect(dustIlvlMultiplier(47)).toBe(260)
    // 57:50 + 22 + floor(33/11)=3 → 75
    expect(dustIlvlMultiplier(57)).toBe(375)
    expect(dustIlvlMultiplier(68)).toBe(500)
    // 69:100 + 25
    expect(dustIlvlMultiplier(69)).toBe(625)
    expect(dustIlvlMultiplier(84)).toBe(2500)
    expect(dustIlvlMultiplier(86)).toBe(2500)
  })

  it('各 ilvl(dv 10)', () => {
    expect(dustAt(10, { ilvl: 46 })).toBe(2500)
    expect(dustAt(10, { ilvl: 68 })).toBe(5000)
    expect(dustAt(10, { ilvl: 84 })).toBe(25000)
    expect(dustAt(10, { ilvl: 86 })).toBe(25000)
    expect(dustAt(10)).toBe(25000) // 預設 ilvl 84
  })

  it('品質 20 = ×1.4、勢力 2 = ×2、腐化 1 = ×1.5、可疊加', () => {
    expect(dustAt(10, { quality: 20 })).toBe(35000)
    expect(dustAt(10, { influences: 2 })).toBe(50000)
    expect(dustAt(10, { corruptedMods: 1 })).toBe(37500)
    // 100 + 100 + 40 + 50 = 290%
    expect(dustAt(10, { quality: 20, influences: 2, corruptedMods: 1 })).toBe(72500)
    expect(dustAt(6.07, { quality: 20 })).toBe(21245)
  })
})

describe('資料', () => {
  const rows = parsePoeDust(read('data/dust/poe-dust.json'))
  const uniques = dustUniquesFromNdjson(read('data/poe1/en/items.ndjson'), read('data/poe1/cmn-Hant/items.ndjson'))

  it('poe-dust.json:欄位齊、name+baseType 不重複、依 name/baseType 排序', () => {
    expect(rows.length).toBeGreaterThan(1000)
    const keys = rows.map(r => r.name + '|' + r.baseType)
    expect(new Set(keys).size).toBe(keys.length)
    const sorted = [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.baseType < b.baseType ? -1 : a.baseType > b.baseType ? 1 : 0))
    expect(rows).toEqual(sorted)
    const hh = rows.find(r => r.name === 'Headhunter')!
    expect(hh).toEqual({ name: 'Headhunter', baseType: 'Leather Belt', dustValIlvl84: 2227900, dustValIlvl84Q20: 3119060, goldCost: 42520, slots: 2 })
  })

  it('items.ndjson:1219 件有 disenchantValue;繁中名 / 基底 / 類別以 refName 對接', () => {
    expect(uniques.length).toBe(1219)
    const sin = uniques.find(u => u.name === 'Sin Trek')!
    expect(sin).toMatchObject({ baseType: 'Stealth Boots', disenchantValue: 6.07, nameZh: '敏銳思維', baseZh: '匿蹤短靴', category: 'Boots' })
    const hh = uniques.find(u => u.name === 'Headhunter')!
    expect(hh.category).toBe('Belt')
    expect(isJewellery(hh)).toBe(true)
    expect(isJewellery(sin)).toBe(false)
    // 類別缺時以基底名後援
    expect(isJewellery({ baseType: 'Onyx Amulet' })).toBe(true)
    expect(isJewellery({ baseType: 'Rustic Sash' })).toBe(true)
    expect(isJewellery({ baseType: 'Stealth Boots' })).toBe(false)
  })

  it('交叉比對:以名稱+基底對接,統計與不一致清單', () => {
    const r = crossCheck(uniques, rows)
    expect(r.aptCount).toBe(1219)
    expect(r.dustCount).toBe(rows.length)
    // 分區加總:APT 的每一件恰好落在「一致 / 不一致 / 只在 APT」之一
    expect(r.matched + r.mismatched.length + r.onlyApt.length).toBe(r.aptCount)
    expect(r.matched + r.mismatched.length + r.onlyDust.length).toBe(r.dustCount)
    // 2026-09-28 資料(MANIFEST 鎖定)的結果;資料同步後要重跑 dust-crosscheck 並更新這裡
    expect({ matched: r.matched, mismatched: r.mismatched.length, onlyApt: r.onlyApt.length, onlyDust: r.onlyDust.length })
      .toEqual({ matched: 955, mismatched: 25, onlyApt: 239, onlyDust: 123 })
    const sf = r.mismatched.find(m => m.name === 'Starforge')!
    expect(sf).toMatchObject({ baseType: 'Infernal Sword', aptQ0: 1758725, dustQ0: 2638088, matchesWithInfluences: 1 })
    // 同名不同基底只是提示,不拿來對接
    const ash = r.onlyApt.find(o => o.name === 'Ashcaller')!
    expect(ash).toEqual({ name: 'Ashcaller', baseType: "Goat's Horn", sameNameOtherBase: ['Carved Wand'] })
    const md = renderCrossCheckMarkdown(r, { aptSource: 'a', dustSource: 'b', generatedAt: 't' })
    expect(md).toContain('| 兩邊都有且一致 | 955 |')
    expect(md).toContain('| Starforge | Infernal Sword |')
  })

  it('交叉比對不按位置:打亂順序結果相同', () => {
    const shuffled = [...rows].reverse()
    const a = crossCheck(uniques, rows)
    const b = crossCheck([...uniques].reverse(), shuffled)
    expect(b).toEqual(a)
  })

  it('排行的固有勢力:交叉比對可用勢力數解釋的 24 件套上 n,Starforge 排行 dust = poe-dust 值', () => {
    const idx = indexPoeDust(rows)
    const { rows: ranked, stats } = rankUniques({ items: uniques, dust: idx, snapshot: null, opts: { catalyst: 'never' } })
    const by = (name: string, base: string) => ranked.find(r => r.item.name === name && r.item.baseType === base)!
    const pd = (name: string, base: string) => idx.get(name + '|' + base)!

    // Starforge:APT 1758725(無勢力)→ 排行 n=1;poe-dust 2638088(APT 公式 floor 得 2638087.5 → 2638087,差在 poe-dust 四捨五入)
    const sf = by('Starforge', 'Infernal Sword')
    expect(sf.inherentInfluences).toBe(1)
    expect(sf.dust).toBe(2638087)
    expect(Math.abs(sf.dust - pd('Starforge', 'Infernal Sword').dustValIlvl84!)).toBeLessThanOrEqual(1)
    // q20 也吻合
    const sf20 = rankUniques({ items: [sf.item], dust: idx, snapshot: null, opts: { quality: 20 } }).rows[0]
    expect(sf20.dust).toBe(3341577)
    expect(Math.abs(sf20.dust - pd('Starforge', 'Infernal Sword').dustValIlvl84Q20!)).toBeLessThanOrEqual(1)
    // n=2:Voidforge 恰好等於
    const vf = by('Voidforge', 'Infernal Sword')
    expect(vf.inherentInfluences).toBe(2)
    expect(vf.dust).toBe(pd('Voidforge', 'Infernal Sword').dustValIlvl84)
    expect(by('Mark of the Shaper', 'Opal Ring').inherentInfluences).toBe(1)
    expect(by('Indigon', 'Hubris Circlet').inherentInfluences).toBe(2)
    // Venarius' Astrolabe(比值 4.0)不套,維持 APT 值
    const va = by("Venarius' Astrolabe", 'Astrolabe Amulet')
    expect(va.inherentInfluences).toBe(0)
    expect(va.dust).toBe(dustAt(va.item.disenchantValue))
    // 一致的不動(Headhunter)
    expect(by('Headhunter', 'Leather Belt').inherentInfluences).toBe(0)

    // 套用集合 = 交叉比對「勢力數 n 時吻合」的集合(n 相同)
    const cc = crossCheck(uniques, rows)
    const explained = cc.mismatched.filter(m => m.matchesWithInfluences !== undefined)
    expect(explained.length).toBe(24)
    expect(stats.inherentInfluenced).toBe(24)
    for (const m of explained) expect(by(m.name, m.baseType).inherentInfluences).toBe(m.matchesWithInfluences)
    // 套用後排行的 q0 dust 與 poe-dust 全部在 ±1 內
    for (const r of ranked) {
      const d = idx.get(r.key)
      if (!d || d.dustValIlvl84 === undefined || r.item.name === "Venarius' Astrolabe") continue
      expect(Math.abs(r.dust - d.dustValIlvl84), r.key).toBeLessThanOrEqual(1)
    }
  })
})

describe('inherentInfluencesFromPoeDust', () => {
  const row = (q0?: number, q20?: number): PoeDustRow => ({ name: 'X', baseType: 'Y', dustValIlvl84: q0, dustValIlvl84Q20: q20 })
  it('只接受恰好吻合的 1 / 2', () => {
    expect(inherentInfluencesFromPoeDust(10, row(25000, 35000))).toBe(0) // 已吻合
    expect(inherentInfluencesFromPoeDust(10, row(37500, 47500))).toBe(1) // ×1.5
    expect(inherentInfluencesFromPoeDust(10, row(50000, 60000))).toBe(2) // ×2.0
    expect(inherentInfluencesFromPoeDust(10, row(100000, 110000))).toBe(0) // ×4.0(Venarius 型)不套
    expect(inherentInfluencesFromPoeDust(10, row(62500, 72500))).toBe(0) // n=3 不接受
    expect(inherentInfluencesFromPoeDust(10, row(37500, 52500))).toBe(0) // q0 像 n=1 但 q20 不吻合
    expect(inherentInfluencesFromPoeDust(10, row(38000, 48000))).toBe(0) // 比值 1.52 不恰好
    expect(inherentInfluencesFromPoeDust(10, row(37500))).toBe(0) // 缺 q20
    expect(inherentInfluencesFromPoeDust(10, undefined)).toBe(0)
  })
})

// ---- 排行 ----

const e = (c: number, n = 50, lc = false, t = 'UniqueArmour'): NinjaSnapshotEntry => ({ c, n, lc, t })

function snap (prices: Record<string, NinjaSnapshotEntry>): Pick<NinjaSnapshot, 'prices'> {
  return { prices }
}

const ITEMS: DustUnique[] = [
  { name: 'A Boots', baseType: 'Boot Base', disenchantValue: 10, category: 'Boots' }, // 25000 dust
  { name: 'B Helm', baseType: 'Helm Base', disenchantValue: 40, category: 'Helmet' }, // 100000 dust
  { name: 'C Ring', baseType: 'Ring Base', disenchantValue: 20, category: 'Ring' }, // 50000 / q20 70000
  { name: 'D NoPrice', baseType: 'Gloves Base', disenchantValue: 100, category: 'Gloves' },
  { name: 'E LowConf', baseType: 'Body Base', disenchantValue: 8, category: 'Body Armour' } // 20000
]
const DUST: PoeDustRow[] = [
  { name: 'A Boots', baseType: 'Boot Base', goldCost: 1000, slots: 4 },
  { name: 'B Helm', baseType: 'Helm Base', goldCost: 10000, slots: 4 },
  { name: 'C Ring', baseType: 'Ring Base', goldCost: 2000, slots: 1 },
  { name: 'E LowConf', baseType: 'Body Base', goldCost: 500, slots: 6 }
]
const PRICES = {
  'unique|A Boots|Boot Base': e(1), // 25000/c
  'unique|B Helm|Helm Base': e(10), // 10000/c
  'unique|B Helm|Helm Base|6L': e(1), // 6L 不採用
  'unique|C Ring|Ring Base': e(5), // q0 10000/c
  'unique|E LowConf|Body Base': e(2, 3, true), // 10000/c
  'currency|Abrasive Catalyst': e(0.5, 0, false, 'Currency'),
  'currency|Imbued Catalyst': e(0.25, 0, false, 'Currency')
}

describe('rankUniques', () => {
  it('dust/chaos 排序、6L 不採用、無價排最後', () => {
    const { rows, stats } = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(PRICES), opts: { catalyst: 'never' } })
    expect(rows.map(r => r.item.name)).toEqual(['A Boots', 'B Helm', 'C Ring', 'E LowConf', 'D NoPrice'])
    expect(rows[1].price?.c).toBe(10)
    expect(rows[0].eff['dust/chaos']).toBe(25000)
    const d = rows.find(r => r.item.name === 'D NoPrice')!
    expect(d.noPrice).toBe(true)
    expect(d.metricValue).toBeUndefined()
    expect(d.inPoeDust).toBe(false)
    expect(d.goldFee).toBeUndefined()
    expect(stats).toEqual({ total: 5, priced: 4, noPrice: 1, lowConfidence: 1, catalystUsed: 0, notInPoeDust: 1, noMetric: 1, inherentInfluenced: 0 })
    expect(rows.find(r => r.item.name === 'E LowConf')!.lowConfidence).toBe(true)
  })

  it('催化劑 auto:飾品比較 q0 與 q20 + 20 顆最便宜催化劑', () => {
    const cheap = cheapestCatalyst(snap(PRICES))
    expect(cheap).toEqual({ name: 'Imbued Catalyst', chaos: 0.25 })
    const { rows } = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(PRICES), opts: { catalyst: 'auto' } })
    const c = rows.find(r => r.item.name === 'C Ring')!
    // q0:50000 / 5 = 10000;q20:70000 / (5 + 20×0.25) = 7000 → 不買
    expect(c.catalyst).toMatchObject({ used: false, reason: 'q0-better', name: 'Imbued Catalyst', unitChaos: 0.25, costChaos: 0 })
    expect(c.quality).toBe(0)
    expect(c.dust).toBe(50000)

    // 物品變貴:q0 50000/50 = 1000;q20 70000/55 ≈ 1272.7 → 買
    const pricey = { ...PRICES, 'unique|C Ring|Ring Base': e(50) }
    const c2 = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(pricey), opts: { catalyst: 'auto' } }).rows.find(r => r.item.name === 'C Ring')!
    expect(c2.catalyst).toMatchObject({ used: true, reason: 'q20-better', costChaos: CATALYSTS_FOR_Q20 * 0.25 })
    expect(c2.quality).toBe(20)
    expect(c2.dust).toBe(70000)
    expect(c2.totalChaos).toBe(55)
    expect(c2.eff['dust/total']).toBeCloseTo(70000 / 55)
    expect(c2.eff['dust/chaos']).toBeCloseTo(70000 / 50)

    // never:不考慮;沒有催化劑價:不比較
    const c3 = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(pricey), opts: { catalyst: 'never' } }).rows.find(r => r.item.name === 'C Ring')!
    expect(c3.catalyst.reason).toBe('disabled')
    const noCat = { 'unique|C Ring|Ring Base': e(50) }
    const c4 = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(noCat) }).rows.find(r => r.item.name === 'C Ring')!
    expect(c4.catalyst.reason).toBe('no-catalyst-price')
  })

  it('非飾品品質照選項;飾品在 never 時維持 q0', () => {
    const { rows } = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(PRICES), opts: { quality: 20, catalyst: 'never' } })
    expect(rows.find(r => r.item.name === 'A Boots')!.dust).toBe(35000)
    expect(rows.find(r => r.item.name === 'C Ring')!.dust).toBe(50000)
    expect(rows.find(r => r.item.name === 'A Boots')!.catalyst.reason).toBe('not-jewellery')
  })

  it('ilvl 影響 dust', () => {
    const { rows } = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(PRICES), opts: { ilvl: 68, catalyst: 'never' } })
    expect(rows.find(r => r.item.name === 'A Boots')!.dust).toBe(5000)
  })

  it('gold 估值改變 dust/total 排序', () => {
    // goldValue 0:A 25000/1 > B 100000/10 > C 10000 = E 10000
    const zero = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(PRICES), opts: { metric: 'dust/total', catalyst: 'never' } }).rows
    expect(zero.map(r => r.item.name).slice(0, 2)).toEqual(['A Boots', 'B Helm'])
    // goldValue 10 chaos / 1000 gold:A 25000/(1+10)=2273;B 100000/(10+100)=909;C 50000/(5+20)=2000;E 20000/(2+5)=2857
    const ten = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(PRICES), opts: { metric: 'dust/total', goldValueChaos: 10, catalyst: 'never' } }).rows
    expect(ten.map(r => r.item.name)).toEqual(['E LowConf', 'A Boots', 'C Ring', 'B Helm', 'D NoPrice'])
    expect(ten[0].goldChaos).toBe(5)
    expect(ten[0].totalChaos).toBe(7)
    // 沒有 goldFee 的(poe-dust 沒收錄):gold 估值 > 0 時 dust/total 算不出來(排在後面),估值 0 時照算
    const noGold = [...ITEMS, { name: 'F NoGold', baseType: 'Flask Base', disenchantValue: 100, category: 'Flask' }]
    const p2 = { ...PRICES, 'unique|F NoGold|Flask Base': e(1) }
    const withGold = rankUniques({ items: noGold, dust: DUST, snapshot: snap(p2), opts: { metric: 'dust/total', goldValueChaos: 10, catalyst: 'never' } }).rows
    expect(withGold.find(r => r.item.name === 'F NoGold')!.metricValue).toBeUndefined()
    const noVal = rankUniques({ items: noGold, dust: DUST, snapshot: snap(p2), opts: { metric: 'dust/total', catalyst: 'never' } }).rows
    expect(noVal[0].item.name).toBe('F NoGold')
  })

  it('dust/gold 與 dust/chaos/slot', () => {
    const g = rankUniques({ items: ITEMS, dust: DUST, snapshot: snap(PRICES), opts: { metric: 'dust/gold', catalyst: 'never' } }).rows
    // A 25 / E 40 / C 25 / B 10;D 沒 gold → 最後
    expect(g.map(r => r.item.name)).toEqual(['E LowConf', 'C Ring', 'A Boots', 'B Helm', 'D NoPrice'])
    expect(g[0].eff['dust/gold']).toBe(40)
    const s = rankUniques({ items: ITEMS, dust: indexPoeDust(DUST), snapshot: snap(PRICES), opts: { metric: 'dust/chaos/slot', catalyst: 'never' } }).rows
    // A 25000/4=6250;C 10000/1;B 10000/4=2500;E 10000/6
    expect(s.map(r => r.item.name)).toEqual(['C Ring', 'A Boots', 'B Helm', 'E LowConf', 'D NoPrice'])
  })

  it('沒有快照:全部無價,依 dust 由大到小', () => {
    const { rows, stats } = rankUniques({ items: ITEMS, dust: DUST, snapshot: null })
    expect(stats.priced).toBe(0)
    expect(rows.map(r => r.item.name)).toEqual(['D NoPrice', 'B Helm', 'C Ring', 'A Boots', 'E LowConf'])
  })

  it('filterRanked:最低 dust、最高 gold、隱藏無價/低信心/已隱藏、搜尋', () => {
    const { rows } = rankUniques({ items: ITEMS.map(i => i.name === 'A Boots' ? { ...i, nameZh: '甲靴' } : i), dust: DUST, snapshot: snap(PRICES), opts: { catalyst: 'never' } })
    const names = (f: Parameters<typeof filterRanked>[1]) => filterRanked(rows, f).map(r => r.item.name)
    expect(names({ minDust: 30000 })).toEqual(['B Helm', 'C Ring', 'D NoPrice'])
    expect(names({ maxGold: 1500 })).toEqual(['A Boots', 'E LowConf', 'D NoPrice'])
    expect(names({ hideNoPrice: true, hideLowConfidence: true })).toEqual(['A Boots', 'B Helm', 'C Ring'])
    expect(names({ hidden: new Set(['B Helm|Helm Base']), hideHidden: true })).not.toContain('B Helm')
    expect(names({ hidden: new Set(['B Helm|Helm Base']), hideHidden: false })).toContain('B Helm')
    expect(names({ search: '甲' })).toEqual(['A Boots'])
    expect(names({ search: 'ring base' })).toEqual(['C Ring'])
  })

  it('錄製的 poe.ninja 回應:Headhunter 以 name|baseType 取價(不取 Foulborn / 6L),催化劑來自 Currency 類', () => {
    const REC = 'core/test/recordings/ninja/'
    const acc = parseItemOverview(JSON.parse(read(REC + 'item_UniqueAccessory.json')), 'UniqueAccessory')
    const cur = parseExchangeOverview(JSON.parse(read(REC + 'exchange_Currency.json')), 'Currency')
    const prices: Record<string, NinjaSnapshotEntry> = {}
    for (const l of [...cur.lines, ...acc.lines]) {
      const prev = prices[l.key]
      if (!prev || l.count > prev.n) prices[l.key] = { c: l.chaos, n: l.count, lc: l.lowConfidence, t: l.type }
    }
    const uniques = dustUniquesFromNdjson(read('data/poe1/en/items.ndjson'))
    const dust = parsePoeDust(read('data/dust/poe-dust.json'))
    const cat = cheapestCatalyst(snap(prices))
    expect(cat).toBeDefined()
    expect(cat!.name).toMatch(/ Catalyst$/)
    const { rows } = rankUniques({ items: uniques, dust, snapshot: snap(prices) })
    const hh = rows.find(r => r.item.name === 'Headhunter')!
    expect(hh.price?.c).toBe(5204)
    expect(hh.noPrice).toBe(false)
    expect(hh.goldFee).toBe(42520)
    expect(hh.jewellery).toBe(true)
    expect(['q0-better', 'q20-better']).toContain(hh.catalyst.reason)
    expect(rows.filter(r => !r.noPrice).length).toBeGreaterThan(3)
  })
})

describe('交易站查詢', () => {
  it('name + type、ilvl 下限、腐化、掛單時間、available', () => {
    const q = dustTradeRequest({ name: 'Headhunter', type: 'Leather Belt', ilvlMin: 84, corrupted: 'false', indexed: '1week' })
    expect(q).toEqual({
      query: {
        status: { option: 'available' },
        name: 'Headhunter',
        type: 'Leather Belt',
        stats: [{ type: 'and', filters: [] }],
        filters: {
          misc_filters: { filters: { ilvl: { min: 84 }, corrupted: { option: 'false' } } },
          trade_filters: { filters: { indexed: { option: '1week' } } }
        }
      },
      sort: { price: 'asc' }
    })
    const any = dustTradeRequest({ name: 'X', type: 'Y', corrupted: 'any', indexed: 'any' })
    expect(any.query.filters).toEqual({})
    // 預設掛單時間 1week
    expect(dustTradeRequest({ name: 'X', type: 'Y' }).query.filters.trade_filters?.filters.indexed.option).toBe('1week')
  })
})

describe('面板記憶狀態', () => {
  it('預設值、往返、壞欄位退回預設、標記按聯盟分開', () => {
    const s = defaultDustUiState()
    expect(s.options.ilvl).toBe(84)
    expect(toggleDustMark(s, 'Allflame', 'marked', 'Headhunter|Leather Belt')).toBe(true)
    expect(toggleDustMark(s, 'Allflame', 'hidden', 'Mageblood|Heavy Belt')).toBe(true)
    expect(toggleDustMark(s, 'Standard', 'marked', 'Sin Trek|Stealth Boots')).toBe(true)
    s.options.metric = 'dust/total'
    s.options.goldValueChaos = 2.5
    const back = parseDustUiState(serializeDustUiState(s))
    expect(back).toEqual(s)
    expect(toggleDustMark(back, 'Allflame', 'marked', 'Headhunter|Leather Belt')).toBe(false)
    expect(parseDustUiState(serializeDustUiState(back)).leagues.Allflame).toEqual({ marked: [], hidden: ['Mageblood|Heavy Belt'] })

    const bad = parseDustUiState(JSON.stringify({ options: { ilvl: 'x', quality: 7, metric: 'nope', catalyst: 1, indexed: 'forever' }, leagues: { L: { marked: [1, 'a', 'a'] } } }))
    expect(bad.options).toEqual(defaultDustUiState().options)
    expect(bad.leagues.L).toEqual({ marked: ['a'], hidden: [] })
    expect(parseDustUiState('not json')).toEqual(defaultDustUiState())
    expect(parseDustUiState(null)).toEqual(defaultDustUiState())
  })
})
