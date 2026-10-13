/**
 * PoE1 倉庫價格疊層的徽章排版(純函式;`StashPrices.vue` 用)。
 * 固定版面(`data/poe1/stash/layouts.json`,core `cellRects`)× main 的 `stash-scan-result`(子頁 + 資料夾偏移 + client 大小)
 * → 每格一枚徽章:貼在格子下緣、格寬內置中;內容 = 名稱(辨識檢視,可關)+ poe.ninja 價格(呈現照符文塑形徽章:
 * 混沌石計價、≥ 1 神聖石改神聖石、三段顏色 `priceTier`、低信心「?」)。
 * 游標停在某格(`stash-cursor`)→ 只留那一格,放大並帶完整名稱,其他格隱藏(不蓋住遊戲說明框)。
 */
import { cellRects, type StashLayoutFile, type StashSubtab } from '../../../../core/src/stash/layout'
import type { PriceOfResult } from '../background/price-of'
import { formatAmount, priceTier, type PriceTier, type RuneThresholds } from './runeshape-view'

export type StashPriceUnit = 'c' | 'div'

export interface StashBadgeView {
  key: string
  refName: string
  /** 顯示名稱:格內 = 短名、hover = 全名 */
  name: string
  /** CSS px:格子水平中心、格子下緣 */
  left: number
  top: number
  /** CSS px:格寬(格內徽章最大寬) */
  width: number
  status: 'ok' | 'no-price' | 'loading' | 'no-source'
  price?: { value: string, unit: StashPriceUnit }
  tier?: PriceTier
  lowConfidence?: boolean
  hovered: boolean
}

/** 格內短名:去掉「聖甲蟲:」前綴、不滅之火的前綴與「餘燼」;英文去掉 Scarab / Allflame Ember 字樣 */
export function shortStashName (name: string): string {
  const zh = name.replace(/^聖甲蟲[：:]/, '').replace(/^不滅之火/, '').replace(/餘燼$/, '')
  if (zh !== name) return zh
  return name.replace(/^Allflame Ember of /, '').replace(/ Scarab( of)?/, '').trim() || name
}

/** chaos → 顯示單位(PoE1:≥ 1 神聖石改神聖石,與查價面板 autoCurrency 同精神) */
export function stashPriceUnit (chaos: number, divineRate: number | undefined): { value: string, unit: StashPriceUnit } {
  if (divineRate && divineRate > 0 && chaos / divineRate >= 1) return { value: formatAmount(chaos / divineRate), unit: 'div' }
  return { value: formatAmount(chaos), unit: 'c' }
}

export interface StashLayoutInput {
  file: StashLayoutFile
  subtab: StashSubtab
  yOffset: number
  client: { w: number, h: number }
  viewport: { w: number, h: number }
  /** refName → 顯示名稱(繁中 / 英文);沒有 = refName */
  names: (refName: string) => string | undefined
  priceOf: (refName: string) => PriceOfResult
  divineRate: number | undefined
  thresholds: RuneThresholds
  /** 游標停的格(refName);null = 沒有 */
  hover: string | null
}

export function layoutStashBadges (inp: StashLayoutInput): StashBadgeView[] {
  if (!(inp.client.w > 0 && inp.client.h > 0)) return []
  const sx = inp.viewport.w / inp.client.w
  const sy = inp.viewport.h / inp.client.h
  const out: StashBadgeView[] = []
  for (const c of cellRects(inp.file, inp.subtab, inp.client.h, inp.yOffset)) {
    const hovered = inp.hover === c.refName
    if (inp.hover != null && !hovered) continue
    const full = inp.names(c.refName) ?? c.refName
    const p = inp.priceOf(c.refName)
    const b: StashBadgeView = {
      key: `${inp.subtab}|${c.refName}`,
      refName: c.refName,
      name: hovered ? full : shortStashName(full),
      left: (c.x + c.w / 2) * sx,
      top: (c.y + c.h) * sy,
      width: c.w * sx,
      status: p.status === 'ok' ? 'ok' : p.status === 'no-price' ? 'no-price' : p.status === 'loading' ? 'loading' : 'no-source',
      hovered
    }
    if (p.status === 'ok') {
      b.price = stashPriceUnit(p.chaos, inp.divineRate)
      b.tier = priceTier(p.chaos, inp.thresholds)
      if (p.lowConfidence) b.lowConfidence = true
    }
    out.push(b)
  }
  return out
}
