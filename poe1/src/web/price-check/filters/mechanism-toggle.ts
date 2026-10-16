// exile-appraiser: 自寫(非上游移植)。2026-10-16 查價面板統一「機制」選擇(計畫 rustling-shimmying-charm B),
// 取代「一般 / 破裂」二選一在一般詞綴列上的角色(破裂的 pseudo 退路列仍用 FilterModifierFractured)。元件 FilterModifierMechanism.vue。
// - 每條隨機詞綴列依 stat 在交易站有的分類給選項:一般(explicit)+ 破裂 / 工藝中有 id 的;只有一般時不顯示。
//   pseudo / property 列、來源含固定(implicit)/ 附魔(enchant)等非隨機詞綴的列不給選項。
//   id 一律取自 stat 資料 `trade.ids[ModifierType.X]`(語言無關鍵),不寫死字串。
// - 目前模式由 tradeId 對應(PoE1 工藝台詞綴本來就送 crafted id → 預設「工藝」)。
// - 選非一般 = tradeId 換成該機制 ids、勾選、其他送同一組 ids 的列(破裂孿生)取消勾選;選一般 = 換回 explicit(勾選不動)。
// - 查詢(trade/pathofexile-trade.ts):勾選中、模式一般、來源本身是破裂 / 工藝的列,該機制的 ids 併進同一個 not 群組
//   (一般隨機來源不排除)。
// - 只對魔法 / 稀有物品(主對話 2026-10-16 裁定):傳奇 / 普通、地圖類不給選項。有物品時(元件)由 item 判斷;
//   查詢端(createTradeRequest)沒有 item,改看 create-presets 在不適用物品的列標的 `noMechanism`。
// PoE2 同名檔同規則(另有褻瀆 / 增幅)。
import { ItemCategory, ItemRarity, type ParsedItem } from '@/parser'
import { ModifierType } from '@/parser/modifiers'
import { FilterTag, type FilterOrGroup, type StatFilter } from './interfaces'

export type MechanismMode = 'normal' | 'fractured' | 'crafted'

/** 一般以外的機制,依顯示順序 */
const MECHANISMS: ReadonlyArray<[Exclude<MechanismMode, 'normal'>, ModifierType]> = [
  ['fractured', ModifierType.Fractured],
  ['crafted', ModifierType.Crafted]
]

/** 來源類型是這些的列才是「隨機詞綴」 */
const RANDOM_SOURCE_TYPES = new Set<string>([
  ModifierType.Explicit,
  ModifierType.Fractured,
  ModifierType.Crafted
])

/** 不給機制選項的物品類別(地圖類) */
const EXCLUDED_CATEGORIES = new Set<ItemCategory | undefined>([
  ItemCategory.Map,
  ItemCategory.Chart,
  ItemCategory.Invitation,
  ItemCategory.ExpeditionLogbook
])

/** 這件物品的詞綴能不能選機制:魔法 / 稀有、且不是地圖類 */
export function itemAllowsMechanism (item: ParsedItem): boolean {
  return (item.rarity === ItemRarity.Magic || item.rarity === ItemRarity.Rare) &&
    !EXCLUDED_CATEGORIES.has(item.category)
}

/** create-presets 收尾:不適用物品的列標 noMechanism(查詢端沒有 item 也能判斷) */
export function markMechanismEligibility (stats: readonly FilterOrGroup[], item: ParsedItem): void {
  if (itemAllowsMechanism(item)) return
  for (const f of stats) {
    if (f.group) {
      for (const s of f.stats) s.noMechanism = true
    } else {
      f.noMechanism = true
    }
  }
}

function sameIds (a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** 這條 filter 各機制的 trade ids(含一般);不適用時回 null */
export function mechanismIds (filter: StatFilter, item?: ParsedItem): Map<MechanismMode, string[]> | null {
  if (filter.noMechanism || (item != null && !itemAllowsMechanism(item))) return null
  if (filter.tag === FilterTag.Pseudo || filter.tag === FilterTag.Property || !filter.sources?.length) return null
  if (!filter.sources.every(s => RANDOM_SOURCE_TYPES.has(s.modifier.info.type))) return null
  const ids = filter.sources[0].stat.stat.trade.ids
  const base = ids[ModifierType.Explicit]
  if (!base?.length) return null
  const out = new Map<MechanismMode, string[]>([['normal', base]])
  for (const [mode, type] of MECHANISMS) {
    const mIds = ids[type]
    if (mIds?.length) out.set(mode, mIds)
  }
  if (out.size < 2) return null
  if (![...out.values()].some(v => sameIds(filter.tradeId, v))) return null
  return out
}

/** 分段按鈕的選項(依顯示順序);只有一般或不適用時回 [] */
export function mechanismOptions (filter: StatFilter, item?: ParsedItem): MechanismMode[] {
  const ids = mechanismIds(filter, item)
  return ids ? [...ids.keys()] : []
}

/** 目前選中的機制(由 tradeId 對應;不適用時為一般) */
export function mechanismMode (filter: StatFilter): MechanismMode {
  const ids = mechanismIds(filter)
  if (!ids) return 'normal'
  for (const [mode, v] of ids) if (sameIds(filter.tradeId, v)) return mode
  return 'normal'
}

/**
 * 這列「原本」的機制(2026-10-16「機制」開關:關著時只有被改過的列顯示按鈕):
 * 列的 tag 本身是某個機制(工藝台詞綴 = 工藝)就是它,其他(含併成 explicit 的破裂列)為一般。
 */
export function mechanismDefault (filter: StatFilter): MechanismMode {
  const opts: string[] = mechanismOptions(filter)
  return opts.includes(filter.tag) ? filter.tag as MechanismMode : 'normal'
}

/**
 * 選一個機制。非一般:tradeId 換成該機制 ids、勾選、其他送同一組 ids 的列取消勾選;
 * 一般:換回 explicit(勾選狀態不動)。不適用或沒有這個選項時什麼都不做。
 */
export function selectMechanism (filters: readonly StatFilter[], filter: StatFilter, mode: MechanismMode): void {
  const ids = mechanismIds(filter)?.get(mode)
  if (!ids) return
  filter.tradeId = [...ids]
  if (mode === 'normal') return
  filter.disabled = false
  for (const other of filters) {
    if (other === filter || other.group) continue
    if (sameIds(other.tradeId, ids)) other.disabled = true
  }
}

/** 「一般」排除只看這幾種來源機制 */
const EXCLUDABLE: ReadonlyArray<[MechanismMode, ModifierType]> = [
  ['fractured', ModifierType.Fractured],
  ['crafted', ModifierType.Crafted]
]

/**
 * 「一般」排除(使用者 2026-10-16 裁定:只排除該列「來源本身」的機制):勾選中、模式一般、
 * 來源全部是單一機制 X(破裂 / 工藝)的列,not 只放該列 X 的 ids;一般隨機來源不排除
 * (not 群組是「整件物品含該 stat id 即排除」,排除隨機會誤殺工藝混合詞綴等正常掛單)。
 * 多列合併、去重;已被勾選列直接送出的 id 不放。回 [] = 不排除。
 */
export function mechanismNotIds (stats: readonly StatFilter[]): string[] {
  const sent = new Set(stats.filter(s => !s.disabled).flatMap(s => s.tradeId))
  const out = new Set<string>()
  for (const stat of stats) {
    if (stat.disabled) continue
    const ids = mechanismIds(stat)
    if (!ids || mechanismMode(stat) !== 'normal') continue
    const src = EXCLUDABLE.find(([, type]) => stat.sources.every(s => s.modifier.info.type === type))
    const own = src && ids.get(src[0])
    if (!own) continue
    for (const id of own) if (!sent.has(id)) out.add(id)
  }
  return [...out]
}
