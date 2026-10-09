// 嵌入式數值區(第 32 步,2026-10-04):地圖 / 換界石的數值條件不再是下拉選單裡的獨立頁,
// 而是嵌在宿主詞綴頁(PoE1 `map_mods`、PoE2 `waystone_mods`)頂端的一個區塊,輸出與詞綴合成同一條正則。
//
// 內部仍沿用演算法頁物件(`numericPages()` 的 `map_numeric` / `waystone_numeric`,`sectionOf` = 宿主 id),
// 合併時緊接在宿主頁之後送進 `combine()`:演算法 term 只依演算法頁之間的相對順序排列,
// 數值區仍排在商店頁之前,所以與舊版「合併頁 = 詞綴頁 + 數值頁」逐字相同。
//
// 存檔 / 書籤 / 分享碼 / 範本的新結構以**宿主頁 id** 為鍵:
//   * regex_state.json(schema 3):`current[{page: 宿主, keys, alt, num: [項目 id]}]`、`numeric[宿主]`、書籤 `num` + `numeric`
//   * 分享碼 v2 / 範本:`sections{宿主: [項目 id]}`、`numeric{宿主: {...}}`
// 舊格式(頁 id = `map_numeric` / `waystone_numeric`)讀入時一律轉成新結構(state.ts / share.ts 的 migrate*)。
//
// 本檔不 import 任何模組(state.ts / share.ts / pages 都會用到,避免循環)。

/**
 * 數值區的(內部)頁 id → 宿主詞綴頁 id。
 * 第 40 步起另有「稀有度 / 汙染」條件區(rarity.ts `conditionSections`,只有一列條件列),同一套嵌入機制:
 * 物品基底(兩遊戲同 id)、碑牌詞綴(PoE2)、物品詞綴數值(兩遊戲各一)。
 */
export const SECTION_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  map_numeric: 'map_mods',
  waystone_numeric: 'waystone_mods',
  vendor_bases_cond: 'vendor_bases',
  tablet_mods_cond: 'tablet_mods',
  item_mod_values_cond: 'item_mod_values',
  item_mod_values_poe2_cond: 'item_mod_values_poe2'
})

/** 數值區頁 id → 宿主頁 id;不是數值區 = undefined */
export function sectionHostOf (pageId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(SECTION_HOSTS, pageId) ? SECTION_HOSTS[pageId] : undefined
}

/** 宿主頁 id → 它的數值區頁 id;沒有 = undefined */
export function sectionIdOf (hostId: string): string | undefined {
  for (const [sec, host] of Object.entries(SECTION_HOSTS)) if (host === hostId) return sec
  return undefined
}

/** 數值值的存放鍵:數值區存在宿主頁 id 底下,其他頁存在自己的 id */
export function numericKeyOf (pageId: string): string {
  return sectionHostOf(pageId) ?? pageId
}

/** 依序合併、去重(保留第一次出現的順序) */
export function unionKeys (a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])]
}

// ---- 物品組(R10,2026-10-09;PobTools regex_algo_pages.cpp ItemGroupOf / PlanMerge)----
// 一條搜尋字串只描述一種物品:合併只併「目前頁所屬物品組」的頁。裝備類頁(商店基底、商店物品條件、物品詞綴數值、
// 藥劑 / 護符詞綴)描述的是同一批物品 → 同組 `equipment`;section 歸宿主組;其餘頁自成一組(組名 = 頁 id)。

const EQUIPMENT_PAGES: readonly string[] = [
  'vendor_bases', 'vendor_items', 'vendor_items_poe2', 'item_mod_values', 'item_mod_values_poe2', 'flask_mods', 'flask_charm_mods'
]

/** 頁 → 物品組名 */
export function itemGroupOf (pageId: string): string {
  const host = numericKeyOf(pageId)
  return EQUIPMENT_PAGES.includes(host) ? 'equipment' : host
}

export interface MergePlan {
  /** 併入的頁 id(與目前頁同組,保留原順序) */
  merged: string[]
  /** 未併入的頁數(宿主與其 section 合算一頁) */
  skippedPages: number
}

/** 目前頁 `currentId` 時,有勾選的頁 `pickedIds`(合併順序)裡哪些併入合併輸出 */
export function planMerge (currentId: string, pickedIds: readonly string[]): MergePlan {
  const group = itemGroupOf(currentId)
  const merged: string[] = []
  const skipped = new Set<string>()
  for (const id of pickedIds) {
    if (itemGroupOf(id) === group) merged.push(id)
    else skipped.add(numericKeyOf(id))
  }
  return { merged, skippedPages: skipped.size }
}
