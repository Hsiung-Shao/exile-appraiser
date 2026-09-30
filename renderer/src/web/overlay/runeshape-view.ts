/**
 * exile-appraiser(WP-R2):符文塑形自動查價徽章的純邏輯(`RuneshapePrices.vue` 用;`renderer/test/runeshape-prices.test.ts` 測)。
 * - 座標:掃描列(client 實體像素)× 視窗 CSS 大小 / client 大小(與揭露面板徽章相同,見 ocr-reveal.ts `layoutBadges`)。
 * - 計價:預設崇高石;≥ 1 神聖石改神聖石;沒有匯率時退回混沌石。數量 > 1 → 總價 + 單價。
 * - 顏色:以**總價**(崇高石)分三段:< low 暗、≥ high 金、之間一般(門檻在設定)。
 * - 點選查交易站(docs/runeshape.md「點選查交易站」):overlayKey 叫出 overlay 且畫面上有徽章 → 徽章可點模式
 *   (`runeshapeClickMode`,App.vue 切換);無 ninja 價且可查的列帶 `tradeKey`;市價換算 / 顯示字串 / 篩選清單在這裡。
 * 只做型別匯入 + vue 的 shallowRef(renderer vitest 沒有別名)。
 */
import { shallowRef } from 'vue'
import type { RuneshapeScanEvent, RuneshapeTimings } from '@ipc/types'
import type { Poe2RuneTradeFilter, Poe2RuneTradeSummary } from '@poe2-entry'
import type { PriceOfResult } from '../background/price-of'
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
  /** 可點選查交易站(無 ninja 價且列可查)→ 查詢計畫的快取鍵 */
  tradeKey?: string
  /** 列在 rows 裡的索引(點選時找回原列) */
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
  /** 點選查交易站:可查的列 → 查詢計畫快取鍵(不給 = 不可點) */
  tradeKeyOf?: (row: MatchedRow) => string | undefined
): RuneBadgeView[] {
  const sx = client.w > 0 ? viewport.w / client.w : 1
  const sy = client.h > 0 ? viewport.h / client.h : 1
  const out: RuneBadgeView[] = []
  rows.forEach((r, i) => {
    if (r.offPanel) return
    const v = layoutRow(r, i)
    // 只有「沒有 ninja 價」的列可點(配方泛稱本來就沒有單一市價,不查)
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
      const v: RuneBadgeView = { ...base, kind: 'unmatched', tier: 'low', raw: r.text.replace(/\s+/g, '') }
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

// ---------------- 點選查交易站(docs/runeshape.md「點選查交易站」) ----------------

/** 徽章可點模式:overlayKey 叫出 overlay 時畫面上有符文徽章(App.vue 設;overlay 失焦 / Esc / 點空白處結束) */
export const runeshapeClickMode = shallowRef(false)
/** 畫面上目前有符文徽章(RuneshapePrices.vue 寫;App.vue 決定 overlayKey 要進可點模式還是開設定) */
export const runeshapeBadgesShown = shallowRef(false)

/**
 * overlayKey 叫出 overlay(`focus-change` overlay = true 且 usingHotkey)時:查價面板沒開、畫面上有符文徽章 → 進徽章可點模式;
 * 否則維持原本行為(開設定)。
 */
export function enterClickModeOnOverlayKey (focus: { overlay: boolean, usingHotkey: boolean }, panelShown: boolean, badgesShown: boolean): boolean {
  return focus.overlay && focus.usingHotkey && !panelShown && badgesShown
}

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
  if (s.min != null) out.min = fmt(s.min)
  if (s.max != null) out.max = fmt(s.max)
  return out
}

/**
 * 市價卡片位置:徽章欄右側(不蓋住其他列的徽章),右邊放不下 → 面板左側(列文字左緣再往左);
 * 上緣對齊點選的徽章(往上 24 px),夾進視窗(留 8 px)。
 */
export function placeTradeCard (
  anchor: { top: number, rowLeft: number, columnRight: number },
  viewport: { w: number, h: number },
  size: { w: number, h: number },
  gap = 12
): { left: number, top: number } {
  let left = anchor.columnRight + gap
  if (left + size.w > viewport.w - 8) left = anchor.rowLeft - gap - size.w
  left = Math.max(8, Math.min(left, viewport.w - size.w - 8))
  const top = Math.max(8, Math.min(anchor.top - 24, viewport.h - size.h - 8))
  return { left: Math.round(left), top: Math.round(top) }
}

export type Translate = (key: string, args?: Record<string, unknown>) => string

/** 篩選清單 → 卡片上的「名稱:值」列(順序照查詢計畫) */
export function runeTradeFilterLines (filters: readonly Poe2RuneTradeFilter[], t: Translate): Array<{ id: string, label: string, value: string }> {
  const unitText = (c: string) => { const u = tradeCurrencyUnit(c); return u ? t(`ppz.runeshape.unit_${u}`) : c }
  return filters.map((f) => {
    const label = t(`ppz.runeshape.trade.f_${f.id}`)
    let value: string
    switch (f.id) {
      case 'realm': value = t(`ppz.realm_${f.value}_short`); break
      case 'mode': value = t(`ppz.runeshape.trade.mode_${f.value}`); break
      case 'status': value = t(`ppz.runeshape.trade.status_${f.value}`); break
      case 'category': value = t('ppz.runeshape.trade.v_gem'); break
      case 'gem_level': value = String(f.value); break
      case 'gem_level_any': value = t('ppz.runeshape.trade.v_level_any'); break
      case 'corrupted': value = t('ppz.runeshape.trade.v_uncorrupted'); break
      case 'quality': value = t('ppz.runeshape.trade.v_quality_zero'); break
      case 'have': value = f.value.map(unitText).join(' / '); break
      default: value = String(f.value)
    }
    return { id: f.id, label, value }
  })
}
