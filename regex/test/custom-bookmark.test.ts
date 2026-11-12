// 自訂書籤(保留頁 '@custom'):直接存一段搜尋字串,不綁清單頁。
import { describe, expect, it } from 'vitest'
import {
  CUSTOM_BOOKMARK_LIMIT, CUSTOM_BOOKMARK_PAGE, bookmarkHotkeys, bookmarkMissed, bookmarkQuery, customBookmark, defaultRegexState,
  groupBookmarks, isCustomBookmark, mergeBookmarks, moveBookmark, moveBookmarkBy, normalizeBookmarkPack, parseRegexState,
  quickBookmarks, regexStateSchemaOf, serializeRegexState, type RegexBookmark
} from '../src/index'

const custom = (name = '自訂', text = 'abc'): RegexBookmark => {
  const b = customBookmark('poe1', name, text)
  if (!b) throw new Error('測試前提:customBookmark 應建得出來')
  return b
}
const plain = (o: Partial<RegexBookmark> = {}): RegexBookmark => ({ name: '一般', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['x'], alt: [], ...o })

describe('customBookmark 建立與清理', () => {
  it('T1 建立自訂書籤帶保留頁與字串', () => {
    const b = customBookmark('poe1', '名', 'abc')!
    expect(CUSTOM_BOOKMARK_PAGE).toBe('@custom')
    expect(CUSTOM_BOOKMARK_LIMIT).toBe(250)
    expect(b.page).toBe('@custom')
    expect(b.keys).toEqual(['abc'])
    expect(b.alt).toEqual([])
    expect(b.game).toBe('poe1')
    expect(b.mode).toBe('any')
    expect(b.lang).toBe('zh')
    expect(isCustomBookmark(b)).toBe(true)
  })

  it('T2 字串去頭尾空白、換行轉空白', () => {
    const b = customBookmark('poe2', ' 名 ', ' a\r\nb\tc ')!
    expect(b.keys[0]).toBe('a b c')
    expect(b.name).toBe('名')
  })

  it('T3 名稱或字串為空不建立', () => {
    expect(customBookmark('poe1', '', 'abc')).toBeNull()
    expect(customBookmark('poe1', '   ', 'abc')).toBeNull()
    expect(customBookmark('poe1', '名', '')).toBeNull()
    expect(customBookmark('poe1', '名', ' \r\n\t ')).toBeNull()
  })

  it('T7 一般書籤不被當成自訂', () => {
    expect(isCustomBookmark(plain())).toBe(false)
  })
})

describe('自訂書籤與既有書籤機制', () => {
  it('T4 自訂書籤字串原樣輸出且不需清單', () => {
    const text = '"地圖.*(階級 1[4-6])|!已汙染"'
    const b = custom('原樣', text)
    const q = bookmarkQuery([], b)
    expect(q).not.toBeNull()
    expect(q!.query).toBe(text)
    expect(q!.length).toBe([...text].length)
    expect(q!.limit).toBe(250)
    expect(q!.missed).toBe(0)
  })

  it('T5 存檔往返自訂書籤不變', () => {
    const s = defaultRegexState()
    s.folders.poe1 = [{ name: 'F', collapsed: false }]
    s.bookmarks = [{ ...custom('甲', '地圖|abc'), hotkey: 'Ctrl + Shift + 1', folder: 'F' }]
    const text = serializeRegexState(s)
    const r = parseRegexState(text)
    expect(r.ok).toBe(true)
    expect(r.state.bookmarks).toEqual(s.bookmarks)
    expect(regexStateSchemaOf(text)).toBe(5)
  })

  it('T6 自訂書籤照樣列入熱鍵與快捷清單', () => {
    const list = [plain(), { ...custom('熱鍵自訂'), hotkey: 'Ctrl + Shift + 2' }]
    expect(bookmarkHotkeys(list)).toEqual([{ index: 1, name: '熱鍵自訂', game: 'poe1', hotkey: 'Ctrl + Shift + 2' }])
    const q = quickBookmarks(list, 'poe1')
    expect(q.map(x => x.index)).toEqual([0, 1])
    expect(q[1].b.page).toBe('@custom')
  })

  it('T9 資料夾與排序對自訂書籤照常運作', () => {
    const s = defaultRegexState()
    s.folders.poe1 = [{ name: 'F', collapsed: false }]
    const normal = plain()
    const cb = custom('自訂', 'a|b')
    s.bookmarks = [normal, cb]
    moveBookmark(s, s.bookmarks.indexOf(normal), 'F')
    moveBookmark(s, s.bookmarks.indexOf(cb), 'F')
    const inF = () => groupBookmarks(s, 'poe1').groups.find(g => g.folder === 'F')!.items
    expect(inF().map(x => x.b)).toContain(cb)
    expect(inF()).toHaveLength(2)
    // 在資料夾內換位置:自訂書籤的位置要變
    const before = inF().findIndex(x => x.b === cb)
    moveBookmarkBy(s, inF()[before].index, before === 0 ? 1 : -1)
    expect(inF().findIndex(x => x.b === cb)).not.toBe(before)
    // 內容不被搬動 / 排序弄壞
    expect(cb.page).toBe('@custom')
    expect(cb.keys).toEqual(['a|b'])
    expect(cb.folder).toBe('F')
  })

  it('T10 書籤包裡的自訂書籤加入後算 0 項找不到', () => {
    const cb = custom('包內', '包內字串')
    const raw = { kind: 'regex-bookmarks', v: 1, folders: { poe1: [], poe2: [] }, bookmarks: [cb] }
    const { pack } = normalizeBookmarkPack(raw)
    const r = mergeBookmarks(defaultRegexState(), pack)
    expect(r.added).toHaveLength(1)
    expect(r.state.bookmarks).toHaveLength(1)
    expect(r.state.bookmarks[0].keys[0]).toBe('包內字串')
    expect(bookmarkMissed([], r.state.bookmarks[0])).toBe(0)
    expect(bookmarkMissed([], cb)).toBe(0)
  })
})
