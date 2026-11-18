import { stat, pseudoStatByRef } from '@/assets/data'
import { ItemRarity, ItemCategory } from '@/parser'
import { ModifierType } from '@/parser/modifiers'
import { FiltersCreationContext } from '../create-stat-filters'
import { noSourcePseudoToFilter, propToFilter } from './item-property'
import { findAndResolveByRef, statToNotFilter } from './utils'

const PSEUDO = {
  MORE_MAPS: stat('More Maps: #%'),
  // exile-appraiser: 2026-11-16 恢復(3.30 聖甲蟲改名綢帶,地圖仍有這一行;交易站條件 id 沒變)
  MORE_SCARABS: stat('More Scarabs: #%'),
  MORE_DIVINATION_CARDS: stat('More Divination Cards: #%'),
  MORE_CURRENCY: stat('More Currency: #%'),
  EXPLICIT_MODIFIERS: stat('# Modifiers')
}

const VALDO_LETHAL_STATS = [
  stat('Players who Die in area are sent to the Void')
]

function areaProps (
  { disabled }: { disabled: { itemQuantity?: boolean, atlasDrops?: boolean, itemRarity?: boolean, packSize?: boolean } },
  ctx: FiltersCreationContext
): void {
  const { item } = ctx

  if (item.areaItemQuantity) {
    ctx.filters.push(propToFilter({
      ref: 'Item Quantity: +#%',
      tradeId: 'item.map_item_quantity',
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.areaItemQuantity },
      sources: [],
      disabled: disabled.itemQuantity
    }, ctx))
  }
  // exile-appraiser: 3.30 輿圖掉落物(地圖上取代物品數量的位置)
  if (item.areaAtlasDrops) {
    ctx.filters.push(propToFilter({
      ref: 'Atlas Drops: +#%',
      tradeId: 'item.map_atlas_drops',
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.areaAtlasDrops },
      sources: [],
      disabled: disabled.atlasDrops
    }, ctx))
  }
  if (item.areaItemRarity) {
    ctx.filters.push(propToFilter({
      ref: 'Item Rarity: +#%',
      tradeId: 'item.map_item_rarity',
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.areaItemRarity },
      sources: [],
      disabled: disabled.itemRarity
    }, ctx))
  }
  if (item.areaPackSize) {
    ctx.filters.push(propToFilter({
      ref: 'Monster Pack Size: +#%',
      tradeId: 'item.map_pack_size',
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.areaPackSize },
      sources: [],
      disabled: disabled.packSize
    }, ctx))
  }
}

export function mapProps (bulk: boolean, ctx: FiltersCreationContext): void {
  const { item } = ctx
  if (item.category !== ItemCategory.Map || item.mapCompletionReward || item.rarity === ItemRarity.Unique) return

  if (!bulk) {
    // 本 fork:更多地圖也算「更多掉落」。這張圖賣的是掉落量,稀有度拿來當條件只會把
    // 結果篩掉(使用者截圖:數量與群大小有勾、稀有度沒勾)。上游把更多地圖排除在外。
    // exile-appraiser: 更多聖甲蟲(3.30 起顯示「更多 綢帶」)2026-11-08 一度不送,2026-11-16 恢復
    const hasValuableDrops = Boolean(item.mapMoreMaps || item.mapMoreScarabs || item.mapMoreCurrency || item.mapMoreDivCards)

    areaProps({
      disabled: {
        itemQuantity: false,
        atlasDrops: true, // exile-appraiser: 2026-11-18 使用者:保留但預設不勾
        itemRarity: hasValuableDrops,
        packSize: false
      }
    }, ctx)

    if (item.mapMoreMaps) {
      ctx.filters.push(noSourcePseudoToFilter({
        pseudo: pseudoStatByRef(PSEUDO.MORE_MAPS)!,
        roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.mapMoreMaps },
        // 本 fork:更多地圖與其他三種 more-drops 同類,預設一律勾選(回歸網 map-price-mods)
        disabled: false
      }, ctx))
    }
    if (item.mapMoreScarabs) {
      ctx.filters.push(noSourcePseudoToFilter({
        pseudo: pseudoStatByRef(PSEUDO.MORE_SCARABS)!,
        roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.mapMoreScarabs },
        disabled: false
      }, ctx))
    }
    if (item.mapMoreCurrency) {
      ctx.filters.push(noSourcePseudoToFilter({
        pseudo: pseudoStatByRef(PSEUDO.MORE_CURRENCY)!,
        roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.mapMoreCurrency },
        disabled: false
      }, ctx))
    }
    if (item.mapMoreDivCards) {
      ctx.filters.push(noSourcePseudoToFilter({
        pseudo: pseudoStatByRef(PSEUDO.MORE_DIVINATION_CARDS)!,
        roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.mapMoreDivCards },
        disabled: false
      }, ctx))
    }
  }

  const explicitMods = item.newMods.filter(mod => mod.info.generation === 'prefix' || mod.info.generation === 'suffix')
  if (explicitMods.length === 8) {
    ctx.filters.push(noSourcePseudoToFilter({
      pseudo: pseudoStatByRef(PSEUDO.EXPLICIT_MODIFIERS)!,
      roll: { min: 0, max: 8, value: explicitMods.length },
      disabled: false
    }, { ...ctx, searchInRange: 0 }))
  }
}

export function chartProps (bulk: boolean, ctx: FiltersCreationContext): void {
  const { item } = ctx
  if (bulk || item.category !== ItemCategory.Chart) return

  areaProps({
    disabled: {
      itemQuantity: false,
      atlasDrops: false,
      itemRarity: false,
      packSize: false
    }
  }, ctx)

  if (item.chartSulphur) {
    ctx.filters.push(propToFilter({
      ref: "Dead Man's Sulphur: +#%",
      tradeId: 'item.chart_sulphur',
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.chartSulphur },
      sources: [],
      disabled: false
    }, ctx))
  }
}

export function valdoBadMods (ctx: FiltersCreationContext): void {
  if (!ctx.item.mapCompletionReward) return

  for (const lethalStatRef of VALDO_LETHAL_STATS) {
    if (ctx.item.statsByType.some(calc => calc.stat.ref === lethalStatRef)) continue

    const lethalStat = findAndResolveByRef(lethalStatRef, ModifierType.Explicit, ctx.item.category)
    const filter = statToNotFilter({
      stat: lethalStat,
      type: ModifierType.Explicit,
      disabled: false
    })
    ctx.filters.push(filter)
  }
}
