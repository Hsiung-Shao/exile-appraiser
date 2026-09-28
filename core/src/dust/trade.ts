/**
 * 拆粉排行「交易站 ↗」的查詢本體(PoE1 `/trade/search` 的 `?q=` JSON)。組網址由 `@exile-appraiser/poe1` 的
 * `webSearchUrl(realm, league, request)` 負責(有 encode);這裡只組 query,純函式可測。
 * 名稱與基底:國際服送英文(refName / unique.base),台服送繁中(呼叫端決定傳哪個)。
 */

export type DustCorruptedOption = 'any' | 'true' | 'false'
/** 交易站「掛單時間」選項值(與官網 `indexed` 相同);'any' = 不限 */
export type DustIndexedOption = 'any' | '1hour' | '3hours' | '12hours' | '1day' | '3days' | '1week' | '2weeks' | '1month' | '2months'
export const DUST_INDEXED_OPTIONS: readonly DustIndexedOption[] = ['any', '1day', '3days', '1week', '2weeks', '1month', '2months']

export interface DustTradeQueryOptions {
  name: string
  type: string
  /** 物品等級下限(undefined / 0 = 不限) */
  ilvlMin?: number
  corrupted?: DustCorruptedOption
  indexed?: DustIndexedOption
}

export interface DustTradeRequest {
  query: {
    status: { option: 'available' }
    name: string
    type: string
    stats: Array<{ type: 'and', filters: [] }>
    filters: {
      misc_filters?: { filters: { ilvl?: { min: number }, corrupted?: { option: 'true' | 'false' } } }
      trade_filters?: { filters: { indexed: { option: string } } }
    }
  }
  sort: { price: 'asc' }
}

export function dustTradeRequest (o: DustTradeQueryOptions): DustTradeRequest {
  const req: DustTradeRequest = {
    query: {
      status: { option: 'available' },
      name: o.name,
      type: o.type,
      stats: [{ type: 'and', filters: [] }],
      filters: {}
    },
    sort: { price: 'asc' }
  }
  const misc: { ilvl?: { min: number }, corrupted?: { option: 'true' | 'false' } } = {}
  if (o.ilvlMin && o.ilvlMin > 0) misc.ilvl = { min: Math.trunc(o.ilvlMin) }
  if (o.corrupted === 'true' || o.corrupted === 'false') misc.corrupted = { option: o.corrupted }
  if (Object.keys(misc).length) req.query.filters.misc_filters = { filters: misc }
  const indexed = o.indexed ?? '1week'
  if (indexed !== 'any') req.query.filters.trade_filters = { filters: { indexed: { option: indexed } } }
  return req
}
