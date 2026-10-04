// 第 33 步(2026-10-04):正則書籤快捷存取 —— 不打開正則分頁、不動目前的勾選,直接由書籤算出要貼進遊戲的搜尋字串。
//
// 三個入口(設定視窗旁的書籤列、熱鍵叫出的小面板、書籤個別熱鍵)都走這裡:
// - `bookmarkQuery`:書籤 → 單頁輸出(宿主詞綴頁含數值區)。與「載入書籤後看單頁輸出」逐字相同
//   (同一條 `bookmarkApplyOf` → `combineSels(…, only)` → `combine` 路徑;測試 `regex/test/quick.test.ts` 對照)。
// - `bookmarkHotkeys`:書籤上設的個別熱鍵 → main 註冊用的清單(帶書籤在 `ui.bookmarks` 的索引 + 名字,main 觸發時回傳給 renderer 查回書籤)。
// - `quickBookmarks`:某遊戲可用的書籤(依 `ui.bookmarks` 順序;沒有遊戲的孤兒書籤不列)。
import type { RegexGame, RegexPage } from './data'
import { combine } from './combine'
import { bookmarkApplyOf, combineSels } from './embed'
import type { RegexBookmark } from './state'

export interface BookmarkQuery {
  /** 要貼進遊戲搜尋列的字串;空字串 = 這個書籤產不出東西(鍵全部還原不到) */
  query: string
  /** 碼點數(與輸出區同一個計數) */
  length: number
  /** 遊戲搜尋列上限(參與頁最小值) */
  limit: number
  /** 還原不到的鍵數(賽季改了詞綴) */
  missed: number
  /** 書籤指向的清單頁(數值區書籤 = 宿主頁) */
  page: RegexPage
}

/** 書籤 → 搜尋字串;頁不存在(另一遊戲的清單沒載 / 資料改版刪了頁)= null */
export function bookmarkQuery (pages: readonly RegexPage[], b: RegexBookmark): BookmarkQuery | null {
  const a = bookmarkApplyOf(pages, b)
  if (!a) return null
  const r = combine({ lang: b.lang, mode: b.mode, pages: combineSels(pages, a.picks, a.values, a.page.id) })
  return { query: r.query, length: r.length, limit: r.limit, missed: a.missed, page: a.page }
}

/** main 註冊用的一筆書籤熱鍵 */
export interface BookmarkHotkey {
  /** 書籤在 `RegexUiState.bookmarks` 的索引(觸發時 renderer 用它找回書籤;對不上名字再以名字找) */
  index: number
  name: string
  game: RegexGame
  hotkey: string
}

/** 有設熱鍵、有遊戲的書籤(順序 = 書籤順序;註冊與衝突判定先到先得) */
export function bookmarkHotkeys (bookmarks: readonly RegexBookmark[]): BookmarkHotkey[] {
  const out: BookmarkHotkey[] = []
  bookmarks.forEach((b, index) => {
    const hk = typeof b.hotkey === 'string' ? b.hotkey.trim() : ''
    if (!hk || !b.game || !b.name) return
    out.push({ index, name: b.name, game: b.game, hotkey: hk })
  })
  return out
}

/** 某遊戲的書籤(帶原始索引);孤兒書籤(沒有 game)不列 */
export function quickBookmarks (bookmarks: readonly RegexBookmark[], game: RegexGame): Array<{ index: number, b: RegexBookmark }> {
  return bookmarks.map((b, index) => ({ index, b })).filter(x => x.b.game === game)
}

/**
 * 觸發時找回書籤:先看索引(名字也要對上),對不上(書籤在熱鍵註冊後被刪 / 移動)再以「同遊戲 + 同名」找第一筆。
 * 找不到 = -1(呼叫端提示「書籤已不存在」)。
 */
export function findBookmark (bookmarks: readonly RegexBookmark[], ref: { index: number, name: string, game?: RegexGame }): number {
  const at = bookmarks[ref.index]
  if (at && at.name === ref.name && (!ref.game || at.game === ref.game)) return ref.index
  return bookmarks.findIndex(b => b.name === ref.name && (!ref.game || b.game === ref.game))
}
