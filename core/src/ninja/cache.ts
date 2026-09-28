/**
 * poe.ninja 價格表快照與快取介面。
 *
 * 快照只存查價要用的欄位(chaos、數量、低信心、detailsId、類別),不存圖示/走勢(體積)。
 * 儲存位置由呼叫端決定:
 * - Electron:main 的 IPC `ninja-cache-load/save` → `userData/cache/ninja/<game>_<league>.json`(tmp + rename;
 *   啟動時清掉 30 天以上沒動過的檔,同 PobTools `PruneNinjaCache`);
 * - 純瀏覽器 / 測試:`createMemoryNinjaCache()`。
 *
 * `schema` 要完全相符才採用:改了涵蓋範圍或單位時把數字 +1,舊快取一次全部失效
 * (否則 15 分鐘 TTL 會繼續供應修正前的價格表)。
 */
import type { NinjaFetchResult, NinjaGame } from './client'

export const NINJA_SNAPSHOT_SCHEMA = 1
export const NINJA_CACHE_TTL_MS = 15 * 60 * 1000
export const NINJA_CACHE_PRUNE_DAYS = 30

export interface NinjaSnapshotEntry {
  /** chaos 價 */
  c: number
  /** 數量(count / listingCount;exchange 為 0) */
  n: number
  /** 低信心 */
  lc: boolean
  /** ninja detailsId(詳細頁網址最後一段) */
  id?: string
  /** 來源類別(ninja 請求參數,如 `UniqueArmour`) */
  t: string
}

export interface NinjaSnapshot {
  schema: typeof NINJA_SNAPSHOT_SCHEMA
  game: NinjaGame
  league: string
  /** ms since epoch */
  fetchedAt: number
  /** 1 divine = 幾 chaos;取不到為 null */
  divineRate: number | null
  prices: Record<string, NinjaSnapshotEntry>
}

export interface NinjaCache {
  load: (game: NinjaGame, league: string) => Promise<NinjaSnapshot | null>
  save: (game: NinjaGame, league: string, snapshot: NinjaSnapshot) => Promise<void>
}

export function toSnapshot (result: NinjaFetchResult): NinjaSnapshot {
  const prices: Record<string, NinjaSnapshotEntry> = {}
  for (const [key, line] of result.prices) {
    const e: NinjaSnapshotEntry = { c: line.chaos, n: line.count, lc: line.lowConfidence, t: line.type }
    if (line.detailsId) e.id = line.detailsId
    prices[key] = e
  }
  return {
    schema: NINJA_SNAPSHOT_SCHEMA,
    game: result.game,
    league: result.league,
    fetchedAt: result.fetchedAt,
    divineRate: result.divineRate ?? null,
    prices
  }
}

export function isFresh (snapshot: Pick<NinjaSnapshot, 'fetchedAt'> | null | undefined, ttlMs = NINJA_CACHE_TTL_MS, now = Date.now()): boolean {
  if (!snapshot) return false
  const age = now - snapshot.fetchedAt
  return age >= 0 && age < ttlMs
}

/** 解析快取檔內容;schema / game / league 任一不符或格式壞掉 → null。 */
export function parseSnapshot (text: string | null | undefined, game: NinjaGame, league: string): NinjaSnapshot | null {
  if (!text) return null
  try {
    const doc = JSON.parse(text) as Partial<NinjaSnapshot>
    if (doc == null || typeof doc !== 'object') return null
    if (doc.schema !== NINJA_SNAPSHOT_SCHEMA || doc.game !== game || doc.league !== league) return null
    if (typeof doc.fetchedAt !== 'number' || doc.prices == null || typeof doc.prices !== 'object') return null
    const divineRate = typeof doc.divineRate === 'number' && doc.divineRate > 0 ? doc.divineRate : null
    if (!Object.keys(doc.prices).length) return null
    return { schema: NINJA_SNAPSHOT_SCHEMA, game, league, fetchedAt: doc.fetchedAt, divineRate, prices: doc.prices }
  } catch {
    return null
  }
}

/** 聯盟 id 當檔名:只留每種檔案系統都吃的字元(同 PobTools `SanitizeForFile`)。 */
export function ninjaCacheFileName (game: NinjaGame, league: string): string {
  const safe = league.replace(/[^A-Za-z0-9_-]/g, '_') || 'league'
  return `${game}_${safe}.json`
}

export function createMemoryNinjaCache (): NinjaCache & { readonly size: number } {
  const store = new Map<string, string>()
  return {
    async load (game, league) {
      return parseSnapshot(store.get(ninjaCacheFileName(game, league)), game, league)
    },
    async save (game, league, snapshot) {
      store.set(ninjaCacheFileName(game, league), JSON.stringify(snapshot))
    },
    get size () { return store.size }
  }
}
