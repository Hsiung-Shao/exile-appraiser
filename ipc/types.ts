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
  /** main 端逾時(ms,預設 30 秒,夾在 1 秒 ~ 5 分鐘;涵蓋讀完 body)。逾時 reject 一般 Error,與網路錯誤同形狀。 */
  timeoutMs?: number
  /** 可中止的請求 id(renderer 的 AbortSignal 觸發時以 `fetchAbort(requestId)` / IPC `http-abort` 中止)。 */
  requestId?: string
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

/** 第 25 步:OCR 辨識語言設定(`follow` = 跟隨客戶端語言) */
export type OcrLangSetting = 'follow' | 'cmn-Hant' | 'en'

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
  /**
   * 第 25 步:OCR 辨識語言(褻瀆 / 符文塑形共用):`follow` = 跟隨客戶端語言(預設;舊設定檔 / 舊 renderer 沒有這欄 = follow)、
   * `cmn-Hant` = 固定繁中語言包、`en` = 固定英文語言包。與介面語言、客戶端語言(查價解析)三者獨立。`main/src/ocr/ocr-lang.ts`。
   */
  ocrLang?: OcrLangSetting
  /** 介面語言:main 的托盤選單依它重建(main/src/tray-strings.ts)。 */
  uiLanguage: 'cmn-Hant' | 'en'
  /**
   * WP-S:PoE2 靈魂之井揭露面板熱鍵(預設 `Ctrl + Shift + R`;空字串 = 不註冊)。只在 overlay 模式 + PoE2 + `revealAutoEnabled` 時註冊。
   * 2026-10-01 起 = **暫停 / 繼續褻瀆自動辨識**(原本是「按一次辨識一次」)。
   */
  hotkeyOcrReveal: string
  /** 2026-10-01:褻瀆(揭露面板)自動持續辨識(預設開;舊設定檔沒有這欄 = 開)。 */
  revealAutoEnabled?: boolean
  /** 2026-10-01:褻瀆自動辨識的掃描間隔(ms,100–3000,預設 1000;下限 2026-10-01 由 500 放寬)。 */
  revealIntervalMs?: number
  /** WP-S:OCR 搜尋範圍(client 比例座標 0–1);null = 整個遊戲畫面(自動找面板)。WP-S2 起優先用它、區域內沒找到再找整個畫面。 */
  ocrRegion: OcrRegion | null
  /** WP-S2:在遊戲畫面上框選 OCR 區域的熱鍵(預設空字串 = 不註冊);註冊條件同 `hotkeyOcrReveal`(overlay + PoE2 + 遊戲前景)。 */
  hotkeyOcrRegion: string
  /** WP-R2:PoE2 符文塑形面板自動查價(預設關)。 */
  runeshapeEnabled: boolean
  /** WP-R2:符文塑形面板區域(client 比例 0–1);null = 未框選 → 自動尋找面板(低頻整個 client ×1 定位 + 記憶體快取)。 */
  runeshapeRegion: OcrRegion | null
  /** WP-R2:掃描間隔(ms,100–3000,預設 1000;下限 2026-10-01 由 500 放寬)。 */
  runeshapeIntervalMs: number
  /** WP-R2:暫停 / 繼續自動查價的熱鍵(預設空 = 不註冊;overlay + PoE2 + 已啟用才註冊)。 */
  hotkeyRuneshapeToggle: string
  /** 2026-10-01:框選符文塑形面板區域的熱鍵(預設空 = 不註冊;註冊條件同 `hotkeyOcrRegion`:overlay + PoE2 + 遊戲前景)。 */
  hotkeyRuneshapeRegion?: string
  /** 自動更新(預設 true):安裝版背景下載新版、結束程式時靜默套用;false = 手動(按下載 → 按安裝)。見 main/src/updater-core.ts。 */
  autoUpdate: boolean
  /** 啟動時在主螢幕右下角短暫顯示「已在背景執行」提示(預設 true;main/src/startup-toast.ts)。 */
  startupToast: boolean
  /** 2026-10-01:聊天指令熱鍵(兩個遊戲皆可;只在 overlay 模式、遊戲前景時註冊)。 */
  commands?: ChatCommand[]
  /** 2026-10-01:倉庫搜尋一鍵輸入熱鍵(同上)。 */
  stashSearch?: StashSearchEntry[]
  /**
   * 2026-10-01(第 15 步,移植 APT):倉庫頁籤捲動 —— 遊戲在前景時 Ctrl + 滾輪送 ← / →(預設開;舊設定檔 / 舊 renderer 沒有這欄 = 開)。
   * 只在 overlay 模式生效;開著時遊戲在前景期間會持有 uiohook 掛鉤(main/src/stash-scroll.ts)。
   */
  stashScroll?: boolean
}

/** 面板掃描(符文塑形 / 褻瀆)的一行 OCR 文字(座標 = 遊戲 client 區實體像素)。比對在 renderer。 */
export interface PanelScanRow {
  text: string
  x: number
  y: number
  w: number
  h: number
}
/** WP-R2:符文塑形的一列(名稱比對在 renderer poe2 `matchRunesRows`) */
export type RuneshapeScanRow = PanelScanRow

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
 * 面板掃描結果(main `panel-scan.ts`;main → overlay;**不送瀏覽器預覽**)。
 * - `rows`:面板區 OCR 到的行(detector 判定有面板才有;空陣列 = 清除徽章)。
 * - `reason`:`rows` 有內容;`empty` = 連續 2 次 OCR 沒有面板(面板關了);`inactive` = 停用 / 不是 PoE2 overlay / 沒有遊戲視窗 / 資料讀不到;
 *   `user-paused` / `user-resumed` = 暫停熱鍵。
 * (2026-10-01 第 13 步移除 `fallback`:褻瀆有框區域時也只看區域,不再退回自動定位。)
 */
export interface PanelScanEvent {
  seq: number
  ts: number
  reason: 'rows' | 'empty' | 'inactive' | 'user-paused' | 'user-resumed'
  rows: PanelScanRow[]
  client: { w: number, h: number }
  timings?: RuneshapeTimings
}
/**
 * WP-R2:`runeshape-scan-result`。`rows` = 含 CJK 的行(至少要有 1 列面板格式的列 `isPanelRow`,否則視為沒有列)。
 */
export type RuneshapeScanEvent = PanelScanEvent
/**
 * 2026-10-01:`reveal-scan-result`(褻瀆自動辨識)。`rows` = 面板區 OCR 的全部行(≥ 2 行像詞綴才送),比對在 renderer(poe2 `matchRevealLines`)。
 */
export type RevealScanEvent = PanelScanEvent

/**
 * 效能修正第 18 步:renderer 回報畫在遊戲上的東西(`scan-mask`;main `scan-mask.ts`)。擷取會截到 overlay 自己,
 * main 擷取後把這些矩形填掉再 OCR、差分不比那幾格。`source` = 哪一層(褻瀆徽章層 / 符文徽章層),每層一份、新的取代舊的。
 */
export interface ScanMaskReport {
  source: 'reveal' | 'rune'
  /** 這份反映到哪一個掃描事件為止(`PanelScanEvent.seq`,ack;main 送出 rows 後等它才擷取下一張);純外觀變動可省略 */
  seq?: number
  /** overlay 視窗的 CSS 大小(`innerWidth` / `innerHeight`;main 以 client.w / innerWidth 換算成 client 實體像素) */
  viewport: { w: number, h: number }
  /** 目前可見元素的外框(CSS px,`getBoundingClientRect`);清除 = [] */
  rects: Array<{ x: number, y: number, w: number, h: number }>
  /**
   * code review 第 B 批:renderer 畫面沒反映最近收到的 `rows`(收到時資料還沒載好 = 沒畫徽章 / 資料世代改了 = 徽章是舊資料算的)
   * → main 清掉該來源掃描的「相同 rows 不重送」簽章與差分基準,下一個 tick 重新 OCR 並照送。只在資料載好 / 世代改變時送一次。
   */
  resend?: boolean
}

/** WP-R2:renderer 回報的 UI 狀態(任一為 true → 暫停掃描)。 */
export interface RuneshapeUiState {
  /** 查價面板 */
  panel: boolean
  settings: boolean
  /** 框選層 */
  picker: boolean
}

/**
 * 第五輪 30.4:renderer 回報 overlay 上目前有沒有東西要畫(IPC `overlay-content`,只有 overlay;main `windowing/overlay-idle.ts`
 * 彙整:全部 false 且 overlay 沒有焦點 → 遊戲在前景時延遲 500 ms 隱藏 overlay 視窗)。
 */
export interface OverlayContentState {
  /** 查價面板(overlay 的 `panelShown`;設定開著時也是 true) */
  panel: boolean
  /** 設定視窗 */
  settings: boolean
  /** 框選層 */
  picker: boolean
  /** 褻瀆徽章層(`OcrBadges.vue` 不是 idle) */
  reveal: boolean
  /** 符文塑形徽章層(徽章或層內提示) */
  rune: boolean
}

/** WP-R2:設定頁顯示的掃描統計(`runeshape-stats`)。 */
export interface RuneshapeStats {
  /** 目前在掃描 */
  active: boolean
  /** 沒在掃描的原因(`disabled` / `not-poe2` / `not-overlay` / `no-window` / `game-inactive` / `ui-open` / `user-paused` / `no-data` / `stopped`) */
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

/** 框選熱鍵要框哪一種區域(事件 `ocr-region-pick` 的內容;省略 = 揭露面板) */
export type OcrRegionPickTarget = 'reveal' | 'runeshape'

/** 一行 OCR 文字;座標 = 遊戲 client 區的實體像素(左上原點)。 */
export interface OcrRevealLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

// 2026-10-01:按熱鍵辨識一次的 `ocr-reveal-result`(OcrRevealEvent / 兩段式 stage)已由持續掃描的 `reveal-scan-result`(RevealScanEvent)取代。

/** `ocrRevealAvailable()` 的結果(設定頁顯示)。 */
export type OcrAvailability =
  | { ok: true, lang: string, langs: string[] }
  /** `lang`(第 22 步)= 想用的語言包(`zh-Hant-TW` / `en-US`,跟著客戶端語言);舊 main 沒有 */
  | { ok: false, error: string, lang?: string, langs?: string[], message?: string }

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
export type SettingsTabId = 'general' | 'price-check' | 'hotkeys' | 'chat' | 'regex' | 'dust' | 'log' | 'about'

/** 第 28 步:設定 › 記錄。main 常駐環形緩衝(最近約 3000 行)的一筆;`seq` 遞增,renderer 以它去重 / 補洞。 */
export type LogLevel = 'info' | 'warn' | 'error'
export interface LogEntry {
  seq: number
  /** epoch ms */
  ts: number
  level: LogLevel
  text: string
}
export interface LogSnapshot {
  entries: LogEntry[]
  /** main 目前最大的 seq(0 = 還沒有任何記錄) */
  lastSeq: number
}

/**
 * 第 29 步:效能診斷(設定 › 記錄 › 效能;IPC `perf-get` / `perf-set` / `perf-open-file`,三者都只給 Electron 視窗)。
 * main `perf/perf-monitor.ts`;開關存在 `userData/perf.json`(與 config.json 分開),`--perf-log` 參數也會打開。
 */
export interface PerfState {
  /** 目前是否在記錄 */
  enabled: boolean
  /** 這次啟動帶了 `--perf-log` */
  byArg: boolean
  /** 設定開關(userData/perf.json) */
  setting: boolean
  /** 取樣間隔(ms) */
  sampleMs: number
  /** 今天的效能記錄檔完整路徑(`userData/logs/perf-<日期>.log`,JSONL) */
  file: string
  /** 最近一筆:時間、情境鍵、一行摘要(與 app-log 的 `[perf]` 行相同) */
  last: { ts: number, scenario: string, summary: string } | null
}

/** 聊天指令(移植 APT `commands`):熱鍵 → 在遊戲聊天框輸入 `text`(`@last` 前綴 / 後綴規則見 main/src/text-box.ts);`send` = 直接送出。 */
export interface ChatCommand {
  text: string
  /** '' = 不註冊 */
  hotkey: string
  send: boolean
}

/** 倉庫搜尋一鍵輸入(APT stash-search):熱鍵 → Ctrl+F → 貼上 `text` → Enter。 */
export interface StashSearchEntry {
  text: string
  /** '' = 不註冊 */
  hotkey: string
}

export interface HostApi {
  readonly isElectron: true
  readonly version: string
  /** 瀏覽器預覽頁(boot script 的 shim)為 true;Electron preload 沒有這個欄位。 */
  readonly isPreview?: boolean
  fetch: (url: string, init?: HostFetchInit) => Promise<HostFetchResult>
  /** 中止 `fetch(url, { requestId })` 進行中的請求(IPC `http-abort`;預覽端經 RPC)。找不到 = false。 */
  fetchAbort?: (requestId: string) => Promise<boolean>
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
  /**
   * 自訂背景圖:檔案對話框選 png / jpg / webp → main 複製到 `userData/backgrounds/` → 回傳檔名(取消 / 失敗 = null)。
   * 圖片由 `app://bg/<檔名>`(預覽:`<prefix>bg/<檔名>`)載入。瀏覽器預覽 shim 沒有這個方法(`preview: false`)。
   */
  bgPick?: () => Promise<string | null>
  /** main 建立視窗時決定的模式(啟動後不變)。 */
  readonly windowMode: WindowMode
  onFocusChange: (cb: (e: FocusChangeEvent) => void) => () => void
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
  /** 第 11 步:系統已安裝字體 family 名稱(main `system-fonts.ts`;去重排序,失敗 = [])。預覽端經 RPC 可用。 */
  listFonts?: () => Promise<string[]>
  /** 靈魂之井揭露面板(褻瀆)自動辨識結果(`reveal-scan-result`;只有 overlay 會收到)。 */
  onRevealScanResult?: (cb: (e: RevealScanEvent) => void) => () => void
  /** 褻瀆自動辨識統計(設定頁);預覽端回 undefined。 */
  revealStats?: () => Promise<RuneshapeStats | undefined>
  /** WP-S:Windows OCR 繁中語言包是否可用(會視需要啟動 OCR 行程;瀏覽器預覽端回 undefined)。 */
  ocrRevealAvailable: () => Promise<OcrAvailability | undefined>
  /** WP-S2:overlay 取得焦點(可點擊;main `assertOverlayActive`)。框選層開啟時呼叫;預覽端 no-op。 */
  overlayActivate: () => Promise<void>
  /** WP-S2:框選確認後請褻瀆自動辨識立刻重看一次(丟掉差分基準 / 退回狀態)。沒有遊戲視窗 / 不是 PoE2 overlay 時回 false;預覽端 no-op。 */
  ocrRevealNow: () => Promise<boolean | undefined>
  /**
   * WP-S2:框選熱鍵按下 → renderer 開框選層(只有 overlay 會收到)。`target` 省略 = 揭露面板(`hotkeyOcrRegion`);
   * `'runeshape'` = 符文塑形面板(`hotkeyRuneshapeRegion`,2026-10-01)。
   */
  onOcrRegionPick: (cb: (target?: OcrRegionPickTarget) => void) => () => void
  /** WP-R2:符文塑形自動查價的掃描結果(只有 overlay 會收到)。 */
  onRuneshapeScanResult?: (cb: (e: RuneshapeScanEvent) => void) => () => void
  /** WP-R2:回報查價面板 / 設定 / 框選層是否開著(符文塑形:任一開著 → 暫停;褻瀆:設定 / 框選層才暫停);預覽端 no-op。 */
  runeshapeUiState?: (s: RuneshapeUiState) => void
  /** 第五輪 30.4:回報 overlay 上有沒有東西要畫(main 據此閒置隱藏 overlay 視窗);預覽端 no-op。 */
  overlayContent?: (s: OverlayContentState) => void
  /** WP-R2:掃描統計(設定頁);預覽端回 undefined。 */
  runeshapeStats?: () => Promise<RuneshapeStats | undefined>
  /** 第 18 步:回報畫在遊戲上的徽章 / 提示外框(main 擷取後遮掉);預覽端 no-op。 */
  scanMask?: (r: ScanMaskReport) => void
  /** 第 28 步:記錄快照(IPC `log-get`);帶 `sinceSeq` 只回較新的。預覽端經 RPC 可用(輪詢)。 */
  getLog?: (sinceSeq?: number) => Promise<LogSnapshot>
  /** 第 28 步:記錄分頁開 / 關時通知 main 要不要送 `log-lines`(IPC `log-subscribe`);預覽端 no-op。 */
  logSubscribe?: (on: boolean) => void
  /** 第 28 步:記錄即時追加(~200 ms 一批;只在 `logSubscribe(true)` 之後才會收到)。預覽端永遠收不到(不在 PREVIEW_EVENTS)。 */
  onLogLines?: (cb: (entries: LogEntry[]) => void) => () => void
  /** 第 28 步:開啟記錄資料夾(userData/logs)。瀏覽器預覽 shim 沒有這個方法(`preview: false`)。 */
  openLogFolder?: () => Promise<void>
  /** 第 29 步:效能診斷狀態。瀏覽器預覽 shim 沒有這三個方法(`preview: false`)。 */
  perfGet?: () => Promise<PerfState>
  /** 第 29 步:開 / 關效能診斷(存進 userData/perf.json,立即生效);回傳新狀態 */
  perfSet?: (on: boolean) => Promise<PerfState>
  /** 第 29 步:用系統預設程式開今天的效能記錄檔(還沒有就開記錄資料夾) */
  perfOpenFile?: () => Promise<void>
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
