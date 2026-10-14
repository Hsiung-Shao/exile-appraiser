/**
 * 倉庫價值(2026-10-15)的共用狀態:`StashPrices.vue` 依 main 讀到的每格數量算好整頁價值後寫進來,懸浮選單「倉庫本頁價值」列讀它。
 * 疊層收起 / 沒有數量(關閉讀數量)/ 不是 PoE1 → null(選單顯示佔位)。
 */
import { shallowRef } from 'vue'
import type { StashSubtab } from '../../../../core/src/stash/layout'

export interface StashValueState {
  subtab: StashSubtab
  /** Σ 單價 × 數量(混沌石) */
  totalChaos: number
  /** 1 神聖石 = 幾混沌石(poe.ninja;沒有 = undefined) */
  divineRate: number | undefined
  /** 讀到數量的格數 */
  known: number
  /** 數量讀不到的格數(不計入總價) */
  unknown: number
}

export const stashValue = shallowRef<StashValueState | null>(null)

/** 總價文字:混沌石整數 + 千分位;≈ 神聖石一位小數(沒有匯率 = null) */
export function stashValueText (v: { totalChaos: number, divineRate: number | undefined }): { chaos: string, div: string | null } {
  const chaos = Math.round(v.totalChaos).toLocaleString('en-US')
  const div = v.divineRate && v.divineRate > 0 ? (v.totalChaos / v.divineRate).toFixed(1) : null
  return { chaos, div }
}
