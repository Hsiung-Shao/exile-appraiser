// 資料 schema 斷言 + 載入規則(移植自 regex_data.cpp LoadOne:缺鍵為空、zh/en 皆空丟棄、g 越界歸 0)。
import { describe, expect, it } from 'vitest'
import { parseRegexCatalogue } from '../src/data'
import { loadRegexCatalogueFile } from '../src/node'

const EXPECTED = {
  poe1: { map_mods: 125, logbook_mods: 62 },
  poe2: { waystone_mods: 34, tablet_mods: 78, relic_mods: 36, expedition_relic_mods: 55 }
} as const

describe('shipped catalogues(data/regex)', () => {
  for (const game of ['poe1', 'poe2'] as const) {
    const cat = loadRegexCatalogueFile(game)
    it(`${game}: schema 1, pages and entry counts`, () => {
      expect(cat.schema).toBe(1)
      expect(Object.fromEntries(cat.pages.map(p => [p.id, p.entries.length]))).toEqual(EXPECTED[game])
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
