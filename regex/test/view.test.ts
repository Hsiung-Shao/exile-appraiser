// 面板純邏輯(src/view.ts):篩選、勾選浮頂、長度分級,以及 UI 走的「勾選 → 狀態字串 → 還原 → 同一串 query」整條路。
import { describe, expect, it } from 'vitest'
import { buildCorpus } from '../src/data'
import { loadRegexCatalogueFile } from '../src/node'
import { samplePicks } from '../src/rng'
import { applyKeys, collectKeys, defaultRegexState, parseRegexState, picksFor, serializeRegexState } from '../src/state'
import { enLine, entryMatches, hiddenPreview, lengthLevel, lineIn, otherLine, pageHasT17, visibleRows } from '../src/view'

const poe1 = loadRegexCatalogueFile('poe1')
const poe2 = loadRegexCatalogueFile('poe2')
const mapMods = poe1.pages.find(p => p.id === 'map_mods')!
const waystone = poe2.pages.find(p => p.id === 'waystone_mods')!
const none = new Set<number>()
const all = { search: '', group: -1, t17: 'all' as const }

describe('visibleRows', () => {
  it('no filter = every row, in data order', () => {
    expect(visibleRows(mapMods, none, all)).toEqual(mapMods.entries.map((_, i) => i))
  })
  it('T17 three-way: all / only / hide partition the page', () => {
    const only = visibleRows(mapMods, none, { ...all, t17: 'only' })
    const hide = visibleRows(mapMods, none, { ...all, t17: 'hide' })
    expect(only.length).toBe(mapMods.entries.filter(e => e.t17).length)
    expect(only.length).toBe(35)
    expect(only.length + hide.length).toBe(mapMods.entries.length)
    expect(only.every(i => mapMods.entries[i].t17)).toBe(true)
    expect(hide.every(i => !mapMods.entries[i].t17)).toBe(true)
  })
  it('pageHasT17 only on map_mods', () => {
    expect(pageHasT17(mapMods)).toBe(true)
    expect([...poe1.pages, ...poe2.pages].filter(pageHasT17).map(p => p.id)).toEqual(['map_mods'])
  })
  it('search 反射 keeps only rows that mention it (zh / en / affix / id)', () => {
    const rows = visibleRows(mapMods, none, { ...all, search: '反射' })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(mapMods.entries.length)
    for (const i of rows) expect(entryMatches(mapMods.entries[i], '反射')).toBe(true)
    expect(rows.some(i => mapMods.entries[i].zh.some(l => l.includes('反射')))).toBe(true)
  })
  it('English search folds ASCII case only', () => {
    const a = visibleRows(mapMods, none, { ...all, search: 'REFLECT' })
    const b = visibleRows(mapMods, none, { ...all, search: 'reflect' })
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })
  it('group filter', () => {
    const g1 = visibleRows(mapMods, none, { ...all, group: 1 })
    expect(g1.every(i => mapMods.entries[i].g === 1)).toBe(true)
    expect(g1.length).toBe(mapMods.entries.filter(e => e.g === 1).length)
  })
  it('ticked rows float to the top, each half keeping data order', () => {
    const picked = new Set([40, 3, 90])
    const rows = visibleRows(mapMods, picked, all)
    expect(rows.slice(0, 3)).toEqual([3, 40, 90])
    expect(rows.length).toBe(mapMods.entries.length)
    const rest = rows.slice(3)
    expect(rest).toEqual([...rest].sort((a, b) => a - b))
  })
})

describe('labels', () => {
  it('lineIn / otherLine swap with the language', () => {
    const e = mapMods.entries[0]
    expect(lineIn(e, 'zh')).toBe(e.zh[0])
    expect(lineIn(e, 'en')).toBe(enLine(e))
    expect(otherLine(e, 'zh')).toBe(enLine(e))
    expect(otherLine(e, 'en')).toBe(e.zh[0])
  })
  it('hiddenPreview caps at 4 and counts the rest', () => {
    const e = mapMods.entries.find(x => x.hiddenZh.length > 4)!
    const h = hiddenPreview(e, 'zh')
    expect(h.lines).toEqual(e.hiddenZh.slice(0, 4))
    expect(h.more).toBe(e.hiddenZh.length - 4)
  })
})

describe('lengthLevel (regex_tool_ui.cpp:662)', () => {
  it('boundaries at 200 / 250', () => {
    expect(lengthLevel(0, 250)).toBe('ok')
    expect(lengthLevel(200, 250)).toBe('ok')
    expect(lengthLevel(201, 250)).toBe('warn')
    expect(lengthLevel(250, 250)).toBe('warn')
    expect(lengthLevel(251, 250)).toBe('bad')
  })
})

describe('UI pipeline: picks → state json → picks → same query', () => {
  const cases = [
    { page: mapMods, seed: 42, count: 6, mode: 'any' as const },
    { page: waystone, seed: 7, count: 5, mode: 'none' as const }
  ]
  for (const c of cases) {
    it(`${c.page.game}/${c.page.id} --random ${c.seed},${c.count} --mode ${c.mode}`, () => {
      const cli = samplePicks(c.seed, c.page.entries.length, c.count)
      const corpus = buildCorpus(c.page, 'zh')
      const direct = corpus.build(cli, c.mode)
      // UI 存的是排序過的集合
      const s = defaultRegexState()
      const k = collectKeys(c.page, [...cli].sort((a, b) => a - b))
      Object.assign(picksFor(s, c.page.id), k)
      const back = parseRegexState(serializeRegexState(s))
      expect(back.ok).toBe(true)
      const saved = back.state.current.find(p => p.page === c.page.id)!
      const r = applyKeys(c.page, saved.keys, saved.alt)
      expect(r.missed).toBe(0)
      expect(new Set(r.picked)).toEqual(new Set(cli))
      expect(corpus.build(r.picked, c.mode).query).toBe(direct.query)
      expect(corpus.verify(r.picked, direct.query).ok).toBe(true)
    })
  }
})
