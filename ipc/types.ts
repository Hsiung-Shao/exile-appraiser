/**
 * main ↔ renderer 的合約(經 preload 的 contextBridge 暴露成 `window.host`)。
 * 上游 APT 是 WebSocket + 本機 HTTP server;本專案直接用 ipcMain.handle / contextBridge,不開 port。
 * 例外:瀏覽器預覽(`main/src/preview-server.ts`,docs/browser-preview.md)用 boot script 在一般瀏覽器裡造出同形狀的
 * `window.host`(`isPreview: true`),方法走 `POST ~rpc`、事件走 SSE。
 * 視窗模式兩種:`overlay`(預設,照 APT 疊在遊戲視窗上)與 `window`(備援:獨立小視窗,`--window` 或設定 overlayMode=false)。
 */
export interface HostFetchInit {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

/** main 端用 session fetch(帶 Cloudflare cookie)後回傳的可序列化結果。 */
export interface HostFetchResult {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
}

export interface ItemTextEvent {
  clipboard: string
  /** 按下熱鍵時的游標螢幕座標(視窗定位用)。 */
  position: { x: number, y: number }
  /** 鎖定查價(`hotkeyLocked`):overlay 取得焦點、面板可點擊,不隨滑鼠移開消失。 */
  focusOverlay: boolean
}

/** APT `MAIN->OVERLAY::focus-change`。 */
export interface FocusChangeEvent {
  game: boolean
  overlay: boolean
  usingHotkey: boolean
}

/** APT `OVERLAY->MAIN::track-area`(座標都是 CSS/DIP 像素,Windows 由 main 轉成實體像素)。 */
export interface TrackAreaOpts {
  holdKey: string
  closeThreshold: number
  from: { x: number, y: number }
  area: { x: number, y: number, width: number, height: number }
  dpr: number
}

export type WindowMode = 'overlay' | 'window'

/** 與 `@exile-appraiser/core/realm` 的 `Game` 相同(ipc 不依賴 core)。 */
export type GameId = 'poe1' | 'poe2'

export interface HostConfigForMain {
  /** 快速查價主鍵(APT 語意:不含修飾鍵,如 `D`)。 */
  hotkey: string
  /** 快速查價要按住的修飾鍵(`Ctrl` / `Alt`);放開後移動滑鼠面板就關。 */
  hotkeyHold: string
  /** 鎖定查價(如 `Ctrl + Alt + D`)。 */
  hotkeyLocked: string
  /** 切換 overlay/遊戲焦點(如 `Shift + Space`)。 */
  overlayKey: string
  /** 目前遊戲。overlay 模式下與啟動時綁定的遊戲不同 → main 寫設定並重新啟動(overlay 只能綁一次)。 */
  game: GameId
  /** 每款遊戲 overlay 附著的視窗標題(精確比對;預設 `Path of Exile` / `Path of Exile 2`)。 */
  windowTitleBy: Record<GameId, string>
  /** 偵測到另一款遊戲的視窗(且目前這款不在)就自動切換。 */
  autoSwitchGame: boolean
  /** overlay 模式(false = 獨立視窗);變更時 main 立即重新啟動。 */
  overlayMode: boolean
  restoreClipboard: boolean
  /** 客戶端語言:剪貼簿第一行 `物品種類: ` / `Item Class: ` 的偵測依它。 */
  language: 'cmn-Hant' | 'en'
  /** 介面語言:main 的托盤選單依它重建(main/src/tray-strings.ts)。 */
  uiLanguage: 'cmn-Hant' | 'en'
  /** WP-S:PoE2 靈魂之井揭露面板 OCR 熱鍵(預設 `Ctrl + Shift + R`;空字串 = 不註冊)。只在 overlay 模式 + PoE2 註冊。 */
  hotkeyOcrReveal: string
  /** WP-S:OCR 搜尋範圍(client 比例座標 0–1);null = 整個遊戲畫面(自動找面板)。WP-S2 起優先用它、區域內沒找到再找整個畫面。 */
  ocrRegion: OcrRegion | null
  /** WP-S2:在遊戲畫面上框選 OCR 區域的熱鍵(預設空字串 = 不註冊);註冊條件同 `hotkeyOcrReveal`(overlay + PoE2 + 遊戲前景)。 */
  hotkeyOcrRegion: string
  /** WP-R2:PoE2 符文塑形面板自動查價(預設關)。 */
  runeshapeEnabled: boolean
  /** WP-R2:符文塑形面板區域(client 比例 0–1);null = 未框選 → 自動尋找面板(低頻整個 client ×1 定位 + 記憶體快取)。 */
  runeshapeRegion: OcrRegion | null
  /** WP-R2:掃描間隔(ms,500–3000,預設 1000)。 */
  runeshapeIntervalMs: number
  /** WP-R2:暫停 / 繼續自動查價的熱鍵(預設空 = 不註冊;overlay + PoE2 + 已啟用才註冊)。 */
  hotkeyRuneshapeToggle: string
  /** 自動更新(預設 true):安裝版背景下載新版、結束程式時靜默套用;false = 手動(按下載 → 按安裝)。見 main/src/updater-core.ts。 */
  autoUpdate: boolean
  /** 啟動時在主螢幕右下角短暫顯示「已在背景執行」提示(預設 true;main/src/startup-toast.ts)。 */
  startupToast: boolean
}

/** WP-R2:一列 OCR 文字(座標 = 遊戲 client 區實體像素)。名稱比對在 renderer(poe2 `matchRunesRows`)。 */
export interface RuneshapeScanRow {
  text: string
  x: number
  y: number
  w: number
  h: number
}

/** WP-R2:一次掃描各段耗時(ms)。沒跑到的段省略。 */
export interface RuneshapeTimings {
  /** desktopCapturer 擷取 + 裁 client */
  captureMs: number
  /** 區域縮圖灰階 + 差分 */
  diffMs: number
  /** 前處理 + OCR + 傳輸(wall clock) */
  ocrWallMs?: number
  /** OCR 本身(PowerShell 行程內量測) */
  ocrMs?: number
  totalMs: number
  /** 差分結果(平均絕對差 0–255、變動像素比例 0–1);沒有基準時省略 */
  diff?: { mean: number, changedRatio: number }
  /** 區域來源:`manual` = 使用者框的 `runeshapeRegion`;`auto` = 自動定位的快取區 */
  mode?: 'manual' | 'auto'
  /** 這次有跑自動定位(整個 client ×1 OCR)時的 wall clock */
  locateMs?: number
  /** WinRT 把區域當成直書 → 改走 ×1 定位 + 裁切重辨識 */
  retry?: 'vertical'
}

/**
 * WP-R2:`runeshape-scan-result`(main → overlay;**不送瀏覽器預覽**)。
 * - `rows`:面板區 OCR 到的列(含 CJK 的行;至少要有 1 列面板格式的列 `isPanelRow`,否則視為沒有列);空陣列 = 清除徽章。
 * - `reason`:`rows` 有內容;`empty` = 連續 2 次 OCR 沒有列(面板關了);`inactive` = 停用 / 不是 PoE2 overlay / 沒有遊戲視窗;
 *   `user-paused` / `user-resumed` = 暫停熱鍵。
 */
export interface RuneshapeScanEvent {
  seq: number
  ts: number
  reason: 'rows' | 'empty' | 'inactive' | 'user-paused' | 'user-resumed'
  rows: RuneshapeScanRow[]
  client: { w: number, h: number }
  timings?: RuneshapeTimings
}

/** WP-R2:renderer 回報的 UI 狀態(任一為 true → 暫停掃描)。 */
export interface RuneshapeUiState {
  /** 查價面板 */
  panel: boolean
  settings: boolean
  /** 框選層 */
  picker: boolean
}

/** WP-R2:設定頁顯示的掃描統計(`runeshape-stats`)。 */
export interface RuneshapeStats {
  /** 目前在掃描 */
  active: boolean
  /** 沒在掃描的原因(`disabled` / `not-poe2` / `not-overlay` / `no-window` / `game-inactive` / `ui-open` / `user-paused` / `stopped`) */
  reason?: string
  ticks: number
  ocrRuns: number
  skippedUnchanged: number
  skippedBusy: number
  /** 區域來源:有框 `runeshapeRegion` = manual;沒框 = auto(自動定位) */
  mode: 'manual' | 'auto'
  /** 最近一次看區域的結果:`found` = 有面板列;`not-found` = 沒有;`unknown` = 還沒掃過 */
  panel: 'found' | 'not-found' | 'unknown'
  /** auto:目前快取的面板區(client 比例);沒有 = 尚未找到(低頻全畫面定位中) */
  autoRegion?: OcrRegion
  /** 自動定位(整個 client ×1)次數與沒找到的次數 */
  locates: number
  locateMisses: number
  last?: RuneshapeTimings
  /** 最近 20 次的平均(擷取 / OCR wall) */
  avgCaptureMs?: number
  avgOcrMs?: number
  /** 最近一次失敗(擷取 / OCR);成功後不清,設定頁一併顯示 */
  lastError?: string
}

/** client 比例矩形(0–1,左上原點)。 */
export interface OcrRegion {
  x: number
  y: number
  w: number
  h: number
}

/** 一行 OCR 文字;座標 = 遊戲 client 區的實體像素(左上原點)。 */
export interface OcrRevealLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export type OcrRevealError =
  /** 沒有繁中 OCR 語言包(設定 → 時間與語言 → 語言 → 中文(台灣)→ 語言選項 → 光學字元辨識) */
  | 'lang-missing'
  | 'unsupported-platform'
  /** overlay 還沒綁到遊戲視窗(或視窗大小為 0) */
  | 'no-game-window'
  /** desktopCapturer 拿不到畫面(全螢幕獨占模式可能是黑畫面) */
  | 'capture-failed'
  | 'timeout'
  | 'ocr-failed'

/**
 * `ocr-reveal-result` 事件(main → overlay;不送瀏覽器預覽)。
 * - `pending`:按下熱鍵、開始擷取(UI 顯示「辨識中」)。
 * - `result`:`ok` 時 `lines` 是整個搜尋範圍的 OCR 行,比對在 renderer(poe2 `matchReveal`)。
 */
export type OcrRevealEvent =
  | { phase: 'pending', seq: number }
  | {
    phase: 'result'
    seq: number
    ok: boolean
    error?: OcrRevealError
    message?: string
    lines: OcrRevealLine[]
    /** client 區實體像素大小(renderer 以比例換算成 CSS 座標) */
    client: { w: number, h: number }
    /** OCR 前的放大倍率 */
    scale: number
    /** 擷取 + OCR 總耗時 / 其中 OCR 本身 */
    tookMs: number
    ocrMs: number
    /**
     * 兩段式診斷:走了哪條路(cached = 快取區 ×3;two-pass = 整張 ×1 定位 + 面板區 ×3;full = 整張 ×3)。
     * WP-S2:有設定區域時 = `region`(區域內找到)或 `region-fallback`(區域內沒找到,改找整個畫面;renderer 提示一次)。
     */
    stage?: OcrRevealStage
    /** WP-S2:被採用那一輪實際走的內層路徑 */
    inner?: 'cached' | 'two-pass' | 'full'
    /** 各段耗時(依執行順序;失敗的段帶 `rejected`) */
    stages?: OcrRevealStageTiming[]
  }

/** WP-S 兩段式辨識走的路(docs/reveal-ocr.md);WP-S2 加 `region` / `region-fallback` */
export type OcrRevealStage = 'cached' | 'two-pass' | 'full' | 'region' | 'region-fallback'

export interface OcrRevealStageTiming {
  name: 'cached' | 'locate' | 'detail' | 'full'
  /** 這段 OCR 的範圍(client 實體像素) */
  rect: { x: number, y: number, width: number, height: number }
  scale: number
  /** 前處理 + OCR + 傳輸 */
  ms: number
  ocrMs: number
  lines: number
  hits?: number
  rejected?: string
  /** WP-S2:`region` = 使用者框的區域那一輪;`screen` = 整個畫面那一輪(沒設定區域時省略) */
  scope?: 'region' | 'screen'
}

/** `ocrRevealAvailable()` 的結果(設定頁顯示)。 */
export type OcrAvailability =
  | { ok: true, lang: string, langs: string[] }
  | { ok: false, error: string, langs?: string[], message?: string }

/** `host-config` 的回傳 = main `Shortcuts.updateActions` 的熱鍵註冊結果(設定頁「熱鍵與視窗」顯示)。 */
export interface HotkeyRegistration {
  ok: boolean
  /** 形如 `hotkey "Ctrl + D", "Shift + Space" is already registered by another application`(引號內是熱鍵)。 */
  error?: string
  /** 第一個註冊失敗的 Electron accelerator(如 `Ctrl+D`)。 */
  accelerator?: string
  /**
   * 只在瀏覽器預覽送出時可能為 true:遊戲 / 視窗標題 / overlayMode 與 overlay 目前綁定的不同,
   * main 只存檔不重新啟動(下次啟動 ExileAppraiser 才生效)。
   */
  needsRestart?: boolean
}

/** 設定檔寫入後 main 廣播(Electron 與所有預覽分頁)。`source`:`electron` 或 `preview:<clientId>`(發起端自己會略過)。 */
export interface ConfigChangedEvent {
  contents: string
  source: string
}

/** 設定面板的分頁(托盤「設定」「關於」用 `open-settings` 指定要開哪頁;查價標題列 ⚖ 開 `dust`)。 */
export type SettingsTabId = 'general' | 'price-check' | 'hotkeys' | 'regex' | 'dust' | 'about'

export interface HostApi {
  readonly isElectron: true
  readonly version: string
  /** 瀏覽器預覽頁(boot script 的 shim)為 true;Electron preload 沒有這個欄位。 */
  readonly isPreview?: boolean
  fetch: (url: string, init?: HostFetchInit) => Promise<HostFetchResult>
  loadConfig: () => Promise<string | null>
  saveConfig: (contents: string) => Promise<void>
  /** Poe Regex 面板狀態(勾選 + 書籤;`regex/src/state.ts` 的 JSON)。`userData/regex_state.json`,沒有檔案回 null。 */
  regexStateLoad: () => Promise<string | null>
  /** 原子寫入:`regex_state.json.tmp` → rename。 */
  regexStateSave: (contents: string) => Promise<void>
  /** 拆粉排行面板狀態(`core/src/dust/ui-state.ts` 的 JSON)。`userData/dust_ui.json`,沒有檔案回 null。 */
  dustUiLoad: () => Promise<string | null>
  /** 原子寫入:`dust_ui.json.tmp` → rename。 */
  dustUiSave: (contents: string) => Promise<void>
  /** poe.ninja 價格表快照(`core/src/ninja/cache.ts`)。`userData/cache/ninja/<game>_<league>.json`,沒有檔案回 null。 */
  ninjaCacheLoad: (game: GameId, league: string) => Promise<string | null>
  /** 原子寫入(`.tmp<pid>` → rename);啟動時 main 清 30 天以上的檔。 */
  ninjaCacheSave: (game: GameId, league: string, contents: string) => Promise<void>
  /** 送設定給 main;回傳熱鍵註冊結果。 */
  updateHostConfig: (cfg: HostConfigForMain) => Promise<HotkeyRegistration>
  onItemText: (cb: (e: ItemTextEvent) => void) => () => void
  openExternal: (url: string) => Promise<void>
  /** 開一個內建瀏覽器視窗到交易站(解 Cloudflare 挑戰用;cookie 與 fetch 共用 session)。 */
  openCaptcha: (url: string) => Promise<void>
  hideWindow: () => Promise<void>
  /** 由 renderer 通知 main 目前視窗想要的大小(內容驅動;overlay 模式無作用)。 */
  resizeWindow: (width: number, height: number) => Promise<void>
  /** 設定視窗「結束程式」(= 托盤「結束」,IPC `app-quit`)。瀏覽器預覽 shim 沒有這個方法(`preview: false`)。 */
  appQuit?: () => Promise<void>
  /** main 建立視窗時決定的模式(啟動後不變)。 */
  readonly windowMode: WindowMode
  onFocusChange: (cb: (e: FocusChangeEvent) => void) => () => void
  onVisibility: (cb: (e: { isVisible: boolean }) => void) => () => void
  onHideWidget: (cb: () => void) => () => void
  /** window 模式下偵測器切遊戲:renderer 跟著切 `config.game`(overlay 模式改走重新啟動)。 */
  onSwitchGame: (cb: (game: GameId) => void) => () => void
  /** 托盤「設定」「關於」:main 已把視窗叫到前景(window 顯示 / overlay `assertOverlayActive`),renderer 開設定到指定分頁。 */
  onOpenSettings: (cb: (e: { tab: SettingsTabId }) => void) => () => void
  trackArea: (opts: TrackAreaOpts) => void
  focusGame: () => void
  usedRecently: (isOverlay: boolean) => void
  /** 自動更新(electron-updater,GitHub Releases)。 */
  getUpdaterInfo: () => Promise<UpdaterInfo>
  checkForUpdate: () => Promise<void>
  /** 只在 `reason === 'unsigned-build'` 且 `state === 'available'` 時有作用(`autoUpdate` 關的手動流程);下載完成 → `downloaded`。 */
  downloadUpdate: () => Promise<void>
  /** `downloaded` 後結束並執行安裝程式:`autoUpdate` 開 = 靜默安裝並重新啟動(`quitAndInstall(true, true)`);關 = 顯示安裝程式(`quitAndInstall(false)`)。 */
  installUpdate: () => Promise<void>
  onUpdaterState: (cb: (info: UpdaterInfo) => void) => () => void
  /** 另一端(Electron 視窗或其他預覽分頁)存了設定;自己存的不會收到。 */
  onConfigChanged: (cb: (e: ConfigChangedEvent) => void) => () => void
  /** 啟動(或沿用)瀏覽器預覽伺服器並用預設瀏覽器開啟,回傳網址。 */
  openPreview: () => Promise<{ url: string }>
  /** 預覽伺服器目前的網址(沒在跑回 null)。 */
  getPreviewUrl: () => Promise<string | null>
  /** WP-S:靈魂之井揭露面板 OCR(熱鍵觸發;只有 overlay 會收到)。 */
  onOcrRevealResult: (cb: (e: OcrRevealEvent) => void) => () => void
  /** WP-S:Windows OCR 繁中語言包是否可用(會視需要啟動 OCR 行程;瀏覽器預覽端回 undefined)。 */
  ocrRevealAvailable: () => Promise<OcrAvailability | undefined>
  /** WP-S2:overlay 取得焦點(可點擊;main `assertOverlayActive`)。框選層開啟時呼叫;預覽端 no-op。 */
  overlayActivate: () => Promise<void>
  /** WP-S2:立刻跑一次揭露面板 OCR(= 按 OCR 熱鍵;框選確認後自動試辨識)。沒有遊戲視窗 / 不是 PoE2 overlay 時回 false;預覽端 no-op。 */
  ocrRevealNow: () => Promise<boolean | undefined>
  /** WP-S2:框選熱鍵(`hotkeyOcrRegion`)按下 → renderer 開框選層(只有 overlay 會收到)。 */
  onOcrRegionPick: (cb: () => void) => () => void
  /** WP-R2:符文塑形自動查價的掃描結果(只有 overlay 會收到)。 */
  onRuneshapeScanResult?: (cb: (e: RuneshapeScanEvent) => void) => () => void
  /** WP-R2:回報查價面板 / 設定 / 框選層是否開著(任一開著 → main 暫停掃描);預覽端 no-op。 */
  runeshapeUiState?: (s: RuneshapeUiState) => void
  /** WP-R2:掃描統計(設定頁);預覽端回 undefined。 */
  runeshapeStats?: () => Promise<RuneshapeStats | undefined>
}

/**
 * 更新能力(移植 APT `noDownloadReason`,見 main/src/AppUpdater.ts、updater-core.ts):
 * - `unsigned-build`:安裝版(沒有 code signing)。`autoUpdate` 開 = 背景自動下載、結束程式時套用;關 = 使用者按下才下載(`downloadUpdate`)。
 * - `not-supported`:portable(或非 Windows)沒有就地安裝的能力,只能引導去 Releases 頁。
 * - `disabled-by-flag`:使用者用 `--no-updates` 關掉(連檢查都不做)。
 */
export type NoDownloadReason = 'not-supported' | 'disabled-by-flag' | 'unsigned-build'

/**
 * - `initial`:還沒檢查過(或開發模式不檢查)
 * - `downloading`:下載中(`autoUpdate` 開 = 檢查到就自動下載;關 = 使用者按了下載)
 * - `downloaded`:已下載;`autoUpdate` 開時正常結束程式就會靜默套用
 * - `error`:檢查/下載失敗(含 GitHub repo 或 Release 不存在的 404、斷網);只寫 log,不彈對話框
 */
export type UpdaterState = 'initial' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdaterInfo {
  state: UpdaterState
  /** 不能一鍵下載安裝的原因(固定值,啟動時決定)。 */
  reason: NoDownloadReason
  /** main 目前套用的設定 `autoUpdate`(UI 依它顯示「結束程式時自動套用」與按鈕)。 */
  autoUpdate?: boolean
  /** 目前執行中的版本。 */
  currentVersion?: string
  /** `available` / `downloading` / `downloaded`:新版版號。 */
  version?: string
  /** 新版的 GitHub Release 頁(`not-supported` 時 UI 用它導去手動下載);沒有新版時是 Releases 列表頁。 */
  releaseNotesUrl?: string
  /** `error`:一行錯誤說明(`not-found` = 404,多半是 repo / Release / latest.yml 還不存在)。 */
  error?: string
  errorKind?: 'not-found' | 'network' | 'other'
  /** 最近一次檢查完成的時間(ms)。 */
  checkedAt?: number
}

declare global {
  interface Window {
    host?: HostApi
  }
}
