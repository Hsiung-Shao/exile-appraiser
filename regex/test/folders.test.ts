// 第 36 步:正則書籤資料夾(folders.ts)與 regex_state schema 5。
// - 遷移:schema 1–4 舊檔 → 讀入 = 全部未分類、沒有資料夾;寫回 schema 5 再讀,書籤內容 / 順序 / 熱鍵 / 數值 / 搜尋字串不變。
// - 資料夾 CRUD、排序、收合、書籤移動(純函式);順序不變式(同遊戲書籤依資料夾順序 → 未分類最後)。
// - 分組顯示(管理頁不略過空資料夾、書籤列 / 快速面板略過;沒有資料夾 = 沒有標題)。
// - 另一代的書籤怎麼編輯都不影響目前遊戲的清單(順序、內容、格子位置、資料夾)。
import { describe, expect, it } from 'vitest'
import type { RegexGame } from '../src/data'
import {
  addFolder, deleteFolder, folderCounts, groupBookmarks, isFolderCollapsed, moveBookmark, moveBookmarkBy, moveFolderBy, moveFolderTo,
  normalizeFolderName, normalizeFolders, renameFolder, setFolderCollapsed, sortBookmarks
} from '../src/folders'
import { loadAllPagesFor } from '../src/node'
import { isAlgoPage, listedPages } from '../src/pages'
import { bookmarkHotkeys, bookmarkQuery, quickBookmarks } from '../src/quick'
import { Rng } from '../src/rng'
import {
  REGEX_STATE_SCHEMA, defaultRegexState, keyOf, parseRegexState, serializeRegexState, zhLine, type RegexBookmark, type RegexUiState
} from '../src/state'

const GAMES = ['poe1', 'poe2'] as const
const all = { poe1: loadAllPagesFor('poe1'), poe2: loadAllPagesFor('poe2') }

const bm = (o: Partial<RegexBookmark>): RegexBookmark => ({ name: 'n', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['k'], alt: [], ...o })

/** 同遊戲書籤依資料夾順序 → 未分類最後(穩定) */
function assertSorted (s: RegexUiState) {
  for (const g of GAMES) {
    const names = s.folders[g].map(f => f.name)
    let last = -1
    for (const b of s.bookmarks) {
      if (b.game !== g) continue
      const r = b.folder ? names.indexOf(b.folder) : names.length
      expect(r, `${g} 書籤「${b.name}」指向不存在的資料夾 ${b.folder}`).toBeGreaterThanOrEqual(0)
      expect(r, `${g} 順序`).toBeGreaterThanOrEqual(last)
      last = r
    }
  }
}

// ---- 舊檔(schema 1–4)----------------------------------------------------------

/** 真實鍵:某遊戲第一個語料頁的前 n 列 */
function realKeys (game: RegexGame, n: number, skip = 0) {
  const page = listedPages(all[game]).find(p => !isAlgoPage(p) && p.entries.length > skip + n)!
  const es = page.entries.slice(skip, skip + n)
  return { page: page.id, keys: es.map(keyOf), alt: es.map(zhLine) }
}

function oldFiles (): Array<[string, string]> {
  const p1 = realKeys('poe1', 3)
  const p1b = realKeys('poe1', 2, 5)
  const p2 = realKeys('poe2', 4)
  const base = { game: 'poe1', page: p1.page, mode: 'any', lang: 'zh', bilingual: true, current: [{ page: p1.page, keys: p1.keys, alt: p1.alt }] }
  const v1 = {
    ...base,
    bookmarks: [
      { name: '一', page: p1.page, game: 'poe1', mode: 'any', lang: 'zh', keys: p1.keys, alt: p1.alt },
      { name: '二', page: p2.page, game: 'poe2', mode: 'all', lang: 'en', keys: p2.keys, alt: p2.alt },
      { name: '三', page: p1b.page, game: 'poe1', mode: 'none', lang: 'zh', keys: p1b.keys, alt: p1b.alt },
      // 舊檔沒有 game 的書籤(UI 依頁補)
      { name: '孤', page: p1.page, mode: 'any', lang: 'zh', keys: p1.keys.slice(0, 1), alt: p1.alt.slice(0, 1) }
    ]
  }
  const v2 = {
    schema: 2,
    ...v1,
    bookmarks: [...v1.bookmarks, { name: '數值', page: 'map_numeric', game: 'poe1', mode: 'any', lang: 'zh', keys: ['map_tier'], alt: [], numeric: { map_tier: { min: 14 } } }],
    numeric: { map_numeric: { map_tier: { min: 16 } } },
    custom: ['abc'],
    excludes: ['xyz'],
    outScope: 'page'
  }
  const v3 = {
    schema: 3,
    ...v1,
    bookmarks: [...v1.bookmarks, { name: '數值3', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [], num: ['map_tier'], numeric: { map_tier: { min: 15 } } }],
    numeric: { map_mods: { map_tier: { min: 13 } } },
    collapsed: ['map_mods']
  }
  const v4 = {
    ...v3,
    schema: 4,
    bookmarks: v3.bookmarks.map((b, i) => (i % 2 === 0 ? { ...b, hotkey: `Ctrl + Shift + ${i + 1}` } : b))
  }
  return [['schema 1', JSON.stringify(v1)], ['schema 2', JSON.stringify(v2)], ['schema 3', JSON.stringify(v3)], ['schema 4', JSON.stringify(v4, null, '\t')]]
}

describe('schema 5 遷移往返(舊 1–4 → 5)', () => {
  it('REGEX_STATE_SCHEMA = 5;寫出 folders / uncatCollapsed', () => {
    expect(REGEX_STATE_SCHEMA).toBe(5)
    const doc = JSON.parse(serializeRegexState(defaultRegexState()))
    expect(doc.schema).toBe(5)
    expect(doc.folders).toEqual({ poe1: [], poe2: [] })
    expect(doc.uncatCollapsed).toEqual([])
  })
  for (const [name, text] of oldFiles()) {
    it(`${name}:讀入 = 全部未分類;寫回 5 再讀,書籤內容 / 順序 / 熱鍵 / 數值 / 搜尋字串不變`, () => {
      const raw = JSON.parse(text)
      const a = parseRegexState(text)
      expect(a.ok).toBe(true)
      const s = a.state
      expect(s.folders).toEqual({ poe1: [], poe2: [] })
      expect(s.uncatCollapsed).toEqual([])
      expect(s.bookmarks.every(b => b.folder === undefined)).toBe(true)
      // 沒有資料夾 → 不重排:順序 = 檔案順序
      expect(s.bookmarks.map(b => b.name)).toEqual(raw.bookmarks.map((b: { name: string }) => b.name))
      // 熱鍵 / 鍵 / 數值與檔案相同(schema ≥ 3 已是新結構;≤ 2 的數值頁書籤由 migrateSections 轉,另有 sections.test 守)
      raw.bookmarks.forEach((rb: RegexBookmark, i: number) => {
        const b = s.bookmarks[i]
        expect(b.hotkey, rb.name).toBe(rb.hotkey)
        if (rb.page !== 'map_numeric') {
          expect(b.keys).toEqual(rb.keys)
          expect(b.alt).toEqual(rb.alt)
          expect(b.num).toEqual(rb.num)
          expect(b.numeric).toEqual(rb.numeric)
          expect([b.mode, b.lang, b.page]).toEqual([rb.mode, rb.lang, rb.page])
        }
      })
      const t5 = serializeRegexState(s)
      expect(JSON.parse(t5).schema).toBe(5)
      expect(JSON.parse(t5).bookmarks.some((b: object) => 'folder' in b)).toBe(false)
      const back = parseRegexState(t5)
      expect(back.ok).toBe(true)
      expect(back.state).toEqual(s)
      expect(serializeRegexState(back.state)).toBe(t5)
      // 搜尋字串逐字相同
      for (const b of s.bookmarks) {
        const g = b.game || 'poe1'
        const q1 = bookmarkQuery(all[g], b)
        const q2 = bookmarkQuery(all[g], back.state.bookmarks[s.bookmarks.indexOf(b)])
        expect(q2?.query, b.name).toBe(q1?.query)
      }
      // 熱鍵清單(main 註冊用)相同
      expect(bookmarkHotkeys(back.state.bookmarks)).toEqual(bookmarkHotkeys(s.bookmarks))
    })
  }
  it('schema 5 帶資料夾往返;收合狀態、未分類收合、書籤 folder 都留著', () => {
    const s = defaultRegexState()
    s.bookmarks.push(bm({ name: 'a', folder: '地圖' }), bm({ name: 'b', game: 'poe2', page: 'waystone_mods' }), bm({ name: 'c' }))
    s.folders.poe1 = [{ name: '地圖', collapsed: true }, { name: '空的', collapsed: false }]
    s.folders.poe2 = [{ name: 'X', collapsed: false }]
    s.uncatCollapsed = ['poe2']
    const text = serializeRegexState(s)
    const back = parseRegexState(text).state
    expect(back.folders).toEqual(s.folders)
    expect(back.uncatCollapsed).toEqual(['poe2'])
    expect(back.bookmarks.map(b => [b.name, b.folder ?? ''])).toEqual([['a', '地圖'], ['b', ''], ['c', '']])
    expect(serializeRegexState(back)).toBe(text)
  })
  it('壞資料:資料夾名稱空白 / 重複被整理;書籤指向不存在的資料夾 → 補資料夾(不丟);亂序 → 排好', () => {
    const text = JSON.stringify({
      schema: 5,
      bookmarks: [bm({ name: 'u' }), bm({ name: 'x', folder: '  甲  ' }), bm({ name: 'y', folder: '丙' }), bm({ name: 'z', folder: '甲' }), bm({ name: 'w', game: 'poe2', folder: '乙' })],
      folders: { poe1: [{ name: '甲' }, { name: ' ' }, { name: '甲', collapsed: true }, '舊字串'], poe2: 'bad' },
      uncatCollapsed: ['poe1', 'poe3', 'poe1']
    })
    const s = parseRegexState(text).state
    expect(s.folders.poe1.map(f => f.name)).toEqual(['甲', '舊字串', '丙'])
    expect(s.folders.poe2.map(f => f.name)).toEqual(['乙'])
    expect(s.uncatCollapsed).toEqual(['poe1'])
    expect(s.bookmarks.map(b => b.name)).toEqual(['x', 'z', 'y', 'u', 'w'])
    expect(s.bookmarks[0].folder).toBe('甲')
    assertSorted(s)
  })
})

// ---- CRUD / 排序 ----------------------------------------------------------------

function sample (): RegexUiState {
  const s = defaultRegexState()
  s.bookmarks.push(
    bm({ name: 'p1a' }), bm({ name: 'p2a', game: 'poe2' }), bm({ name: 'p1b' }), bm({ name: 'p1c' }), bm({ name: 'p2b', game: 'poe2' }), bm({ name: 'orphan', game: '' })
  )
  return s
}
const names = (s: RegexUiState, g: RegexGame) => s.bookmarks.filter(b => b.game === g).map(b => `${b.folder ?? ''}/${b.name}`)

describe('資料夾 CRUD', () => {
  it('新增:名稱正規化、空 / 重複擋下、依遊戲各自一組', () => {
    const s = sample()
    expect(addFolder(s, 'poe1', '  地圖   常用 ')).toBe('ok')
    expect(s.folders.poe1).toEqual([{ name: '地圖 常用', collapsed: false }])
    expect(addFolder(s, 'poe1', '地圖 常用')).toBe('duplicate')
    expect(addFolder(s, 'poe1', '   ')).toBe('empty')
    expect(addFolder(s, 'poe2', '地圖 常用')).toBe('ok') // 另一遊戲可同名
    expect(normalizeFolderName('x'.repeat(100))).toHaveLength(40)
  })
  it('改名:書籤跟著改;同名 / 重複 / 不存在', () => {
    const s = sample()
    addFolder(s, 'poe1', 'A'); addFolder(s, 'poe1', 'B'); addFolder(s, 'poe2', 'A')
    moveBookmark(s, 0, 'A'); moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p2a'), 'A')
    expect(renameFolder(s, 'poe1', 'A', 'B')).toBe('duplicate')
    expect(renameFolder(s, 'poe1', 'Z', 'C')).toBe('missing')
    expect(renameFolder(s, 'poe1', 'A', ' A ')).toBe('ok')
    expect(renameFolder(s, 'poe1', 'A', 'C')).toBe('ok')
    expect(s.folders.poe1.map(f => f.name)).toEqual(['C', 'B'])
    expect(s.bookmarks.find(b => b.name === 'p1a')!.folder).toBe('C')
    expect(s.bookmarks.find(b => b.name === 'p2a')!.folder).toBe('A') // 另一遊戲的同名資料夾不動
    assertSorted(s)
  })
  it('刪除:書籤移回未分類(不刪書籤)、回傳移回數、排到未分類', () => {
    const s = sample()
    addFolder(s, 'poe1', 'A'); addFolder(s, 'poe1', 'B')
    moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1c'), 'A')
    moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1b'), 'B')
    expect(names(s, 'poe1')).toEqual(['A/p1c', 'B/p1b', '/p1a'])
    const before = s.bookmarks.length
    expect(deleteFolder(s, 'poe1', 'A')).toBe(1)
    expect(deleteFolder(s, 'poe1', 'nope')).toBe(-1)
    expect(s.bookmarks).toHaveLength(before)
    expect(s.folders.poe1.map(f => f.name)).toEqual(['B'])
    expect(names(s, 'poe1')).toEqual(['B/p1b', '/p1c', '/p1a'])
    assertSorted(s)
  })
  it('資料夾排序:書籤跟著整組搬', () => {
    const s = sample()
    for (const f of ['A', 'B', 'C']) addFolder(s, 'poe1', f)
    moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1a'), 'C')
    moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1b'), 'A')
    moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1c'), 'B')
    expect(names(s, 'poe1')).toEqual(['A/p1b', 'B/p1c', 'C/p1a'])
    expect(moveFolderTo(s, 'poe1', 'C', 0)).toBe(true)
    expect(names(s, 'poe1')).toEqual(['C/p1a', 'A/p1b', 'B/p1c'])
    expect(moveFolderBy(s, 'poe1', 'C', -1)).toBe(false) // 已在最前
    expect(moveFolderBy(s, 'poe1', 'C', 1)).toBe(true)
    expect(s.folders.poe1.map(f => f.name)).toEqual(['A', 'C', 'B'])
    expect(moveFolderTo(s, 'poe1', 'A', 99)).toBe(true) // 夾進範圍
    expect(s.folders.poe1.map(f => f.name)).toEqual(['C', 'B', 'A'])
    expect(names(s, 'poe1')).toEqual(['C/p1a', 'B/p1c', 'A/p1b'])
    assertSorted(s)
  })
  it('收合:資料夾與未分類各自記、依遊戲分開', () => {
    const s = sample()
    addFolder(s, 'poe1', 'A')
    expect(isFolderCollapsed(s, 'poe1', 'A')).toBe(false)
    expect(setFolderCollapsed(s, 'poe1', 'A', true)).toBe(true)
    expect(setFolderCollapsed(s, 'poe1', 'A', true)).toBe(false)
    expect(setFolderCollapsed(s, 'poe1', '', true)).toBe(true)
    expect(isFolderCollapsed(s, 'poe1', '')).toBe(true)
    expect(isFolderCollapsed(s, 'poe2', '')).toBe(false)
    expect(setFolderCollapsed(s, 'poe1', 'nope', true)).toBe(false)
    expect(s.uncatCollapsed).toEqual(['poe1'])
    setFolderCollapsed(s, 'poe1', '', false)
    expect(s.uncatCollapsed).toEqual([])
  })
})

describe('書籤移動', () => {
  it('下拉選單(移到資料夾最後)/ 拖曳(放在某書籤前並進它的資料夾)/ 上移下移只在同資料夾', () => {
    const s = sample()
    addFolder(s, 'poe1', 'A')
    let i = moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1c'), 'A')
    expect(s.bookmarks[i].name).toBe('p1c')
    i = moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1a'), 'A')
    expect(names(s, 'poe1')).toEqual(['A/p1c', 'A/p1a', '/p1b'])
    // 拖曳 p1b 放在 p1c 前 → 進 A、排第一
    i = moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1b'), '', s.bookmarks.findIndex(b => b.name === 'p1c'))
    expect(s.bookmarks[i].name).toBe('p1b')
    expect(names(s, 'poe1')).toEqual(['A/p1b', 'A/p1c', 'A/p1a'])
    // 放在自己前面 = 不動
    const self = s.bookmarks.findIndex(b => b.name === 'p1c')
    expect(moveBookmark(s, self, '', self)).toBe(self)
    // 上移 / 下移
    const k = s.bookmarks.findIndex(b => b.name === 'p1a')
    const k2 = moveBookmarkBy(s, k, -1)
    expect(s.bookmarks[k2].name).toBe('p1a')
    expect(names(s, 'poe1')).toEqual(['A/p1b', 'A/p1a', 'A/p1c'])
    const top = s.bookmarks.findIndex(b => b.name === 'p1b')
    expect(moveBookmarkBy(s, top, -1)).toBe(top) // 到頭不動
    // 跨遊戲 / 不存在的資料夾 / 孤兒 = 不動
    expect(moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p2a'), '', s.bookmarks.findIndex(b => b.name === 'p1a'))).toBe(-1)
    expect(moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1a'), 'nope')).toBe(-1)
    expect(moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'orphan'), '')).toBe(-1)
    assertSorted(s)
  })
  it('孤兒書籤(沒有 game)與另一遊戲的格子位置不動', () => {
    const s = sample()
    addFolder(s, 'poe1', 'A')
    const slotsOf = (g: RegexGame | '') => s.bookmarks.map((b, i) => (b.game === g ? i : -1)).filter(i => i >= 0)
    const p2Slots = slotsOf('poe2'); const orphanSlots = slotsOf('')
    moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1c'), 'A')
    moveFolderTo(s, 'poe1', 'A', 0)
    expect(slotsOf('poe2')).toEqual(p2Slots)
    expect(slotsOf('')).toEqual(orphanSlots)
  })
})

describe('分組顯示', () => {
  it('沒有資料夾 = 一組未分類、沒有標題、收合無效(= 第 36 步前)', () => {
    const s = sample()
    s.uncatCollapsed = ['poe1']
    const g = groupBookmarks(s, 'poe1')
    expect(g.headers).toBe(false)
    expect(g.groups).toHaveLength(1)
    expect(g.groups[0].collapsed).toBe(false)
    expect(g.groups[0].items.map(x => x.index)).toEqual(quickBookmarks(s.bookmarks, 'poe1').map(x => x.index))
    expect(groupBookmarks(s, 'poe1', { skipEmpty: true }).headers).toBe(false)
  })
  it('資料夾依順序、未分類最後;管理頁列空資料夾,書籤列 / 快速面板略過;略過後只剩未分類 = 沒標題', () => {
    const s = sample()
    addFolder(s, 'poe1', 'A'); addFolder(s, 'poe1', '空'); addFolder(s, 'poe1', 'B')
    moveBookmark(s, s.bookmarks.findIndex(b => b.name === 'p1b'), 'B')
    setFolderCollapsed(s, 'poe1', 'B', true)
    const m = groupBookmarks(s, 'poe1')
    expect(m.headers).toBe(true)
    expect(m.groups.map(g => [g.folder, g.items.length, g.collapsed])).toEqual([['A', 0, false], ['空', 0, false], ['B', 1, true], ['', 2, false]])
    const q = groupBookmarks(s, 'poe1', { skipEmpty: true })
    expect(q.groups.map(g => g.folder)).toEqual(['B', ''])
    // 全部書籤都在未分類(資料夾都空)→ 書籤列沒有標題
    deleteFolder(s, 'poe1', 'B')
    expect(groupBookmarks(s, 'poe1', { skipEmpty: true }).headers).toBe(false)
    expect(groupBookmarks(s, 'poe1').headers).toBe(true)
    // 未分類空時:管理頁仍列(可拖回),書籤列不列
    for (const b of s.bookmarks) if (b.game === 'poe1') b.folder = 'A'
    expect(groupBookmarks(s, 'poe1').groups.at(-1)).toMatchObject({ folder: '', items: [] })
    expect(groupBookmarks(s, 'poe1', { skipEmpty: true }).groups.map(g => g.folder)).toEqual(['A'])
    expect(folderCounts(s, 'poe1').get('A')).toBe(3)
  })
})

describe('另一代書籤編輯不影響目前遊戲清單', () => {
  it('隨機操作 poe2(資料夾 CRUD / 排序 / 移動 / 熱鍵 / 改名 / 收合)→ poe1 清單、資料夾、格子位置、熱鍵清單逐項相同', () => {
    const rng = new Rng(36)
    for (let round = 0; round < 30; round++) {
      const s = defaultRegexState()
      for (let i = 0; i < 14; i++) s.bookmarks.push(bm({ name: `b${i}`, game: rng.below(2) ? 'poe1' : 'poe2', ...(rng.below(3) ? {} : { hotkey: `F${i + 1}` }) }))
      addFolder(s, 'poe1', '一'); addFolder(s, 'poe1', '二')
      s.bookmarks.forEach((b, i) => { if (b.game === 'poe1' && rng.below(2)) moveBookmark(s, i, rng.below(2) ? '一' : '二') })
      const snap = () => JSON.stringify({
        list: quickBookmarks(s.bookmarks, 'poe1').map(x => [x.index, x.b]),
        folders: s.folders.poe1,
        uncat: s.uncatCollapsed.includes('poe1'),
        hk: bookmarkHotkeys(s.bookmarks).filter(h => h.game === 'poe1')
      })
      const before = snap()
      const p2 = () => s.bookmarks.map((b, i) => (b.game === 'poe2' ? i : -1)).filter(i => i >= 0)
      for (let step = 0; step < 40; step++) {
        const list = p2()
        const pick = list.length ? list[rng.below(list.length)] : -1
        const folders = s.folders.poe2.map(f => f.name)
        const fname = folders.length ? folders[rng.below(folders.length)] : ''
        switch (rng.below(9)) {
          case 0: addFolder(s, 'poe2', `f${rng.below(5)}`); break
          case 1: if (fname) renameFolder(s, 'poe2', fname, `r${rng.below(5)}`); break
          case 2: if (fname) deleteFolder(s, 'poe2', fname); break
          case 3: if (fname) moveFolderBy(s, 'poe2', fname, rng.below(2) ? 1 : -1); break
          case 4: if (pick >= 0) moveBookmark(s, pick, rng.below(2) ? fname : ''); break
          case 5: if (pick >= 0 && list.length > 1) moveBookmark(s, pick, '', list[rng.below(list.length)]); break
          case 6: if (pick >= 0) moveBookmarkBy(s, pick, rng.below(2) ? 1 : -1); break
          case 7: if (pick >= 0) { s.bookmarks[pick].hotkey = `Ctrl + ${rng.below(9)}`; s.bookmarks[pick].name += '!' } break
          case 8: setFolderCollapsed(s, 'poe2', rng.below(2) ? fname : '', rng.below(2) === 1); break
        }
        assertSorted(s)
      }
      expect(snap(), `round ${round}`).toBe(before)
      // 往返後一樣
      const back = parseRegexState(serializeRegexState(s)).state
      expect(back.bookmarks).toEqual(s.bookmarks)
      expect(back.folders).toEqual(s.folders)
    }
  })
})

describe('隨機操作:不變式', () => {
  it('2000 步:書籤不增不減、順序不變式成立、normalize 冪等、往返相同', () => {
    const rng = new Rng(3601)
    const s = defaultRegexState()
    for (let i = 0; i < 20; i++) s.bookmarks.push(bm({ name: `b${i}`, game: (['poe1', 'poe2', ''] as const)[rng.below(3)] }))
    const ids = s.bookmarks.map(b => b.name).sort()
    for (let step = 0; step < 2000; step++) {
      const g: RegexGame = rng.below(2) ? 'poe1' : 'poe2'
      const folders = s.folders[g].map(f => f.name)
      const fname = folders.length ? folders[rng.below(folders.length)] : ''
      const idx = rng.below(s.bookmarks.length)
      switch (rng.below(8)) {
        case 0: addFolder(s, g, `f${rng.below(6)}`); break
        case 1: if (fname) renameFolder(s, g, fname, `f${rng.below(6)}`); break
        case 2: if (fname && rng.below(3) === 0) deleteFolder(s, g, fname); break
        case 3: if (fname) moveFolderTo(s, g, fname, rng.below(6)); break
        case 4: moveBookmark(s, idx, rng.below(2) ? fname : ''); break
        case 5: moveBookmark(s, idx, '', rng.below(s.bookmarks.length)); break
        case 6: moveBookmarkBy(s, idx, rng.below(2) ? 1 : -1); break
        case 7: setFolderCollapsed(s, g, fname, rng.below(2) === 1); break
      }
      assertSorted(s)
    }
    expect(s.bookmarks.map(b => b.name).sort()).toEqual(ids)
    const snap = JSON.stringify(s)
    expect(normalizeFolders(s)).toBe(false)
    expect(sortBookmarks(s, 'poe1') || sortBookmarks(s, 'poe2')).toBe(false)
    expect(JSON.stringify(s)).toBe(snap)
    const back = parseRegexState(serializeRegexState(s)).state
    expect(back.bookmarks).toEqual(s.bookmarks)
    expect(back.folders).toEqual(s.folders)
  })
})
