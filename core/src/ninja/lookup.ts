/**
 * 查價端的純函式:APT 風格的查詢(`{ ns, name, variant }`,ns = 資料檔 namespace)→ 快照裡的鍵;
 * ninja 詳細頁網址(聯盟 slug 與 detailsId 規則照 APT `renderer/src/web/background/Prices.ts`)。
 */
import type { NinjaGame } from './client'
import type { NinjaSnapshot, NinjaSnapshotEntry } from './cache'
import { cardKey, currencyKey, gemKey, mapKey, uniqueKey } from './keys'

export interface NinjaQuery {
  /** 資料檔 namespace:`ITEM` / `UNIQUE` / `GEM` / `DIVINATION_CARD` / …(APT `getDetailsId` 的 ns) */
  ns: string
  /** 英文名(refName) */
  name: string
  /** APT `getDetailsId` 的 variant:寶石 `20/20c`、傳奇 `<變體>, <基底>, 6L`、地圖 `T16, Gen-24`… */
  variant?: string
  /** 傳奇基底英文名(有就優先用,不從 variant 猜) */
  baseType?: string
  /** 連結數(≥ 6 取 6L 價) */
  links?: number
}

export interface NinjaLookupHit {
  key: string
  entry: NinjaSnapshotEntry
}

function variantParts (variant: string | undefined): string[] {
  return (variant ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

function linksOf (query: NinjaQuery): number {
  if (query.links != null) return query.links
  const m = variantParts(query.variant).map(p => /^(\d)L$/.exec(p)).find(Boolean)
  return m ? Number(m[1]) : 0
}

/** 查詢 → 快照鍵的候選(依序嘗試)。不支援的 ns 回空陣列。 */
export function candidateKeys (query: NinjaQuery, prices: Record<string, unknown>): string[] {
  const { ns, name } = query
  switch (ns) {
    case 'DIVINATION_CARD':
      return [cardKey(name)]
    case 'GEM': {
      const m = /^(\d+)(?:\/(\d+))?(c)?$/.exec((query.variant ?? '').trim())
      if (!m) return [gemKey(name, 1, 0, false)]
      return [gemKey(name, Number(m[1]), m[2] ? Number(m[2]) : 0, Boolean(m[3]))]
    }
    case 'ITEM': {
      const tier = variantParts(query.variant).map(p => /^T(\d+)$/.exec(p)).find(Boolean)
      if (tier && Number(tier[1]) > 0) return [mapKey(name, Number(tier[1]))]
      return [currencyKey(name)]
    }
    case 'UNIQUE': {
      const links = linksOf(query)
      const bases = query.baseType
        ? [query.baseType]
        : variantParts(query.variant).filter(p => !/^\dL$/.test(p))
      const keys = bases.map(b => uniqueKey(name, b, links))
      if (!query.baseType) {
        // 沒有基底:取同名第一筆(6L 只在查詢本身是 6L 時才算)
        const prefix = `unique|${name}|`
        const first = Object.keys(prices).find(k => k.startsWith(prefix) && (k.endsWith('|6L') === (links >= 6)))
        if (first) keys.push(first)
      }
      return keys
    }
    default:
      return []
  }
}

export function lookupPrice (snapshot: Pick<NinjaSnapshot, 'prices'> | null | undefined, query: NinjaQuery): NinjaLookupHit | null {
  if (!snapshot) return null
  for (const key of candidateKeys(query, snapshot.prices)) {
    const entry = snapshot.prices[key]
    if (entry) return { key, entry }
  }
  return null
}

/** ninja 類別(請求參數)→ 網頁網址的類別 slug(APT `NAMESPACE_MAP` 的 url 欄)。 */
const CATEGORY_SLUG: Record<string, string> = {
  Currency: 'currency',
  Fragment: 'fragments',
  DeliriumOrb: 'delirium-orbs',
  Scarab: 'scarabs',
  Fossil: 'fossils',
  Resonator: 'resonators',
  Oil: 'oils',
  Essence: 'essences',
  Map: 'maps',
  Tattoo: 'tattoos',
  Omen: 'omens',
  Runegraft: 'runegrafts',
  DivinationCard: 'divination-cards',
  UniqueJewel: 'unique-jewels',
  UniqueFlask: 'unique-flasks',
  UniqueWeapon: 'unique-weapons',
  UniqueArmour: 'unique-armours',
  UniqueAccessory: 'unique-accessories',
  UniqueMap: 'unique-maps',
  SkillGem: 'skill-gems'
}

/** 沒列在表上的(PoE2 類別)照 CamelCase → kebab-case;⚠ PoE2 網頁 slug 未逐一核對。 */
export function ninjaCategorySlug (type: string): string {
  return CATEGORY_SLUG[type] ?? type.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** APT `selectedLeagueToUrl`:Standard → standard、Hardcore → hardcore、`Hardcore X` → `xhc`、其餘小寫。 */
export function ninjaLeagueSlug (league: string): string {
  switch (league) {
    case 'Standard': return 'standard'
    case 'Hardcore': return 'hardcore'
    default: {
      let slug = league.replace('Hardcore ', '').toLowerCase()
      if (league.startsWith('Hardcore ')) slug += 'hc'
      return slug
    }
  }
}

/** APT `denseInfoToDetailsId`(快照沒有 detailsId 時的後援)。 */
export function denseInfoToDetailsId (info: { name: string, variant?: string }): string {
  return ((info.variant) ? `${info.name}, ${info.variant}` : info.name)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9:\- ]/g, '')
    .toLowerCase()
    .replace(/ /g, '-')
}

export function ninjaDetailsUrl (game: NinjaGame, league: string, hit: NinjaLookupHit, query: Pick<NinjaQuery, 'name' | 'variant'>): string {
  const detailsId = hit.entry.id ?? denseInfoToDetailsId(query)
  return `https://poe.ninja/${game}/economy/${ninjaLeagueSlug(league)}/${ninjaCategorySlug(hit.entry.t)}/${detailsId}`
}
