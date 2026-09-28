import { Result, ok, err } from 'neverthrow'
import {
  CLIENT_STRINGS as _$,
  ITEM_BY_TRANSLATED,
  ITEM_BY_REF,
  STAT_BY_MATCH_STR,
  StatBetter,
  stat,
  pseudoStatByRef,
  type BaseType
} from '@/assets/data'
import { ModifierType, sumStatsByModType } from './modifiers'
import { linesToStatStrings, tryParseTranslation, getRollOrMinmaxAvg, ParsedStat } from './stat-translations'
import { ItemCategory, JEWELLERY } from './meta'
import { IncursionRoom, ParsedItem, ItemInfluence, ItemRarity } from './ParsedItem'
import { magicBasetype } from './magic-name'
import { isModInfoLine, groupLinesByMod, parseModInfoLine, parseModType, type ModifierInfo, type ParsedModifier, ENCHANT_LINE, SCOURGE_LINE, IMPLICIT_LINE } from './advanced-mod-desc'
import { calcPropPercentile, QUALITY_STATS } from './calc-q20'

type SectionParseResult =
  | 'SECTION_PARSED'
  | 'SECTION_SKIPPED'
  | 'PARSER_SKIPPED'

type ParserFn = (section: string[], item: ParserState) => SectionParseResult
type VirtualParserFn = (item: ParserState) => Result<never, string> | void
/**
 * 能看到「目前為止沒有任何 parser 認領的 section」的處理階段。
 *
 * 上游沒有這個機制:section 若沒被認領就直接消失。但規格 §6.2 要求
 * 「未知資料不得靜默丟棄」,而實測繁中 corpus 裡確實有整段詞綴被丟掉的案例。
 * 可就地從 `sections` 移除已消化的項目。
 */
type LeftoverParserFn = (sections: string[][], item: ParserState) => void

interface ParserState extends ParsedItem {
  name: string
  baseType: string | undefined
  infoVariants: BaseType[]
}

const parsers: Array<
  ParserFn | { virtual: VirtualParserFn } | { leftovers: LeftoverParserFn }
> = [
  parseUnidentified,
  { virtual: parseSuperior },
  { virtual: parseFoulborn },
  { virtual: parseVestigial },
  parseSynthesised,
  parseCategoryByHelpText,
  { virtual: parseMapTier },
  { virtual: normalizeName },
  { virtual: findInDatabase },
  // -----------
  parseItemLevel,
  parseTalismanTier,
  parseGem,
  parseVaalGem,
  parseArmour,
  parseWeapon,
  parseAccessory,
  parseFlask,
  parseTincture,
  parseStackSize,
  parseCorrupted,
  parseImbuedGem,
  parseFoil,
  parseInfluence,
  parseMap,
  parseSockets,
  parseHeistContract,
  parseHeistBlueprint,
  parseChart,
  parseUltimatum,
  parseAreaLevel,
  parseAtzoatlRooms,
  parseMirroredTablet,
  parseFilledCoffin,
  parseBloodFilledVessel, // 怪物清單那一段
  parseBloodFilledVessel, // 固定加成說明那一段
  parseMirrored,
  parseSplit,
  parseSentinelCharge,
  parseScryingOrb,
  parseMercenary,
  parseLogbookArea,
  parseLogbookArea,
  parseLogbookArea,
  parseMercenaryGems,
  parseMercenaryGems,
  parseMercenaryGems,
  parseMercenaryGems,
  parseMercenaryGems,
  parseMercenaryGems,
  parseModifiers, // enchant
  parseModifiers, // scourge
  parseModifiers, // implicit
  parseModifiers, // explicit
  { leftovers: parseUnannotatedModifiers },
  { virtual: transformToLegacyModifiers },
  { virtual: parseFractured },
  { virtual: pickCorrectVariant },
  { virtual: calcDisenchantDust },
  { virtual: calcBasePercentile }
]

const VALUE_AUGMENTED = ' (augmented)'

export function parseClipboard (clipboard: string): Result<ParsedItem, string> {
  try {
    let sections = itemTextToSections(normalizeLabelPunctuation(clipboard))

    if (sections[0][2] === _$.CANNOT_USE_ITEM) {
      sections[0].pop() // remove CANNOT_USE_ITEM line
      sections[1].unshift(...sections[0]) // prepend item class & rarity into second section
      sections.shift() // remove first section where CANNOT_USE_ITEM line was
    }
    const parsed = parseNamePlate(sections[0])
    if (!parsed.isOk()) return parsed

    sections.shift()
    parsed.value.rawText = clipboard

    // each section can be parsed at most by one parser
    for (const parser of parsers) {
      if (typeof parser === 'object' && 'leftovers' in parser) {
        parser.leftovers(sections, parsed.value)
        continue
      }
      if (typeof parser === 'object') {
        const error = parser.virtual(parsed.value)
        if (error) return error
        continue
      }

      for (const section of sections) {
        // workaround upstream bug
        parseEldritchItem(section)

        const result = parser(section, parsed.value)
        if (result === 'SECTION_PARSED') {
          sections = sections.filter(s => s !== section)
          break
        } else if (result === 'PARSER_SKIPPED') {
          break
        }
      }
    }
    return Object.freeze(parsed)
  } catch (e) {
    // 上游只回一個沒有內容的 `item.parse_error`,並把例外丟進 console.log。
    // 結果是使用者只看得到「解析時發生錯誤」,連回報都不知道要附什麼
    // (上游 issue #1869 就卡在這裡)。把例外訊息帶進錯誤字串,
    // UI 的未知詞綴回報鈕才有東西可以附。
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return err(`item.parse_error: ${detail}`)
  }
}

/**
 * 行首標籤的標點正規化 —— **上游沒有這段**。
 *
 * `client_strings` 裡的分段標籤都是半形冒號加空格(`'物品種類: '`、`'護甲: '`),
 * 而 `parseNamePlate` 等處用 `line.startsWith(_$.ITEM_CLASS)` 精確比對。
 *
 * 但實測繁中客戶端存在**兩種標點慣例**:
 *
 *     物品種類: 手套     ← 半形冒號 + 空格(本專案 corpus 的樣本)
 *     物品種類：鞋子     ← 全形冒號、無空格(上游 issue #1869 的回報)
 *
 * 後者連第一行都比對不到,直接回 `item.parse_error` —— 那個 issue 至今未解,
 * 維護者宣稱修好但使用者持續回報。甚至同一份文字裡也會混用
 * (使用者的樣本中 `物品種類: ` 是半形而 `怪物等級：` 是全形)。
 *
 * 做法:從 `CLIENT_STRINGS` 自動導出每個標籤的全形寫法,只在**行首**做替換。
 * 刻意不做全文 `：` → `: ` 取代 —— 詞綴標註行裡的 `(階層：8)` 會被毀掉,
 * 而那個位置兩種客戶端本來就都是全形,不需要動。
 */
function normalizeLabelPunctuation (text: string): string {
  const dict = _$ as unknown as Record<string, unknown>
  /** 全形寫法 → 正規寫法。例:`物品種類：` → `物品種類: ` */
  const variants: Array<[string, string]> = []
  for (const key of Object.keys(dict)) {
    const value = dict[key]
    if (typeof value !== 'string') continue
    if (!value.endsWith(': ')) continue
    variants.push([value.slice(0, -2) + '：', value])
  }
  if (variants.length === 0) return text

  // 長的優先,避免短標籤先命中而截斷長標籤(「等級: 」vs「物品等級: 」)
  variants.sort((a, b) => b[0].length - a[0].length)

  return text.split('\n').map(line => {
    for (const [fullwidth, canonical] of variants) {
      if (line.startsWith(fullwidth)) {
        return canonical + line.slice(fullwidth.length)
      }
    }
    return line
  }).join('\n')
}

/**
 * 分隔線判定。
 *
 * ⚠ **這裡刻意偏離上游。** APT 的原始寫法是 `if (line !== '--------')`,嚴格比對
 * 8 個 dash。但實測繁體中文客戶端(國際服,3.29 Allflame)吐出的分隔線是**變長的**
 * —— 長度等於前一行的顯示寬度(CJK 字元算 2 欄)。實測樣本 260 條分隔線裡,
 * 258 條(99.2%)符合這個規律,只有 31 條剛好是 8 個 dash。
 *
 * 沿用上游寫法的話,整份物品文字會被當成單一 section,**每一件物品都解析失敗**。
 *
 * 改成「整行只有 3 個以上 dash」即視為分隔線,對 8-dash 與變長兩種格式都成立;
 * 物品文字裡不存在合法的純 dash 內容行,所以不會誤判。
 */
const SECTION_SEPARATOR = /^-{3,}$/

function itemTextToSections (text: string) {
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }

  const sections: string[][] = [[]]
  lines.reduce((section, line) => {
    if (!SECTION_SEPARATOR.test(line)) {
      section.push(line)
      return section
    } else {
      const section: string[] = []
      sections.push(section)
      return section
    }
  }, sections[0]!)
  return sections.map(trimBlankEdges).filter(section => section.length)
}

/**
 * 剝除 section 前後的空行。
 *
 * ⚠ **這裡也偏離上游。** 進階格式在每條分隔線後面會多一個空行,於是 section 的
 * 第一行是空字串。大量 section parser 是用 `section[0] === _$.某欄位` 判斷的
 * (例如 `parseUnidentified` 比對「未鑑定」),空行會讓它們全部落空。
 *
 * 實例:未鑑定的傳奇地圖 —— `isUnidentified` 沒被設起來,於是走到
 * 「傳奇且已鑑定」的分支去 UNIQUE 命名空間查基底名,查不到就回 `item.unknown`。
 *
 * **只剝前後、不動內部空行**:沒有 `{ 前綴 … }` 標註的物品(例如破裂的腰帶)
 * 是靠內部空行分隔各條詞綴的,把它們一起清掉會讓多行詞綴黏成一條。
 */
function trimBlankEdges (section: string[]): string[] {
  let start = 0
  let end = section.length
  while (start < end && section[start]!.trim() === '') start += 1
  while (end > start && section[end - 1]!.trim() === '') end -= 1
  return section.slice(start, end)
}

function normalizeName (item: ParserState) {
  if (item.rarity === ItemRarity.Magic) {
    const baseType = magicBasetype(item.name)
    if (baseType) {
      item.name = baseType
    }
  }

  if (item.category === ItemCategory.MetamorphSample) {
    if (_$.METAMORPH_BRAIN.test(item.name)) {
      item.name = 'Metamorph Brain'
    } else if (_$.METAMORPH_EYE.test(item.name)) {
      item.name = 'Metamorph Eye'
    } else if (_$.METAMORPH_LUNG.test(item.name)) {
      item.name = 'Metamorph Lung'
    } else if (_$.METAMORPH_HEART.test(item.name)) {
      item.name = 'Metamorph Heart'
    } else if (_$.METAMORPH_LIVER.test(item.name)) {
      item.name = 'Metamorph Liver'
    }
  }
}

function findInDatabase (item: ParserState) {
  let info: BaseType[] | undefined
  if (item.category === ItemCategory.DivinationCard) {
    info = ITEM_BY_TRANSLATED('DIVINATION_CARD', item.name)
  } else if (item.category === ItemCategory.CapturedBeast) {
    info = ITEM_BY_TRANSLATED('CAPTURED_BEAST', item.baseType ?? item.name)
  } else if (item.category === ItemCategory.Gem) {
    info = ITEM_BY_TRANSLATED('GEM', item.name)
  } else if (item.category === ItemCategory.MetamorphSample) {
    info = ITEM_BY_TRANSLATED('ITEM', item.name)
  } else if (item.category === ItemCategory.Voidstone) {
    info = ITEM_BY_REF('ITEM', 'Charged Compass')
  } else if (item.rarity === ItemRarity.Unique && !item.isUnidentified) {
    info = ITEM_BY_TRANSLATED('UNIQUE', item.name)
  } else {
    info = ITEM_BY_TRANSLATED('ITEM', item.baseType ?? item.name)
  }
  if (!info?.length) {
    return err('item.unknown')
  }
  if (info[0].unique) {
    const baseTypes = ITEM_BY_TRANSLATED('ITEM', item.baseType!)
    if (!baseTypes?.length) return err('item.unknown')

    // 上游只看 `baseTypes[0].refName`,但**一個顯示名可以對到多個英文底材**:
    // 繁中的「狼王魔符」同時是 `Greatwolf Talisman`(舊版譯名)與
    // `Wolf Alpha Talisman`(瑞佛詛咒的底材)。取第一個的話,瑞佛詛咒會被
    // 過濾成空陣列 → 整件解析失敗。改成比對**所有**候選。
    const baseTypeRefs = new Set(baseTypes.map(base => base.refName))
    const matched = info.filter(candidate => baseTypeRefs.has(candidate.unique!.base))
    // 上游也沒有檢查這裡是否濾空。濾空時 `info[0]` 是 undefined,錯誤會延後到下面的
    // `item.info.craftable` 才爆成看不懂的 TypeError。回報 item.unknown 才是
    // 誠實的結果 —— 「查不到這件物品」,而不是「程式壞了」。
    if (!matched.length) return err('item.unknown')
    info = matched
    // 反過來也成立:**一個英文底材可以有兩個中文名**(`Greatwolf Talisman` = 狼王魔符 /
    // 巨狼魔符),而查詢要送的是物品身上那一個 —— 見 pickCorrectVariant 對 uniqueBase 的挑法。
  }
  item.infoVariants = info
  // choose 1st variant, correct one will be picked at the end of parsing
  item.info = info[0]
  // same for every variant
  if (!item.category) {
    if (item.info.craftable) {
      item.category = item.info.craftable.category
    } else if (item.info.unique) {
      item.category = ITEM_BY_REF('ITEM',
        item.info.unique.base)![0].craftable!.category
    }
  }
  // noImplicitReturns:此函式在失敗時回 err(...),成功則回 undefined。
  // 原本靠隱含 undefined,這裡寫明,行為不變。
  return undefined
}

export function makeIdentifiedUnique (uniqueInfo: BaseType, unidentified: ParsedItem): ParsedItem {
  const newItem: ParsedItem = {
    ...unidentified,
    info: uniqueInfo,
    uniqueBase: unidentified.info
  }

  calcDisenchantDust(newItem)

  return Object.freeze(newItem)
}

function parseMapTier (item: ParserState) {
  const execResult = _$.MAP_TIER.exec(item.baseType || item.name)
  if (!execResult) return

  item.mapTier = Number(execResult[1])

  if (item.baseType) {
    item.baseType = item.baseType.replace(execResult[0], '')
  } else {
    item.name = item.name.replace(execResult[0], '')
  }
}

function parseAreaPropNested (line: string, item: ParsedItem): boolean {
  if (line.startsWith(_$.MAP_ITEM_QUANTITY)) {
    item.areaItemQuantity = parseInt(line.slice(_$.MAP_ITEM_QUANTITY.length), 10)
    return true
  } else if (line.startsWith(_$.MAP_ITEM_RARITY)) {
    item.areaItemRarity = parseInt(line.slice(_$.MAP_ITEM_RARITY.length), 10)
    return true
  } else if (line.startsWith(_$.MAP_MONSTER_PACK_SIZE)) {
    item.areaPackSize = parseInt(line.slice(_$.MAP_MONSTER_PACK_SIZE.length), 10)
    return true
  }
  return false
}

function parseMap (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Map) return 'PARSER_SKIPPED'

  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (parseAreaPropNested(line, item)) {
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MORE_MAPS)) {
      item.mapMoreMaps = parseInt(line.slice(_$.MAP_MORE_MAPS.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MORE_SCARABS)) {
      item.mapMoreScarabs = parseInt(line.slice(_$.MAP_MORE_SCARABS.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MORE_CURRENCY)) {
      item.mapMoreCurrency = parseInt(line.slice(_$.MAP_MORE_CURRENCY.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MORE_DIVINATION_CARDS)) {
      item.mapMoreDivCards = parseInt(line.slice(_$.MAP_MORE_DIVINATION_CARDS.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_AREA)) {
      const areaName = section[0].slice(_$.MAP_AREA.length)
      const areaInfo = ITEM_BY_TRANSLATED('AREA', areaName)
      if (!areaInfo) throw new Error('Unknown Area name.')
      item.mapArea = areaInfo[0]
      isParsed = 'SECTION_PARSED'
    } else if (_$.MAP_COMPLETION_REWARD.test(line)) {
      const rewardName = _$.MAP_COMPLETION_REWARD.exec(line)![1]
      const rewardInfo = ITEM_BY_TRANSLATED('UNIQUE', rewardName)
      if (!rewardInfo) throw new Error('Unknown Unique Item.')
      item.mapCompletionReward = rewardInfo[0]
      isParsed = 'SECTION_PARSED'
    }
  }

  return isParsed
}

function parseFractured (item: ParserState) {
  if (item.newMods.some(mod => mod.info.type === ModifierType.Fractured)) {
    item.isFractured = true
  }
}

function pickCorrectVariant (item: ParserState) {
  item.info = _pickCorrectVariant(item.infoVariants, item) ?? item.infoVariants[0]
  if (item.info.unique) {
    let baseVariants = ITEM_BY_REF('ITEM', item.info.unique.base)!
    // 同一個英文底材可以有兩個中文名(`Greatwolf Talisman` = 狼王魔符(舊版)/ 巨狼魔符
    // (現行)),上游一律拿 `[0]` 會送成舊版:實測巨狼之眼送 `type=狼王魔符` 撈到 2521 筆、
    // 送 `type=巨狼魔符` 只有 55 筆,拿舊版的價估現行的物品就是報錯價。
    // 先把候選縮到**物品身上那一行底材**的譯名,再交給上游的 disc 挑選;縮不到就照舊。
    if (item.baseType) {
      const sameName = baseVariants.filter(variant => variant.name === item.baseType)
      if (sameName.length) baseVariants = sameName
    }
    item.uniqueBase = _pickCorrectVariant(baseVariants, item) ?? baseVariants[0]
  }
}

function _pickCorrectVariant (variants: BaseType[], item: ParsedItem): BaseType | undefined {
  if (variants.length <= 1) return variants[0]

  for (const variant of variants) {
    const cond = variant.disc!

    if (cond.propAR && !item.armourAR) continue
    if (cond.propEV && !item.armourEV) continue
    if (cond.propES && !item.armourES) continue

    if (cond.mapTier) {
      if (!item.mapTier) continue
      if (cond.mapTier === 'W' && !(item.mapTier <= 5)) continue
      if (cond.mapTier === 'Y' && !(item.mapTier >= 6 && item.mapTier <= 10)) continue
      if (cond.mapTier === 'R' && !(item.mapTier >= 11)) continue
    }

    if (cond.hasImplicit && !item.statsByType.some(calc =>
      calc.type === ModifierType.Implicit &&
      calc.stat.ref === cond.hasImplicit!.ref)
    ) continue

    if (cond.hasExplicit && !item.statsByType.some(calc =>
      calc.type === ModifierType.Explicit &&
      calc.stat.ref === cond.hasExplicit!.ref)
    ) continue

    if (cond.sectionText && !item.rawText.includes(cond.sectionText)) continue

    return variant
  }

  // it may happen that we don't find correct variant
  // i.e. corrupted implicit on Two-Stone Ring
}

function parseNamePlate (section: string[]) {
  let line = section.shift()
  if (!line?.startsWith(_$.ITEM_CLASS)) {
    return err('item.parse_error')
  }

  line = section.shift()
  let rarityText: string | undefined
  if (line?.startsWith(_$.RARITY)) {
    rarityText = line.slice(_$.RARITY.length)
    line = section.shift()
  }

  let name: string
  if (line != null) {
    name = markupConditionParser(line)
  } else {
    return err('item.parse_error')
  }

  line = section.shift()
  const baseType = line && markupConditionParser(line)

  const item: ParserState = {
    rarity: undefined,
    category: undefined,
    name: name,
    baseType: baseType,
    isUnidentified: false,
    isCorrupted: false,
    newMods: [],
    statsByType: [],
    unknownModifiers: [],
    influences: [],
    info: undefined!,
    infoVariants: undefined!,
    rawText: undefined!
  }

  switch (rarityText) {
    case _$.RARITY_CURRENCY:
      item.category = ItemCategory.Currency; break
    case _$.RARITY_DIVCARD:
      item.category = ItemCategory.DivinationCard; break
    case _$.RARITY_GEM:
      item.category = ItemCategory.Gem; break
    case _$.RARITY_NORMAL:
    case _$.RARITY_QUEST:
      item.rarity = ItemRarity.Normal; break
    case _$.RARITY_MAGIC:
      item.rarity = ItemRarity.Magic; break
    case _$.RARITY_RARE:
      item.rarity = ItemRarity.Rare; break
    case _$.RARITY_UNIQUE:
      item.rarity = ItemRarity.Unique; break
  }

  return ok(item)
}

function parseInfluence (section: string[], item: ParsedItem) {
  if (section.length <= 2) {
    const countBefore = item.influences.length

    for (const line of section) {
      switch (line) {
        case _$.INFLUENCE_CRUSADER:
          item.influences.push(ItemInfluence.Crusader)
          break
        case _$.INFLUENCE_ELDER:
          item.influences.push(ItemInfluence.Elder)
          break
        case _$.INFLUENCE_SHAPER:
          item.influences.push(ItemInfluence.Shaper)
          break
        case _$.INFLUENCE_HUNTER:
          item.influences.push(ItemInfluence.Hunter)
          break
        case _$.INFLUENCE_REDEEMER:
          item.influences.push(ItemInfluence.Redeemer)
          break
        case _$.INFLUENCE_WARLORD:
          item.influences.push(ItemInfluence.Warlord)
          break
      }
    }

    if (countBefore < item.influences.length) {
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseCorrupted (section: string[], item: ParsedItem) {
  if (section[0] === _$.CORRUPTED) {
    item.isCorrupted = true
    return 'SECTION_PARSED'
  } else if (section[0] === _$.UNMODIFIABLE) {
    item.isCorrupted = true
    item.isUnmodifiable = true
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseFoil (section: string[], item: ParsedItem) {
  if (item.rarity !== ItemRarity.Unique) {
    return 'PARSER_SKIPPED'
  }
  if (section[0] === _$.FOIL_UNIQUE) {
    item.isFoil = true
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseUnidentified (section: string[], item: ParsedItem) {
  if (section[0] === _$.UNIDENTIFIED) {
    item.isUnidentified = true
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseItemLevel (section: string[], item: ParsedItem) {
  let prefix = _$.ITEM_LEVEL
  if (item.info.refName === 'Filled Coffin') {
    prefix = _$.CORPSE_LEVEL
  }

  for (const line of section) {
    if (line.startsWith(prefix)) {
      item.itemLevel = Number(line.slice(prefix.length))
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseTalismanTier (section: string[], item: ParsedItem) {
  if (section[0].startsWith(_$.TALISMAN_TIER)) {
    item.talismanTier = Number(section[0].slice(_$.TALISMAN_TIER.length))
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseVaalGem (section: string[], item: ParserState) {
  if (item.category !== ItemCategory.Gem) return 'PARSER_SKIPPED'

  if (section.length === 1) {
    const gemInfo = ITEM_BY_TRANSLATED('GEM', section[0])
    if (gemInfo) {
      item.vaalGem = gemInfo[0]
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseGem (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Gem) {
    return 'PARSER_SKIPPED'
  }
  if (section[1]?.startsWith(_$.GEM_LEVEL)) {
    // "Level: 20 (Max)"
    item.gemLevel = parseInt(section[1].slice(_$.GEM_LEVEL.length), 10)

    parseQualityNested(section, item)

    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseImbuedGem (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Gem) return 'PARSER_SKIPPED'

  if (section.length === 1) {
    const support = STAT_BY_MATCH_STR(section[0])
    if (!support) return 'SECTION_SKIPPED'

    item.newMods.push({
      info: { tags: [], type: ModifierType.Imbued },
      stats: [{
        stat: support.stat,
        translation: support.matcher
      }]
    })
    item.imbuedGem = true

    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseStackSize (section: string[], item: ParsedItem) {
  if (item.rarity !== ItemRarity.Normal &&
      item.category !== ItemCategory.Currency &&
      item.category !== ItemCategory.DivinationCard) {
    return 'PARSER_SKIPPED'
  }
  if (section[0].startsWith(_$.STACK_SIZE)) {
    // Portal Scroll "Stack Size: 2[localized separator]448/40"
    const [value, max] = section[0].slice(_$.STACK_SIZE.length).replace(/[^\d/]/g, '').split('/').map(Number)
    item.stackSize = { value, max }

    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseSockets (section: string[], item: ParsedItem) {
  if (section[0].startsWith(_$.SOCKETS)) {
    let sockets = section[0].slice(_$.SOCKETS.length).trimEnd()

    item.sockets = {
      white: (sockets.split('W').length - 1),
      linked: undefined
    }

    sockets = sockets.replace(/[^ -]/g, '#')
    if (sockets === '#-#-#-#-#-#') {
      item.sockets.linked = 6
    } else if (
      sockets === '# #-#-#-#-#' ||
      sockets === '#-#-#-#-# #' ||
      sockets === '#-#-#-#-#'
    ) {
      item.sockets.linked = 5
    }
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseQualityNested (section: string[], item: ParsedItem): boolean {
  for (const line of section) {
    if (line.startsWith(_$.QUALITY)) {
      // "Quality: +20% (augmented)"
      item.quality = parseInt(line.slice(_$.QUALITY.length), 10)
      return true
    }
  }
  return false
}

function parseMemoryStrandsNested (section: string[], item: ParsedItem): boolean {
  for (const line of section) {
    if (line.startsWith(_$.MEMORY_STRANDS)) {
      item.memoryStrands = parseInt(line.slice(_$.MEMORY_STRANDS.length), 10)
      return true
    }
  }
  return false
}

function parseArmour (section: string[], item: ParsedItem) {
  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (line.startsWith(_$.ARMOUR)) {
      item.armourAR = parseInt(line.slice(_$.ARMOUR.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.EVASION)) {
      item.armourEV = parseInt(line.slice(_$.EVASION.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.ENERGY_SHIELD)) {
      item.armourES = parseInt(line.slice(_$.ENERGY_SHIELD.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.TAG_WARD)) {
      item.armourWARD = parseInt(line.slice(_$.TAG_WARD.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.BLOCK_CHANCE)) {
      item.armourBLOCK = parseInt(line.slice(_$.BLOCK_CHANCE.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
  }

  if (isParsed === 'SECTION_PARSED') {
    parseQualityNested(section, item)
    parseMemoryStrandsNested(section, item)
  }

  return isParsed
}

function parseWeapon (section: string[], item: ParsedItem) {
  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (line.startsWith(_$.CRIT_CHANCE)) {
      item.weaponCRIT = parseFloat(line.slice(_$.CRIT_CHANCE.length))
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.ATTACK_SPEED)) {
      item.weaponAS = parseFloat(line.slice(_$.ATTACK_SPEED.length))
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.PHYSICAL_DAMAGE)) {
      item.weaponPHYSICAL = getRollOrMinmaxAvg(line
        .slice(_$.PHYSICAL_DAMAGE.length)
        .split('-').map(str => parseInt(str, 10))
      )
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.ELEMENTAL_DAMAGE)) {
      item.weaponELEMENTAL =
        line.slice(_$.ELEMENTAL_DAMAGE.length)
          .split(', ')
          .map(element => getRollOrMinmaxAvg(element.split('-').map(str => parseInt(str, 10))))
          .reduce((sum, x) => sum + x, 0)

      isParsed = 'SECTION_PARSED'; continue
    }
  }

  if (isParsed === 'SECTION_PARSED') {
    parseQualityNested(section, item)
    parseMemoryStrandsNested(section, item)
  }

  return isParsed
}

function parseAccessory (section: string[], item: ParsedItem) {
  if (!JEWELLERY.has(item.category!) && item.category !== ItemCategory.Quiver) return 'PARSER_SKIPPED'

  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (line.endsWith(VALUE_AUGMENTED)) {
      const found = tryParseTranslation({ string: line.slice(0, -VALUE_AUGMENTED.length), unscalable: true }, ModifierType.Pseudo, undefined)
      if (found && found.stat.jewelleryQuality) {
        item.quality = found.roll!.value
        item.newMods.push({
          info: { tags: [], type: ModifierType.Pseudo },
          stats: [found]
        })
        isParsed = 'SECTION_PARSED'
      }
    }
  }

  if (parseMemoryStrandsNested(section, item)) {
    isParsed = 'SECTION_PARSED'
  }

  return isParsed
}

function parseLogbookArea (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Expedition Logbook') return 'PARSER_SKIPPED'
  if (section.length < 3) return 'SECTION_SKIPPED'

  // skip Logbook Area line, parse Faction
  const faction = STAT_BY_MATCH_STR(section[1])
  if (!faction || !faction.stat.ref.startsWith('Has Logbook Faction:')) return 'SECTION_SKIPPED'

  const areaMods: ParsedModifier[] = [{
    info: { tags: [], type: ModifierType.Pseudo },
    stats: [{
      stat: faction.stat,
      translation: faction.matcher
    }]
  }]

  const { modType, lines } = parseModType(section.slice(2))
  for (const line of lines) {
    const found = STAT_BY_MATCH_STR(line)
    // Area contains an Expedition Boss (#)
    if (found && found.stat.better === StatBetter.NotComparable) {
      areaMods.push({
        info: { tags: [], type: modType },
        stats: [{
          stat: found.stat,
          translation: found.matcher
        }]
      })
    }
  }

  if (!item.logbookAreaMods) {
    item.logbookAreaMods = [areaMods]
  } else {
    item.logbookAreaMods.push(areaMods)
  }

  return 'SECTION_PARSED'
}

function parseMercenary (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Mercenary Warrant') return 'PARSER_SKIPPED'

  for (const line of section) {
    if (line.startsWith(_$.MERCENARY_LEVEL)) {
      item.itemLevel = Number(line.slice(_$.MERCENARY_LEVEL.length))
    } else if (line.startsWith(_$.MERCENARY_BUILD)) {
      let buildInfo = ITEM_BY_TRANSLATED('MERCENARY_BUILD', line.slice(_$.MERCENARY_BUILD.length))
      if (!buildInfo) throw new Error('Unknown Mercenary Build.')

      if (typeof buildInfo[0].mercenaryBuild === 'string') {
        buildInfo = ITEM_BY_REF('MERCENARY_BUILD', buildInfo[0].mercenaryBuild)!
      }
      item.mercenaryBuild = buildInfo[0]
    }
  }

  if (item.mercenaryBuild) {
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseMercenaryGems (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Mercenary Warrant') return 'PARSER_SKIPPED'

  const skill = tryParseTranslation({ string: section[0], unscalable: true }, ModifierType.Pseudo, ItemCategory.MercenaryWarrant)
  if (!skill) return 'SECTION_SKIPPED'

  const group: ParsedStat[] = [skill]

  for (const line of section.slice(1)) {
    const support = tryParseTranslation({ string: line, unscalable: true }, ModifierType.Pseudo, ItemCategory.MercenaryWarrant)
    if (support) {
      group.push(support)
    }
    if (!support || (support.stat.mercenary!.syntheticFamily && support.stat.mercenary!.tier !== 3)) {
      item.unknownModifiers.push({
        text: `${line} [${section[0]}]`,
        type: ModifierType.Pseudo
      })
    }
  }

  if (!item.mercenarySkills) {
    item.mercenarySkills = []
  }
  item.mercenarySkills.push(group)

  return 'SECTION_PARSED'
}

function parseModifiers (section: string[], item: ParsedItem) {
  if (
    item.rarity !== ItemRarity.Normal &&
    item.rarity !== ItemRarity.Magic &&
    item.rarity !== ItemRarity.Rare &&
    item.rarity !== ItemRarity.Unique
  ) {
    return 'PARSER_SKIPPED'
  }

  const recognizedLine = section.find(line =>
    line.endsWith(ENCHANT_LINE) ||
    line.endsWith(SCOURGE_LINE) ||
    isModInfoLine(line)
  )

  if (!recognizedLine) {
    return 'SECTION_SKIPPED'
  }

  if (isModInfoLine(recognizedLine)) {
    for (const { modLine, statLines } of groupLinesByMod(section)) {
      const modInfo = parseModInfoLine(modLine)
      if (statLines[0] === _$.VEILED_PREFIX || statLines[0] === _$.VEILED_SUFFIX) {
        modInfo.type = ModifierType.Veiled
        item.isVeiled = true
      }
      parseStatsFromMod(statLines, item, { info: modInfo, stats: [] })
    }
  } else {
    const { modType, lines } = parseModType(section)
    const modInfo: ModifierInfo = {
      type: modType,
      tags: []
    }
    parseStatsFromMod(lines, item, { info: modInfo, stats: [] })
  }

  return 'SECTION_PARSED'
}

function parseMirrored (section: string[], item: ParsedItem) {
  if (section[0] === _$.MIRRORED) {
    item.isMirrored = true
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseSplit (section: string[], item: ParsedItem) {
  if (section.length === 1) {
    if (section[0] === _$.SPLIT) {
      item.isSplit = true
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseFlask (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Flask) return 'PARSER_SKIPPED'

  // the purpose of this parser is to "consume" flask buffs
  // so they are not recognized as modifiers

  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (_$.FLASK_CHARGES.test(line)) {
      isParsed = 'SECTION_PARSED'; break
    }
  }

  if (isParsed === 'SECTION_PARSED') {
    parseQualityNested(section, item)
  }

  return isParsed
}

function parseTincture (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Tincture) return 'PARSER_SKIPPED'

  if (parseQualityNested(section, item)) {
    return 'SECTION_PARSED'
  }

  return 'SECTION_SKIPPED'
}

function parseSentinelCharge (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Sentinel) return 'PARSER_SKIPPED'

  if (section.length === 1) {
    if (section[0].startsWith(_$.SENTINEL_CHARGE)) {
      item.sentinelCharge = parseInt(section[0].slice(_$.SENTINEL_CHARGE.length), 10)
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseScryingOrb (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Scrying Orb') return 'PARSER_SKIPPED'

  if (section.length === 1) {
    if (section[0].startsWith(_$.MAP_AREA)) {
      const areaName = section[0].slice(_$.MAP_AREA.length)
      const areaInfo = ITEM_BY_TRANSLATED('AREA', areaName)
      if (!areaInfo) throw new Error('Unknown Area name.')
      item.mapArea = areaInfo[0]
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseEldritchItem (section: string[]): void {
  // these don't have a dedicated section and are appended to last-ish one,
  // it can be Explicit Mods section, Corrupted, or Mirrored line.
  while (section.length) {
    const lastLine = section[section.length - 1]
    if (lastLine === _$.ITEM_EATER || lastLine === _$.ITEM_EXARCH) {
      section.pop()
    } else {
      break
    }
  }
}

function parseSynthesised (section: string[], item: ParserState) {
  if (section.length === 1) {
    if (section[0] === _$.SECTION_SYNTHESISED) {
      item.isSynthesised = true
      if (item.baseType) {
        item.baseType = _$.ITEM_SYNTHESISED.exec(item.baseType)![1]
      } else {
        item.name = _$.ITEM_SYNTHESISED.exec(item.name)![1]
      }
      return 'SECTION_PARSED'
    }
  }

  return 'SECTION_SKIPPED'
}

function parseSuperior (item: ParserState) {
  if (
    (item.rarity === ItemRarity.Normal) ||
    (item.rarity === ItemRarity.Magic && item.isUnidentified) ||
    (item.rarity === ItemRarity.Rare && item.isUnidentified) ||
    (item.rarity === ItemRarity.Unique && item.isUnidentified)
  ) {
    if (_$.ITEM_SUPERIOR.test(item.name)) {
      item.name = _$.ITEM_SUPERIOR.exec(item.name)![1]
    }
  }
}

function parseFoulborn (item: ParserState) {
  if (item.rarity !== ItemRarity.Unique || item.isUnidentified) return

  if (_$.FOULBORN_NAME.test(item.name)) {
    item.name = _$.FOULBORN_NAME.exec(item.name)![1]
    item.isFoulborn = true
  }
}

/**
 * 3.29 軍團機制「殘存」(Vestigial)。籠罩晶石作用於傳奇護甲後,遊戲在**底材那一行**
 * 前面加一個裝飾詞:
 *
 *     毀面者
 *     殘存 扣環護手        ← `ITEM_BY_TRANSLATED('ITEM', …)` 查不到,整件解析失敗
 *
 * 剝的是 `baseType` 不是 `name`(與 `parseFoulborn` 相反,Foulborn 裝飾的是傳奇名),
 * 但仍照 `parseSynthesised` 的寫法留 `name` 的退路 —— 沒有底材那一行的物品也能處理。
 *
 * ⚠ 這**不是**繁中專屬的缺陷:英文的 `Vestigial Strapped Mitts` 在 en 資料集同樣查無,
 * 上游只是還沒遇到。`ru` / `ko` 沒有可信譯名,`VESTIGIAL_NAME` 在那兩個語系不存在,
 * 此函式直接跳過,行為與加這段之前一模一樣。
 */
function parseVestigial (item: ParserState) {
  const re = _$.VESTIGIAL_NAME
  if (!re) return

  if (item.baseType) {
    if (!re.test(item.baseType)) return
    item.baseType = re.exec(item.baseType)![1]
  } else {
    if (!re.test(item.name)) return
    item.name = re.exec(item.name)![1]
  }
  item.isVestigial = true
}

function parseCategoryByHelpText (section: string[], item: ParsedItem) {
  if (section[0] === _$.BEAST_HELP) {
    item.category = ItemCategory.CapturedBeast
    return 'SECTION_PARSED'
  } else if (section[0] === _$.METAMORPH_HELP) {
    item.category = ItemCategory.MetamorphSample
    return 'SECTION_PARSED'
  } else if (section[0] === _$.VOIDSTONE_HELP) {
    item.category = ItemCategory.Voidstone
    return 'SECTION_PARSED'
  }

  return 'SECTION_SKIPPED'
}

function parseHeistContract (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.HeistContract) return 'PARSER_SKIPPED'

  if (!parseAreaLevelNested(section, item)) {
    return 'SECTION_SKIPPED'
  }

  item.heistContract = {}

  for (const line of section) {
    const jobMatch = line.match(_$.HEIST_CONTRACT_JOB)
    if (jobMatch) {
      switch (jobMatch.groups!.job) {
        case _$.HEIST_JOB_LOCKPICKING:
          item.heistContract.requiredJob = 'Lockpicking'; break
        case _$.HEIST_JOB_BRUTEFORCE:
          item.heistContract.requiredJob = 'Brute Force'; break
        case _$.HEIST_JOB_PERCEPTION:
          item.heistContract.requiredJob = 'Perception'; break
        case _$.HEIST_JOB_DEMOLITION:
          item.heistContract.requiredJob = 'Demolition'; break
        case _$.HEIST_JOB_COUNTERTHAUMATURGY:
          item.heistContract.requiredJob = 'Counter-Thaumaturgy'; break
        case _$.HEIST_JOB_TRAPDISARMAMENT:
          item.heistContract.requiredJob = 'Trap Disarmament'; break
        case _$.HEIST_JOB_AGILITY:
          item.heistContract.requiredJob = 'Agility'; break
        case _$.HEIST_JOB_DECEPTION:
          item.heistContract.requiredJob = 'Deception'; break
        case _$.HEIST_JOB_ENGINEERING:
          item.heistContract.requiredJob = 'Engineering'; break
      }
      item.heistContract.jobLevel = Number(jobMatch.groups!.level)
      continue
    }

    const targetMatch = line.match(_$.HEIST_CONTRACT_TARGET)
    if (targetMatch) {
      if (targetMatch[1] === _$.HEIST_TARGET_PRICELESS) {
        item.heistContract.targetValue = 'Priceless'
      }
      continue
    }
  }

  return 'SECTION_PARSED'
}

function parseHeistBlueprint (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.HeistBlueprint) return 'PARSER_SKIPPED'

  if (!parseAreaLevelNested(section, item)) {
    return 'SECTION_SKIPPED'
  }

  item.heistBlueprint = {}

  for (const line of section) {
    if (line.startsWith(_$.HEIST_BLUEPRINT_TARGET)) {
      const targetText = line.slice(_$.HEIST_BLUEPRINT_TARGET.length)
      switch (targetText) {
        case _$.HEIST_BLUEPRINT_ENCHANTS:
          item.heistBlueprint.target = 'Enchants'; break
        case _$.HEIST_BLUEPRINT_GEMS:
          item.heistBlueprint.target = 'Gems'; break
        case _$.HEIST_BLUEPRINT_REPLICAS:
          item.heistBlueprint.target = 'Replicas'; break
        case _$.HEIST_BLUEPRINT_TRINKETS:
          item.heistBlueprint.target = 'Trinkets'; break
      }
    } else if (line.startsWith(_$.HEIST_WINGS_REVEALED)) {
      const [revealed, total] = line.slice(_$.HEIST_WINGS_REVEALED.length).split('/')
      item.heistBlueprint.wingsRevealed = parseInt(revealed, 10)
      item.heistBlueprint.wingsTotal = parseInt(total, 10)
    }
  }

  return 'SECTION_PARSED'
}

function parseChart (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Chart) return 'PARSER_SKIPPED'

  if (!parseAreaLevelNested(section, item)) {
    return 'SECTION_SKIPPED'
  }

  const areaInfo = ITEM_BY_TRANSLATED('AREA', section[0])
  if (!areaInfo) throw new Error('Unknown Area name.')
  item.mapArea = areaInfo[0]

  for (const line of section) {
    if (parseAreaPropNested(line, item)) {
      // line parsed
    } else if (line.startsWith(_$.CHART_SULPHUR)) {
      item.chartSulphur = parseInt(line.slice(_$.CHART_SULPHUR.length), 10)
    }
  }

  return 'SECTION_PARSED'
}

/**
 * 最後通牒雕刻(`Inscribed Ultimatum`)—— 上游完全沒做過這個物品類別。
 *
 * 名牌下方那一段有四行決定價值的資訊(挑戰、區域等級、需求獻祭、獎勵),而在此之前
 * **整段被靜默丟棄**:`parseAreaLevel` 的白名單沒有它,leftovers 的
 * `parseUnannotatedModifiers` 又只處理白裝/魔法/稀有/傳奇,雕刻的稀有度是通貨。
 * 結果查價只送得出物品名,等於在搜尋全部的雕刻。
 *
 * 對接一律走 GGPK 的 ident(`ultimatumencountertypes` / `ultimatumitemisedrewards`),
 * 因為**物品上的文字與交易站選項的文字不一樣**(遊戲寫「存活」、交易站寫「倖存」),
 * 拿文字互比必錯。ident 本身就是交易站的 option id。
 */
function parseUltimatum (section: string[], item: ParserState) {
  if (item.info.refName !== 'Inscribed Ultimatum') return 'PARSER_SKIPPED'

  parseAreaLevelNested(section, item)
  if (!item.areaLevel) {
    return 'SECTION_SKIPPED'
  }

  const challengeByText = new Map<string | undefined, NonNullable<ParsedItem['ultimatum']>['challenge']>([
    [_$.ULTIMATUM_CHALLENGE_EXTERMINATE, 'Exterminate'],
    [_$.ULTIMATUM_CHALLENGE_SURVIVAL, 'Survival'],
    [_$.ULTIMATUM_CHALLENGE_DEFENSE, 'Defense'],
    [_$.ULTIMATUM_CHALLENGE_CONQUER, 'Conquer']
  ])
  const rewardByText = new Map<string | undefined, NonNullable<ParsedItem['ultimatum']>['reward']>([
    [_$.ULTIMATUM_REWARD_DOUBLE_CURRENCY, 'DoubleCurrency'],
    [_$.ULTIMATUM_REWARD_DOUBLE_DIVCARDS, 'DoubleDivCards'],
    [_$.ULTIMATUM_REWARD_MIRROR_RARE, 'MirrorRare']
  ])

  item.ultimatum = {}

  for (const line of section) {
    if (_$.ULTIMATUM_CHALLENGE !== undefined && line.startsWith(_$.ULTIMATUM_CHALLENGE)) {
      // 認不出的挑戰類型留 undefined,不猜
      item.ultimatum.challenge = challengeByText.get(line.slice(_$.ULTIMATUM_CHALLENGE.length))
      continue
    }

    const sacrificeMatch = _$.ULTIMATUM_SACRIFICE && line.match(_$.ULTIMATUM_SACRIFICE)
    if (sacrificeMatch) {
      // 獻祭通貨時尾巴帶數量(`寶石匠的稜鏡 x10`),交易站只吃物品名,先剝掉。
      // 剝不掉就原樣保留 —— 「可鏡像、稀有物品」那種靜態敘述本來就沒有數量。
      const withQuantity = _$.ULTIMATUM_SACRIFICE_QUANTITY &&
        sacrificeMatch[1].match(_$.ULTIMATUM_SACRIFICE_QUANTITY)
      if (withQuantity) {
        item.ultimatum.sacrifice = withQuantity[1]
        item.ultimatum.sacrificeQuantity = Number(withQuantity[2])
      } else {
        item.ultimatum.sacrifice = sacrificeMatch[1]
      }
      continue
    }

    const rewardMatch = _$.ULTIMATUM_REWARD && line.match(_$.ULTIMATUM_REWARD)
    if (rewardMatch) {
      // 三種靜態文字都不是 → 這一行是動態的傳奇物品名,也就是「獻祭傳奇換傳奇」那種。
      // ⚠ 這條回推路徑目前沒有實物樣本可驗,只有 GGPK 的資料結構佐證
      //   (ultimatumitemisedrewards 對 ExchangeUnique 沒有靜態 RewardText)。
      item.ultimatum.reward = rewardByText.get(rewardMatch[1]) ?? 'ExchangeUnique'
      continue
    }
  }

  return 'SECTION_PARSED'
}

/**
 * 區域等級的標籤 —— **上游只認一種寫法,這裡兩種都認。**
 *
 * 英文只有一個 `Area Level: `,但繁中客戶端**用了兩個不同的詞來翻它**:
 *
 *   地區等級:    藍圖、契約書、探險日誌(Heist / Expedition 系)
 *   區域等級:    海圖、聖域研究
 *
 * `client_strings` 只收了前者,所以海圖與聖域研究的 `areaLevel` 永遠是 undefined ——
 * 海圖甚至因此讓 `parseChart` 一開始就 return,整段獎勵屬性跟著遺失。
 *
 * 第二種寫法放在資料檔的 `AREA_LEVEL_ALT`(規格 §3.4:parser 程式碼內不得有中文
 * 字面量,措辭一律留在資料層)。沒有第二種寫法的語系不必提供該欄位。
 */
function areaLevelLabels (): string[] {
  const labels = [_$.AREA_LEVEL]
  if (_$.AREA_LEVEL_ALT !== undefined && _$.AREA_LEVEL_ALT.length > 0) {
    labels.push(_$.AREA_LEVEL_ALT)
  }
  return labels
}

function parseAreaLevelNested (section: string[], item: ParsedItem): boolean {
  for (const line of section) {
    for (const label of areaLevelLabels()) {
      if (line.startsWith(label)) {
        item.areaLevel = Number(line.slice(label.length))
        return true
      }
    }
  }
  return false
}

function parseAreaLevel (section: string[], item: ParsedItem) {
  if (
    item.info.refName !== 'Chronicle of Atzoatl' &&
    item.info.refName !== 'Expedition Logbook' &&
    item.info.refName !== 'Mirrored Tablet' &&
    item.info.refName !== 'Forbidden Tome' &&
    // 海圖由 parseChart 處理,但它若因故沒認領到 section,這裡當備援
    item.category !== ItemCategory.Chart
  ) return 'PARSER_SKIPPED'

  if (!parseAreaLevelNested(section, item)) {
    return 'SECTION_SKIPPED'
  }

  return 'SECTION_PARSED'
}

function parseAtzoatlRooms (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Chronicle of Atzoatl') return 'PARSER_SKIPPED'
  if (section[0] !== _$.INCURSION_OPEN) return 'SECTION_SKIPPED'

  let state = IncursionRoom.Open
  for (const line of section.slice(1)) {
    if (line === _$.INCURSION_OBSTRUCTED) {
      state = IncursionRoom.Obstructed
      continue
    }

    const found = STAT_BY_MATCH_STR(line)
    if (found) {
      item.newMods.push({
        info: { tags: [], type: ModifierType.Pseudo },
        stats: [{
          stat: found.stat,
          translation: {
            string: (state === IncursionRoom.Open)
              ? found.matcher.string
              : `${_$.INCURSION_OBSTRUCTED} ${found.matcher.string}`
          },
          roll: { value: state, min: state, max: state, dp: false, unscalable: true }
        }]
      })
    } else {
      item.unknownModifiers.push({
        text: line,
        type: ModifierType.Pseudo
      })
    }
  }

  return 'SECTION_PARSED'
}

function parseMirroredTablet (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Mirrored Tablet') return 'PARSER_SKIPPED'
  if (section.length < 8) return 'SECTION_SKIPPED'

  for (const line of section) {
    const found = tryParseTranslation({ string: line, unscalable: true }, ModifierType.Pseudo, undefined)
    if (found) {
      item.newMods.push({
        info: { tags: [], type: ModifierType.Pseudo },
        stats: [found]
      })
    } else {
      item.unknownModifiers.push({
        text: line,
        type: ModifierType.Pseudo
      })
    }
  }

  return 'SECTION_PARSED'
}

function parseFilledCoffin (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Filled Coffin') return 'PARSER_SKIPPED'
  if (!section.some(line => line.endsWith(IMPLICIT_LINE))) return 'SECTION_SKIPPED'

  const { lines } = parseModType(section)
  const modInfo: ModifierInfo = {
    type: ModifierType.Necropolis,
    tags: []
  }
  parseStatsFromMod(lines, item, { info: modInfo, stats: [] })

  return 'SECTION_PARSED'
}

/**
 * 交易站對浸血碑器的兩條 pseudo 詞綴。四個 realm 的 id 一致
 * (`pseudo.pseudo_ritual_unique_monsters` / `pseudo.pseudo_ritual_other_monsters`),
 * 四個語系的 `stats.ndjson` 也都已經有這兩列,所以這裡不必補資料、只要取用。
 *
 * ⚠ **大小寫陷阱,不要「順手改成一致」**:交易站 items API 給的物品名是
 * `Blood-filled Vessel`(**小寫 f**,`refName` 與送出去的 type 一律照它),而這兩條
 * pseudo 的 ref 寫的是 `… (Blood-Filled Vessel): #`(**大寫 F**)。GGG 自己就不一致
 * —— 把任何一邊改成跟另一邊一樣,結果都是靜默搜不到(前者查無此物品,後者查無此
 * stat),而且型別檢查、lint、建置全都照樣綠。
 */
const RITUAL_UNIQUE_MONSTERS = stat('Unique Monsters (Blood-Filled Vessel): #')
const RITUAL_OTHER_MONSTERS = stat('Non-Unique Monsters (Blood-Filled Vessel): #')

/**
 * 浸血碑器(`Blood-filled Vessel`)—— 3.29 的地圖碎片,**上游完全沒做**。
 *
 * 兩層缺口疊在一起,所以這不是繁中壞掉,英文版一樣查不到:
 *   1. `items.ndjson` **四個語系一個都沒有**這個基底(上游基準 3.29.102 沒跟上),
 *      `findInDatabase` 直接回 `item.unknown`。本專案只補 en / cmn-Hant
 *      (`missing-items.json` 的 `fragment` 組),`ru` / `ko` 沿用上游;
 *   2. 就算補上基底,parser 也沒有「數怪物」的程式碼 —— 而交易站對這件物品**正是**
 *      用怪物數量分的,那兩條 pseudo 是它唯一有意義的搜尋條件。
 *
 * 物品文字長這樣(標籤來自 GGPK clientstrings `RitualStone*`):
 *
 *     怪物：                  ← RitualStoneVarieties(`Monsters:\n{0}`),標籤後面沒有值
 *     超然的卡洛斯            ← 具名 = 傳奇怪物,有幾行就是幾隻
 *     焚屍者波莉亞
 *     燃屍者波莉亞
 *     41 其他怪物             ← RitualStoneNumOtherMonsters(`{0} Other Monsters`)
 *     怪物等級: 83            ← RitualStoneLevel
 *     來自: 危城廣場          ← RitualStoneFromArea
 *
 * 不能照 `parseMirroredTablet` 那樣逐行 `tryParseTranslation`:兩個數字都**不是**
 * 「一行一條詞綴」,而且交易站那兩條 pseudo 的措辭是**篩選器的顯示名**,物品文字裡
 * 永遠不會出現。所以要先數,再依 ref 取 stat 合成。
 *
 * 邊界:全是傳奇怪物時**沒有**「N 其他怪物」那一行(於是不送那一條 pseudo,而不是
 * 送 0);沒有任何具名怪物時傳奇數就是 0。兩種都不靠行數判斷,靠「終止行」——
 * 尾巴的三行(其他怪物 / 怪物等級 / 來自)任何一行都可能缺席。
 */
function parseBloodFilledVessel (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Blood-filled Vessel') return 'PARSER_SKIPPED'

  if (parseVesselMonstersNested(section, item)) return 'SECTION_PARSED'
  if (isVesselBonusSection(section)) return 'SECTION_PARSED'

  return 'SECTION_SKIPPED'
}

/**
 * 標籤行比對。
 *
 * `normalizeLabelPunctuation` 會把全形寫法補成 `標籤: `(**帶尾空白**),但
 * 「怪物:」這種標籤後面沒有值的行,在半形客戶端本來就沒有尾空白。實測使用者的樣本
 * 是半形、GGPK 的字串是全形,兩種都要認得,所以兩邊都去尾空白再比。
 */
function isLabelOnlyLine (line: string | undefined, label: string): boolean {
  return line !== undefined && line.trimEnd() === label.trimEnd()
}

function parseVesselMonstersNested (section: string[], item: ParsedItem): boolean {
  const label = _$.RITUAL_MONSTERS
  const otherMonsters = _$.RITUAL_OTHER_MONSTERS
  // 沒有這兩個鍵的語系(ru / ko)直接不處理,行為與加這段之前一模一樣
  if (label === undefined || otherMonsters === undefined) return false
  if (!isLabelOnlyLine(section[0], label)) return false

  const trailingLabels = [_$.RITUAL_MONSTER_LEVEL, _$.RITUAL_FROM]
    .filter((it): it is string => it !== undefined)

  let uniqueMonsters = 0
  for (const line of section.slice(1)) {
    if (otherMonsters.test(line)) break
    if (trailingLabels.some(prefix => line.startsWith(prefix))) break
    uniqueMonsters += 1
  }

  // 「N 其他怪物」刻意**掃整段**而不是只看終止的那一行:它在實測樣本裡排在怪物等級
  // 之前,但那個順序是 GGG 的排版決定的,不是我們能保證的東西。掃整段的話順序調換
  // 也還讀得到;讀不到時是這一行真的不存在(全是傳奇),那就不送這條 pseudo。
  const otherMonstersLine = section.find(line => otherMonsters.test(line))

  pushVesselMonsterCount(item, RITUAL_UNIQUE_MONSTERS, uniqueMonsters)
  if (otherMonstersLine !== undefined) {
    pushVesselMonsterCount(item, RITUAL_OTHER_MONSTERS,
      Number(otherMonsters.exec(otherMonstersLine)![1]))
  }

  return true
}

function pushVesselMonsterCount (item: ParsedItem, ref: string, count: number) {
  const found = pseudoStatByRef(ref)!
  item.newMods.push({
    info: { tags: [], type: ModifierType.Pseudo },
    stats: [{
      stat: found,
      translation: found.matchers[0],
      // 數量是點出來的,不是骰出來的 —— 沒有區間,也不會被神聖石改變
      roll: { value: count, min: count, max: count, dp: false, unscalable: true }
    }]
  })
}

/**
 * 碑器固定帶的那三行加成。
 *
 * ⚠ 它們**不是詞綴**,是 GGPK clientstrings 的**單一條目** `RitualBloodVesselBonuses`
 * (內含兩個 `\n`):每一顆碑器逐字相同、20% 是寫死的,交易站也沒有對應的篩選器。
 * 認領它只是為了不讓這一段變成「沒有任何 parser 認領 → 無聲消失」。
 *
 * 判定用 `some` 不是 `every`,而且**認出來之後整段吃掉、不往 `unknownModifiers` 塞**:
 *   - `some`:三行裡任何一行改了措辭都還認得出這一段是什麼。
 *   - 不塞 unknownModifiers:這是零查詢價值的說明文字,措辭一漂就會讓**每一位**
 *     拿到碑器的使用者看到一條假的「未知詞綴」。同一份文字在實測樣本與 GGPK 之間
 *     就已經有一個字不同(「更多上限怪物」/「更多上級怪物」),把它當成需要回報的
 *     缺陷是誤報。真正需要 §6.2 保護的是上面那段怪物清單,它才會影響送出去的查詢。
 */
function isVesselBonusSection (section: string[]): boolean {
  const bonuses = _$.RITUAL_VESSEL_BONUSES
  if (bonuses === undefined || bonuses.length === 0) return false
  return section.some(line => bonuses.includes(line))
}

function markupConditionParser (text: string) {
  // ignores state set by <<set:__>>
  // always evaluates first condition to true <if:__>{...}
  // full markup: https://gist.github.com/SnosMe/151549b532df8ea08025a76ae2920ca4

  text = text.replace(/<<set:.+?>>/g, '')
  text = text.replace(/<(if:.+?|elif:.+?|else)>{(.+?)}/g, (_, type: string, body: string) => {
    return type.startsWith('if:')
      ? body
      : ''
  })

  return text
}

/**
 * 沒有 `{ … }` 標註的詞綴區塊 —— **上游沒有這段,是本專案新增的**。
 *
 * `parseModifiers` 只認三種標記:`{ 前綴 "…"(階層:N) }` 標註行、` (enchant)`、
 * ` (scourge)`。都沒有的 section 直接 `SECTION_SKIPPED`,而未被任何 parser 認領
 * 的 section 會在 pipeline 結束後**無聲消失**。
 *
 * 實測繁中 corpus 裡兩種形態同時存在:
 *   - 胸甲、法杖、手套的詞綴**有**標註
 *   - 腰帶、藥劑的詞綴**沒有**標註(但一樣帶 `(min-max)` roll 區間)
 *   - 一般 implicit(非異界/亡焰那種)一律沒有標註
 *
 * 於是破裂腰帶整整 7 條詞綴、法杖的 implicit 全部被丟掉,而且
 * `unknownModifiers` 是空的 —— 使用者完全看不出東西掉了。規格 §6.2 明令禁止。
 *
 * 型別判定規則(可由 corpus 回測):
 *   - 已經解析到帶標註的詞綴 → 剩下的 mod-like section 是 implicit
 *     (標註只出現在詞綴上,implicit 不會有)
 *   - 完全沒有帶標註的詞綴 → 有兩段以上時第一段是 implicit,其餘 explicit;
 *     只有一段就全部視為 explicit
 */
function parseUnannotatedModifiers (sections: string[][], item: ParserState): void {
  if (
    item.rarity !== ItemRarity.Normal &&
    item.rarity !== ItemRarity.Magic &&
    item.rarity !== ItemRarity.Rare &&
    item.rarity !== ItemRarity.Unique
  ) return

  const modLike = sections.filter(section => countRecognizedStats(section, item) > 0)
  if (modLike.length === 0) return

  // 只有真的來自 `{ 前綴 "…"(階層:N) }` 的詞綴才算「已標註」——
  // 它們一定帶 name 或 tier。`(enchant)` / `(scourge)` 雖然也被 parseModifiers 認得,
  // 但那不是詞綴標註,把它算進來會讓藥劑的詞綴被誤判成 implicit,
  // 而 `tryParseTranslation` 對 implicit 查不到那些 stat(trade.ids 沒有 implicit 這個鍵),
  // 結果整條掉進 unknownModifiers。
  const hasAnnotatedMods = item.newMods.some(
    mod => mod.info.name !== undefined || mod.info.tier !== undefined)

  modLike.forEach((section, index) => {
    const type = hasAnnotatedMods
      ? ModifierType.Implicit
      : (modLike.length >= 2 && index === 0)
          ? ModifierType.Implicit
          : ModifierType.Explicit

    // 沒有標註時,詞綴之間是用空行分隔的(一條詞綴可能有多行 stat)
    for (const group of splitByBlankLines(section)) {
      parseStatsFromMod(group, item, { info: { type, tags: [] }, stats: [] })
    }

    const at = sections.indexOf(section)
    if (at !== -1) sections.splice(at, 1)
  })
}

/** 這個 section 有幾行能被辨識成已知詞綴?用來區分「詞綴區塊」與敘述文字。 */
function countRecognizedStats (section: string[], item: ParsedItem): number {
  const lines = section.filter(line => line.trim().length > 0)
  if (lines.length === 0) return 0

  let count = 0
  const iterator = linesToStatStrings(lines)
  let current = iterator.next()
  while (!current.done) {
    const parsedStat = tryParseTranslation(current.value, ModifierType.Explicit, item.category)
    if (parsedStat) {
      count += 1
      current = iterator.next(true)
    } else {
      current = iterator.next(false)
    }
  }
  return count
}

function splitByBlankLines (section: string[]): string[][] {
  const groups: string[][] = []
  let group: string[] = []
  for (const line of section) {
    if (line.trim() === '') {
      if (group.length > 0) { groups.push(group); group = [] }
    } else {
      group.push(line)
    }
  }
  if (group.length > 0) groups.push(group)
  return groups
}

function parseStatsFromMod (lines: string[], item: ParsedItem, modifier: ParsedModifier) {
  item.newMods.push(modifier)

  if (modifier.info.type === ModifierType.Veiled) {
    const found = STAT_BY_MATCH_STR(modifier.info.name!)
    if (found) {
      modifier.stats.push({
        stat: found.stat,
        translation: found.matcher
      })
    } else {
      item.unknownModifiers.push({
        text: modifier.info.name!,
        type: modifier.info.type
      })
    }
    return
  }

  const statIterator = linesToStatStrings(lines)
  let stat = statIterator.next()
  while (!stat.done) {
    const parsedStat = tryParseTranslation(stat.value, modifier.info.type, item.category)
    if (parsedStat) {
      modifier.stats.push(parsedStat)
      stat = statIterator.next(true)
    } else {
      stat = statIterator.next(false)
    }
  }

  item.unknownModifiers.push(...stat.value.map(line => ({
    text: line,
    type: modifier.info.type
  })))
}

/**
 * @deprecated
 */
function transformToLegacyModifiers (item: ParsedItem) {
  item.statsByType = sumStatsByModType(item.newMods)
}

function calcBasePercentile (item: ParsedItem) {
  const info = item.uniqueBase?.armour ?? item.info.armour
  if (!info) return

  // Base percentile is the same for all defences.
  // Using `AR/EV -> ES -> WARD` order to improve accuracy
  // of calculation (larger rolls = more precise).
  if (item.armourAR && info.ar) {
    item.basePercentile = calcPropPercentile(item.armourAR, info.ar, QUALITY_STATS.ARMOUR, item)
  } else if (item.armourEV && info.ev) {
    item.basePercentile = calcPropPercentile(item.armourEV, info.ev, QUALITY_STATS.EVASION, item)
  } else if (item.armourES && info.es) {
    item.basePercentile = calcPropPercentile(item.armourES, info.es, QUALITY_STATS.ENERGY_SHIELD, item)
  } else if (item.armourWARD && info.ward) {
    item.basePercentile = calcPropPercentile(item.armourWARD, info.ward, QUALITY_STATS.WARD, item)
  }
}

function calcDisenchantDust (item: ParsedItem) {
  if (!item.info.unique?.disenchantValue) return

  let increaseByFactors = 0

  // +50% per Influence Type
  increaseByFactors += item.influences.length * 50

  // +2% per 1% Item Quality
  if (item.quality) {
    increaseByFactors += item.quality * 2
  }

  // +50% per Corruption Implicit
  if (item.isCorrupted) {
    for (const mod of item.newMods) {
      if (mod.info.generation === 'corrupted') {
        increaseByFactors += 50
      }
    }
  }

  const factorsMulti = (increaseByFactors + 100) / 100
  const term1 = 50 // ilvl 46 and below
  const term2 = 2 * (Math.min(Math.max(item.itemLevel!, 46), 68) - 46) // ilvl 47 to 68
  const term3 = Math.floor(3 * (Math.min(Math.max(item.itemLevel!, 46), 68) - 46) / 11) // ilvl 47 to 68
  const term4 = 25 * (Math.min(Math.max(item.itemLevel!, 68), 84) - 68) // ilvl 69 to 84
  const totalMulti = 5 * (term1 + term2 + term3 + term4) * factorsMulti

  item.dustEquivalent = Math.floor(item.info.unique.disenchantValue * totalMulti)
}
