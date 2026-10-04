// 第 33 步:書籤快捷存取(quick.ts)與書籤熱鍵(state schema 4)。
import { describe, expect, it } from 'vitest'
import { combine } from '../src/combine'
import type { Mode } from '../src/gen'
import { loadAllPagesFor } from '../src/node'
import { isAlgoPage, listedPages, sectionPageOf, type AlgoPage, type AlgoValue } from '../src/pages'
import { Rng } from '../src/rng'
import { bookmarkBodyOf, combineSels } from '../src/embed'
import { bookmarkHotkeys, bookmarkQuery, findBookmark, quickBookmarks } from '../src/quick'
import { REGEX_STATE_SCHEMA, defaultRegexState, parseRegexState, regexStateSchemaOf, serializeRegexState, type RegexBookmark } from '../src/state'

const GAMES = ['poe1', 'poe2'] as const
const all = { poe1: loadAllPagesFor('poe1'), poe2: loadAllPagesFor('poe2') }
const MODES: Mode[] = ['any', 'all', 'none']

function pickSome (rng: Rng, n: number, max: number): number[] {
  const out = new Set<number>()
  const want = Math.min(n, rng.below(max + 1))
  while (out.size < want) out.add(rng.below(n))
  return [...out].sort((a, b) => a - b)
}

function randomValue (rng: Rng, p: AlgoPage, i: number): AlgoValue {
  const e = p.entries[i]
  if (e.input.kind !== 'range') return { ...e.input.def }
  const lo = e.input.lo
  const a = lo + rng.below(e.input.hi - lo + 1)
  return rng.below(2) ? { min: a } : { max: a }
}

const bm = (o: Partial<RegexBookmark>): RegexBookmark => ({ name: 'n', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['k'], alt: [], ...o })

describe('bookmarkQuery:與「載入書籤後的單頁輸出」逐字相同', () => {
  for (const g of GAMES) {
    it(`${g}:每個清單頁 × 隨機勾選 / 數值 / 模式 / 語言`, () => {
      const pages = all[g]
      let checked = 0
      for (const page of listedPages(pages)) {
        const sec = sectionPageOf(pages, page)
        for (let seed = 1; seed <= 6; seed++) {
          const rng = new Rng(seed * 7919 + page.id.length)
          const picks: Record<string, number[]> = { [page.id]: pickSome(rng, page.entries.length, 6) }
          const values: Record<string, Record<string, AlgoValue>> = {}
          if (sec) {
            picks[sec.id] = pickSome(rng, sec.entries.length, sec.entries.length)
            values[page.id] = {}
            for (const i of picks[sec.id]) values[page.id][sec.entries[i].id] = randomValue(rng, sec as AlgoPage, i)
          }
          if (isAlgoPage(page)) {
            values[page.id] = {}
            for (const i of picks[page.id]) values[page.id][page.entries[i].id] = randomValue(rng, page, i)
          }
          const mode = MODES[rng.below(3)]
          const lang = rng.below(2) ? 'en' : 'zh'
          const body = bookmarkBodyOf(pages, page, picks, values, { game: g, mode, lang })
          if (!body) continue
          // 「存書籤當下」的單頁輸出(store 的 pageCombined)
          const want = combine({ lang, mode, pages: combineSels(pages, picks, values, page.id) })
          const got = bookmarkQuery(pages, { name: 'x', ...body })!
          expect(got, `${page.id} seed ${seed}`).not.toBeNull()
          expect(got.query, `${page.id} seed ${seed}`).toBe(want.query)
          expect(got.length).toBe(want.length)
          expect(got.limit).toBe(want.limit)
          expect(got.missed).toBe(0)
          expect(got.page.id).toBe(page.id)
          checked++
        }
      }
      expect(checked).toBeGreaterThan(20)
    })
  }

  it('頁不存在 → null;鍵全部還原不到 → 空字串 + missed', () => {
    expect(bookmarkQuery(all.poe1, bm({ page: 'no_such_page' }))).toBeNull()
    const r = bookmarkQuery(all.poe1, bm({ keys: ['__gone_1', '__gone_2'], alt: ['', ''] }))!
    expect(r.query).toBe('')
    expect(r.missed).toBe(2)
  })
})

describe('書籤熱鍵(state schema 4)', () => {
  it('hotkey 往返;空白不寫出;schema = 4', () => {
    const s = defaultRegexState()
    s.bookmarks.push(bm({ name: 'a', hotkey: 'Ctrl + Shift + 1' }), bm({ name: 'b' }), bm({ name: 'c', hotkey: '' }))
    const text = serializeRegexState(s)
    const doc = JSON.parse(text)
    expect(doc.schema).toBe(REGEX_STATE_SCHEMA)
    expect(REGEX_STATE_SCHEMA).toBe(5) // 第 36 步起 5(書籤資料夾);熱鍵格式同 4
    expect(doc.bookmarks[0].hotkey).toBe('Ctrl + Shift + 1')
    expect('hotkey' in doc.bookmarks[1]).toBe(false)
    expect('hotkey' in doc.bookmarks[2]).toBe(false)
    const back = parseRegexState(text).state
    expect(back.bookmarks[0].hotkey).toBe('Ctrl + Shift + 1')
    expect(back.bookmarks[1].hotkey).toBeUndefined()
    expect(back.bookmarks[2].hotkey).toBeUndefined()
  })
  it('schema 3 舊檔(沒有 hotkey)照讀;非字串 / 空白 hotkey 丟掉', () => {
    const old = JSON.stringify({
      schema: 3,
      game: 'poe1',
      page: 'map_mods',
      mode: 'any',
      lang: 'zh',
      bilingual: true,
      current: [],
      bookmarks: [
        { name: 'a', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['k'], alt: [] },
        { name: 'b', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['k'], alt: [], hotkey: 5 },
        { name: 'c', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['k'], alt: [], hotkey: '  ' },
        { name: 'd', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['k'], alt: [], hotkey: ' F7 ' }
      ]
    })
    const r = parseRegexState(old)
    expect(r.ok).toBe(true)
    expect(r.state.bookmarks.map(b => b.hotkey)).toEqual([undefined, undefined, undefined, 'F7'])
  })
  it('regexStateSchemaOf', () => {
    expect(regexStateSchemaOf('{"schema": 3}')).toBe(3)
    expect(regexStateSchemaOf('{\n\t"schema": 4,\n\t"game": ""}')).toBe(4)
    expect(regexStateSchemaOf('{"game":"poe1"}')).toBe(0)
    expect(regexStateSchemaOf(serializeRegexState(defaultRegexState()))).toBe(REGEX_STATE_SCHEMA)
  })
  it('bookmarkHotkeys:只列有熱鍵、有遊戲、有名字的;帶原始索引', () => {
    const list = [
      bm({ name: 'a', hotkey: 'F5' }),
      bm({ name: 'b' }),
      bm({ name: 'c', game: '', hotkey: 'F6' }),
      bm({ name: 'd', game: 'poe2', page: 'waystone_mods', hotkey: ' Ctrl + 2 ' })
    ]
    expect(bookmarkHotkeys(list)).toEqual([
      { index: 0, name: 'a', game: 'poe1', hotkey: 'F5' },
      { index: 3, name: 'd', game: 'poe2', hotkey: 'Ctrl + 2' }
    ])
  })
  it('quickBookmarks / findBookmark', () => {
    const list = [bm({ name: 'a' }), bm({ name: 'b', game: 'poe2' }), bm({ name: 'c' }), bm({ name: 'a', game: 'poe2' })]
    expect(quickBookmarks(list, 'poe1').map(x => x.index)).toEqual([0, 2])
    expect(quickBookmarks(list, 'poe2').map(x => x.index)).toEqual([1, 3])
    expect(findBookmark(list, { index: 2, name: 'c' })).toBe(2)
    // 索引移動了:以名字(+ 遊戲)找回
    expect(findBookmark(list, { index: 0, name: 'c' })).toBe(2)
    expect(findBookmark(list, { index: 0, name: 'a', game: 'poe2' })).toBe(3)
    expect(findBookmark(list, { index: 9, name: 'zz' })).toBe(-1)
  })
})
