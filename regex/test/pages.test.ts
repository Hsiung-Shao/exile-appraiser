// 演算法頁(regex/src/pages/):片段語意逐值驗證 + 標籤暫代檔與頁面組成。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLabels } from '../src/data'
import { defaultRegexDataDir, loadAllPagesFor, loadRegexCatalogueFile, loadLabelsFor } from '../src/node'
import {
  NUMERIC_LABEL_KEYS, VENDOR_LABEL_KEYS, algoPages, applyPageKeys, isAlgoPage, linkColors, linkedSockets, pageKeysOf,
  propertyFragment, socketColorCount, wholeLine, type AlgoPage, type AlgoValue
} from '../src/pages'

const re = (src: string): RegExp => new RegExp(src, 'i')

describe('labels 暫代檔', () => {
  for (const game of ['poe1', 'poe2'] as const) {
    it(`${game}:演算法頁用到的鍵都在 labels.${game}.json(兩語)`, () => {
      const labels = parseLabels(fs.readFileSync(path.join(defaultRegexDataDir(), `labels.${game}.json`), 'utf8'))
      for (const k of [...NUMERIC_LABEL_KEYS[game], ...VENDOR_LABEL_KEYS[game]]) {
        expect(labels.zh[k], `${k} zh`).toBeTruthy()
        expect(labels.en[k], `${k} en`).toBeTruthy()
        expect(labels.zh[k]).not.toMatch(/\{\d\}|\[/)
      }
    })
    it(`${game}:資料檔 labels 逐鍵優先、暫代檔補缺鍵;schema 1(沒有 labels)只用暫代檔`, () => {
      const cat = loadRegexCatalogueFile(game)
      const noLabels = { ...cat, labels: null }
      expect(loadLabelsFor(noLabels)?.zh.ItemDisplayMapTier).toBeTruthy()
      const fake = { ...cat, labels: { zh: { ItemDisplayMapTier: '假' }, en: { ItemDisplayMapTier: 'Fake' } } }
      const m = loadLabelsFor(fake)!
      expect(m.zh.ItemDisplayMapTier).toBe('假')
      expect(m.zh.Quality).toBe('品質')
      // 兩份都有的鍵:值必須一致(兩條 GGPK 管線互相背書)
      if (cat.labels) {
        const fb = loadLabelsFor(noLabels)!
        for (const lang of ['zh', 'en'] as const) for (const [k, v] of Object.entries(cat.labels[lang])) if (k in fb[lang]) expect(fb[lang][k], k).toBe(v)
      }
    })
  }
})

describe('propertyFragment:對 0–999 每個值逐一比對(多種分隔寫法)', () => {
  const pctLines = (lab: string, v: number): string[] => [`${lab}: +${v}%`, `${lab}：+${v}%`, `${lab} +${v}%`, `${lab}: +${v}% (augmented)`]
  const numLines = (lab: string, v: number): string[] => [`${lab}: ${v}`, `${lab}：${v}`, `${lab} ${v}`]
  const conds: Array<{ v: AlgoValue, ok: (n: number) => boolean }> = [
    { v: { min: 80 }, ok: n => n >= 80 },
    { v: { min: 7 }, ok: n => n >= 7 },
    { v: { min: 150 }, ok: n => n >= 150 },
    { v: { max: 50 }, ok: n => n <= 50 },
    { v: { max: 5 }, ok: n => n <= 5 },
    { v: { min: 60, max: 86 }, ok: n => n >= 60 && n <= 86 },
    { v: { min: 100, max: 120 }, ok: n => n >= 100 && n <= 120 }
  ]
  it('百分比(物品數量,3 位數)', () => {
    for (const c of conds) {
      const f = propertyFragment('物品數量', c.v, 3, true)!
      const r = re(f)
      for (let n = 0; n <= 999; n++) {
        for (const line of pctLines('物品數量', n)) {
          if (r.test(line) !== c.ok(n)) throw new Error(`${f} × 「${line}」 期望 ${c.ok(n)}`)
        }
      }
    }
  })
  it('非百分比(物品等級,3 位數;含 PoE1「：」與 PoE2 空白)', () => {
    for (const c of conds) {
      const f = propertyFragment('物品等級：#', c.v, 3, false)!
      const r = re(f)
      for (let n = 0; n <= 999; n++) {
        for (const line of numLines('物品等級', n)) {
          if (r.test(line) !== c.ok(n)) throw new Error(`${f} × 「${line}」 期望 ${c.ok(n)}`)
        }
      }
    }
  })
  it('英文標籤、大小寫不分', () => {
    const f = propertyFragment('Item Level #', { min: 84 }, 3, false)!
    expect(f).toBe('Item Level.*[^\\d](8[4-9]|9\\d|\\d\\d\\d)')
    expect(re(f).test('item level: 86')).toBe(true)
    expect(re(f).test('Item Level: 83')).toBe(false)
  })
  it('寶石等級:行首錨定,不中「物品等級」「需求 等級」', () => {
    const f = propertyFragment('等級', { min: 20 }, 2, false, true)!
    expect(re(f).test('等級: 20 (最高)')).toBe(true)
    expect(re(f).test('等級: 19')).toBe(false)
    expect(re(f).test('物品等級：84')).toBe(false)
    expect(re(f).test('需求 等級 70')).toBe(false)
  })
  it('片段不用大寫跳脫(\\D、\\W)也不用 {n}', () => {
    for (const c of conds) {
      for (const pct of [true, false]) {
        const f = propertyFragment('X', c.v, 3, pct)!
        expect(f).not.toMatch(/\\[DWS]|[{}]/)
      }
    }
  })
  it('不成立的輸入回 null', () => {
    expect(propertyFragment('X', {}, 3, true)).toBeNull()
    expect(propertyFragment('X', { min: 90, max: 10 }, 3, true)).toBeNull()
  })
})

describe('插槽 / 連結片段', () => {
  const seqs = (len: number): string[][] => {
    if (len === 0) return [[]]
    return seqs(len - 1).flatMap(s => ['r', 'g', 'b'].map(c => [...s, c]))
  }
  it('linkColors:對所有長度 2–6 的 RGB 相連序列逐一比對(需連續相鄰、任意順序)', () => {
    for (const choice of ['rgb', 'rrg', 'gg', 'rgbb', 'rrggbb']) {
      const f = linkColors(choice)!
      const r = re(f)
      const want = [...choice].sort().join('')
      for (let len = 2; len <= 6; len++) {
        for (const s of seqs(len)) {
          const line = `Sockets: ${s.join('-').toUpperCase()}`
          let ok = false
          for (let i = 0; i + choice.length <= s.length; i++) if (s.slice(i, i + choice.length).sort().join('') === want) ok = true
          if (r.test(line) !== ok) throw new Error(`${f} × ${line} 期望 ${ok}`)
        }
      }
    }
    expect(linkColors('rgb')).toBe('b-(g-r|r-g)|g-(b-r|r-b)|r-(b-g|g-b)')
  })
  it('linkColors:斷開(空白)的不算相連', () => {
    expect(re(linkColors('rgb')!).test('Sockets: R-G B')).toBe(false)
  })
  it('linkedSockets:6L / 5L', () => {
    const six = re(linkedSockets(6)!)
    expect(six.test('插槽: R-G-B-R-G-B')).toBe(true)
    expect(six.test('插槽: R-G-B R-G-B')).toBe(false)
    expect(six.test('插槽: R-G-B-R-G')).toBe(false)
    expect(re(linkedSockets(5)!).test('插槽: R-G-B-R-G B')).toBe(true)
  })
  it('socketColorCount:≥3 藍', () => {
    const r = re(socketColorCount('插槽', 'b', 3)!)
    expect(r.test('插槽: B-B R-B')).toBe(true)
    expect(r.test('插槽: B-B-R-G')).toBe(false)
  })
  it('wholeLine', () => {
    expect(wholeLine(['已汙染'])).toBe('^已汙染$')
    expect(re(wholeLine(['塑者之物', '尊師之物'])!).test('尊師之物')).toBe(true)
    expect(re(wholeLine(['塑者之物', '尊師之物'])!).test('塑者之物地圖')).toBe(false)
  })
})

describe('演算法頁組成', () => {
  for (const game of ['poe1', 'poe2'] as const) {
    it(`${game}:數值頁 + 商店頁;每個項目的預設值在兩語下都產得出片段`, () => {
      const pages = loadAllPagesFor(game).filter(isAlgoPage) as AlgoPage[]
      // 第 40 步起後面多了稀有度 / 汙染條件區(物品基底、碑牌詞綴、物品詞綴數值)
      expect(pages.map(p => p.id)).toEqual(game === 'poe1'
        ? ['map_numeric', 'vendor_items', 'vendor_bases_cond', 'item_mod_values_cond']
        : ['waystone_numeric', 'vendor_items_poe2', 'vendor_bases_cond', 'tablet_mods_cond', 'item_mod_values_poe2_cond'])
      for (const p of pages) {
        expect(p.entries.length).toBeGreaterThan(0)
        expect(new Set(p.entries.map(e => e.id)).size).toBe(p.entries.length)
        for (const e of p.entries) {
          expect(e.fragment(e.input.def, 'zh'), `${p.id}/${e.id} zh`).toBeTruthy()
          expect(e.fragment(e.input.def, 'en'), `${p.id}/${e.id} en`).toBeTruthy()
        }
      }
    })
  }
  it('PoE1 階級 ≥16 / 物品數量 ≥80 / 稀有度 的實際片段(第 35 步嚴格寫法)', () => {
    const p = algoPages('poe1', parseLabels(fs.readFileSync(path.join(defaultRegexDataDir(), 'labels.poe1.json'), 'utf8')))[0] as AlgoPage
    const tier = p.entries.find(e => e.id === 'tier')!
    const qty = p.entries.find(e => e.id === 'quantity')!
    const rar = p.entries.find(e => e.id === 'item_rarity_class')!
    // R10:階級 ≥ N 到最高階(PoE1 17)為止;百分比行「標籤: \+?N%」;稀有度列單獨(沒有語料)= 短寫「度: 稀」
    expect(tier.fragment({ min: 16 }, 'zh')).toBe('階級 *1[67]）')
    expect(tier.fragment({ min: 16 }, 'en')).toBe('Tier 1[67]\\)')
    expect(qty.fragment({ min: 80 }, 'zh')).toBe('物品數量: \\+?([89][0-9]|[1-9][0-9]{2,})%')
    expect(qty.fragment({ min: 80 }, 'en')).toBe('Item Quantity: \\+?([89][0-9]|[1-9][0-9]{2,})%')
    expect(rar.fragment({ choice: 'rare' }, 'zh')).toBe('度: 稀')
    expect(rar.fragment({ choice: 'normal' }, 'zh')).toBe('度: 普')
    expect(rar.fragment({ choice: 'unique' }, 'en')).toBe('y: u')
  })
  it('PoE2 怪群大小 ≥20 / 換界石掉落機率 ≥50 / 稀有度 與社群寫法同型(\\d 換成 [0-9])', () => {
    const p = algoPages('poe2', parseLabels(fs.readFileSync(path.join(defaultRegexDataDir(), 'labels.poe2.json'), 'utf8')))[0] as AlgoPage
    const f = (id: string, v: AlgoValue): string | null => p.entries.find(e => e.id === id)!.fragment(v, 'zh')
    // 社群:"怪群大小[:：] *\+?([2-9]\d|[1-9]\d{2,}) *%"、"換界石掉落機率[:：] *\+?([5-9]\d|[1-9]\d{2,}) *%"、"怪物稀有度[:：] *\+?([5-9]|[1-9]\d{1,}) *%"
    // R10:改依遊戲印法「怪群大小: +13% (augmented)」(半形冒號 + 一空白、% 前無空白);稀有度短寫
    expect(f('pack', { min: 20 })).toBe('怪群大小: \\+?([2-9][0-9]|[1-9][0-9]{2,})%')
    expect(f('waystone_drop', { min: 50 })).toBe('換界石掉落機率: \\+?([5-9][0-9]|[1-9][0-9]{2,})%')
    expect(f('monster_rarity', { min: 5 })).toBe('怪物稀有度: \\+?([5-9]|[1-9][0-9]{1,})%')
    expect(f('rarity', { min: 10 })).toBe('物品稀有度: \\+?[1-9][0-9]{1,}%')
    expect(f('item_rarity_class', { choice: 'rare' })).toBe('度: 稀')
    expect(f('item_rarity_class', { choice: 'normal' })).toBe('度: 中')
    expect(f('tier', { min: 14, max: 14 })).toBe('階級 *14）')
  })
  it('演算法頁的鍵是項目 id(不是標籤文字),存 → 還原同一組', () => {
    const p = loadAllPagesFor('poe1').find(x => x.id === 'vendor_items')!
    const k = pageKeysOf(p, [0, 3])
    expect(k.keys).toEqual([p.entries[0].id, p.entries[3].id])
    expect(applyPageKeys(p, [...k.keys, 'nope'])).toEqual({ picked: [0, 3], missed: 1 })
  })
})
