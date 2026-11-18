import { ItemInfluence, ItemCategory } from '@/parser'
import { ItemFilters, StatFilter, FilterOrGroup, INTERNAL_TRADE_IDS, InternalTradeId, FilterTag } from '../filters/interfaces'
import { setProperty as propSet } from 'dot-prop'
import { DateTime } from 'luxon'
import { TradeResponse, Account, adjustRateLimits, preventQueueCreation, tradeSession } from './common'
import type { TradeContext } from '@exile-appraiser/core/games/adapter'
import { apiBase } from '@exile-appraiser/core/realm'
import { stat, STAT_BY_REF_V2, pseudoStatByRef } from '@/assets/data'
import { decodeFamilyFromSource as decodeMercenarySupports, SearchMode as MercSearchMode } from '../filters/pseudo/mercenary'
import { RateLimiter } from './RateLimiter'
import { ModifierType } from '@/parser/modifiers'
import { Cache } from './Cache'
// exile-appraiser(2026-10-15):查價結果懸停浮窗(PoE1 版,移植 EE2 MIT;只加 displayItem,不動查詢組法)
import { parseFetchItem, type DisplayItem, type FetchItem } from './display-item'
import { displayZhFor } from './display-zh'
import { mechanismNotIds } from '../filters/mechanism-toggle' // exile-appraiser: 2026-10-16 機制選擇「一般」排除

export const CATEGORY_TO_TRADE_ID = new Map([
  [ItemCategory.Map, 'map'],
  [ItemCategory.AbyssJewel, 'jewel.abyss'],
  [ItemCategory.Amulet, 'accessory.amulet'],
  [ItemCategory.Belt, 'accessory.belt'],
  [ItemCategory.BodyArmour, 'armour.chest'],
  [ItemCategory.Boots, 'armour.boots'],
  [ItemCategory.Bow, 'weapon.bow'],
  [ItemCategory.Claw, 'weapon.claw'],
  [ItemCategory.Dagger, 'weapon.dagger'],
  [ItemCategory.FishingRod, 'weapon.rod'],
  [ItemCategory.Flask, 'flask'],
  [ItemCategory.Gloves, 'armour.gloves'],
  [ItemCategory.Helmet, 'armour.helmet'],
  [ItemCategory.Jewel, 'jewel'],
  [ItemCategory.OneHandedAxe, 'weapon.oneaxe'],
  [ItemCategory.OneHandedMace, 'weapon.onemace'],
  [ItemCategory.OneHandedSword, 'weapon.onesword'],
  [ItemCategory.Quiver, 'armour.quiver'],
  [ItemCategory.Ring, 'accessory.ring'],
  [ItemCategory.RuneDagger, 'weapon.runedagger'],
  [ItemCategory.Sceptre, 'weapon.sceptre'],
  [ItemCategory.Shield, 'armour.shield'],
  [ItemCategory.Staff, 'weapon.staff'],
  [ItemCategory.TwoHandedAxe, 'weapon.twoaxe'],
  [ItemCategory.TwoHandedMace, 'weapon.twomace'],
  [ItemCategory.TwoHandedSword, 'weapon.twosword'],
  [ItemCategory.Wand, 'weapon.wand'],
  [ItemCategory.Warstaff, 'weapon.warstaff'],
  [ItemCategory.ClusterJewel, 'jewel.cluster'],
  [ItemCategory.HeistBlueprint, 'heistmission.blueprint'],
  [ItemCategory.HeistContract, 'heistmission.contract'],
  [ItemCategory.HeistTool, 'heistequipment.heisttool'],
  [ItemCategory.HeistBrooch, 'heistequipment.heistreward'],
  [ItemCategory.HeistGear, 'heistequipment.heistweapon'],
  [ItemCategory.HeistCloak, 'heistequipment.heistutility'],
  [ItemCategory.Trinket, 'accessory.trinket'],
  [ItemCategory.SanctumRelic, 'sanctum.relic'],
  [ItemCategory.Tincture, 'tincture'],
  [ItemCategory.Charm, 'azmeri.charm'],
  [ItemCategory.Idol, 'idol'],
  [ItemCategory.Graft, 'graft'],
  [ItemCategory.Chart, 'chart']
])

const TOTAL_MODS_TEXT = {
  CRAFTED_MODIFIERS: [
    stat('# Crafted Modifiers'),
    stat('# Crafted Prefix Modifiers'),
    stat('# Crafted Suffix Modifiers')
  ],
  EMPTY_MODIFIERS: [
    stat('# Empty Modifiers'),
    stat('# Empty Prefix Modifiers'),
    stat('# Empty Suffix Modifiers')
  ],
  TOTAL_MODIFIERS: [
    stat('# Modifiers'),
    stat('# Prefix Modifiers'),
    stat('# Suffix Modifiers')
  ]
}

const INFLUENCE_PSEUDO_TEXT = {
  [ItemInfluence.Shaper]: stat('Has Shaper Influence'),
  [ItemInfluence.Crusader]: stat('Has Crusader Influence'),
  [ItemInfluence.Hunter]: stat('Has Hunter Influence'),
  [ItemInfluence.Elder]: stat('Has Elder Influence'),
  [ItemInfluence.Redeemer]: stat('Has Redeemer Influence'),
  [ItemInfluence.Warlord]: stat('Has Warlord Influence')
}

interface FilterBoolean { option?: 'true' | 'false' }
interface FilterRange { min?: number, max?: number }

interface TradeRequest {
  query: {
    status: { option: 'online' | 'securable' | 'available' | 'any' }
    name?: string | { discriminator: string, option: string }
    type?: string | { discriminator: string, option: string }
    stats: Array<{
      type: 'and' | 'if' | 'count' | 'not' | 'mercenary'
      value?: FilterRange
      filters: Array<{
        id: string
        value?: {
          min?: number
          max?: number
          option?: number | string
        }
        disabled?: boolean
      }>
      disabled?: boolean
    }>
    filters: {
      type_filters?: {
        filters: {
          rarity?: {
            option?: 'nonunique' | 'uniquefoil'
          }
          category?: {
            option?: string
          }
        }
      }
      socket_filters?: {
        filters: {
          links?: FilterRange
          sockets?: {
            w?: number
          }
        }
      }
      misc_filters?: {
        filters: {
          ilvl?: FilterRange
          quality?: FilterRange
          gem_level?: FilterRange
          corrupted?: FilterBoolean
          fractured_item?: FilterBoolean
          gem_imbued?: FilterBoolean
          mirrored?: FilterBoolean
          split?: FilterBoolean
          identified?: FilterBoolean
          unidentified_tier?: FilterRange
          fated?: FilterBoolean
          stack_size?: FilterRange
          memory_level?: FilterRange
          foulborn_item?: FilterBoolean
          vestigial?: FilterBoolean
        }
      }
      armour_filters?: {
        filters: {
          ar?: FilterRange
          es?: FilterRange
          ev?: FilterRange
          ward?: FilterRange
          block?: FilterRange
          base_defence_percentile?: FilterRange
        }
      }
      weapon_filters?: {
        filters: {
          dps?: FilterRange
          pdps?: FilterRange
          edps?: FilterRange
          crit?: FilterRange
          aps?: FilterRange
        }
      }
      map_filters?: {
        filters: {
          map_tier?: FilterRange
          map_iiq?: FilterRange
          map_iir?: FilterRange
          map_packsize?: FilterRange
          map_blighted?: FilterBoolean
          map_uberblighted?: FilterBoolean
          area_level?: FilterRange
          map_completion_reward?: { option?: 'any' | string }
          chart_sulphur?: FilterRange
        }
      }
      ultimatum_filters?: {
        filters: {
          // option id 直接沿用 GGPK 的 ident,見 parser 的 parseUltimatum
          ultimatum_challenge?: { option?: string }
          ultimatum_reward?: { option?: string }
          // 這兩個在交易站是自由文字(沒有下拉選項),填的是物品名
          ultimatum_input?: { option?: string }
        }
      }
      heist_filters?: {
        filters: {
          heist_wings?: FilterRange
          heist_objective_value?: { option?: 'priceless' }
          heist_agility?: FilterRange
          heist_brute_force?: FilterRange
          heist_counter_thaumaturgy?: FilterRange
          heist_deception?: FilterRange
          heist_demolition?: FilterRange
          heist_engineering?: FilterRange
          heist_lockpicking?: FilterRange
          heist_perception?: FilterRange
          heist_trap_disarmament?: FilterRange
        }
      }
      sentinel_filters?: {
        filters: {
          sentinel_durability?: FilterRange
        }
      }
      trade_filters?: {
        filters: {
          collapse?: FilterBoolean
          indexed?: { option?: string }
          price?: FilterRange | { option?: string }
        }
      }
    }
  }
  sort: {
    price: 'asc'
  }
}

type TradeStatGroup = TradeRequest['query']['stats'][number]

export interface SearchResult {
  id: string
  result: string[]
  total: number
  inexact?: boolean
}

interface FetchResult {
  id: string
  // exile-appraiser(2026-10-15):浮窗要用的其餘欄位見 display-item.ts 的 FetchItem
  item: FetchItem & {
    ilvl?: number
    stackSize?: number
    corrupted?: boolean
    properties?: Array<{
      name: string
      values: [[string, number]]
      type?:
      78 | // Corpse Level (Filled Coffin)
      30 | // Spawns a Level %0 Monster when Harvested
      6 | // Quality
      5 | // Level
      number
    }>
    note?: string
  }
  listing: {
    indexed: string
    price?: {
      amount: number
      currency: string
      type: '~price'
    }
    fee?: number
    account: Account
  }
}

export interface PricingResult {
  id: string
  itemLevel?: string
  stackSize?: number
  corrupted?: boolean
  quality?: string
  level?: string
  relativeDate: string
  priceAmount: number
  priceCurrency: string
  isMine: boolean
  hasNote: boolean
  hasFee: boolean
  accountName: string
  accountStatus: 'offline' | 'online' | 'afk'
  ign: string
  // exile-appraiser(2026-10-15):懸停浮窗的物品資料(國際服 + 介面繁中時已換成繁中,display-zh.ts)
  displayItem?: DisplayItem
}

export function createTradeRequest (filters: ItemFilters, stats: FilterOrGroup[]) {
  const body: TradeRequest = {
    query: {
      status: {
        option: filters.trade.offline
          ? 'any'
          : (filters.trade.merchantOnly ? 'securable' : 'available')
      },
      stats: [
        { type: 'and', filters: [] }
      ],
      filters: {}
    },
    sort: {
      price: 'asc'
    }
  }
  const { query } = body

  if (filters.trade.currency) {
    propSet(query.filters, 'trade_filters.filters.price.option', filters.trade.currency)
  }

  if (
    filters.trade.collapseListings === 'api' &&
    (filters.trade.offline || !filters.trade.merchantOnly || filters.trade.collapseMerchant)
  ) {
    propSet(query.filters, 'trade_filters.filters.collapse.option', String(true))
  }

  if (filters.trade.listed) {
    propSet(query.filters, 'trade_filters.filters.indexed.option', filters.trade.listed)
  }

  let activeSearch = (filters.searchRelaxed && !filters.searchRelaxed.disabled)
    ? filters.searchRelaxed
    : filters.searchExact
  if (activeSearch.sub && !activeSearch.sub.disabled) {
    activeSearch = activeSearch.sub
  }

  if (activeSearch.nameTrade) {
    query.name = nameToQuery(activeSearch.nameTrade, activeSearch.discriminatorTrade)
  } else if (activeSearch.name) {
    query.name = nameToQuery(activeSearch.name, activeSearch.discriminatorTrade)
  }

  if (activeSearch.baseTypeTrade) {
    query.type = nameToQuery(activeSearch.baseTypeTrade, activeSearch.discriminatorTrade)
  } else if (activeSearch.baseType) {
    query.type = nameToQuery(activeSearch.baseType, activeSearch.discriminatorTrade)
  }

  if (filters.foil && !filters.foil.disabled) {
    propSet(query.filters, 'type_filters.filters.rarity.option', 'uniquefoil')
  } else if (filters.rarity) {
    propSet(query.filters, 'type_filters.filters.rarity.option', (filters.rarity.disabled) ? 'nonunique' : filters.rarity.value)
  }

  if (activeSearch.category) {
    const id = CATEGORY_TO_TRADE_ID.get(activeSearch.category)
    if (id) {
      propSet(query.filters, 'type_filters.filters.category.option', id)
    } else {
      throw new Error(`Invalid category: ${activeSearch.category}`)
    }
  }

  if (filters.corrupted?.value === false || filters.corrupted?.exact) {
    propSet(query.filters, 'misc_filters.filters.corrupted.option', String(filters.corrupted.value))
  }
  if (filters.fractured?.value === false) {
    propSet(query.filters, 'misc_filters.filters.fractured_item.option', String(false))
  }
  if (filters.imbuedGem?.disabled) {
    propSet(query.filters, 'misc_filters.filters.gem_imbued.option', String(false))
  }
  if (filters.split?.disabled) {
    propSet(query.filters, 'misc_filters.filters.split.option', String(false))
  }
  if (filters.foulborn?.value === false) {
    propSet(query.filters, 'misc_filters.filters.foulborn_item.option', String(false))
  }
  // 與上面的 foulborn 不同,這裡**兩個方向都送**。foulborn 只送 false 是因為
  // `foulborn_item` 這個篩選器四個 realm 都已經不存在了(實測 intl/tw/kr/cn 皆無),
  // 送了也是被忽略;`vestigial` 則四個 realm 都在。只送 false 的話,查一件殘存傳奇
  // 會連普通版一起撈回來,而兩者價格差很多。
  if (filters.vestigial) {
    propSet(query.filters, 'misc_filters.filters.vestigial.option', String(filters.vestigial.value))
  }
  if (filters.mirrored?.disabled) {
    propSet(query.filters, 'misc_filters.filters.mirrored.option', String(false))
  }

  if (filters.gemLevel && !filters.gemLevel.disabled) {
    propSet(query.filters, 'misc_filters.filters.gem_level.min', filters.gemLevel.value)
  }

  if (filters.quality && !filters.quality.disabled) {
    propSet(query.filters, 'misc_filters.filters.quality.min', filters.quality.value)
  }

  if (filters.itemLevel && !filters.itemLevel.disabled) {
    propSet(query.filters, 'misc_filters.filters.ilvl.min', filters.itemLevel.value)
    if (filters.itemLevel.max) {
      propSet(query.filters, 'misc_filters.filters.ilvl.max', filters.itemLevel.max)
    }
  }

  if (filters.stackSize && !filters.stackSize.disabled) {
    propSet(query.filters, 'misc_filters.filters.stack_size.min', filters.stackSize.value)
  }

  if (filters.linkedSockets && !filters.linkedSockets.disabled) {
    propSet(query.filters, 'socket_filters.filters.links.min', filters.linkedSockets.value)
  }

  if (filters.whiteSockets && !filters.whiteSockets.disabled) {
    propSet(query.filters, 'socket_filters.filters.sockets.w', filters.whiteSockets.value)
  }

  if (filters.mapTier && !filters.mapTier.disabled) {
    propSet(query.filters, 'map_filters.filters.map_tier.min', filters.mapTier.value)
    propSet(query.filters, 'map_filters.filters.map_tier.max', filters.mapTier.value)
  }

  if (filters.mapBlighted) {
    if (filters.mapBlighted.value === 'Blighted') {
      propSet(query.filters, 'map_filters.filters.map_blighted.option', String(true))
    } else if (filters.mapBlighted.value === 'Blight-ravaged') {
      propSet(query.filters, 'map_filters.filters.map_uberblighted.option', String(true))
    } else if (filters.mapBlighted.value === false) {
      propSet(query.filters, 'map_filters.filters.map_blighted.option', String(false))
      propSet(query.filters, 'map_filters.filters.map_uberblighted.option', String(false))
    }
  }

  if (filters.mapCompletionReward) {
    propSet(query.filters, 'map_filters.filters.map_completion_reward.option', filters.mapCompletionReward.nameTrade)
  }

  if (filters.unidentified && !filters.unidentified.disabled) {
    propSet(query.filters, 'misc_filters.filters.identified.option', String(false))
  }
  // exile-appraiser: 3.30 未鑑定階級與「命運」(GitHub issue #37)。欄位名取自兩區的 /api/trade/data/filters(2026-11-19 實抓:
  // 國際服 unidentified_tier "Unidentified Tier" / fated "Fated",台服「未鑑定階級」/「命定」,都在 misc_filters)
  if (filters.unidentifiedTier && !filters.unidentifiedTier.disabled) {
    propSet(query.filters, 'misc_filters.filters.unidentified_tier.min', filters.unidentifiedTier.value)
  }
  if (filters.fated && !filters.fated.disabled) {
    propSet(query.filters, 'misc_filters.filters.fated.option', String(true))
  }

  if (filters.areaLevel && !filters.areaLevel.disabled) {
    propSet(query.filters, 'map_filters.filters.area_level.min', filters.areaLevel.value)
    if (filters.areaLevel.max) {
      propSet(query.filters, 'map_filters.filters.area_level.max', filters.areaLevel.max)
    }
  }

  if (filters.ultimatum && !filters.ultimatum.disabled) {
    // 每一項各自判斷 —— 認不出來的欄位是 undefined,那就不送,退回只搜物品名
    if (filters.ultimatum.challenge) {
      propSet(query.filters, 'ultimatum_filters.filters.ultimatum_challenge.option', filters.ultimatum.challenge)
    }
    if (filters.ultimatum.reward) {
      propSet(query.filters, 'ultimatum_filters.filters.ultimatum_reward.option', filters.ultimatum.reward)
    }
    if (filters.ultimatum.sacrifice) {
      propSet(query.filters, 'ultimatum_filters.filters.ultimatum_input.option', filters.ultimatum.sacrifice)
    }
  }

  if (filters.sentinelCharge && !filters.sentinelCharge.disabled) {
    propSet(query.filters, 'sentinel_filters.filters.sentinel_durability.min', filters.sentinelCharge.value)
  }

  for (const stat of stats) {
    if (stat.group || !stat.tradeId[0].startsWith('item.')) continue

    if (stat.tradeId[0] === 'item.has_empty_modifier') {
      const TARGET_ID = {
        CRAFTED_MODIFIERS: pseudoStatByRef(TOTAL_MODS_TEXT.CRAFTED_MODIFIERS[stat.option!.value])!.trade.ids[ModifierType.Pseudo][0],
        EMPTY_MODIFIERS: pseudoStatByRef(TOTAL_MODS_TEXT.EMPTY_MODIFIERS[stat.option!.value])!.trade.ids[ModifierType.Pseudo][0],
        TOTAL_MODIFIERS: pseudoStatByRef(TOTAL_MODS_TEXT.TOTAL_MODIFIERS[0])!.trade.ids[ModifierType.Pseudo][0]
      }

      query.stats.push({
        type: 'count',
        value: { min: 1, max: 1 },
        disabled: stat.disabled,
        filters: [
          { id: TARGET_ID.EMPTY_MODIFIERS, value: { min: 1, max: 1 }, disabled: stat.disabled },
          { id: TARGET_ID.CRAFTED_MODIFIERS, value: { min: 1, max: undefined }, disabled: stat.disabled }
        ]
      })

      query.stats.push({
        type: 'count',
        value: { min: 1, max: 1 },
        disabled: stat.disabled,
        filters: [
          { id: TARGET_ID.EMPTY_MODIFIERS, value: { min: 1, max: 1 }, disabled: stat.disabled },
          { id: TARGET_ID.TOTAL_MODIFIERS, value: { min: 6, max: undefined }, disabled: stat.disabled }
        ]
      })
    }

    if (stat.disabled) continue

    const input = stat.roll!
    switch (stat.tradeId[0] as InternalTradeId) {
      case 'item.base_percentile':
        propSet(query.filters, 'armour_filters.filters.base_defence_percentile.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'armour_filters.filters.base_defence_percentile.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.memory_strands':
        propSet(query.filters, 'misc_filters.filters.memory_level.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'misc_filters.filters.memory_level.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.armour':
        propSet(query.filters, 'armour_filters.filters.ar.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'armour_filters.filters.ar.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.evasion_rating':
        propSet(query.filters, 'armour_filters.filters.ev.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'armour_filters.filters.ev.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.energy_shield':
        propSet(query.filters, 'armour_filters.filters.es.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'armour_filters.filters.es.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.ward':
        propSet(query.filters, 'armour_filters.filters.ward.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'armour_filters.filters.ward.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.block':
        propSet(query.filters, 'armour_filters.filters.block.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'armour_filters.filters.block.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.total_dps':
        propSet(query.filters, 'weapon_filters.filters.dps.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'weapon_filters.filters.dps.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.physical_dps':
        propSet(query.filters, 'weapon_filters.filters.pdps.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'weapon_filters.filters.pdps.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.elemental_dps':
        propSet(query.filters, 'weapon_filters.filters.edps.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'weapon_filters.filters.edps.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.crit':
        propSet(query.filters, 'weapon_filters.filters.crit.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'weapon_filters.filters.crit.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.aps':
        propSet(query.filters, 'weapon_filters.filters.aps.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'weapon_filters.filters.aps.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.map_item_quantity':
        propSet(query.filters, 'map_filters.filters.map_iiq.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'map_filters.filters.map_iiq.max', typeof input.max === 'number' ? input.max : undefined)
        break
      // exile-appraiser: 3.30 輿圖掉落物 = 交易站地圖篩選器 map_bonus(Atlas Drops)
      case 'item.map_atlas_drops':
        propSet(query.filters, 'map_filters.filters.map_bonus.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'map_filters.filters.map_bonus.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.map_item_rarity':
        propSet(query.filters, 'map_filters.filters.map_iir.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'map_filters.filters.map_iir.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.map_pack_size':
        propSet(query.filters, 'map_filters.filters.map_packsize.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'map_filters.filters.map_packsize.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_agility':
        propSet(query.filters, 'heist_filters.filters.heist_agility.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_agility.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_bruteforce':
        propSet(query.filters, 'heist_filters.filters.heist_brute_force.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_brute_force.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_counterthaumaturgy':
        propSet(query.filters, 'heist_filters.filters.heist_counter_thaumaturgy.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_counter_thaumaturgy.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_deception':
        propSet(query.filters, 'heist_filters.filters.heist_deception.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_deception.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_demolition':
        propSet(query.filters, 'heist_filters.filters.heist_demolition.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_demolition.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_engineering':
        propSet(query.filters, 'heist_filters.filters.heist_engineering.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_engineering.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_lockpicking':
        propSet(query.filters, 'heist_filters.filters.heist_lockpicking.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_lockpicking.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_perception':
        propSet(query.filters, 'heist_filters.filters.heist_perception.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_perception.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_job_trapdisarmament':
        propSet(query.filters, 'heist_filters.filters.heist_trap_disarmament.min', typeof input.min === 'number' ? input.min : 1)
        propSet(query.filters, 'heist_filters.filters.heist_trap_disarmament.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_target_priceless':
        propSet(query.filters, 'heist_filters.filters.heist_objective_value.option', 'priceless')
        break
      case 'item.heist_wings_revealed':
        propSet(query.filters, 'heist_filters.filters.heist_wings.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'heist_filters.filters.heist_wings.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.heist_wings_total':
        propSet(query.filters, 'heist_filters.filters.heist_max_wings.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'heist_filters.filters.heist_max_wings.max', typeof input.max === 'number' ? input.max : undefined)
        break
      case 'item.chart_sulphur':
        propSet(query.filters, 'map_filters.filters.chart_sulphur.min', typeof input.min === 'number' ? input.min : undefined)
        propSet(query.filters, 'map_filters.filters.chart_sulphur.max', typeof input.max === 'number' ? input.max : undefined)
        break
    }
  }

  stats = stats.map(stat => {
    if (!stat.group && stat.tag === FilterTag.MercenaryPrimary) {
      return { ...stat, disabled: false }
    }
    return stat
  })

  type NoUiStatFilter = Pick<StatFilter, 'not' | keyof BareStatFilter>
  const realStats: NoUiStatFilter[] = stats.filter((stat): stat is StatFilter =>
    !stat.group &&
    !INTERNAL_TRADE_IDS.includes(stat.tradeId[0]) &&
    // exile-appraiser: 2026-10-16 被合計吃掉、新列出的原始詞綴列(fromAggregate)未勾選時不送(避免條件數暴增)
    !(stat.fromAggregate && stat.disabled))
  // exile-appraiser: 2026-10-16 機制選擇(mechanism-toggle.ts):勾選中、模式一般、來源本身是破裂 / 工藝的列,
  // 該機制的 ids 併進同一個 not 群組(只排除來源本身的機制);已被勾選列直接送出的 id 不放
  const mechanismNot = mechanismNotIds((realStats as StatFilter[]).filter(stat => !stat.not))
  if (filters.veiled) {
    for (const statRef of filters.veiled.statRefs) {
      const statOrGroup = STAT_BY_REF_V2(statRef)!
      const dbStats = ('stats' in statOrGroup) ? statOrGroup.stats : [statOrGroup]
      realStats.push({
        disabled: filters.veiled.disabled,
        tradeId: dbStats
          .filter(dbStat => ModifierType.Veiled in dbStat.trade.ids)
          .map(dbStat => dbStat.trade.ids[ModifierType.Veiled][0])
      })
    }
  }

  if (filters.influences) {
    for (const influence of filters.influences) {
      realStats.push({
        disabled: influence.disabled,
        tradeId: pseudoStatByRef(INFLUENCE_PSEUDO_TEXT[influence.value])!.trade.ids[ModifierType.Pseudo]
      })
    }
  }

  const qAnd = query.stats[0]
  const qNot: TradeStatGroup = {
    type: 'not',
    filters: []
  }

  for (const group of stats) {
    if (group.group === 'not') {
      // 本 fork:上游把「以下皆無」群組裡**每一條**都送出去(沒勾的只是帶 disabled 旗標),
      // 傭兵契約書的這個群組是「流派裡這件沒有的所有技能」,動輒 9 條以上;連群組本身
      // 沒勾也照送。使用者實機回報這會把查詢撐到「Query is too complex」。
      // 改成:群組沒勾就整個不送;有勾也只送勾選的那幾條。
      if (group.meta.disabled) continue
      const enabled = group.stats.filter(stat => !stat.disabled)
      if (!enabled.length) continue
      query.stats.push({
        type: 'not',
        disabled: false,
        filters: enabled.flatMap(stat => everyTradeIdToQuery(stat))
      })
    } else if (group.group === 'one') {
      query.stats.push({
        type: 'count',
        value: { min: 1 },
        disabled: group.meta.disabled || group.stats.every(stat => stat.disabled),
        filters: group.stats.flatMap(stat => everyTradeIdToQuery(stat))
      })
    } else if (group.group === 'mercenary') {
      const { meta: skill, stats } = group

      if (skill.tag === FilterTag.MercenaryPrimary) {
        appendAndFilter({ ...skill, disabled: false }, qAnd, query.stats)
      } else if (!skill.disabled) {
        appendAndFilter(skill, qAnd, query.stats)
      }

      const socketedSupports = stats.filter(stat => !stat.not && !INTERNAL_TRADE_IDS.includes(stat.tradeId[0]))
      const enabledOptionalGems = socketedSupports.filter(stat => !stat.disabled && stat.option!.value === MercSearchMode.Optional)
      const enabledRequiredGems = socketedSupports.filter(stat => !stat.disabled && stat.option!.value === MercSearchMode.Required)

      // 本 fork:上游只要群組裡**有** 6 連結篩選器(五輔助技能都有),就把勾選的「非」
      // 改寫成「6 連結但排除這些輔助」的加權群組 —— 技能 id 重複 weight 次 + 剩下所有可能
      // 輔助的每個階層 id,一個「非」就是 20 幾條 filter。匿名使用者會直接撞交易站的
      // 「Query is too complex」(實測本 fork 的樣本:勾一個「非」26 條、再開 6 連結 43 條)。
      // 使用者沒勾 6 連結時,「非」的意思就只是「沒有這些輔助」,送 `not` 群組即可
      // (實測 30 條以內匿名可查)。只有真的勾了 6 連結才走上游的排除式加權群組。
      const sixLink = stats.find(stat => stat.tradeId[0] === 'item.mercenary_6link')
      const localNotMode = sixLink !== undefined && !sixLink.disabled
      const localNotStats = (localNotMode) ? stats.filter(stat => stat.not && !stat.disabled) : []

      for (const stat of stats) {
        if (skill.disabled || enabledRequiredGems.length === 5) break

        if (stat.not) {
          if (localNotMode) continue

          // add only when enabled, so we don't clutter web UI when players
          // want to open in a browser and check the filters applied
          if (!stat.disabled) {
            qNot.filters.push(...everyTradeIdToQuery(stat))
          }
        } else if (stat.tradeId[0] === 'item.mercenary_6link') {
          // 上游在這裡有 forceEnabled(6 連結沒勾但有「非」就強制展開),本 fork 拿掉:
          // 沒勾 6 連結的「非」已在上面走 `not` 群組。
          if (stat.disabled) continue

          const possibleSupports = stat.sources
            .map(source => decodeMercenarySupports(source))
            .filter(family => !localNotStats.some(notStat =>
              notStat.statRef === family[0].mercenary!.canonical ||
              notStat.statRef === family[0].ref
            ))
          const tier3Count = (typeof stat.roll?.min === 'number') ? Math.min(Math.max(stat.roll.min, 0), 5) : 0

          if (tier3Count < 5) {
            // 6-Link group
            query.stats.push({
              type: 'mercenary',
              disabled: false,
              ...weightedGroupToQuery({
                allOf: [skill.tradeId],
                someOf: {
                  min: 5,
                  ids: possibleSupports.map(family => {
                    if (family.length > 2) {
                      const minTier = (family[0].mercenary!.syntheticFamily) ? 3 : 2
                      family = family.filter(stat => stat.mercenary!.tier! >= minTier)
                    }
                    return family.flatMap(stat => stat.trade.ids[ModifierType.Pseudo])
                  })
                }
              })
            })
          }

          if (tier3Count > 0) {
            // Tier-3 Gems group
            query.stats.push({
              type: 'mercenary',
              disabled: false,
              ...weightedGroupToQuery({
                allOf: [skill.tradeId],
                someOf: {
                  min: tier3Count,
                  ids: possibleSupports.map(family => {
                    // we simply count any last gem in the family as Tier 3,
                    // users can override this with "Not" filter, e.g. to remove "Knockback (Tier: 1)"
                    return family[family.length - 1].trade.ids[ModifierType.Pseudo]
                  })
                }
              })
            })
          }
        }
      }

      if (enabledOptionalGems.length >= 2) {
        // Mixed N-1 & AND group
        query.stats.push({
          type: 'mercenary',
          disabled: false,
          ...weightedGroupToQuery({
            allOf: [
              skill.tradeId,
              ...enabledRequiredGems.map(stat => stat.tradeId)
            ],
            someOf: {
              min: enabledOptionalGems.length - 1,
              ids: enabledOptionalGems.map(stat => stat.tradeId)
            }
          })
        })
      } else {
        // AND group. Not using `weightedGroupToQuery` for better trade site experience
        query.stats.push({
          type: 'mercenary',
          value: (!skill.disabled && enabledRequiredGems.length)
            ? { min: 1 + enabledRequiredGems.length }
            : undefined,
          // for a Skill without any checked Support Gems we use a simple AND filter
          disabled: skill.disabled || !enabledRequiredGems.length,
          filters: [
            ...everyTradeIdToQuery(skill),
            ...socketedSupports.flatMap(stat => everyTradeIdToQuery({
              ...stat,
              option: undefined,
              disabled: (stat.option!.value === MercSearchMode.Optional) ? true : stat.disabled
            }))
          ]
        })
      }
    }
  }

  for (const stat of realStats) {
    if (stat.not) {
      qNot.filters.push(...everyTradeIdToQuery(stat))
    } else {
      appendAndFilter(stat, qAnd, query.stats)
    }
  }

  // exile-appraiser: 2026-10-16 機制選擇「一般」排除(見上方 mechanismNot),去重後併進同一個 not 群組
  for (const id of mechanismNot) {
    if (!qNot.filters.some(f => f.id === id)) qNot.filters.push({ id, disabled: false })
  }

  if (qNot.filters.length) {
    query.stats.push(qNot)
  }

  return body
}

// 網路層改動(相對上游):請求經注入的 `ctx.http`(Electron 端是走 main process 的代理、
// CLI 端是 Node fetch、測試是錄製檔),host 由 realm 決定,限流與快取每個 realm 各一套。
export function searchUrl (ctx: Pick<TradeContext, 'realm'>, leagueId: string): string {
  return `${apiBase(ctx.realm)}/api/trade/search/${encodeURIComponent(leagueId)}`
}

export function fetchUrl (ctx: Pick<TradeContext, 'realm'>, resultIds: string[], queryId: string): string {
  return `${apiBase(ctx.realm)}/api/trade/fetch/${resultIds.join(',')}?query=${queryId}`
}

// exile-appraiser: 台服交易站遇到它清單裡沒有的 stat id,整個查詢回「Invalid query」(2026-11-15 實測)。
// 台服的清單比國際服少(3.30 的 `effect_*` 新 id 陸續開放;一部分固定 / 破裂 / 附魔 id 台服沒有),資料是兩區共用的,
// 所以台服送出前用台服自己的清單(`/api/trade/data/stats`)過濾每個群組:不認得的 id 拿掉(地圖的附魔 / 固定詞綴預設就勾,
// 不拿掉會一查價就失敗);count 群組(同一條詞綴的新舊 id)因此只留認得的。拿掉了什麼記一行 log。
// 清單成功後 6 小時重抓(台服中途開放新 id);抓不到就原樣送,1 分鐘內不再試。
const KNOWN_IDS_TTL_MS = 6 * 60 * 60 * 1000
const KNOWN_IDS_RETRY_MS = 60 * 1000
interface KnownStatIds { owner: unknown, at: number, ids: Promise<Set<string> | null>, failed?: boolean }
const knownStatIds = new Map<string, KnownStatIds>()

function loadKnownStatIds (ctx: TradeContext, now = Date.now()): Promise<Set<string> | null> {
  const session = tradeSession(ctx.realm) // resetTradeSessions(測試)會換掉 session 物件;跟著重抓
  const have = knownStatIds.get(ctx.realm)
  if (have && have.owner === session && now - have.at < (have.failed ? KNOWN_IDS_RETRY_MS : KNOWN_IDS_TTL_MS)) return have.ids
  const entry: KnownStatIds = {
    owner: session,
    at: now,
    ids: (async () => {
      try {
        const response = await ctx.http(`${apiBase(ctx.realm)}/api/trade/data/stats`, { method: 'GET', headers: { Accept: 'application/json' } })
        if (!response.ok) return null
        const data = await response.json() as { result?: Array<{ entries?: Array<{ id?: unknown }> }> }
        const ids = new Set<string>()
        for (const group of data.result ?? []) for (const e of group.entries ?? []) if (typeof e.id === 'string') ids.add(e.id)
        return ids.size ? ids : null
      } catch {
        return null
      }
    })()
  }
  knownStatIds.set(ctx.realm, entry)
  void entry.ids.then(ids => { if (!ids) entry.failed = true })
  return entry.ids
}

async function dropIdsUnknownToRealm (ctx: TradeContext, body: TradeRequest): Promise<TradeRequest> {
  if (ctx.realm !== 'tw' || !body.query.stats.some(g => g.filters.length)) return body
  const known = await loadKnownStatIds(ctx)
  if (!known) return body
  // 選項型 id(`X|n`)清單裡可能只有 `X`
  const ok = (id: string) => known.has(id) || known.has(id.split('|')[0])
  const dropped: string[] = []
  const stats = body.query.stats.flatMap((g, i) => {
    const kept = g.filters.filter(f => ok(f.id))
    if (kept.length === g.filters.length) return [g]
    // 可以只拿掉一部分的:and / not(各條件獨立)與「count、只有 min 1」(同一條詞綴的新舊 id,任一成立)。
    // 其他帶數量的群組(count 有 max 或 min > 1、傭兵加權…)少了一個 id 語意就變了、甚至湊不到 min → 整組拿掉
    const partial = g.type === 'and' || g.type === 'not' ||
      (g.type === 'count' && g.value?.min === 1 && g.value.max === undefined)
    const next = partial ? kept : []
    dropped.push(...g.filters.filter(f => !next.includes(f)).map(f => f.id))
    // 第一個 and 群組是固定有的(可以是空的);其餘清空就不送
    return next.length || (i === 0 && g.type === 'and') ? [{ ...g, filters: next }] : []
  })
  if (!dropped.length) return body
  console.warn(`[trade] 台服交易站清單沒有這些 id,已從查詢拿掉:${dropped.join(', ')}`)
  return { ...body, query: { ...body.query, stats } }
}

export async function requestTradeResultList (ctx: TradeContext, body: TradeRequest, leagueId: string): Promise<SearchResult> {
  body = await dropIdsUnknownToRealm(ctx, body)
  const { limits: RATE_LIMIT_RULES, cache } = tradeSession(ctx.realm)
  let data = cache.get<SearchResult>([ctx.realm, body, leagueId])

  if (!data) {
    preventQueueCreation([
      { count: 1, limiters: RATE_LIMIT_RULES.SEARCH },
      { count: 1, limiters: RATE_LIMIT_RULES.FETCH }
    ])

    await RateLimiter.waitMulti(RATE_LIMIT_RULES.SEARCH)

    const response = await ctx.http(searchUrl(ctx, leagueId), {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    adjustRateLimits(RATE_LIMIT_RULES.SEARCH, response.headers, ctx.latencySeconds)

    const _data = await response.json() as TradeResponse<SearchResult>
    if (_data.error) {
      throw new Error(_data.error.message)
    } else {
      data = _data
    }

    cache.set<SearchResult>([ctx.realm, body, leagueId], data, Cache.deriveTtl(...RATE_LIMIT_RULES.SEARCH, ...RATE_LIMIT_RULES.FETCH))
  }

  return data
}

export async function requestResults (
  ctx: TradeContext,
  queryId: string,
  resultIds: string[]
): Promise<PricingResult[]> {
  const { limits: RATE_LIMIT_RULES, cache } = tradeSession(ctx.realm)
  const opts = { accountName: ctx.accountName }
  let data = cache.get<FetchResult[]>([ctx.realm, resultIds])

  if (!data) {
    await RateLimiter.waitMulti(RATE_LIMIT_RULES.FETCH)

    const response = await ctx.http(fetchUrl(ctx, resultIds, queryId), { headers: { Accept: 'application/json' } })
    adjustRateLimits(RATE_LIMIT_RULES.FETCH, response.headers, ctx.latencySeconds)

    const _data = await response.json() as TradeResponse<{ result: Array<FetchResult | null> }>
    if (_data.error) {
      throw new Error(_data.error.message)
    } else {
      data = _data.result.filter(res => res != null)
    }

    cache.set<FetchResult[]>([ctx.realm, resultIds], data, Cache.deriveTtl(...RATE_LIMIT_RULES.SEARCH, ...RATE_LIMIT_RULES.FETCH))
  }

  // exile-appraiser(2026-10-15):國際服 + 介面語言繁中 + 浮窗不是「關閉」→ 浮窗文字換繁中(不 await;資料還沒載好這次英文)
  const toZh = displayZhFor(ctx.realm)

  return data.map<PricingResult>(result => {
    let displayItem: DisplayItem | undefined
    try {
      displayItem = parseFetchItem(result.item)
      if (displayItem && toZh) displayItem = toZh(displayItem, result.item)
    } catch (e) {
      console.error('[trade] 懸停浮窗物品資料解析失敗:', e)
    }
    return {
      id: result.id,
      itemLevel: result.item.properties?.find(prop => prop.type === 78)?.values[0][0] ?? String(result.item.ilvl),
      stackSize: result.item.stackSize,
      corrupted: result.item.corrupted,
      quality: result.item.properties?.find(prop => prop.type === 6)?.values[0][0],
      level: result.item.properties?.find(prop => prop.type === 5)?.values[0][0],
      relativeDate: DateTime.fromISO(result.listing.indexed).toRelative({ style: 'short' }) ?? '',
      priceAmount: result.listing.price?.amount ?? 0,
      priceCurrency: result.listing.price?.currency ?? 'no price',
      hasNote: result.item.note != null,
      hasFee: result.listing.fee != null,
      isMine: (result.listing.account.name === opts.accountName),
      ign: result.listing.account.lastCharacterName,
      accountName: result.listing.account.name,
      accountStatus: (result.listing.fee != null)
        ? 'online'
        : result.listing.account.online
          ? (result.listing.account.online.status === 'afk' ? 'afk' : 'online')
          : 'offline',
      displayItem
    }
  })
}

function getMinMax (roll: StatFilter['roll'], divisor: number) {
  if (!roll) {
    return { min: undefined, max: undefined }
  }

  const sign = roll.tradeInvert ? -1 : 1
  const a = typeof roll.min === 'number' ? roll.min * sign / divisor : undefined
  const b = typeof roll.max === 'number' ? roll.max * sign / divisor : undefined

  return !roll.tradeInvert ? { min: a, max: b } : { min: b, max: a }
}

interface WeightedGroup {
  someOf?: { min: number, ids: Array<StatFilter['tradeId']> }
  allOf?: Array<StatFilter['tradeId']>
}

function weightedGroupToQuery (group: WeightedGroup): Pick<TradeStatGroup, 'value' | 'filters'> {
  const someOf = group.someOf ?? { min: 0, ids: [] }
  const allOf = group.allOf ?? []

  // max possible surplus from `someOf` ids
  const surplus = Math.max(0, someOf.ids.length - someOf.min)
  // the weight for all `allOf` conditions must overpower the `someOf` surplus
  const weight = surplus + 1

  const totalMin = someOf.min + allOf.length * weight
  const flatIds: string[] = []

  for (const familyIds of allOf) {
    for (const id of familyIds) {
      for (let i = 0; i < weight; i++) {
        flatIds.push(id)
      }
    }
  }
  flatIds.push(...someOf.ids.flatMap(familyIds => familyIds))

  return {
    value: { min: totalMin },
    filters: flatIds.map(id => ({ id }))
  }
}

type BareStatFilter = Pick<StatFilter, 'roll' | 'option' | 'disabled' | 'tradeId'>

function appendAndFilter (
  stat: BareStatFilter,
  defaultAndGroup: TradeStatGroup,
  allGroups: TradeStatGroup[]
): void {
  if (stat.tradeId.length === 1) {
    defaultAndGroup.filters.push(tradeIdToQuery(stat.tradeId[0], stat))
  } else {
    allGroups.push({
      type: 'count',
      value: { min: 1 },
      disabled: stat.disabled,
      filters: everyTradeIdToQuery(stat)
    })
  }
}

function everyTradeIdToQuery (stat: BareStatFilter) {
  return stat.tradeId.map(id => tradeIdToQuery(id, stat))
}

function tradeIdToQuery (id: string, stat: BareStatFilter) {
  let roll = stat.roll

  const divMinMax = id.startsWith('{div_by_100}') ? 100 : 1
  if (id.startsWith('{empty}') ||
    (id.startsWith('{empty_if_100}') && roll?.value === 100)
  ) {
    roll = undefined
  }
  if (id.startsWith('{')) {
    id = id.slice(id.indexOf('}') + 1)
  }

  return {
    id,
    value: {
      ...getMinMax(roll, divMinMax),
      option: stat.option != null
        ? stat.option.value
        : undefined
    },
    disabled: stat.disabled
  }
}

function nameToQuery (name: string, discriminator?: string) {
  if (!discriminator) {
    return name
  } else {
    return {
      discriminator: discriminator,
      option: name
    }
  }
}
