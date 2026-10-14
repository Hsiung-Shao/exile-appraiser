import { createFilters } from "./create-item-filters";
import {
  createExactStatFilters,
  initUiModFilters,
} from "./create-stat-filters";
import { sumStatsByModType } from "@/parser/modifiers";
import { ItemCategory, ItemRarity, ParsedItem } from "@/parser";
import type { FilterPreset } from "./interfaces";
import { hasCraftingValue, likelyFinishedItem } from "./common";
import { createUniquePresets, PRESET_UNIQUES } from "./create-unique-filters";
// exile-appraiser: 破裂詞綴預設可見(自寫 fractured-toggle.ts)
import { revealFracturedRows } from "./fractured-toggle";
// exile-appraiser: 2026-10-15 底材預設(上游 trends 的「有價值底材」判定)
import { isValuableBasetype } from "../trends/getDetailsId";

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V"];

export function createPresets(
  item: ParsedItem,
  opts: {
    league: string;
    currency: string | undefined;
    listingType:
      | "securable"
      | "any"
      | "online"
      | "available"
      | "onlineleague"
      | undefined;
    collapseListings: "app" | "api";
    activateStockFilter: boolean;
    searchStatRange: number;
    useEn: boolean;
    defaultAllSelected: boolean;
  },
): { presets: FilterPreset[]; active: string } {
  // logbooks aren't real anymore
  if (item.info.refName === "logbook here") {
    return {
      active: ROMAN_NUMERALS[0],
      presets: item.logbookAreaMods!.map<FilterPreset>((area, idx) => ({
        id: ROMAN_NUMERALS[idx],
        filters: createFilters(item, { ...opts, exact: true }),
        stats: createExactStatFilters(item, sumStatsByModType(area), opts),
      })),
    };
  }

  if (
    item.isUnidentified ||
    item.rarity === ItemRarity.Normal ||
    (!item.info.craftable && item.rarity !== ItemRarity.Unique) ||
    ((item.category === ItemCategory.Flask ||
      item.category === ItemCategory.Relic ||
      item.category === ItemCategory.Tincture ||
      item.category === ItemCategory.MemoryLine ||
      item.category === ItemCategory.Invitation ||
      item.category === ItemCategory.HeistContract ||
      item.category === ItemCategory.HeistBlueprint ||
      item.category === ItemCategory.Sentinel ||
      item.category === ItemCategory.Tablet ||
      item.category === ItemCategory.Wombgift) &&
      item.rarity !== ItemRarity.Unique) ||
    (item.category === ItemCategory.Currency && item.trials?.numberOfTrials)
  ) {
    return {
      active: "filters.preset_exact",
      presets: [
        {
          id: "filters.preset_exact",
          filters: createFilters(item, { ...opts, exact: true }),
          stats: createExactStatFilters(item, item.statsByType, opts),
        },
      ],
    };
  }

  if (PRESET_UNIQUES.has(item.info.refName)) {
    return createUniquePresets(item, opts);
  }

  // TODO: pseudo change here
  const pseudoPreset: FilterPreset = {
    id: "filters.preset_pseudo",
    filters: createFilters(item, { ...opts, exact: false }),
    stats: initUiModFilters(item, opts),
  };
  // exile-appraiser: 破裂詞綴每條留一列在可見清單,以一般詞綴呈現(孿生當代表列時改送 explicit id)
  revealFracturedRows(pseudoPreset.stats, item);

  // Apply augments if we should
  // if (
  //   (item.rarity === ItemRarity.Magic || item.rarity === ItemRarity.Rare) &&
  //   pseudoPreset.filters.itemEditorSelection &&
  //   !pseudoPreset.filters.itemEditorSelection.disabled &&
  //   opts.autoFillEmptyAugmentSockets
  // ) {
  //   handleApplyItemEdits(
  //     pseudoPreset.stats,
  //     item,
  //     pseudoPreset.filters.tempAugmentStorage ?? [],
  //     opts.autoFillEmptyAugmentSockets ?? "None",
  //   );
  // }

  if (likelyFinishedItem(item) || !hasCraftingValue(item)) {
    return { active: pseudoPreset.id, presets: [pseudoPreset] };
  }

  const baseItemPreset: FilterPreset = {
    id: "filters.preset_base_item",
    filters: createFilters(item, { ...opts, exact: true }),
    stats: createExactStatFilters(item, item.statsByType, opts),
  };

  return {
    // exile-appraiser: 使用者 2026-10-15 裁定(與 EE2 不同,與 PoE1 一致):有「底材」preset 的武器 / 防具 / 飾品 / 箭袋
    // (`isValuableBasetype`;珠寶、換界石等維持上游)預設切到它(查該底材 type,不查類別);
    // preset 內容、順序與詞綴勾選方式維持上游,pseudo 仍可切回
    active: isValuableBasetype(item) ? baseItemPreset.id : pseudoPreset.id,
    presets: [pseudoPreset, baseItemPreset],
  };
}
