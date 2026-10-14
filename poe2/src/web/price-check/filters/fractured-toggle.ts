// exile-appraiser: 自寫(非上游移植)。查價面板「破裂」切換鈕的純邏輯(元件 FilterModifierFractured.vue)。
// 與 poe1 同名檔同規則。PoE2 的 explicit 類詞綴來源會合併(sumStatsByModType 的 typesCanBeGrouped),
// 所以只有「來源全部是破裂詞綴」的那條才給切換鈕 —— 混了一般詞綴的合計值不能拿去查破裂 id。
// 破裂詞綴可能被 pseudo 合計吃掉 → 切換鈕在 pseudo 列(關閉時回 pseudo id;tag 不改,就是回哪一種 id 的記憶)。
// 物品可再製作時 initUiModFilters 另推一條 tag = fractured 的隱藏孿生(hide_for_crafting);
// 打開時把其他送同一組 fractured id 的 filter 取消勾選,保證同一 stat 只有一條啟用。
import { STAT_BY_REF } from "@/assets/data";
import type { ParsedItem } from "@/parser";
import { ModifierType } from "@/parser/modifiers";
import { FilterTag, type StatFilter } from "./interfaces";

/**
 * FiltersBlock provide 目前整份 stats 的 getter,切換鈕打開時用來取消勾選孿生;沒注入 = 只改這一條。
 * 刻意不用 vue 的 InjectionKey 型別(src-coupling 守門:src 的 .ts 不 import vue),型別寫在 inject 端。
 */
export const FRACTURED_FILTERS_KEY = Symbol("ppz-fractured-filters");

export interface FracturedIds {
  /** 關閉時的 id:一般列 = explicit、pseudo 列 = 該 pseudo 的 id */
  base: string[];
  fractured: string[];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * 這條 filter 的關閉 / 打開兩組 trade id;不是破裂詞綴或缺 id 時回 null。
 * pseudo 列只在「唯一來源是破裂詞綴、且沒有倍率換算」時可切換(合計值才等於那條破裂詞綴的值)。
 */
export function fracturedIds(filter: StatFilter): FracturedIds | null {
  if (filter.tag === FilterTag.Fractured || !filter.sources.length) return null;
  if (
    !filter.sources.every(
      (s) => s.modifier.info.type === ModifierType.Fractured,
    )
  )
    return null;
  const src = filter.sources[0];
  const fractured = src.stat.stat.trade.ids[ModifierType.Fractured];
  let base: string[] | undefined;
  if (filter.tag === FilterTag.Pseudo) {
    if (
      filter.sources.length !== 1 ||
      src.contributes?.value !== src.stat.roll?.value
    )
      return null;
    base = STAT_BY_REF(filter.statRef)?.trade.ids[ModifierType.Pseudo];
  } else {
    base = src.stat.stat.trade.ids[ModifierType.Explicit];
  }
  if (!base?.length || !fractured?.length) return null;
  if (!sameIds(filter.tradeId, base) && !sameIds(filter.tradeId, fractured))
    return null;
  return { base, fractured };
}

/** 破裂物品的破裂詞綴(且 stat 有 fractured id)才顯示切換鈕。 */
export function canToggleFractured(
  filter: StatFilter,
  item: ParsedItem,
): boolean {
  return Boolean(item.isFractured) && fracturedIds(filter) != null;
}

/** 目前是否改送破裂 id。 */
export function isFracturedOn(filter: StatFilter): boolean {
  const ids = fracturedIds(filter);
  return ids != null && sameIds(filter.tradeId, ids.fractured);
}

/**
 * 切換破裂 id。打開:tradeId 換成 fractured、勾選這條、其他送同一組 fractured id 的 filter 取消勾選;
 * 關閉:tradeId 換回 explicit / pseudo(勾選狀態不動)。不是可切換的 filter 時什麼都不做。
 */
export function applyFracturedToggle(
  filters: readonly StatFilter[],
  filter: StatFilter,
  on: boolean,
): void {
  const ids = fracturedIds(filter);
  if (!ids) return;
  if (on) {
    filter.tradeId = [...ids.fractured];
    filter.disabled = false;
    for (const other of filters) {
      if (other === filter) continue;
      if (sameIds(other.tradeId, ids.fractured)) other.disabled = true;
    }
  } else {
    filter.tradeId = [...ids.base];
  }
}
