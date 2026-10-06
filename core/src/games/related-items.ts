/**
 * 查價面板旁的「相關物品」(APT / EE2 `price-check/related-items/RelatedItems.vue` 的 `getItemPrices`)。
 *
 * `item-drop.json` 每筆 = `query`(同一組的物品,例如四張 Sacrifice 碎片)+ `items`(這組能換 / 能掉的物品);
 * 查價物品的 poe.ninja 鍵(`ns::refName[ // variant]`)出現在某組 `query` 裡,就列出整組 + 各自的 ninja 價格。
 *
 * 純函式、依賴注入:PoE1(APT,價格 chaos)與 PoE2(EE2,價格 divine)各自傳入自己的資料查詢與換算。
 * 與上游的差異:id 找不到物品時上游整塊改成英文錯誤字串 `Can't find "…"`,這裡改成略過那一筆並回報 `missing`。
 */

export interface RelatedDropEntry {
  query: string[]
  items: string[]
}

export interface RelatedItemBase {
  name: string
  icon: string
  namespace: string
  unique?: { base: string }
}

export interface RelatedQuery {
  ns: string
  name: string
  variant?: string
}

export interface RelatedDeps<P> {
  drops: readonly RelatedDropEntry[]
  itemByRef: (ns: string, name: string) => readonly RelatedItemBase[] | undefined
  /** 沒有價格 → undefined(畫面顯示「?」) */
  priceOf: (query: RelatedQuery) => P | undefined
}

export interface RelatedEntry<P> {
  id: string
  name: string
  icon: string
  price?: P
}

export interface RelatedResult<P> {
  related: Array<RelatedEntry<P> & { highlight: boolean }>
  items: Array<RelatedEntry<P>>
  /** item-drop.json 裡有、物品資料找不到的 id(資料版本不一致時) */
  missing: string[]
}

/** `getDetailsId` 的結果 → `item-drop.json` 用的 id(上游 RelatedItems.vue setup 的組法) */
export function relatedQueryId (q: { ns: string, name: string, variant?: string | null }): string {
  return `${q.ns}::${q.name}${q.variant ? ` // ${q.variant}` : ''}`
}

export function parseRelatedId (id: string): RelatedQuery {
  const [ns, encodedName = ''] = id.split('::')
  const [name, variant] = encodedName.split(' // ')
  return { ns, name, variant }
}

/** 上游 `findItemByQueryId`:傳奇有 variant(底材)時優先挑底材相同的那件 */
export function findRelatedItem (itemByRef: RelatedDeps<unknown>['itemByRef'], id: string): RelatedItemBase | undefined {
  const { ns, name, variant } = parseRelatedId(id)
  let found = itemByRef(ns, name)
  if (found && ns === 'UNIQUE') {
    const filtered = found.filter(unique => unique.unique?.base === variant)
    if (filtered.length) found = filtered
  }
  return found?.[0]
}

/** 上游 `getItemPrices`;這件物品不在任何一組 → null */
export function relatedItemPrices<P> (deps: RelatedDeps<P>, queryId: string): RelatedResult<P> | null {
  const dropEntry = deps.drops.find(entry => entry.query.includes(queryId))
  if (!dropEntry) return null

  const out: RelatedResult<P> = { related: [], items: [], missing: [] }
  const entry = (id: string): RelatedEntry<P> | undefined => {
    const dbItem = findRelatedItem(deps.itemByRef, id)
    if (!dbItem) { out.missing.push(id); return undefined }
    return { id, name: dbItem.name, icon: dbItem.icon, price: deps.priceOf(parseRelatedId(id)) }
  }
  for (const id of dropEntry.query) {
    const e = entry(id)
    if (e) out.related.push({ ...e, highlight: id === queryId })
  }
  for (const id of dropEntry.items) {
    const e = entry(id)
    if (e) out.items.push(e)
  }
  return out
}
