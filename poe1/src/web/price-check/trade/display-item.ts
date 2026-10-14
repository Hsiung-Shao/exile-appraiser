/**
 * exile-appraiser(2026-10-15):PoE1 查價結果「懸停顯示物品」浮窗的物品資料。
 *
 * 由 Exiled Exchange 2(MIT,Kvan7/Exiled-Exchange-2 `renderer/src/web/price-check/trade/pathofexile-trade.ts`
 * 的 `parseFetchResult` / `parseModBlock` / `getTier`)移植改寫成 PoE1 版:
 * - 稀有度由 PoE1 `frameType` 推(寶石 / 通貨 / 命運卡沒有 `rarity` 欄);
 * - 交易站新格式詞綴是 `{ description, hash, domain, flags, mods }` 物件,破裂 / 工藝詞綴混在 `explicitMods` 裡、
 *   以 `domain` 區分 → 依 domain 分到 `fracturedMods` / `craftedMods`(遊戲內順序:破裂在前、工藝在後);
 *   舊格式字串陣列以 `extended.hashes[type][i]`(同一份回應同一個 i)取 trade stat id 與 tier;
 * - 勢力(`influences`)、破裂 / 追憶 / 分化 / 汙染 / 複製 / 未鑑定 → 底部標籤;
 * - 插槽依 `group` 連線(`B-G B`)。
 *
 * 每一行帶語言無關的 `key`(屬性 / 需求 / 標籤…)與詞綴的 `tradeId`,繁中化(`display-zh.ts`)只靠這兩個欄位對接,
 * 不靠位置對位(CLAUDE.md 規則 2)。不影響查詢組法(golden-query 不變)。
 */

/** 交易站的數值顏色(`properties[].values[i][1]`);8729 起是本模組自訂的詞綴區顏色(照 EE2) */
export enum TradeNumberColors {
  White = 0,
  Augmented = 1,
  Unmet = 2,
  Physical = 3,
  Fire = 4,
  Cold = 5,
  Lightning = 6,
  Chaos = 7,
  Enchant = 8729,
  Fractured = 8730,
  Crafted = 8734,
  Veiled = 8735
}

export type DisplayRarity = 'Normal' | 'Magic' | 'Rare' | 'Unique' | 'Gem' | 'Currency' | 'Divination' | 'Relic'

/** PoE1 `frameType` → 稀有度(浮窗標題樣式) */
const FRAME_RARITY: Record<number, DisplayRarity> = {
  0: 'Normal', 1: 'Magic', 2: 'Rare', 3: 'Unique', 4: 'Gem', 5: 'Currency', 6: 'Divination', 9: 'Relic', 10: 'Relic'
}

export interface DisplayValue { text: string, color: number }

/**
 * - `class`:物品類別行(`Bow`);`tags`:寶石標籤行;`prop`:屬性(`Evasion Rating: ` + 值)
 * - `ilvl`:物品等級;`requires`:需求(值 = `Level 65`、`79 Int`…,繁中化依 `requirements[].type` 重組);`sockets`:插槽
 * - `tag`:底部標籤(`Corrupted`、`Shaper Item`…);沒有 key = 詞綴行
 */
export type DisplayLineKey = 'class' | 'tags' | 'prop' | 'ilvl' | 'requires' | 'sockets' | 'tag'

export interface DisplayLine {
  /** 標籤 / 屬性名(含冒號與結尾空白)或詞綴全文 */
  text: string
  key?: DisplayLineKey
  /** 屬性值(多值以 `, ` 分隔顯示,各自上色) */
  values?: DisplayValue[]
  /** displayMode 3(藥劑等 `Recovers %0 Life over %1 Seconds`):佔位符已代入數值的分段,`value` 為 true 的段套數值顏色;有它時 values 不再另外顯示 */
  segments?: Array<{ text: string, color: number, value?: boolean }>
  color: number
  tier?: string
  /** 詞綴的 trade stat id(`explicit.stat_123`;去掉新格式的 `stat.` 前綴);沒有 = 不翻 */
  tradeId?: string
}

export interface DisplayItem {
  title: string[]
  rarity: DisplayRarity
  frameType?: number
  influences: string[]
  nameBlock?: DisplayLine[]
  itemProps?: DisplayLine[]
  enchantMods?: DisplayLine[]
  implicitMods?: DisplayLine[]
  fracturedMods?: DisplayLine[]
  explicitMods?: DisplayLine[]
  craftedMods?: DisplayLine[]
  veiledMods?: DisplayLine[]
  itemTags?: DisplayLine[]
  icon?: { url: string, w: number, h: number }
}

export interface FetchProperty {
  name: string
  values: Array<[string, number]>
  displayMode?: number
  type?: number
}

export interface FetchModInfo { name?: string, tier?: string, level?: number }

export interface FetchModObject {
  description: string
  hash?: string
  domain?: string
  flags?: Record<string, boolean>
  mods?: FetchModInfo[]
}

export type FetchModList = Array<string | FetchModObject>

/** 交易站 `/api/trade/fetch` 的 `result[].item`(浮窗用到的欄位) */
export interface FetchItem {
  w?: number
  h?: number
  icon?: string
  name?: string
  typeLine?: string
  baseType?: string
  rarity?: string
  frameType?: number
  ilvl?: number
  identified?: boolean
  corrupted?: boolean
  duplicated?: boolean
  split?: boolean
  fractured?: boolean
  synthesised?: boolean
  unmodifiable?: boolean
  influences?: Record<string, boolean>
  searing?: boolean
  tangled?: boolean
  sockets?: Array<{ group: number, sColour?: string, attr?: string }>
  properties?: FetchProperty[]
  requirements?: FetchProperty[]
  enchantMods?: FetchModList
  scourgeMods?: FetchModList
  implicitMods?: FetchModList
  fracturedMods?: FetchModList
  explicitMods?: FetchModList
  craftedMods?: FetchModList
  veiledMods?: FetchModList
  crucibleMods?: FetchModList
  extended?: {
    mods?: Record<string, FetchModInfo[] | undefined>
    hashes?: Record<string, Array<[string, number[] | null] | null> | undefined>
  }
  stackSize?: number
  note?: string
}

/** 浮窗詞綴區(DisplayItem 的 `${type}Mods`) */
export const MOD_SECTIONS = ['enchant', 'implicit', 'fractured', 'explicit', 'crafted', 'veiled'] as const
export type ModSection = (typeof MOD_SECTIONS)[number]

const SECTION_COLOR: Record<ModSection, number> = {
  enchant: TradeNumberColors.Enchant,
  implicit: TradeNumberColors.Augmented,
  fractured: TradeNumberColors.Fractured,
  explicit: TradeNumberColors.Augmented,
  crafted: TradeNumberColors.Crafted,
  veiled: TradeNumberColors.Veiled
}

/** 底部標籤的英文(繁中化以 GGPK clientstrings 的英文對接,`data/poe1/item-classes/item-classes.json`) */
const INFLUENCE_TAG: Record<string, string> = {
  shaper: 'Shaper Item',
  elder: 'Elder Item',
  crusader: 'Crusader Item',
  redeemer: 'Redeemer Item',
  hunter: 'Hunter Item',
  warlord: 'Warlord Item'
}

/** `[Tag|Text]` 顯示標記 → `Text`(PoE1 交易站少見,保險起見與 EE2 同規則) */
export function stripMarkup (text: string): string {
  return text.replace(/\[([^\]|]+)\|?([^\]]*)\]/g, (_, a: string, b: string) => b || a)
}

function normalizeId (raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return raw.startsWith('stat.') ? raw.slice(5) : raw
}

function tierOf (mods: FetchModInfo[] | undefined): string | undefined {
  const tiers = (mods ?? []).map(m => m.tier).filter((t): t is string => !!t)
  return tiers.length ? tiers.join(' + ') : undefined
}

/** 舊格式:`hashes[type][i]` 的 mod 索引 → `extended.mods[type][k].tier`(EE2 `getTier`) */
function legacyTier (index: number, mods?: FetchModInfo[], hashes?: Array<[string, number[] | null] | null>): string | undefined {
  const idx = hashes?.[index]?.[1]
  if (!mods?.length || !idx) return undefined
  return tierOf(idx.map(i => mods[i]).filter(Boolean))
}

/** 新格式物件的 domain → 浮窗區;不認得的 domain 留在原本的區 */
function sectionOfDomain (domain: string | undefined, fallback: ModSection): ModSection {
  if (domain && (MOD_SECTIONS as readonly string[]).includes(domain)) return domain as ModSection
  return fallback
}

function parseMods (item: FetchItem): Partial<Record<ModSection, DisplayLine[]>> {
  const out: Partial<Record<ModSection, DisplayLine[]>> = {}
  const push = (section: ModSection, l: DisplayLine) => { (out[section] ??= []).push(l) }
  // `${key}Mods` 欄 → 預設區(scourge / crucible 跟著 enchant / explicit 顯示)
  const SOURCES: Array<[keyof FetchItem, ModSection, string]> = [
    ['enchantMods', 'enchant', 'enchant'],
    ['scourgeMods', 'enchant', 'scourge'],
    ['implicitMods', 'implicit', 'implicit'],
    ['fracturedMods', 'fractured', 'fractured'],
    ['explicitMods', 'explicit', 'explicit'],
    ['craftedMods', 'crafted', 'crafted'],
    ['veiledMods', 'veiled', 'veiled'],
    ['crucibleMods', 'explicit', 'crucible']
  ]
  for (const [field, defSection, hashKey] of SOURCES) {
    const list = item[field] as FetchModList | undefined
    if (!Array.isArray(list)) continue
    if (list.length === 0) { out[defSection] ??= []; continue }
    const mods = item.extended?.mods?.[hashKey]
    const hashes = item.extended?.hashes?.[hashKey]
    list.forEach((raw, index) => {
      if (typeof raw === 'string') {
        push(defSection, {
          text: stripMarkup(raw),
          color: SECTION_COLOR[defSection],
          tier: legacyTier(index, mods, hashes),
          tradeId: normalizeId(hashes?.[index]?.[0] ?? undefined)
        })
      } else if (raw && typeof raw.description === 'string') {
        const section = sectionOfDomain(raw.domain, defSection)
        push(section, {
          text: stripMarkup(raw.description),
          color: SECTION_COLOR[section],
          tier: tierOf(raw.mods),
          tradeId: normalizeId(raw.hash)
        })
      }
    })
  }
  return out
}

function valuesOf (prop: FetchProperty): DisplayValue[] {
  return (prop.values ?? []).map(([text, color]) => ({ text: stripMarkup(String(text)), color: Number(color) || 0 }))
}

function buildNameBlock (item: FetchItem, rarity: DisplayRarity): DisplayLine[] | undefined {
  const props = item.properties
  if (!props?.length) return undefined
  return props.map((p, i) => {
    const name = stripMarkup(p.name ?? '')
    const values = valuesOf(p)
    if (p.displayMode === 3 && /%\d/.test(name)) {
      // displayMode 3:`%N` 換成 values[N](各自保留數值顏色),不加冒號;對不上的佔位符以空字串代入,不讓 `%N` 留在畫面
      const segments: Array<{ text: string, color: number, value?: boolean }> = []
      let last = 0
      for (const m of name.matchAll(/%(\d+)/g)) {
        if (m.index! > last) segments.push({ text: name.slice(last, m.index), color: TradeNumberColors.White })
        const v = values[Number(m[1])]
        if (v) segments.push({ text: v.text, color: v.color, value: true })
        last = m.index! + m[0].length
      }
      if (last < name.length) segments.push({ text: name.slice(last), color: TradeNumberColors.White })
      return { text: segments.map(x => x.text).join(''), key: 'prop', segments, color: TradeNumberColors.White }
    }
    if (!values.length) {
      // 第一行沒有數值:寶石是標籤行(`Spell, Chaining, Lightning`),其他是物品類別(`Bow`)
      const key: DisplayLineKey = i === 0 ? (rarity === 'Gem' ? 'tags' : 'class') : 'prop'
      return { text: name, key, color: TradeNumberColors.White }
    }
    return { text: `${name}: `, key: 'prop', values, color: TradeNumberColors.White }
  })
}

/** `{group}` 相同 = 連線;`B-G B`(白 = W、深淵 = A、DV = 黑) */
export function socketText (sockets: FetchItem['sockets']): string | undefined {
  if (!sockets?.length) return undefined
  let out = ''
  sockets.forEach((s, i) => {
    if (i > 0) out += sockets[i - 1].group === s.group ? '-' : ' '
    out += s.sColour ?? '?'
  })
  return out
}

function buildItemProps (item: FetchItem): DisplayLine[] | undefined {
  const block: DisplayLine[] = []
  if (item.ilvl) {
    block.push({ text: 'Item Level: ', key: 'ilvl', values: [{ text: String(item.ilvl), color: TradeNumberColors.White }], color: TradeNumberColors.White })
  }
  const reqs = item.requirements
  if (reqs?.length) {
    block.push({
      text: 'Requires ',
      key: 'requires',
      color: TradeNumberColors.White,
      values: reqs.map(r => {
        const v = String(r.values?.[0]?.[0] ?? '')
        const color = Number(r.values?.[0]?.[1]) || 0
        const name = stripMarkup(r.name ?? '')
        return { text: r.type === 62 ? `${name} ${v}` : `${v} ${name}`, color }
      })
    })
  }
  const sockets = socketText(item.sockets)
  if (sockets) block.push({ text: 'Sockets: ', key: 'sockets', values: [{ text: sockets, color: TradeNumberColors.White }], color: TradeNumberColors.White })
  return block.length ? block : undefined
}

function buildTags (item: FetchItem): DisplayLine[] {
  const tag = (text: string, color: number = TradeNumberColors.White): DisplayLine => ({ text, key: 'tag', color })
  const tags: DisplayLine[] = []
  for (const [k, on] of Object.entries(item.influences ?? {})) {
    if (on && INFLUENCE_TAG[k]) tags.push(tag(INFLUENCE_TAG[k]))
  }
  if (item.searing) tags.push(tag('Searing Exarch Item'))
  if (item.tangled) tags.push(tag('Eater of Worlds Item'))
  if (item.fractured) tags.push(tag('Fractured Item', TradeNumberColors.Fractured))
  if (item.synthesised) tags.push(tag('Synthesised Item'))
  if (item.split) tags.push(tag('Split'))
  if (item.identified === false) tags.push(tag('Unidentified', TradeNumberColors.Unmet))
  if (item.duplicated) tags.push(tag('Mirrored', TradeNumberColors.Augmented))
  if (item.unmodifiable) tags.push(tag('Unmodifiable'))
  if (item.corrupted) tags.push(tag('Corrupted', TradeNumberColors.Unmet))
  return tags
}

/** 交易站 fetch 的 `item` → 浮窗資料;資料不全不丟錯(缺的區塊就不顯示)。 */
export function parseFetchItem (item: FetchItem | undefined): DisplayItem | undefined {
  if (!item || typeof item !== 'object') return undefined
  const title: string[] = []
  if (item.name) title.push(stripMarkup(item.name))
  if (item.typeLine) title.push(stripMarkup(item.typeLine))
  const rarity: DisplayRarity = (item.frameType != null ? FRAME_RARITY[item.frameType] : undefined) ??
    ((item.rarity && (Object.values(FRAME_RARITY) as string[]).includes(item.rarity)) ? item.rarity as DisplayRarity : 'Normal')
  const mods = parseMods(item)
  const influences = Object.entries(item.influences ?? {}).filter(([, on]) => on).map(([k]) => k)
  return {
    title,
    rarity,
    frameType: item.frameType,
    influences,
    nameBlock: buildNameBlock(item, rarity),
    itemProps: buildItemProps(item),
    enchantMods: mods.enchant,
    implicitMods: mods.implicit,
    fracturedMods: mods.fractured,
    explicitMods: mods.explicit,
    craftedMods: mods.crafted,
    veiledMods: mods.veiled,
    itemTags: buildTags(item),
    icon: item.icon ? { url: item.icon, w: item.w ?? 1, h: item.h ?? 1 } : undefined
  }
}
