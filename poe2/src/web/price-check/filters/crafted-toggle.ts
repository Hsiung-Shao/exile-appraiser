// exile-appraiser: 自寫(非上游移植)。2026-10-16 使用者回報:工藝詞綴在面板標成「隨機」、送 explicit id。
// 查價面板「一般 / 工藝」二選一的純邏輯(元件 FilterModifierCrafted.vue),照 fractured-toggle.ts 的做法:
// 工藝詞綴在 initUiModFilters 被併成 explicit 列(有 explicit id 時);物品可再製作時另推一條 tag = crafted、
// 送 crafted id 的孿生(hide_for_crafting 隱藏)。
// - 切換只在可見、來源全部是工藝詞綴、stat 同時有 explicit / crafted id 的非 pseudo 列。
// - 選工藝 = tradeId 換 crafted、勾選、其他送同一組 crafted id 的列(孿生)取消勾選;選一般 = 換回 explicit(勾選不動)。不改 tag。
// - 預設一般;勾選中的一般列在查詢另加 not 群組排除這條的工藝版本(trade/pathofexile-trade.ts),
//   沒勾選時查詢與改版前逐字相同。整份 stats 共用 FiltersBlock 的 FRACTURED_FILTERS_KEY。
import { ModifierType } from "@/parser/modifiers";
import { FilterTag, type StatFilter } from "./interfaces";

export interface CraftedIds {
  /** 一般 = explicit */
  base: string[];
  crafted: string[];
}

export type CraftedMode = "normal" | "crafted";

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** 這條 filter 的一般 / 工藝兩組 trade id;不適用時回 null。 */
export function craftedIds(filter: StatFilter): CraftedIds | null {
  if (filter.tag === FilterTag.Pseudo || !filter.sources.length) return null;
  if (
    !filter.sources.every((s) => s.modifier.info.type === ModifierType.Crafted)
  )
    return null;
  const ids = filter.sources[0].stat.stat.trade.ids;
  const base = ids[ModifierType.Explicit];
  const crafted = ids[ModifierType.Crafted];
  if (!base?.length || !crafted?.length) return null;
  if (!sameIds(filter.tradeId, base) && !sameIds(filter.tradeId, crafted))
    return null;
  return { base, crafted };
}

/** 可見的工藝來源列才顯示二選一 */
export function canToggleCrafted(filter: StatFilter): boolean {
  return filter.hidden == null && craftedIds(filter) != null;
}

/** 目前選中的一邊 */
export function craftedMode(filter: StatFilter): CraftedMode {
  const ids = craftedIds(filter);
  return ids != null && sameIds(filter.tradeId, ids.crafted)
    ? "crafted"
    : "normal";
}

/** 選一邊;已經是那一邊或不適用就什麼都不做 */
export function selectCraftedMode(
  filters: readonly StatFilter[],
  filter: StatFilter,
  mode: CraftedMode,
): void {
  const ids = craftedIds(filter);
  if (!ids || craftedMode(filter) === mode) return;
  if (mode === "crafted") {
    filter.tradeId = [...ids.crafted];
    filter.disabled = false;
    for (const other of filters) {
      if (other === filter) continue;
      if (sameIds(other.tradeId, ids.crafted)) other.disabled = true;
    }
  } else {
    filter.tradeId = [...ids.base];
  }
}
