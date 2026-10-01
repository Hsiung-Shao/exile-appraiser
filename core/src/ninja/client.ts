/**
 * poe.ninja 價格來源(純 TS,不碰 DOM / Vue / Electron;網路一律經注入的 HttpFetch)。
 *
 * 端點與解析規則移植自 PobTools `host/warehouse_ninja.cpp`(同作者;C++ → TS 逐條對照):
 * - item overview:`/{game}/api/economy/stash/current/item/overview?league=&type=`
 *   → `lines[]`,每列 `chaosValue`(PoE1)或 `primaryValue`(PoE2,以 `core.primary` 計價)。
 * - exchange:`/{game}/api/economy/exchange/current/overview?league=&type=`
 *   → `items[]` 給名稱、`lines[]` 給價格,兩者用 `id` 對接(id 有時是數字、有時是 slug 字串)。
 * - `core.rates` 說明 1 單位 primary 可換多少其他單位;沒有 `core` 的 PoE1 舊格式 = 以 chaos 計價。
 * - 欄位可能是 null(PoE2 常見):一律容忍,該列略過而不是整個類別失敗。
 * - 同鍵多列(寶石級距合併、傳奇同名不同變體)以 `count`/`listingCount` 大者勝;exchange 列後寫者勝。
 * - `count` 1–4 = 低信心(`lowConfidence`)。
 * - 每個請求之間等 300ms(社群資源,客氣一點)。
 *
 * ⚠ 2026-09-28 錄製時 PoE1 `type=Catalyst` 回空的(催化劑在 `Currency` 類裡,category "Catalysts"),
 *   所以不列;PoE1 `type=Map` 的列沒有 `mapTier` 欄位,照 C++ 規則全數略過(見 core/test/ninja.test.ts)。
 */
import type { HttpFetch } from '../http/HttpClient'
import { cardKey, currencyKey, gemKey, mapKey, uniqueKey } from './keys'

export type NinjaGame = 'poe1' | 'poe2'

export const NINJA_ORIGIN = 'https://poe.ninja'
/** poe.ninja 圖片路徑(`/gen/image/…`)的主機;item overview 的 `icon` 已是完整網址。 */
const IMAGE_ORIGIN = 'https://web.poecdn.com'

export const NINJA_REQUEST_INTERVAL_MS = 300
/** `count` 小於這個數(且 > 0)= 低信心。 */
export const LOW_CONFIDENCE_MIN_COUNT = 5

export interface NinjaCategories {
  exchange: string[]
  item: string[]
}

/**
 * 要抓的類別(ninja 的請求參數,不是網址 slug)。PoE1 清單同 `warehouse_ninja.cpp` 的 kPoe1Exchange / kPoe1ItemTypes;
 * PoE2 同 kPoe2Exchange / kPoe2ItemTypes(PoE2 名稱是複數,`UniqueRelics` 會 404 所以不列)。
 */
export const NINJA_CATEGORIES: Record<NinjaGame, NinjaCategories> = {
  poe1: {
    exchange: ['Currency', 'Fragment', 'Scarab', 'Oil', 'Essence', 'Fossil', 'Resonator', 'DeliriumOrb',
      'Tattoo', 'Omen', 'Runegraft', 'DivinationCard'],
    item: ['SkillGem', 'Map', 'UniqueMap', 'UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueJewel', 'UniqueFlask']
  },
  poe2: {
    exchange: ['Currency', 'Fragments', 'Abyss', 'UncutGems', 'LineageSupportGems', 'Essences', 'SoulCores',
      'Idols', 'Runes', 'Ritual', 'Expedition', 'Delirium', 'Breach', 'Verisium'],
    item: ['UniqueWeapons', 'UniqueArmours', 'UniqueAccessories', 'UniqueFlasks', 'UniqueCharms', 'UniqueJewels', 'UniqueTablets']
  }
}

/** 一列解析後的價格。 */
export interface NinjaLine {
  key: string
  chaos: number
  /** item overview 的 `count`(沒有就 `listingCount`);exchange 沒有數量 → 0。 */
  count: number
  lowConfidence: boolean
  /** 來源類別(ninja 請求參數,例如 `UniqueArmour`、`Currency`);組 ninja 詳細頁網址用。 */
  type: string
  detailsId?: string
  icon?: string
  sparkline?: Array<number | null>
}

export interface ParsedOverview {
  lines: NinjaLine[]
  /** 回應 `core` 說的 1 divine = 幾 chaos(沒有 core 或無法換算就沒有)。 */
  chaosPerDivine?: number
  /** WP-R2:回應 `core` 說的 1 exalted = 幾 chaos(PoE2 的 core.rates 有 exalted;PoE1 沒有)。 */
  chaosPerExalted?: number
}

type Json = Record<string, unknown>

function isObj (v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function str (o: Json, k: string): string {
  const v = o[k]
  return typeof v === 'string' ? v : ''
}
function num (o: Json, k: string, def: number): number {
  const v = o[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : def
}
function bool (o: Json, k: string): boolean {
  return o[k] === true
}
function sparklineOf (o: Json, k: string): Array<number | null> | undefined {
  const s = o[k]
  if (!isObj(s) || !Array.isArray(s.data)) return undefined
  return s.data.map(v => (typeof v === 'number' ? v : null))
}
function rateOf (rates: Json, unit: string): number {
  const v = rates[unit]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * 回應的計價單位換成 chaos 的倍數(C++ `ChaosFactor`)。0 = 無法換算。
 * primary 是 chaos(或沒有 core):factor 1,divine 匯率 = 1 / rates.divine;
 * primary 是 divine:factor = rates.chaos;其他 primary:只能經 rates.chaos 換算。
 *
 * WP-R2:另算 `chaosPerExalted`(1 exalted = 幾 chaos)。`rates.X` = 1 primary 可換幾個 X,
 * 所以 1 X = factor / rates.X chaos;primary 本身是 exalted 時 = factor。PoE2 2026-09-30 錄製:
 * `primary: "divine"`、`rates: { exalted: 557, chaos: 9.48 }` → 1 ex = 9.48 / 557 ≈ 0.01702 c(見 docs/ninja-poe2.md)。
 * 只有在算得出來時才帶這個欄位(PoE1 的 core 沒有 exalted)。
 */
export function chaosFactor (doc: unknown): { factor: number, chaosPerDivine?: number, chaosPerExalted?: number } {
  if (!isObj(doc) || !isObj(doc.core)) return { factor: 1 }
  const core = doc.core
  const primary = str(core, 'primary')
  const rates = isObj(core.rates) ? core.rates : {}
  const rChaos = rateOf(rates, 'chaos')
  const rDivine = rateOf(rates, 'divine')
  const rExalted = rateOf(rates, 'exalted')
  const withExalted = <T extends { factor: number }>(r: T): T & { chaosPerExalted?: number } => {
    if (!(r.factor > 0)) return r
    if (primary === 'exalted') return { ...r, chaosPerExalted: r.factor }
    return rExalted > 0 ? { ...r, chaosPerExalted: r.factor / rExalted } : r
  }
  if (primary === '' || primary === 'chaos') {
    return withExalted({ factor: 1, chaosPerDivine: rDivine > 0 ? 1 / rDivine : undefined })
  }
  if (primary === 'divine') {
    if (rChaos <= 0) return { factor: 0 }
    return withExalted({ factor: rChaos, chaosPerDivine: rChaos })
  }
  if (rChaos <= 0) return { factor: 0 }
  return withExalted({ factor: rChaos, chaosPerDivine: rDivine > 0 ? rChaos / rDivine : undefined })
}

function lowConfidence (count: number): boolean {
  return count > 0 && count < LOW_CONFIDENCE_MIN_COUNT
}

/** exchange 回應 → 價格列。`DivinationCard` 進 `card|`,其餘進 `currency|`。格式不對就丟錯(該類別略過)。 */
export function parseExchangeOverview (doc: unknown, type: string): ParsedOverview {
  if (!isObj(doc)) throw new Error('exchange 回應不是物件')
  const { factor, chaosPerDivine, chaosPerExalted } = chaosFactor(doc)
  if (factor <= 0) throw new Error('exchange 回應的計價單位無法換算成混沌石')
  if (!Array.isArray(doc.lines)) throw new Error('exchange 回應缺 lines')
  const toKey = type === 'DivinationCard' ? cardKey : currencyKey

  // id 對某些類別是數字、某些是 slug 字串 → 一律轉字串再對接
  const idOf = (o: Json): string => {
    const v = o.id
    if (typeof v === 'string') return v
    if (typeof v === 'number' && Number.isInteger(v)) return String(v)
    return ''
  }
  const byId = new Map<string, Json>()
  if (Array.isArray(doc.items)) {
    for (const it of doc.items) {
      if (!isObj(it)) continue
      const id = idOf(it)
      if (id && str(it, 'name')) byId.set(id, it)
    }
  }
  const lines: NinjaLine[] = []
  for (const l of doc.lines) {
    if (!isObj(l)) continue
    const id = idOf(l)
    const v = num(l, 'primaryValue', 0)
    const item = byId.get(id)
    if (!id || !item || !(v > 0)) continue
    const image = str(item, 'image')
    lines.push({
      key: toKey(str(item, 'name')),
      chaos: v * factor,
      count: 0,
      lowConfidence: false,
      type,
      detailsId: str(item, 'detailsId') || undefined,
      icon: image ? (image.startsWith('/') ? IMAGE_ORIGIN + image : image) : undefined,
      sparkline: sparklineOf(l, 'sparkline')
    })
  }
  return { lines, chaosPerDivine, chaosPerExalted }
}

/** item overview 回應 → 價格列(C++ `ParseItemOverview`)。 */
export function parseItemOverview (doc: unknown, type: string): ParsedOverview {
  if (!isObj(doc)) throw new Error('item overview 回應不是物件')
  const { factor, chaosPerDivine, chaosPerExalted } = chaosFactor(doc)
  if (!Array.isArray(doc.lines)) throw new Error('item overview 回應缺 lines')
  const lines: NinjaLine[] = []
  for (const l of doc.lines) {
    if (!isObj(l)) continue
    const name = str(l, 'name')
    let chaos = num(l, 'chaosValue', 0)
    if (chaos <= 0 && factor > 0) chaos = num(l, 'primaryValue', 0) * factor
    if (!name || !(chaos > 0)) continue
    const count = Math.trunc(num(l, 'count', num(l, 'listingCount', 0)))

    let key: string
    if (type === 'SkillGem') {
      key = gemKey(name, Math.trunc(num(l, 'gemLevel', 1)), Math.trunc(num(l, 'gemQuality', 0)), bool(l, 'corrupted'))
    } else if (type === 'DivinationCard') {
      key = cardKey(name)
    } else if (type === 'Map') {
      const tier = Math.trunc(num(l, 'mapTier', 0))
      if (tier <= 0) continue
      key = mapKey(name, tier)
    } else if (type === 'UniqueMap') {
      key = uniqueKey(name, str(l, 'baseType'), 0)
    } else {
      // PoE1 UniqueWeapon/…、PoE2 UniqueWeapons/…
      key = uniqueKey(name, str(l, 'baseType'), Math.trunc(num(l, 'links', 0)))
    }
    lines.push({
      key,
      chaos,
      count,
      lowConfidence: lowConfidence(count),
      type,
      detailsId: str(l, 'detailsId') || undefined,
      icon: str(l, 'icon') || undefined,
      sparkline: sparklineOf(l, 'sparkLine')
    })
  }
  return { lines, chaosPerDivine, chaosPerExalted }
}

/** 同鍵合併:沒有、或新列的 count 較大才取代(C++ runItems 的規則)。 */
export function mergeByCount (into: Map<string, NinjaLine>, lines: NinjaLine[]): void {
  for (const line of lines) {
    const prev = into.get(line.key)
    if (!prev || line.count > prev.count) into.set(line.key, line)
  }
}

export interface NinjaFetchResult {
  game: NinjaGame
  league: string
  fetchedAt: number
  /** 1 divine = 幾 chaos;取不到為 undefined。 */
  divineRate: number | undefined
  /** WP-R2:1 exalted = 幾 chaos;取不到為 undefined(PoE1 一律 undefined)。 */
  exaltedRate?: number
  prices: Map<string, NinjaLine>
  fetchedTypes: string[]
  failedTypes: Array<{ type: string, error: string }>
}

export interface NinjaClientOptions {
  http: HttpFetch
  game: NinjaGame
  league: string
  /** 請求間隔用;測試傳 no-op。預設 setTimeout。 */
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  now?: () => number
}

export interface FetchAllOptions {
  signal?: AbortSignal
  onProgress?: (done: number, total: number, type: string) => void
}

function abortError (signal: AbortSignal): unknown {
  return signal.reason ?? new Error('aborted')
}

export function ninjaItemOverviewUrl (game: NinjaGame, league: string, type: string): string {
  return `${NINJA_ORIGIN}/${game}/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`
}

export function ninjaExchangeUrl (game: NinjaGame, league: string, type: string): string {
  return `${NINJA_ORIGIN}/${game}/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`
}

export function createNinjaClient (opts: NinjaClientOptions) {
  const { http, game, league } = opts
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const intervalMs = opts.intervalMs ?? NINJA_REQUEST_INTERVAL_MS
  const now = opts.now ?? Date.now

  async function getJson (url: string, signal?: AbortSignal): Promise<unknown> {
    const res = await http(url, signal ? { headers: { Accept: 'application/json' }, signal } : { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return JSON.parse(await res.text())
  }

  async function fetchItemOverview (type: string, signal?: AbortSignal): Promise<ParsedOverview> {
    return parseItemOverview(await getJson(ninjaItemOverviewUrl(game, league, type), signal), type)
  }

  async function fetchExchange (type: string, signal?: AbortSignal): Promise<ParsedOverview> {
    return parseExchangeOverview(await getJson(ninjaExchangeUrl(game, league, type), signal), type)
  }

  /**
   * 依序抓全部類別(先 exchange 再 item overview),每個請求之間等 `intervalMs`。
   * 單一類別失敗只記進 `failedTypes`;全部失敗才丟錯。`signal` 中止 → 丟 `signal.reason`。
   */
  async function fetchAll (categories: NinjaCategories = NINJA_CATEGORIES[game], fetchOpts: FetchAllOptions = {}): Promise<NinjaFetchResult> {
    const { signal, onProgress } = fetchOpts
    const plan: Array<{ kind: 'exchange' | 'item', type: string }> = [
      ...categories.exchange.map(type => ({ kind: 'exchange' as const, type })),
      ...categories.item.map(type => ({ kind: 'item' as const, type }))
    ]
    const prices = new Map<string, NinjaLine>()
    const fetchedTypes: string[] = []
    const failedTypes: Array<{ type: string, error: string }> = []
    let coreDivine: number | undefined
    let coreExalted: number | undefined

    for (let i = 0; i < plan.length; i++) {
      if (signal?.aborted) throw abortError(signal)
      if (i > 0) {
        await sleep(intervalMs)
        if (signal?.aborted) throw abortError(signal)
      }
      const { kind, type } = plan[i]
      try {
        // signal 一併交給 http:中止時進行中的請求也會被取消(經 main 代理 → `http-abort`)
        const parsed = kind === 'exchange' ? await fetchExchange(type, signal) : await fetchItemOverview(type, signal)
        if (signal?.aborted) throw abortError(signal)
        if (kind === 'exchange') {
          for (const line of parsed.lines) prices.set(line.key, line)
          if (coreDivine === undefined && parsed.chaosPerDivine && parsed.chaosPerDivine > 0) coreDivine = parsed.chaosPerDivine
          if (coreExalted === undefined && parsed.chaosPerExalted && parsed.chaosPerExalted > 0) coreExalted = parsed.chaosPerExalted
        } else {
          mergeByCount(prices, parsed.lines)
        }
        fetchedTypes.push(type)
      } catch (e) {
        if (signal?.aborted) throw abortError(signal)
        failedTypes.push({ type, error: e instanceof Error ? e.message : String(e) })
      }
      onProgress?.(i + 1, plan.length, type)
    }

    if (!fetchedTypes.length) {
      throw new Error(`poe.ninja 無法連線或全部類別都失敗(${failedTypes.map(f => `${f.type}: ${f.error}`).join('; ')})`)
    }

    // 所有價格換算的單位就是 chaos:定義上 = 1,PoE1 沒有任何來源會列它
    const chaosOrb = currencyKey('Chaos Orb')
    prices.set(chaosOrb, { key: chaosOrb, chaos: 1, count: 999, lowConfidence: false, type: 'Currency', detailsId: 'chaos-orb' })

    // divine 匯率:以回應 core 說的為準;PoE1 缺 core 時用 Divine Orb 那列,≥ 30c 才採信
    // (PoE2 的 divine 約 11c,所以這條後援只限 PoE1)
    let divineRate = coreDivine
    if (divineRate === undefined && game === 'poe1') {
      const divine = prices.get(currencyKey('Divine Orb'))
      if (divine && divine.chaos >= 30) divineRate = divine.chaos
    }

    // WP-R2:exalted 匯率(PoE2 以崇高石計價用):同樣以 core 為準;PoE2 缺 core.rates.exalted 時用 Exalted Orb 那列。
    // PoE1 不需要(也不提供),一律 undefined。
    let exaltedRate: number | undefined
    if (game === 'poe2') {
      exaltedRate = coreExalted
      if (exaltedRate === undefined) {
        const ex = prices.get(currencyKey('Exalted Orb'))
        if (ex && ex.chaos > 0) exaltedRate = ex.chaos
      }
    }

    return { game, league, fetchedAt: now(), divineRate, exaltedRate, prices, fetchedTypes, failedTypes }
  }

  return { game, league, fetchItemOverview, fetchExchange, fetchAll }
}

export type NinjaClient = ReturnType<typeof createNinjaClient>
