// 一鍵從 PobTools 送正則分享碼 / 書籤包:renderer 確認流程(renderer/src/web/regex/incoming-share.ts)與接線。
// 流程:參數錯誤 / 解碼失敗 / 清單沒載 → 錯誤;解碼成功 → 確認;「套用 / 加入」才寫入,「取消」什麼都不改;新請求取代舊請求(含解碼中途)。
// 第 40 步書籤包:摘要依遊戲 → 資料夾分組、新資料夾 / 改名 / 找不到;加入走 store addBookmarksFromPack,書籤卡片顯示剛加入的書籤。
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mergeBookmarks, defaultRegexState, type BookmarkPack, type RegexBookmark, type ResolvedState, type ShareState } from '@exile-appraiser/regex'
import type { RegexShareRequest } from '@ipc/types'
import { createIncomingShare, summarizeBookmarks, summarizeShare, type CurrentCombo, type IncomingDeps } from '../src/web/regex/incoming-share'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const STATE: ShareState = { v: 2, game: 'poe2', mode: 'any', pages: { waystone_mods: ['a', 'b'] }, sections: {}, numeric: {}, custom: ['x'], excludes: [] }
const RESOLVED: ResolvedState = { picks: { waystone_mods: [0, 3], waystone_numeric: [], tablet_mods: [] }, values: {}, missed: 2, unknownPages: ['nope'] }
const CUR: CurrentCombo = { pages: [{ id: 'tablet_mods', n: 4 }, { id: 'relic_mods', n: 0 }], custom: 1, excludes: 2, mode: 'all' }
const req = (id: number, o: Partial<RegexShareRequest> = {}): RegexShareRequest => ({ id, source: 'pobtools', kind: 'share', via: 'arg', code: 'abc', ...o })
const bm = (o: Partial<RegexBookmark>): RegexBookmark => ({ name: 'n', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: ['k'], alt: [], ...o })
const PACK: BookmarkPack = {
  kind: 'regex-bookmarks', v: 1, folders: { poe1: [{ name: '刷圖', collapsed: false }], poe2: [] },
  bookmarks: [bm({ name: '地圖', folder: '刷圖' }), bm({ name: '詞綴', page: 'item_mod_values' }), bm({ name: '換界石', game: 'poe2', page: 'waystone_mods' })]
}
const EXISTING = { ...defaultRegexState(), bookmarks: [bm({ name: '地圖', folder: '刷圖' })], folders: { poe1: [{ name: '刷圖', collapsed: true }], poe2: [] } }

function deps (o: Partial<IncomingDeps> = {}): IncomingDeps & { apply: ReturnType<typeof vi.fn>, applyBookmarks: ReturnType<typeof vi.fn> } {
  return {
    decode: async () => ({ state: STATE, warnings: [] }),
    prepare: async () => ({ pages: [], resolved: RESOLVED }),
    current: () => CUR,
    apply: vi.fn(),
    decodeBookmarks: async () => ({ pack: PACK, warnings: [] }),
    prepareBookmarks: async (p) => ({ merge: mergeBookmarks(EXISTING, p), missed: [0, 2, 0] }),
    applyBookmarks: vi.fn(),
    log: () => {},
    ...o
  } as IncomingDeps & { apply: ReturnType<typeof vi.fn>, applyBookmarks: ReturnType<typeof vi.fn> }
}

describe('summarizeShare', () => {
  it('會套用的清單(只列有勾選的)、會被覆蓋的目前清單、自訂 / 排除 / 模式、找不到幾項', () => {
    expect(summarizeShare(STATE, RESOLVED, CUR, 1)).toEqual({
      game: 'poe2', mode: 'any',
      incoming: [{ id: 'waystone_mods', n: 2 }],
      replaced: [{ id: 'tablet_mods', n: 4 }],
      custom: 1, excludes: 0,
      current: { custom: 1, excludes: 2, mode: 'all' },
      missed: 2, unknownPages: ['nope'], warnings: 1
    })
  })
})

describe('summarizeBookmarks', () => {
  it('依遊戲 → 資料夾分組(包內順序);新資料夾、改名、找不到', () => {
    const merge = mergeBookmarks(EXISTING, { ...PACK, bookmarks: [...PACK.bookmarks, bm({ name: 'x', folder: '新' })] })
    const s = summarizeBookmarks(PACK, merge, [0, 2, 0, 0], 3)
    expect(s.total).toBe(4)
    expect(s.renamed).toBe(1)
    expect(s.withMissed).toBe(1)
    expect(s.warnings).toBe(3)
    expect(s.games.map(g => [g.game, g.folders.map(f => [f.folder, f.isNew, f.items.map(i => `${i.originalName}→${i.name}:${i.missed}`)])])).toEqual([
      ['poe1', [['刷圖', false, ['地圖→地圖 (2):0']], ['', false, ['詞綴→詞綴:2']], ['新', true, ['x→x:0']]]],
      ['poe2', [['', false, ['換界石→換界石:0']]]]
    ])
  })
})

describe('createIncomingShare:分享碼', () => {
  it('確認後才套用;套用後對話框關閉', async () => {
    const d = deps()
    const s = createIncomingShare(d)
    await s.receive(req(1))
    expect(s.view.value?.phase).toBe('confirm')
    expect(d.apply).not.toHaveBeenCalled()
    expect(s.confirm()).toBe(true)
    expect(d.apply).toHaveBeenCalledWith(STATE)
    expect(s.view.value).toBeNull()
    expect(s.confirm()).toBe(false)
  })
  it('取消:什麼都不套用', async () => {
    const d = deps()
    const s = createIncomingShare(d)
    await s.receive(req(1))
    s.cancel()
    expect(s.view.value).toBeNull()
    expect(d.apply).not.toHaveBeenCalled()
  })
  it('參數錯誤 → 錯誤畫面,不解碼、不能套用', async () => {
    const decode = vi.fn()
    const d = deps({ decode })
    const s = createIncomingShare(d)
    await s.receive(req(1, { code: undefined, error: { reason: 'charset', detail: 'U+0020' } }))
    expect(s.view.value).toEqual({ phase: 'error', id: 1, kind: 'share', reason: 'charset', detail: 'U+0020' })
    expect(decode).not.toHaveBeenCalled()
    expect(s.confirm()).toBe(false)
    expect(d.apply).not.toHaveBeenCalled()
  })
  it('解碼失敗 / 清單載入失敗 → 錯誤', async () => {
    const s1 = createIncomingShare(deps({ decode: async () => { throw new Error('壞碼') } }))
    await s1.receive(req(1))
    expect(s1.view.value).toMatchObject({ phase: 'error', reason: 'decode', detail: '壞碼' })
    const s2 = createIncomingShare(deps({ prepare: async () => null }))
    await s2.receive(req(2))
    expect(s2.view.value).toMatchObject({ phase: 'error', reason: 'not-loaded', detail: 'poe2' })
  })
  it('新請求取代解碼中的舊請求;取消後到的舊結果也丟掉', async () => {
    let release!: () => void
    const slow = new Promise<void>(r => { release = r })
    const d = deps({ decode: async (code) => { if (code === 'slow') await slow; return { state: { ...STATE, custom: [code] }, warnings: [] } } })
    const s = createIncomingShare(d)
    const p1 = s.receive(req(1, { code: 'slow' }))
    await s.receive(req(2, { code: 'fast' }))
    expect(s.view.value).toMatchObject({ phase: 'confirm', id: 2 })
    release(); await p1
    expect(s.view.value).toMatchObject({ phase: 'confirm', id: 2 })
    let release2!: () => void
    const slow2 = new Promise<void>(r => { release2 = r })
    const s2 = createIncomingShare(deps({ decode: async () => { await slow2; return { state: STATE, warnings: [] } } }))
    const p = s2.receive(req(3))
    expect(s2.view.value?.phase).toBe('loading')
    s2.cancel()
    release2(); await p
    expect(s2.view.value).toBeNull()
  })
})

describe('createIncomingShare:書籤包', () => {
  it('確認後才加入(不走分享碼的 apply);取消不改', async () => {
    const d = deps()
    const s = createIncomingShare(d)
    await s.receive(req(1, { kind: 'bookmarks' }))
    expect(s.view.value).toMatchObject({ phase: 'confirm-bookmarks', kind: 'bookmarks', summary: { total: 3, renamed: 1, withMissed: 1 } })
    expect(d.applyBookmarks).not.toHaveBeenCalled()
    expect(s.confirm()).toBe(true)
    expect(d.applyBookmarks).toHaveBeenCalledWith(PACK)
    expect(d.apply).not.toHaveBeenCalled()
    const d2 = deps()
    const s2 = createIncomingShare(d2)
    await s2.receive(req(2, { kind: 'bookmarks' }))
    s2.cancel()
    expect(d2.applyBookmarks).not.toHaveBeenCalled()
  })
  it('書籤包解碼失敗 / 清單沒載 / 參數錯 → 錯誤(帶 kind)', async () => {
    const s1 = createIncomingShare(deps({ decodeBookmarks: async () => { throw new Error('不是書籤包') } }))
    await s1.receive(req(1, { kind: 'bookmarks' }))
    expect(s1.view.value).toMatchObject({ phase: 'error', kind: 'bookmarks', reason: 'decode', detail: '不是書籤包' })
    const s2 = createIncomingShare(deps({ prepareBookmarks: async () => null }))
    await s2.receive(req(2, { kind: 'bookmarks' }))
    expect(s2.view.value).toMatchObject({ phase: 'error', kind: 'bookmarks', reason: 'not-loaded', detail: 'poe1, poe2' })
    const s3 = createIncomingShare(deps())
    await s3.receive(req(3, { kind: 'bookmarks', code: undefined, error: { reason: 'both-flags', detail: 'x' } }))
    expect(s3.view.value).toMatchObject({ phase: 'error', kind: 'bookmarks', reason: 'both-flags' })
  })
})

describe('字串與接線', () => {
  const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.regex
  const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz.regex
  const panel = read('renderer/src/web/regex/RegexPanel.vue')
  it('對話框用到的 incoming_* 鍵兩語都有、參數一致、不含 vue-i18n 特殊字元;每種錯誤原因都有字串', () => {
    const used = new Set([...panel.matchAll(/'ppz\.regex\.(incoming_\w+)'/g)].map(m => m[1]))
    expect(used.size).toBeGreaterThan(15)
    const reasons = ['missing-value', 'both-flags', 'empty', 'too-long', 'charset', 'file-read', 'file-too-large', 'decode', 'not-loaded']
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    for (const k of [...used, ...reasons.map(r => `incoming_err_${r}`), 'notice_bm_added']) {
      expect(typeof zh[k], `zh ${k}`).toBe('string')
      expect(typeof en[k], `en ${k}`).toBe('string')
      expect(params(en[k]), k).toEqual(params(zh[k]))
      expect(zh[k] + en[k], k).not.toMatch(/[|@$]/)
    }
  })
  it('RegexPanel:確認對話框 Teleport 綁 fs-own;套用 / 取消接到 incomingShare;書籤包有自己的標題與「加入」', () => {
    const i = panel.indexOf('data-regex="incoming-dialog"')
    expect(i).toBeGreaterThan(0)
    const open = panel.lastIndexOf('<div v-if="incoming"', i)
    expect(panel.slice(open, i)).toMatch(/:class="fsClass" :style="fsStyle"/)
    expect(panel).toContain('confirmIncoming () { incomingShare.confirm() }')
    expect(panel).toContain('cancelIncoming () { incomingShare.cancel() }')
    expect(panel).toContain("incoming.kind === 'bookmarks' ? 'ppz.regex.incoming_bm_title' : 'ppz.regex.incoming_title'")
    expect(panel).toMatch(/v-else-if="incoming\.phase === 'confirm-bookmarks'"[^>]*>\{\{ t\('ppz\.regex\.incoming_bm_add'\) \}\}/)
  })
  it('App.vue:先掛 onRegexShare 再 regexShareTake;收到就開設定 › 正則', () => {
    const app = read('renderer/src/web/App.vue')
    const on = app.indexOf('unsubscribers.push(Host.onRegexShare(onRegexShare))')
    expect(on).toBeGreaterThan(0)
    expect(app.indexOf('Host.regexShareTake()')).toBeGreaterThan(on)
    expect(app).toMatch(/openSettingsTo\('regex', `PobTools 正則分享碼 #\$\{req\.id\}`\)/)
  })
  it('接線:書籤包走 store prepareBookmarkPack / addBookmarksFromPack;加入後書籤卡片監看 bookmarkReveal', () => {
    const inc = read('renderer/src/web/regex/incoming.ts')
    expect(inc).toContain('prepareBookmarks: prepareBookmarkPack')
    expect(inc).toContain('applyBookmarks: addBookmarksFromPack')
    const store = read('renderer/src/web/regex/store.ts')
    const fn = store.slice(store.indexOf('export function addBookmarksFromPack'), store.indexOf('export function addBookmarksFromPack') + 1000)
    expect(fn).toContain('mergeBookmarks(ui, pack)')
    expect(fn).toContain('scheduleSave()')
    expect(fn).not.toMatch(/picks\[|ui\.current|ui\.numeric|syncCurrent/)
    const bmv = read('renderer/src/web/regex/RegexBookmarks.vue')
    expect(bmv).toContain('watch(bookmarkReveal, (r) => {')
    expect(bmv).toContain('revealed: isRevealed(x.b)')
  })
  it('預覽分頁也拿得到(main 依來源分流);分享碼套用走與貼上分享碼相同的 applyCombo', () => {
    const ipc = read('renderer/src/web/background/IPC.ts')
    const fn = ipc.slice(ipc.indexOf('async regexShareTake'), ipc.indexOf('async regexShareTake') + 200)
    expect(fn).not.toContain('isPreview')
    const store = read('renderer/src/web/regex/store.ts')
    expect(store).toContain("applyCombo(s, 'share', gameLabel(s.game))")
  })
})
