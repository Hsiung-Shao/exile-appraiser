/**
 * 2026-11-18 PoE1 地圖詞綴檢查改用正則書籤上色(使用者裁定:正則照原本用法,地圖檢查是它的延伸,不另存一份標記)。
 * 書籤勾到的詞綴(`applyPageKeys`)→ 該詞綴的中英文行 → 正規化文字;解析出的詞綴任一 matcher(含 superseded 舊寫法)對得到 = 命中。
 * 排除(none)書籤命中 = 紅,any / all = 綠。正則地圖詞綴頁 122 / 122、探險日誌 62 / 62 行對得到(劫盜契約差的是「需要 X(等級 #)」屬性行)。
 */
import { applyPageKeys, isCustomBookmark, type RegexBookmark, type RegexPage } from '@exile-appraiser/regex'

export type MapMark = 'bad' | 'good'
export interface BookmarkMarks { kind: MapMark, texts: ReadonlySet<string> }

/** 地圖檢查適用的正則頁(地圖 / 劫盜契約 / 探險日誌 = 上游 map-check 的適用物品) */
export const MAP_CHECK_PAGES: readonly string[] = ['map_mods', 'heist_contracts', 'logbook_mods']

/** 選單列的書籤:PoE1、適用頁;自訂字串書籤沒有詞綴清單 → 不列 */
export function mapCheckBookmarks (bookmarks: readonly RegexBookmark[]): RegexBookmark[] {
  return bookmarks.filter(b => b.game === 'poe1' && !isCustomBookmark(b) && MAP_CHECK_PAGES.includes(b.page))
}

/** 比對用:數字佔位(含正負號)統一成 #、去空白、小寫 */
export function normModText (s: string): string {
  return s.replace(/[+-]?#/g, '#').replace(/\s+/g, '').toLowerCase()
}

export function bookmarkMarks (pages: readonly RegexPage[], b: RegexBookmark | undefined): BookmarkMarks | null {
  const page = b && pages.find(p => p.id === b.page)
  if (!b || !page) return null
  const texts = new Set<string>()
  for (const i of applyPageKeys(page, b.keys, b.alt).picked) {
    const e = page.entries[i] as { zh?: string[], en?: string[], altZh?: string[], altEn?: string[] }
    for (const t of [...e.zh ?? [], ...e.en ?? [], ...e.altZh ?? [], ...e.altEn ?? []]) texts.add(normModText(t))
  }
  return { kind: b.mode === 'none' ? 'bad' : 'good', texts }
}

export function markOfStat (m: BookmarkMarks | null, matchers: ReadonlyArray<{ string: string }>): MapMark | null {
  return m && matchers.some(x => m.texts.has(normModText(x.string))) ? m.kind : null
}

/** 設定 `mapCheckBookmark`(書籤名稱):沒有 / 壞值 / 空白 = null */
export function normMapCheckBookmark (v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}
