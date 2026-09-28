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

export interface GameAdapter<TItem = unknown, TPreset = unknown, TRequest = unknown> {
  readonly id: GameId
  /** 一個 process 同一時間只能載一個語系(資料在模組層級全域),切語系要重載。 */
  loadData: (source: DataSource, lang: Language) => Promise<void>
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
