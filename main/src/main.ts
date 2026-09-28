import { app, BrowserWindow, Menu, nativeImage, net, protocol, screen, shell, Tray, type BrowserWindowConstructorOptions } from 'electron'
import { uIOhook } from 'uiohook-napi'
import { OVERLAY_WINDOW_OPTS } from 'electron-overlay-window'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { format } from 'node:util'
import type { ConfigChangedEvent, GameId, HostConfigForMain, HostFetchInit, HotkeyRegistration, ItemTextEvent, SettingsTabId, TrackAreaOpts, WindowMode } from '@ipc/types'
import { hostFetch, installCookiePatch } from './http'
import { Shortcuts, normalizeHotkey } from './Shortcuts'
import { GameWindow } from './windowing/GameWindow'
import { GameDetector } from './windowing/GameDetector'
import { OverlayWindow, type SendToRenderer } from './windowing/OverlayWindow'
import { OverlayVisibility } from './windowing/OverlayVisibility'
import { WidgetAreaTracker } from './windowing/WidgetAreaTracker'
import { AppUpdater } from './AppUpdater'
import { trayStrings, type TrayLang } from './tray-strings'
import { Broadcaster, previewHandlers, registerIpc, type HandlerCtx, type HandlerTable } from './host-handlers'
import { startPreviewServer, type PreviewServer } from './preview-server'

// `--ppz-log-file=<path>`:main 的 console 另外附加寫到檔案(驗證自我重新啟動用;relaunch 會沿用同一組參數,
// 新行程的 stdout 不一定接得回原終端機)。不用 `--log-file`,那是 Chromium 自己的開關。
const LOG_FILE = process.argv.find(a => a.startsWith('--ppz-log-file='))?.slice('--ppz-log-file='.length)
if (LOG_FILE) {
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      orig(...args)
      try { fsSync.appendFileSync(LOG_FILE, `${new Date().toISOString()} [pid ${process.pid}] ${format(...args)}\n`) } catch {}
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  console.log('[main] 已有另一個 ExileAppraiser 在執行,結束')
  app.exit()
}
app.disableHardwareAcceleration()

// 正式版不用 file://(sandbox 下 fetch / 動態 import 對 file: 一律失敗),改註冊 app:// 供應 renderer/dist。
const APP_SCHEME = 'app'
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}])

function installAppProtocol () {
  const root = __dirname
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const file = path.normalize(path.join(root, rel))
    if (!file.startsWith(root)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json')
const DEFAULT_SIZE = { width: 480, height: 720 }

/**
 * 改名搬移:本專案原名 poe-price-zh(開發與打包的 userData 都是 `%APPDATA%\poe-price-zh`)。
 * 新 userData 還沒有 config.json、舊位置有 → 複製過來,使用者不必重設。
 * 只在 userData 是預設位置時做(`--user-data-dir` 指定的乾淨環境不動)。舊檔保留不刪。
 */
const LEGACY_APP_DIR = 'poe-price-zh'
function migrateLegacyConfig () {
  try {
    const userData = path.resolve(app.getPath('userData'))
    const appData = app.getPath('appData')
    if (userData !== path.resolve(appData, app.getName())) return
    const target = CONFIG_PATH()
    const legacy = path.join(appData, LEGACY_APP_DIR, 'config.json')
    if (path.resolve(legacy) === path.resolve(target)) return
    if (fsSync.existsSync(target) || !fsSync.existsSync(legacy)) return
    fsSync.mkdirSync(path.dirname(target), { recursive: true })
    fsSync.copyFileSync(legacy, target)
    console.log(`[main] 已從舊版設定搬移 ${legacy} → ${target}`)
  } catch (err) {
    console.warn('[main] 舊版設定搬移失敗', err)
  }
}
migrateLegacyConfig()

let win: BrowserWindow | null = null
let captchaWin: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

/**
 * 視窗模式在建立視窗前就要決定(overlay 是透明無框、疊在遊戲上;window 是一般小視窗),
 * 所以 main 自己讀一次設定檔的 `overlayMode`。`--window` 參數優先。設定變更時 main 自動重新啟動。
 */
const FORCED_WINDOW_MODE: WindowMode | null = process.argv.includes('--window')
  ? 'window'
  : process.argv.includes('--overlay') ? 'overlay' : null

function resolveWindowMode (): WindowMode {
  if (FORCED_WINDOW_MODE) return FORCED_WINDOW_MODE
  try {
    const cfg = JSON.parse(fsSync.readFileSync(CONFIG_PATH(), 'utf8')) as { overlayMode?: boolean }
    if (cfg.overlayMode === false) return 'window'
  } catch {}
  return 'overlay'
}

const DEFAULT_WINDOW_TITLE: Record<GameId, string> = { poe1: 'Path of Exile', poe2: 'Path of Exile 2' }

function windowTitleFor (cfg: HostConfigForMain, game: GameId): string {
  return cfg.windowTitleBy?.[game]?.trim() || DEFAULT_WINDOW_TITLE[game]
}

/**
 * 只改 config.json 的 `game` 欄位,其餘原封不動(JSON.parse/stringify 保留鍵順序;縮排同 renderer `serialize()`)。
 * overlay 模式換遊戲要重新啟動,renderer 可能來不及存檔,所以 main 自己寫。
 */
function writeGameToConfig (game: GameId) {
  let obj: Record<string, unknown> = {}
  try { obj = JSON.parse(fsSync.readFileSync(CONFIG_PATH(), 'utf8')) as Record<string, unknown> } catch {}
  if (obj.game === game) return
  obj.game = game
  fsSync.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true })
  fsSync.writeFileSync(CONFIG_PATH(), JSON.stringify(obj, null, 2))
  console.log(`[main] config.json game → ${game}`)
}

/**
 * 自我重新啟動(overlay 只能 attach 一次,換遊戲/換標題/換視窗模式都走這裡;見 docs/game-auto-switch.md)。
 * `app.exit` 不發 will-quit,所以 uiohook 在這裡停;先放單一實例鎖,新行程才不會被舊行程擋掉。
 */
function relaunchSelf (reason: string) {
  console.log(`[main] 重新啟動(${reason}),relaunch args=${JSON.stringify(process.argv.slice(1))}`)
  quitting = true
  try { uIOhook.stop() } catch {}
  app.releaseSingleInstanceLock()
  app.relaunch({ args: process.argv.slice(1) })
  app.exit(0)
}

const WEB_PREFERENCES = ():BrowserWindowConstructorOptions['webPreferences'] => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: false
})

function createWindow (mode: WindowMode): BrowserWindow {
  const w = mode === 'overlay'
    ? new BrowserWindow({
      icon: iconPath(),
      ...OVERLAY_WINDOW_OPTS,
      width: 800,
      height: 600,
      title: 'ExileAppraiser',
      webPreferences: WEB_PREFERENCES()
    })
    : new BrowserWindow({
      ...DEFAULT_SIZE,
      minWidth: 380,
      minHeight: 300,
      show: false,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      backgroundColor: '#1a202c',
      title: 'ExileAppraiser',
      icon: iconPath(),
      webPreferences: WEB_PREFERENCES()
    })
  if (mode === 'overlay') {
    // 無框視窗沒有選單列,但保留 editMenu 讓輸入框的複製/貼上快捷鍵可用(同 APT)
    w.setMenu(Menu.buildFromTemplate([
      { role: 'editMenu' },
      { role: 'reload' },
      { role: 'toggleDevTools' }
    ]))
  } else {
    w.setMenuBarVisibility(false)
  }
  w.on('close', (e) => {
    if (!quitting) { e.preventDefault(); w.hide() }
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // renderer 的 console 轉印到 main log(沒有 DevTools 時驗證用)
  w.webContents.on('console-message', (...args: unknown[]) => {
    const details = args[0] as { message?: string } | undefined
    const message = details?.message ?? (args[2] as string | undefined)
    if (message) console.log(`[renderer] ${message}`)
  })
  if (DEV_URL) {
    loadDevUrlWithRetry(w, DEV_URL)
  } else {
    void w.loadURL(`${APP_SCHEME}://app/index.html`)
  }
  return w
}

/**
 * 開發模式:build/script.mjs 在 esbuild 第一次 build 完就 spawn Electron,Vite(5173)可能還沒起來
 * → ERR_CONNECTION_REFUSED 且不會自己重試,視窗永遠空白。這裡每 1 秒重試,最多 60 次。正式模式不重試。
 */
function loadDevUrlWithRetry (w: BrowserWindow, url: string) {
  const MAX_RETRIES = 60
  let attempts = 0
  let pending: NodeJS.Timeout | null = null

  const scheduleRetry = (reason: string) => {
    if (pending || w.isDestroyed()) return
    if (attempts >= MAX_RETRIES) {
      console.error(`[dev] 載入 ${url} 失敗(${reason}),已重試 ${MAX_RETRIES} 次,放棄`)
      return
    }
    attempts++
    console.warn(`[dev] 載入 ${url} 失敗(${reason}),1 秒後重試 (${attempts}/${MAX_RETRIES})`)
    pending = setTimeout(() => {
      pending = null
      if (!w.isDestroyed()) void w.loadURL(url).catch(() => { /* did-fail-load 會處理 */ })
    }, 1000)
  }

  w.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED(導航被新導航取代),不是真的失敗
    if (!isMainFrame || errorCode === -3) return
    scheduleRetry(`${errorDescription} ${errorCode} ${validatedURL}`)
  })
  w.webContents.on('did-finish-load', () => {
    if (attempts > 0 && !pending) console.log(`[dev] 載入 ${w.webContents.getURL()} 完成(第 ${attempts} 次重試)`)
  })
  w.loadURL(url).catch((e: Error) => scheduleRetry(e.message))
}

/** renderer/public 的圖示檔(由 `npm run build-icons` 從 brand/*.svg 產生);prod 由 Vite 複製進 renderer/dist → app 根目錄。 */
function iconPath (file = 'icon.png'): string {
  return DEV_URL
    ? path.join(__dirname, '../../renderer/public', file)
    : path.join(__dirname, file)
}

/** 備援視窗模式:把視窗放到游標旁邊,不超出該螢幕的工作區。 */
function showNear (position: { x: number, y: number }) {
  if (!win) return
  const display = screen.getDisplayNearestPoint(position)
  const area = display.workArea
  const [w, h] = win.getSize()
  const x = Math.min(Math.max(position.x + 16, area.x), area.x + area.width - w)
  const y = Math.min(Math.max(position.y - Math.round(h / 2), area.y), area.y + area.height - h)
  win.setPosition(x, y)
  win.show()
}

interface TrayActions {
  show: () => void
  openSettings: (tab: SettingsTabId) => void
  openInBrowser: () => void
  checkUpdate: () => void
}

/**
 * 啟動時(renderer 還沒送 host-config)托盤先用設定檔的 `uiLanguage`(沒有就 `language`,再沒有就系統語系)。
 * 收到 host-config 後依 `cfg.uiLanguage` 重建(`rebuildTrayMenu`)。
 */
function initialTrayLang (): TrayLang {
  try {
    const cfg = JSON.parse(fsSync.readFileSync(CONFIG_PATH(), 'utf8')) as { uiLanguage?: string, language?: string }
    const v = cfg.uiLanguage ?? cfg.language
    if (v === 'en' || v === 'cmn-Hant') return v
  } catch {}
  return /^zh/i.test(app.getLocale()) ? 'cmn-Hant' : 'en'
}

let trayLang: TrayLang | null = null
let trayActions: TrayActions | null = null

function rebuildTrayMenu (lang: TrayLang) {
  if (!tray || !trayActions || lang === trayLang) return
  const s = trayStrings(lang)
  const a = trayActions
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: s.show, click: a.show },
    { label: s.settings, click: () => { a.openSettings('general') } },
    { label: s.openInBrowser, click: a.openInBrowser },
    { label: s.checkUpdate, click: a.checkUpdate },
    { label: s.openConfigFolder, click: () => { void shell.openPath(app.getPath('userData')) } },
    { label: s.about, click: () => { a.openSettings('about') } },
    { type: 'separator' },
    { label: s.quit, click: () => { quitting = true; app.quit() } }
  ]))
  const prev = trayLang
  trayLang = lang
  console.log(`[tray] ${prev ? 'rebuilt' : 'built'} lang=${lang}`)
}

function createTray (actions: TrayActions) {
  // 托盤用專門畫的單色小圖(不縮大圖):縮放 ≥150% 用 32px 版
  const trayFile = screen.getPrimaryDisplay().scaleFactor >= 1.5 ? 'tray-32.png' : 'tray-16.png'
  const image = nativeImage.createFromPath(iconPath(trayFile))
  if (image.isEmpty()) console.error(`[tray] 圖示載入失敗:${iconPath(trayFile)}`)
  tray = new Tray(image)
  tray.setToolTip(`ExileAppraiser ${app.getVersion()}`)
  trayActions = actions
  rebuildTrayMenu(initialTrayLang())
  tray.on('double-click', actions.show)
}

/** 瀏覽器預覽(WP-P,docs/browser-preview.md):`--preview` 啟動即開伺服器並印網址;托盤 / 設定「一般」分頁可隨時開。 */
const PREVIEW_ON_START = process.argv.includes('--preview')
let preview: PreviewServer | null = null

/**
 * 預覽的靜態檔根目錄 = `app://` 的根目錄(打包後 app 根目錄 = renderer/dist 的內容)。
 * 開發模式(Vite 5173)不代理 Vite:Vite 的模組路徑是絕對路徑(`/src/…`、`/@vite/client`),放不進 `/t/<token>/` 前綴,
 * 所以開發模式一律供應**已 build 的** `renderer/dist`(先 `npm run build --workspace renderer`)。
 */
function previewStaticRoot (): string {
  return DEV_URL ? path.resolve(__dirname, '../../renderer/dist') : __dirname
}

app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => {
  try { uIOhook.stop() } catch {}
  if (preview && !preview.closed) void preview.close('app quit')
})

app.whenReady().then(() => {
  installCookiePatch()
  if (!DEV_URL) installAppProtocol()

  const windowMode = resolveWindowMode()
  console.log(`[main] 視窗模式 ${windowMode}${process.argv.includes('--window') ? '(--window)' : ''} pid=${process.pid} config=${CONFIG_PATH()}`)
  const w = win = createWindow(windowMode)
  // 事件一律經 Broadcaster:送 webContents,放行清單內的(config-changed / updater-state / switch-game)也送預覽分頁
  const broadcaster = new Broadcaster(() => w.isDestroyed() ? null : w.webContents)
  const send: SendToRenderer = broadcaster.broadcast

  let overlay: OverlayWindow | undefined
  let poeWindow: GameWindow | undefined
  let areaTracker: WidgetAreaTracker | undefined
  if (windowMode === 'overlay') {
    poeWindow = new GameWindow()
    overlay = new OverlayWindow(w, send, poeWindow)
    new OverlayVisibility(send, overlay) // eslint-disable-line no-new
    areaTracker = new WidgetAreaTracker(send, overlay)
  }

  const shortcuts = new Shortcuts({
    mode: windowMode,
    overlay,
    poeWindow,
    areaTracker,
    onItem: (e: ItemTextEvent) => {
      send('item-text', e)
      if (windowMode === 'window') showNear(e.position)
    }
  })
  try { uIOhook.start() } catch (e) { console.error('[uiohook] start failed', e) }

  const showApp = () => {
    if (overlay) {
      overlay.assertOverlayActive()
    } else {
      win?.show(); win?.focus()
    }
  }
  // 自動更新:狀態推給 renderer;第一次收到 host-config(renderer 已就緒)時才檢查
  const updater = new AppUpdater((info) => { send('updater-state', info) })
  /** 托盤「設定」「關於」:先把視窗叫到前景,再請 renderer 開設定到該分頁。 */
  const openSettings = (tab: SettingsTabId) => {
    showApp()
    console.log(`[tray] open-settings tab=${tab}`)
    send('open-settings', { tab })
  }

  // ---- 瀏覽器預覽伺服器(啟動或沿用;閒置自動關閉後可再開) ----
  let previewStarting: Promise<PreviewServer> | null = null
  const ensurePreview = async (): Promise<PreviewServer> => {
    if (preview && !preview.closed) return preview
    if (previewStarting) return await previewStarting
    const root = previewStaticRoot()
    if (!fsSync.existsSync(path.join(root, 'index.html'))) {
      console.error(`[preview] 找不到 ${path.join(root, 'index.html')}${DEV_URL ? '(開發模式請先 npm run build --workspace renderer)' : ''}`)
    }
    previewStarting = startPreviewServer({
      staticRoot: root,
      handlers: previewHandlers(table),
      version: app.getVersion(),
      log: (m) => { console.log(m) },
      onClose: () => { broadcaster.setPreviewSink(null) }
    }).then((srv) => {
      preview = srv
      broadcaster.setPreviewSink(srv.push)
      return srv
    }).finally(() => { previewStarting = null })
    return await previewStarting
  }
  const openPreviewInBrowser = async (): Promise<{ url: string }> => {
    const srv = await ensurePreview()
    console.log(`[preview] 以預設瀏覽器開啟 ${srv.url}`)
    await shell.openExternal(srv.url)
    return { url: srv.url }
  }

  createTray({
    show: showApp,
    openSettings,
    openInBrowser: () => { openPreviewInBrowser().catch((e) => { console.error('[preview] 開啟失敗', e) }) },
    checkUpdate: () => { void updater.check() }
  })
  app.on('second-instance', showApp)

  // Poe Regex 面板狀態(勾選 + 書籤)。原子寫入:先寫 .tmp 再 rename(Windows 上 libuv 用 MoveFileEx REPLACE_EXISTING);
  // 存檔依序排隊,兩次連續存檔不會同時寫同一個 .tmp。
  const REGEX_STATE_PATH = () => path.join(app.getPath('userData'), 'regex_state.json')
  let regexSaveChain: Promise<void> = Promise.resolve()
  // 拆粉排行面板狀態(core/src/dust/ui-state.ts 的 JSON:選項 + 按聯盟的標記/隱藏):userData/dust_ui.json。
  // 原子寫入同 regex_state(.tmp → rename,依序排隊;失敗時刪掉 .tmp)。
  const DUST_UI_PATH = () => path.join(app.getPath('userData'), 'dust_ui.json')
  let dustSaveChain: Promise<void> = Promise.resolve()
  // poe.ninja 價格表快取(core/src/ninja/cache.ts 的快照 JSON):userData/cache/ninja/<game>_<league>.json。
  // 原子寫入(每次寫各自的 .tmp 再 rename,依序排隊);啟動時清掉 30 天以上沒動過的檔(同 PobTools PruneNinjaCache)。
  const NINJA_DIR = () => path.join(app.getPath('userData'), 'cache', 'ninja')
  const ninjaFile = (game: unknown, league: unknown) => {
    if (game !== 'poe1' && game !== 'poe2') throw new Error(`bad game: ${String(game)}`)
    const safe = String(league ?? '').replace(/[^A-Za-z0-9_-]/g, '_') || 'league'
    return path.join(NINJA_DIR(), `${game}_${safe}.json`)
  }
  void (async () => {
    try {
      const dir = NINJA_DIR()
      const cutoff = Date.now() - 30 * 86400 * 1000
      for (const name of await fs.readdir(dir)) {
        if (!/^poe[12]_.*[.]json([.]tmp.*)?$/.test(name)) continue
        const file = path.join(dir, name)
        const st = await fs.stat(file)
        if (st.isFile() && st.mtimeMs < cutoff) await fs.rm(file, { force: true })
      }
    } catch {}
  })()
  let ninjaSaveChain: Promise<void> = Promise.resolve()

  // ---- PoE1 / PoE2 切換 ----
  // overlay:第一次 host-config 決定綁哪款遊戲(attachByTitle 一次);之後 game / 該遊戲標題 / overlayMode 變了 → 重新啟動。
  // window:沒有綁定,game 跟著 renderer 走,不重啟。
  // 瀏覽器預覽送來的 host-config 一律不重新啟動(只回 needsRestart);Electron 視窗隨後套用同一份設定時也不重啟(`deferredByPreview`)。
  let hostCfg: HostConfigForMain | null = null
  /** 只由 Electron 視窗的 host-config 更新(overlayMode 變更判斷用;預覽端的不算)。 */
  let electronCfg: HostConfigForMain | null = null
  let bound: { game: GameId, title: string } | null = null
  let relaunching = false
  /** 預覽端改了需要重新啟動的欄位:記下那組值,Electron 視窗跟著套用時不重啟。 */
  let deferredByPreview: { game: GameId, title: string, overlayMode: boolean } | null = null
  const scheduleRelaunch = (reason: string, game?: GameId) => {
    if (relaunching) return
    relaunching = true
    detector.stop()
    // 等 renderer 的設定存檔(debounce 300 ms)落地,再寫 game、重新啟動
    setTimeout(() => {
      if (game) writeGameToConfig(game)
      relaunchSelf(reason)
    }, 500)
  }
  const detector = new GameDetector({
    currentGame: () => bound?.game ?? hostCfg?.game ?? 'poe1',
    windowTitleBy: () => ({
      poe1: hostCfg ? windowTitleFor(hostCfg, 'poe1') : DEFAULT_WINDOW_TITLE.poe1,
      poe2: hostCfg ? windowTitleFor(hostCfg, 'poe2') : DEFAULT_WINDOW_TITLE.poe2
    }),
    onSwitch: (game) => {
      if (overlay) {
        scheduleRelaunch(`自動偵測:${bound?.game}→${game}`, game)
      } else {
        writeGameToConfig(game)
        if (hostCfg) hostCfg = { ...hostCfg, game }
        console.log(`[main] window 模式:通知 renderer 切換到 ${game}(不重新啟動)`)
        send('switch-game', game)
        detector.rearm()
      }
    }
  })

  /** 這份設定需要重新啟動的原因(沒有回 null)。`prevOverlayMode` = 比較基準的 overlayMode(undefined = 不比)。 */
  const relaunchReason = (cfg: HostConfigForMain, prevOverlayMode: boolean | undefined): string | null => {
    if (!FORCED_WINDOW_MODE && prevOverlayMode !== undefined && prevOverlayMode !== cfg.overlayMode) {
      return `overlayMode ${prevOverlayMode}→${cfg.overlayMode}`
    }
    if (overlay && bound) {
      const title = windowTitleFor(cfg, cfg.game)
      if (cfg.game !== bound.game) return `手動切換遊戲 ${bound.game}→${cfg.game}`
      if (title !== bound.title) return `${cfg.game} 視窗標題 "${bound.title}"→"${title}"`
    }
    return null
  }
  const sameAsDeferred = (cfg: HostConfigForMain) => deferredByPreview != null &&
    deferredByPreview.game === cfg.game && deferredByPreview.overlayMode === cfg.overlayMode &&
    deferredByPreview.title === windowTitleFor(cfg, cfg.game)
  const applyDetector = (cfg: HostConfigForMain) => {
    if (cfg.autoSwitchGame) detector.start()
    else detector.stop()
  }

  const onHostConfig = (ctx: HandlerCtx, cfg: HostConfigForMain): HotkeyRegistration => {
    const result = shortcuts.updateActions(cfg)
    hostCfg = cfg
    if (cfg.uiLanguage === 'en' || cfg.uiLanguage === 'cmn-Hant') rebuildTrayMenu(cfg.uiLanguage)
    updater.checkAtStartup()
    if (relaunching) return result

    if (ctx.source === 'preview') {
      // 預覽端:與目前實際的視窗模式 / overlay 綁定比較;不同只記下,不重新啟動
      const reason = relaunchReason(cfg, windowMode === 'overlay')
      if (reason) {
        deferredByPreview = { game: cfg.game, title: windowTitleFor(cfg, cfg.game), overlayMode: cfg.overlayMode }
        console.log(`[main] 預覽端設定需要重新啟動才生效(${reason});只存檔,不重新啟動`)
        return { ...result, needsRestart: true }
      }
      applyDetector(cfg)
      return result
    }

    const prev = electronCfg
    electronCfg = cfg
    const reason = relaunchReason(cfg, prev?.overlayMode)
    if (reason) {
      if (sameAsDeferred(cfg)) {
        console.log(`[main] ${reason}:來自瀏覽器預覽的變更,下次啟動才生效(不重新啟動)`)
        applyDetector(cfg)
        return { ...result, needsRestart: true }
      }
      deferredByPreview = null
      scheduleRelaunch(reason, reason.startsWith('手動切換遊戲') ? cfg.game : undefined)
      return result
    }
    if (overlay) {
      const title = windowTitleFor(cfg, cfg.game)
      if (!bound) {
        bound = { game: cfg.game, title }
        overlay.updateOpts(normalizeHotkey(cfg.overlayKey), title, cfg.game)
      } else {
        overlay.setOverlayKey(normalizeHotkey(cfg.overlayKey))
      }
    }
    applyDetector(cfg)
    return result
  }

  // ---- 所有 IPC handler 的登錄表(ipcMain 與瀏覽器預覽共用;見 host-handlers.ts) ----
  const table: HandlerTable = {
    'app-version': { kind: 'sync', fn: () => app.getVersion() },
    'window-mode': { kind: 'sync', fn: () => windowMode },
    'focus-game': { kind: 'send', fn: () => { overlay?.assertGameActive() } },
    'used-recently': { kind: 'send', fn: (_ctx, isOverlay: boolean) => { if (overlay) overlay.wasUsedRecently = isOverlay } },
    'track-area': { kind: 'send', fn: (_ctx, opts: TrackAreaOpts) => { areaTracker?.track(opts) } },
    'http-fetch': { kind: 'invoke', fn: (_ctx, url: string, init?: HostFetchInit) => hostFetch(url, init) },
    'config-load': {
      kind: 'invoke',
      fn: async () => {
        try { return await fs.readFile(CONFIG_PATH(), 'utf8') } catch { return null }
      }
    },
    'config-save': {
      kind: 'invoke',
      fn: async (ctx, contents: string) => {
        if (typeof contents !== 'string') throw new Error('config-save: contents 不是字串')
        await fs.mkdir(path.dirname(CONFIG_PATH()), { recursive: true })
        await fs.writeFile(CONFIG_PATH(), contents)
        const ev: ConfigChangedEvent = { contents, source: ctx.source === 'preview' ? `preview:${ctx.clientId ?? ''}` : 'electron' }
        console.log(`[main] config-save from ${ev.source}(${contents.length} 字元)→ broadcast config-changed`)
        send('config-changed', ev)
      }
    },
    'regex-state-load': {
      kind: 'invoke',
      fn: async () => {
        try { return await fs.readFile(REGEX_STATE_PATH(), 'utf8') } catch { return null }
      }
    },
    'regex-state-save': {
      kind: 'invoke',
      fn: (_ctx, contents: string) => {
        const run = async () => {
          const file = REGEX_STATE_PATH()
          const tmp = file + '.tmp'
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.writeFile(tmp, contents, 'utf8')
          await fs.rename(tmp, file)
        }
        const next = regexSaveChain.then(run, run)
        regexSaveChain = next.catch(() => {})
        return next
      }
    },
    'dust-ui-load': {
      kind: 'invoke',
      fn: async () => {
        try { return await fs.readFile(DUST_UI_PATH(), 'utf8') } catch { return null }
      }
    },
    'dust-ui-save': {
      kind: 'invoke',
      fn: (_ctx, contents: string) => {
        const run = async () => {
          if (typeof contents !== 'string') throw new Error('dust-ui-save: contents 不是字串')
          const file = DUST_UI_PATH()
          const tmp = file + '.tmp'
          await fs.mkdir(path.dirname(file), { recursive: true })
          try {
            await fs.writeFile(tmp, contents, 'utf8')
            await fs.rename(tmp, file)
          } catch (e) {
            await fs.rm(tmp, { force: true })
            throw e
          }
        }
        const next = dustSaveChain.then(run, run)
        dustSaveChain = next.catch(() => {})
        return next
      }
    },
    'ninja-cache-load': {
      kind: 'invoke',
      fn: async (_ctx, game: string, league: string) => {
        try { return await fs.readFile(ninjaFile(game, league), 'utf8') } catch { return null }
      }
    },
    'ninja-cache-save': {
      kind: 'invoke',
      fn: (_ctx, game: string, league: string, contents: string) => {
        const run = async () => {
          const file = ninjaFile(game, league)
          const tmp = `${file}.tmp${process.pid}`
          await fs.mkdir(path.dirname(file), { recursive: true })
          try {
            await fs.writeFile(tmp, contents, 'utf8')
            await fs.rename(tmp, file)
          } catch (e) {
            await fs.rm(tmp, { force: true })
            throw e
          }
        }
        const next = ninjaSaveChain.then(run, run)
        ninjaSaveChain = next.catch(() => {})
        return next
      }
    },
    'host-config': { kind: 'invoke', fn: onHostConfig },
    'open-external': { kind: 'invoke', fn: (_ctx, url: string) => shell.openExternal(url) },
    'open-captcha': {
      kind: 'invoke',
      // 預覽端也開 Electron 視窗:Cloudflare cookie 要進 Electron session 才對 http-fetch 有用
      fn: (_ctx, url: string) => {
        if (captchaWin && !captchaWin.isDestroyed()) { captchaWin.focus(); void captchaWin.loadURL(url); return }
        captchaWin = new BrowserWindow({ width: 1000, height: 760, title: 'ExileAppraiser — trade site', autoHideMenuBar: true })
        captchaWin.on('closed', () => { captchaWin = null })
        void captchaWin.loadURL(url)
      }
    },
    'window-hide': {
      kind: 'invoke',
      preview: false,
      fn: () => {
        if (overlay) overlay.assertGameActive()
        else win?.hide()
      }
    },
    'window-resize': {
      kind: 'invoke',
      preview: false,
      fn: (_ctx, width: number, height: number) => {
        if (!win || overlay) return
        const [cw, ch] = win.getSize()
        if (Math.abs(cw - width) > 2 || Math.abs(ch - height) > 2) win.setSize(Math.round(width), Math.round(height))
      }
    },
    'preview-open': { kind: 'invoke', fn: () => openPreviewInBrowser() },
    'preview-url': { kind: 'invoke', fn: () => preview && !preview.closed ? preview.url : null },
    ...updater.handlers()
  }
  registerIpc(table)

  if (PREVIEW_ON_START) {
    ensurePreview()
      .then((srv) => { console.log(`[preview] --preview:${srv.url}`) })
      .catch((e) => { console.error('[preview] 啟動失敗', e) })
  }

  // 備援視窗模式的開發版直接顯示視窗方便看;正式版等熱鍵或托盤。overlay 由 OverlayController 控制顯示。
  if (DEV_URL && windowMode === 'window') win.show()
})
