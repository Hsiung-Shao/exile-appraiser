// 演算法頁入口 + 「勾選 ↔ 鍵」的共用分派(語料頁用英文行當鍵,演算法頁用項目 id 當鍵:標籤文字會隨賽季變,id 不會)。
import type { RegexGame, RegexLabels, RegexPage } from '../data'
import { applyKeys, collectKeys, keyOf, zhLine } from '../state'
import { numericPages } from './numeric-pages'
import { vendorPages } from './vendor-pages'
import { conditionSections } from '../rarity'
import { isAlgoPage, type AlgoEntry, type AlgoPage, type AlgoValue } from './types'

export * from './types'
export { NUMERIC_LABEL_KEYS, numericPages } from './numeric-pages'
export { VENDOR_LABEL_KEYS, vendorPages } from './vendor-pages'
export {
  ITEM_MOD_CATEGORIES, ITEM_MOD_PAGE_IDS, ITEM_MOD_TRADE_CATS, MAX_ANCHOR_TEXT, buildItemModData, buildModIndex, chooseAnchor,
  escapeFragText, filterItemMods, isItemModPageId, itemModCategory, itemModFragment, itemModGroupCounts, itemModPage, parseItemModForms, parseStatsNdjson
} from './item-mods'
export type { ItemModCategory, ItemModData, ItemModEntryData, ItemModExcludeReason, ItemModFilter, ItemModForms, ModAnchor, ModIndex, StatLite } from './item-mods'
export {
  coloredLinks, isTierNameLine, labelBase, linkColors, linkedSockets, mapTierFragment, propertyFragment, rarityFragment, rgbGroup,
  socketColorCount, strictPropertyFragment, wholeLine
} from './frag'

/** 一個遊戲的全部演算法頁(數值頁在前、商店頁在後,再來是第 40 步的稀有度 / 汙染條件區);labels = null → 沒有 */
export function algoPages (game: RegexGame, labels: RegexLabels | null): RegexPage[] {
  return [...numericPages(game, labels), ...vendorPages(game, labels), ...conditionSections(game, labels)]
}

/** 頁面下拉選單上的頁:不含嵌入宿主頁的數值區(第 32 步) */
export function listedPages<P extends RegexPage> (pages: readonly P[]): P[] {
  return pages.filter(p => !isSectionPage(p))
}

/** 是不是嵌入式數值區 */
export function isSectionPage (p: RegexPage | null | undefined): p is AlgoPage {
  return isAlgoPage(p) && !!p.sectionOf
}

/** 宿主頁的數值區(同遊戲);沒有 = null */
export function sectionPageOf (pages: readonly RegexPage[], host: RegexPage | string): AlgoPage | null {
  const id = typeof host === 'string' ? host : host.id
  const game = typeof host === 'string' ? undefined : host.game
  for (const p of pages) if (isSectionPage(p) && p.sectionOf === id && (!game || p.game === game)) return p
  return null
}

/** 頁 id → 使用者看到的頁(數值區 = 宿主頁,其他 = 自己) */
export function hostIdOf (pages: readonly RegexPage[], id: string): string {
  const p = pages.find(x => x.id === id)
  return p && isSectionPage(p) ? p.sectionOf! : id
}

/**
 * 合併用的頁序(第 32 步):清單頁依序,每個宿主頁後面緊接它的數值區。
 * `combine()` 的演算法 term 依演算法頁的相對順序排列,數值區仍在商店頁之前 → 與舊版(數值頁獨立排在全部語料頁之後)逐字相同。
 * `only` = 只取這一頁(單頁輸出:宿主頁 + 它的數值區)。
 */
export function combineOrder (pages: readonly RegexPage[], only?: string): RegexPage[] {
  const out: RegexPage[] = []
  for (const p of listedPages(pages)) {
    if (only !== undefined && p.id !== only) continue
    out.push(p)
    const sec = sectionPageOf(pages, p)
    if (sec) out.push(sec)
  }
  return out
}

/** 存檔 / 分享用的鍵 */
export function entryKey (page: RegexPage, i: number): string {
  const d = page.entries[i]
  return isAlgoPage(page) ? d.id : keyOf(d)
}

/** 勾選索引 → 鍵(依列順序);語料頁同 collectKeys */
export function pageKeysOf (page: RegexPage, picked: readonly number[]): { keys: string[], alt: string[] } {
  if (!isAlgoPage(page)) return collectKeys(page, picked)
  const set = new Set(picked)
  const keys: string[] = []
  const alt: string[] = []
  page.entries.forEach((d, i) => {
    if (!set.has(i)) return
    keys.push(d.id)
    alt.push(zhLine(d))
  })
  return { keys, alt }
}

/**
 * 併列後 id 整個換掉、`X|ref` 退路接不到的舊項目 id → 現行 id(PoE1 物品詞綴數值頁:規則 30 的「+ (Random Support Gem)」配對,
 * 固定列用的是舊的固定輔助 stat id;2026-11-24 以併列前後兩版資料逐條算出)
 */
const RENAMED_ENTRY_IDS: Readonly<Record<string, string>> = {
  stat_285773939: 'indexable_support_154', // Flamewood
  stat_3227145554: 'indexable_support_133', // Impending Doom
  stat_4096329121: 'indexable_support_168', // Living Lightning
  stat_254728692: 'indexable_support_33', // Pierce
  stat_2910545715: 'indexable_support_148' // Prismatic Burst
}

/**
 * 演算法頁的項目 id → 索引。找不到、且是 `X|ref`(物品詞綴數值頁同一個交易站 id 的第二條)時退回 `X`:
 * 資料把同一句的兩列併成一列後(PoE1 規則 30,2026-11-24),原本第二條的 id 由 `X|ref` 變成 `X`,舊存檔 / 書籤 / 分享碼照樣還原。
 * 只在 `X` 那條的英文 ref 就是舊 id 裡的 ref 時才退(同 stat 另一句被排除 / 改名時不能套到別句);
 * 以最後一個 `|` 切(選項型 id 本身含 `|`,ref 不含)。
 */
export function algoEntryIndex (page: AlgoPage, id: string): number {
  const i = page.entries.findIndex(e => e.id === id)
  if (i < 0 && id in RENAMED_ENTRY_IDS) return page.entries.findIndex(e => e.id === RENAMED_ENTRY_IDS[id])
  const cut = id.lastIndexOf('|')
  if (i >= 0 || cut < 0) return i
  const ref = id.slice(cut + 1)
  return page.entries.findIndex(e => e.id === id.slice(0, cut) && e.en[0] === ref)
}

/** 存下來的數值(項目 id → 值)換成這一頁現行的 id;還原不到的照原鍵留著(其他頁共用同一個存放鍵) */
export function remapAlgoValues<T> (page: AlgoPage, values: Readonly<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [id, v] of Object.entries(values)) {
    const i = algoEntryIndex(page, id)
    const key = i >= 0 ? page.entries[i].id : id
    if (!(key in out) || key === id) out[key] = v
  }
  return out
}

/** 鍵 → 勾選索引 + 還原不到的數量;語料頁同 applyKeys */
export function applyPageKeys (page: RegexPage, keys: readonly string[], alt: readonly string[] = []): { picked: number[], missed: number } {
  if (!isAlgoPage(page)) return applyKeys(page, keys, alt)
  const picked = new Set<number>()
  let missed = 0
  for (const k of keys) {
    const i = algoEntryIndex(page, k)
    if (i >= 0) picked.add(i)
    else missed++
  }
  return { picked: [...picked].sort((a, b) => a - b), missed }
}

/** 項目的預設值(複本) */
export function defaultValue (e: AlgoEntry): AlgoValue {
  return { ...e.input.def }
}

/** 值是否可用(片段產得出來) */
export function valueUsable (e: AlgoEntry, v: AlgoValue | undefined, lang: 'zh' | 'en' = 'zh'): boolean {
  return e.fragment(v ?? e.input.def, lang) !== null
}

/** 只留 AlgoValue 認得的欄位與型別(讀存檔 / 分享碼用);沒有任何欄位 → null */
export function sanitizeValue (raw: unknown): AlgoValue | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const v: AlgoValue = {}
  if (typeof r.min === 'number' && Number.isFinite(r.min)) v.min = Math.trunc(r.min)
  if (typeof r.max === 'number' && Number.isFinite(r.max)) v.max = Math.trunc(r.max)
  if (typeof r.choice === 'string') v.choice = r.choice.slice(0, 16)
  return v
}
