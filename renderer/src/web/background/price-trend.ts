/**
 * 第 24 步:查價面板「通貨價格區」(PoE1 `poe1/…/trends/PriceTrend.vue`、PoE2 `poe2/…/trends/PriceTrend.vue`)的純函式。
 * 只 import 型別(renderer vitest 沒有別名;`renderer/test/price-trend.test.ts` 測)。
 *
 * - `priceHitFields`:快照命中 → 走勢 / 成交量欄位(`Prices.ts` `findPriceByQuery` 用);
 * - `toPoe2Entry`:chaos 計價命中 → 上游 EE2 `findPriceByQuery` 形狀(divine 計價;`poe2-price-source.ts` 用);
 * - `volumeParts`:「通貨每小時成交量」設定 → 要顯示哪幾個;
 * - `coreCurrencyIcon`:通貨 id → 圖示(與 EE2 `CoreCurrencyImg.vue` 同一張對照);
 * - `sparklineGeometry`:走勢圖(手繪 SVG,不用 apexcharts)的折線 / 面積路徑。
 */
import type { NinjaSnapshotEntry } from '@exile-appraiser/core/ninja'

export interface PriceTrendFields {
  /** 7 天走勢(每天相對 7 天前的漲跌 %;APT 欄位名 `graph`);快照沒有 → [] */
  graph: Array<number | null>
  /** 走勢 totalChange(%) */
  graphChange?: number
  /** 來自 poe.ninja exchange 類(鍵 `currency|` / `card|`) */
  exchange: boolean
  /** 每小時成交量(chaos 單位;只有 exchange 類) */
  volumeChaos?: number
  /** 成交量最大的對手通貨 id */
  maxVolumeCurrency?: string
}

export function priceHitFields (key: string, entry: NinjaSnapshotEntry): PriceTrendFields {
  const out: PriceTrendFields = {
    graph: Array.isArray(entry.s) ? [...entry.s] : [],
    exchange: key.startsWith('currency|') || key.startsWith('card|')
  }
  if (typeof entry.sc === 'number' && Number.isFinite(entry.sc)) out.graphChange = entry.sc
  if (typeof entry.v === 'number' && Number.isFinite(entry.v) && entry.v >= 0) out.volumeChaos = entry.v
  if (typeof entry.mv === 'string' && entry.mv) out.maxVolumeCurrency = entry.mv
  return out
}

/** EE2 `findPriceByQuery` 的回傳形狀(與 `poe2/src/web/background/Prices.ts` 的 `PriceSourceEntry` 相同) */
export interface Poe2PriceEntry {
  primaryValue: number
  volumePrimaryValue?: number
  maxVolumeCurrency?: string
  sparkline: { totalChange: number, data: Array<number | null> }
  detailsId: string
  url: string
  cx: boolean
}

/** chaos 計價命中 → divine 計價(EE2 單位)。沒有 divine 匯率 → null(上游元件都以 divine 運算)。 */
export function toPoe2Entry (
  hit: { chaos: number, url: string, detailsId: string } & PriceTrendFields,
  divineRate: number | undefined
): Poe2PriceEntry | null {
  if (!divineRate || !(divineRate > 0) || !(hit.chaos > 0)) return null
  const e: Poe2PriceEntry = {
    primaryValue: hit.chaos / divineRate,
    sparkline: { totalChange: hit.graphChange ?? 0, data: hit.graph },
    detailsId: hit.detailsId,
    url: hit.url,
    cx: hit.exchange
  }
  // 上游 PriceTrend 以 `'volumePrimaryValue' in entry` 判斷要不要顯示成交量 → 沒有就不帶這個鍵
  if (hit.volumeChaos !== undefined) e.volumePrimaryValue = hit.volumeChaos / divineRate
  if (hit.maxVolumeCurrency) e.maxVolumeCurrency = hit.maxVolumeCurrency
  return e
}

/** 設定 `priceCheck.currencyVolume`(值與 EE2 相同) */
export type CurrencyVolumeSetting = 'none' | 'value' | 'item' | 'both'

export function volumeParts (setting: CurrencyVolumeSetting | undefined): { value: boolean, item: boolean } {
  return {
    value: setting === 'value' || setting === 'both',
    item: setting === 'item' || setting === 'both'
  }
}

/** EE2 `CoreCurrencyImg.vue`:依 id 第一個字母 d / c / e / a 對到圖示,其他 404 */
export function coreCurrencyIcon (currency: string): string {
  switch (currency.toLowerCase().charAt(0)) {
    case 'd': return '/images/divine.png'
    case 'c': return '/images/chaos.png'
    case 'e': return '/images/exa.png'
    case 'a': return '/images/annul.png'
    default: return '/images/404.png'
  }
}

/**
 * 走勢圖路徑(viewBox 0 0 w h)。照上游 apexcharts 的設定:y 軸 [drawMin, drawMax](上大下小)、
 * 面積填到底(`fillTo: 'end'`)。點數 < 2 或範圍為 0 → null。
 */
export function sparklineGeometry (
  points: number[], drawMin: number, drawMax: number, w: number, h: number
): { line: string, area: string } | null {
  if (points.length < 2 || !(drawMax > drawMin)) return null
  const fmt = (n: number) => String(Math.round(n * 100) / 100)
  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w
    const y = h - ((p - drawMin) / (drawMax - drawMin)) * h
    return [fmt(x), fmt(Math.min(h, Math.max(0, y)))]
  })
  const line = 'M' + xy.map(([x, y]) => x + ' ' + y).join(' L')
  const area = line + ' L' + fmt(w) + ' ' + fmt(h) + ' L0 ' + fmt(h) + ' Z'
  return { line, area }
}
