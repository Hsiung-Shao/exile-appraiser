/**
 * 2026-10-15 懸浮選單 A 版「市況」列:神聖石匯率 + 7 天走勢,**只讀 poe.ninja 既有快照**(`usePoeninja().snapshot`),
 * 不觸發上網(不呼叫 `queuePricesFetch`,維持第 30.8 步閒置降耗;使用者裁定)。
 *
 * - PoE1:`1 div = divineRate c`,走勢取 `currency|Divine Orb` 列(以混沌石計價的漲跌 %)。
 * - PoE2:`1 div = divineRate / exaltedRate ex`(兩個都是「幾 chaos」);poe.ninja PoE2 以神聖石為主幣,
 *   Divine Orb 列的走勢是對混沌石,不是對崇高石 → 改取 `currency|Exalted Orb` 列(崇高石以神聖石計價的漲跌 %)
 *   逐點反算:崇高石漲 p% ⇔ 神聖石以崇高石計 `1 / (1 + p/100) − 1`(`invertChange`)。
 * - 沒快照 / 沒目標(台服、私人聯盟、還沒選聯盟)/ 快照是別的遊戲或聯盟 → null(畫面「尚無資料」)。
 *
 * 純函式(只 import 型別),`renderer/test/float-menu-items.test.ts` 測(F4–F6)。
 */
import type { NinjaGame, NinjaSnapshot } from '@exile-appraiser/core/ninja'

export interface MarketRate {
  game: NinjaGame
  /** 計價通貨:PoE1 混沌石、PoE2 崇高石 */
  to: 'chaos' | 'exa'
  /** 1 神聖石 = 幾 `to` */
  rate: number
  /** 顯示用數字(≥ 100 取整數,其他 1 位小數) */
  text: string
  /** 7 天走勢(漲跌 %;沒有 → []) */
  points: number[]
  /** 7 天漲跌 %(沒有走勢 → null) */
  change: number | null
  tone: 'up' | 'down' | 'const'
  /** 走勢圖 y 範圍(同查價面板 PriceTrend 的 deltaFromGraph:上下各留一個標準差,0 時留 1) */
  drawMin: number
  drawMax: number
}

/** 以 A 計的 B 漲 p% → 以 B 計的 A 漲跌 %(百分比) */
export function invertChange (p: number): number {
  if (p === 0) return 0
  return (1 / (1 + p / 100) - 1) * 100
}

function rateText (n: number): string {
  return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)
}

export function marketRateOf (snap: NinjaSnapshot | null, target: { game: NinjaGame, league: string } | null): MarketRate | null {
  if (!snap || !target || snap.game !== target.game || snap.league !== target.league) return null
  const divine = snap.divineRate
  if (!divine || !(divine > 0)) return null

  let rate: number
  let raw: ReadonlyArray<number | null> | undefined
  let rawChange: number | undefined
  let invert = false
  if (snap.game === 'poe2') {
    const ex = snap.exaltedRate
    if (!ex || !(ex > 0)) return null
    rate = divine / ex
    const row = snap.prices['currency|Exalted Orb']
    raw = row?.s
    rawChange = row?.sc
    invert = true
  } else {
    rate = divine
    const row = snap.prices['currency|Divine Orb']
    raw = row?.s
    rawChange = row?.sc
  }

  const conv = (p: number) => invert ? invertChange(p) : p
  const points = (raw ?? []).filter((p): p is number => typeof p === 'number' && Number.isFinite(p)).map(conv)
  let change: number | null = null
  if (points.length >= 2) change = typeof rawChange === 'number' && Number.isFinite(rawChange) ? conv(rawChange) : points[points.length - 1]
  const tone = change == null || change === 0 ? 'const' : change > 0 ? 'up' : 'down'

  let drawMin = 0
  let drawMax = 0
  if (points.length >= 2) {
    const mean = points.reduce((a, b) => a + b, 0) / points.length
    const sd = Math.sqrt(points.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / (points.length - 1))
    drawMin = Math.min(...points) - (sd || 1)
    drawMax = Math.max(...points) + (sd || 1)
  }
  return {
    game: snap.game,
    to: snap.game === 'poe2' ? 'exa' : 'chaos',
    rate,
    text: rateText(rate),
    points: points.length >= 2 ? points : [],
    change,
    tone,
    drawMin,
    drawMax
  }
}
