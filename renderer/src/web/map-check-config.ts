/**
 * 2026-11-18 PoE1 地圖詞綴檢查(移植 APT map-check,MIT)的設定:`AppConfig().mapCheck`。
 * 形狀同 `poe1/…/map-check/common.ts` 的 `MapCheckConfig`(這裡不 import poe1:Config.ts 要能在 node 測試直接載入)。
 * 標記鍵是 stat `ref`;`decision` 三格 = 三組設定檔(`-` 未標、`d` 危險、`w` 警告、`g` 好、`s` 已看過)。
 */
export interface MapCheckSettings {
  profile: number
  showNewStats: boolean
  selectedStats: Array<{ ref: string, decision: string }>
}

/** APT 預設的四條(上游以英文比對字串為鍵,這四條的字串正好就是 ref) */
export const MAP_CHECK_DEFAULT_STATS: ReadonlyArray<{ ref: string, decision: string }> = [
  { ref: 'Players have #% to all maximum Resistances', decision: 'w--' },
  { ref: 'Monsters reflect #% of Physical Damage', decision: 'd--' },
  { ref: 'Monsters reflect #% of Elemental Damage', decision: 'd--' },
  { ref: 'Area contains two Unique Bosses', decision: 'g--' }
]

const DECISION = /^[-dwgs]{3}$/

/** 讀設定檔:沒有 / 壞值 → 預設;壞的標記丟掉、同 ref 只留第一筆 */
export function normMapCheck (raw: unknown): MapCheckSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const profile = o.profile === 2 || o.profile === 3 ? o.profile : 1
  const list = Array.isArray(o.selectedStats) ? o.selectedStats : null
  const seen = new Set<string>()
  const selectedStats = list
    ? list.flatMap((s): Array<{ ref: string, decision: string }> => {
      const e = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
      if (typeof e.ref !== 'string' || !e.ref || typeof e.decision !== 'string' || !DECISION.test(e.decision) || seen.has(e.ref)) return []
      seen.add(e.ref)
      return [{ ref: e.ref, decision: e.decision }]
    })
    : MAP_CHECK_DEFAULT_STATS.map(s => ({ ...s }))
  return { profile, showNewStats: o.showNewStats === true, selectedStats }
}
