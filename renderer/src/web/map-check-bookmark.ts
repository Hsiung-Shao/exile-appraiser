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

/**
 * 設定 `mapCheckBookmark` 的書籤識別:資料夾 + 名稱 + 同資料夾同名中的第幾個(`nth`,0 起算;正則書籤允許同名,
 * 「存成書籤」一律進未分類、不檢查重名;審查第 3、4 輪)。找不到時退回第一個同資料夾同名、再退回第一個同名
 * (書籤被刪 / 移到別的資料夾;同 `quick.ts` `findBookmark` 的退路)。
 */
export interface MapCheckRef { folder: string, name: string, nth?: number }

const sameSlot = (a: RegexBookmark, folder: string, name: string) => a.name === name && (a.folder ?? '') === folder

export function mapCheckRefOf (b: RegexBookmark, list: readonly RegexBookmark[]): MapCheckRef {
  const folder = b.folder ?? ''
  const nth = list.filter(x => sameSlot(x, folder, b.name)).indexOf(b)
  return nth > 0 ? { folder, name: b.name, nth } : { folder, name: b.name }
}

export function findMapCheckBookmark (list: readonly RegexBookmark[], ref: MapCheckRef | null | false): RegexBookmark | undefined {
  if (!ref) return undefined
  const same = list.filter(b => sameSlot(b, ref.folder, ref.name))
  return same[ref.nth ?? 0] ?? same[0] ?? list.find(b => b.name === ref.name)
}

/** 下拉文字:同名的前面加資料夾(未分類就只有名稱),同資料夾同名的第二個起加「 (2)」… */
export function bookmarkLabels (list: readonly RegexBookmark[]): string[] {
  return list.map(b => {
    if (list.filter(x => x.name === b.name).length < 2) return b.name
    const nth = list.filter(x => sameSlot(x, b.folder ?? '', b.name)).indexOf(b)
    return `${b.folder ? `${b.folder} / ` : ''}${b.name}${nth > 0 ? ` (${nth + 1})` : ''}`
  })
}

/** 讀設定:`{ folder, name, nth? }`;`false` = 明確選「不上色」;沒有 / 壞值 / 名稱空白 = null(沒選過) */
export function normMapCheckBookmark (v: unknown): MapCheckRef | null | false {
  if (v === false) return false
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name.trim()) return null
  if (o.folder !== undefined && typeof o.folder !== 'string') return null
  const ref: MapCheckRef = { folder: (o.folder as string | undefined) ?? '', name: o.name }
  if (Number.isInteger(o.nth) && (o.nth as number) > 0) ref.nth = o.nth as number
  return ref
}

/**
 * 正則書籤改名(`bookmarks[index]` → `name`)後,地圖檢查設定要寫成什麼(使用者要求:改名時一起更新)。
 * 先找出改名前選中的書籤,改名後重算它的識別;沒選 / 選中的找不到 / 識別沒變 = undefined(不動設定)。
 */
export function mapCheckRefAfterRename (bookmarks: readonly RegexBookmark[], ref: MapCheckRef | null | false, index: number, name: string): MapCheckRef | undefined {
  const picked = findMapCheckBookmark(mapCheckBookmarks(bookmarks), ref)
  if (!picked || !bookmarks[index]) return undefined
  const after = bookmarks.map((b, i) => i === index ? { ...b, name } : b)
  const next = mapCheckRefOf(after[bookmarks.indexOf(picked)], mapCheckBookmarks(after))
  const r = ref as MapCheckRef
  return next.name === r.name && next.folder === r.folder && (next.nth ?? 0) === (r.nth ?? 0) ? undefined : next
}

/**
 * 地圖檢查實際用的書籤:選過的照選過的;沒選過(null)或選的已不在,而清單只有一個 → 用它(使用者要求);
 * 明確選「不上色」(false)→ 不用任何書籤。
 */
export function pickMapCheckBookmark (list: readonly RegexBookmark[], ref: MapCheckRef | null | false): RegexBookmark | undefined {
  if (ref === false) return undefined
  return findMapCheckBookmark(list, ref) ?? (list.length === 1 ? list[0] : undefined)
}
