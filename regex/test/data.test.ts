// 資料 schema 斷言 + 載入規則(移植自 regex_data.cpp LoadOne:缺鍵為空、zh/en 皆空丟棄、g 越界歸 0)。
import { describe, expect, it } from 'vitest'
import { buildCorpus, entryLines, pageAmbient, parseRegexCatalogue, type RegexEntry, type RegexPage } from '../src/data'
import { keyOf } from '../src/state'
import { bookmarkApplyOf } from '../src/embed'
import { resolveState } from '../src/share'
import { defaultRegexDataDir, loadRegexCatalogueFile } from '../src/node'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// schema 2(2026-09-29 PobTools gen_regex_data{,2}.py 擴頁):PoE1 十頁、PoE2 七頁。
// tablet_mods 78→81、expedition_relic_mods 內容異動是 PoE2 GGPK 4.5.5 快取更新(非產生器改動)。
const EXPECTED = {
  poe1: {
    // 2026-11-13 聖甲蟲頁整頁刪除(3.30 移除聖甲蟲,使用者裁定)
    map_mods: 122, logbook_mods: 62, flask_mods: 82, tincture_mods: 17, cluster_jewel: 388,
    gem_names: 891, tattoos: 132, heist_equipment_mods: 141, heist_contracts: 107, vendor_bases: 1067, // 2026-11-13 萃取物:新頁 17 列、基底 +10
    // 2026-11-04 對照 poe.re 補頁;詞綴名含藥劑 / 珠寶 / 深淵珠寶 / 藥酒,英文同名分列
    beasts: 220, magic_affixes: 1185
  },
  poe2: {
    // tablet_mods 81 → 83:2026-10-09 GGPK 0.5.5.4.2 重抽補上探險「炸藥範圍」「瓦爾遺物」
    waystone_mods: 34, tablet_mods: 83, relic_mods: 36, expedition_relic_mods: 55,
    flask_charm_mods: 21, gem_names: 1050, vendor_bases: 1763
  }
} as const
const KIND: Record<string, 'mods' | 'names'> = {
  gem_names: 'names', tattoos: 'names', vendor_bases: 'names', beasts: 'names', magic_affixes: 'names'
}

describe('shipped catalogues(data/regex)', () => {
  for (const game of ['poe1', 'poe2'] as const) {
    const cat = loadRegexCatalogueFile(game)
    it(`${game}: schema 2, pages, kinds and entry counts`, () => {
      expect(cat.schema).toBe(2)
      expect(Object.fromEntries(cat.pages.map(p => [p.id, p.entries.length]))).toEqual(EXPECTED[game])
      const raw = JSON.parse(readFileSync(path.join(defaultRegexDataDir(), `regex_${game}.json`), 'utf8'))
      for (const p of raw.pages) expect(`${p.id}:${p.kind}`).toBe(`${p.id}:${KIND[p.id] ?? 'mods'}`)
    })
    for (const p of cat.pages) {
      it(`${game}/${p.id}: limit 250, bilingual titles, groups aligned`, () => {
        expect(p.game).toBe(game)
        expect(p.limit).toBe(250)
        expect(p.title).not.toBe('')
        expect(p.titleEn).not.toBe('')
        expect(p.groups.length).toBeGreaterThan(0)
        expect(p.groupsEn.length).toBe(p.groups.length)
      })
      it(`${game}/${p.id}: every entry has id, non-empty zh and en, g in range`, () => {
        const bad = p.entries.filter(e => !e.id || e.zh.length === 0 || e.en.length === 0 ||
          e.zh.some(s => !s) || e.en.some(s => !s) || e.g < 0 || e.g >= p.groups.length)
        expect(bad.map(e => e.id)).toEqual([])
      })
    }
  }
  it('poe2/tablet_mods has 8 groups(使用者裁定:碑牌一頁八組)', () => {
    const t = loadRegexCatalogueFile('poe2').pages.find(p => p.id === 'tablet_mods')!
    expect(t.groups.length).toBe(8)
  })
})

describe('parseRegexCatalogue load rules(regex_data.cpp:92–157)', () => {
  const doc = {
    schema: 1,
    pages: [
      {
        id: 'p',
        title: 'T',
        groups: ['a', 'b'],
        entries: [
          { id: 'keep', zh: ['中'], g: 1 },
          { id: 'both-empty', zh: [], en: [] },
          { id: 'no-keys' },
          { id: 'g-out', en: ['x'], g: 9 },
          { id: 'g-neg', en: ['y'], g: -1 },
          { id: 'non-string', zh: ['ok', 3, null], hiddenEn: 'not-array' },
          'not-an-object'
        ]
      },
      { id: 'empty-page', entries: [] },
      { id: 'no-entries' },
      42
    ]
  }
  const cat = parseRegexCatalogue(doc, 'poe1')
  it('drops entries with neither zh nor en, and pages with no entries', () => {
    expect(cat.pages.map(p => p.id)).toEqual(['p'])
    expect(cat.pages[0].entries.map(e => e.id)).toEqual(['keep', 'g-out', 'g-neg', 'non-string'])
  })
  it('missing keys read as empty / defaults', () => {
    const p = cat.pages[0]
    expect(p.limit).toBe(250)
    expect(p.ambientZh).toEqual([])
    expect(p.namePrefixEn).toEqual([])
    expect(p.titleEn).toBe('')
    expect(p.entries[0]).toMatchObject({ en: [], hiddenZh: [], hiddenEn: [], t17: false, affixZh: '', g: 1 })
  })
  it('g out of range → 0', () => {
    expect(cat.pages[0].entries.find(e => e.id === 'g-out')!.g).toBe(0)
    expect(cat.pages[0].entries.find(e => e.id === 'g-neg')!.g).toBe(0)
  })
  it('non-string array elements are skipped, non-array reads as empty', () => {
    const e = cat.pages[0].entries.find(e => e.id === 'non-string')!
    expect(e.zh).toEqual(['ok'])
    expect(e.hiddenEn).toEqual([])
  })
  it('a file without a pages array, or with a wrongly typed field, is refused', () => {
    expect(() => parseRegexCatalogue({ schema: 1 }, 'poe2')).toThrow(/pages/)
    expect(() => parseRegexCatalogue('{ not json', 'poe2')).toThrow()
    expect(() => parseRegexCatalogue({ pages: [{ id: 5, entries: [{ zh: ['a'] }] }] }, 'poe2')).toThrow(/id/)
  })
})

// 風味文字(GGPK FlavourText)與用途說明(CurrencyItems.Directions)也是遊戲搜尋會比對的物品文字:
// 每個物品自己的進 hidden,整頁共用的進 ambient。
describe('物品風味文字 / 用途說明收進資料', () => {
  const poe1 = loadRegexCatalogueFile('poe1')
  const page = (id: string) => poe1.pages.find(p => p.id === id)!

  // A1 / A2(聖甲蟲風味文字、用途說明)隨聖甲蟲頁 2026-11-13 刪除。
  it('聖甲蟲頁已刪除:舊書籤與舊分享碼指向它時回報找不到頁,不丟例外', () => {
    expect(poe1.pages.some(p => p.id === 'scarabs')).toBe(false)
    const old = { name: '舊', page: 'scarabs', game: 'poe1' as const, mode: 'any' as const, lang: 'zh' as const, keys: ['Metadata/Items/Scarabs/ScarabTormentNew1'], alt: [] }
    expect(bookmarkApplyOf(poe1.pages, old)).toBeNull()
    const r = resolveState({ v: 2, game: 'poe1', mode: 'any', pages: { scarabs: old.keys }, sections: {}, numeric: {}, custom: [], excludes: [] }, poe1.pages)
    expect(r.unknownPages).toEqual(['scarabs'])
    expect(r.missed).toBe(1)
  })

  it('A4 紋身用途說明與寶石風味文字收齊:每個紋身的隱藏或環境文字有右鍵說明行、克塔什誓約的 hiddenZh 有風味文字', () => {
    const t = page('tattoos')
    // 同頁還有符文之結(說明不同),所以這行不是每件都有:收在各紋身自己的隱藏文字(或環境文字);
    // 7 個禁忌紋身(SpecialUnique7<職業>,取代昇華天賦)在 GGPK 本來就沒有這行;其他 SpecialUnique 紋身有
    const dir = '右鍵點擊這個物品，接著再左鍵點擊一個已分配的天賦。'
    const inAmbient = t.ambientZh.some(s => s.startsWith(dir))
    const tattoos = t.entries.filter(x => x.id.includes('AncestralTattoo') && !x.id.includes('SpecialUnique7'))
    expect(tattoos.length).toBeGreaterThan(0)
    expect(tattoos.filter(x => !inAmbient && !x.hiddenZh.some(s => s.startsWith(dir))).map(x => x.zh[0])).toEqual([])
    const g = page('gem_names').entries.find(x => x.zh[0] === '克塔什誓約')
    expect(g, '找不到 克塔什誓約').toBeDefined()
    expect(g!.hiddenZh.some(s => s.includes('釋放克塔什的憤怒，牠是仇恨的化身。')), `hiddenZh=${JSON.stringify(g!.hiddenZh)}`).toBe(true)
  })
})

// 可捕捉野獸頁(beasts)與詞綴名頁(magic_affixes):頁不存在時是明確的斷言失敗,不丟例外
describe('PoE1 野獸頁與詞綴名頁', () => {
  const poe1 = loadRegexCatalogueFile('poe1')
  const beasts = poe1.pages.find(p => p.id === 'beasts')
  const affixes = poe1.pages.find(p => p.id === 'magic_affixes')
  const byZh0 = (p: RegexPage | undefined, zh0: string) => p?.entries.find(x => x.zh[0] === zh0)
  const hasEn = (e: RegexEntry | undefined, s: string) => !!e && e.en.some(l => l.includes(s))
  const cave = byZh0(beasts, '洞穴獸')
  const optimistic = byZh0(affixes, '樂觀的')
  const lynx = byZh0(affixes, '山貓之')

  it('B1 野獸頁收錄可捕捉野獸:條目 200–280 筆,有洞穴獸與費爾羅猛虎幻獸', () => {
    expect(beasts, '找不到 beasts 頁').toBeDefined()
    const n = beasts?.entries.length ?? 0
    expect(n >= 200 && n <= 280, `條目數 ${n}`).toBe(true)
    expect(cave, '找不到 zh[0]=洞穴獸').toBeDefined()
    expect(hasEn(cave, 'Cave Beast'), `en=${JSON.stringify(cave?.en)}`).toBe(true)
    const tiger = byZh0(beasts, '費爾羅猛虎幻獸')
    expect(tiger, '找不到 zh[0]=費爾羅猛虎幻獸').toBeDefined()
    expect(hasEn(tiger, 'Farric Tiger Alpha'), `en=${JSON.stringify(tiger?.en)}`).toBe(true)
  })

  it('B2 野獸的種屬 / 群組 / 家族進 hidden:洞穴獸 hiddenZh 含巨人、熊類動物、獸性,hiddenEn 含 Gargantuans、Ursae、The Wilds', () => {
    expect(cave, '找不到 zh[0]=洞穴獸').toBeDefined()
    const hz = cave?.hiddenZh ?? []
    const he = cave?.hiddenEn ?? []
    for (const s of ['巨人', '熊類動物', '獸性']) expect(hz.some(l => l.includes(s)), `hiddenZh 缺 ${s}:${JSON.stringify(hz)}`).toBe(true)
    for (const s of ['Gargantuans', 'Ursae', 'The Wilds']) expect(he.some(l => l.includes(s)), `hiddenEn 缺 ${s}:${JSON.stringify(he)}`).toBe(true)
  })

  it('B3 停用的野獸不收:beasts 頁沒有恐懼之狼 / Dire Wolf', () => {
    expect(beasts, '找不到 beasts 頁').toBeDefined()
    const bad = (beasts?.entries ?? []).filter(e => e.zh.some(s => s.includes('恐懼之狼')) || e.en.some(s => s.includes('Dire Wolf')))
    expect(bad.map(e => e.id)).toEqual([])
  })

  it('M1 詞綴名分前後綴:groups 為 [前綴, 後綴]、樂觀的 g=0、山貓之 g=1、冷凍的只有一條且 en 含三個英文名', () => {
    expect(affixes, '找不到 magic_affixes 頁').toBeDefined()
    expect(affixes?.groups).toEqual(['前綴', '後綴'])
    expect(optimistic, '找不到 zh[0]=樂觀的').toBeDefined()
    expect(hasEn(optimistic, 'Sanguine'), `en=${JSON.stringify(optimistic?.en)}`).toBe(true)
    expect(optimistic?.g).toBe(0)
    expect(lynx, '找不到 zh[0]=山貓之').toBeDefined()
    expect(hasEn(lynx, 'of the Lynx'), `en=${JSON.stringify(lynx?.en)}`).toBe(true)
    expect(lynx?.g).toBe(1)
    const frosted = (affixes?.entries ?? []).filter(e => e.zh[0] === '冷凍的')
    expect(frosted.length, '冷凍的條目數').toBe(1)
    for (const s of ['Frosted', 'Chilled', 'Freezing']) expect(hasEn(frosted[0], s), `en 缺 ${s}:${JSON.stringify(frosted[0]?.en)}`).toBe(true)
  })

  it('M2 詞綴行進 hidden:樂觀的 含「# 最大生命」/「# to maximum Life」、山貓之 含「# 敏捷」/「# to Dexterity」', () => {
    expect(optimistic, '找不到 zh[0]=樂觀的').toBeDefined()
    expect(lynx, '找不到 zh[0]=山貓之').toBeDefined()
    const has = (v: string[] | undefined, s: string) => (v ?? []).some(l => l.includes(s))
    expect(has(optimistic?.hiddenZh, '# 最大生命'), `hiddenZh=${JSON.stringify(optimistic?.hiddenZh)}`).toBe(true)
    expect(has(optimistic?.hiddenEn, '# to maximum Life'), `hiddenEn=${JSON.stringify(optimistic?.hiddenEn)}`).toBe(true)
    expect(has(lynx?.hiddenZh, '# 敏捷'), `hiddenZh=${JSON.stringify(lynx?.hiddenZh)}`).toBe(true)
    expect(has(lynx?.hiddenEn, '# to Dexterity'), `hiddenEn=${JSON.stringify(lynx?.hiddenEn)}`).toBe(true)
  })

  it('M4 單選片段不中別的條目:洞穴獸、樂觀的各單選,片段非空且 verify ok', () => {
    for (const [page, e, name] of [[beasts, cave, '洞穴獸'], [affixes, optimistic, '樂觀的']] as const) {
      expect(page && e, `找不到 ${name} 或其頁`).toBeTruthy()
      if (!page || !e) continue
      const i = page.entries.indexOf(e)
      const c = buildCorpus(page, 'zh')
      const r = c.build([i], 'any')
      expect(r.query, `${name} 單選片段為空`).not.toBe('')
      const v = c.verify([i], r.query)
      expect(v.ok, `${name} query=${r.query} extra=${v.extra.length} ambient=${v.ambient.length}`).toBe(true)
    }
  })
})

// 第二輪:英文同名的詞綴分兩列、更多物品類型的詞綴名、名稱接縫資料、解不出的列要有正當理由
describe('PoE1 詞綴名頁第二輪', () => {
  const poe1 = loadRegexCatalogueFile('poe1')
  const affixes = poe1.pages.find(p => p.id === 'magic_affixes')
  const byZh0 = (p: RegexPage | undefined, zh0: string) => p?.entries.find(x => x.zh[0] === zh0)
  const hasEn = (e: RegexEntry | undefined, s: string) => !!e && e.en.some(l => l.includes(s))

  it('M5 英文同名的詞綴分成兩列:低鳴的 / 雷電之 兩列 en[0] 都是 Humming,且整頁沒有任何條目帶 altZh', () => {
    expect(affixes, '找不到 magic_affixes 頁').toBeDefined()
    const a = byZh0(affixes, '低鳴的')
    const b = byZh0(affixes, '雷電之')
    expect(a, '找不到 zh[0]=低鳴的').toBeDefined()
    expect(b, '找不到 zh[0]=雷電之').toBeDefined()
    expect(a?.en[0]).toBe('Humming')
    expect(b?.en[0]).toBe('Humming')
    expect(a?.altZh ?? []).toEqual([])
    expect(b?.altZh ?? []).toEqual([])
    const withAlt = (affixes?.entries ?? []).filter(e => (e.altZh ?? []).length > 0)
    expect(withAlt.map(e => e.id), '帶 altZh 的條目').toEqual([])
  })

  it('M6 收錄藥劑 / 藥酒 / 深淵珠寶 / 珠寶的詞綴名:山羊之 g=1、草藥的 g=0、健壯之 g=0、魯莽的 en 含 Brutal', () => {
    expect(affixes, '找不到 magic_affixes 頁').toBeDefined()
    const ibex = byZh0(affixes, '山羊之')
    const herbal = byZh0(affixes, '草藥的')
    const hale = byZh0(affixes, '健壯之')
    const brutal = byZh0(affixes, '魯莽的')
    expect(ibex, '找不到 山羊之').toBeDefined()
    expect(hasEn(ibex, 'of the Ibex'), `en=${JSON.stringify(ibex?.en)}`).toBe(true)
    expect(ibex?.g).toBe(1)
    expect(herbal, '找不到 草藥的').toBeDefined()
    expect(hasEn(herbal, 'Herbal'), `en=${JSON.stringify(herbal?.en)}`).toBe(true)
    expect(herbal?.g).toBe(0)
    expect(hale, '找不到 健壯之').toBeDefined()
    expect(hasEn(hale, 'Hale'), `en=${JSON.stringify(hale?.en)}`).toBe(true)
    expect(hale?.g).toBe(0)
    expect(brutal, '找不到 魯莽的').toBeDefined()
    expect(hasEn(brutal, 'Brutal'), `en=${JSON.stringify(brutal?.en)}`).toBe(true)
  })

  it('S1 名稱接縫資料:nameWords 前綴含 樂觀的 / Sanguine,後綴含 山貓之 與 " of the Lynx"(前有空白)', () => {
    expect(affixes, '找不到 magic_affixes 頁').toBeDefined()
    expect(affixes?.namePrefixZh ?? [], 'nameWordsZh.prefix').toContain('樂觀的')
    expect(affixes?.nameSuffixZh ?? [], 'nameWordsZh.suffix').toContain('山貓之')
    expect(affixes?.namePrefixEn ?? [], 'nameWordsEn.prefix').toContain('Sanguine')
    expect(affixes?.nameSuffixEn ?? [], 'nameWordsEn.suffix').toContain(' of the Lynx')
  })

  // 單選解不出(片段為空)的列,必須是「它的每個名稱都整段被別處包含」才算正當
  for (const id of ['beasts', 'magic_affixes']) {
    for (const lang of ['zh', 'en'] as const) {
      it(`U1 ${id} ${lang}:單選解不出的列,每個名稱都整段出現在另一列的名稱 / hidden 或頁面 ambient`, () => {
        const page = poe1.pages.find(p => p.id === id)
        expect(page, `找不到 ${id} 頁`).toBeDefined()
        if (!page) return
        const c = buildCorpus(page, lang)
        const low = (s: string) => s.toLowerCase()
        const hay = page.entries.map(e => {
          const l = entryLines(e, lang)
          return [...l.texts, ...l.hidden].map(low)
        })
        const amb = (pageAmbient(page, lang).lines ?? []).map(low)
        const bad: string[] = []
        page.entries.forEach((e, i) => {
          if (c.build([i], 'any').query !== '') return
          const names = entryLines(e, lang).texts
          const contained = names.every(n => {
            const x = low(n)
            return amb.some(a => a.includes(x)) || hay.some((h, j) => j !== i && h.some(s => s.includes(x)))
          })
          if (!contained) bad.push(`${e.id}: ${names.join(' / ')}`)
        })
        expect(bad.length, `共 ${bad.length} 列,前 10 筆:\n${bad.slice(0, 10).join('\n')}`).toBe(0)
      })
    }
  }
})

// 第三輪:英文首行重複的列帶唯一 key、取鍵函式優先用它、藥酒基底進詞綴名頁
describe('PoE1 詞綴名頁第三輪', () => {
  const raw = JSON.parse(readFileSync(path.join(defaultRegexDataDir(), 'regex_poe1.json'), 'utf8'))
  const rawPage = (raw.pages as Array<{ id: string, entries: Array<Record<string, unknown>> }>).find(p => p.id === 'magic_affixes')
  const rawRows = rawPage?.entries ?? []
  const rawZh0 = (e: Record<string, unknown>): string => (e.zh as string[] | undefined)?.[0] ?? ''
  const rawEn0 = (e: Record<string, unknown>): string => (e.en as string[] | undefined)?.[0] ?? ''
  const rawKey = (e: Record<string, unknown> | undefined): string => (typeof e?.key === 'string' ? e.key : '')

  it('K1 英文首行重複的列帶唯一鍵:重複列都有非空 key、全頁 key 互不相同、低鳴的 / 雷電之 以 Humming# 開頭且不同、樂觀的沒有 key', () => {
    expect(rawPage, '找不到 magic_affixes 頁').toBeDefined()
    const count = new Map<string, number>()
    for (const e of rawRows) count.set(rawEn0(e), (count.get(rawEn0(e)) ?? 0) + 1)
    const noKey = rawRows.filter(e => (count.get(rawEn0(e)) ?? 0) > 1 && rawKey(e) === '')
    expect(noKey.slice(0, 10).map(e => `${rawZh0(e)} / ${rawEn0(e)}`), `en[0] 重複卻沒有 key 的列共 ${noKey.length}`).toEqual([])
    const keys = rawRows.map(rawKey).filter(k => k !== '')
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(keys.length, '全頁沒有任何 key').toBeGreaterThan(0)
    expect(dup.slice(0, 10), 'key 重複').toEqual([])
    const low = rawRows.find(e => rawZh0(e) === '低鳴的')
    const thunder = rawRows.find(e => rawZh0(e) === '雷電之')
    expect(rawKey(low)).toMatch(/^Humming#/)
    expect(rawKey(thunder)).toMatch(/^Humming#/)
    expect(rawKey(low)).not.toBe(rawKey(thunder))
    const opt = rawRows.find(e => rawZh0(e) === '樂觀的')
    expect(opt, '找不到 樂觀的').toBeDefined()
    expect(opt !== undefined && 'key' in opt, '樂觀的 不該有 key 欄位').toBe(false)
  })

  it('K2 取鍵函式優先用 key:雷電之 的 keyOf 等於資料裡的 key,樂觀的 的 keyOf 是 Sanguine', () => {
    const page = loadRegexCatalogueFile('poe1').pages.find(p => p.id === 'magic_affixes')
    expect(page, '找不到 magic_affixes 頁').toBeDefined()
    const thunder = page?.entries.find(e => e.zh[0] === '雷電之')
    const opt = page?.entries.find(e => e.zh[0] === '樂觀的')
    expect(thunder, '找不到 雷電之').toBeDefined()
    expect(opt, '找不到 樂觀的').toBeDefined()
    const want = rawKey(rawRows.find(e => rawZh0(e) === '雷電之'))
    expect(want, '資料裡 雷電之 沒有 key').not.toBe('')
    expect(thunder ? keyOf(thunder) : undefined).toBe(want)
    expect(opt ? keyOf(opt) : undefined).toBe('Sanguine')
  })

  it('T1 藥酒基底進詞綴名頁:ambient 含 Ashbark Tincture / 灰樹皮萃取物,nameWords 前綴含英文、後綴含中文', () => {
    const page = loadRegexCatalogueFile('poe1').pages.find(p => p.id === 'magic_affixes')
    expect(page, '找不到 magic_affixes 頁').toBeDefined()
    expect(page?.ambientEn.some(s => s.includes('Ashbark Tincture')), 'ambientEn 缺 Ashbark Tincture').toBe(true)
    expect(page?.ambientZh.some(s => s.includes('灰樹皮萃取物')), 'ambientZh 缺 灰樹皮萃取物').toBe(true)
    expect(page?.namePrefixEn ?? [], 'nameWordsEn.prefix').toContain('Ashbark Tincture')
    expect(page?.nameSuffixZh ?? [], 'nameWordsZh.suffix').toContain('灰樹皮萃取物')
  })
})

// PoE2 語料:連結標記要剝成顯示字、基底的風味文字與詞綴行要收進來
describe('PoE2 物品基底語料', () => {
  const poe2 = loadRegexCatalogueFile('poe2')
  const vendorBases = poe2.pages.find(p => p.id === 'vendor_bases')!
  const entry = (id: string) => vendorBases.entries.find(x => x.id === id)

  it('A5 PoE2 語料不留連結標記:所有頁與條目的任何字串都沒有 [Key|顯示] 或 [Key]', () => {
    const raw = JSON.parse(readFileSync(path.join(defaultRegexDataDir(), 'regex_poe2.json'), 'utf8'))
    const pipe = /\[[^\]|]+\|[^\]]+\]/
    const bare = /\[[A-Za-z][A-Za-z0-9]*\]/
    const bad: string[] = []
    const walk = (v: unknown, where: string): void => {
      if (typeof v === 'string') {
        if (pipe.test(v) || bare.test(v)) bad.push(`${where}: ${v}`)
      } else if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${where}[${i}]`))
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`)
      }
    }
    for (const p of raw.pages) walk(p, p.id)
    expect(raw.pages.length, '找不到任何頁').toBeGreaterThan(0)
    expect(bad.length, `共 ${bad.length} 筆,前幾筆:\n${bad.slice(0, 5).join('\n')}`).toBe(0)
  })

  it('A6 PoE2 基底風味文字進語料:悼亡護身符 / 恆生之戒的 hidden 與 vendor_bases 頁 ambient 收齊', () => {
    const amu = entry('Metadata/Items/Amulets/FourAmuletB1a')
    const ring = entry('Metadata/Items/Rings/FourRingB1')
    expect(amu, '找不到 FourAmuletB1a').toBeDefined()
    expect(ring, '找不到 FourRingB1').toBeDefined()
    // 各自的風味文字:該條目 hidden ∪ 整頁 ambient(不限定在哪一層)
    const zhOf = (e: { hiddenZh: string[] }) => [...e.hiddenZh, ...vendorBases.ambientZh]
    const enOf = (e: { hiddenEn: string[] }) => [...e.hiddenEn, ...vendorBases.ambientEn]
    expect(zhOf(amu!).some(s => s.includes('我們尋覓那消逝的追憶……')), `悼亡護身符 hidden∪ambient 中文找不到`).toBe(true)
    expect(enOf(amu!).some(s => s.includes('We search for the memories missing...')), `悼亡護身符 hidden∪ambient 英文找不到`).toBe(true)
    expect(zhOf(ring!).some(s => s.includes('保其精髓，使其得以演化。')), `恆生之戒 hidden∪ambient 中文找不到`).toBe(true)
    expect(enOf(ring!).some(s => s.includes('Preserve the essence, so that it may evolve.')), `恆生之戒 hidden∪ambient 英文找不到`).toBe(true)
  })

  it('A7 PoE2 基底詞綴行剝成顯示字:帝金護身符 hidden 有「增加#%找到的物品稀有度」,不留 ItemRarity', () => {
    const e = entry('Metadata/Items/Amulets/FourAmulet10')
    expect(e, '找不到 FourAmulet10').toBeDefined()
    expect(e!.hiddenZh.some(s => s.includes('增加#%找到的物品稀有度')), `hiddenZh=${JSON.stringify(e!.hiddenZh)}`).toBe(true)
    expect(e!.hiddenEn.some(s => s.includes('#% increased Rarity of Items found')), `hiddenEn=${JSON.stringify(e!.hiddenEn)}`).toBe(true)
    expect([...e!.hiddenZh, ...e!.hiddenEn].filter(s => s.includes('ItemRarity'))).toEqual([])
  })
})
