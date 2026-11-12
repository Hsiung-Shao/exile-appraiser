// exile-appraiser:移植自 Exiled Exchange 2 `renderer/src/web/item-check/hotkeyable-actions.ts`
// `openPoedb` / `getPoe2dbPath` / `POE2DB_CONVERSIONS`(MIT),對照表逐字。
// 只留組網址的部分(開啟交給 renderer `web/poedb-open.ts`);語言只支援本專案的兩種客戶端語言;
// 沒有 category 時上游回 undefined(網址變 `/undefined`),這裡退回 refName。
import { ItemRarity, type ParsedItem } from '@/parser'
import { ARMOUR, ItemCategory } from '@/parser/meta'

const POEDB_LANGS = { en: 'us', 'cmn-Hant': 'tw' } as const

const POE2DB_CONVERSIONS = new Map<string, string>([
  // One handed
  [ItemCategory.Claw, 'Claws'],
  [ItemCategory.Dagger, 'Daggers'],
  [ItemCategory.Wand, 'Wands'],
  [ItemCategory.OneHandedSword, 'One_Hand_Swords'],
  [ItemCategory.OneHandedAxe, 'One_Hand_Axes'],
  [ItemCategory.OneHandedMace, 'One_Hand_Maces'],
  [ItemCategory.Sceptre, 'Sceptres'],
  [ItemCategory.Spear, 'Spears'],
  [ItemCategory.Flail, 'Flails'],
  // Two handed
  [ItemCategory.Bow, 'Bows'],
  [ItemCategory.Staff, 'Staves'],
  [ItemCategory.TwoHandedSword, 'Two_Hand_Swords'],
  [ItemCategory.TwoHandedAxe, 'Two_Hand_Axes'],
  [ItemCategory.TwoHandedMace, 'Two_Hand_Maces'],
  [ItemCategory.Warstaff, 'Quarterstaves'],
  [ItemCategory.Crossbow, 'Crossbows'],
  [ItemCategory.Talisman, 'Talismans'],
  // Jewelery
  [ItemCategory.Amulet, 'Amulets'],
  [ItemCategory.Ring, 'Rings'],
  [ItemCategory.Belt, 'Belts'],
  // Armours
  [ItemCategory.BodyArmour, 'Body_Armours'],
  [ItemCategory.Helmet, 'Helmets'],
  [ItemCategory.Gloves, 'Gloves'],
  [ItemCategory.Boots, 'Boots'],
  // offhand
  [ItemCategory.Quiver, 'Quivers'],
  [ItemCategory.Shield, 'Shields'],
  [ItemCategory.Focus, 'Foci'],
  [ItemCategory.Buckler, 'Bucklers'],
  // Jewels
  ['Ruby', 'Ruby'],
  ['Emerald', 'Emerald'],
  ['Sapphire', 'Sapphire'],
  ['Time-Lost Ruby', 'Time-Lost_Ruby'],
  ['Time-Lost Emerald', 'Time-Lost_Emerald'],
  ['Time-Lost Sapphire', 'Time-Lost_Sapphire'],
  // Flasks
  ['Life Flask', 'Life_Flasks'],
  ['Mana Flask', 'Mana_Flasks'],
  ['Charm', 'Charms'],
  // Relics
  ['Urn Relic', 'Urn_Relic'],
  ['Amphora Relic', 'Amphora_Relic'],
  ['Vase Relic', 'Vase_Relic'],
  ['Seal Relic', 'Seal_Relic'],
  ['Coffer Relic', 'Coffer_Relic'],
  ['Tapestry Relic', 'Tapestry_Relic'],
  ['Incense Relic', 'Incense_Relic'],
  // Tablet
  ['Breach Precursor Tablet', 'Breach_Precursor_Tablet'],
  ['Expedition Precursor Tablet', 'Expedition_Precursor_Tablet'],
  ['Delirium Precursor Tablet', 'Delirium_Precursor_Tablet'],
  ['Ritual Precursor Tablet', 'Ritual_Precursor_Tablet'],
  ['Precursor Tablet', 'Precursor_Tablet'],
  ['Overseer Precursor Tablet', 'Overseer_Precursor_Tablet'],
  // Waystones
  ['Waystones(Low)', 'Waystones_low_tier'],
  ['Waystones(Mid)', 'Waystones_mid_tier'],
  ['Waystones(Top)', 'Waystones_top_tier']
])

function encodePoe2dbUri (text: string): string {
  return text.replaceAll(/ /g, '_').replaceAll(/'/g, '')
}

function getPoe2dbPath (item: ParsedItem): string {
  const category = item.category
  const refName = item.info.refName
  // exile-appraiser:上游回 undefined → 退回 refName
  if (!category) return encodePoe2dbUri(refName)

  if (item.rarity === ItemRarity.Unique) {
    return encodePoe2dbUri(refName)
  }

  if (POE2DB_CONVERSIONS.has(refName)) {
    return POE2DB_CONVERSIONS.get(refName)! + '#ModifiersCalc'
  }
  // if we don't have a known modifiers page for an item category
  if (!POE2DB_CONVERSIONS.has(category)) {
    return encodePoe2dbUri(refName)
  }

  let path = POE2DB_CONVERSIONS.get(category)!
  if (
    ARMOUR.has(category) &&
    !(category === ItemCategory.Buckler || category === ItemCategory.Focus)
  ) {
    if (item.armourAR) {
      path += '_str'
    }
    if (item.armourEV) {
      path += '_dex'
    }
    if (item.armourES) {
      path += '_int'
    }
  }

  return path + '#ModifiersCalc'
}

export function poe2dbUrl (item: ParsedItem, language: keyof typeof POEDB_LANGS): string {
  return `https://poe2db.tw/${POEDB_LANGS[language]}/${getPoe2dbPath(item)}`
}
