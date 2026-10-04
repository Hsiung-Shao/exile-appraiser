// 第 36 步(2026-10-04):正則書籤資料夾(只有一層)。
//
// - 書籤 `folder`(空字串 = 未分類);資料夾清單(名稱、順序、收合狀態)依遊戲各一組存在 `RegexUiState.folders[game]`,
//   未分類的收合狀態在 `uncatCollapsed`(遊戲清單)。管理頁、設定視窗旁的書籤列、快速面板共用同一份收合狀態。
// - **順序不變式**:`ui.bookmarks` 裡同一遊戲的書籤永遠依「資料夾順序 → 未分類」排好(`sortBookmarks`,穩定排序,
//   只在該遊戲原本佔的格子裡重排,另一遊戲的書籤位置不動)。所以「畫面上的順序」=「陣列順序」= main 註冊書籤熱鍵的先後
//   (先到先得)= 熱鍵總表的列順序,不必另存一份排序。
// - 書籤以 `ui.bookmarks` 的索引指定;重排後索引會變,呼叫端以回傳的新索引為準(熱鍵觸發另有「索引 + 名字」後援,`findBookmark`)。
// - 全部是就地修改 `RegexUiState` 的純函式(不碰 Vue / IO);renderer store 包一層再 `scheduleSave()`。
import type { RegexGame } from './data'
import type { RegexBookmark, RegexUiState } from './state'

export interface BookmarkFolder {
  name: string
  /** 收合(管理頁 / 書籤列 / 快速面板共用) */
  collapsed: boolean
}

/** 資料夾名稱上限(碼點;超過截掉) */
export const FOLDER_NAME_MAX = 40

/** 名稱正規化:去頭尾空白、合併內部連續空白、截長 */
export function normalizeFolderName (name: string): string {
  return [...name.trim().replace(/\s+/g, ' ')].slice(0, FOLDER_NAME_MAX).join('')
}

export function folderList (s: RegexUiState, game: RegexGame): BookmarkFolder[] {
  return s.folders[game]
}

/** 資料夾在清單中的位置(未分類 / 不存在 = 清單長度 = 排在最後) */
function folderRank (s: RegexUiState, game: RegexGame, folder: string): number {
  const list = s.folders[game]
  if (!folder) return list.length
  const i = list.findIndex(f => f.name === folder)
  return i < 0 ? list.length : i
}

/**
 * 重排某遊戲的書籤:依資料夾順序、未分類最後(穩定排序,同資料夾內維持原相對順序);
 * 只在這個遊戲原本佔的格子裡換,另一遊戲 / 孤兒書籤位置不動。回傳是否有變。
 */
export function sortBookmarks (s: RegexUiState, game: RegexGame): boolean {
  const slots: number[] = []
  s.bookmarks.forEach((b, i) => { if (b.game === game) slots.push(i) })
  const items = slots.map((i, order) => ({ b: s.bookmarks[i], order, rank: folderRank(s, game, s.bookmarks[i].folder ?? '') }))
  const sorted = [...items].sort((a, b) => a.rank - b.rank || a.order - b.order)
  let changed = false
  sorted.forEach((x, k) => {
    if (s.bookmarks[slots[k]] !== x.b) { s.bookmarks[slots[k]] = x.b; changed = true }
  })
  return changed
}

/**
 * 讀檔後 / 遊戲補上後的整理:資料夾名稱正規化、去重、去空;書籤指向清單裡沒有的資料夾 → 把資料夾補到清單最後
 * (不丟資料);沒有遊戲的孤兒書籤保留 `folder` 原值(補上遊戲時再整理);兩個遊戲各自排好順序。回傳是否有變。
 */
export function normalizeFolders (s: RegexUiState): boolean {
  let changed = false
  for (const game of ['poe1', 'poe2'] as const) {
    const seen = new Set<string>()
    const list: BookmarkFolder[] = []
    for (const f of s.folders[game] ?? []) {
      const name = normalizeFolderName(f.name)
      if (!name || seen.has(name)) { changed = true; continue }
      if (name !== f.name) changed = true
      seen.add(name)
      list.push({ name, collapsed: f.collapsed === true })
    }
    for (const b of s.bookmarks) {
      if (b.game !== game) continue
      const name = normalizeFolderName(b.folder ?? '')
      if (name !== (b.folder ?? '')) {
        changed = true
        if (name) b.folder = name
        else delete b.folder
      }
      if (name && !seen.has(name)) { seen.add(name); list.push({ name, collapsed: false }); changed = true }
    }
    s.folders[game] = list
    if (sortBookmarks(s, game)) changed = true
  }
  return changed
}

export type FolderResult = 'ok' | 'empty' | 'duplicate' | 'missing'

/** 新增資料夾(加在清單最後) */
export function addFolder (s: RegexUiState, game: RegexGame, name: string): FolderResult {
  const n = normalizeFolderName(name)
  if (!n) return 'empty'
  if (s.folders[game].some(f => f.name === n)) return 'duplicate'
  s.folders[game] = [...s.folders[game], { name: n, collapsed: false }]
  return 'ok'
}

/** 改名(書籤跟著改);同名 = 'ok' 不動 */
export function renameFolder (s: RegexUiState, game: RegexGame, from: string, to: string): FolderResult {
  const n = normalizeFolderName(to)
  if (!n) return 'empty'
  const list = s.folders[game]
  const i = list.findIndex(f => f.name === from)
  if (i < 0) return 'missing'
  if (n === from) return 'ok'
  if (list.some(f => f.name === n)) return 'duplicate'
  s.folders[game] = list.map((f, k) => (k === i ? { ...f, name: n } : f))
  for (const b of s.bookmarks) if (b.game === game && b.folder === from) b.folder = n
  return 'ok'
}

/** 刪除資料夾:裡面的書籤移回未分類(書籤本身不刪);回傳移回的書籤數(-1 = 沒有這個資料夾) */
export function deleteFolder (s: RegexUiState, game: RegexGame, name: string): number {
  if (!s.folders[game].some(f => f.name === name)) return -1
  s.folders[game] = s.folders[game].filter(f => f.name !== name)
  let n = 0
  for (const b of s.bookmarks) {
    if (b.game === game && b.folder === name) { delete b.folder; n++ }
  }
  sortBookmarks(s, game)
  return n
}

/** 把資料夾移到清單第 `to` 個位置(夾進範圍);書籤跟著重排 */
export function moveFolderTo (s: RegexUiState, game: RegexGame, name: string, to: number): boolean {
  const list = [...s.folders[game]]
  const i = list.findIndex(f => f.name === name)
  if (i < 0) return false
  const j = Math.max(0, Math.min(list.length - 1, to))
  if (i === j) return false
  const [f] = list.splice(i, 1)
  list.splice(j, 0, f)
  s.folders[game] = list
  sortBookmarks(s, game)
  return true
}

/** 上移(-1)/ 下移(+1)資料夾 */
export function moveFolderBy (s: RegexUiState, game: RegexGame, name: string, delta: number): boolean {
  const i = s.folders[game].findIndex(f => f.name === name)
  if (i < 0) return false
  return moveFolderTo(s, game, name, i + delta)
}

/** 收合狀態('' = 未分類) */
export function isFolderCollapsed (s: RegexUiState, game: RegexGame, folder: string): boolean {
  if (!folder) return s.uncatCollapsed.includes(game)
  return s.folders[game].find(f => f.name === folder)?.collapsed === true
}

export function setFolderCollapsed (s: RegexUiState, game: RegexGame, folder: string, on: boolean): boolean {
  if (isFolderCollapsed(s, game, folder) === on) return false
  if (!folder) {
    s.uncatCollapsed = on ? [...s.uncatCollapsed, game] : s.uncatCollapsed.filter(g => g !== game)
    return true
  }
  const list = s.folders[game]
  const i = list.findIndex(f => f.name === folder)
  if (i < 0) return false
  s.folders[game] = list.map((f, k) => (k === i ? { ...f, collapsed: on } : f))
  return true
}

/**
 * 把書籤移到 `folder`('' = 未分類):
 * - `before` = 另一個同遊戲書籤的索引 → 放在它前面(並改用它的資料夾,拖曳放在某書籤上);
 * - 沒給 = 放到該資料夾最後。
 * 資料夾不存在 / 跨遊戲 = 不動(回傳 -1)。回傳書籤的新索引。
 */
export function moveBookmark (s: RegexUiState, index: number, folder: string, before?: number): number {
  const b = s.bookmarks[index]
  if (!b || !b.game) return -1
  const game = b.game
  let target = folder
  if (before !== undefined) {
    const anchor = s.bookmarks[before]
    if (!anchor || anchor.game !== game) return -1
    target = anchor.folder ?? ''
  }
  if (target && !s.folders[game].some(f => f.name === target)) return -1
  if (before === index) return index
  // 只在這個遊戲佔的格子裡重排(另一遊戲 / 孤兒書籤的索引不變 → 它們的熱鍵註冊不受影響)
  const slots: number[] = []
  s.bookmarks.forEach((x, i) => { if (x.game === game) slots.push(i) })
  const seq = slots.map(i => s.bookmarks[i]).filter(x => x !== b)
  const anchorObj = before !== undefined ? s.bookmarks[before] : null
  if (target) b.folder = target
  else delete b.folder
  if (anchorObj) seq.splice(seq.indexOf(anchorObj), 0, b)
  else seq.push(b)
  seq.forEach((x, k) => { s.bookmarks[slots[k]] = x })
  sortBookmarks(s, game)
  return s.bookmarks.indexOf(b)
}

/** 同資料夾內上移(-1)/ 下移(+1)一格;到頭 = 不動。回傳新索引 */
export function moveBookmarkBy (s: RegexUiState, index: number, delta: number): number {
  const b = s.bookmarks[index]
  if (!b || !b.game || delta === 0) return index
  const peers: number[] = []
  s.bookmarks.forEach((x, i) => { if (x.game === b.game && (x.folder ?? '') === (b.folder ?? '')) peers.push(i) })
  const k = peers.indexOf(index)
  const j = k + (delta < 0 ? -1 : 1)
  if (j < 0 || j >= peers.length) return index
  const other = peers[j]
  s.bookmarks[index] = s.bookmarks[other]
  s.bookmarks[other] = b
  return other
}

/** 一組顯示用的書籤('' = 未分類) */
export interface BookmarkGroup {
  folder: string
  collapsed: boolean
  items: Array<{ index: number, b: RegexBookmark }>
}

export interface GroupedBookmarks {
  groups: BookmarkGroup[]
  /** false = 只有未分類一組(沒有資料夾,或書籤列 / 快速面板略過空資料夾後只剩未分類)→ 不畫分組標題、不理收合 = 與第 36 步前相同外觀 */
  headers: boolean
}

/**
 * 某遊戲的書籤依資料夾分組:資料夾依清單順序、未分類最後;組內 = 陣列順序。
 * `skipEmpty`(書籤列 / 快速面板):沒有書籤的資料夾不列;未分類沒有書籤時也不列。管理頁不略過(要能拖進空資料夾)。
 */
export function groupBookmarks (s: Pick<RegexUiState, 'bookmarks' | 'folders' | 'uncatCollapsed'>, game: RegexGame, opts: { skipEmpty?: boolean } = {}): GroupedBookmarks {
  const list = s.folders[game] ?? []
  const byFolder = new Map<string, BookmarkGroup>()
  const groups: BookmarkGroup[] = list.map(f => {
    const g: BookmarkGroup = { folder: f.name, collapsed: f.collapsed, items: [] }
    byFolder.set(f.name, g)
    return g
  })
  const uncat: BookmarkGroup = { folder: '', collapsed: s.uncatCollapsed.includes(game), items: [] }
  s.bookmarks.forEach((b, index) => {
    if (b.game !== game) return
    ;(byFolder.get(b.folder ?? '') ?? uncat).items.push({ index, b })
  })
  let out = groups
  if (opts.skipEmpty) out = out.filter(g => g.items.length > 0)
  if (uncat.items.length || !opts.skipEmpty) out = [...out, uncat]
  const headers = out.some(g => g.folder !== '')
  if (!headers) {
    // 沒有分組標題:收合沒有意義(也沒地方按展開)→ 一律展開
    return { groups: out.map(g => ({ ...g, collapsed: false })), headers }
  }
  return { groups: out, headers }
}

/** 某遊戲各資料夾的書籤數('' = 未分類) */
export function folderCounts (s: Pick<RegexUiState, 'bookmarks'>, game: RegexGame): Map<string, number> {
  const m = new Map<string, number>()
  for (const b of s.bookmarks) {
    if (b.game !== game) continue
    const f = b.folder ?? ''
    m.set(f, (m.get(f) ?? 0) + 1)
  }
  return m
}
