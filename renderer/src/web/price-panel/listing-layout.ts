// 查價面板 B 改版 P4(2026-10-14):掛單顯示方式「方塊 / 長條」。一般物品與通貨分開記(Q12)。
// 純函式(不 import Config / vue),Config.ts 與 useListingLayout.ts 共用。
export type ListingLayoutMode = 'grid' | 'list'
export type ListingLayoutKind = 'item' | 'bulk'
export type ListingLayout = Record<ListingLayoutKind, ListingLayoutMode>

/** 預設:一般物品 = 方塊、通貨 = 長條 */
export const DEFAULT_LISTING_LAYOUT: Readonly<ListingLayout> = Object.freeze({ item: 'grid', bulk: 'list' })

export function defaultListingLayout (): ListingLayout {
  return { ...DEFAULT_LISTING_LAYOUT }
}

function normMode (v: unknown, def: ListingLayoutMode): ListingLayoutMode {
  return v === 'grid' || v === 'list' ? v : def
}

/** 舊設定檔沒有 / 壞值 → 預設;逐欄回預設(一欄壞不影響另一欄) */
export function normListingLayout (v: unknown): ListingLayout {
  const o = (v != null && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {}
  return {
    item: normMode(o.item, DEFAULT_LISTING_LAYOUT.item),
    bulk: normMode(o.bulk, DEFAULT_LISTING_LAYOUT.bulk)
  }
}

/** 切換後的新設定物件(不改原物件,讓 Config 的序列化 watch 一定看得到變化) */
export function withListingLayout (cur: unknown, kind: ListingLayoutKind, mode: ListingLayoutMode): ListingLayout {
  return { ...normListingLayout(cur), [kind]: normMode(mode, DEFAULT_LISTING_LAYOUT[kind]) }
}
