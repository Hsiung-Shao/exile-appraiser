import type { ItemFilters } from './interfaces'
import { ParsedItem, ItemCategory, ItemRarity } from '@/parser'
import { MAGIC_ONLY_OR_UNIQUE_ITEM, CONSUMABLE_CRAFTABLE_ITEM, JEWELLERY } from '@/parser/meta'
import { tradeTag } from '../trade/common'
import { ModifierType } from '@/parser/modifiers'
import { BaseType, ITEM_BY_REF, ITEM_BY_TRANSLATED } from '@/assets/data'
import { CATEGORY_TO_TRADE_ID } from '../trade/pathofexile-trade'
import { PERMANENT_SC } from '../../background/Leagues'

export const SPECIAL_SUPPORT_GEM = ['Empower Support', 'Enlighten Support', 'Enhance Support']

export interface CreateOptions {
  league: string
  merchantOnly: boolean
  currency: string | null
  collapseListings: 'app' | 'api'
  activateStockFilter: boolean
  exact: boolean
  useEn: boolean
}

/**
 * 海圖區域、傭兵流派、占卜寶珠的地圖區域,交易站是用**內部類型 id** 搜尋的,
 * 不是顯示名(見 `BaseType.tradeType`)。`createFiltersInner` 已經在各自的分支
 * 裡填好 `searchExact`,只有要送給交易站的那個值是錯的,所以這裡覆寫那一個欄位。
 *
 * ⚠ 覆寫**必須包在最外層**。`createFiltersInner` 有十幾個提早 return 的分支
 * (通貨、命運卡、邀請函、地圖…),原本把這段寫在函式尾端,結果只有「走到最後」
 * 的物品類別才生效 —— 占卜寶珠是通貨,在通貨那個分支就 return 了,查詢送出的是
 * 基底 `Scrying Orb` 而不是區域,等於沒有收斂。逐個分支補遲早會漏掉一個。
 *
 * 沒有這段的話:傭兵契約書會撈回全遊戲所有契約書(10000+ 筆、全是最低價),
 * 海圖與占卜寶珠則忽略它對應的區域。
 */
export function createFilters (
  item: ParsedItem,
  opts: CreateOptions
): ItemFilters {
  const filters = createFiltersInner(item, opts)
  if (item.info.tradeType && item.info.tradeDisc) {
    // 上游 3.29.103 起 discriminator 併進 searchExact(`nameToQuery` 會組成
    // `{ discriminator, option }`),不再是 ItemFilters 頂層欄位。
    filters.searchExact.baseTypeTrade = item.info.tradeType
    filters.searchExact.discriminatorTrade = item.info.tradeDisc
  }
  return filters
}

function createFiltersInner (
  item: ParsedItem,
  opts: CreateOptions
): ItemFilters {
  const filters: ItemFilters = {
    searchExact: {},
    trade: {
      offline: false,
      onlineInLeague: false,
      merchantOnly: opts.merchantOnly &&
        // these are Divination Cards, and some items at start of league
        // that are on Currency Exchange but was not added to Bulk section of site yet
        !(item.info.exchangeable && !item.info.tradeTag),
      listed: null,
      currency: opts.currency,
      league: opts.league,
      collapseListings: opts.collapseListings,
      collapseMerchant: false
    }
  }

  if (
    (!item.info.craftable || CONSUMABLE_CRAFTABLE_ITEM.has(item.category!)) &&
    item.rarity !== ItemRarity.Unique
  ) {
    if (!opts.currency) {
      filters.trade.currency = 'chaos_divine'
    }
    if (item.info.refName !== 'Mercenary Warrant') {
      filters.trade.collapseMerchant = true
    }
  }

  if (item.category === ItemCategory.Gem) {
    return createGemFilters(item, filters, opts)
  }
  if (item.category === ItemCategory.CapturedBeast) {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info)
    }
    return filters
  }
  if (item.stackSize || tradeTag(item) || item.info.exchangeable) {
    filters.stackSize = {
      value: item.stackSize?.value || 1,
      disabled: !(item.stackSize && item.stackSize.value > 1 && opts.activateStockFilter)
    }
  }
  if (item.category === ItemCategory.Invitation) {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info)
    }
    return filters
  }
  if (item.category === ItemCategory.MetamorphSample) {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info)
    }
    filters.itemLevel = {
      value: item.itemLevel!,
      disabled: false
    }
    return filters
  }
  if (item.info.refName === 'Scrying Orb') {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info),
      sub: {
        baseType: item.mapArea!.name,
        baseTypeTrade: item.mapArea!.tradeDisc!,
        discriminatorTrade: item.info.tradeDisc!,
        disabled: false
      }
    }
    return filters
  }
  if (
    item.category === ItemCategory.DivinationCard ||
    item.category === ItemCategory.Currency ||
    item.info.refName === 'Charged Compass'
  ) {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info)
    }
    if (item.info.refName === 'Chronicle of Atzoatl') {
      filters.areaLevel = {
        value: floorToBracket(item.areaLevel!, [1, 68, 73, 75, 78, 80]),
        disabled: false
      }
    } else if (item.info.refName === 'Mirrored Tablet') {
      filters.areaLevel = {
        value: item.areaLevel!,
        disabled: false
      }
    } else if (item.info.refName === 'Forbidden Tome') {
      filters.areaLevel = {
        value: item.areaLevel!,
        disabled: false
      }
      if (item.areaLevel! < 83) {
        filters.areaLevel.max = item.areaLevel!
      }
    } else if (item.info.refName === 'Inscribed Ultimatum') {
      // ⚠ 雕刻的 category 是 **Currency**,所以它在這個分支就 return 了 ——
      // 寫在下面那串 else-if 裡的話永遠不會執行到。
      if (item.areaLevel) {
        filters.areaLevel = {
          value: item.areaLevel,
          disabled: false
        }
      }
      if (item.ultimatum) {
        // 「需求獻祭」有兩種形態:靜態文字(可鏡像、稀有物品)與物品名。交易站的
        // ultimatum_input 收的是物品名,所以**只有查得到對應資料列時才送**,
        // 靜態文字查不到就留空,不會把整句話當成物品名送出去。
        //
        // 三個 namespace 都要找 —— 實際掛售的雕刻獻祭的有通貨(混沌石 x10)、
        // 傳奇(沙塵之影)**與命運卡**(黑暗術者 x3),命運卡不在 ITEM 裡。
        const sacrificed = item.ultimatum.sacrifice
          ? (ITEM_BY_TRANSLATED('ITEM', item.ultimatum.sacrifice) ??
             ITEM_BY_TRANSLATED('UNIQUE', item.ultimatum.sacrifice) ??
             ITEM_BY_TRANSLATED('DIVINATION_CARD', item.ultimatum.sacrifice))?.[0]
          : undefined
        filters.ultimatum = {
          challenge: item.ultimatum.challenge,
          reward: item.ultimatum.reward,
          sacrifice: sacrificed ? t(opts, sacrificed) : undefined,
          disabled: false
        }
      }
    } else if (item.itemLevel) {
      // Incubators, Wombgifts
      filters.itemLevel = {
        value: item.itemLevel,
        disabled: false
      }
    }
    return filters
  }

  if (item.category === ItemCategory.Map) {
    if (item.info.area?.blighted) {
      filters.searchExact = {
        baseType: item.info.name,
        baseTypeTrade: t(opts, ITEM_BY_REF('ITEM', 'Map')![0]),
        discriminatorTrade: 'map',
        sub: {
          baseType: item.mapArea!.name,
          baseTypeTrade: item.mapArea!.tradeDisc!,
          discriminatorTrade: item.info.tradeDisc!,
          disabled: false
        }
      }
    } else if (item.rarity === ItemRarity.Unique && item.uniqueBase) {
      filters.searchExact = {
        name: item.info.name,
        nameTrade: t(opts, item.info),
        baseTypeTrade: t(opts, item.uniqueBase)
      }
    } else {
      filters.searchExact = {
        baseType: item.info.name,
        baseTypeTrade: t(opts, item.info)
      }
    }

    if (item.info.refName === 'Map' || item.uniqueBase?.refName === 'Map') {
      filters.searchExact.discriminatorTrade = 'map'
    }

    if (item.info.refName === 'Blighted Map') {
      filters.mapBlighted = { value: 'Blighted' }
    } else if (item.info.refName === 'Blight-ravaged Map') {
      filters.mapBlighted = { value: 'Blight-ravaged' }
    } else if (item.info.refName === 'Map') {
      filters.mapBlighted = { value: false }
    }

    if (item.mapCompletionReward) {
      filters.mapCompletionReward = {
        name: item.mapCompletionReward.name,
        nameTrade: t(opts, item.mapCompletionReward)
      }
    }

    if (item.mapTier) {
      filters.mapTier = {
        value: item.mapTier,
        disabled: false
      }
    }
  } else if (item.info.refName === 'Expedition Logbook') {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info)
    }
    filters.areaLevel = {
      value: floorToBracket(item.areaLevel!, [1, 68, 73, 78, 81, 83]),
      disabled: false
    }
  } else if (item.category === ItemCategory.Chart) {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info)
    }
    filters.searchRelaxed = {
      category: item.category,
      disabled: false,
      sub: {
        baseType: item.mapArea!.name,
        baseTypeTrade: item.mapArea!.tradeDisc!,
        discriminatorTrade: item.info.tradeDisc!,
        disabled: false
      }
    }
  } else if (item.rarity === ItemRarity.Unique && item.uniqueBase) {
    filters.searchExact = {
      name: item.info.name,
      nameTrade: t(opts, item.info),
      baseTypeTrade: t(opts, item.uniqueBase)
    }
  } else {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info)
    }
    if (item.category && CATEGORY_TO_TRADE_ID.has(item.category)) {
      let disabled = opts.exact
      if (
        item.category === ItemCategory.ClusterJewel ||
        item.category === ItemCategory.Idol ||
        item.category === ItemCategory.Graft ||
        item.category === ItemCategory.HeistBlueprint
      ) {
        disabled = true
      } else if (
        item.category === ItemCategory.SanctumRelic ||
        item.category === ItemCategory.Charm ||
        item.category === ItemCategory.HeistContract
      ) {
        disabled = false
      }
      filters.searchRelaxed = {
        category: item.category,
        disabled: disabled
      }
    }
  }

  if (item.sentinelCharge != null) {
    filters.sentinelCharge = {
      value: item.sentinelCharge,
      disabled: false
    }
  }

  if (item.quality && item.quality >= 20 && !JEWELLERY.has(item.category!)) {
    if (
      item.category === ItemCategory.Flask || item.category === ItemCategory.Tincture ||
      opts.exact // for Weapons & Armour
    ) {
      filters.quality = {
        value: item.quality,
        disabled: (item.quality <= 20)
      }
    }
  }

  if (item.sockets?.linked) {
    filters.linkedSockets = {
      value: item.sockets.linked,
      disabled: false
    }
  }

  const forAdornedJewel = (
    item.rarity === ItemRarity.Magic &&
    // item.isCorrupted && -- let the buyer corrupt
    (item.category === ItemCategory.Jewel || item.category === ItemCategory.AbyssJewel))

  if (!item.isUnmodifiable && (item.info.craftable || item.rarity === ItemRarity.Unique)) {
    filters.corrupted = {
      value: item.isCorrupted,
      exact: forAdornedJewel
    }
  }

  if (forAdornedJewel) {
    filters.rarity = {
      value: 'magic',
      disabled: false
    }
  } else if (
    opts.exact &&
    item.rarity === ItemRarity.Magic &&
    !CONSUMABLE_CRAFTABLE_ITEM.has(item.category!) &&
    !MAGIC_ONLY_OR_UNIQUE_ITEM.has(item.category!)
  ) {
    filters.rarity = {
      value: 'magic',
      disabled: true
    }
  } else if (item.info.craftable && (
    item.rarity === ItemRarity.Normal ||
    item.rarity === ItemRarity.Magic ||
    item.rarity === ItemRarity.Rare
  )) {
    filters.rarity = {
      value: 'nonunique',
      disabled: false
    }
  }

  if (item.isMirrored) {
    filters.mirrored = { disabled: false, hidden: false }
  } else if (
    item.info.craftable && !item.isCorrupted
  ) {
    filters.mirrored = { disabled: true, hidden: true }
  }

  if (item.isSplit) {
    filters.split = { disabled: false, hidden: false }
  } else if (
    (!PERMANENT_SC.includes(opts.league) || opts.exact) &&
    item.info.craftable && !item.isCorrupted && !item.isMirrored &&
    !item.isSynthesised && !item.isFractured && !item.influences.length
  ) {
    filters.split = { disabled: true, hidden: true }
  }

  if (!item.isFractured &&
    (item.info.craftable && !item.isCorrupted && !item.isMirrored)
  ) {
    filters.fractured = { value: false }
  }

  if (item.isFoil) {
    filters.foil = { disabled: false }
  }

  if (item.influences.length && item.influences.length <= 2) {
    filters.influences = item.influences.map(influence => ({
      value: influence,
      disabled: !opts.exact
    }))
  }

  if (item.itemLevel) {
    if (
      item.rarity !== ItemRarity.Unique &&
      item.category !== ItemCategory.Map &&
      item.category !== ItemCategory.Jewel && /* https://pathofexile.gamepedia.com/Jewel#Affixes */
      item.category !== ItemCategory.HeistBlueprint &&
      item.category !== ItemCategory.HeistContract &&
      item.category !== ItemCategory.Chart &&
      item.category !== ItemCategory.MemoryLine &&
      item.category !== ItemCategory.SanctumRelic &&
      item.category !== ItemCategory.Charm &&
      item.category !== ItemCategory.Idol &&
      item.info.refName !== 'Expedition Logbook'
    ) {
      if (item.category === ItemCategory.ClusterJewel) {
        filters.itemLevel = {
          value: floorToBracket(item.itemLevel, [1, 50, 68, 75, 84]),
          max: ceilToBracket(item.itemLevel, [100, 74, 67, 49]),
          disabled: !opts.exact
        }
      } else {
        // TODO limit level by item type
        filters.itemLevel = {
          value: Math.min(item.itemLevel, 86),
          disabled: (!opts.exact || item.category === ItemCategory.Flask || item.category === ItemCategory.Tincture)
        }
      }
    }

    if (item.rarity === ItemRarity.Unique) {
      if (item.isUnidentified && item.info.refName === "Watcher's Eye") {
        filters.itemLevel = {
          value: item.itemLevel,
          disabled: false
        }
      }

      if (item.itemLevel >= 75 && [
        'Agnerod', 'Agnerod East', 'Agnerod North', 'Agnerod South', 'Agnerod West'
      ].includes(item.info.refName)) {
        // https://pathofexile.gamepedia.com/The_Vinktar_Square
        const normalizedLvl =
          item.itemLevel >= 82 ? 82
            : item.itemLevel >= 80 ? 80
              : item.itemLevel >= 78 ? 78
                : 75

        filters.itemLevel = {
          value: normalizedLvl,
          disabled: false
        }
      }
    }
  }

  if (item.isUnidentified) {
    filters.unidentified = {
      value: true,
      disabled: (item.rarity !== ItemRarity.Unique)
    }
  }

  if (item.isVeiled) {
    filters.veiled = {
      statRefs: item.statsByType
        .filter(calc => calc.type === ModifierType.Veiled)
        .map(calc => calc.stat.ref),
      disabled: false
    }

    if (item.rarity !== ItemRarity.Unique) {
      if (filters.itemLevel) {
        filters.itemLevel.disabled = false
      }
    }
  }

  if (item.rarity === ItemRarity.Unique) {
    filters.foulborn = {
      value: Boolean(item.isFoulborn)
    }
    // 殘存傳奇的詞綴是從別件傳奇移轉過來的,價格跟普通版差很多。不分開的話兩邊
    // 互相污染:查殘存版會撈回一堆普通版,查普通版也會被殘存版拉歪。
    filters.vestigial = {
      value: Boolean(item.isVestigial)
    }
  }

  if (
    item.category === ItemCategory.HeistContract ||
    item.category === ItemCategory.HeistBlueprint ||
    item.category === ItemCategory.Chart
  ) {
    if (item.rarity !== ItemRarity.Unique) {
      filters.areaLevel = {
        value: item.areaLevel!,
        disabled: false
      }
    }
  }

  return filters
}

function createGemFilters (
  item: ParsedItem,
  filters: ItemFilters,
  opts: CreateOptions
) {
  if (!item.info.gem!.transfigured) {
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, item.info)
    }
  } else {
    const normalGem = ITEM_BY_REF('GEM', item.info.gem!.normalVariant!)![0]
    filters.searchExact = {
      baseType: item.info.name,
      baseTypeTrade: t(opts, normalGem),
      discriminatorTrade: item.info.tradeDisc!
    }
  }

  if (item.vaalGem) {
    filters.searchExact.sub = {
      baseType: item.vaalGem.name,
      baseTypeTrade: t(opts, item.vaalGem),
      discriminatorTrade: item.info.tradeDisc,
      disabled: false
    }
  }

  filters.corrupted = {
    value: item.isCorrupted
  }

  if (!item.imbuedGem && item.isCorrupted && item.gemLevel! >= 20) {
    filters.imbuedGem = {
      disabled: true
    }
  }

  filters.gemLevel = {
    value: item.gemLevel!,
    disabled: (item.gemLevel! < item.info.gem!.maxLevel)
  }

  if (item.quality) {
    filters.quality = {
      value: item.quality,
      disabled: (item.info.gem!.maxLevel === 1) ? false
        : (item.info.gem!.maxLevel === 20 && !item.info.gem!.transfigured)
            ? (item.quality < 16)
            : (item.quality < 20)
    }
  }

  return filters
}

function t (opts: CreateOptions, info: BaseType) {
  return (opts.useEn) ? info.refName : info.name
}

export function floorToBracket (value: number, brackets: readonly number[]) {
  let prev = brackets[0]
  for (const num of brackets) {
    if (num > value) {
      return prev
    } else {
      prev = num
    }
  }
  return prev
}

function ceilToBracket (value: number, brackets: readonly number[]) {
  let prev = brackets[0]
  for (const num of brackets) {
    if (num < value) {
      return prev
    } else {
      prev = num
    }
  }
  return prev
}
