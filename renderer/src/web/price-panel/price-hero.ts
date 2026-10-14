/**
 * 2026-10-14 查價面板 B 改版:價格區(`PriceHero.vue`)的純邏輯(只用相對路徑 import;renderer 的 node vitest 沒有別名)。
 *
 * - 一般物品:交易站搜尋結果(兩代 `TradeListing` 的 `groupedResults` / `list`)→ `buildItemHero`:
 *   前 `HERO_TAKE` 筆換成同一基準單位(PoE1 chaos、PoE2 divine;換算器由各遊戲 `price-check/price-hero-adapter.ts` 給)
 *   → core `summarizeConverted`(與符文塑形自動查市集同一套中位數規則)→ 建議售價 = 中位(不到 3 筆退回最低,標「少」)。
 *   沒有匯率(台服 / 沒有 poe.ninja)→ 用筆數最多的原幣別。
 * - 通貨:poe.ninja 兌換價(兩代 `trends/PriceTrend.vue` 算好)→ `rateSides`(1 X → N Y;可堆疊且不到 1 單位時反寫)。
 */
import { summarizeConverted } from '../../../../core/src/price/summary'
import { currencyIcon, type CurrencyIconKey } from './currency-icon'

/** 一般物品價格區取前幾筆掛單(掛單已由便宜到貴;與符文塑形 `RUNE_TRADE_TAKE` 相同) */
export const HERO_TAKE = 10

export type Game = 'poe1' | 'poe2'

export interface Money {
  amount: number
  /** `chaos` / `div` / `exalted`(換算後的顯示單位)或交易站原幣別 id(沒有匯率時) */
  unit: string
}

export interface ItemHeroView {
  state: 'loading' | 'empty' | 'ready'
  suggested?: Money
  min?: Money
  median?: Money
  /** 符合筆數(不精確加 +) */
  total: string
  /** 參與計算的筆數 < 3 */
  few: boolean
  /** true = 已換算成同一單位;false = 原幣別(沒有匯率) */
  converted: boolean
}

export function formatTotal (total: number | undefined, inexact: boolean): string {
  if (total == null) return ''
  return inexact ? `${total}+` : String(total)
}

export function fmtAmount (n: number): string {
  const a = Math.abs(n)
  if (a > 0 && a < 1) return String(Number(n.toPrecision(2)))
  if (a < 10) return String(Number(n.toFixed(1)))
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
  const right = rate.min === rate.max ? fmtAmount(rate.min) : `${fmtAmount(rate.min)} ~ ${fmtAmount(rate.max)}`
  return { left: '1', right }
}

export function buildItemHero (o: {
  listings: ReadonlyArray<{ priceAmount: number, priceCurrency: string } | undefined | null>
  total: number | undefined
  inexact?: boolean
  /** 交易結果的 `list`(searchResult)回來了沒 */
  ready: boolean
  /** 原幣 → 基準單位;沒有匯率不給 */
  toBase?: (amount: number, currency: string) => number | undefined
  /** 基準單位 → 顯示(autoCurrency) */
  show: (base: number) => Money
  take?: number
}): ItemHeroView {
  const total = formatTotal(o.total, Boolean(o.inexact))
  if (!o.ready) return { state: 'loading', total, few: false, converted: false }
  if (o.total === 0) return { state: 'empty', total, few: false, converted: false }
  const listings = o.listings
    .filter((l): l is { priceAmount: number, priceCurrency: string } => l != null)
    .map(l => ({ amount: l.priceAmount, currency: l.priceCurrency }))
  if (!listings.length) return { state: 'loading', total, few: false, converted: false }

  const s = summarizeConverted(listings, o.toBase, { unit: 'base', take: o.take ?? HERO_TAKE })
  if (!s.count || s.min == null) return { state: 'empty', total, few: false, converted: s.converted }
  const money = (v: number): Money => s.converted ? o.show(v) : { amount: v, unit: s.unit }
  const view: ItemHeroView = {
    state: 'ready',
    converted: s.converted,
    few: s.few,
    total,
    suggested: money(s.median ?? s.min),
    min: money(s.min)
  }
  if (s.median != null) view.median = money(s.median)
  return view
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
}

/** 「你的這一疊」:數量 × 單價 */
export interface StackView {
  have: { count: number, value: Money }
  oneStack?: { count: number, value: Money } | null
}
