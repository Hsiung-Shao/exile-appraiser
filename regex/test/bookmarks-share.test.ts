// 第 40 步:書籤包(bookmarks-share.ts)—— 往返、正規 JSON(PobTools 對拍)、hotkey 剔除、損壞輸入、上限、
// 合併(資料夾併入 / 新建與順序、同名改名 (2)(3)、不同資料夾同名不改、另一遊戲不受影響、其他狀態原物件不動)、找不到計數。
import { describe, expect, it } from 'vitest'
import {
  bookmarkMissed, canonicalBookmarkPackJson, decodeBookmarks, encodeBookmarks, mergeBookmarks, normalizeBookmarkPack, type BookmarkPack
} from '../src/bookmarks-share'
import { loadAllPagesFor } from '../src/node'
import { SHARE_MAX_CODE_CHARS, SHARE_MAX_JSON_BYTES, base64url, gzipBase64url, encodeShare } from '../src/share'
import { defaultRegexState, parseBookmark, type RegexBookmark, type RegexUiState } from '../src/state'

const bm = (o: Partial<RegexBookmark>): RegexBookmark => ({ name: 'n', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['k'], alt: ['甲'], ...o })
const pack = (bookmarks: RegexBookmark[], folders: BookmarkPack['folders'] = { poe1: [], poe2: [] }): BookmarkPack =>
  ({ kind: 'regex-bookmarks', v: 1, folders, bookmarks })

describe('編碼', () => {
  it('往返;正規 JSON 鍵順序固定;hotkey 不寫出;選填欄位空的不寫', async () => {
    const p = pack([
      bm({ name: '地圖', folder: '刷圖', hotkey: 'Ctrl + 1', num: ['tier'], numeric: { tier: { min: 16 } } }),
      bm({ name: '換界石', game: 'poe2', page: 'waystone_mods', mode: 'all', lang: 'en', keys: ['a', 'b'], alt: ['甲', '乙'] })
    ], { poe1: [{ name: '刷圖', collapsed: true }], poe2: [] })
    const json = canonicalBookmarkPackJson(p)
    expect(json).toBe(
      '{"kind":"regex-bookmarks","v":1,"folders":{"poe1":[{"name":"刷圖","collapsed":true}],"poe2":[]},"bookmarks":[' +
      '{"name":"地圖","page":"map_mods","game":"poe1","mode":"any","lang":"zh","keys":["k"],"alt":["甲"],"numeric":{"tier":{"min":16}},"num":["tier"],"folder":"刷圖"},' +
      '{"name":"換界石","page":"waystone_mods","game":"poe2","mode":"all","lang":"en","keys":["a","b"],"alt":["甲","乙"]}]}'
    )
    expect(json).not.toContain('hotkey')
    const d = await decodeBookmarks(await encodeBookmarks(p))
    expect(d.warnings).toEqual([])
    expect(canonicalBookmarkPackJson(d.pack)).toBe(json)
    expect(d.pack.bookmarks[0].hotkey).toBeUndefined()
  })
  it('解碼時 hotkey 也丟掉(PobTools 若帶了)', () => {
    const r = normalizeBookmarkPack({ kind: 'regex-bookmarks', v: 1, bookmarks: [{ ...bm({}), hotkey: 'F5' }] })
    expect(r.pack.bookmarks[0].hotkey).toBeUndefined()
    expect(r.warnings).toEqual([])
  })
  it('分享碼輸出在抽出共用 gzip 後不變(同一條路徑)', async () => {
    const s = { v: 2 as const, game: 'poe1' as const, mode: 'any' as const, pages: { map_mods: ['x'] }, sections: {}, numeric: {}, custom: [], excludes: [] }
    expect(await encodeShare(s)).toBe(await gzipBase64url(JSON.stringify(s)))
  })
})

describe('損壞輸入', () => {
  it('kind / v 不符、不是物件 → 丟例外', () => {
    expect(() => normalizeBookmarkPack(null)).toThrow('不是物件')
    expect(() => normalizeBookmarkPack({ kind: 'x', v: 1 })).toThrow('不是書籤包')
    expect(() => normalizeBookmarkPack({ kind: 'regex-bookmarks', v: 2 })).toThrow('版本不符')
  })
  it('壞書籤 / 資料夾略過並記 warning;沒遊戲的略過;書籤的資料夾沒列在 folders 就補', () => {
    const r = normalizeBookmarkPack({
      kind: 'regex-bookmarks', v: 1, extra: 1,
      folders: { poe1: [{ name: '  A  ' }, { name: '' }, 3, { name: 'A' }], poe2: 'x' },
      bookmarks: [bm({ name: 'ok' }), { name: 5 }, bm({ name: '' }), bm({ name: 'g', game: '' }), bm({ name: 'f', folder: 'B' }), 'x']
    })
    expect(r.pack.folders.poe1.map(f => f.name)).toEqual(['A', 'B'])
    expect(r.pack.folders.poe2).toEqual([])
    expect(r.pack.bookmarks.map(b => b.name)).toEqual(['ok', 'f'])
    expect(r.warnings.length).toBeGreaterThanOrEqual(6)
    expect(r.warnings.join('\n')).toContain('未知欄位「extra」')
  })
  it('解碼:不是 base64url / 不是 gzip / 不是 JSON / 超長 / 壓縮炸彈', async () => {
    await expect(decodeBookmarks('')).rejects.toThrow('書籤包是空的')
    await expect(decodeBookmarks('!!!')).rejects.toThrow('書籤包無法解壓縮')
    await expect(decodeBookmarks(base64url(new TextEncoder().encode('abc')))).rejects.toThrow('書籤包無法解壓縮')
    await expect(decodeBookmarks(await gzipBase64url('{x'))).rejects.toThrow('書籤包內容不是 JSON')
    await expect(decodeBookmarks('A'.repeat(SHARE_MAX_CODE_CHARS + 1))).rejects.toThrow('書籤包太長')
    const zeros = new Uint8Array(SHARE_MAX_JSON_BYTES + 1024)
    const gz = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    await expect(decodeBookmarks(base64url(gz))).rejects.toThrow('解壓後超過')
  })
  it('parseBookmark 與 regex_state.json 讀檔同一套規則', () => {
    expect(parseBookmark(bm({ hotkey: 'F1' }))?.hotkey).toBe('F1')
    expect(parseBookmark(bm({ keys: [] }))).toBeNull()
    expect(parseBookmark(bm({ keys: [], num: ['tier'] }))?.num).toEqual(['tier'])
    expect(() => parseBookmark({ ...bm({}), name: 1 })).toThrow()
  })
})

describe('mergeBookmarks', () => {
  const base = (): RegexUiState => ({
    ...defaultRegexState(),
    bookmarks: [bm({ name: '地圖', folder: '刷圖', hotkey: 'Ctrl + 1' }), bm({ name: '地圖' }), bm({ name: '換界石', game: 'poe2', page: 'waystone_mods' })],
    folders: { poe1: [{ name: '刷圖', collapsed: true }], poe2: [] },
    current: [{ page: 'map_mods', keys: ['k'], alt: [] }],
    numeric: { map_mods: { tier: { min: 16 } } },
    custom: ['c'],
    excludes: ['e']
  })
  it('同遊戲 + 同資料夾 + 同名 → (2)(3);不同資料夾同名不改;既有的不動', () => {
    const s = base()
    const r = mergeBookmarks(s, pack([
      bm({ name: '地圖', folder: '刷圖' }), bm({ name: '地圖', folder: '刷圖' }), bm({ name: '地圖', folder: '新' }), bm({ name: '地圖' })
    ]))
    expect(r.added.map(a => [a.folder, a.name])).toEqual([['刷圖', '地圖 (2)'], ['刷圖', '地圖 (3)'], ['新', '地圖'], ['', '地圖 (2)']])
    expect(r.renamed.map(a => a.name)).toEqual(['地圖 (2)', '地圖 (3)', '地圖 (2)'])
    expect(r.state.bookmarks.filter(b => b.game === 'poe1').map(b => `${b.folder ?? ''}/${b.name}`))
      .toEqual(['刷圖/地圖', '刷圖/地圖 (2)', '刷圖/地圖 (3)', '新/地圖', '/地圖', '/地圖 (2)'])
    // 既有書籤的 hotkey 不動;新書籤沒有 hotkey
    expect(r.state.bookmarks.find(b => b.name === '地圖' && b.folder === '刷圖')?.hotkey).toBe('Ctrl + 1')
    expect(r.state.bookmarks.filter(b => !b.hotkey).length).toBe(6)
  })
  it('資料夾:已有就併入(收合狀態不動)、沒有依包內順序加在最後;另一遊戲不受影響', () => {
    const r = mergeBookmarks(base(), pack([bm({ name: 'x', folder: 'B' }), bm({ name: 'y', game: 'poe2', page: 'waystone_mods', folder: 'C' })],
      { poe1: [{ name: '刷圖', collapsed: false }, { name: 'A', collapsed: true }, { name: 'B', collapsed: false }], poe2: [{ name: 'C', collapsed: false }] }))
    expect(r.state.folders.poe1).toEqual([{ name: '刷圖', collapsed: true }, { name: 'A', collapsed: true }, { name: 'B', collapsed: false }])
    expect(r.state.folders.poe2).toEqual([{ name: 'C', collapsed: false }])
    expect(r.foldersCreated).toEqual([{ game: 'poe1', name: 'A' }, { game: 'poe1', name: 'B' }, { game: 'poe2', name: 'C' }])
    expect(r.state.bookmarks.filter(b => b.game === 'poe2').map(b => b.name)).toEqual(['y', '換界石'])
  })
  it('不改輸入;勾選 / 數值 / 自訂 / 排除 / outScope 是原物件', () => {
    const s = base()
    const snapshot = JSON.stringify(s)
    const r = mergeBookmarks(s, pack([bm({ name: 'z', folder: '新' })]))
    expect(JSON.stringify(s)).toBe(snapshot)
    expect(r.state.current).toBe(s.current)
    expect(r.state.numeric).toBe(s.numeric)
    expect(r.state.custom).toBe(s.custom)
    expect(r.state.excludes).toBe(s.excludes)
    expect(r.state.outScope).toBe(s.outScope)
    expect(r.state.bookmarks).not.toBe(s.bookmarks)
  })
  it('空包 = 什麼都沒加', () => {
    const r = mergeBookmarks(base(), pack([]))
    expect(r.added).toEqual([])
    expect(r.state.bookmarks.length).toBe(3)
  })
})

describe('bookmarkMissed', () => {
  const pages = loadAllPagesFor('poe2')
  it('還原得到 = 0;找不到的鍵計數;頁不存在 = 全部鍵數(物品詞綴數值頁鍵不互通的情況)', () => {
    const ws = pages.find(p => p.id === 'waystone_mods')!
    expect(bookmarkMissed(pages, bm({ game: 'poe2', page: 'waystone_mods', keys: [ws.entries[0].en[0]], alt: [] }))).toBe(0)
    expect(bookmarkMissed(pages, bm({ game: 'poe2', page: 'waystone_mods', keys: [ws.entries[0].en[0], 'nope'], alt: [] }))).toBe(1)
    expect(bookmarkMissed(pages, bm({ game: 'poe2', page: 'item_mod_values_poe2', keys: ['ggpk_stat_1', 'ggpk_stat_2'], alt: [] }))).toBe(2)
    expect(bookmarkMissed(pages, bm({ game: 'poe2', page: 'no_such_page', keys: ['a'], num: ['b'] }))).toBe(2)
  })
})

describe('docs/regex-share-cli.md 的範例(給 PobTools 對拍)', () => {
  it('每組範例碼解碼後 = 文件列的正規 JSON,且沒有警告', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const doc = fs.readFileSync(path.resolve(__dirname, '../../docs/regex-share-cli.md'), 'utf8')
    const sec = doc.slice(doc.indexOf('### 範例'), doc.indexOf('## 呼叫端怎麼找到'))
    const jsons = [...sec.matchAll(/```json\n(.+)\n```/g)].map(m => m[1])
    const codes = [...sec.matchAll(/產生的碼[^\n]*\n\n```\n([A-Za-z0-9_-]+)\n```/g)].map(m => m[1])
    expect(jsons.length).toBe(3)
    expect(codes.length).toBe(3)
    for (let i = 0; i < codes.length; i++) {
      const d = await decodeBookmarks(codes[i])
      expect(d.warnings).toEqual([])
      expect(canonicalBookmarkPackJson(d.pack)).toBe(jsons[i])
      expect(await encodeBookmarks(d.pack)).toBe(codes[i])
    }
  })
})
