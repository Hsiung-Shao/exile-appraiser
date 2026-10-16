// exile-appraiser: 自寫(非上游移植)。查價面板「破裂」切換鈕的純邏輯(元件 FilterModifierFractured.vue)。
// 破裂詞綴在 initUiModFilters 先轉成 explicit 列(常再被 pseudo 合計吃掉,例如「+# total to Intelligence」);
// 物品可再製作時另推一條 tag = fractured、送 fractured id 的孿生(hide_for_crafting 隱藏)。
// - revealFracturedRows(create-presets 呼叫):每條破裂詞綴挑一列「代表列」顯示 —— 有 explicit 列就用它,
//   沒有(被 pseudo 吃掉)就把孿生拿出來並改成一般詞綴(tag explicit、送 explicit id);其餘同一組 id 的列維持 / 改成隱藏。
//   pseudo 合計列照上游原樣不動。孿生改送 explicit id 會改變查詢裡那條未勾選條件的 id(2026-10-14 使用者接受)。
// - 切換鈕只在代表列(可見、來源全部是破裂詞綴、stat 同時有 explicit / fractured id);
//   打開 = tradeId 換 fractured、勾選、其他送同一組 fractured id 的列取消勾選;關閉 = 換回 explicit。不改 tag。
// - 例外:已汙染 / 已鏡像的物品沒有孿生,被 pseudo 吃掉的破裂詞綴就沒有自己的列 → 退而在 pseudo 列給鈕
//   (只在唯一來源是那條破裂詞綴、沒有倍率換算時;關閉回 pseudo id)。
import { pseudoStatByRef } from '@/assets/data'
import type { ParsedItem } from '@/parser'
import { ModifierType } from '@/parser/modifiers'
import { FilterTag, type FilterOrGroup, type StatFilter } from './interfaces'

/**
 * FiltersBlock provide 目前整份 stats 的 getter,切換鈕打開時用來取消勾選孿生;沒注入 = 只改這一條。
 * 刻意不用 vue 的 InjectionKey 型別(src-coupling 守門:src 的 .ts 不 import vue),型別寫在 inject 端。
 */
export const FRACTURED_FILTERS_KEY = Symbol('ppz-fractured-filters')

export interface FracturedIds {
  /** 關閉時的 id:一般列 / 孿生 = explicit、pseudo 列 = 該 pseudo 的 id */
  base: string[]
  fractured: string[]
}

/** 這件物品有沒有破裂孿生(initUiModFilters:未汙染、未鏡像才推回孿生) */
function hasTwins (item: ParsedItem): boolean {
  return !item.isCorrupted && !item.isMirrored
}

function sameIds (a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * 這條 filter 的關閉 / 打開兩組 trade id;來源不全是破裂詞綴或缺 id 時回 null。
 * pseudo 列只在「唯一來源是破裂詞綴、沒有倍率換算」時回值(合計才等於那條破裂詞綴的值)。
 */
export function fracturedIds (filter: StatFilter): FracturedIds | null {
  if (!filter.sources.length) return null
  if (!filter.sources.every(s => s.modifier.info.type === ModifierType.Fractured)) return null
  const src = filter.sources[0]
  const fractured = src.stat.stat.trade.ids[ModifierType.Fractured]
  let base: string[] | undefined
  if (filter.tag === FilterTag.Pseudo) {
    if (filter.sources.length !== 1 || src.contributes?.value !== src.stat.roll?.value) return null
    base = pseudoStatByRef(filter.statRef)?.trade.ids[ModifierType.Pseudo]
  } else {
    base = src.stat.stat.trade.ids[ModifierType.Explicit]
  }
  if (!base?.length || !fractured?.length) return null
  if (!sameIds(filter.tradeId, base) && !sameIds(filter.tradeId, fractured)) return null
  return { base, fractured }
}

/** 破裂物品、可見的破裂詞綴列才顯示切換鈕;pseudo 列只在沒有孿生的物品(已汙染 / 已鏡像)。 */
export function canToggleFractured (filter: StatFilter, item: ParsedItem): boolean {
  if (!item.isFractured || filter.hidden != null || fracturedIds(filter) == null) return false
  // exile-appraiser: 2026-10-16:被合計吃掉、新列出的原始詞綴列(fromAggregate)由機制選擇(mechanism-toggle.ts)接手
  if (filter.fromAggregate) return false
  return filter.tag !== FilterTag.Pseudo || !hasTwins(item)
}

/** 目前是否送破裂 id。 */
export function isFracturedOn (filter: StatFilter): boolean {
  const ids = fracturedIds(filter)
  return ids != null && sameIds(filter.tradeId, ids.fractured)
}

/**
 * 切換破裂 id。打開:tradeId 換成 fractured、勾選這條、其他送同一組 fractured id 的 filter 取消勾選;
 * 關閉:tradeId 換回 explicit / pseudo(勾選狀態不動)。不是可切換的 filter 時什麼都不做。
 */
export function applyFracturedToggle (filters: readonly FilterOrGroup[], filter: StatFilter, on: boolean): void {
  const ids = fracturedIds(filter)
  if (!ids) return
  if (on) {
    filter.tradeId = [...ids.fractured]
    filter.disabled = false
    for (const other of filters) {
      if (other.group || other === filter) continue
      if (sameIds(other.tradeId, ids.fractured)) other.disabled = true
    }
  } else {
    filter.tradeId = [...ids.base]
  }
}

/**
 * 破裂物品:每條破裂詞綴讓一列在可見清單(2026-10-14 使用者回報破裂詞綴只在「已隱藏」裡)。
 * 代表列 = explicit 列(tag 不是 fractured),沒有就用孿生(改成一般詞綴:tag explicit、送 explicit id);同組其他列維持隱藏(原本可見的改 hide_for_crafting)。
 * 沒有孿生的物品,破裂詞綴只剩 pseudo 列可代表時把那列顯示出來(不隱藏其他 pseudo 合計)。
 * 孿生當代表列時 tradeId 由 fractured 改 explicit(孿生預設未勾選,但仍以 disabled 條件隨查詢送出)。
 */
export function revealFracturedRows (filters: readonly FilterOrGroup[], item: ParsedItem): void {
  if (!item.isFractured) return
  const groups = new Map<string, StatFilter[]>()
  const pseudo: Array<[string, StatFilter]> = []
  const aggregated: Array<[string, StatFilter]> = []
  for (const f of filters) {
    if (f.group) continue
    const ids = fracturedIds(f)
    if (!ids) continue
    const key = ids.fractured.join('|')
    if (f.fromAggregate) {
      // exile-appraiser: 2026-10-16:被合計吃掉、新列出的原始詞綴列不參與代表列挑選(照舊由孿生 / pseudo 代表),見下方
      aggregated.push([key, f])
    } else if (f.tag === FilterTag.Pseudo) {
      pseudo.push([key, f])
    } else {
      groups.set(key, [...(groups.get(key) ?? []), f])
    }
  }
  if (!hasTwins(item)) {
    for (const [key, f] of pseudo) {
      if (!groups.has(key)) f.hidden = undefined
    }
  }
  for (const rows of groups.values()) {
    const primary = rows.find(f => f.tag !== FilterTag.Fractured) ?? rows[0]
    primary.hidden = undefined
    if (primary.tag === FilterTag.Fractured) {
      // 孿生當代表列時以一般詞綴呈現(標籤、送 explicit id、鈕不亮),與有自己 explicit 列時起始狀態一致
      primary.tag = FilterTag.Explicit
      primary.tradeId = [...fracturedIds(primary)!.base]
    }
    for (const other of rows) {
      if (other !== primary && other.hidden == null) other.hidden = 'filters.hide_for_crafting'
    }
  }
  // exile-appraiser: 2026-10-16:已有代表列(孿生)的破裂詞綴,新列出的同一條原始詞綴列收起,避免同一條詞綴出現兩列
  for (const [key, f] of aggregated) {
    if (groups.has(key)) f.hidden = 'filters.hide_for_crafting'
  }
}

// 2026-10-14 B 改版:切換鈕改成「一般 / 破裂」二選一(FilterModifierFractured.vue),以下兩個是呈現用的包裝,邏輯仍是 applyFracturedToggle。
export type FracturedMode = 'normal' | 'fractured'

/** 二選一目前選中的一邊 */
export function fracturedMode (filter: StatFilter): FracturedMode {
  return isFracturedOn(filter) ? 'fractured' : 'normal'
}

/** 選一邊;已經是那一邊就什麼都不做 */
export function selectFracturedMode (filters: readonly FilterOrGroup[], filter: StatFilter, mode: FracturedMode): void {
  if (fracturedMode(filter) === mode) return
  applyFracturedToggle(filters, filter, mode === 'fractured')
}
