// 第 40 步:稀有度 | 汙染條件列(rarity.ts)—— 合併(一列兩個 term、`!` 加引號)、各頁接線(數值區 / 商店頁 / 新條件區)、
// 舊值相容(第 35 步稀有度單字、商店頁「已汙染」)、書籤 / 分享碼往返(含物品詞綴數值頁:宿主演算法頁與條件區共用存放鍵)。
// 片段本身的語意(組合 × 分隔寫法、不誤中語料與剪貼簿)在 strict-fragments.test.ts ③。
import { describe, expect, it } from 'vitest'
import { combine } from '../src/combine'
import { bookmarkApplyOf, bookmarkBodyOf, combineSels, resolvedValues, shareStateOf } from '../src/embed'
import { loadAllPagesFor, loadItemModData } from '../src/node'
import { combineOrder, itemModPage, listedPages, sectionPageOf, type AlgoPage } from '../src/pages'
import { bookmarkQuery } from '../src/quick'
import { CONDITION_SECTIONS, encodeRarityChoice, type Corruption } from '../src/rarity'
import { SECTION_HOSTS } from '../src/sections'
import { decodeShare, encodeShare, resolveState } from '../src/share'
import { parseRegexState } from '../src/state'
import type { RegexPage } from '../src/data'

const GAMES = ['poe1', 'poe2'] as const
const pages = { poe1: loadAllPagesFor('poe1'), poe2: loadAllPagesFor('poe2') }
const byId = (g: 'poe1' | 'poe2', id: string): RegexPage => pages[g].find(p => p.id === id)!
const ch = (rarity: string[], corruption: Corruption = '') => ({ choice: encodeRarityChoice({ rarity, corruption }) })
const idx = (p: RegexPage, id: string): number => p.entries.findIndex(e => e.id === id)

describe('條件區接線', () => {
  it('宿主:物品基底(兩遊戲)、碑牌詞綴(PoE2)、物品詞綴數值(兩遊戲);地圖 / 換界石數值區照舊', () => {
    expect(CONDITION_SECTIONS).toEqual({
      poe1: ['vendor_bases_cond', 'item_mod_values_cond'],
      poe2: ['vendor_bases_cond', 'tablet_mods_cond', 'item_mod_values_poe2_cond']
    })
    for (const g of GAMES) {
      for (const id of CONDITION_SECTIONS[g]) {
        const host = SECTION_HOSTS[id]
        expect(host, id).toBeTruthy()
        const sec = sectionPageOf(pages[g], host) as AlgoPage
        expect(sec?.id, `${g} ${host}`).toBe(id)
        expect(sec.entries.map(e => [e.id, e.input.kind, e.input.def])).toEqual([['item_rarity_class', 'rarity', { choice: 'r' }]])
        expect(listedPages(pages[g]).some(p => p.id === id), id).toBe(false)
      }
      // 語料宿主(物品基底 / 碑牌)存在於清單,單頁輸出 = 宿主 + 條件區
      const hosts = CONDITION_SECTIONS[g].map(id => SECTION_HOSTS[id]).filter(h => pages[g].some(p => p.id === h))
      expect(hosts.length, g).toBeGreaterThan(0)
      for (const h of hosts) expect(combineOrder(pages[g], h).map(p => p.id)).toEqual([h, `${h}_cond`])
    }
  })
  it('地圖 / 換界石數值區最後一列 = 條件列(id、預設與第 35 步相同)', () => {
    for (const [g, host] of [['poe1', 'map_mods'], ['poe2', 'waystone_mods']] as const) {
      const sec = sectionPageOf(pages[g], host) as AlgoPage
      const last = sec.entries[sec.entries.length - 1]
      expect([last.id, last.input.kind, last.input.def]).toEqual(['item_rarity_class', 'rarity', { choice: 'rare' }])
    }
  })
  it('商店頁:原「已汙染」列換成條件列,id 仍是 corrupted、預設只有已汙染 → 舊勾選輸出逐字相同', () => {
    for (const [g, id] of [['poe1', 'vendor_items'], ['poe2', 'vendor_items_poe2']] as const) {
      const p = byId(g, id) as AlgoPage
      const e = p.entries.find(x => x.id === 'corrupted')!
      expect([e.input.kind, e.input.def]).toEqual(['rarity', { choice: '|c' }])
      // 舊書籤 / 分享碼的商店頁 numeric 沒有 corrupted 的值(舊列沒有輸入)→ 用預設
      const q = combine({ lang: 'zh', mode: 'any', pages: combineSels(pages[g], { [id]: [idx(p, 'corrupted')] }, {}, id) })
      expect(q.query).toBe('^已汙染$')
      const q2 = combine({ lang: 'en', mode: 'any', pages: combineSels(pages[g], { [id]: [idx(p, 'corrupted')] }, { [id]: { corrupted: ch(['rare'], 'uncorrupted') } }, id) })
      expect(q2.query).toBe('"Rarity[:：] *Rare" "!^Corrupted$"')
    }
  })
})

describe('combine:一列兩個 term', () => {
  it('稀有度與汙染各自一個 AND term;`!` 開頭加引號;不受 mode 影響;無衝突', () => {
    const g = 'poe2'
    const host = byId(g, 'vendor_bases')
    const sec = sectionPageOf(pages[g], host)!
    for (const mode of ['any', 'all', 'none'] as const) {
      const r = combine({
        lang: 'zh', mode,
        pages: combineSels(pages[g], { vendor_bases: [0], [sec.id]: [0] }, { vendor_bases: { item_rarity_class: ch(['normal', 'magic'], 'uncorrupted') } }, 'vendor_bases')
      })
      // none 模式的排除 term 排最後;條件列 term 照樣正向
      expect(r.query, mode).toContain('"稀有度[:：] *(中|魔法)" "!^已汙染$"')
      if (mode !== 'none') expect(r.query.endsWith(' "!^已汙染$"'), `${mode} ${r.query}`).toBe(true)
      const pc = r.perPage.find(x => x.id === sec.id)!
      expect(pc.fragments).toEqual(['稀有度[:：] *(中|魔法)', '!^已汙染$'])
      expect(pc.length).toBe('"稀有度[:：] *(中|魔法)" "!^已汙染$" '.length)
      expect(r.conflicts, mode).toEqual([])
    }
  })
  it('已汙染 term 對有「已汙染」行的語料頁不算誤中(ownLine)', () => {
    for (const g of GAMES) {
      const sec = sectionPageOf(pages[g], 'vendor_bases')!
      const r = combine({ lang: 'zh', mode: 'any', pages: combineSels(pages[g], { vendor_bases: [0, 1], [sec.id]: [0] }, { vendor_bases: { item_rarity_class: ch([], 'corrupted') } }, 'vendor_bases') })
      expect(r.query.endsWith(' ^已汙染$'), r.query).toBe(true)
      expect(r.conflicts.filter(c => c.kind === 'fragment'), g).toEqual([])
    }
  })
  it('什麼都沒選 = 輸入不成立(invalid),不輸出', () => {
    const sec = sectionPageOf(pages.poe1, 'vendor_bases')!
    const r = combine({ lang: 'zh', mode: 'any', pages: combineSels(pages.poe1, { [sec.id]: [0] }, { vendor_bases: { item_rarity_class: ch([]) } }, 'vendor_bases') })
    expect(r.query).toBe('')
    expect(r.conflicts.map(c => c.kind)).toEqual(['invalid'])
  })
})

describe('舊值相容與往返', () => {
  it('schema 5 state 的 item_rarity_class 舊單字照讀,輸出與第 35 步相同', () => {
    const s = parseRegexState(JSON.stringify({
      schema: 5, current: [{ page: 'waystone_mods', keys: [], alt: [], num: ['item_rarity_class'] }],
      numeric: { waystone_mods: { item_rarity_class: { choice: 'magic' } } }
    })).state
    const sec = sectionPageOf(pages.poe2, 'waystone_mods') as AlgoPage
    const q = combine({ lang: 'zh', mode: 'any', pages: combineSels(pages.poe2, { [sec.id]: [idx(sec, 'item_rarity_class')] }, s.numeric, 'waystone_mods') })
    expect(q.query).toBe('"稀有度[:：] *魔法"')
  })
  it('書籤:物品基底 + 條件區往返,快捷字串 = 單頁輸出', () => {
    const g = 'poe1'
    const host = byId(g, 'vendor_bases')
    const sec = sectionPageOf(pages[g], host)!
    const picks = { vendor_bases: [2, 5], [sec.id]: [0] }
    const values = { vendor_bases: { item_rarity_class: ch(['normal'], 'uncorrupted') } }
    const body = bookmarkBodyOf(pages[g], host, picks, values, { game: g, mode: 'any', lang: 'zh' })!
    expect(body.num).toEqual(['item_rarity_class'])
    expect(body.numeric).toEqual({ item_rarity_class: ch(['normal'], 'uncorrupted') })
    const want = combine({ lang: 'zh', mode: 'any', pages: combineSels(pages[g], picks, values, 'vendor_bases') }).query
    expect(want).toContain('"稀有度[:：] *普通" "!^已汙染$"')
    expect(bookmarkQuery(pages[g], { name: 'x', ...body })!.query).toBe(want)
  })
  it('物品詞綴數值頁:宿主自己的數值與條件區共用存放鍵 → 書籤 / 分享碼兩邊都保留', async () => {
    for (const g of GAMES) {
      const page = itemModPage(g, loadItemModData(g))
      const all = [...pages[g].filter(p => p.id !== page.id), page]
      const sec = sectionPageOf(all, page)!
      expect(sec.id).toBe(`${page.id}_cond`)
      const e0 = page.entries[0].id
      const picks = { [page.id]: [0], [sec.id]: [0] }
      const values = { [page.id]: { [e0]: { min: 7 }, item_rarity_class: ch(['rare'], 'uncorrupted') } }
      const want = combine({ lang: 'en', mode: 'any', pages: combineSels(all, picks, values, page.id) }).query
      expect(want.endsWith(' "Rarity[:：] *Rare" "!^Corrupted$"'), want).toBe(true)
      // 書籤
      const body = bookmarkBodyOf(all, page, picks, values, { game: g, mode: 'any', lang: 'en' })!
      expect(body.numeric).toEqual(values[page.id])
      const a = bookmarkApplyOf(all, { name: 'x', ...body })!
      expect(a.values[page.id]).toEqual(values[page.id])
      expect(bookmarkQuery(all, { name: 'x', ...body })!.query).toBe(want)
      // 分享碼
      const share = await decodeShare(await encodeShare(shareStateOf(g, all, picks, values, { mode: 'any', custom: [], excludes: [] })))
      expect(share.warnings).toEqual([])
      expect(share.state.numeric[page.id]).toEqual(values[page.id])
      const r = resolveState(share.state, all)
      expect(r.picks).toMatchObject(picks)
      const back = resolvedValues(r.values)
      expect(back[page.id]).toEqual(values[page.id])
      expect(combine({ lang: 'en', mode: 'any', pages: combineSels(all, r.picks, back, page.id) }).query).toBe(want)
    }
  })
  it('分享碼:碑牌條件區(sections + numeric 以宿主 id 為鍵)往返', async () => {
    const g = 'poe2'
    const sec = sectionPageOf(pages[g], 'tablet_mods')!
    const picks = { tablet_mods: [1], [sec.id]: [0] }
    const values = { tablet_mods: { item_rarity_class: ch(['magic']) } }
    const s = shareStateOf(g, pages[g], picks, values, { mode: 'any', custom: [], excludes: [] })
    expect(s.sections).toEqual({ tablet_mods: ['item_rarity_class'] })
    expect(s.numeric).toEqual({ tablet_mods: { item_rarity_class: ch(['magic']) } })
    const d = await decodeShare(await encodeShare(s))
    const r = resolveState(d.state, pages[g])
    expect(r.picks[sec.id]).toEqual([0])
    expect(resolvedValues(r.values).tablet_mods).toEqual({ item_rarity_class: ch(['magic']) })
  })
})
