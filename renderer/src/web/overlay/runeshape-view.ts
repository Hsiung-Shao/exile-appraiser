/**
 * exile-appraiser(WP-R2):符文塑形自動查價徽章的純邏輯(`RuneshapePrices.vue` 用;`renderer/test/runeshape-prices.test.ts` 測)。
 * - 座標:掃描列(client 實體像素)× 視窗 CSS 大小 / client 大小(與揭露面板徽章相同,見 ocr-reveal.ts `layoutBadges`)。
 * - 計價:預設崇高石;≥ 1 神聖石改神聖石;沒有匯率時退回混沌石。數量 > 1 → 總價 + 單價。
 * - 顏色:以**總價**(崇高石)分三段:< low 暗、≥ high 金、之間一般(門檻在設定)。
 * 只做型別匯入 + vue 的 shallowRef(renderer vitest 沒有別名)。
 */
import { shallowRef } from 'vue'
import type { RuneshapeScanEvent, RuneshapeTimings } from '@ipc/types'
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
   * `recipe` = 配方結果是泛稱(隨機 / 某部位傳奇),本來就沒有單一價格(UI「無固定價格」,與「無價格」不同色)
   */
  noPrice?: 'gem' | 'not-listed' | 'recipe'
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
  th: RuneThresholds
): RuneBadgeView[] {
  const sx = client.w > 0 ? viewport.w / client.w : 1
  const sy = client.h > 0 ? viewport.h / client.h : 1
  const out: RuneBadgeView[] = []
  rows.forEach((r, i) => {
    if (r.offPanel) return
    out.push(layoutRow(r, i))
  })
  return out

  function layoutRow (r: MatchedRow, i: number): RuneBadgeView {
    const base = {
      key: `${i}:${Math.round(r.y)}`,
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
