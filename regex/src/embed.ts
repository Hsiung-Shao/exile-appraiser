// 嵌入式數值區(第 32 步)的「狀態 ↔ 勾選」純函式:renderer store 與測試共用同一套,
// 遷移往返測試(舊 state / 書籤 / 分享碼 / 範本 → 新結構 → 產出逐字相同)直接驗證 store 會走的路徑。
//
// 勾選在記憶體裡以**頁 id** 為鍵(數值區用它內部的頁 id,例如 `map_numeric`,好直接丟進 combine);
// 存檔 / 書籤 / 分享碼則以宿主頁 id 為鍵(sections.ts)。
import type { Mode } from './gen'
import type { RegexGame, RegexPage } from './data'
import { applyPageKeys, combineOrder, isSectionPage, pageKeysOf, sectionPageOf } from './pages'
import { isAlgoPage, type AlgoValue } from './pages/types'
import type { CombineSel } from './combine'
import { numericKeyOf, planMerge } from './sections'
import type { RegexBookmark, RegexUiState } from './state'
import type { ShareState } from './share'

export type PicksMap = Readonly<Record<string, readonly number[] | undefined>>
export type ValuesMap = Readonly<Record<string, Readonly<Record<string, AlgoValue>> | undefined>>

/** 這一頁存下的勾選(regex_state.json 的 `current`);沒存過 = null */
export function savedPicksOf (page: RegexPage, s: RegexUiState): { picked: number[], missed: number } | null {
  const hostId = isSectionPage(page) ? page.sectionOf! : page.id
  const saved = s.current.find(p => p.page === hostId)
  if (!saved) return null
  return isSectionPage(page) ? applyPageKeys(page, saved.num ?? []) : applyPageKeys(page, saved.keys, saved.alt)
}

/** 某頁的數值值(數值區存在宿主頁 id 底下) */
export function valuesOfPage (values: ValuesMap, pageId: string): Readonly<Record<string, AlgoValue>> | undefined {
  return values[numericKeyOf(pageId)]
}

/**
 * 合併輸入:清單頁依序、宿主頁後面緊接數值區,只取有勾選的頁(與舊版合併頁同一串)。
 * `only` = 單頁輸出(宿主頁 + 它的數值區;商店頁 / 其他頁 = 自己)。
 */
export function combineSels (pages: readonly RegexPage[], picks: PicksMap, values: ValuesMap, only?: string): CombineSel[] {
  return combineOrder(pages, only)
    .map(p => ({ page: p, picks: [...(picks[p.id] ?? [])], values: valuesOfPage(values, p.id) }))
    .filter(s => only !== undefined || s.picks.length > 0)
}

/**
 * R10「已選(合併)」的輸入(PobTools regex_tool_ui.cpp mergeIdx / combinedAll):有勾選的頁只取目前頁 `currentId` 的物品組
 * (sections.ts planMerge)。`picked` = 併入的有勾選頁(清單顯示用);`sels` = 送進 combine 的(勾了 section、宿主語料頁沒勾時,
 * 宿主以空勾選放在 section 前面,當條件 term 縮短的防護語料);`skippedPages` = 其他物品組的有勾選頁數(宿主 + section 算一頁)。
 */
export function mergeSels (
  pages: readonly RegexPage[], picks: PicksMap, values: ValuesMap, currentId: string
): { sels: CombineSel[], picked: CombineSel[], skippedPages: number } {
  const all = combineSels(pages, picks, values)
  const plan = planMerge(currentId, all.map(s => s.page.id))
  const picked = all.filter(s => plan.merged.includes(s.page.id))
  const sels: CombineSel[] = []
  for (const s of picked) {
    const hostId = isSectionPage(s.page) ? s.page.sectionOf! : null
    if (hostId && !plan.merged.includes(hostId)) {
      const host = pages.find(p => p.id === hostId)
      if (host && !isAlgoPage(host)) sels.push({ page: host, picks: [], values: valuesOfPage(values, host.id) })
    }
    sels.push(s)
  }
  return { sels, picked, skippedPages: plan.skippedPages }
}

/** 宿主頁(或任何清單頁)目前內容 → 書籤本體;詞綴與數值區都沒勾 = null */
export function bookmarkBodyOf (
  pages: readonly RegexPage[], page: RegexPage, picks: PicksMap, values: ValuesMap,
  meta: { game: RegexGame, mode: Mode, lang: 'zh' | 'en' }
): Omit<RegexBookmark, 'name'> | null {
  const own = [...(picks[page.id] ?? [])]
  const k = pageKeysOf(page, own)
  const body: Omit<RegexBookmark, 'name'> = { page: page.id, game: meta.game, mode: meta.mode, lang: meta.lang, keys: k.keys, alt: k.alt }
  if (isAlgoPage(page)) {
    const m: Record<string, AlgoValue> = {}
    const cur = valuesOfPage(values, page.id) ?? {}
    for (const i of own) { const e = page.entries[i]; m[e.id] = { ...(cur[e.id] ?? e.input.def) } }
    if (own.length) body.numeric = m
  }
  const sec = sectionPageOf(pages, page)
  const secPicked = sec ? [...(picks[sec.id] ?? [])] : []
  if (sec && secPicked.length) {
    const cur = valuesOfPage(values, sec.id) ?? {}
    const m: Record<string, AlgoValue> = {}
    for (const i of secPicked) { const e = sec.entries[i]; m[e.id] = { ...(cur[e.id] ?? e.input.def) } }
    body.num = pageKeysOf(sec, secPicked).keys
    // 宿主本身是演算法頁(第 40 步:物品詞綴數值頁 + 條件區)時兩邊的值共用宿主 id,項目 id 不重疊 → 合併
    body.numeric = { ...(body.numeric ?? {}), ...m }
  }
  if (!body.keys.length && !body.num) return null
  return body
}

export interface BookmarkApply {
  /** 書籤指向的清單頁(數值區書籤 = 宿主頁) */
  page: RegexPage
  /** 要覆寫的勾選:pageId → 索引(宿主頁書籤一併覆寫它的數值區) */
  picks: Record<string, number[]>
  /** 要併入的數值:存放鍵(numericKeyOf)→ 值 */
  values: Record<string, Record<string, AlgoValue>>
  missed: number
}

/** 書籤 → 要套用的勾選與值;頁不存在 = null(呼叫端報「找不到頁」) */
export function bookmarkApplyOf (pages: readonly RegexPage[], b: RegexBookmark): BookmarkApply | null {
  const target = pages.find(p => p.id === b.page)
  if (!target) return null
  let page: RegexPage = target
  let keys = b.keys
  let alt = b.alt
  let num = b.num
  // 防禦:未遷移的數值頁書籤(state.ts 讀檔時已轉,這裡只是保險)
  if (isSectionPage(target)) {
    const host = pages.find(p => p.id === target.sectionOf)
    if (!host) return null
    num = [...b.keys]
    keys = []
    alt = []
    page = host
  }
  const out: BookmarkApply = { page, picks: {}, values: {}, missed: 0 }
  const r = applyPageKeys(page, keys, alt)
  out.picks[page.id] = r.picked
  out.missed += r.missed
  const sec = sectionPageOf(pages, page)
  if (sec) {
    // 宿主頁書籤 = 整頁快照:沒有 num(舊的詞綴書籤)= 數值區不勾,單頁輸出與當初存的一樣
    const rs = applyPageKeys(sec, num ?? [])
    out.picks[sec.id] = rs.picked
    out.missed += rs.missed
    if (b.numeric && num?.length) out.values[numericKeyOf(sec.id)] = { ...b.numeric }
  }
  // 演算法頁本身的值(宿主有條件區時與它共用同一個存放鍵,合併)
  if (b.numeric && isAlgoPage(page)) out.values[page.id] = { ...(out.values[page.id] ?? {}), ...b.numeric }
  return out
}

/** 目前遊戲的勾選 → 分享碼 / 範本形狀(v2;只含有勾選的頁,數值只含已勾選項目) */
export function shareStateOf (
  game: RegexGame, pages: readonly RegexPage[], picks: PicksMap, values: ValuesMap,
  rest: { mode: Mode, custom: readonly string[], excludes: readonly string[] }
): ShareState {
  const s: ShareState = { v: 2, game, mode: rest.mode, pages: {}, sections: {}, numeric: {}, custom: [...rest.custom], excludes: [...rest.excludes] }
  for (const p of pages) {
    if (p.game !== game) continue
    const pk = [...(picks[p.id] ?? [])]
    if (!pk.length) continue
    const keys = pageKeysOf(p, pk).keys
    if (isSectionPage(p)) s.sections[p.sectionOf!] = keys
    else s.pages[p.id] = keys
    if (isAlgoPage(p)) {
      const cur = valuesOfPage(values, p.id) ?? {}
      const m: Record<string, AlgoValue> = {}
      for (const i of pk) { const e = p.entries[i]; m[e.id] = { ...(cur[e.id] ?? e.input.def) } }
      // 宿主演算法頁與它的條件區共用宿主 id(項目 id 不重疊)→ 合併
      s.numeric[numericKeyOf(p.id)] = { ...(s.numeric[numericKeyOf(p.id)] ?? {}), ...m }
    }
  }
  return s
}

/** `resolveState().values`(以內部頁 id 為鍵)→ 存放鍵(數值區 = 宿主頁 id),可直接併進 `RegexUiState.numeric` */
export function resolvedValues (values: Readonly<Record<string, Record<string, AlgoValue>>>): Record<string, Record<string, AlgoValue>> {
  const out: Record<string, Record<string, AlgoValue>> = {}
  for (const [id, m] of Object.entries(values)) out[numericKeyOf(id)] = { ...(out[numericKeyOf(id)] ?? {}), ...m }
  return out
}
