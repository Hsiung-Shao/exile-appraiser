import { contextBridge, ipcRenderer } from 'electron'
import type { HostApi, HostFetchInit, HostConfigForMain, ItemTextEvent, FocusChangeEvent, TrackAreaOpts, WindowMode, GameId, UpdaterInfo, SettingsTabId, LegacySettingsTabId, ConfigChangedEvent, OcrRegionPickTarget, RevealScanEvent, RuneshapeScanEvent, RuneshapeUiState, ScanMaskReport, LogEntry, OverlayContentState, RegexBookmarkRunEvent, RegexPasteRequest, RegexShareRequest } from '@ipc/types'

function subscribe<T> (channel: string, cb: (e: T) => void): () => void {
  const listener = (_: unknown, e: T) => cb(e)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

const api: HostApi = {
  isElectron: true,
  version: process.env.npm_package_version ?? ipcRenderer.sendSync('app-version') as string,
  windowMode: ipcRenderer.sendSync('window-mode') as WindowMode,
  fetch: (url: string, init?: HostFetchInit) => ipcRenderer.invoke('http-fetch', url, init),
  fetchAbort: (requestId: string) => ipcRenderer.invoke('http-abort', requestId),
  loadConfig: () => ipcRenderer.invoke('config-load'),
  saveConfig: (contents: string) => ipcRenderer.invoke('config-save', contents),
  regexStateLoad: () => ipcRenderer.invoke('regex-state-load'),
  regexStateSave: (contents: string) => ipcRenderer.invoke('regex-state-save', contents),
  dustUiLoad: () => ipcRenderer.invoke('dust-ui-load'),
  dustUiSave: (contents: string) => ipcRenderer.invoke('dust-ui-save', contents),
  ninjaCacheLoad: (game: GameId, league: string) => ipcRenderer.invoke('ninja-cache-load', game, league),
  ninjaCacheSave: (game: GameId, league: string, contents: string) => ipcRenderer.invoke('ninja-cache-save', game, league, contents),
  updateHostConfig: (cfg: HostConfigForMain) => ipcRenderer.invoke('host-config', cfg),
  onItemText: (cb: (e: ItemTextEvent) => void) => subscribe('item-text', cb),
  onFocusChange: (cb: (e: FocusChangeEvent) => void) => subscribe('focus-change', cb),
  onHideWidget: (cb: () => void) => subscribe('hide-exclusive-widget', () => cb()),
  onSwitchGame: (cb: (game: GameId) => void) => subscribe('switch-game', cb),
  onOpenSettings: (cb: (e: { tab: SettingsTabId | LegacySettingsTabId }) => void) => subscribe('open-settings', cb),
  trackArea: (opts: TrackAreaOpts) => { ipcRenderer.send('track-area', opts) },
  focusGame: () => { ipcRenderer.send('focus-game') },
  usedRecently: (isOverlay: boolean) => { ipcRenderer.send('used-recently', isOverlay) },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openCaptcha: (url: string) => ipcRenderer.invoke('open-captcha', url),
  hideWindow: () => ipcRenderer.invoke('window-hide'),
  resizeWindow: (width: number, height: number) => ipcRenderer.invoke('window-resize', width, height),
  appQuit: () => ipcRenderer.invoke('app-quit'),
  // 第五輪 30.5:硬體加速(啟動時套用的值 / 寫設定後重新啟動)
  hwAccelActive: () => ipcRenderer.invoke('hw-accel-active'),
  appRelaunch: (contents: string) => ipcRenderer.invoke('app-relaunch', contents),
  getUpdaterInfo: () => ipcRenderer.invoke('updater-info'),
  checkForUpdate: () => ipcRenderer.invoke('updater-check'),
  downloadUpdate: () => ipcRenderer.invoke('updater-download'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  onUpdaterState: (cb: (info: UpdaterInfo) => void) => subscribe('updater-state', cb),
  // 第 34 步:更新提醒「略過此版本」→ renderer 寫設定
  onUpdateReminderSkip: (cb: (version: string) => void) => subscribe<string>('update-reminder-skip', cb),
  // 自己(Electron 視窗)存的設定也會被廣播回來,這裡略過;只轉交預覽分頁存的
  onConfigChanged: (cb: (e: ConfigChangedEvent) => void) => subscribe<ConfigChangedEvent>('config-changed', (e) => {
    if (e?.source !== 'electron') cb(e)
  }),
  openPreview: () => ipcRenderer.invoke('preview-open'),
  getPreviewUrl: () => ipcRenderer.invoke('preview-url'),
  listFonts: () => ipcRenderer.invoke('list-fonts'),
  // 自訂背景圖(檔案對話框選圖 → 複製到 userData/backgrounds)
  bgPick: () => ipcRenderer.invoke('bg-pick'),
  // 懸浮選單速查表(檔案對話框選圖 → 複製到 userData/cheatsheets)
  sheetPick: () => ipcRenderer.invoke('sheet-pick'),
  // 靈魂之井揭露面板(褻瀆)自動辨識
  onRevealScanResult: (cb: (e: RevealScanEvent) => void) => subscribe('reveal-scan-result', cb),
  revealStats: () => ipcRenderer.invoke('reveal-stats'),
  ocrRevealAvailable: () => ipcRenderer.invoke('ocr-available'),
  // WP-S2:在遊戲畫面上框選 OCR 區域
  overlayActivate: () => ipcRenderer.invoke('overlay-activate'),
  ocrRevealNow: () => ipcRenderer.invoke('ocr-reveal-now'),
  // 2026-10-01:符文塑形的框選熱鍵帶 { target: 'runeshape' };揭露面板不帶(= undefined)
  onOcrRegionPick: (cb: (target?: OcrRegionPickTarget) => void) => subscribe<{ target?: OcrRegionPickTarget } | undefined>('ocr-region-pick', (e) => { cb(e?.target === 'runeshape' ? 'runeshape' : undefined) }),
  // WP-R2:符文塑形面板自動查價
  onRuneshapeScanResult: (cb: (e: RuneshapeScanEvent) => void) => subscribe('runeshape-scan-result', cb),
  runeshapeUiState: (s: RuneshapeUiState) => { ipcRenderer.send('runeshape-ui-state', s) },
  // 第五輪 30.4:overlay 上有沒有東西要畫(main 閒置隱藏 overlay 視窗)
  overlayContent: (s: OverlayContentState) => { ipcRenderer.send('overlay-content', s) },
  // 第 33 步:正則書籤快捷存取(複製 + 貼進遊戲、快速面板熱鍵、書籤個別熱鍵);預覽端都沒有
  regexPaste: (req: RegexPasteRequest) => ipcRenderer.invoke('regex-paste', req),
  onRegexQuickOpen: (cb: () => void) => subscribe('regex-quick-open', () => { cb() }),
  onRegexBookmarkRun: (cb: (e: RegexBookmarkRunEvent) => void) => subscribe('regex-bookmark-run', cb),
  // 一鍵從 PobTools 送正則分享碼(main/src/regex-share.ts);預覽端都沒有
  regexShareTake: () => ipcRenderer.invoke('regex-share-take'),
  onRegexShare: (cb: (req: RegexShareRequest) => void) => subscribe('regex-share', cb),
  runeshapeStats: () => ipcRenderer.invoke('runeshape-stats'),
  // 第 18 步:畫在遊戲上的徽章 / 提示外框(main 擷取後遮掉)
  scanMask: (r: ScanMaskReport) => { ipcRenderer.send('scan-mask', r) },
  // 第 28 步:設定 › 記錄
  getLog: (sinceSeq?: number) => ipcRenderer.invoke('log-get', sinceSeq),
  logSubscribe: (on: boolean) => { ipcRenderer.send('log-subscribe', on) },
  onLogLines: (cb: (entries: LogEntry[]) => void) => subscribe('log-lines', cb),
  openLogFolder: () => ipcRenderer.invoke('log-open-folder'),
  // 步 38:設定 › 關於 › 開啟設定資料夾(userData;只有 Electron 視窗)
  openConfigFolder: () => ipcRenderer.invoke('config-open-folder'),
  // 第 29 步:設定 › 記錄 › 效能(只有 Electron 視窗)
  perfGet: () => ipcRenderer.invoke('perf-get'),
  perfSet: (on: boolean) => ipcRenderer.invoke('perf-set', on),
  perfOpenFile: () => ipcRenderer.invoke('perf-open-file')
}

contextBridge.exposeInMainWorld('host', api)
