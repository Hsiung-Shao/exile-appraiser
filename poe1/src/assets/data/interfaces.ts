import type { ItemCategory } from '@/parser'

export interface StatMatcher {
  string: string
  advanced?: string
  negate?: true
  value?: number
}

export enum StatBetter {
  NegativeRoll = -1,
  PositiveRoll = 1,
  NotComparable = 0
}

export interface Stat {
  ref: string
  dp?: true
  matchers: StatMatcher[]
  better: StatBetter
  modFamily?: string[]
  fromAreaMods?: 'yes' | 'ubermap_exclusive' | 'heist_exclusive'
  anointments?: Array<{ roll: number, oils: string }>
  mercenary?: { icon?: string, supports?: string[], tier?: number, canonical?: string, syntheticFamily?: true }
  jewelleryQuality?: { catalyst: string }
  trade: {
    inverted?: true
    option?: true
    ids: {
      [type: string]: string[]
    }
  }
}

export interface StatGroup {
  resolve: StatGroupResolver
  stats: Stat[]
}

export type StatOrGroup = Stat | StatGroup

export type StatGroupResolver =
  {
    strat: 'select'
    test: Array<string | null>
  } | {
    strat: 'trivial-merge'
  } | {
    strat: 'percent-merge'
    kind: Array<'percent' | 'value'>
  } | {
    strat: 'flag-merge'
    kind: Array<'flag' | 'value'>
  }

export interface DropEntry {
  query: string[]
  items: string[]
}

export interface BaseType {
  name: string
  refName: string
  namespace:
    | 'DIVINATION_CARD'
    | 'CAPTURED_BEAST'
    | 'UNIQUE'
    | 'ITEM'
    | 'GEM'
    | 'AREA'
    | 'MERCENARY_BUILD'
  icon: string
  w?: number
  h?: number
  tradeTag?: string
  exchangeable?: true
  tradeDisc?: string
  // 本 fork 新增:交易站的內部 type id,例如傭兵流派的 `MiscScionWandAttacks`。
  //
  // 大多數物品用顯示名就搜得到,因為交易 API 的 `type` 欄放的就是顯示名。傭兵契約書是
  // 例外 —— 它的流派變體是各自獨立的可搜尋 type,`type` 欄是語言無關的內部 id、顯示名在
  // `text`:
  //   {"type":"MiscScionWandAttacks","text":"傭兵契約書 (動能師)","disc":"mercenary_warrant"}
  // 對這種條目送顯示名永遠搜不到。由 `scripts/gen-disc-variants.mjs` 產生、
  // `createFilters`(create-item-filters.ts)送出。
  // (海圖區域自上游 3.29.103 起改走 `AREA` namespace 的 `tradeDisc`,不再用這個欄位。)
  tradeType?: string
  disc?: {
    propAR?: true
    propEV?: true
    propES?: true
    hasImplicit?: { ref: Stat['ref'] }
    hasExplicit?: { ref: Stat['ref'] }
    sectionText?: string
    mapTier?: 'W' | 'Y' | 'R'
  }
  // extra info
  craftable?: {
    category: ItemCategory
    corrupted?: true
    uniqueOnly?: true
  }
  unique?: {
    base: BaseType['refName']
    fixedStats?: Array<Stat['ref']>
    disenchantValue?: number
  }
  area?: {
    screenshot?: string
    special?: true
    blighted?: true
  }
  gem?: {
    vaal?: true
    transfigured?: true
    normalVariant?: BaseType['refName']
    maxLevel: number
  }
  armour?: {
    ar?: [min: number, max: number]
    ev?: [min: number, max: number]
    es?: [min: number, max: number]
    ward?: [min: number, max: number]
  }
  mercenaryBuild?: BaseType['refName'] | MercenaryBuild
}

export interface MercenaryBuild {
  skills: Array<{
    type: 'primary' | 'secondary' | 'utility'
    name: string
  }>
}

export interface TranslationDict {
  RARITY_NORMAL: string
  RARITY_MAGIC: string
  RARITY_RARE: string
  RARITY_UNIQUE: string
  RARITY_GEM: string
  RARITY_CURRENCY: string
  RARITY_DIVCARD: string
  RARITY_QUEST: string
  MAP_TIER: RegExp
  MAP_ITEM_QUANTITY: string
  MAP_ITEM_RARITY: string
  MAP_MONSTER_PACK_SIZE: string
  MAP_MORE_MAPS: string
  MAP_MORE_SCARABS: string
  MAP_MORE_CURRENCY: string
  MAP_MORE_DIVINATION_CARDS: string
  MAP_COMPLETION_REWARD: RegExp
  RARITY: string
  ITEM_CLASS: string
  ITEM_LEVEL: string
  CORPSE_LEVEL: string
  TALISMAN_TIER: string
  GEM_LEVEL: string
  STACK_SIZE: string
  SOCKETS: string
  QUALITY: string
  MEMORY_STRANDS: string
  PHYSICAL_DAMAGE: string
  ELEMENTAL_DAMAGE: string
  CRIT_CHANCE: string
  ATTACK_SPEED: string
  ARMOUR: string
  EVASION: string
  ENERGY_SHIELD: string
  TAG_WARD: string
  BLOCK_CHANCE: string
  CORRUPTED: string
  UNIDENTIFIED: string
  ITEM_SUPERIOR: RegExp
  MAP_BLIGHTED: RegExp
  MAP_BLIGHT_RAVAGED: RegExp
  INFLUENCE_SHAPER: string
  INFLUENCE_ELDER: string
  INFLUENCE_CRUSADER: string
  INFLUENCE_HUNTER: string
  INFLUENCE_REDEEMER: string
  INFLUENCE_WARLORD: string
  SECTION_SYNTHESISED: string
  ITEM_SYNTHESISED: RegExp
  VEILED_PREFIX: string
  VEILED_SUFFIX: string
  FLASK_CHARGES: RegExp
  METAMORPH_HELP: string
  BEAST_HELP: string
  VOIDSTONE_HELP: string
  METAMORPH_BRAIN: RegExp
  METAMORPH_EYE: RegExp
  METAMORPH_LUNG: RegExp
  METAMORPH_HEART: RegExp
  METAMORPH_LIVER: RegExp
  CANNOT_USE_ITEM: string
  QUALITY_ANOMALOUS: RegExp
  QUALITY_DIVERGENT: RegExp
  QUALITY_PHANTASMAL: RegExp
  AREA_LEVEL: string
  /**
   * 同一個英文標籤 `Area Level: ` 的第二種在地化寫法。
   *
   * 繁中客戶端對這個欄位用了**兩個不同的詞**:Heist / Expedition 系用
   * 「地區等級: 」,海圖與聖域研究用「區域等級: 」。上游只收了前者,
   * 於是後兩類物品的 areaLevel 永遠讀不到。
   *
   * 沒有第二種寫法的語系不必提供。
   */
  AREA_LEVEL_ALT?: string
  HEIST_WINGS_REVEALED: string
  HEIST_BLUEPRINT_TARGET: string
  HEIST_BLUEPRINT_ENCHANTS: string
  HEIST_BLUEPRINT_TRINKETS: string
  HEIST_BLUEPRINT_GEMS: string
  HEIST_BLUEPRINT_REPLICAS: string
  HEIST_CONTRACT_JOB: RegExp
  HEIST_JOB_LOCKPICKING: string
  HEIST_JOB_BRUTEFORCE: string
  HEIST_JOB_PERCEPTION: string
  HEIST_JOB_DEMOLITION: string
  HEIST_JOB_COUNTERTHAUMATURGY: string
  HEIST_JOB_TRAPDISARMAMENT: string
  HEIST_JOB_AGILITY: string
  HEIST_JOB_DECEPTION: string
  HEIST_JOB_ENGINEERING: string
  HEIST_CONTRACT_TARGET: RegExp
  HEIST_TARGET_PRICELESS: string
  MIRRORED: string
  SPLIT: string
  MODIFIER_LINE: RegExp
  PREFIX_MODIFIER: string
  SUFFIX_MODIFIER: string
  CRAFTED_PREFIX: string
  CRAFTED_SUFFIX: string
  IMPLICIT_MODIFIER: string
  FRACTURED_PREFIX: string
  FRACTURED_SUFFIX: string
  UNSCALABLE_VALUE: string
  CORRUPTED_IMPLICIT: string
  MODIFIER_INCREASED: RegExp
  INCURSION_OPEN: string
  INCURSION_OBSTRUCTED: string
  EATER_IMPLICIT: RegExp
  EXARCH_IMPLICIT: RegExp
  ITEM_EATER: string
  ITEM_EXARCH: string
  ELDRITCH_MOD_R1: string
  ELDRITCH_MOD_R2: string
  ELDRITCH_MOD_R3: string
  ELDRITCH_MOD_R4: string
  ELDRITCH_MOD_R5: string
  ELDRITCH_MOD_R6: string
  SENTINEL_CHARGE: string
  SHAPER_MODS: string[]
  ELDER_MODS: string[]
  CRUSADER_MODS: string[]
  HUNTER_MODS: string[]
  REDEEMER_MODS: string[]
  WARLORD_MODS: string[]
  DELVE_MODS: string[]
  VEILED_MODS: string[]
  INCURSION_MODS: string[]
  ESSENCE_MODS: string[]
  INFAMOUS_MODS: string[]
  FOIL_UNIQUE: string
  UNMODIFIABLE: string
  FOULBORN_NAME: RegExp
  FOULBORN_MODIFIER: string
  /**
   * 3.29 軍團機制「殘存」(Vestigial):籠罩晶石作用於傳奇護甲後,底材名前面多一個
   * 裝飾詞,物品上並多一條「殘存固定詞綴」。兩者都取自 GGPK clientstrings,ident
   * 分別是 `DivergentItem`(`Vestigial {0}` / `殘存 {0}`)與
   * `ModDescriptionLineDivergentImplicit`(`Vestigial Implicit Modifier` / `殘存固定詞綴`)。
   *
   * **選填**:只有 `en` 與 `cmn-Hant` 填得出來。`ru` / `ko` 沒有可信譯名,依專案鐵則
   * 不憑空填 —— 那兩個語系維持現狀(殘存物品解析不出來,與加這兩個鍵之前一模一樣)。
   */
  VESTIGIAL_NAME?: RegExp
  VESTIGIAL_IMPLICIT?: string
  /**
   * 最後通牒雕刻(`Inscribed Ultimatum`)名牌下方那三行。
   *
   * 標籤取自 GGPK `clientstrings`,ident 依序是 `UltimatumItemisedTrialEncounter`、
   * `UltimatumItemisedTrialItemRequirement`、`UltimatumItemisedTrialReward`。
   * 區域等級沿用 `AREA_LEVEL` / `AREA_LEVEL_ALT`,不另立鍵。
   *
   * **選填**,理由同 `VESTIGIAL_NAME`:GGPK 只有英文與繁中,`ru` / `ko` 沒有可信
   * 譯名就不憑空填,那兩個語系維持現狀(雕刻的四行讀不到,與加這些鍵之前一樣)。
   */
  ULTIMATUM_CHALLENGE?: string
  ULTIMATUM_SACRIFICE?: RegExp
  /**
   * 「需求獻祭」帶數量時的尾綴(`寶石匠的稜鏡 x10`)。第 1 組是物品名、第 2 組是數量。
   * 交易站的 `ultimatum_input` 只吃物品名,所以要先把數量剝掉才查得到。
   */
  ULTIMATUM_SACRIFICE_QUANTITY?: RegExp
  ULTIMATUM_REWARD?: RegExp
  /**
   * 挑戰類型 = GGPK `ultimatumencountertypes.Name`,鍵名後半就是該列的 ident,
   * 而 **ident 本身即交易站的 option id**。
   *
   * ⚠ 這些是**物品上顯示的文字**,與交易站選項的文字不同(遊戲寫「存活」、
   * 交易站寫「倖存」),所以跨層對接只能走 ident,不能拿文字互比。
   */
  ULTIMATUM_CHALLENGE_EXTERMINATE?: string
  ULTIMATUM_CHALLENGE_SURVIVAL?: string
  ULTIMATUM_CHALLENGE_DEFENSE?: string
  ULTIMATUM_CHALLENGE_CONQUER?: string
  /**
   * 獎勵類型 = GGPK `ultimatumitemisedrewards.RewardText`。
   * 只有這三種是靜態文字;第四種 `ExchangeUnique` 顯示的是動態的傳奇物品名,
   * 因此只在這三種都不匹配時才回推成它。
   */
  ULTIMATUM_REWARD_DOUBLE_CURRENCY?: string
  ULTIMATUM_REWARD_DOUBLE_DIVCARDS?: string
  ULTIMATUM_REWARD_MIRROR_RARE?: string
  /**
   * 浸血碑器(`Blood-filled Vessel`)名牌下方那一段的四個標籤。全部取自 GGPK
   * `clientstrings`,ident 依序是 `RitualStoneVarieties`(`Monsters:\n{0}`)、
   * `RitualStoneNumOtherMonsters`(`{0} Other Monsters`)、`RitualStoneLevel`
   * (`Monster Level`)、`RitualStoneFromArea`(`From`)。
   *
   * ⚠ 前三個 ident 在 GGPK 裡**不帶冒號**(冒號是客戶端排版時加的),這裡照本專案的
   * 標籤慣例補成 `…: `,`normalizeLabelPunctuation` 才會把全形寫法(`怪物：`)一併
   * 認得。`RITUAL_MONSTERS` 那一行**標籤後面沒有值**,所以比對時兩邊都要去尾空白。
   *
   * **選填**,理由同 `VESTIGIAL_NAME`:GGPK 只有英文與繁中,`ru` / `ko` 沒有可信
   * 譯名就不憑空填,那兩個語系維持現狀(碑器上的怪物數讀不到,與加這些鍵之前一樣)。
   */
  RITUAL_MONSTERS?: string
  RITUAL_OTHER_MONSTERS?: RegExp
  RITUAL_MONSTER_LEVEL?: string
  RITUAL_FROM?: string
  /**
   * 浸血碑器固定帶的三行加成。
   *
   * ⚠ 這**不是詞綴**。它是 GGPK `clientstrings` 的**單一條目**
   * `RitualBloodVesselBonuses`(內含兩個 `\n`),每一顆碑器逐字相同、數值寫死 20%,
   * 交易站也沒有對應的篩選器。收在這裡只為了讓 parser 認得出「這一段是已知的說明
   * 文字」,而不是把它當成解析不出來的詞綴丟給使用者。
   */
  RITUAL_VESSEL_BONUSES?: string[]
  MAP_AREA: string
  CHART_SULPHUR: string
  MERCENARY_LEVEL: string
  MERCENARY_BUILD: string
  // ---
  CHAT_SYSTEM: RegExp
  CHAT_TRADE: RegExp
  CHAT_GLOBAL: RegExp
  CHAT_PARTY: RegExp
  CHAT_GUILD: RegExp
  CHAT_WHISPER_TO: RegExp
  CHAT_WHISPER_FROM: RegExp
  CHAT_WEBTRADE_GEM: RegExp
}
