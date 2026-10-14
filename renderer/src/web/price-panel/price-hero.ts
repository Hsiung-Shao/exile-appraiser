/**
 * 2026-10-14 查價面板 B 改版:價格區(`PriceHero.vue` 通貨市價卡)與「你的這一疊」(`StackCard.vue`)的純邏輯
 * (只用相對路徑 import;renderer 的 node vitest 沒有別名)。
 * - 通貨:poe.ninja 兌換價(兩代 `trends/PriceTrend.vue` 算好)→ `rateSides`(1 X → N Y;可堆疊且不到 1 單位時反寫)。
 * - 一般物品的「建議售價」摘要使用者看過實機後移除(2026-10-14)。
 */
import { currencyIcon, type CurrencyIconKey } from './currency-icon'

export type Game = 'poe1' | 'poe2'

export interface Money {
  amount: number
  /** `chaos` / `div` / `exalted` 等顯示單位 */
  unit: string
}

/** 高價單位(神聖石 / 崇高石 / 鏡子):任何大小都保留一位小數(12.5 div 不取整成 13) */
const DECIMAL_UNITS = new Set(['div', 'divine', 'exalted', 'exa', 'mirror'])

/**
 * 金額顯示:< 1 取兩位有效、< 10 一位小數;10 以上 chaos(或沒給單位)取整,高價單位(`DECIMAL_UNITS`)保留一位小數;千分位。
 * (上游 `displayRounding` ≥ 10 一律取整,使用者 2026-10-14 要求高價單位保留小數)
 */
export function fmtAmount (n: number, unit?: string): string {
  const a = Math.abs(n)
  if (a > 0 && a < 1) return String(Number(n.toPrecision(2)))
  if (a < 10) return String(Number(n.toFixed(1)))
  if (unit != null && DECIMAL_UNITS.has(unit.toLowerCase())) {
    return Number(n.toFixed(1)).toLocaleString('en-US', { maximumFractionDigits: 1 })
  }
  return Math.round(n).toLocaleString('en-US')
}

const UNIT_ICON: Record<string, CurrencyIconKey> = {
  chaos: 'chaos',
  div: 'divine',
  divine: 'divine',
  exalted: 'exa',
  exa: 'exa',
  annul: 'annul'
}

/** 單位 / 幣別 id → 圖示(兩代分開,`currencyIcon`);不認得 → undefined(只顯示文字) */
export function unitIconFor (game: Game, unit: string): string | undefined {
  const key = UNIT_ICON[unit.toLowerCase()]
  return key ? currencyIcon(game, key) : undefined
}

/** 單位的短字(圖示旁 / 小字用) */
export function unitShort (unit: string): string {
  switch (unit) {
    case 'chaos': return 'c'
    case 'div':
    case 'divine': return 'div'
    case 'exalted': return 'ex'
    default: return unit
  }
}

/** 通貨兌換比的兩邊文字:一般「1 → 價格」;可堆疊(fraction)且不到 1 單位 → 「1 / 價格 → 1」 */
export function rateSides (rate: { min: number, max: number, currency: string }, fraction: boolean): { left: string, right: string } {
  if (fraction && rate.min > 0 && rate.max < 1) {
    return { left: fmtAmount(1 / rate.min), right: '1' }
  }
  const f = (v: number) => fmtAmount(v, rate.currency)
  const right = rate.min === rate.max ? f(rate.min) : `${f(rate.min)} ~ ${f(rate.max)}`
  return { left: '1', right }
}

/** 通貨模式(poe.ninja exchange 類)的資料;兩代 `trends/PriceTrend.vue` 組好傳給 PriceHero */
export interface MarketView {
  /** 上游 artificialSlowdown 還沒到(顯示讀取中) */
  loading: boolean
  itemIcon: string
  itemName: string
  /** 1 個物品的價格(autoCurrency 結果) */
  rate: { min: number, max: number, currency: string }
  /** 可堆疊(不到 1 單位時反寫 N X → 1 Y) */
  fraction: boolean
  change?: {
    forecast: 'up' | 'down' | 'const'
    text: string
    graph: { points: number[], drawMin: number, drawMax: number }
  } | null
  /** 每小時成交額(已格式化的數字 + 單位) */
  volumeValue?: { amount: string, unit: string }
  /** 每小時成交件數 */
  volumeItems?: { amount: string }
  /** 成交量最大的對手通貨 id */
  highest?: string
  /** 有價值的底材(上游 `isValuableBasetype`):市價卡標示「底材」(原本 ItemQuickPrice `#item` 插槽的 `:base_item`) */
  baseItem?: boolean
}

/** 「你的這一疊」:數量 × 單價 */
export interface StackView {
  have: { count: number, value: Money }
  oneStack?: { count: number, value: Money } | null
}
