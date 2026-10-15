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
import { QTY_PARAMS } from '../../../../core/src/stash/quantity'
import type { PriceOfResult } from '../background/price-of'
import { overlayPlace, type OverlayPos } from './float-menu-geom'
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
  /**
   * 沒算進總價的原因標記(徽章上的醒目記號):`qty-unknown` = 數量讀不到(「?」);`no-price` = 有數量但沒有價格(「無價」)。
   * 沒有數量(關閉讀數量)/ 正常 / 價格讀取中 = 省略
   */
  mark?: 'qty-unknown' | 'no-price'
  /** 空格(數量 0;只有停格時才會出現在清單裡) */
  empty?: boolean
  /** 有數量時的單價 / 小計(停格明細卡) */
  unitPrice?: { value: string, unit: StashPriceUnit }
  subtotal?: { value: string, unit: StashPriceUnit }
  /** H3-1 候選擺法(現況 = 省略):`fit` → `maxHeight`(CSS px)限高;`below` → `top` = 數字帶下緣 + 遮罩外擴、往下長 */
  placement?: 'fit' | 'below'
  maxHeight?: number
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
  /** H3-1 候選擺法(省略 = `STASH_BADGE_PLACEMENT`,目前 = 現況) */
  placement?: StashBadgePlacement
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
    // H3-1 候選(停格的放大卡不套:它本來就放在格子外)
    const placement = inp.placement ?? STASH_BADGE_PLACEMENT
    if (!hovered && placement === 'fit') { b.placement = 'fit'; b.maxHeight = c.h * sy * STASH_BADGE_FIT_RATIO }
    if (!hovered && placement === 'below') { b.placement = 'below'; b.top = (c.y + c.h * STASH_QTY_BAND_RATIO + STASH_BAND_ROUND_PX) * sy + STASH_MASK_PAD_CSS_PX }
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
    if (qty === null) b.mark = 'qty-unknown'
    else if (qty != null && qty > 0 && p.status !== 'ok' && p.status !== 'loading') b.mark = 'no-price'
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
  /** 有數量但沒有價格(poe.ninja 沒有)的格數;價格讀取中不算 */
  noPrice: number
  /** 沒算進總價的格數 = 數量讀不到 + 有數量但沒有價格(徽章上有標記的格) */
  excluded: number
}

/** 整頁價值;沒有數量 → null */
export function stashPageValue (inp: Pick<StashLayoutInput, 'file' | 'subtab' | 'priceOf' | 'quantities'>): StashPageValue | null {
  const q = inp.quantities
  if (!q) return null
  const v: StashPageValue = { totalChaos: 0, known: 0, unknown: 0, empty: 0, noPrice: 0, excluded: 0 }
  inp.file.subtabs[inp.subtab].forEach((c, i) => {
    const qty = q[i] ?? null
    if (qty === null) { v.unknown++; return }
    if (qty === 0) { v.empty++; return }
    v.known++
    const p = inp.priceOf(c.refName)
    if (p.status === 'ok') v.totalChaos += p.chaos * qty
    else if (p.status !== 'loading') v.noPrice++
  })
  v.excluded = v.unknown + v.noPrice
  return v
}

/**
 * 「本頁價值」卡的位置與大小上限(CSS px):倉庫面板**底部**的空白帶 —— 格子區下方的面板框飾之下、搜尋列(強調物品)上方
 * (1440 基準 y 1066–1146、x 24 – 面板寬 888 − 24;跟著資料夾偏移)。2026-10-15 使用者實機截圖:原本放在面板右緣外會蓋住倉庫頁籤清單。
 * 不蓋任何格子(main 讀數量不受影響)、不出面板右緣。
 */
export const STASH_VALUE_BAND_1440 = { x0: 24, x1: 888 - 24, y0: 1066, y1: 1146 } as const

export function stashValueCardPos (inp: Pick<StashLayoutInput, 'file' | 'subtab' | 'yOffset' | 'client' | 'viewport'>): { left: number, top: number, maxWidth: number, maxHeight: number } | null {
  if (!(inp.client.w > 0 && inp.client.h > 0)) return null
  const sx = inp.viewport.w / inp.client.w
  const sy = inp.viewport.h / inp.client.h
  const k = inp.client.h / 1440
  const b = STASH_VALUE_BAND_1440
  const top = Math.ceil(b.y0 * k) + inp.yOffset
  const bottom = Math.floor(b.y1 * k) + inp.yOffset
  const left = Math.ceil(b.x0 * k)
  const right = Math.min(Math.floor(b.x1 * k), Math.floor(inp.client.h * 37 / 60))
  return { left: left * sx, top: top * sy, maxWidth: (right - left) * sx, maxHeight: (bottom - top) * sy }
}

/**
 * 2026-10-15 H2 價值卡拖曳:設定 `stashValueCard`(overlay 內左上角比例;null = `stashValueCardPos` 的面板底部預設,**原樣**不夾)
 * → 實際位置。有存位置 → 夾進畫面(`overlayPlace`,至少留 4 px;顯示時才夾、不回寫設定);大小上限沿用預設帶(卡片內容不變)。
 */
export function stashValueCardPlace (
  def: { left: number, top: number, maxWidth: number, maxHeight: number },
  pos: OverlayPos | null,
  view: { w: number, h: number },
  box: { w: number, h: number }
): { left: number, top: number, maxWidth: number, maxHeight: number } {
  if (!pos) return def
  return { ...overlayPlace(pos, view, box, def), maxWidth: def.maxWidth, maxHeight: def.maxHeight }
}

/**
 * 2026-10-15 H3-1 徽章不壓數字帶(候選,**等使用者選定**;預設 `current` = 現況,畫面不變):
 * - `current`:徽章底邊貼格子下緣往上長(現況;原生 1440 聖甲蟲頁徽章高 > 格高 35% → 蓋進數字帶)。
 * - `fit`(候選 a):同一錨點,徽章最大高度 = 格高 × `STASH_BADGE_FIT_RATIO`(超過就縮字級、只留一行)。
 * - `below`(候選 b):徽章上緣 = 數字帶下緣(格高 × 0.65)+ 遮罩外擴(3 CSS px),往下長、部分超出格子下緣。
 * 數字帶 = core `quantity.ts` `qtyCropRect`(格子上方 `QTY_PARAMS.cropH` = 0.65 高;這裡只讀常數)。
 */
export type StashBadgePlacement = 'current' | 'fit' | 'below'
export const STASH_BADGE_PLACEMENT: StashBadgePlacement = 'current'
export const STASH_BADGE_FIT_RATIO = 0.33
/** main `scan-mask.ts` `MASK_PAD_CSS_PX`(遮罩外擴;renderer 不能 import main,值對照由測試守門) */
export const STASH_MASK_PAD_CSS_PX = 3
export const STASH_QTY_BAND_RATIO = QTY_PARAMS.cropH
/**
 * 數字帶取整餘量(client px):`qtyCropRect` 的高 = 在模板基準解析度取整再放大(1440 時 45 × 0.65 = 29.25 → 實際 29.44),
 * 誤差 ≤ 半個基準像素 × k(1440 ≈ 0.64、4K ≈ 0.96)→ 候選 b 多留 1 px
 */
export const STASH_BAND_ROUND_PX = 1

/** 格子(任意單位)+ 徽章原本大小 → 候選擺法下的徽章框(水平置中於格子);`fit` 只限高度 */
export function stashBadgeBox (
  cell: { x: number, y: number, w: number, h: number },
  badge: { w: number, h: number },
  mode: StashBadgePlacement,
  pad = STASH_MASK_PAD_CSS_PX
): { x: number, y: number, w: number, h: number } {
  const x = cell.x + cell.w / 2 - badge.w / 2
  if (mode === 'below') return { x, y: cell.y + cell.h * STASH_QTY_BAND_RATIO + STASH_BAND_ROUND_PX + pad, w: badge.w, h: badge.h }
  const h = mode === 'fit' ? Math.min(badge.h, cell.h * STASH_BADGE_FIT_RATIO) : badge.h
  return { x, y: cell.y + cell.h - h, w: badge.w, h }
}

/** 數字帶(格子上方 0.65 高;與 `qtyCropRect` 同口徑,忽略 cropDx 的 3 px 左移與取整) */
export function stashQtyBand (cell: { x: number, y: number, w: number, h: number }): { x: number, y: number, w: number, h: number } {
  return { x: cell.x, y: cell.y, w: cell.w, h: cell.h * STASH_QTY_BAND_RATIO }
}

/** 徽章框(可外擴 `pad`,= main 遮罩)與任一格的數字帶交疊的格數;`cells[i]` 的徽章大小 = `badges[i]` */
export function stashBadgeBandOverlaps (
  cells: ReadonlyArray<{ x: number, y: number, w: number, h: number }>,
  badges: ReadonlyArray<{ w: number, h: number }>,
  mode: StashBadgePlacement,
  pad = 0
): { own: number, others: number } {
  const ov = (a: { x: number, y: number, w: number, h: number }, b: { x: number, y: number, w: number, h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const boxes = cells.map((c, i) => {
    const b = stashBadgeBox(c, badges[i], mode)
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }
  })
  const bands = cells.map(stashQtyBand)
  let own = 0
  const hitOthers = new Set<number>()
  boxes.forEach((b, i) => {
    if (ov(b, bands[i])) own++
    bands.forEach((band, j) => { if (j !== i && ov(b, band)) hitOthers.add(j) })
  })
  return { own, others: hitOthers.size }
}
