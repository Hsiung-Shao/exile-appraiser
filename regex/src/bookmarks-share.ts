// 第 40 步(2026-10-07):書籤包 —— PobTools 把使用者選的正則書籤 / 資料夾(可混兩個遊戲)送進來,加進書籤,不動目前的勾選。
// 格式由本專案定義(使用者裁定「exile-appraiser 先做」),PobTools 照做;介面規格 docs/regex-share-cli.md「書籤包」。
//
//   { "kind": "regex-bookmarks", "v": 1,
//     "folders": { "poe1": [{ "name", "collapsed" }], "poe2": [...] },
//     "bookmarks": [{ "name", "page", "game", "mode", "lang", "keys", "alt", "numeric"?, "num"?, "folder"? }] }
//
// - 書籤欄位與 regex_state.json schema 5 相同,驗證共用 state.ts `parseBookmark`;`hotkey` 一律不帶(encode 不寫、decode 丟掉:避免熱鍵衝突);
//   `game` 必填(poe1 / poe2)。壞掉的書籤 / 資料夾略過並記 warning(不讓半壞的包整個失敗);kind / v 不符 = 丟例外。
// - 編碼與分享碼相同:JSON → gzip → base64url(share.ts `gzipBase64url` / `gunzipBase64url`,上限 SHARE_MAX_*)。
//   encode 的 JSON 鍵順序固定(`canonicalBookmarkPackJson`),給 PobTools 對拍;gzip 位元組因實作不同,碼本身不保證逐字相同。
// - 合併(`mergeBookmarks`):資料夾以「遊戲 + 名稱」對應(已有就併入、收合狀態不動;沒有就依包內順序加在最後);
//   同遊戲 + 同資料夾 + 同名 → 新的那筆改名「名 (2)」「名 (3)」…,既有的不動;只換 bookmarks / folders,其他欄位原物件不動。
import type { RegexGame, RegexPage } from './data'
import { bookmarkApplyOf } from './embed'
import { normalizeFolderName, normalizeFolders, type BookmarkFolder } from './folders'
import { gunzipBase64url, gzipBase64url } from './share'
import { parseBookmark, type RegexBookmark, type RegexUiState } from './state'

export const BOOKMARK_PACK_KIND = 'regex-bookmarks'
export const BOOKMARK_PACK_VERSION = 1

export interface BookmarkPack {
  kind: typeof BOOKMARK_PACK_KIND
  v: typeof BOOKMARK_PACK_VERSION
  folders: Record<RegexGame, BookmarkFolder[]>
  /** `game` 一定是 poe1 / poe2;沒有 `hotkey` */
  bookmarks: RegexBookmark[]
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const GAMES: readonly RegexGame[] = ['poe1', 'poe2']

/** 書籤 → 包內形狀(固定鍵順序;沒有的選填欄位不寫;不帶 hotkey) */
function packBookmark (b: RegexBookmark): Json {
  return {
    name: b.name,
    page: b.page,
    game: b.game,
    mode: b.mode,
    lang: b.lang,
    keys: [...b.keys],
    alt: [...b.alt],
    ...(b.numeric && Object.keys(b.numeric).length ? { numeric: b.numeric } : {}),
    ...(b.num?.length ? { num: [...b.num] } : {}),
    ...(b.folder ? { folder: b.folder } : {})
  }
}

/** 正規 JSON 字串(鍵順序固定;encodeBookmarks 壓縮的就是它,PobTools 可逐字對拍) */
export function canonicalBookmarkPackJson (pack: BookmarkPack): string {
  return JSON.stringify({
    kind: BOOKMARK_PACK_KIND,
    v: BOOKMARK_PACK_VERSION,
    folders: {
      poe1: pack.folders.poe1.map(f => ({ name: f.name, collapsed: f.collapsed === true })),
      poe2: pack.folders.poe2.map(f => ({ name: f.name, collapsed: f.collapsed === true }))
    },
    bookmarks: pack.bookmarks.map(packBookmark)
  })
}

export async function encodeBookmarks (pack: BookmarkPack): Promise<string> {
  return await gzipBase64url(canonicalBookmarkPackJson(pack))
}

/** 物件 → 書籤包(驗證 + 清理)。kind / v 不符、不是物件 = 丟例外;壞書籤 / 資料夾略過並記 warning */
export function normalizeBookmarkPack (raw: unknown): { pack: BookmarkPack, warnings: string[] } {
  if (!isObj(raw)) throw new Error('書籤包內容不是物件')
  if (raw.kind !== BOOKMARK_PACK_KIND) throw new Error(`不是書籤包(kind = ${String(raw.kind)})`)
  if (raw.v !== BOOKMARK_PACK_VERSION) throw new Error(`書籤包版本不符(${String(raw.v)},本版只認 ${BOOKMARK_PACK_VERSION})`)
  const warnings: string[] = []
  const folders: Record<RegexGame, BookmarkFolder[]> = { poe1: [], poe2: [] }
  const rawFolders = raw.folders
  if (rawFolders !== undefined && !isObj(rawFolders)) warnings.push('folders 不是物件,已忽略')
  for (const g of GAMES) {
    const list = isObj(rawFolders) ? rawFolders[g] : undefined
    if (list === undefined) continue
    if (!Array.isArray(list)) { warnings.push(`folders.${g} 不是陣列,已忽略`); continue }
    const seen = new Set<string>()
    list.forEach((f, i) => {
      const name = isObj(f) && typeof f.name === 'string' ? normalizeFolderName(f.name) : ''
      if (!name) { warnings.push(`folders.${g}[${i}] 沒有名稱,已略過`); return }
      if (seen.has(name)) return
      seen.add(name)
      folders[g].push({ name, collapsed: isObj(f) && f.collapsed === true })
    })
  }
  const bookmarks: RegexBookmark[] = []
  if (raw.bookmarks !== undefined && !Array.isArray(raw.bookmarks)) warnings.push('bookmarks 不是陣列,已忽略')
  const rawBookmarks = Array.isArray(raw.bookmarks) ? raw.bookmarks : []
  rawBookmarks.forEach((b, i) => {
    let rec: RegexBookmark | null
    try { rec = parseBookmark(b) } catch (e) { warnings.push(`bookmarks[${i}] 欄位型別不符(${e instanceof Error ? e.message : String(e)}),已略過`); return }
    if (!rec) { warnings.push(`bookmarks[${i}] 缺名稱 / 頁 / 鍵,已略過`); return }
    if (rec.game !== 'poe1' && rec.game !== 'poe2') { warnings.push(`bookmarks[${i}]「${rec.name}」沒有遊戲,已略過`); return }
    delete rec.hotkey
    const folder = normalizeFolderName(rec.folder ?? '')
    if (folder) {
      rec.folder = folder
      if (!folders[rec.game].some(f => f.name === folder)) folders[rec.game].push({ name: folder, collapsed: false })
    } else {
      delete rec.folder
    }
    bookmarks.push(rec)
  })
  for (const k of Object.keys(raw)) if (!['kind', 'v', 'folders', 'bookmarks'].includes(k)) warnings.push(`未知欄位「${k}」已忽略`)
  return { pack: { kind: BOOKMARK_PACK_KIND, v: BOOKMARK_PACK_VERSION, folders, bookmarks }, warnings }
}

export async function decodeBookmarks (code: string): Promise<{ pack: BookmarkPack, warnings: string[] }> {
  return normalizeBookmarkPack(await gunzipBase64url(code, '書籤包'))
}

export interface MergedBookmark {
  game: RegexGame
  /** 空字串 = 未分類 */
  folder: string
  /** 加入後的名稱(改名時 ≠ originalName) */
  name: string
  originalName: string
}

export interface MergeResult {
  /** 新的狀態:只換 bookmarks / folders,其他欄位與輸入是同一個物件 */
  state: RegexUiState
  /** 依包內順序 */
  added: MergedBookmark[]
  /** 改了名的那幾筆(added 的子集) */
  renamed: MergedBookmark[]
  /** 新建的資料夾 */
  foldersCreated: Array<{ game: RegexGame, name: string }>
}

/** 同遊戲 + 同資料夾 + 同名的鍵 */
const slotKey = (game: string, folder: string, name: string): string => `${game}\u0000${folder}\u0000${name}`

/** 書籤包併進目前的書籤(不動勾選與其他狀態);可以先拿來預覽(不改輸入) */
export function mergeBookmarks (s: RegexUiState, pack: BookmarkPack): MergeResult {
  const folders: Record<RegexGame, BookmarkFolder[]> = { poe1: s.folders.poe1.map(f => ({ ...f })), poe2: s.folders.poe2.map(f => ({ ...f })) }
  const foldersCreated: MergeResult['foldersCreated'] = []
  for (const g of GAMES) {
    for (const f of pack.folders[g]) {
      if (folders[g].some(x => x.name === f.name)) continue
      folders[g].push({ name: f.name, collapsed: f.collapsed === true })
      foldersCreated.push({ game: g, name: f.name })
    }
  }
  const taken = new Set(s.bookmarks.map(b => slotKey(b.game, b.folder ?? '', b.name)))
  const bookmarks: RegexBookmark[] = s.bookmarks.map(b => ({ ...b }))
  const added: MergedBookmark[] = []
  for (const src of pack.bookmarks) {
    const game = src.game as RegexGame
    const folder = src.folder ?? ''
    let name = src.name
    for (let n = 2; taken.has(slotKey(game, folder, name)); n++) name = `${src.name} (${n})`
    taken.add(slotKey(game, folder, name))
    const b: RegexBookmark = { ...src, name, keys: [...src.keys], alt: [...src.alt] }
    delete b.hotkey
    if (src.numeric) b.numeric = { ...src.numeric }
    if (src.num) b.num = [...src.num]
    if (!folder) delete b.folder
    // 包裡沒列的資料夾(normalizeBookmarkPack 已補;這裡保險)
    if (folder && !folders[game].some(x => x.name === folder)) {
      folders[game].push({ name: folder, collapsed: false })
      foldersCreated.push({ game, name: folder })
    }
    bookmarks.push(b)
    added.push({ game, folder, name, originalName: src.name })
  }
  const state: RegexUiState = { ...s, bookmarks, folders }
  normalizeFolders(state)
  return { state, added, renamed: added.filter(a => a.name !== a.originalName), foldersCreated }
}

/** 這筆書籤在目前清單上還原不到的鍵數(頁不存在 = 全部鍵數);確認對話框標示「找不到 N 項」 */
export function bookmarkMissed (pages: readonly RegexPage[], b: RegexBookmark): number {
  const a = bookmarkApplyOf(pages, b)
  return a ? a.missed : b.keys.length + (b.num?.length ?? 0)
}
