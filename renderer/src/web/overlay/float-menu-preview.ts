/**
 * 懸浮選單書籤字串預覽的模組層級快取(2026-10-15 效能修正):
 * 元件每次掛載(按熱鍵叫出)都清空的 reactive 快取會讓所有書籤重算 combine(約 2.6 ms / 筆,30 筆 ≈ 80 ms 長任務)。
 * 鍵 = 書籤內容(去掉 hotkey / folder 等不影響字串的欄位)的 JSON + 資料狀態標記;資料載入狀態改變 → 鍵變 → 自然失效。
 */
export interface PreviewBookmark { [k: string]: unknown }

/** 不影響輸出字串的欄位 */
const IGNORED = new Set(['hotkey', 'folder', 'name'])

/** 書籤 → 快取鍵(依鍵名排序,避免物件鍵順序不同產生不同鍵) */
export function previewCacheKey (b: PreviewBookmark, stateTag: string): string {
  const keys = Object.keys(b).filter(k => !IGNORED.has(k)).sort()
  const o: Record<string, unknown> = {}
  for (const k of keys) o[k] = b[k]
  return `${stateTag}\n${JSON.stringify(o)}`
}

export interface PreviewCache {
  /** 已算過的字串(沒有 = undefined),同步 */
  peek (index: number): string | undefined
  /** 取得字串:命中直接回,沒有才呼叫 compute;空字串結果也快取;同鍵計算中共用同一個 Promise */
  ensure (index: number): Promise<string>
  /** 目前這筆書籤的快取鍵(沒有書籤 = null) */
  keyOf (index: number): string | null
  readonly size: number
  clear (): void
}

export function createPreviewCache (opts: {
  bookmarkAt: (index: number) => PreviewBookmark | null | undefined
  /** 會影響輸出的資料載入狀態(例:物品詞綴數值頁是否載入) */
  stateTag: (b: PreviewBookmark) => string
  compute: (index: number) => Promise<string>
  limit?: number
}): PreviewCache {
  const limit = opts.limit ?? 200
  const map = new Map<string, string>()
  const inflight = new Map<string, Promise<string>>()
  const keyOf = (index: number): string | null => {
    const b = opts.bookmarkAt(index)
    return b ? previewCacheKey(b, opts.stateTag(b)) : null
  }
  return {
    peek (index) {
      const k = keyOf(index)
      return k === null ? undefined : map.get(k)
    },
    async ensure (index) {
      const k = keyOf(index)
      if (k !== null) {
        const hit = map.get(k)
        if (hit !== undefined) return hit
      }
      if (k !== null) {
        const pending = inflight.get(k)
        if (pending) return pending
      }
      const run = (async () => {
        const text = await opts.compute(index)
        // 算的過程可能載入了資料(狀態標記改變)→ 以算完後的鍵存
        const k2 = keyOf(index)
        if (k2 !== null) {
          if (map.size >= limit) map.clear()
          map.set(k2, text)
        }
        return text
      })()
      if (k === null) return run
      inflight.set(k, run)
      try { return await run } finally { if (inflight.get(k) === run) inflight.delete(k) }
    },
    keyOf,
    get size () { return map.size },
    clear () { map.clear() }
  }
}
