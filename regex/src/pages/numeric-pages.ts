// 演算法頁:地圖 / 換界石的數值條件(kind 'numeric');第 32 步起是宿主詞綴頁頂端的數值區(`sectionOf`)。
// 每條 = clientstrings 標籤(`labels[key]`,暫代檔 data/regex/labels.<game>.json 或 schema 2 資料檔的 `labels`)+ 數值正則。
// 標籤缺鍵 → 該條不出現(不猜譯名)。
import type { RegexGame, RegexLabels, RegexLang } from '../data'
import { isTierNameLine, labelBase, mapTierFragment, rarityFragment, strictPropertyFragment } from './frag'
import type { AlgoEntry, AlgoOption, AlgoPage, AlgoValue, RangeOp } from './types'

interface NumSpec {
  id: string
  key: string
  digits: 1 | 2 | 3
  percent: boolean
  def: AlgoValue
  ops?: RangeOp[]
  lo?: number
  hi?: number
}

const ALL_OPS: RangeOp[] = ['ge', 'le', 'range']

const POE1_MAP: NumSpec[] = [
  { id: 'tier', key: 'ItemDisplayMapTier', digits: 2, percent: false, def: { min: 16 }, lo: 1, hi: 17 },
  { id: 'quantity', key: 'ItemDisplayMapQuantityIncrease', digits: 3, percent: true, def: { min: 80 } },
  { id: 'rarity', key: 'ItemDisplayMapRarityIncrease', digits: 3, percent: true, def: { min: 80 } },
  { id: 'pack', key: 'ItemDisplayMapPackSizeIncrease', digits: 3, percent: true, def: { min: 30 } },
  { id: 'scarabs', key: 'ItemDisplayMapScarabDropBonus', digits: 3, percent: true, def: { min: 50 } },
  { id: 'currency', key: 'ItemDisplayMapCurrencyDropBonus', digits: 3, percent: true, def: { min: 50 } },
  { id: 'maps', key: 'ItemDisplayMapMapDropBonus', digits: 3, percent: true, def: { min: 50 } },
  { id: 'divination', key: 'ItemDisplayMapDivinationCardDropBonus', digits: 3, percent: true, def: { min: 50 } }
]

const POE2_WAYSTONE: NumSpec[] = [
  { id: 'tier', key: 'ItemDisplayMapTier', digits: 2, percent: false, def: { min: 15 }, lo: 1, hi: 16 },
  { id: 'rarity', key: 'ItemDisplayMapItemRarity', digits: 3, percent: true, def: { min: 50 } },
  { id: 'pack', key: 'ItemDisplayMapPack', digits: 3, percent: true, def: { min: 30 } },
  { id: 'monster_rarity', key: 'ItemDisplayMapMonsterRarity', digits: 3, percent: true, def: { min: 30 } },
  { id: 'waystone_drop', key: 'ItemDisplayMapWaystoneDropChance', digits: 3, percent: true, def: { min: 100 } },
  { id: 'magic_monsters', key: 'ItemDisplayMapMagicMonsterQuantityBonus', digits: 3, percent: true, def: { min: 30 } },
  { id: 'rare_monsters', key: 'ItemDisplayMapRareMonsterQuantityBonus', digits: 3, percent: true, def: { min: 30 } },
  { id: 'experience', key: 'ItemDisplayMapExperienceGained', digits: 3, percent: true, def: { min: 20 } },
  { id: 'effectiveness', key: 'ItemDisplayMapMonsterEffectiveness', digits: 3, percent: true, def: { min: 20 } }
]

/**
 * 稀有度列(第 35 步):標籤 `ItemDisplayStringRarity`、選項 `ItemDisplayString{Normal,Magic,Rare,Unique}`(兩遊戲同鍵;
 * 普通的繁中 PoE1 =「普通」、PoE2 =「中」,與各自剪貼簿解析器的 RARITY_NORMAL 相同)。缺鍵的選項不出現,標籤或選項全缺 → 整列不出現。
 * 放在數值區最後(不插隊,既有列的位置不變)。
 */
const RARITY_LABEL_KEY = 'ItemDisplayStringRarity'
const RARITY_OPTIONS: Array<{ id: string, key: string }> = [
  { id: 'normal', key: 'ItemDisplayStringNormal' },
  { id: 'magic', key: 'ItemDisplayStringMagic' },
  { id: 'rare', key: 'ItemDisplayStringRare' },
  { id: 'unique', key: 'ItemDisplayStringUnique' }
]
const RARITY_KEYS = [RARITY_LABEL_KEY, ...RARITY_OPTIONS.map(o => o.key)]

/** 本檔用到的 clientstrings 鍵(測試檢查它們都在 labels 暫代檔裡) */
export const NUMERIC_LABEL_KEYS: Record<RegexGame, string[]> = {
  poe1: [...POE1_MAP.map(s => s.key), ...RARITY_KEYS],
  poe2: [...POE2_WAYSTONE.map(s => s.key), ...RARITY_KEYS]
}

export function labelOf (labels: RegexLabels, key: string, lang: RegexLang): string | undefined {
  return (lang === 'zh' ? labels.zh : labels.en)[key]
}

function numEntry (s: NumSpec, labels: RegexLabels): AlgoEntry | null {
  const zh = labels.zh[s.key]
  const en = labels.en[s.key]
  if (!zh || !en) return null
  return {
    id: s.id,
    g: 0,
    t17: false,
    affixZh: '',
    zh: [labelBase(zh)],
    en: [labelBase(en)],
    hiddenZh: [],
    hiddenEn: [],
    input: {
      kind: 'range', digits: s.digits, percent: s.percent, ops: s.ops ?? ALL_OPS,
      lo: s.lo ?? 0, hi: s.hi ?? (s.digits === 3 ? 999 : 99), def: s.def
    },
    // 階級在物品名稱「（階級 N）」,不在屬性行(見 frag.ts mapTierFragment);其餘是「標籤: +N%」屬性行
    fragment: s.id === 'tier'
      ? (v, lang) => mapTierFragment(v, s.digits, lang)
      : (v, lang) => strictPropertyFragment(lang === 'zh' ? zh : en, v, s.digits, s.percent),
    ...(s.id === 'tier' ? { ownLine: isTierNameLine } : {})
  }
}

export const RARITY_ENTRY_ID = 'item_rarity_class'

function rarityEntry (labels: RegexLabels): AlgoEntry | null {
  const zh = labels.zh[RARITY_LABEL_KEY]
  const en = labels.en[RARITY_LABEL_KEY]
  if (!zh || !en) return null
  const opts: AlgoOption[] = []
  for (const o of RARITY_OPTIONS) {
    const oz = labels.zh[o.key]
    const oe = labels.en[o.key]
    if (oz && oe) opts.push({ id: o.id, zh: oz, en: oe })
  }
  if (!opts.length) return null
  return {
    id: RARITY_ENTRY_ID,
    g: 0,
    t17: false,
    affixZh: '',
    zh: [labelBase(zh)],
    en: [labelBase(en)],
    hiddenZh: [],
    hiddenEn: [],
    input: { kind: 'select', options: opts, def: { choice: opts.some(o => o.id === 'rare') ? 'rare' : opts[0].id } },
    fragment: (v, lang) => {
      const o = opts.find(x => x.id === v.choice)
      return o ? rarityFragment(lang === 'zh' ? zh : en, lang === 'zh' ? o.zh : o.en) : null
    }
  }
}

export function numericPages (game: RegexGame, labels: RegexLabels | null): AlgoPage[] {
  if (!labels) return []
  const specs = game === 'poe1' ? POE1_MAP : POE2_WAYSTONE
  const entries = [...specs.map(s => numEntry(s, labels)), rarityEntry(labels)].filter((e): e is AlgoEntry => e !== null)
  if (!entries.length) return []
  const poe1 = game === 'poe1'
  return [{
    game,
    id: poe1 ? 'map_numeric' : 'waystone_numeric',
    kind: 'numeric',
    // 第 32 步起嵌在詞綴頁頂端(不是獨立頁);id 只在內部使用(合併的 perPage、golden 雜湊)
    sectionOf: poe1 ? 'map_mods' : 'waystone_mods',
    title: poe1 ? '地圖數值條件' : '換界石數值條件',
    titleEn: poe1 ? 'Map values' : 'Waystone values',
    note: poe1
      ? '地圖屬性行(階級、物品數量、稀有度…)的數值條件,每條各自一個 term(同時成立)。標籤取自 GGPK clientstrings;寫法依社群實用格式「標籤: +N%」(半形 / 全形冒號、+ 可有可無),階級比對名稱「（階級 N）」。'
      : '換界石屬性行(階級、稀有度、怪群大小…)的數值條件,每條各自一個 term(同時成立)。標籤取自 GGPK clientstrings;寫法依社群實用格式「標籤: +N%」(半形 / 全形冒號、+ 可有可無),階級比對名稱「（階級 N）」。',
    limit: 250,
    groups: ['數值'],
    groupsEn: ['Values'],
    entries,
    ambientZh: [],
    ambientEn: [],
    namePrefixZh: [],
    nameSuffixZh: [],
    namePrefixEn: [],
    nameSuffixEn: []
  }]
}
