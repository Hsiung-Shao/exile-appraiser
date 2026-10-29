// 查價掛單卡「線上」彈出選單的設定自動記住(2026-10-29 使用者要求;PoE1 / PoE2)。
// - 只在使用者操作的地方寫入(選單的開關 / 單選、大宗卡片「只看在線」):PoE2 查詢函式會把 listingType
//   正規化(securable → online 等),用「監看 filters 就存」會誤存,所以不走監看。
// - 換物品時 CheckedItem 在 createPresets 之後套用;聯盟不記(以標題列為準)。
// - PoE1 的僅限商人 / 通貨沿用既有設定欄位 `merchantOnly` / `defaultCurrency`(設定頁「預設價格通貨」同一個值)。

export type Listed = '1day' | '3days' | '1week' | '2weeks' | '1month' | '2months'
export type Poe1Currency = 'chaos' | 'divine' | 'chaos_divine'
export type Poe2TradeListing = 'available' | 'securable' | 'online' | 'any'
export type Poe2BulkListing = 'onlineleague' | 'online' | 'any'
export type Poe2Currency = 'exalted' | 'chaos' | 'divine' | 'exalted_divine'

/** 沒有的鍵 = 沒記過(走現行預設);`null` = 使用者選了「任何時間 / 任何通貨」 */
export interface OnlineFilterMemory {
  poe1: { offline?: boolean, listed?: Listed | null, currency?: Poe1Currency | null }
  poe2: { tradeListing?: Poe2TradeListing, bulkListing?: Poe2BulkListing, listed?: Listed | null, currency?: Poe2Currency | null }
}

const LISTED: readonly string[] = ['1day', '3days', '1week', '2weeks', '1month', '2months']
const POE1_CURRENCY: readonly string[] = ['chaos', 'divine', 'chaos_divine']
const POE2_TRADE_LISTING: readonly string[] = ['available', 'securable', 'online', 'any']
const POE2_BULK_LISTING: readonly string[] = ['onlineleague', 'online', 'any']
const POE2_CURRENCY: readonly string[] = ['exalted', 'chaos', 'divine', 'exalted_divine']

export function defaultOnlineFilterMemory (): OnlineFilterMemory {
  return { poe1: {}, poe2: {} }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** 合法值(含 null = 任何)原樣保留,其他丟棄 */
const nullableOf = <T extends string>(v: unknown, allowed: readonly string[]): T | null | undefined =>
  v === null ? null : (typeof v === 'string' && allowed.includes(v)) ? v as T : undefined

/** 設定檔讀入:逐欄驗值,壞值丟棄(一代不是物件只清那一代) */
export function normOnlineFilterMemory (v: unknown): OnlineFilterMemory {
  const out = defaultOnlineFilterMemory()
  if (!isObj(v)) return out
  const p1 = isObj(v.poe1) ? v.poe1 : {}
  if (typeof p1.offline === 'boolean') out.poe1.offline = p1.offline
  const l1 = nullableOf<Listed>(p1.listed, LISTED)
  if (l1 !== undefined) out.poe1.listed = l1
  const c1 = nullableOf<Poe1Currency>(p1.currency, POE1_CURRENCY)
  if (c1 !== undefined) out.poe1.currency = c1
  const p2 = isObj(v.poe2) ? v.poe2 : {}
  if (typeof p2.tradeListing === 'string' && POE2_TRADE_LISTING.includes(p2.tradeListing)) out.poe2.tradeListing = p2.tradeListing as Poe2TradeListing
  if (typeof p2.bulkListing === 'string' && POE2_BULK_LISTING.includes(p2.bulkListing)) out.poe2.bulkListing = p2.bulkListing as Poe2BulkListing
  const l2 = nullableOf<Listed>(p2.listed, LISTED)
  if (l2 !== undefined) out.poe2.listed = l2
  const c2 = nullableOf<Poe2Currency>(p2.currency, POE2_CURRENCY)
  if (c2 !== undefined) out.poe2.currency = c2
  return out
}

/**
 * 有記過的欄位才覆寫(null = 任何時間 / 任何通貨)。通貨要另外記在這裡、不能只靠 `defaultCurrency`:
 * 上游對不可工藝的非傳奇物品在通貨為空時強制 `chaos_divine`,`defaultCurrency` 的 null 分不出「沒選過」與「選了任何」(第 2 輪審查)。
 */
export function applyPoe1Memory (trade: { offline: boolean, listed: string | null, currency: string | null }, mem: OnlineFilterMemory): void {
  const m = mem.poe1
  if (m.offline !== undefined) trade.offline = m.offline
  if (m.listed !== undefined) trade.listed = m.listed
  if (m.currency !== undefined) trade.currency = m.currency
}

/** 掛單類型依 api 取一般 / 大宗那一格;上架時間與通貨兩種 api 都套(null → undefined = 任何) */
export function applyPoe2Memory (trade: { listingType: string, listed?: string, currency?: string }, api: 'trade' | 'bulk', mem: OnlineFilterMemory): void {
  const m = mem.poe2
  const listing = api === 'bulk' ? m.bulkListing : m.tradeListing
  if (listing !== undefined) trade.listingType = listing
  if (m.listed !== undefined) trade.listed = m.listed ?? undefined
  if (m.currency !== undefined) trade.currency = m.currency ?? undefined
}

/** 只寫 patch 裡「有出現的鍵」;PoE1 的僅限商人寫進既有欄位 `merchantOnly`,通貨同時寫記憶與 `defaultCurrency`(設定頁同步) */
export interface Poe1Patch { offline?: boolean, listed?: string | null, merchantOnly?: boolean, currency?: string | null }
export function rememberPoe1 (widget: { onlineFilterMemory: OnlineFilterMemory, merchantOnly: boolean, defaultCurrency: string | null }, patch: Poe1Patch): void {
  if ('offline' in patch && typeof patch.offline === 'boolean') widget.onlineFilterMemory.poe1.offline = patch.offline
  if ('listed' in patch) widget.onlineFilterMemory.poe1.listed = (patch.listed ?? null) as Listed | null
  if ('merchantOnly' in patch && typeof patch.merchantOnly === 'boolean') widget.merchantOnly = patch.merchantOnly
  if ('currency' in patch) {
    const currency = (patch.currency ?? null) as Poe1Currency | null
    widget.onlineFilterMemory.poe1.currency = currency
    widget.defaultCurrency = currency
  }
}

/** 設定頁「預設價格通貨」(PoE1)顯示的值:選單記過(含「任何」= null)就是它,沒記過才看 `defaultCurrency` */
export function poe1CurrencySetting (widget: { onlineFilterMemory: OnlineFilterMemory, defaultCurrency: string | null }): string | null {
  const remembered = widget.onlineFilterMemory.poe1.currency
  return remembered !== undefined ? remembered : widget.defaultCurrency
}

/** 只寫 patch 裡「有出現的鍵」(`listed` / `currency` 為 undefined 代表選了「任何」,存成 null) */
export interface Poe2Patch { listingType?: string, listed?: string, currency?: string }
export function rememberPoe2 (widget: { onlineFilterMemory: OnlineFilterMemory }, api: 'trade' | 'bulk', patch: Poe2Patch): void {
  const m = widget.onlineFilterMemory.poe2
  if ('listingType' in patch && patch.listingType !== undefined) {
    if (api === 'bulk') m.bulkListing = patch.listingType as Poe2BulkListing
    else m.tradeListing = patch.listingType as Poe2TradeListing
  }
  if ('listed' in patch) m.listed = (patch.listed ?? null) as Listed | null
  if ('currency' in patch) m.currency = (patch.currency ?? null) as Poe2Currency | null
}
