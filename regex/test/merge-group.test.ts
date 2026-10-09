// R10(2026-10-09,與 PobTools regex_selftest_r10.cpp 同一份規格):
//   G 合併只限同一物品組(itemGroupOf / planMerge)
//   D 合併時稀有度 / 汙染條件取交集、去重(conditionClash)
//   F 條件片段縮短成遊戲實際印出的格式(「標籤: 值」半形冒號 + 一空白),命中語料其他行則退回
//   S 使用者從遊戲複製的真實物品全文(test/fixtures/regex_samples,與 pob-zh-engine/tests/regex_samples 相同)
//   E 截圖案例端到端
// 遊戲搜尋列逐行、不分大小寫比對每個 term;`!term` = 沒有任何一行中。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { combine, type CombineResult, type CombineSel } from '../src/combine'
import { mergeSels } from '../src/embed'
import type { RegexEntry, RegexLang, RegexPage } from '../src/data'
import { loadAllPagesFor } from '../src/node'
import type { AlgoPage, AlgoValue } from '../src/pages'
import { RARITY_ENTRY_ID } from '../src/pages/numeric-pages'
import { encodeRarityChoice, type Corruption } from '../src/rarity'
import { itemGroupOf, planMerge, sectionHostOf } from '../src/sections'

const pages = { poe1: loadAllPagesFor('poe1'), poe2: loadAllPagesFor('poe2') }
const byId = (g: 'poe1' | 'poe2', id: string): RegexPage => {
  const p = pages[g].find(x => x.id === id)
  if (!p) throw new Error(`${g} ${id} 不存在`)
  return p
}
const idx = (p: RegexPage, id: string): number => p.entries.findIndex(e => e.id === id)
const rarityIdx = (p: AlgoPage): number => p.entries.findIndex(e => e.input.kind === 'rarity')
const choice = (rarity: string[], corruption: Corruption = ''): AlgoValue => ({ choice: encodeRarityChoice({ rarity, corruption }) })
const min = (n: number): AlgoValue => ({ min: n })

/** query → term(去引號) */
function terms (q: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < q.length) {
    if (q[i] === ' ') { i++; continue }
    if (q[i] === '"') {
      const e = q.indexOf('"', i + 1)
      out.push(q.slice(i + 1, e < 0 ? q.length : e))
      i = e < 0 ? q.length : e + 1
    } else {
      const e = q.indexOf(' ', i)
      out.push(q.slice(i, e < 0 ? q.length : e))
      i = e < 0 ? q.length : e
    }
  }
  return out
}

const hits = (f: string, text: string): boolean => new RegExp(f, 'i').test(text)
/** 正 term = 某行中;`!x` = 沒有一行中 */
function holdsFor (term: string, item: readonly string[]): boolean {
  const neg = term.startsWith('!')
  const f = neg ? term.slice(1) : term
  const any = item.some(l => hits(f, l))
  return neg ? !any : any
}

const countKind = (r: CombineResult, k: string): number => r.conflicts.filter(c => c.kind === k).length

/** 宿主語料頁(無勾選)+ 條件列一個勾選:單頁輸出的條件 term */
function sectionTerms (host: RegexPage, sec: AlgoPage, i: number, v: AlgoValue, lang: RegexLang): string[] {
  const r = combine({
    lang, mode: 'any', pages: [{ page: host, picks: [] }, { page: sec, picks: [i], values: { [sec.entries[i].id]: v } }]
  })
  return terms(r.query)
}

/** 「稀有度: 稀有」(遊戲印法;取自條件列自己的標籤與選項) */
function rarityLine (sec: AlgoPage, lang: RegexLang, k: number): string {
  const e = sec.entries[rarityIdx(sec)]
  if (e.input.kind !== 'rarity') throw new Error('not rarity')
  const o = e.input.options[k]
  return `${e[lang][0]}: ${lang === 'zh' ? o.zh : o.en}`
}

// ---- 真實物品全文 ----
const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'regex_samples')
function items (name: string): string[][] {
  const text = fs.readFileSync(path.join(SAMPLES, name), 'utf8').replace(/^﻿/, '')
  const out: string[][] = [[]]
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\r$/, '')
    if (!l) { if (out[out.length - 1].length) out.push([]); continue }
    out[out.length - 1].push(l)
  }
  if (!out[out.length - 1].length) out.pop()
  return out
}

const WAYSTONE = [
  '物品種類: 換界石', '稀有度: 稀有', '幽暗方向', '換界石（階級 2）', '--------',
  '可用的復活數: 2 (augmented)', '怪群大小: +13% (augmented)', '怪物效能: +28% (augmented)', '換界石掉落機率: +50% (augmented)', '--------',
  '物品等級: 68', '--------',
  '{ 前綴 "穿孔的"(階層：1) }', '怪物有6(5-10)%機率在擊中時引起流血', '{ 前綴 "精確的"(階層：1) }', '怪物增加20(10-20)%命中值',
  '{ 後綴 "烈火之"(階層：1) }', '區域中有多個點燃地面', '{ 後綴 "閃避之"(階層：1) }', '怪物為閃避的', '--------',
  '可用於地圖裝置以進入地圖。每個換界石只能被使用一次。'
]

/** 假頁:語料多一行(F4 / F6) */
function withExtraLine (p: RegexPage, id: string, zh: string, en: string): RegexPage {
  const e: RegexEntry = { id, g: 0, t17: false, affixZh: '', zh: [zh], en: [en], hiddenZh: [], hiddenEn: [] }
  return { ...p, entries: [...p.entries, e] }
}

// ---- G ----
describe('R10-G 合併只限同一物品組', () => {
  const EQUIP = ['vendor_bases', 'vendor_items', 'vendor_items_poe2', 'item_mod_values', 'item_mod_values_poe2', 'flask_mods', 'flask_charm_mods', 'gem_names']
  it('G3 物品組對照完整:裝備組成員都是 equipment、section 歸宿主組、其餘頁自成一組', () => {
    for (const g of ['poe1', 'poe2'] as const) {
      const ids = [...pages[g].map(p => p.id), g === 'poe2' ? 'item_mod_values_poe2' : 'item_mod_values']
      for (const id of ids) {
        const grp = itemGroupOf(id)
        expect(grp, id).toBeTruthy()
        const host = sectionHostOf(id)
        if (host) expect(grp, id).toBe(itemGroupOf(host))
        else if (EQUIP.includes(id)) expect(grp, id).toBe('equipment')
        else expect(grp, id).toBe(id)
      }
    }
    expect(itemGroupOf('vendor_bases')).toBe('equipment')
    expect(itemGroupOf('flask_charm_mods')).toBe('equipment')
    expect(itemGroupOf('item_mod_values_poe2_cond')).toBe('equipment')
    expect(itemGroupOf('waystone_numeric')).toBe('waystone_mods')
    expect(itemGroupOf('map_numeric')).toBe('map_mods')
    expect(itemGroupOf('tablet_mods_cond')).toBe('tablet_mods')
    expect(itemGroupOf('tablet_mods')).not.toBe(itemGroupOf('waystone_mods'))
  })

  it('G1 碑牌頁合併不含換界石條件:只併碑牌與其條件區、回報 1 頁未併入', () => {
    const plan = planMerge('tablet_mods', ['waystone_numeric', 'tablet_mods', 'tablet_mods_cond'])
    expect(plan).toEqual({ merged: ['tablet_mods', 'tablet_mods_cond'], skippedPages: 1 })
  })

  it('G2 裝備組可合併:商店基底 + 物品詞綴數值頁都併入;碑牌不併入', () => {
    expect(planMerge('vendor_bases', ['vendor_bases', 'vendor_bases_cond', 'item_mod_values_poe2']))
      .toEqual({ merged: ['vendor_bases', 'vendor_bases_cond', 'item_mod_values_poe2'], skippedPages: 0 })
    expect(planMerge('item_mod_values_poe2', ['vendor_bases', 'item_mod_values_poe2', 'tablet_mods']))
      .toEqual({ merged: ['vendor_bases', 'item_mod_values_poe2'], skippedPages: 1 })
  })

  it('G4 宿主與其 section 都未併入只算 1 頁', () => {
    expect(planMerge('tablet_mods', ['waystone_mods', 'waystone_numeric', 'map_mods']).skippedPages).toBe(2)
  })

  for (const [g, vendorId] of [['poe1', 'vendor_items'], ['poe2', 'vendor_items_poe2']] as const) {
    it(`G5 寶石名稱與商店物品條件可合併(${g}):寶石 + 寶石等級 ≥3 兩頁都併入;碑牌為目前頁時寶石不併入`, () => {
      const gems = byId(g, 'gem_names')
      const vendor = byId(g, vendorId) as AlgoPage
      const lv = idx(vendor, 'gem_level')
      expect(lv).toBeGreaterThanOrEqual(0)
      const picks = { gem_names: [0], [vendorId]: [lv] }
      const values = { [vendorId]: { gem_level: min(3) } }
      const m = mergeSels(pages[g], picks, values, 'gem_names')
      expect(m.picked.map(s => s.page.id).sort()).toEqual(['gem_names', vendorId].sort())
      expect(m.skippedPages).toBe(0)
      const r = combine({ lang: 'zh', mode: 'any', pages: m.sels })
      expect(r.perPage.map(c => c.id).sort()).toEqual(['gem_names', vendorId].sort())
      expect(planMerge(vendorId, ['gem_names', vendorId])).toEqual({ merged: ['gem_names', vendorId], skippedPages: 0 })
      expect(planMerge('tablet_mods', ['gem_names', 'tablet_mods'])).toEqual({ merged: ['tablet_mods'], skippedPages: 1 })
      expect(gems.id).toBe('gem_names')
    })
  }
})

// ---- E ----
describe('R10-E 截圖案例端到端', () => {
  it('E1 以碑牌為目前頁合併 = "%維" "度: 稀",不含「階級」', () => {
    const tablet = byId('poe2', 'tablet_mods')
    const waystone = byId('poe2', 'waystone_mods')
    const tc = byId('poe2', 'tablet_mods_cond') as AlgoPage
    const wn = byId('poe2', 'waystone_numeric') as AlgoPage
    const verisium = idx(tablet, 'TowerExpeditionIncreasedVerisium')
    expect(verisium).toBeGreaterThanOrEqual(0)
    const all: Array<{ id: string, sel: CombineSel }> = [
      { id: 'waystone_mods', sel: { page: waystone, picks: [] } },
      { id: 'waystone_numeric', sel: { page: wn, picks: [idx(wn, 'tier'), idx(wn, RARITY_ENTRY_ID)], values: { tier: min(15), [RARITY_ENTRY_ID]: choice(['magic', 'rare'], 'uncorrupted') } } },
      { id: 'tablet_mods', sel: { page: tablet, picks: [verisium] } },
      { id: 'tablet_mods_cond', sel: { page: tc, picks: [rarityIdx(tc)], values: { [tc.entries[rarityIdx(tc)].id]: choice(['rare']) } } }
    ]
    const plan = planMerge('tablet_mods', ['waystone_numeric', 'tablet_mods', 'tablet_mods_cond'])
    const r = combine({ lang: 'zh', mode: 'any', pages: all.filter(a => plan.merged.includes(a.id)).map(a => a.sel) })
    expect(r.query).not.toContain('階級')
    expect(terms(r.query)).toEqual(['%維', '度: 稀'])
    expect(r.ok).toBe(true)
  })
})

// ---- D ----
describe('R10-D 合併時稀有度 / 汙染條件取交集、去重', () => {
  const a = byId('poe2', 'vendor_bases_cond') as AlgoPage
  const b = byId('poe2', 'item_mod_values_poe2_cond') as AlgoPage
  const run = (va: AlgoValue, vb: AlgoValue, lang: RegexLang): CombineResult => combine({
    lang,
    mode: 'any',
    pages: [
      { page: a, picks: [rarityIdx(a)], values: { [a.entries[rarityIdx(a)].id]: va } },
      { page: b, picks: [rarityIdx(b)], values: { [b.entries[rarityIdx(b)].id]: vb } }
    ]
  })
  for (const lang of ['zh', 'en'] as const) {
    it(`D1 稀有度取交集(${lang}):(魔法|稀有) + 稀有 → 只剩一個稀有度 term、值 = 稀有`, () => {
      const r = run(choice(['magic', 'rare']), choice(['rare']), lang)
      const rar = terms(r.query).filter(t => !t.startsWith('!') && [0, 1, 2, 3].some(k => hits(t, rarityLine(a, lang, k))))
      expect(rar.length).toBe(1)
      expect([0, 1, 2, 3].map(k => hits(rar[0], rarityLine(a, lang, k)))).toEqual([false, false, true, false])
      expect(countKind(r, 'conditionClash')).toBe(0)
      expect(r.ok).toBe(true)
    })
  }
  it('D2 稀有度交集為空:魔法 vs 稀有 → conditionClash、結果不 ok、不出字串', () => {
    const r = run(choice(['magic']), choice(['rare']), 'zh')
    expect(countKind(r, 'conditionClash')).toBeGreaterThanOrEqual(1)
    expect(r.ok).toBe(false)
    expect(r.query).toBe('')
    expect(r.conflicts.find(c => c.kind === 'conditionClash')?.text).toBe('魔法 ↔ 稀有')
  })
  it('D3 汙染衝突:未汙染 vs 已汙染 → conditionClash、結果不 ok', () => {
    const r = run(choice([], 'uncorrupted'), choice([], 'corrupted'), 'zh')
    expect(countKind(r, 'conditionClash')).toBeGreaterThanOrEqual(1)
    expect(r.ok).toBe(false)
    expect(r.query).toBe('')
  })
  for (const lang of ['zh', 'en'] as const) {
    it(`D4 相同 term 去重(${lang}):兩頁同為未汙染 → 只出一次`, () => {
      const r = run(choice([], 'uncorrupted'), choice([], 'uncorrupted'), lang)
      const t = terms(r.query)
      expect(t.length).toBe(1)
      expect(t[0].startsWith('!')).toBe(true)
      expect(countKind(r, 'conditionClash')).toBe(0)
    })
  }
  it('D5 一般演算法 term 重複也只出一次(兩個數值頁同條件)', () => {
    const wn = byId('poe2', 'waystone_numeric') as AlgoPage
    const sel: CombineSel = { page: wn, picks: [idx(wn, 'pack')], values: { pack: min(20) } }
    const r = combine({ lang: 'zh', mode: 'any', pages: [sel, { ...sel }] })
    expect(terms(r.query)).toEqual(['怪群大小: \\+?([2-9][0-9]|[1-9][0-9]{2,})%'])
  })
})

// ---- F ----
describe('R10-F 條件片段縮短(PoE2 / PoE1 皆「標籤: 值」)', () => {
  const waystone = byId('poe2', 'waystone_mods')
  const wn = byId('poe2', 'waystone_numeric') as AlgoPage
  const maps = byId('poe1', 'map_mods')
  const mn = byId('poe1', 'map_numeric') as AlgoPage
  const wR = idx(wn, RARITY_ENTRY_ID)
  const mR = idx(mn, RARITY_ENTRY_ID)

  it('F1 PoE2 稀有度單選縮短:度: 稀 / y: r', () => {
    expect(sectionTerms(waystone, wn, wR, choice(['rare']), 'zh')).toEqual(['度: 稀'])
    expect(sectionTerms(waystone, wn, wR, choice(['rare']), 'en')).toEqual(['y: r'])
  })
  it('F2 PoE2 稀有度多選:度: [魔稀] / y: [mr]', () => {
    expect(sectionTerms(waystone, wn, wR, choice(['magic', 'rare']), 'zh')).toEqual(['度: [魔稀]'])
    expect(sectionTerms(waystone, wn, wR, choice(['magic', 'rare']), 'en')).toEqual(['y: [mr]'])
  })
  it('F3 稀有度片段比對真實物品文字:稀有命中換界石、普通+魔法不中', () => {
    expect(holdsFor('度: 稀', WAYSTONE)).toBe(true)
    expect(holdsFor('度: [魔中]', WAYSTONE)).toBe(false)
    const rare = sectionTerms(waystone, wn, wR, choice(['rare']), 'zh')
    const nm = sectionTerms(waystone, wn, wR, choice(['normal', 'magic']), 'zh')
    expect(rare.length).toBe(1)
    expect(holdsFor(rare[0], WAYSTONE)).toBe(true)
    expect(nm.length).toBe(1)
    expect(holdsFor(nm[0], WAYSTONE)).toBe(false)
  })
  it('F4 稀有度防誤中退回:語料有含「度: 稀」/「y: r」的行 → 退回含完整標籤的寫法', () => {
    const fake = withExtraLine(waystone, 'r10_fake_rarity_lookalike', '測試強度: 稀少的#', 'Test Intensity: rx #')
    const zh = sectionTerms(fake, wn, wR, choice(['rare']), 'zh')
    expect(zh.length).toBe(1)
    expect(zh[0]).toContain('稀有度')
    expect(hits(zh[0], '測試強度: 稀少的5')).toBe(false)
    expect(hits(zh[0], '稀有度: 稀有')).toBe(true)
    const en = sectionTerms(fake, wn, wR, choice(['rare']), 'en')
    expect(en.length).toBe(1)
    expect(en[0]).toContain('Rarity')
    expect(hits(en[0], 'Test Intensity: rx 5')).toBe(false)
    expect(hits(en[0], 'Rarity: Rare')).toBe(true)
  })
  for (const lang of ['zh', 'en'] as const) {
    it(`F5 汙染縮短(${lang}):已汙染 → 最短安全前綴,未汙染 = ! + 同片段,不中本頁其他語料行`, () => {
      const full = lang === 'zh' ? '已汙染' : 'Corrupted'
      const c = sectionTerms(waystone, wn, wR, choice([], 'corrupted'), lang)
      const u = sectionTerms(waystone, wn, wR, choice([], 'uncorrupted'), lang)
      expect(c).toEqual([lang === 'zh' ? '已汙' : 'corr'])
      expect(u).toEqual([`!${c[0]}`])
      const other = waystone.entries.flatMap(e => e[lang]).filter(l => l !== full && hits(c[0], l))
      expect(other).toEqual([])
    })
  }
  it('F5b 汙染縮短:換界石全文(未汙染)不被 已汙 命中,加一行「已汙染」後命中', () => {
    const corrupted = [...WAYSTONE, '已汙染']
    expect(holdsFor('已汙', WAYSTONE)).toBe(false)
    expect(holdsFor('已汙', corrupted)).toBe(true)
    expect(holdsFor('!已汙', WAYSTONE)).toBe(true)
    expect(holdsFor('!已汙', corrupted)).toBe(false)
  })
  it('F6 汙染退回:語料含「已汙染的…」行 → ^已汙染$ / !^已汙染$;PoE1 地圖頁(有「已汙染物品機率」)同樣退回', () => {
    const fake = withExtraLine(waystone, 'r10_fake_corrupted_prefix', '已汙染的地圖掉落機率 #%', 'Corrupted Maps drop chance #%')
    expect(sectionTerms(fake, wn, wR, choice([], 'corrupted'), 'zh')).toEqual(['^已汙染$'])
    expect(sectionTerms(fake, wn, wR, choice([], 'uncorrupted'), 'zh')).toEqual(['!^已汙染$'])
    expect(sectionTerms(maps, mn, mR, choice([], 'corrupted'), 'zh')).toEqual(['^已汙染$'])
  })
  it('F6b 沒有詞綴類語料參與(只有條件區)→ 汙染用整行 ^已汙染$', () => {
    const vc = byId('poe2', 'vendor_bases_cond') as AlgoPage
    const r = combine({ lang: 'zh', mode: 'any', pages: [{ page: vc, picks: [0], values: { [vc.entries[0].id]: choice([], 'corrupted') } }] })
    expect(r.query).toBe('^已汙染$')
  })
  it('F7 階級帶上限:PoE2 ≥15(hi 16)→ 階級 *1[56]),命中階級 15 / 16、不中 1 / 2', () => {
    const t = wn.entries[idx(wn, 'tier')]
    expect(t.input.kind === 'range' && t.input.hi).toBe(16)
    const f = t.fragment(min(15), 'zh')!
    expect(f).toBe('階級 *1[56]）')
    expect(hits(f, '換界石（階級 16）')).toBe(true)
    expect(hits(f, '換界石（階級 15）')).toBe(true)
    expect(hits(f, '換界石（階級 2）')).toBe(false)
    expect(hits(f, '換界石（階級 1）')).toBe(false)
  })
  it('F7b 階級下限高於上限(存檔值超出範圍)→ 維持開放寫法', () => {
    const t = wn.entries[idx(wn, 'tier')]
    expect(t.fragment(min(20), 'zh')).toBe('階級 *[2-9][0-9]）')
  })
  it('F8 PoE2 數值行縮短:怪群大小 ≥10% → 「怪群大小: \\+?…%」,命中 +13%、不中 +9%', () => {
    const f = wn.entries[idx(wn, 'pack')].fragment(min(10), 'zh')!
    expect(hits(f, '怪群大小: +13% (augmented)')).toBe(true)
    expect(hits(f, '怪群大小: +9% (augmented)')).toBe(false)
    expect(f).not.toContain('[:：]')
    expect(f.startsWith('怪群大小: ')).toBe(true)
    expect(f).not.toContain(' *%')
  })
  it('F9 PoE1 也用新格式:稀有度 度: 稀、物品數量「物品數量: 」開頭、階級 ≥16 → 階級 *1[67])', () => {
    expect(sectionTerms(maps, mn, mR, choice(['rare']), 'zh')).toEqual(['度: 稀'])
    const q = mn.entries[idx(mn, 'quantity')].fragment(min(60), 'zh')!
    expect(q).not.toContain('[:：]')
    expect(q.startsWith('物品數量: ')).toBe(true)
    const t = mn.entries[idx(mn, 'tier')]
    expect(t.input.kind === 'range' && t.input.hi).toBe(17)
    expect(t.fragment(min(16), 'zh')).toBe('階級 *1[67]）')
  })
})

// ---- S ----
describe('R10-S 真實物品全文(test/fixtures/regex_samples)', () => {
  const items2 = items('poe2_items_zh.txt')
  const items1 = items('poe1_maps_zh.txt')
  const waystone = byId('poe2', 'waystone_mods')
  const wn = byId('poe2', 'waystone_numeric') as AlgoPage
  const maps = byId('poe1', 'map_mods')
  const mn = byId('poe1', 'map_numeric') as AlgoPage

  it('S 樣本檔物品數:PoE2 2 件、PoE1 9 件;PoE2 第一件 = 規格附的換界石全文', () => {
    expect([items2.length, items1.length]).toEqual([2, 9])
    expect(items2[0]).toEqual(WAYSTONE)
  })
  for (const [name, list, host, sec] of [['poe2', items2, waystone, wn], ['poe1', items1, maps, mn]] as const) {
    it(`S1 ${name} 每件物品:稀有片段命中、普通+魔法片段不中、未汙染成立`, () => {
      const r = idx(sec, RARITY_ENTRY_ID)
      const rare = sectionTerms(host, sec, r, choice(['rare']), 'zh')
      const nm = sectionTerms(host, sec, r, choice(['normal', 'magic']), 'zh')
      const unc = sectionTerms(host, sec, r, choice([], 'uncorrupted'), 'zh')
      expect([rare.length, nm.length, unc.length]).toEqual([1, 1, 1])
      list.forEach((it, i) => {
        expect(holdsFor(rare[0], it), `第 ${i + 1} 件 稀有`).toBe(true)
        expect(holdsFor(nm[0], it), `第 ${i + 1} 件 普通+魔法`).toBe(false)
        expect(holdsFor(unc[0], it), `第 ${i + 1} 件 未汙染`).toBe(true)
        expect(holdsFor('度: 稀', it) && !holdsFor('度: [魔中]', it) && holdsFor('!已汙', it), `第 ${i + 1} 件 字面片段`).toBe(true)
      })
    })
  }
  it('S2 PoE1 階級 ≥16 片段:（階級 16）命中、（階級 14）（階級 8）不中', () => {
    const f = mn.entries[idx(mn, 'tier')].fragment(min(16), 'zh')!
    let with16 = 0
    let low = 0
    items1.forEach((it, i) => {
      const is16 = it.some(l => l.includes('（階級 16）') || l.includes('（階級 17）'))
      const isLow = it.some(l => l.includes('（階級 14）') || l.includes('（階級 8）'))
      if (is16) { with16++; expect(holdsFor(f, it), `第 ${i + 1} 件`).toBe(true) }
      if (isLow) { low++; expect(holdsFor(f, it), `第 ${i + 1} 件`).toBe(false) }
    })
    expect(with16).toBeGreaterThanOrEqual(2)
    expect(low).toBe(2)
  })
  it('S3 PoE1 物品數量 ≥60% 片段:+68/+70/+84/+61/+75/+192 命中、+58/+55/+52 不中', () => {
    const f = mn.entries[idx(mn, 'quantity')].fragment(min(60), 'zh')!
    const pre = '物品數量: +'
    const qty = items1.map(it => { const l = it.find(x => x.startsWith(pre)); return l ? parseInt(l.slice(pre.length), 10) : -1 })
    expect(qty).toEqual([68, 70, 84, 52, 61, 58, 55, 75, 192])
    items1.forEach((it, i) => expect(holdsFor(f, it), `第 ${i + 1} 件 +${qty[i]}%`).toBe(qty[i] >= 60))
  })
})

// ---- 合併輸入(embed.ts mergeSels:renderer store 的「已選(合併)」走它)----
describe('R10-M 合併輸入只取目前頁的物品組', () => {
  const p2 = pages.poe2
  const wn = byId('poe2', 'waystone_numeric') as AlgoPage
  it('M1 碑牌為目前頁:換界石數值區不併入、回報 1 頁未併入', () => {
    const picks = { waystone_numeric: [idx(wn, 'tier')], tablet_mods: [0], tablet_mods_cond: [0] }
    const m = mergeSels(p2, picks, {}, 'tablet_mods')
    expect(m.picked.map(s => s.page.id)).toEqual(['tablet_mods', 'tablet_mods_cond'])
    expect(m.sels.map(s => s.page.id)).toEqual(['tablet_mods', 'tablet_mods_cond'])
    expect(m.skippedPages).toBe(1)
  })
  it('M2 換界石為目前頁、只勾數值區:宿主語料頁(無勾選)一起送進 combine 當防護語料,勾選清單不列它', () => {
    const picks = { waystone_numeric: [idx(wn, RARITY_ENTRY_ID)], tablet_mods: [0] }
    const values = { waystone_mods: { [RARITY_ENTRY_ID]: choice([], 'corrupted') } }
    const m = mergeSels(p2, picks, values, 'waystone_mods')
    expect(m.picked.map(s => s.page.id)).toEqual(['waystone_numeric'])
    expect(m.sels.map(s => [s.page.id, s.picks.length])).toEqual([['waystone_mods', 0], ['waystone_numeric', 1]])
    expect(m.skippedPages).toBe(1)
    // 防護語料是詞綴頁 → 汙染縮短
    expect(combine({ lang: 'zh', mode: 'any', pages: m.sels }).query).toBe('已汙')
  })
  it('M3 沒有任何勾選 = 空、0 頁未併入', () => {
    expect(mergeSels(p2, {}, {}, 'tablet_mods')).toEqual({ sels: [], picked: [], skippedPages: 0 })
  })
})
