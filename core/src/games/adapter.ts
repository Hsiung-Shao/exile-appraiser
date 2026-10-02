/**
 * 每個遊戲(PoE1 / PoE2)一個 adapter。shell(Electron main / renderer / CLI)只認這個介面,
 * 不直接 import 任何遊戲專屬的 parser 或篩選器。
 *
 * 型別刻意鬆(`unknown`):PoE1 與 PoE2 的 ParsedItem / FilterPreset / TradeRequest 結構分歧
 * (符文、精魂、`trade2` 路徑…),硬合併只會造出一個現實中不存在的型別。
 * 各 adapter 自己的 package 對外 export 精確型別,UI 依 `game` 分支時再用。
 */
import type { HttpFetch } from '../http/HttpClient'
import type { Language, Realm } from '../realm/config'

export type GameId = 'poe1' | 'poe2'

/** 資料檔來源:renderer 用 fetch / 動態 import,Node 用 fs;測試也走 Node 版。 */
export interface DataSource {
  text: (relativePath: string) => Promise<string>
  binary: (relativePath: string) => Promise<ArrayBuffer>
  /** 載入 `client_strings.js` 這種 ESM 模組,回傳其 default export。 */
  module: (relativePath: string) => Promise<unknown>
}

export interface TradeContext {
  http: HttpFetch
  realm: Realm
  /** 使用者設定的 API 延遲補償秒數(上游 `apiLatencySeconds`),加到限流視窗上。 */
  latencySeconds: number
  /** 使用者帳號名(標記「這是我的掛單」);匿名模式可為空字串。 */
  accountName: string
}

export interface ParseResult<TItem> {
  ok: true
  item: TItem
  /** 認不出來的詞綴行:一律保留並顯示,不丟棄(對應 poenavi 的 confidence=0 警告)。 */
  unknownModifiers: string[]
}
export interface ParseFailure { ok: false, error: string }

/**
 * 第 27 步:查價前依物品文字決定解析語系(`prepareItemText` 的結果)。
 * 國際服:文字的語言 ≠ 客戶端語言時改用文字的語言(查詢用語言無關鍵,結果相同);台服一律客戶端語言。
 */
export interface ItemTextLanguage {
  /** 從名牌區標頭判斷出的語言;判斷不出 = undefined(照客戶端語言解析,該報錯就照舊報錯)。 */
  detected?: Language
  /** 實際用來解析的語系(資料集已換好)。 */
  lang: Language
  /** 客戶端語言(`loadData` 載入的那一套);資料還沒載 = undefined。 */
  clientLanguage?: Language
}

export interface GameAdapter<TItem = unknown, TPreset = unknown, TRequest = unknown> {
  readonly id: GameId
  /**
   * 載入客戶端語言的資料集(資料在模組層級全域,切語系要重載)。
   * 第 27 步起每個語系的資料各存一套:查價時 `prepareItemText` 可換到另一語系(第一次另讀檔,之後快取)。
   */
  loadData: (source: DataSource, lang: Language) => Promise<void>
  /**
   * 第 27 步:解析前呼叫。依 realm + 文字語言選語系並把資料集換好(與 `loadData` 同一個佇列,不會交錯)。
   * 換語系載入失敗會拋錯(資料集維持原本那一套)。
   */
  prepareItemText: (text: string, realm: Realm) => Promise<ItemTextLanguage>
  /** 目前資料集(parser / filters 讀的那一套)的語系;載入中 = undefined。 */
  dataLanguage: () => Language | undefined
  parseClipboard: (text: string) => ParseResult<TItem> | ParseFailure
  createPresets: (item: TItem, opts: PresetOptions) => TPreset[]
  /** PoE2 上游組查詢還要 item(符文 / 物品類別);PoE1 忽略第二個參數。 */
  createTradeRequest: (preset: TPreset, item: TItem) => TRequest
  apiToSatisfySearch: (item: TItem, preset: TPreset) => 'trade' | 'bulk'
  /** 給玩家開的網頁網址(依 realm host;含 `?q=` 或 search id)。 */
  webSearchUrl: (realm: Realm, league: string, request: TRequest) => string
}

export interface PresetOptions {
  league: string
  realm: Realm
  clientLanguage: Language
  /** 詞綴數值容差 %(0/5/10/15/20/30/50;預設 10)。 */
  searchStatRange: number
  currency: string | null
  collapseListings: 'app' | 'api'
  activateStockFilter: boolean
  merchantOnly: boolean
}
