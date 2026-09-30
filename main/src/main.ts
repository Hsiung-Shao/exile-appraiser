import { app, BrowserWindow, dialog, Menu, nativeImage, net, protocol, screen, shell, Tray, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import { uIOhook } from 'uiohook-napi'
import { OVERLAY_WINDOW_OPTS } from 'electron-overlay-window'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { format } from 'node:util'
import type { ConfigChangedEvent, GameId, HostConfigForMain, HostFetchInit, HotkeyRegistration, ItemTextEvent, RuneshapeUiState, SettingsTabId, TrackAreaOpts, WindowMode } from '@ipc/types'
import { hostFetch, installCookiePatch } from './http'
import { Shortcuts, normalizeHotkey } from './Shortcuts'
import { GameWindow } from './windowing/GameWindow'
import { GameDetector } from './windowing/GameDetector'
import { OverlayWindow, type SendToRenderer } from './windowing/OverlayWindow'
import { WidgetAreaTracker } from './windowing/WidgetAreaTracker'
import { AppUpdater } from './AppUpdater'
import { trayStrings, type TrayLang } from './tray-strings'
import { Broadcaster, previewHandlers, registerIpc, type HandlerCtx, type HandlerTable } from './host-handlers'
import { startPreviewServer, type PreviewServer } from './preview-server'
import { WinOcr } from './ocr/WinOcr'
import { WIN_OCR_SCRIPT } from './ocr/script'
import { RevealScan } from './ocr/reveal-scan'
import { runOcrSelftest, runRuneshapeSelftest } from './ocr/selftest'
import { loadLocateIndex } from './ocr/locate-data'
import { captureGameClient, toScanCapture } from './ocr/capture'
import { DEFAULT_SCAN_INTERVAL_MS, RuneshapeScan } from './ocr/runeshape-scan'
import { isAppNavigation, isExternalWebUrl } from './external-links'
import { BG_DIR_NAME, bgContentType, bgFileFromPath, normBgFile, resolveBgPath, storedBgName } from './backgrounds'
import {
  TOAST_FADE_MS, TOAST_VISIBLE_MS, isFirstRunAfterUpdate, parseLastRun, priceCheckHotkeyLabel, serializeLastRun,
  shouldShowStartupToast, toastBounds, toastHtml, toastLang, toastMessage, type ToastMessage
} from './startup-toast'

// WP-S:`--ocr-selftest <png>`:無視窗跑 OCR(capture 以外的整條)後結束;不拿單一實例鎖、不建視窗/托盤/熱鍵。
// WP-R2:`--runeshape-selftest <png>`:同上,跑符文塑形掃描管線(變化偵測 + OCR)。
const argAfter = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? '') : null
}
const RUNESHAPE_SELFTEST = argAfter('--runeshape-selftest')
const OCR_SELFTEST = RUNESHAPE_SELFTEST ?? argAfter('--ocr-selftest')
// `--toast-selftest <out.png> [--toast-lang=en] [--toast-updated] [--toast-hotkey=Ctrl + D]`:開出啟動提示視窗、
// `capturePage()` 存 PNG 後結束(不送任何輸入、不拿單一實例鎖、不建主視窗/托盤/熱鍵)。
const TOAST_SELFTEST = argAfter('--toast-selftest')

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

/**
 * `--quit`:請**已在執行的**主行程正常結束(= 托盤「結束」,會觸發「結束時自動套用更新」)。
 * 這個行程拿不到單一實例鎖 → 把參數交給主行程(`second-instance`)後自己結束;拿到鎖 = 沒有主行程,什麼都不做直接結束。
 * `--install-update` 同理,等同關於頁「立即重啟並更新」。
 * 無輸入的控制方式(自動驗證 / 腳本用),見 docs/release-flow.md「本機實測」。
 */
const CONTROL_REQUEST = ['--quit', '--install-update'].find(f => process.argv.includes(f))
let skipStartup = OCR_SELFTEST != null || TOAST_SELFTEST != null

if (OCR_SELFTEST != null) {
  (RUNESHAPE_SELFTEST != null ? runRuneshapeSelftest(RUNESHAPE_SELFTEST, process.argv) : runOcrSelftest(OCR_SELFTEST, process.argv))
    .then((code) => { app.exit(code) })
    .catch((e) => { console.error('[ocr-selftest]', e); app.exit(1) })
} else if (TOAST_SELFTEST != null) {
  app.whenReady()
    .then(() => runToastSelftest(TOAST_SELFTEST))
    .then((code) => { app.exit(code) })
    .catch((e) => { console.error('[toast-selftest]', e); app.exit(1) })
} else if (!app.requestSingleInstanceLock()) {
  console.log(CONTROL_REQUEST ? `[main] ${CONTROL_REQUEST}:已轉交執行中的 ExileAppraiser` : '[main] 已有另一個 ExileAppraiser 在執行,結束')
  skipStartup = true
  app.exit()
} else if (CONTROL_REQUEST) {
  console.log(`[main] ${CONTROL_REQUEST}:沒有執行中的 ExileAppraiser,直接結束`)
  skipStartup = true
  app.exit()
}
app.disableHardwareAcceleration()

// 正式版不用 file://(sandbox 下 fetch / 動態 import 對 file: 一律失敗),改註冊 app:// 供應 renderer/dist。
const APP_SCHEME = 'app'
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}])

/** 自訂背景圖的資料夾(`userData/backgrounds`;backgrounds.ts) */
const BG_DIR = () => path.join(app.getPath('userData'), BG_DIR_NAME)

/**
 * `app://app/…` = renderer/dist(只有正式版;開發模式走 Vite);`app://bg/<檔名>` = 自訂背景圖(兩種模式都有)。
 * 背景檔名經 `resolveBgPath`(只准 png / jpg / webp、不含路徑字元、解析後不跳出 backgrounds 資料夾),其他一律 404。
 */
function installAppProtocol (serveRenderer: boolean) {
  const root = __dirname
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.host === 'bg') {
      const name = bgFileFromPath(url.pathname)
      const file = name == null ? null : resolveBgPath(BG_DIR(), name)
      if (!file) return new Response('not found', { status: 404 })
      return net.fetch(pathToFileURL(file).toString()).then(r => r.ok
        ? new Response(r.body, { status: 200, headers: { 'Content-Type': bgContentType(file), 'Cache-Control': 'no-cache' } })
        : new Response('not found', { status: 404 }))
    }
    if (!serveRenderer) return new Response('not found', { status: 404 })
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const file = path.normalize(path.join(root, rel))
    if (!file.startsWith(root)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL
/** 主視窗自己的頁面(`will-navigate` 放行):正式版 app://app、開發模式 Vite。 */
const APP_ORIGINS = [`${APP_SCHEME}://app`, ...(DEV_URL ? [DEV_URL] : [])]

/**
 * 系統預設瀏覽器開網址(IPC `open-external` = renderer / 預覽的 `Host.openExternal`、各視窗的新視窗 / 導覽攔截共用)。
 * 只准 http(s)(external-links.ts);其他 scheme 記 log 並丟錯,不交給 shell。
 */
function openExternalSafe (url: unknown, source: string): Promise<void> {
  if (!isExternalWebUrl(url)) {
    console.warn(`[main] 拒絕交給系統瀏覽器(${source}):不是 http(s) 網址 ${String(url).slice(0, 120)}`)
    return Promise.reject(new Error('open-external: only http(s) URLs are allowed'))
  }
  console.log(`[main] 系統瀏覽器開啟(${source}):${new URL(url).host}`)
  return shell.openExternal(url)
}

/**
 * 新視窗(`window.open`、`<a target="_blank">`)一律不在 Electron 裡開:deny,http(s) 轉系統瀏覽器。
 * Electron 預設會開一個新的 BrowserWindow —— 那個視窗沒有使用者瀏覽器的登入狀態(交易站要重新登入)。
 */
function denyNewWindows (wc: WebContents, source: string) {
  wc.setWindowOpenHandler(({ url }) => {
    void openExternalSafe(url, source).catch(() => {})
    return { action: 'deny' }
  })
}

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
if (!skipStartup) migrateLegacyConfig()

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
  denyNewWindows(w.webContents, '主視窗新視窗')
  // `<a href>` 沒有 target 時是主視窗自己導覽:不是 app 自己的頁面就攔下(否則整個 UI 被換成外部網站),http(s) 轉系統瀏覽器
  w.webContents.on('will-navigate', (e, url) => {
    if (isAppNavigation(url, APP_ORIGINS)) return
    e.preventDefault()
    void openExternalSafe(url, '主視窗導覽').catch(() => {})
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

// ---- 啟動時「已在背景執行」提示(startup-toast.ts;docs/release-flow.md「啟動提示」) ----

/** `userData/last_run.json`:上次啟動的版本(判斷「更新後第一次啟動」)。 */
const LAST_RUN_PATH = () => path.join(app.getPath('userData'), 'last_run.json')

/** 讀上次啟動的版本、寫入目前版本;回傳這次是不是更新後第一次啟動。失敗一律當成不是(只影響提示文字)。 */
function recordLastRun (): boolean {
  const current = app.getVersion()
  let raw: string | null = null
  try { raw = fsSync.readFileSync(LAST_RUN_PATH(), 'utf8') } catch {}
  const last = parseLastRun(raw)
  const updated = isFirstRunAfterUpdate(last, current)
  if (last !== current) {
    try {
      fsSync.mkdirSync(path.dirname(LAST_RUN_PATH()), { recursive: true })
      fsSync.writeFileSync(LAST_RUN_PATH(), serializeLastRun(current))
    } catch (e) {
      console.warn('[toast] last_run.json 寫入失敗', e)
    }
  }
  console.log(`[toast] lastRunVersion=${last ?? '(none)'} current=${current} updated=${String(updated)}`)
  return updated
}

function iconDataUrl (): string | null {
  try {
    return `data:image/png;base64,${fsSync.readFileSync(iconPath('icon.png')).toString('base64')}`
  } catch {
    return null
  }
}

/**
 * 主螢幕工作區右下角(托盤上方)的提示小視窗:無框、透明、置頂、不進工作列、不可取得焦點(`showInactive`)、點擊穿透。
 * 內容是 data URL(`toastHtml`:內嵌 CSS、無腳本、CSP default-src 'none');`autoClose` = 淡出後銷毀。
 */
function showStartupToast (msg: ToastMessage, opts: { animate?: boolean, autoClose?: boolean } = {}): BrowserWindow {
  const bounds = toastBounds(screen.getPrimaryDisplay().workArea)
  const t = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'ExileAppraiser',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  })
  t.setAlwaysOnTop(true, 'screen-saver')
  t.setIgnoreMouseEvents(true)
  t.setMenu(null)
  denyNewWindows(t.webContents, '啟動提示')
  t.webContents.on('will-navigate', (e) => { e.preventDefault() })
  t.once('ready-to-show', () => {
    if (t.isDestroyed()) return
    t.showInactive()
    if (opts.autoClose !== false) {
      setTimeout(() => { if (!t.isDestroyed()) t.destroy() }, TOAST_VISIBLE_MS + TOAST_FADE_MS + 150)
    }
  })
  void t.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toastHtml(msg, iconDataUrl(), { animate: opts.animate }))}`)
  console.log(`[toast] 顯示啟動提示 ${JSON.stringify(bounds)}:${msg.title} / ${msg.hint}`)
  return t
}

/** `--toast-selftest <out.png>`:開提示視窗(不動畫、不自動關)、截圖存檔後結束。只截自己的 webContents,不送任何輸入。 */
async function runToastSelftest (out: string): Promise<number> {
  if (!out) { console.error('[toast-selftest] 用法:--toast-selftest <out.png> [--toast-lang=en] [--toast-updated] [--toast-hotkey=Ctrl + D]'); return 2 }
  const argValue = (prefix: string) => process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
  const msg = toastMessage({
    lang: toastLang(argValue('--toast-lang=')),
    version: app.getVersion(),
    // 預設 = 設定預設值(按住 Ctrl + D)
    hotkey: argValue('--toast-hotkey=') ?? priceCheckHotkeyLabel('Ctrl', 'D'),
    updated: process.argv.includes('--toast-updated')
  })
  const t = showStartupToast(msg, { animate: false, autoClose: false })
  await new Promise<void>((resolve) => { t.once('show', () => { resolve() }) })
  await new Promise<void>((resolve) => { setTimeout(resolve, 400) })
  const img = await t.webContents.capturePage()
  const size = img.getSize()
  fsSync.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fsSync.writeFileSync(out, img.toPNG())
  console.log(`[toast-selftest] bounds=${JSON.stringify(t.getBounds())} focusable=${String(t.isFocusable())} focused=${String(t.isFocused())} ` +
    `alwaysOnTop=${String(t.isAlwaysOnTop())} capture=${size.width}x${size.height} → ${path.resolve(out)}`)
  t.destroy()
  return size.width > 0 && size.height > 0 ? 0 : 1
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

if (!skipStartup) app.whenReady().then(() => {
  installCookiePatch()
  // 正式版供應 renderer/dist;自訂背景圖 app://bg/ 兩種模式都要
  installAppProtocol(!DEV_URL)

  // 啟動提示:先記下這次是不是更新後第一次啟動(第一次 host-config 時才顯示,那時才有熱鍵與介面語言)
  const startupUpdated = recordLastRun()
  let startupToastShown = false

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
    // 2026-10-01 使用者裁定拿掉 APT 的「按住 Alt 隱藏 overlay」(OverlayVisibility):查價中按 Alt 不再藏介面
    areaTracker = new WidgetAreaTracker(send, overlay)
  }

  // WP-S:OCR 常駐 PowerShell 行程(第一次辨識才啟動,閒置 10 分鐘自動結束);褻瀆與符文塑形兩個掃描共用
  const winOcr = new WinOcr(WIN_OCR_SCRIPT, { idleMs: 10 * 60_000 })
  app.on('will-quit', () => { winOcr.close('app quit') })
  const gameBounds = () => {
    const b = poeWindow?.bounds
    return b && b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null
  }
  const scanEnv = () => ({ overlay: windowMode === 'overlay', gameActive: Boolean(poeWindow?.isActive), bounds: gameBounds() })
  const scanCapture = async (b: { x: number, y: number, width: number, height: number }) => toScanCapture(await captureGameClient(b), () => winOcr)

  // 2026-10-01:褻瀆(靈魂之井揭露面板)自動持續辨識(取代按熱鍵辨識一次;預設開)。
  // 查價面板開著不暫停;與符文塑形共用 WinOcr,對方忙碌就丟 tick。hostCfg 在下方宣告,計時器觸發時已初始化。
  // eslint-disable-next-line prefer-const
  let runeshapeScan: RuneshapeScan
  const revealScan = new RevealScan({
    config: () => ({
      enabled: hostCfg?.revealAutoEnabled !== false,
      game: hostCfg?.game ?? 'poe1',
      region: hostCfg?.ocrRegion ?? null,
      intervalMs: hostCfg?.revealIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS
    }),
    env: scanEnv,
    ocrBusy: () => runeshapeScan.busy,
    capture: scanCapture,
    // 面板定位 / 判定用 tiers.json 的模板 skeleton(第一次掃描才讀)
    locateIndex: () => loadLocateIndex(),
    send: (ev) => { send('reveal-scan-result', ev) }
  })

  // WP-R2:PoE2 符文塑形面板自動查價(掃描迴圈常駐;條件不符時每個 tick 只做判斷,不擷取)。
  runeshapeScan = new RuneshapeScan({
    config: () => ({
      enabled: hostCfg?.runeshapeEnabled === true,
      game: hostCfg?.game ?? 'poe1',
      region: hostCfg?.runeshapeRegion ?? null,
      intervalMs: hostCfg?.runeshapeIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS
    }),
    env: scanEnv,
    ocrBusy: () => revealScan.busy,
    capture: scanCapture,
    send: (ev) => { send('runeshape-scan-result', ev) }
  })
  if (windowMode === 'overlay') {
    // 兩個掃描同時開著時錯開半個間隔,輪流使用 WinOcr
    revealScan.start(0)
    runeshapeScan.start(DEFAULT_SCAN_INTERVAL_MS / 2)
    poeWindow?.on('active-change', () => { revealScan.poke(); runeshapeScan.poke() })
  }
  app.on('will-quit', () => { revealScan.stop(); runeshapeScan.stop() })

  const shortcuts = new Shortcuts({
    mode: windowMode,
    overlay,
    poeWindow,
    areaTracker,
    onItem: (e: ItemTextEvent) => {
      send('item-text', e)
      if (windowMode === 'window') showNear(e.position)
    },
    // 2026-10-01:原本「按一次辨識一次」→ 暫停 / 繼續褻瀆自動辨識
    onOcrReveal: () => { revealScan.toggleUserPause() },
    // WP-S2:框選 OCR 區域熱鍵 → renderer 開框選層(它自己呼叫 overlay-activate 取得焦點);
    // 2026-10-01:符文塑形的框選熱鍵帶 { target: 'runeshape' }(揭露面板不帶,形狀不變)
    onOcrRegionPick: (target) => { if (target === 'runeshape') send('ocr-region-pick', { target }); else send('ocr-region-pick') },
    // WP-R2:符文塑形自動查價暫停 / 繼續
    onRuneshapeToggle: () => { runeshapeScan.toggleUserPause() }
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
      // 自訂背景圖:`<prefix>bg/<檔名>`(同樣要 token)
      bgDir: BG_DIR(),
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
  // 第二個行程帶 `--quit` → 走與托盤「結束」相同的正常結束(exit code 0,會觸發結束時自動套用更新);
  // `--install-update` → 等同關於頁「立即重啟並更新」(只在 downloaded 時有作用);其餘 = 叫出視窗
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) {
      console.log('[main] second-instance --quit:結束程式')
      quitting = true
      app.quit()
      return
    }
    if (argv.includes('--install-update')) {
      console.log(`[main] second-instance --install-update(state=${updater.info.state})`)
      updater.install()
      return
    }
    showApp()
  })

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
    // 開關 / 區域 / 間隔改了 → 立刻重新判斷(停用時即時清徽章;區域改了差分基準的鍵就不同,自然重看)
    revealScan.poke()
    runeshapeScan.poke()
    if (cfg.uiLanguage === 'en' || cfg.uiLanguage === 'cmn-Hant') rebuildTrayMenu(cfg.uiLanguage)
    // 先套用 autoUpdate 再做第一次檢查(舊 renderer / 缺欄位 → 預設開)
    updater.setAutoUpdate(cfg.autoUpdate !== false)
    updater.checkAtStartup()
    // 啟動提示:Electron 視窗第一次送來的設定(renderer 已就緒、熱鍵 / 介面語言已知);預覽端與 `--preview` 啟動不顯示
    if (shouldShowStartupToast({
      enabled: cfg.startupToast,
      controlRequest: false, // 帶控制參數的行程不會走到這裡(上方直接結束)
      selftest: false,
      preview: ctx.source === 'preview' || PREVIEW_ON_START,
      secondInstance: false, // 第二實例沒拿到鎖就結束了;這裡一定是拿到鎖的主行程
      alreadyShown: startupToastShown || relaunching
    })) {
      startupToastShown = true
      showStartupToast(toastMessage({
        lang: toastLang(cfg.uiLanguage),
        version: app.getVersion(),
        hotkey: priceCheckHotkeyLabel(cfg.hotkeyHold, cfg.hotkey),
        updated: startupUpdated
      }))
    } else if (ctx.source !== 'preview') {
      startupToastShown = true // 第一次設定就關著 → 之後打開也不補顯示(只在啟動時)
    }
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
    // 交易站網頁、poe.ninja、關於頁連結、一鍵回報都走這裡(renderer 的 Host.openExternal;拆粉排行的交易 ↗ 經 trade-site.ts 也是)
    'open-external': { kind: 'invoke', fn: (_ctx, url: string) => openExternalSafe(url, 'open-external') },
    'open-captcha': {
      kind: 'invoke',
      // 只給「開啟驗證視窗」(Cloudflare cookie 要進 Electron session 才對 http-fetch 有用;沒有登入狀態)。
      // 預覽端也開 Electron 視窗。一般「看交易站」請用 open-external(renderer 的 trade-site.ts)。
      fn: (_ctx, url: string) => {
        if (!isExternalWebUrl(url)) throw new Error('open-captcha: only http(s) URLs are allowed')
        if (captchaWin && !captchaWin.isDestroyed()) { captchaWin.focus(); void captchaWin.loadURL(url); return }
        captchaWin = new BrowserWindow({ width: 1000, height: 760, title: 'ExileAppraiser — trade site', autoHideMenuBar: true })
        captchaWin.on('closed', () => { captchaWin = null })
        // 驗證視窗裡交易站開的新視窗(物品連結、登入…)也不在 Electron 裡開
        denyNewWindows(captchaWin.webContents, '驗證視窗新視窗')
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
    // 設定視窗「結束程式」= 托盤「結束」;預覽端不開放(瀏覽器分頁不該能關掉程式)
    'app-quit': {
      kind: 'invoke',
      preview: false,
      fn: () => {
        console.log('[app] 設定視窗:結束程式')
        quitting = true
        app.quit()
      }
    },
    // 自訂背景圖:檔案對話框選圖(只列 png / jpg / webp)→ 複製到 userData/backgrounds → 回傳檔名(取消 / 失敗回 null)。
    // 只複製選到的那一個檔;成功後刪掉資料夾裡其他舊的背景圖(只刪合法檔名的檔)。預覽端不開放(對話框在桌面上)
    'bg-pick': {
      kind: 'invoke',
      preview: false,
      fn: async () => {
        const opts = {
          title: 'Background image',
          properties: ['openFile' as const],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
        }
        const res = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        if (res.canceled || !res.filePaths[0]) return null
        const src = res.filePaths[0]
        try {
          const data = await fs.readFile(src)
          const name = storedBgName(src, data)
          if (!name) { console.warn('[bg] 不支援的檔案類型'); return null }
          const dir = BG_DIR()
          await fs.mkdir(dir, { recursive: true })
          const dest = resolveBgPath(dir, name)
          if (!dest) return null
          await fs.writeFile(dest, data)
          for (const f of await fs.readdir(dir)) {
            if (f !== name && normBgFile(f)) await fs.rm(path.join(dir, f), { force: true }).catch(() => {})
          }
          console.log(`[bg] 背景圖 → ${name}(${data.length} bytes)`)
          return name
        } catch (e) {
          console.error('[bg] 複製背景圖失敗', e)
          return null
        }
      }
    },
    'preview-open':{ kind: 'invoke', fn: () => openPreviewInBrowser() },
    'preview-url': { kind: 'invoke', fn: () => preview && !preview.closed ? preview.url : null },
    // WP-S:設定頁顯示 OCR 語言包狀態;預覽端不開放(shim 回 undefined)
    'ocr-available': { kind: 'invoke', preview: false, fn: () => winOcr.available() },
    // WP-S2:框選層開啟時讓 overlay 取得焦點(可點擊);預覽端不開放
    'overlay-activate': { kind: 'invoke', preview: false, fn: () => { overlay?.assertOverlayActive() } },
    // WP-S2:框選確認後請褻瀆自動辨識立刻重看(丟掉差分基準);先確認是 PoE2 overlay 且遊戲視窗還在
    'ocr-reveal-now': {
      kind: 'invoke',
      preview: false,
      fn: () => {
        const b = poeWindow?.bounds
        if (!overlay || hostCfg?.game !== 'poe2' || !b || !(b.width > 0 && b.height > 0)) {
          console.log('[reveal-scan] ocr-reveal-now 略過(不是 PoE2 overlay 或沒有遊戲視窗)')
          return false
        }
        revealScan.rescan()
        return true
      }
    },
    // renderer 回報查價面板 / 設定 / 框選層開著(符文塑形任一 → 暫停;褻瀆只看設定 / 框選層);send 一律不開放給預覽
    'runeshape-ui-state': { kind: 'send', fn: (_ctx, s: RuneshapeUiState) => { runeshapeScan.setUiState(s); revealScan.setUiState(s) } },
    // 設定頁顯示褻瀆自動辨識統計;預覽端不開放
    'reveal-stats': { kind: 'invoke', preview: false, fn: () => revealScan.snapshot() },
    // WP-R2:設定頁顯示掃描統計;預覽端不開放
    'runeshape-stats': { kind: 'invoke', preview: false, fn: () => runeshapeScan.snapshot() },
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
