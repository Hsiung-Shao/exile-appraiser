/**
 * PoE1 倉庫價格疊層的徽章排版(純函式;`StashPrices.vue` 用)。
 * 固定版面(`data/poe1/stash/layouts.json`,core `cellRects`)× main 的 `stash-scan-result`(子頁 + 資料夾偏移 + client 大小)
 * → 每格一枚徽章:貼在格子下緣、格寬內置中;內容 = 名稱(辨識檢視,可關)+ poe.ninja 價格(呈現照符文塑形徽章:
 * 混沌石計價、≥ 1 神聖石改神聖石、三段顏色 `priceTier`、低信心「?」)。
 * 游標停在某格(`stash-cursor`)→ 只留那一格,放大並帶完整名稱,其他格隱藏(不蓋住遊戲說明框)。
 * 2026-10-15 倉庫價值:有每格數量(main 讀堆疊數量)時徽章改顯示小計 = 單價 × 數量(三段色 / C・D 依小計);數量讀不到 → 只顯示單價 +「?」、
 * 不計入總價;空格(0)不畫(停格時才畫);`peek`(main 要用乾淨畫面重讀被蓋住的數字)→ 格子徽章全部收起。整頁總價 `stashPageValue`。
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
  /** 倉庫價值:這格的數量(0 = 空格、null = 讀不到);undefined = 沒有數量(關閉讀數量 / 舊 main) */
  qty?: number | null
  /** 數量讀不到 → 徽章只顯示單價 +「?」 */
  qtyUnknown?: boolean
  /** 空格(數量 0;只有停格時才會出現在清單裡) */
  empty?: boolean
  /** 有數量時的單價 / 小計(停格明細卡) */
  unitPrice?: { value: string, unit: StashPriceUnit }
  subtotal?: { value: string, unit: StashPriceUnit }
}

/** 格內短名:去掉「聖甲蟲:」前綴;英文去掉 Scarab 字樣 */
export function shortStashName (name: string): string {
  const zh = name.replace(/^聖甲蟲[：:]/, '')
  if (zh !== name) return zh
  return name.replace(/ Scarab( of)?/, '').trim() || name
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
  /** 倉庫價值:每格數量(與版面格順序一致;0 = 空格、null = 讀不到);省略 = 不讀數量 */
  quantities?: ReadonlyArray<number | null>
  /** main 要重讀被徽章蓋住的數字 → 格子徽章全部收起 */
  peek?: boolean
}

export function layoutStashBadges (inp: StashLayoutInput): StashBadgeView[] {
  if (!(inp.client.w > 0 && inp.client.h > 0)) return []
  const sx = inp.viewport.w / inp.client.w
  const sy = inp.viewport.h / inp.client.h
  if (inp.peek) return []
  const out: StashBadgeView[] = []
  const q = inp.quantities
  cellRects(inp.file, inp.subtab, inp.client.h, inp.yOffset).forEach((c, i) => {
    const hovered = inp.hover === c.refName
    if (inp.hover != null && !hovered) return
    const qty = q ? (q[i] ?? null) : undefined
    // 空格不畫(停格時才畫,讓使用者看得到這格是什麼、單價多少)
    if (qty === 0 && !hovered) return
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
    if (qty !== undefined) {
      b.qty = qty
      if (qty === null) b.qtyUnknown = true
      if (qty === 0) b.empty = true
    }
    if (p.status === 'ok') {
      const unit = stashPriceUnit(p.chaos, inp.divineRate)
      if (qty != null && qty > 0) {
        const sub = p.chaos * qty
        b.unitPrice = unit
        b.subtotal = stashPriceUnit(sub, inp.divineRate)
        b.price = b.subtotal
        b.tier = priceTier(sub, inp.thresholds)
      } else {
        b.price = unit
        if (qty !== undefined) b.unitPrice = unit
        // 數量讀不到 / 空格:不知道小計 → 不分段
        if (qty === undefined) b.tier = priceTier(p.chaos, inp.thresholds)
      }
      if (p.lowConfidence) b.lowConfidence = true
    }
    out.push(b)
  })
  return out
}

export interface StashPageValue {
  /** Σ 單價 × 數量(混沌石;數量讀不到 / 沒有價格的格不計入) */
  totalChaos: number
  /** 讀到數量(> 0)的格數 */
  known: number
  /** 數量讀不到的格數 */
  unknown: number
  /** 空格數 */
  empty: number
  /** 有數量但沒有價格(poe.ninja 沒有 / 讀取中)的格數 */
  noPrice: number
}

/** 整頁價值;沒有數量 → null */
export function stashPageValue (inp: Pick<StashLayoutInput, 'file' | 'subtab' | 'priceOf' | 'quantities'>): StashPageValue | null {
  const q = inp.quantities
  if (!q) return null
  const v: StashPageValue = { totalChaos: 0, known: 0, unknown: 0, empty: 0, noPrice: 0 }
  inp.file.subtabs[inp.subtab].forEach((c, i) => {
    const qty = q[i] ?? null
    if (qty === null) { v.unknown++; return }
    if (qty === 0) { v.empty++; return }
    v.known++
    const p = inp.priceOf(c.refName)
    if (p.status === 'ok') v.totalChaos += p.chaos * qty
    else v.noPrice++
  })
  return v
}

/** 「本頁價值」卡的位置(CSS px):倉庫面板右緣外(h × 37/60 + 12)、格子區頂端;不蓋任何格子與按鈕列 */
export function stashValueCardPos (inp: Pick<StashLayoutInput, 'file' | 'subtab' | 'yOffset' | 'client' | 'viewport'>): { left: number, top: number } | null {
  if (!(inp.client.w > 0 && inp.client.h > 0)) return null
  const sx = inp.viewport.w / inp.client.w
  const sy = inp.viewport.h / inp.client.h
  const rects = cellRects(inp.file, inp.subtab, inp.client.h, inp.yOffset)
  const top = rects.length ? Math.min(...rects.map(r => r.y)) : 0
  return { left: (Math.floor(inp.client.h * 37 / 60) + 12) * sx, top: top * sy }
}
