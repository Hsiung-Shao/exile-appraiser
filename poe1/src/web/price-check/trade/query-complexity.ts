// exile-appraiser: 2026-11-18 自寫(使用者要求):傭兵契約書條件多時交易站會回「Query is too complex」,查詢前提醒。
// 門檻來自實測(pathofexile-trade.ts 傭兵段註解):匿名查詢 30 條以內可查、43 條被拒;真正的上限交易站沒公開。

/** 交易站匿名查詢大約能接受的條件數 */
export const QUERY_FILTER_LIMIT = 30

interface QueryLike { stats: Array<{ disabled?: boolean, filters: unknown[] }> }

/** 送出的查詢裡有啟用的群組共有幾條條件 */
export function countQueryFilters (query: QueryLike): number {
  return query.stats.reduce((n, g) => n + (g.disabled ? 0 : g.filters.length), 0)
}

export function isQueryTooComplex (query: QueryLike): boolean {
  return countQueryFilters(query) > QUERY_FILTER_LIMIT
}
