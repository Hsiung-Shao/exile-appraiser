/**
 * 拆粉排行:每件有拆粉基數的傳奇 × poe.ninja 價格 → 四種效率,排序。純函式(UI 與測試共用)。
 *
 * 假設(UI 與 docs/dust-tool.md 要講清楚):
 * - 價格 = poe.ninja `unique|name|baseType`(不取 `|6L`);ninja 的價多半是**低 ilvl、未腐化、無品質**的掛單,
 *   dust 卻依選項的 ilvl / 品質計算 → 排行是「買得到的話」的上限估計。
 * - 品質:非飾品 = `opts.quality`(磨刀石/護甲片成本忽略);飾品(Ring/Amulet/Belt)只能靠催化劑:
 *   `catalyst: 'never'` → 品質 0;`'auto'` → 比較「不買(q0)」與「q20 + 20 顆最便宜的催化劑」的 dust / 總成本,取高者並記錄。
 *   沒有物品價或催化劑價就不比較(q0)。
 * - gold:`goldFee` = poe-dust 的 `goldCost`(拆解手續費,來源未說明 ilvl;缺值 = undefined);
 *   換算 chaos = goldFee / 1000 × `goldValueChaos`(每 1000 gold 值幾 chaos,預設 0 = 不計)。
 * - 效率:
 *   `dust/chaos`       = dust ÷ 物品價
 *   `dust/total`       = dust ÷ (物品價 + gold 換算 + 催化劑成本);gold 估值 > 0 而該件沒有 goldFee → 算不出來
 *   `dust/gold`        = dust ÷ goldFee
 *   `dust/chaos/slot`  = (dust ÷ 物品價) ÷ 背包格數(poe-dust `slots`)
 *   算不出來的(沒價、沒 gold、沒格數)= undefined,排在最後(再依 dust 由大到小)。
 * - 固有勢力:本身帶 Shaper/Elder 勢力的傳奇(Starforge 等),APT 的 disenchantValue 不含勢力倍率(單件查價是從物品文字加),
 *   排行沒有物品文字 → 用 `inherentInfluencesFromPoeDust` 從 poe-dust 反推勢力數 n(只接受 1 / 2 且兩欄恰好吻合),
 *   `dustAt(dv, { ilvl, quality, influences: n })`。
 */
import type { NinjaSnapshot, NinjaSnapshotEntry } from '../ninja/cache'
import { currencyKey, uniqueKey } from '../ninja/keys'
import { dustAt } from './formula'
import { dustKey, inherentInfluencesFromPoeDust, type DustUnique, type PoeDustRow } from './data'

export type DustMetric = 'dust/chaos' | 'dust/total' | 'dust/gold' | 'dust/chaos/slot'
export const DUST_METRICS: readonly DustMetric[] = ['dust/chaos', 'dust/total', 'dust/gold', 'dust/chaos/slot']

export type CatalystMode = 'auto' | 'never'

/** PoE1 的催化劑(poe.ninja 放在 exchange `Currency` 類,category "Catalysts";`type=Catalyst` 回空)。 */
export const POE1_CATALYSTS: readonly string[] = [
  'Abrasive Catalyst', 'Accelerating Catalyst', 'Fertile Catalyst', 'Imbued Catalyst', 'Intrinsic Catalyst',
  'Noxious Catalyst', 'Prismatic Catalyst', 'Tainted Catalyst', 'Tempering Catalyst', 'Turbulent Catalyst', 'Unstable Catalyst'
]
export const CATALYSTS_FOR_Q20 = 20

const JEWELLERY_CATEGORIES = new Set(['Ring', 'Amulet', 'Belt'])
/** 基底類別缺時的後援(英文基底名) */
const JEWELLERY_BASE_RE = /\b(Ring|Amulet|Talisman|Belt|Sash|Vise)$/

export function isJewellery (u: Pick<DustUnique, 'category' | 'baseType'>): boolean {
  if (u.category) return JEWELLERY_CATEGORIES.has(u.category)
  return JEWELLERY_BASE_RE.test(u.baseType)
}

export interface RankOptions {
  /** 預設 84 */
  ilvl?: number
  /** 非飾品的品質,預設 0 */
  quality?: number
  /** 飾品是否考慮買催化劑,預設 'auto' */
  catalyst?: CatalystMode
  /** 每 1000 gold 值幾 chaos,預設 0 */
  goldValueChaos?: number
  /** 排序依據,預設 'dust/chaos' */
  metric?: DustMetric
}

export interface CheapestCatalyst {
  name: string
  chaos: number
}

export type CatalystReason =
  | 'not-jewellery'
  | 'disabled' // catalyst: 'never'
  | 'no-price' // 物品沒有 ninja 價,無從比較
  | 'no-catalyst-price'
  | 'q20-better'
  | 'q0-better'

export interface CatalystDecision {
  used: boolean
  reason: CatalystReason
  /** 用到(或比較過)的催化劑 */
  name?: string
  unitChaos?: number
  /** used 時 = 20 × unitChaos */
  costChaos: number
}

export type DustEfficiency = Partial<Record<DustMetric, number>>

export interface RankedDust {
  key: string
  item: DustUnique
  /** 依選項算出的 dust */
  dust: number
  /** 計算 dust 用的品質 */
  quality: number
  jewellery: boolean
  catalyst: CatalystDecision
  /** ninja 價(沒有 = undefined) */
  price?: NinjaSnapshotEntry
  noPrice: boolean
  lowConfidence: boolean
  goldFee?: number
  slots?: number
  /** gold 換算成 chaos(goldFee 缺 = 0) */
  goldChaos: number
  /** 物品價 + gold 換算 + 催化劑(沒有物品價 = undefined) */
  totalChaos?: number
  eff: DustEfficiency
  /** `eff[opts.metric]` */
  metricValue?: number
  /** 在 poe-dust 資料裡找得到(goldCost / slots 的來源) */
  inPoeDust: boolean
  /** 固有勢力數(從 poe-dust 反推;0 = 無) */
  inherentInfluences: number
}

export interface RankStats {
  total: number
  priced: number
  noPrice: number
  lowConfidence: number
  catalystUsed: number
  /** poe-dust 找不到(沒有 gold / 格數) */
  notInPoeDust: number
  /** metric 算不出來的 */
  noMetric: number
  /** 套用了固有勢力的 */
  inherentInfluenced: number
}

export interface RankInput {
  items: readonly DustUnique[]
  dust: readonly PoeDustRow[] | ReadonlyMap<string, PoeDustRow>
  snapshot: Pick<NinjaSnapshot, 'prices'> | null | undefined
  opts?: RankOptions
}

export function cheapestCatalyst (snapshot: Pick<NinjaSnapshot, 'prices'> | null | undefined): CheapestCatalyst | undefined {
  if (!snapshot) return undefined
  let best: CheapestCatalyst | undefined
  for (const name of POE1_CATALYSTS) {
    const e = snapshot.prices[currencyKey(name)]
    if (!e || !(e.c > 0)) continue
    if (!best || e.c < best.chaos) best = { name, chaos: e.c }
  }
  return best
}

function div (a: number, b: number | undefined): number | undefined {
  if (b === undefined || !(b > 0)) return undefined
  return a / b
}

export function rankUniques (input: RankInput): { rows: RankedDust[], stats: RankStats } {
  const opts = input.opts ?? {}
  const ilvl = opts.ilvl ?? 84
  const baseQuality = opts.quality ?? 0
  const catalystMode = opts.catalyst ?? 'auto'
  const goldValue = opts.goldValueChaos ?? 0
  const metric = opts.metric ?? 'dust/chaos'
  const dustIndex: ReadonlyMap<string, PoeDustRow> = input.dust instanceof Map
    ? input.dust
    : new Map((input.dust as readonly PoeDustRow[]).map(r => [dustKey(r.name, r.baseType), r]))
  const cat = cheapestCatalyst(input.snapshot)

  const rows: RankedDust[] = []
  for (const item of input.items) {
    const key = dustKey(item.name, item.baseType)
    const pd = dustIndex.get(key)
    const price = input.snapshot?.prices[uniqueKey(item.name, item.baseType, 0)]
    const chaos = price && price.c > 0 ? price.c : undefined
    const goldFee = pd?.goldCost
    const slots = pd?.slots
    const goldChaos = goldFee !== undefined ? goldFee / 1000 * goldValue : 0
    const jewellery = isJewellery(item)
    const influences = inherentInfluencesFromPoeDust(item.disenchantValue, pd)

    let quality = jewellery ? 0 : baseQuality
    let catalyst: CatalystDecision
    if (!jewellery) {
      catalyst = { used: false, reason: 'not-jewellery', costChaos: 0 }
    } else if (catalystMode === 'never') {
      catalyst = { used: false, reason: 'disabled', costChaos: 0 }
    } else if (chaos === undefined) {
      catalyst = { used: false, reason: 'no-price', costChaos: 0 }
    } else if (!cat) {
      catalyst = { used: false, reason: 'no-catalyst-price', costChaos: 0 }
    } else {
      const cost20 = CATALYSTS_FOR_Q20 * cat.chaos
      const eff0 = dustAt(item.disenchantValue, { ilvl, quality: 0, influences }) / (chaos + goldChaos)
      const eff20 = dustAt(item.disenchantValue, { ilvl, quality: 20, influences }) / (chaos + goldChaos + cost20)
      const use = eff20 > eff0
      catalyst = { used: use, reason: use ? 'q20-better' : 'q0-better', name: cat.name, unitChaos: cat.chaos, costChaos: use ? cost20 : 0 }
      if (use) quality = 20
    }

    const dust = dustAt(item.disenchantValue, { ilvl, quality, influences })
    const totalChaos = chaos !== undefined ? chaos + goldChaos + catalyst.costChaos : undefined
    const perChaos = div(dust, chaos)
    const eff: DustEfficiency = {}
    if (perChaos !== undefined) eff['dust/chaos'] = perChaos
    // gold 有估值但這件沒有 goldFee(poe-dust 沒收錄):總成本不完整 → 不算,免得缺資料的反而排前面
    const goldUnknown = goldValue > 0 && goldFee === undefined
    const perTotal = goldUnknown ? undefined : div(dust, totalChaos)
    if (perTotal !== undefined) eff['dust/total'] = perTotal
    const perGold = div(dust, goldFee)
    if (perGold !== undefined) eff['dust/gold'] = perGold
    const perSlot = perChaos !== undefined ? div(perChaos, slots) : undefined
    if (perSlot !== undefined) eff['dust/chaos/slot'] = perSlot

    rows.push({
      key,
      item,
      dust,
      quality,
      jewellery,
      catalyst,
      price,
      noPrice: chaos === undefined,
      lowConfidence: Boolean(price?.lc),
      goldFee,
      slots,
      goldChaos,
      totalChaos,
      eff,
      metricValue: eff[metric],
      inPoeDust: pd !== undefined,
      inherentInfluences: influences
    })
  }

  sortRanked(rows)

  const stats: RankStats = {
    total: rows.length,
    priced: rows.filter(r => !r.noPrice).length,
    noPrice: rows.filter(r => r.noPrice).length,
    lowConfidence: rows.filter(r => r.lowConfidence).length,
    catalystUsed: rows.filter(r => r.catalyst.used).length,
    notInPoeDust: rows.filter(r => !r.inPoeDust).length,
    noMetric: rows.filter(r => r.metricValue === undefined).length,
    inherentInfluenced: rows.filter(r => r.inherentInfluences > 0).length
  }
  return { rows, stats }
}

/** 主排序:metricValue 大 → 小;算不出來的在後;同值依 dust 大 → 小、再依英文名。就地排序並回傳。 */
export function sortRanked (rows: RankedDust[]): RankedDust[] {
  return rows.sort((a, b) => {
    const av = a.metricValue
    const bv = b.metricValue
    if (av !== undefined && bv !== undefined && av !== bv) return bv - av
    if (av === undefined && bv !== undefined) return 1
    if (av !== undefined && bv === undefined) return -1
    if (a.dust !== b.dust) return b.dust - a.dust
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

export interface DustFilter {
  /** dust 下限 */
  minDust?: number
  /** goldFee 上限(沒有 goldFee 的一律保留) */
  maxGold?: number
  hideNoPrice?: boolean
  hideLowConfidence?: boolean
  /** 使用者標記為隱藏的鍵(`name|baseType`) */
  hidden?: ReadonlySet<string>
  hideHidden?: boolean
  /** 名稱搜尋(英文名、基底、繁中名、繁中基底,不分大小寫) */
  search?: string
}

export function filterRanked (rows: readonly RankedDust[], f: DustFilter): RankedDust[] {
  const q = (f.search ?? '').trim().toLowerCase()
  return rows.filter(r => {
    if (f.minDust !== undefined && r.dust < f.minDust) return false
    if (f.maxGold !== undefined && r.goldFee !== undefined && r.goldFee > f.maxGold) return false
    if (f.hideNoPrice && r.noPrice) return false
    if (f.hideLowConfidence && r.lowConfidence) return false
    if (f.hideHidden && f.hidden?.has(r.key)) return false
    if (q) {
      const hay = [r.item.name, r.item.baseType, r.item.nameZh ?? '', r.item.baseZh ?? ''].join('\n').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
