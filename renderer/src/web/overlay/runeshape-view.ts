/**
 * exile-appraiser(WP-R2):符文塑形自動查價徽章的純邏輯(`RuneshapePrices.vue` 用;`renderer/test/runeshape-prices.test.ts` 測)。
 * - 座標:掃描列(client 實體像素)× 視窗 CSS 大小 / client 大小(與揭露面板徽章相同,見 ocr-reveal.ts `layoutBadges`)。
 * - 計價:預設崇高石;≥ 1 神聖石改神聖石;沒有匯率時退回混沌石。數量 > 1 → 總價 + 單價。
 * - 顏色:以**總價**(崇高石)分三段:< low 暗、≥ high 金、之間一般(門檻在設定)。
 * - 自動查市集(docs/runeshape.md「自動查市集」):無 ninja 價且可查的列帶 `tradeKey`(RuneshapePrices.vue 排進佇列);
 *   市價換算 / 徽章文字(`runeTradeBadge`,含篩選短字 `runeTradeShortFilter`)在這裡。徽章不可點(平常點擊穿透)。
 * - 「未發現」列(尚未解鎖的配方)不畫徽章。
 * 只做型別匯入 + vue 的 shallowRef(renderer vitest 沒有別名)。
 */
import { shallowRef } from 'vue'
import type { RuneshapeScanEvent, RuneshapeTimings } from '@ipc/types'
import type { Poe2RuneTradeEntry, Poe2RuneTradeFilter, Poe2RuneTradeSummary } from '@poe2-entry'
import type { PriceOfResult } from '../background/price-of'
import { displayOcrText } from '../ocr-lang'
import { BADGE_GAP_PX } from './ocr-reveal'

/** 最近一次掃描事件的耗時(設定頁「最近耗時」顯示;main 另有 `runeshape-stats` 平均) */
export const runeshapeLastTimings = shallowRef<{ at: number, timings: RuneshapeTimings, rows: number } | null>(null)

export function recordScanTimings (e: Pick<RuneshapeScanEvent, 'ts' | 'timings' | 'rows'>): void {
  if (e.timings) runeshapeLastTimings.value = { at: e.ts, timings: e.timings, rows: e.rows.length }
}

export interface RuneThresholds { low: number, high: number }

export type PriceUnit = 'ex' | 'div' | 'c'
export type PriceTier = 'low' | 'mid' | 'high'

/** 0.05 → 0.05、1.25 → 1.3、12.4 → 12(與 Prices.ts `displayRounding` 同精神,但 < 0.1 保留兩位) */
export function formatAmount (v: number): string {
  if (!Number.isFinite(v)) return '?'
  const a = Math.abs(v)
  if (a === 0) return '0'
  if (a < 0.1) return String(Number(v.toFixed(2)))
  if (a < 10) return String(Number(v.toFixed(1)))
  return String(Math.round(v))
}

/** 挑單位:≥ 1 神聖石 → div;否則有 exalted 匯率 → ex;都沒有 → c */
export function pickUnit (chaos: number, rates: { exalted?: number, divine?: number }): { value: number, unit: PriceUnit } {
  if (rates.divine && rates.divine > 0 && chaos / rates.divine >= 1) return { value: chaos / rates.divine, unit: 'div' }
  if (rates.exalted && rates.exalted > 0) return { value: chaos / rates.exalted, unit: 'ex' }
  return { value: chaos, unit: 'c' }
}

export function priceTier (totalEx: number | undefined, th: RuneThresholds): PriceTier {
  if (totalEx == null) return 'mid'
  if (totalEx < th.low) return 'low'
  if (totalEx >= th.high) return 'high'
  return 'mid'
}

/** 對接後的一列(與 `Poe2RuneshapeMatchRow` 相容的子集) */
export interface MatchedRow {
  text: string
  x: number
  y: number
  w: number
  h: number
  refName?: string
  level?: number
  quantity: number
  match: 'exact' | 'fuzzy' | null
  /** 重名無法唯一決定的候選(有值時沒有 refName) */
  ambiguous?: string[]
  /** `gem` = 技能 / 輔助寶石,poe.ninja 沒有價格 → 直接「無價格」;`recipe` = 配方結果泛稱(維里西姆堆、傳奇胸甲…)→「無固定價格」 */
  unpriced?: 'gem' | 'recipe'
  /** 不在面板上(面板標題等)→ 不畫徽章 */
  offPanel?: boolean
  /** 面板上尚未解鎖的配方(「未發現」)→ 不畫徽章 */
  undiscovered?: boolean
  /** 列類型(查交易站決定篩選) */
  kind?: 'gem' | 'skill' | 'support' | 'item' | 'recipe'
  /** 目前語系名稱(台服查詢用、卡片標題) */
  name?: string
  tradeTag?: string
}

export interface RuneBadgeView {
  key: string
  left: number
  top: number
  kind: 'price' | 'loading' | 'no-price' | 'unmatched'
  /** kind = price:總價 */
  total?: { value: string, unit: PriceUnit }
  /** 數量 > 1 時的單價 */
  each?: { value: string, unit: PriceUnit }
  quantity: number
  tier: PriceTier
  lowConfidence: boolean
  /** 名稱是模糊命中(UI 標「≈」) */
  approx: boolean
  /**
   * kind = no-price 的原因:`gem` = poe.ninja 沒有技能寶石價格;`not-listed` = 價格表裡沒有這個物品;
   * `recipe` = 配方結果是泛稱(隨機 / 某部位傳奇),本來就沒有單一價格(UI「無固定價格」,與「無價格」不同色);
   * `no-source` = 台服,poe.ninja 沒有台服價格
   */
  noPrice?: 'gem' | 'not-listed' | 'recipe' | 'no-source'
  /** 自動查交易站(無 ninja 價且列可查)→ 查詢計畫的快取鍵 */
  tradeKey?: string
  /** 列在 rows 裡的索引(排入佇列時找回原列) */
  rowIndex: number
  /** 對不上時的 OCR 原文(去空白) */
  raw?: string
  /** 重名候選(對不上的原因之一) */
  candidates?: string[]
  refName?: string
}

export function layoutRunePrices (
  rows: readonly MatchedRow[],
  priceOf: (refName: string, level?: number) => PriceOfResult,
  client: { w: number, h: number },
  viewport: { w: number, h: number },
  th: RuneThresholds,
  /** 自動查市集:可查的列 → 查詢計畫快取鍵(不給 = 不查) */
  tradeKeyOf?: (row: MatchedRow) => string | undefined
): RuneBadgeView[] {
  const sx = client.w > 0 ? viewport.w / client.w : 1
  const sy = client.h > 0 ? viewport.h / client.h : 1
  const out: RuneBadgeView[] = []
  rows.forEach((r, i) => {
    // 面板外的列、「未發現」(尚未解鎖的配方)不畫徽章
    if (r.offPanel || r.undiscovered) return
    const v = layoutRow(r, i)
    // 只有「沒有 ninja 價」的列查市集(配方泛稱本來就沒有單一市價,不查)
    if (v.kind === 'no-price' && v.noPrice !== 'recipe' && tradeKeyOf) {
      const k = tradeKeyOf(r)
      if (k) v.tradeKey = k
    }
    out.push(v)
  })
  return out

  function layoutRow (r: MatchedRow, i: number): RuneBadgeView {
    const base = {
      key: `${i}:${Math.round(r.y)}`,
      rowIndex: i,
      left: Math.round((r.x + r.w) * sx + BADGE_GAP_PX),
      top: Math.round((r.y + r.h / 2) * sy),
      quantity: r.quantity,
      lowConfidence: false,
      approx: r.match === 'fuzzy',
      refName: r.refName
    }
    if (!r.refName) {
      const v: RuneBadgeView = { ...base, kind: 'unmatched', tier: 'low', raw: displayOcrText(r.text) }
      if (r.ambiguous?.length) v.candidates = r.ambiguous
      return v
    }
    // 技能 / 輔助寶石:poe.ninja PoE2 沒有這類價格 → 不查、直接「無價格」
    if (r.unpriced === 'gem') return { ...base, kind: 'no-price', tier: 'low', noPrice: 'gem' }
    // 配方結果泛稱:沒有單一價格 → 不查、直接「無固定價格」
    if (r.unpriced === 'recipe') return { ...base, kind: 'no-price', tier: 'low', noPrice: 'recipe' }
    const p = priceOf(r.refName, r.level)
    if (p.status === 'loading') return { ...base, kind: 'loading' as const, tier: 'mid' as const }
    if (p.status === 'no-source') return { ...base, kind: 'no-price' as const, tier: 'low' as const, noPrice: 'no-source' as const }
    if (p.status !== 'ok') return { ...base, kind: 'no-price' as const, tier: 'low' as const, noPrice: 'not-listed' as const }
    const qty = Math.max(1, r.quantity)
    const rates = { exalted: p.exalted != null ? p.chaos / p.exalted : undefined, divine: p.divine != null ? p.chaos / p.divine : undefined }
    const total = pickUnit(p.chaos * qty, rates)
    const view: RuneBadgeView = {
      ...base,
      kind: 'price',
      total: { value: formatAmount(total.value), unit: total.unit },
      tier: priceTier(p.exalted != null ? p.exalted * qty : undefined, th),
      lowConfidence: p.lowConfidence
    }
    if (qty > 1) {
      const each = pickUnit(p.chaos, rates)
      view.each = { value: formatAmount(each.value), unit: each.unit }
    }
    return view
  }
}

// ---------------- 自動查市集(docs/runeshape.md「自動查市集」) ----------------

/**
 * 查價面板 / 設定開著(App.vue 寫)→ 自動查市集佇列暫停,把限流額度留給一般查價。
 * null = 沒有;有值 = 暫停原因(寫進 log)。
 */
export const runeshapeTradeHold = shallowRef<string | null>(null)

/** poe.ninja 匯率:1 崇高石 / 1 神聖石 = 幾混沌石 */
export interface ChaosRates { exalted?: number, divine?: number }

/**
 * 掛單幣別 → 崇高石(國際服有 poe.ninja 匯率時用;台服不給 → 原幣顯示)。
 * 崇高石本身不用匯率;神聖石 / 混沌石要匯率;其他幣別不換算(`summarizeRuneTrade` 記為 skipped)。
 */
export function runeTradeToExalted (rates: ChaosRates): (amount: number, currency: string) => number | undefined {
  const ex = rates.exalted != null && rates.exalted > 0 ? rates.exalted : undefined
  const div = rates.divine != null && rates.divine > 0 ? rates.divine : undefined
  return (amount, currency) => {
    if (currency === 'exalted') return amount
    if (!ex) return undefined
    if (currency === 'divine') return div ? amount * div / ex : undefined
    if (currency === 'chaos') return amount / ex
    return undefined
  }
}

const TRADE_CURRENCY_UNIT: Record<string, PriceUnit> = { exalted: 'ex', divine: 'div', chaos: 'c' }
/** 交易站幣別 id → 徽章單位(認不得 = undefined,UI 顯示原 id) */
export function tradeCurrencyUnit (currency: string): PriceUnit | undefined {
  return TRADE_CURRENCY_UNIT[currency]
}

export interface RuneTradeDisplay {
  /** PriceUnit(有 i18n)或交易站原幣 id */
  unit: string
  /** unit 是 PriceUnit */
  known: boolean
  /** 主價:中位數(≥ 3 筆)或最低價 */
  headline?: string
  /** 主價的崇高石等值(只有 summary 已換算成崇高石時有;原幣 / 無匯率 = undefined → 不分段) */
  headlineEx?: number
  isMedian: boolean
  /** 最低 / 最高各自挑單位(崇高石;≥ 1 神聖石改神聖石) */
  min?: { value: string, unit: string, known: boolean }
  max?: { value: string, unit: string, known: boolean }
}

/**
 * 市價顯示:已換算(崇高石)→ 主價 ≥ 1 神聖石改用神聖石(最低 / 最高各自挑單位);原幣 → 照交易站幣別。
 */
export function formatRuneTrade (s: Poe2RuneTradeSummary, rates: ChaosRates): RuneTradeDisplay {
  const known = s.converted || tradeCurrencyUnit(s.unit) != null
  const rawUnit = s.converted ? 'ex' : (tradeCurrencyUnit(s.unit) ?? s.unit)
  const fmt = (ex: number) => {
    if (s.converted && rates.exalted && rates.divine && rates.exalted > 0 && rates.divine > 0 && ex * rates.exalted / rates.divine >= 1) {
      return { value: formatAmount(ex * rates.exalted / rates.divine), unit: 'div', known }
    }
    return { value: formatAmount(ex), unit: rawUnit, known }
  }
  const head = s.median ?? s.min
  if (head == null) return { unit: rawUnit, known, isMedian: false }
  const h = fmt(head)
  const out: RuneTradeDisplay = { unit: h.unit, known, headline: h.value, isMedian: s.median != null }
  if (s.converted && Number.isFinite(head)) out.headlineEx = head
  if (s.min != null) out.min = fmt(s.min)
  if (s.max != null) out.max = fmt(s.max)
  return out
}

export type Translate = (key: string, args?: Record<string, unknown>) => string

/**
 * 徽章上的關鍵篩選短字(徽章不能點,完整篩選寫在 log 與 docs/runeshape.md):
 * 技能寶石帶等級 → `L20`;技能 / 輔助沒寫等級 → `等級不限`;其他(物品 search / bulk)不標。
 * 未汙染、品質 0 每一筆寶石查詢都帶,不另標。
 */
export function runeTradeShortFilter (filters: readonly Poe2RuneTradeFilter[], t: Translate): string | undefined {
  for (const f of filters) {
    if (f.id === 'gem_level') return t('ppz.runeshape.trade.short_level', { n: f.value })
    if (f.id === 'gem_level_any') return t('ppz.runeshape.trade.short_level_any')
  }
  return undefined
}

/**
 * 市集徽章的價格分段:只有「有價格」且已換算成崇高石時才分段;主價是**單件**價,乘上列的數量得總價(與 ninja 徽章同口徑:
 * `priceTier(p.exalted * qty)`),再用同一組門檻。原幣(台服 / 無匯率 / 未知幣別)、查詢中 / 失敗 / 無掛單 = undefined(維持市集原樣)。
 */
export function runeTradeTier (display: Pick<RuneTradeDisplay, 'headlineEx'> | undefined, quantity: number, th: RuneThresholds): PriceTier | undefined {
  if (display?.headlineEx == null) return undefined
  return priceTier(display.headlineEx * Math.max(1, quantity), th)
}

export type RuneTradeBadgeStatus = 'queued' | 'loading' | 'price' | 'empty' | 'failed'

export interface RuneTradeBadge {
  status: RuneTradeBadgeStatus
  /** status = price:主價(≥ 3 筆中位數,否則最低價) */
  value?: string
  /** status = price:單位字(已翻譯;認不得的交易站幣別顯示原 id) */
  unit?: string
  /** 筆數 < 3(主價是最低價)→ 標「少」 */
  few: boolean
  /** status = price 且已換算崇高石:依 主價 × 數量 的三段(`runeTradeTier`,呼叫端填);其他 = undefined */
  tier?: PriceTier
  /** 關鍵篩選短字(`runeTradeShortFilter`) */
  short?: string
  /** 整枚徽章的文字(log / 測試 / data 屬性用):`市 80 崇高 · L20`、`市 … · 等級不限` */
  text: string
}

/**
 * 自動查市集徽章:排隊中 `…`、查詢中、結果「市 X 崇高」(筆數少加「少」)、沒有掛單、查詢失敗;後面接關鍵篩選短字。
 * `display` = `formatRuneTrade(summary)`(entry = done 時由呼叫端算好)。
 */
export function runeTradeBadge (
  entry: Pick<Poe2RuneTradeEntry, 'state'> | undefined,
  display: RuneTradeDisplay | undefined,
  filters: readonly Poe2RuneTradeFilter[],
  t: Translate
): RuneTradeBadge {
  const short = runeTradeShortFilter(filters, t)
  const mkt = t('ppz.runeshape.trade.market_short')
  const tail = short ? ` · ${short}` : ''
  const state = entry?.state ?? 'queued'
  if (state === 'done' && display?.headline != null) {
    const unit = display.known ? t(`ppz.runeshape.unit_${display.unit}`) : display.unit
    const few = !display.isMedian
    const fewText = few ? ` ${t('ppz.runeshape.trade.few_short')}` : ''
    return { status: 'price', value: display.headline, unit, few, short, text: `${mkt} ${display.headline} ${unit}${fewText}${tail}` }
  }
  const status: RuneTradeBadgeStatus = state === 'done' ? 'empty' : state === 'failed' ? 'failed' : state === 'loading' ? 'loading' : 'queued'
  const word = status === 'empty'
    ? t('ppz.runeshape.trade.empty_short')
    : status === 'failed' ? t('ppz.runeshape.trade.failed_short') : status === 'loading' ? t('ppz.runeshape.trade.loading') : '…'
  return { status, few: false, short, text: `${mkt} ${word}${tail}` }
}

