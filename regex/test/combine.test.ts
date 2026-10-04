// combine.ts:多頁合併 + 聯集 corpus Verify。
import { describe, expect, it } from 'vitest'
import { combine, escapeTerm } from '../src/combine'
import { buildCorpus, entryLines, pageAmbient, type RegexPage } from '../src/data'
import { Corpus, charCount, type Entry } from '../src/gen'
import { loadAllPagesFor } from '../src/node'
import { samplePicks } from '../src/rng'
import type { Mode } from '../src/gen'

const poe1 = loadAllPagesFor('poe1')
const poe2 = loadAllPagesFor('poe2')
const page = (pages: RegexPage[], id: string): RegexPage => pages.find(p => p.id === id)!
const mapMods = page(poe1, 'map_mods')
const logbook = page(poe1, 'logbook_mods')
const mapNum = page(poe1, 'map_numeric')
const vendor = page(poe1, 'vendor_items')
const idx = (p: RegexPage, id: string): number => p.entries.findIndex(e => e.id === id)

/** 測試端自己組聯集 corpus(不走 combine 的快取),對整串 query 做 Verify */
function unionVerify (sels: Array<{ page: RegexPage, picks: number[] }>, lang: 'zh' | 'en', query: string) {
  const entries: Entry[] = []
  const amb = { lines: [] as string[], nameLeft: [] as string[], nameRight: [] as string[] }
  const selected: number[] = []
  for (const s of sels) {
    const off = entries.length
    for (const d of s.page.entries) {
      const l = entryLines(d, lang)
      entries.push({ id: `${s.page.id}:${d.id}`, texts: l.texts, hidden: l.hidden })
    }
    const a = pageAmbient(s.page, lang)
    amb.lines.push(...(a.lines ?? [])); amb.nameLeft.push(...(a.nameLeft ?? [])); amb.nameRight.push(...(a.nameRight ?? []))
    for (const i of s.picks) selected.push(off + i)
  }
  return new Corpus(entries, amb).verify(selected, query)
}

describe('combine:單一語料頁 = Corpus.build 逐字相同', () => {
  for (const mode of ['any', 'all', 'none'] as Mode[]) {
    for (const lang of ['zh', 'en'] as const) {
      it(`map_mods ${mode} ${lang}:20 組隨機勾選`, () => {
        for (let seed = 1; seed <= 20; seed++) {
          const picks = samplePicks(seed, mapMods.entries.length, 1 + (seed % 7))
          const want = buildCorpus(mapMods, lang).build(picks, mode)
          const got = combine({ lang, mode, pages: [{ page: mapMods, picks }] })
          expect(got.query).toBe(want.query)
          expect(got.length).toBe(want.length)
          expect(got.perPage[0].unresolved).toBe(want.unresolved.length)
        }
      })
    }
  }
})

describe('combine:地圖詞綴 3 條 + 階級 ≥16 + 物品數量 ≥80 + 6L', () => {
  const ids = ['MapMonsterFast2MapWorlds', 'MapMonsterDamage2MapWorlds', 'MapMonsterChaosDamage2MapWorlds']
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}:合成一串,聯集 corpus Verify ok,長度 = 各段合計`, () => {
      const picks = ids.map(id => idx(mapMods, id))
      expect(picks.every(i => i >= 0)).toBe(true)
      const r = combine({
        lang,
        mode: 'any',
        pages: [
          { page: mapMods, picks },
          { page: mapNum, picks: [idx(mapNum, 'tier'), idx(mapNum, 'quantity')], values: { tier: { min: 16 }, quantity: { min: 80 } } },
          { page: vendor, picks: [idx(vendor, 'links')], values: { links: { choice: '6' } } }
        ]
      })
      const single = buildCorpus(mapMods, lang).build(picks, 'any')
      // 第 35 步嚴格寫法:含空白 → 整個 term 加引號
      const tier = lang === 'zh' ? '"階級 *(1[6-9]|[2-9][0-9])）"' : '"Tier (1[6-9]|[2-9][0-9])\\)"'
      const qty = lang === 'zh'
        ? '"物品數量[:：] *\\+?([89][0-9]|[1-9][0-9]{2,}) *%"'
        : '"Item Quantity[:：] *\\+?([89][0-9]|[1-9][0-9]{2,}) *%"'
      expect(r.query).toBe(`${single.query} ${tier} ${qty} .-.-.-.-.-.`)
      expect(r.length).toBe(charCount(r.query))
      expect(r.ok).toBe(true)
      expect(r.conflicts).toEqual([])
      expect(r.check.ok).toBe(true)
      expect(r.perPage.map(p => [p.id, p.picked])).toEqual([['map_mods', 3], ['map_numeric', 2], ['vendor_items', 1]])
      // 每頁貢獻:語料頁 = token 字數 + 分隔;演算法頁 = term 字數 + 分隔
      expect(r.perPage[0].length).toBe(single.usedTokens.reduce((n, t) => n + charCount(t) + 1, 0))
      expect(r.perPage[1].length).toBe(charCount(tier) + 1 + charCount(qty) + 1)
      expect(r.perPage[2].length).toBe(charCount('.-.-.-.-.-.') + 1)
      // 整串拿掉演算法 term(不經 Corpus,另以正則逐行檢查)= 送進 Verify 的那段;以測試端自組的聯集 corpus 再驗一次
      const algoTerms = [tier, qty, '.-.-.-.-.-.']
      let rest = r.query
      for (const t of algoTerms) rest = rest.replace(' ' + t, '')
      expect(rest).toBe(r.verifyQuery)
      const v = unionVerify([{ page: mapMods, picks }], lang, rest)
      expect(v.ok).toBe(true)
      expect(v.extra).toEqual([])
      expect(v.ambient).toEqual([])
    })
  }
})

describe('combine:None 合併', () => {
  it('None 模式 + 排除詞「反射」→ 只有一個 ! term', () => {
    const picks = samplePicks(5, mapMods.entries.length, 4)
    const r = combine({ lang: 'zh', mode: 'none', pages: [{ page: mapMods, picks }], excludes: ['反射'] })
    expect((r.query.match(/!/g) ?? []).length).toBe(1)
    expect(r.query.startsWith('"!')).toBe(true)
    expect(r.query.endsWith('|反射"')).toBe(true)
    expect(r.excludes).toEqual([{ text: '反射', token: '反射' }])
    expect(r.ok).toBe(true)
  })
  it('兩個語料頁的 None 片段也只併成一個 ! term', () => {
    const r = combine({
      lang: 'zh',
      mode: 'none',
      pages: [{ page: mapMods, picks: [0, 5] }, { page: page(poe1, 'logbook_mods'), picks: [10] }],
      excludes: ['反射', '!驚嘆']
    })
    // 未跳脫的 `!` 只有一個(排除詞自己的 `!` 已跳脫成 `\!`)
    expect((r.query.match(/(^|[^\\])!/g) ?? []).length).toBe(1)
    expect(r.query).toContain('|\\!驚嘆"')
  })
  it('PoE2「稀有怪物 ≥N%」與聖物頁「稀有怪物減少 #% 傷害」:第 35 步起片段要求冒號,不再誤中(以前 `.*` 會報 fragment 衝突)', () => {
    const relic = page(poe2, 'relic_mods')
    const wn = page(poe2, 'waystone_numeric')
    const line = relic.entries.flatMap(e => e.zh).find(t => t.startsWith('稀有怪物') && t.includes('#%'))
    expect(line, '聖物頁仍有「稀有怪物…#%…」行(否則這條測試失去意義)').toBeTruthy()
    const r = combine({ lang: 'zh', mode: 'any', pages: [{ page: relic, picks: [0] }, { page: wn, picks: [idx(wn, 'rare_monsters')] }] })
    expect(r.conflicts.filter(c => c.kind === 'fragment')).toEqual([])
  })
  it('none 之外有演算法 term:!term 在最後,仍只有一個 !', () => {
    const r = combine({
      lang: 'zh', mode: 'none',
      pages: [{ page: mapMods, picks: [1, 2] }, { page: mapNum, picks: [0], values: { tier: { min: 16 } } }]
    })
    expect((r.query.match(/!/g) ?? []).length).toBe(1)
    expect(r.query.indexOf('"階級 ')).toBeGreaterThanOrEqual(0)
    expect(r.query.indexOf('"階級 ')).toBeLessThan(r.query.indexOf('!'))
  })
})

describe('combine:衝突偵測', () => {
  it('跨頁誤中:map_mods 的 token 也中 logbook 的同一行 → extra', () => {
    const i = idx(mapMods, mapMods.entries.find(e => e.en[0] === '#% more Monster Life')!.id)
    const r = combine({ lang: 'zh', mode: 'any', pages: [{ page: mapMods, picks: [i] }, { page: logbook, picks: [idx(logbook, logbook.entries.find(e => e.en[0] === 'Monsters Blind on Hit')!.id)] }] })
    expect(r.conflicts.some(c => c.kind === 'extra' && c.page === 'logbook_mods')).toBe(true)
    expect(r.ok).toBe(false)
  })
  it('演算法片段誤中詞綴行 → fragment 衝突', () => {
    const fake: RegexPage = {
      game: 'poe1', id: 'fake', kind: 'mods', title: 'fake', titleEn: 'fake', note: '', limit: 250, groups: ['g'], groupsEn: ['g'],
      entries: [
        // 第 35 步起片段要求「標籤 + 冒號」,假詞綴行做成同樣格式才誤中
        { id: 'a', g: 0, t17: false, affixZh: '', zh: ['地圖掉落物品數量: +#%'], en: ['x'], hiddenZh: [], hiddenEn: [] },
        { id: 'b', g: 0, t17: false, affixZh: '', zh: ['怪物移動速度'], en: ['y'], hiddenZh: [], hiddenEn: [] }
      ],
      ambientZh: [], ambientEn: [], namePrefixZh: [], nameSuffixZh: [], namePrefixEn: [], nameSuffixEn: []
    }
    const r = combine({ lang: 'zh', mode: 'any', pages: [{ page: fake, picks: [1] }, { page: mapNum, picks: [idx(mapNum, 'quantity')], values: { quantity: { min: 80 } } }] })
    expect(r.conflicts.some(c => c.kind === 'fragment' && c.entry === 'quantity')).toBe(true)
  })
  it('排除詞命中已勾選的詞綴(any 模式)→ exclude 衝突', () => {
    const i = mapMods.entries.findIndex(e => e.zh[0].includes('反射'))
    const r = combine({ lang: 'zh', mode: 'any', pages: [{ page: mapMods, picks: [i] }], excludes: ['反射'] })
    expect(r.conflicts.some(c => c.kind === 'exclude')).toBe(true)
  })
  it('實際資料:兩遊戲數值頁 / 商店頁的全部預設片段對地圖類語料頁(map/logbook、waystone/tablet)不誤中', () => {
    for (const [pages, algoIds] of [[poe1, ['map_numeric', 'vendor_items']], [poe2, ['waystone_numeric', 'vendor_items_poe2']]] as const) {
      // 只看同一類物品會一起出現在搜尋結果的頁(地圖類);聖物 / 遺物頁的「稀有怪物減少 #% 傷害」確實會被「稀有怪物 ≥N%」誤中,那是合併這兩類時才該報的衝突
      const related = ['map_mods', 'logbook_mods', 'waystone_mods', 'tablet_mods']
      const corpusSels = pages.filter(p => related.includes(p.id)).map(p => ({ page: p, picks: [0] }))
      for (const id of algoIds) {
        const ap = page(pages as RegexPage[], id)
        for (const lang of ['zh', 'en'] as const) {
          const r = combine({ lang, mode: 'any', pages: [...corpusSels, { page: ap, picks: ap.entries.map((_, i) => i) }] })
          expect(r.conflicts.filter(c => c.kind === 'fragment' || c.kind === 'invalid'), `${id} ${lang}`).toEqual([])
        }
      }
    }
  })
  it('輸入不成立 → invalid,不產生 term', () => {
    const r = combine({ lang: 'zh', mode: 'any', pages: [{ page: mapNum, picks: [0], values: { tier: { min: 90, max: 10 } } }] })
    expect(r.query).toBe('')
    expect(r.conflicts[0].kind).toBe('invalid')
  })
})

describe('combine:自訂文字', () => {
  it('跳脫正則語法、獨立 term、標 unverified', () => {
    expect(escapeTerm('a.b (c)')).toBe('a\\.b \\(c\\)')
    expect(escapeTerm('"x"')).toBe('x')
    expect(escapeTerm('!neg')).toBe('\\!neg')
    const r = combine({ lang: 'zh', mode: 'any', pages: [], custom: ['6 連結', '品質+20%'] })
    expect(r.query).toBe('"6 連結" 品質\\+20%')
    expect(r.custom.every(c => c.unverified)).toBe(true)
    expect(r.customLength).toBe(charCount('"6 連結"') + 1 + charCount('品質\\+20%') + 1)
  })
})
