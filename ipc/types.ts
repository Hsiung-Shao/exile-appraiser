/**
 * main ↔ renderer 的合約(經 preload 的 contextBridge 暴露成 `window.host`)。
 * 上游 APT 是 WebSocket + 本機 HTTP server;本專案直接用 ipcMain.handle / contextBridge,不開 port。
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
}

/** `host-config` 的回傳 = main `Shortcuts.updateActions` 的熱鍵註冊結果(設定頁「熱鍵與視窗」顯示)。 */
export interface HotkeyRegistration {
  ok: boolean
  /** 形如 `hotkey "Ctrl + D", "Shift + Space" is already registered by another application`(引號內是熱鍵)。 */
  error?: string
  /** 第一個註冊失敗的 Electron accelerator(如 `Ctrl+D`)。 */
  accelerator?: string
}

/** 設定面板的分頁(托盤「設定」「關於」用 `open-settings` 指定要開哪頁)。 */
export type SettingsTabId = 'general' | 'price-check' | 'hotkeys' | 'regex' | 'about'

export interface HostApi {
  readonly isElectron: true
  readonly version: string
  fetch: (url: string, init?: HostFetchInit) => Promise<HostFetchResult>
  loadConfig: () => Promise<string | null>
  saveConfig: (contents: string) => Promise<void>
  /** Poe Regex 面板狀態(勾選 + 書籤;`regex/src/state.ts` 的 JSON)。`userData/regex_state.json`,沒有檔案回 null。 */
  regexStateLoad: () => Promise<string | null>
  /** 原子寫入:`regex_state.json.tmp` → rename。 */
  regexStateSave: (contents: string) => Promise<void>
  /** 送設定給 main;回傳熱鍵註冊結果。 */
  updateHostConfig: (cfg: HostConfigForMain) => Promise<HotkeyRegistration>
  onItemText: (cb: (e: ItemTextEvent) => void) => () => void
  openExternal: (url: string) => Promise<void>
  /** 開一個內建瀏覽器視窗到交易站(解 Cloudflare 挑戰用;cookie 與 fetch 共用 session)。 */
  openCaptcha: (url: string) => Promise<void>
  hideWindow: () => Promise<void>
  /** 由 renderer 通知 main 目前視窗想要的大小(內容驅動;overlay 模式無作用)。 */
  resizeWindow: (width: number, height: number) => Promise<void>
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
  /** 只在 `reason === 'unsigned-build'` 且 `state === 'available'` 時有作用;下載完成 → `downloaded`,不自動安裝。 */
  downloadUpdate: () => Promise<void>
  /** `downloaded` 後結束並執行安裝程式(`quitAndInstall(false)`)。 */
  installUpdate: () => Promise<void>
  onUpdaterState: (cb: (info: UpdaterInfo) => void) => () => void
}

/**
 * 為什麼不能「一鍵下載安裝」(移植 APT `noDownloadReason`,見 main/src/AppUpdater.ts):
 * - `unsigned-build`:安裝版的預設。沒有 code signing 憑證,所以**不自動下載**;使用者按下才下載(`downloadUpdate`)。
 * - `not-supported`:portable(或非 Windows)沒有就地安裝的能力,只能引導去 Releases 頁。
 * - `disabled-by-flag`:使用者用 `--no-updates` 關掉(連檢查都不做)。
 */
export type NoDownloadReason = 'not-supported' | 'disabled-by-flag' | 'unsigned-build'

/**
 * - `initial`:還沒檢查過(或開發模式不檢查)
 * - `downloading`:使用者按了下載、進行中
 * - `error`:檢查/下載失敗(含 GitHub repo 或 Release 不存在的 404、斷網);只寫 log,不彈對話框
 */
export type UpdaterState = 'initial' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdaterInfo {
  state: UpdaterState
  /** 不能一鍵下載安裝的原因(固定值,啟動時決定)。 */
  reason: NoDownloadReason
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
