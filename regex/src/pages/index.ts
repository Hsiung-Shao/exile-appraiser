// 演算法頁入口 + 「勾選 ↔ 鍵」的共用分派(語料頁用英文行當鍵,演算法頁用項目 id 當鍵:標籤文字會隨賽季變,id 不會)。
import type { RegexGame, RegexLabels, RegexPage } from '../data'
import { applyKeys, collectKeys, keyOf, zhLine } from '../state'
import { numericPages } from './numeric-pages'
import { vendorPages } from './vendor-pages'
import { isAlgoPage, type AlgoEntry, type AlgoValue } from './types'

export * from './types'
export { NUMERIC_LABEL_KEYS, numericPages } from './numeric-pages'
export { VENDOR_LABEL_KEYS, vendorPages } from './vendor-pages'
export { labelBase, linkColors, linkedSockets, propertyFragment, socketColorCount, wholeLine } from './frag'

/** 一個遊戲的全部演算法頁(數值頁在前、商店頁在後);labels = null → 沒有 */
export function algoPages (game: RegexGame, labels: RegexLabels | null): RegexPage[] {
  return [...numericPages(game, labels), ...vendorPages(game, labels)]
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

/** 鍵 → 勾選索引 + 還原不到的數量;語料頁同 applyKeys */
export function applyPageKeys (page: RegexPage, keys: readonly string[], alt: readonly string[] = []): { picked: number[], missed: number } {
  if (!isAlgoPage(page)) return applyKeys(page, keys, alt)
  const picked = new Set<number>()
  let missed = 0
  for (const k of keys) {
    const i = page.entries.findIndex(e => e.id === k)
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
