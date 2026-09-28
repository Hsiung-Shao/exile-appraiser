/**
 * Realm(伺服器區)模型。
 *
 * 台服是**獨立經濟、獨立 API**(不像日服可以共用 www),所以查價必須分區:
 * - `intl`:國際服,`www.pathofexile.com`,查詢送英文名(`refName`)。
 * - `tw`:台服,`pathofexile.tw`(⚠ 裸 host;`www.pathofexile.tw` 會 301),查詢送繁中名。
 *
 * 詞綴一律送語言無關的 trade stat id,兩區 id 對接 98%+(見 Obsidian「PoE 官方 Trade Data API」)。
 * `items` 端點沒有 id,兩區筆數不同步,**禁止位置對位** —— 名稱只能靠 `refName` / `tradeType`。
 */
export type Game = 'poe1' | 'poe2'
export type Realm = 'intl' | 'tw'
/** 客戶端語言 = 剪貼簿文字的語言 = 要載入的資料集語言。 */
export type Language = 'cmn-Hant' | 'en'

export interface RealmConfig {
  id: Realm
  /** API 與網頁共用同一個 host。 */
  host: string
  /** 送給交易站的物品名稱語言。 */
  queryLang: Language
  /** 給人看的名稱(設定頁用;不進 i18n 是因為它是專有名詞)。 */
  label: string
}

export const REALMS: Record<Realm, RealmConfig> = {
  intl: { id: 'intl', host: 'www.pathofexile.com', queryLang: 'en', label: 'International' },
  tw: { id: 'tw', host: 'pathofexile.tw', queryLang: 'cmn-Hant', label: '台服 (Garena)' }
}

export const REALM_IDS = Object.keys(REALMS) as Realm[]

/**
 * 是否要把物品名稱轉成英文送出。
 * = Awakened PoE Trade 的 `useIntlSite` 語意,改由 realm 推導而不是獨立開關:
 * 繁中客戶端 + 國際服 → true(送 `refName`);繁中客戶端 + 台服 → false(送 `name`);
 * 英文客戶端 + 國際服 → false(`name` 本身就是英文)。
 */
export function useEnglishNames (realm: Realm, clientLanguage: Language): boolean {
  return REALMS[realm].queryLang === 'en' && clientLanguage !== 'en'
}

/**
 * 不支援的組合:英文客戶端查台服(台服站是否接受英文名未驗證;M3 待驗後再開)。
 */
export function isSupportedCombination (realm: Realm, clientLanguage: Language): boolean {
  return !(realm === 'tw' && clientLanguage === 'en')
}

export function apiBase (realm: Realm): string {
  return `https://${REALMS[realm].host}`
}

/**
 * 兩個遊戲共用同一個 host(兩區都是),只差路徑:
 * - PoE1:API `/api/trade/…`、網頁 `/trade/search/{league}`
 * - PoE2:API `/api/trade2/…`、網頁 `/trade2/search/poe2/{league}`(多一段 `poe2`)
 * 聯盟清單:PoE1 `/api/leagues?type=main&realm=pc`;PoE2 `/api/trade2/data/leagues`(見 leagues.ts)。
 */
export const TRADE_PATHS: Record<Game, { api: string, web: string }> = {
  poe1: { api: '/api/trade', web: '/trade' },
  poe2: { api: '/api/trade2', web: '/trade2' }
}

/** 例:`tradeApiBase('tw', 'poe2')` → `https://pathofexile.tw/api/trade2` */
export function tradeApiBase (realm: Realm, game: Game): string {
  return `${apiBase(realm)}${TRADE_PATHS[game].api}`
}

/**
 * 給玩家開的網頁的聯盟層網址(`kind` 之後直接接 `/{searchId}` 或 `?q=`)。
 * 例:`tradeWebBase('intl', 'poe2', 'search', 'Standard')` → `https://www.pathofexile.com/trade2/search/poe2/Standard`
 */
export function tradeWebBase (realm: Realm, game: Game, kind: 'search' | 'exchange', league: string): string {
  const realmSegment = game === 'poe2' ? '/poe2' : ''
  return `${apiBase(realm)}${TRADE_PATHS[game].web}/${kind}${realmSegment}/${encodeURIComponent(league)}`
}
