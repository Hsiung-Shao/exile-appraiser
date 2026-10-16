import { createFilters, CreateOptions as CreateFiltersOptions } from './create-item-filters'
import { createExactStatFilters, initUiModFilters } from './create-stat-filters'
import { createMercenaryFilters } from './pseudo/mercenary'
// exile-appraiser: 破裂詞綴預設可見(自寫 fractured-toggle.ts)
import { revealFracturedRows } from './fractured-toggle'
// exile-appraiser: 2026-10-16 機制選擇只對魔法 / 稀有物品(自寫 mechanism-toggle.ts)
import { markMechanismEligibility } from './mechanism-toggle'
import { ModifierType, sumStatsByModType } from '@/parser/modifiers'
import { ItemCategory, ItemRarity, ParsedItem } from '@/parser'
import type { FilterPreset } from './interfaces'

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V']

type CreatePresetsOptions =
  & Omit<CreateFiltersOptions, 'exact'>
  & { searchStatRange: number }

// exile-appraiser: 2026-10-16 包一層:所有 preset 的列依物品標 noMechanism(機制選擇只對魔法 / 稀有)
export function createPresets (
  item: ParsedItem,
  opts: CreatePresetsOptions
): { presets: FilterPreset[], active: string } {
  const result = createPresetsUpstream(item, opts)
  for (const p of result.presets) markMechanismEligibility(p.stats, item)
  return result
}

function createPresetsUpstream (
  item: ParsedItem,
  opts: CreatePresetsOptions
): { presets: FilterPreset[], active: string } {
  if (item.info.refName === 'Expedition Logbook') {
    return {
      active: ROMAN_NUMERALS[0],
      presets: item.logbookAreaMods!.map<FilterPreset>((area, idx) => ({
        id: ROMAN_NUMERALS[idx],
        filters: createFilters(item, { ...opts, exact: true }),
        stats: createExactStatFilters(item, sumStatsByModType(area), opts)
      }))
    }
  } else if (item.info.refName === 'Mercenary Warrant') {
    return {
      active: 'filters.preset_exact',
      presets: [{
        id: 'filters.preset_exact',
        filters: createFilters(item, { ...opts, exact: true }),
        stats: createMercenaryFilters(item)
      }]
    }
  }

  if (
    (!item.info.craftable && item.rarity !== ItemRarity.Unique) ||
    item.isUnidentified ||
    item.rarity === ItemRarity.Normal ||
    (item.category === ItemCategory.Flask && item.rarity !== ItemRarity.Unique) ||
    (item.category === ItemCategory.Tincture && item.rarity !== ItemRarity.Unique) ||
    (item.category === ItemCategory.SanctumRelic && item.rarity !== ItemRarity.Unique) ||
    (item.category === ItemCategory.Idol && item.rarity !== ItemRarity.Unique) ||
    item.category === ItemCategory.Charm ||
    item.category === ItemCategory.Map ||
    item.category === ItemCategory.MemoryLine ||
    item.category === ItemCategory.Invitation ||
    item.category === ItemCategory.HeistContract ||
    item.category === ItemCategory.HeistBlueprint ||
    item.category === ItemCategory.Chart ||
    item.category === ItemCategory.Sentinel
  ) {
    if (item.rarity !== ItemRarity.Unique && (
      (item.category === ItemCategory.Map && !item.mapCompletionReward) ||
      item.category === ItemCategory.Chart
    )) {
      const bulkPreset: FilterPreset = {
        id: 'filters.preset_bulk',
        filters: createFilters(item, { ...opts, exact: true }),
        stats: createExactStatFilters(item, item.statsByType, { ...opts, mode: 'bulk' })
      }
      if (item.rarity === ItemRarity.Rare && !item.isUnidentified && !item.info.area?.blighted) {
        const propsPreset: FilterPreset = {
          id: 'filters.preset_pseudo',
          filters: createFilters(item, { ...opts, exact: true }),
          stats: createExactStatFilters(item, item.statsByType, { ...opts, mode: 'props' })
        }
        return {
          active: (item.category === ItemCategory.Chart && item.mapArea!.area!.special)
            ? bulkPreset.id
            : propsPreset.id,
          presets: [propsPreset, bulkPreset]
        }
      } else {
        return { active: bulkPreset.id, presets: [bulkPreset] }
      }
    }

    return {
      active: 'filters.preset_exact',
      presets: [{
        id: 'filters.preset_exact',
        filters: createFilters(item, { ...opts, exact: true }),
        stats: createExactStatFilters(item, item.statsByType, opts)
      }]
    }
  }

  const pseudoPreset: FilterPreset = {
    id: 'filters.preset_pseudo',
    filters: createFilters(item, { ...opts, exact: false }),
    stats: initUiModFilters(item, opts)
  }
  // exile-appraiser: 破裂詞綴每條留一列在可見清單,以一般詞綴呈現(孿生當代表列時改送 explicit id)
  revealFracturedRows(pseudoPreset.stats, item)

  const likelyFinishedItem = (
    item.rarity === ItemRarity.Unique ||
    item.statsByType.some(calc => calc.type === ModifierType.Crafted) ||
    (item.quality === 20 && !item.memoryStrands) || // quality > 20 can be used for selling bases, quality < 20 drops sometimes
    item.isCorrupted ||
    item.isMirrored
  )

  const hasCraftingValue = (
    item.isSynthesised ||
    item.isFractured ||
    item.influences.length ||
    item.category === ItemCategory.ClusterJewel ||
    (item.category === ItemCategory.Jewel && item.rarity === ItemRarity.Magic) ||
    (item.category !== ItemCategory.Jewel &&
      item.category !== ItemCategory.AbyssJewel &&
      item.itemLevel! >= 82)
  )

  if (likelyFinishedItem || !hasCraftingValue) {
    return { active: pseudoPreset.id, presets: [pseudoPreset] }
  }

  const baseItemPreset: FilterPreset = {
    id: 'filters.preset_base_item',
    filters: createFilters(item, { ...opts, exact: true }),
    stats: createExactStatFilters(item, item.statsByType, opts)
  }

  return {
    active: pseudoPreset.id,
    presets: [pseudoPreset, baseItemPreset]
  }
}
