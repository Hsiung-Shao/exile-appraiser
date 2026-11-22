// exile-appraiser: 2026-11-18 自寫(使用者要求):傭兵契約書條件多時交易站會回「Query is too complex」,查詢前提醒。
// 門檻來自實測(交易站沒公開上限):匿名查詢 30 條以內可查、43 條被拒;
// 2026-11-22(GitHub issue #63)另量到 `mercenary` 型群組的條件合計 4 條可查、5 條就拒(停用的群組不算)。

/** 交易站匿名查詢大約能接受的條件數 */
export const QUERY_FILTER_LIMIT = 30
/** 匿名查詢時啟用的 `mercenary` 型群組條件合計上限(技能 + 勾的輔助,每個技能一組) */
export const MERCENARY_FILTER_LIMIT = 4

interface QueryLike { stats: Array<{ type?: string, disabled?: boolean, filters: unknown[] }> }

const enabled = (query: QueryLike, type?: string) =>
  query.stats.reduce((n, g) => n + (g.disabled || (type && g.type !== type) ? 0 : g.filters.length), 0)

/** 送出的查詢裡有啟用的群組共有幾條條件 */
export function countQueryFilters (query: QueryLike): number {
  return enabled(query)
}

/** 超過哪一個門檻(都沒超過 = null);傭兵的門檻先看,因為它小得多 */
export function queryComplexity (query: QueryLike): { kind: 'mercenary' | 'total', count: number, limit: number } | null {
  const merc = enabled(query, 'mercenary')
  if (merc > MERCENARY_FILTER_LIMIT) return { kind: 'mercenary', count: merc, limit: MERCENARY_FILTER_LIMIT }
  const total = enabled(query)
  return total > QUERY_FILTER_LIMIT ? { kind: 'total', count: total, limit: QUERY_FILTER_LIMIT } : null
}

export function isQueryTooComplex (query: QueryLike): boolean {
  return queryComplexity(query) !== null
}
