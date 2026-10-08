// ⚠ 必須是第一個 import:uiohook-napi 被任何模組載入之前,原生模組路徑過長時改從短路徑載入(uiohook-prebuild.ts)
import { uiohookPrebuildResult } from './uiohook-prebuild-init'
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, net, powerMonitor, protocol, screen, shell, Tray, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import { describeStartError, uiohookGate } from './uiohook-gate'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { StashScroll } from './stash-scroll'
import { CtrlWatcher } from './ctrl-watch'
import { OVERLAY_WINDOW_OPTS } from 'electron-overlay-window'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { format } from 'node:util'
import type { ConfigChangedEvent, GameId, HostConfigForMain, HostFetchInit, HotkeyRegistration, ItemTextEvent, PerfState, RegexPasteResult, RuneshapeUiState, SettingsTabId, TrackAreaOpts, WindowMode } from '@ipc/types'
import { abortHostFetch, abortKeyOf, hostFetch, installCookiePatch } from './http'
import { Shortcuts, normalizeHotkey } from './Shortcuts'
import { nextScanPaused } from './shortcut-actions'
import { RegexPaster, regexToastMessage } from './regex-paste'
import { scanConfigKey } from './scan-config'
import { GameWindow } from './windowing/GameWindow'
import { GameDetector, detectorCounters } from './windowing/GameDetector'
import { OverlayWindow, type SendToRenderer } from './windowing/OverlayWindow'
import { WidgetAreaTracker } from './windowing/WidgetAreaTracker'
import { OverlayIdleHider, sanitizeOverlayContent } from './windowing/overlay-idle'
import { hardwareAccelerationFromConfig, isConfigContents, shouldDisableHardwareAcceleration } from './hw-accel'
import { AppUpdater } from './AppUpdater'
import { trayStrings, type TrayLang } from './tray-strings'
import { Broadcaster, previewHandlers, registerIpc, type HandlerCtx, type HandlerTable } from './host-handlers'
import { startPreviewServer, type PreviewServer } from './preview-server'
import { WinOcr } from './ocr/WinOcr'
import { WIN_OCR_SCRIPT } from './ocr/script'
import { RevealScan } from './ocr/reveal-scan'
import { runOcrSelftest, runRuneshapeSelftest } from './ocr/selftest'
import { loadLocateIndex } from './ocr/locate-data'
import { ocrLangFor, textLangFor } from './ocr/ocr-lang'
import { createOverlayClientCapture, displayPhysRect, toScanCapture } from './ocr/capture'
import { captureBenchMode, reminderDevOptions } from './cli-flags'
import {
  RegexShareInbox, RegexShareStartupGate, findRegexShareArg, hasRegexShareArg, regexShareTarget, resolveRegexShareArg, stripRegexShareArgs,
  type RegexShareFs, type RegexShareRequest, type RegexShareTarget
} from './regex-share'
import {
  HoverPausedCountdown, UPDATE_REMINDER_VISIBLE_MS, UpdateReminderScheduler, pointInBounds, reminderBounds, reminderButtonFromUrl, reminderHtml,
  reminderMessage, type ReminderAction, type ReminderButton, type ReminderMessage, type ReminderTarget
} from './update-reminder'
import { DEFAULT_SCAN_INTERVAL_MS, RuneshapeScan } from './ocr/runeshape-scan'
import { SharedCapture, SharedLocateOcr } from './ocr/panel-scan'
import { ScanMaskStore, sanitizeMaskReport } from './ocr/scan-mask'
import { isAppNavigation, isExternalWebUrl } from './external-links'
import { BG_DIR_NAME, SHEET_DIR_NAME, bgContentType, bgCorsHeaders, bgFileFromPath, normBgFile, resolveBgPath, storedBgName } from './backgrounds'
import { createFontLister } from './system-fonts'
import { AppLog, LogFileWriter, captureConsole, consoleMethodForLevel, type LogEntry } from './app-log'
import { PerfMonitor, formatPerfSummary, isPerfFile, perfFileName, scanSnapshotOf, type ScenarioInput } from './perf/perf-monitor'
import {
  TOAST_FADE_MS, TOAST_VISIBLE_MS, isFirstRunAfterUpdate, parseLastRun, priceCheckHotkeyLabel, scanToastMessage, serializeLastRun,
  shouldShowGameAttachToast, shouldShowStartupToast, toastBounds, toastHtml, toastLang, toastMessage, toastWorkArea, type ScanToastKind, type ToastMessage
} from './startup-toast'

// WP-S:`--ocr-selftest <png>`:無視窗跑 OCR(capture 以外的整條)後結束;不拿單一實例鎖、不建視窗/托盤/熱鍵。
// WP-R2:`--runeshape-selftest <png>`:同上,跑符文塑形掃描管線(變化偵測 + OCR)。
const argAfter = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? '') : null
}
const RUNESHAPE_SELFTEST = argAfter('--runeshape-selftest')
const OCR_SELFTEST = RUNESHAPE_SELFTEST ?? argAfter('--ocr-selftest')
// `--toast-selftest <out.png> [--toast-lang=en] [--toast-updated] [--toast-hotkey=Ctrl + D] [--toast-scan=reveal:on,rune:paused]`:開出啟動提示視窗
// (`--toast-scan` = 第 16 步的辨識開關通知;`--toast-update=install|download|releases` = 第 34 步更新提醒;截圖視窗畫在副螢幕)、
// `capturePage()` 存 PNG 後結束(不送任何輸入、不拿單一實例鎖、不建主視窗/托盤/熱鍵)。
const TOAST_SELFTEST = argAfter('--toast-selftest')
// `--uiohook-selftest`:只註冊 / 解除全域掛鉤(start → stop → 1 秒後再 start → stop),印出載入的 .node 路徑後結束;
// 不送任何輸入、不拿單一實例鎖、不建視窗/托盤/熱鍵。手動實機檢查用(scripts/uiohook-hookcheck.mjs),正式版也接受。
const UIOHOOK_SELFTEST = process.argv.includes('--uiohook-selftest')
// 效能修正第 17 步:`--capture-bench [--bench-*]`:量 overlay screenshot() 與 desktopCapturer 的耗時、像素 / OCR 一致性(ocr/capture-bench.ts);
// 不拿單一實例鎖、不送輸入、不搶焦點、不寫影格檔。
// code review 第 B 批:只在非 packaged 時接受(正式版忽略並正常啟動);量測程式碼動態 import(不在啟動路徑上執行)
const CAPTURE_BENCH_MODE = captureBenchMode(process.argv, app.isPackaged)
const CAPTURE_BENCH = CAPTURE_BENCH_MODE === 'run'
// 第 34 步:更新提醒的開發版驗證參數(`--reminder-interval-ms=` / `--reminder-auto=later,skip` / `--toast-display=secondary`;正式版忽略)
const REMINDER_DEV = reminderDevOptions(process.argv, app.isPackaged)
if (CAPTURE_BENCH_MODE === 'ignored') console.warn('[main] 正式版不支援 --capture-bench(只給開發版量測用),忽略並正常啟動')

// `--ppz-log-file=<path>`:main 的 console 另外附加寫到檔案(驗證自我重新啟動用;relaunch 會沿用同一組參數,
// 新行程的 stdout 不一定接得回原終端機)。不用 `--log-file`,那是 Chromium 自己的開關。
const LOG_FILE = process.argv.find(a => a.startsWith('--ppz-log-file='))?.slice('--ppz-log-file='.length)
// 第 28 步:常駐記錄(app-log.ts)。console.log / warn / error 與 renderer 轉印行**只在這裡攔一次**:
// 進環形緩衝(設定 › 記錄 的快照 / 即時追加)、userData/logs/ 的非同步檔案(whenReady 後接上),
// `--ppz-log-file` 的附加寫檔(行為不變:同步 append、帶 pid)也掛在同一個攔截點。
let logEmit: ((entries: LogEntry[]) => void) | null = null
const appLog = new AppLog({ emit: (entries) => { logEmit?.(entries) } })
const rawConsoleWarn = console.warn.bind(console)
captureConsole(console, appLog, format)
if (LOG_FILE) {
  appLog.onLine((_line, e) => {
    try { fsSync.appendFileSync(LOG_FILE, `${new Date(e.ts).toISOString()} [pid ${process.pid}] ${e.text}\n`) } catch { /* 記錄檔寫不進去(磁碟滿 / 被鎖)不能再拋錯或再記錄,否則會無限遞迴,刻意忽略 */ }
  })
}
const LOG_DIR = () => path.join(app.getPath('userData'), 'logs')
// 第 29 步:`--perf-log` = 這次啟動就開效能診斷(perf/perf-monitor.ts;也可在設定 › 記錄 › 效能打開,存 userData/perf.json)
const PERF_ARG = process.argv.includes('--perf-log')

console.log(uiohookPrebuildResult.message)

/**
 * `--quit`:請**已在執行的**主行程正常結束(= 托盤「結束」,會觸發「結束時自動套用更新」)。
 * 這個行程拿不到單一實例鎖 → 把參數交給主行程(`second-instance`)後自己結束;拿到鎖 = 沒有主行程,什麼都不做直接結束。
 * `--install-update` 同理,等同關於頁「立即重啟並更新」。
 * 無輸入的控制方式(自動驗證 / 腳本用),見 docs/release-flow.md「本機實測」。
 */
const CONTROL_REQUEST = ['--quit', '--install-update'].find(f => process.argv.includes(f))
let skipStartup = OCR_SELFTEST != null || TOAST_SELFTEST != null || CAPTURE_BENCH || UIOHOOK_SELFTEST

if (OCR_SELFTEST != null) {
  (RUNESHAPE_SELFTEST != null ? runRuneshapeSelftest(RUNESHAPE_SELFTEST, process.argv) : runOcrSelftest(OCR_SELFTEST, process.argv))
    .then((code) => { app.exit(code) })
    .catch((e) => { console.error('[ocr-selftest]', e); app.exit(1) })
} else if (CAPTURE_BENCH) {
  import('./ocr/capture-bench')
    .then(async ({ runCaptureBench }) => await runCaptureBench(process.argv))
    .then((code) => { app.exit(code) })
    .catch((e) => { console.error('[capture-bench]', e); app.exit(1) })
} else if (UIOHOOK_SELFTEST) {
  app.whenReady()
    .then(async () => await runUiohookSelftest())
    .then((code) => { app.exit(code) })
    .catch((e) => { console.error('[uiohook-selftest]', e); app.exit(1) })
} else if (TOAST_SELFTEST != null) {
  app.whenReady()
    .then(() => runToastSelftest(TOAST_SELFTEST))
    .then((code) => { app.exit(code) })
    .catch((e) => { console.error('[toast-selftest]', e); app.exit(1) })
} else if (!app.requestSingleInstanceLock()) {
  console.log(CONTROL_REQUEST
    ? `[main] ${CONTROL_REQUEST}:已轉交執行中的 ExileAppraiser`
    : hasRegexShareArg(process.argv) ? '[main] 正則分享碼參數:已轉交執行中的 ExileAppraiser' : '[main] 已有另一個 ExileAppraiser 在執行,結束')
  skipStartup = true
  app.exit()
} else if (CONTROL_REQUEST) {
  console.log(`[main] ${CONTROL_REQUEST}:沒有執行中的 ExileAppraiser,直接結束`)
  skipStartup = true
  app.exit()
}

// 正式版不用 file://(sandbox 下 fetch / 動態 import 對 file: 一律失敗),改註冊 app:// 供應 renderer/dist。
const APP_SCHEME = 'app'
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}])

/** 自訂背景圖的資料夾(`userData/backgrounds`;backgrounds.ts) */
const BG_DIR = () => path.join(app.getPath('userData'), BG_DIR_NAME)
/** 懸浮選單的速查表圖片(`userData/cheatsheets`;規則同背景圖,另開資料夾) */
const SHEET_DIR = () => path.join(app.getPath('userData'), SHEET_DIR_NAME)

/**
 * `app://app/…` = renderer/dist(只有正式版;開發模式走 Vite);`app://bg/<檔名>` = 自訂背景圖(兩種模式都有)。
 * 背景檔名經 `resolveBgPath`(只准 png / jpg / webp、不含路徑字元、解析後不跳出 backgrounds 資料夾),其他一律 404。
 * 背景圖回應另依 `bgCorsHeaders` 只對 app 自己的頁面(APP_ORIGINS)加 CORS 標頭(renderer 預先模糊要畫進 canvas,效能修正第 10 步)。
 */
function installAppProtocol (serveRenderer: boolean) {
  const root = __dirname
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.host === 'bg' || url.host === 'sheet') {
      const name = bgFileFromPath(url.pathname)
      const file = name == null ? null : resolveBgPath(url.host === 'bg' ? BG_DIR() : SHEET_DIR(), name)
      if (!file) return new Response('not found', { status: 404 })
      return net.fetch(pathToFileURL(file).toString()).then(r => r.ok
        ? new Response(r.body, { status: 200, headers: { 'Content-Type': bgContentType(file), 'Cache-Control': 'no-cache', ...bgCorsHeaders(request.headers.get('origin'), APP_ORIGINS) } })
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

// 第五輪 30.5:硬體加速改為設定(`hardwareAcceleration`,預設 false = 改版前一律關)。只能在 app ready 前決定 → 這裡同步讀設定檔
// (在舊版設定搬移之後);selftest / 量測 / 控制參數 / 第二實例維持一律關。改了要重新啟動才生效(IPC `app-relaunch`)
const HW_ACCEL_SETTING = (() => {
  if (skipStartup) return false
  try { return hardwareAccelerationFromConfig(fsSync.readFileSync(CONFIG_PATH(), 'utf8')) } catch { return false }
})()
if (shouldDisableHardwareAcceleration({ skipStartup, setting: HW_ACCEL_SETTING })) app.disableHardwareAcceleration()
if (!skipStartup) console.log(`[main] 硬體加速 ${HW_ACCEL_SETTING ? '開' : '關'}(設定 hardwareAcceleration)`)

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
  // 正則分享碼參數(--regex-share / --regex-share-file)只在這次啟動用一次:不帶進新行程,否則重新啟動後又跳一次確認
  const args = stripRegexShareArgs(process.argv.slice(1))
  console.log(`[main] 重新啟動(${reason}),relaunch args=${JSON.stringify(args)}`)
  quitting = true
  uiohookGate.shutdown()
  app.releaseSingleInstanceLock()
  app.relaunch({ args })
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
    const details = args[0] as { message?: string, level?: unknown } | undefined
    const message = details?.message ?? (args[2] as string | undefined)
    // 依 renderer 的等級走 console.log / warn / error(記錄分頁的等級欄與篩選用);舊版 Electron 的位置參數 level = args[1]
    if (message) console[consoleMethodForLevel(details?.level ?? args[1])](`[renderer] ${message}`)
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

/** 提示視窗的圖示 data URL(讀一次就快取;讀不到也快取 null,不每次重讀) */
let iconDataUrlCache: string | null | undefined
function iconDataUrl (): string | null {
  if (iconDataUrlCache !== undefined) return iconDataUrlCache
  try {
    iconDataUrlCache = `data:image/png;base64,${fsSync.readFileSync(iconPath('icon.png')).toString('base64')}`
  } catch {
    iconDataUrlCache = null
  }
  return iconDataUrlCache
}

type WorkArea = { x: number, y: number, width: number, height: number }

/**
 * 工作區右下角(托盤上方)的提示小視窗:無框、透明、置頂、不進工作列、不可取得焦點(`showInactive`)、點擊穿透。
 * `workArea` 省略 = 主螢幕(code review 第 B 批起呼叫端傳遊戲所在螢幕,`toastWorkArea`)。
 * 內容是 data URL(`toastHtml`:內嵌 CSS、無腳本、CSP default-src 'none');`autoClose` = 淡出後銷毀。
 */
function showStartupToast (msg: ToastMessage, opts: { animate?: boolean, autoClose?: boolean, workArea?: WorkArea } = {}): BrowserWindow {
  const bounds = toastBounds(opts.workArea ?? screen.getPrimaryDisplay().workArea)
  const t = createToastWindow(bounds, { clickable: false, label: '啟動提示' })
  t.once('ready-to-show', () => {
    if (t.isDestroyed()) return
    t.showInactive()
    if (opts.autoClose !== false) {
      setTimeout(() => { if (!t.isDestroyed()) t.destroy() }, TOAST_VISIBLE_MS + TOAST_FADE_MS + 150)
    }
  })
  void t.loadURL(toastDataUrl(msg, opts.animate))
  console.log(`[toast] 顯示提示 ${JSON.stringify(bounds)}:${msg.title} / ${msg.hint}`)
  return t
}

/**
 * 提示小視窗共用的外殼:無框、透明、置頂、不進工作列、不可取得焦點(`focusable: false` + 呼叫端 `showInactive`)。
 * `clickable: false` = 點擊穿透(一般提示);`true` = 第 34 步更新提醒(按鈕要能按,仍不搶遊戲焦點)。
 * 頁面不可導覽到別處(`will-navigate` 一律擋;更新提醒另掛一個 `will-navigate` 依網址判斷按鈕)。
 */
function createToastWindow (bounds: WorkArea, opts: { clickable: boolean, label: string }): BrowserWindow {
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
  if (!opts.clickable) t.setIgnoreMouseEvents(true)
  t.setMenu(null)
  denyNewWindows(t.webContents, opts.label)
  t.webContents.on('will-navigate', (e) => { e.preventDefault() })
  return t
}

// ---- 第 34 步:有新版本時的更新提醒視窗(update-reminder.ts;docs/release-flow.md「更新提醒」) ----

/** 畫面上的更新提醒(同時只有一個;與一般提示不同視窗,但同位置,所以兩者不同時出現 —— 見 presentToast / canShow) */
let activeReminder: { win: BrowserWindow, poll: NodeJS.Timeout | null, done: boolean } | null = null

/** 收回畫面上的更新提醒(不回報;呼叫端自己決定排程)。 */
function closeUpdateReminder (): void {
  const r = activeReminder
  if (!r) return
  activeReminder = null
  r.done = true
  if (r.poll) clearInterval(r.poll)
  if (!r.win.isDestroyed()) r.win.destroy()
}

/**
 * 右下角可點擊的更新提醒:`showInactive`(不搶焦點)、不點擊穿透、頁面無腳本(按鈕 = `REMINDER_BUTTON_URL` 連結 → `will-navigate` 攔下)。
 * 約 `visibleMs` 後淡出(滑鼠停在上面時暫停:main 每 200 ms 看游標是否在視窗內,CSS `:hover` 暫停動畫)。
 * 每個結果只回報一次:按鈕 → `onButton`;淡出完 / 視窗被關 → `onTimeout`。
 */
function showUpdateReminder (msg: ReminderMessage, opts: {
  workArea: WorkArea
  onButton: (b: ReminderButton) => void
  onTimeout: () => void
  animate?: boolean
  visibleMs?: number
}): BrowserWindow {
  closeUpdateReminder()
  const bounds = reminderBounds(opts.workArea)
  const t = createToastWindow(bounds, { clickable: true, label: '更新提醒' })
  const entry: { win: BrowserWindow, poll: NodeJS.Timeout | null, done: boolean } = { win: t, poll: null, done: false }
  activeReminder = entry
  const finish = (fn: () => void) => {
    if (entry.done) return
    if (activeReminder === entry) activeReminder = null
    entry.done = true
    if (entry.poll) clearInterval(entry.poll)
    if (!t.isDestroyed()) t.destroy()
    fn()
  }
  // 按鈕 = 連到 https://ppz-reminder.invalid/<動作>(createToastWindow 的 will-navigate 已 preventDefault,這裡只判斷是哪個)
  t.webContents.on('will-navigate', (_e, url) => {
    const b = reminderButtonFromUrl(url)
    if (b) {
      console.log(`[update-reminder] 按鈕 ${b}`)
      finish(() => { opts.onButton(b) })
    }
  })
  t.once('closed', () => { finish(opts.onTimeout) })
  t.once('ready-to-show', () => {
    if (t.isDestroyed() || entry.done) return
    t.showInactive()
    if (opts.animate === false) return
    const countdown = new HoverPausedCountdown(opts.visibleMs ?? UPDATE_REMINDER_VISIBLE_MS)
    let last = Date.now()
    entry.poll = setInterval(() => {
      if (t.isDestroyed()) return
      const now = Date.now()
      const hovered = pointInBounds(screen.getCursorScreenPoint(), t.getBounds())
      if (countdown.advance(now - last, hovered)) finish(opts.onTimeout)
      last = now
    }, 200)
  })
  void t.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(reminderHtml(msg, iconDataUrl(), { animate: opts.animate, visibleMs: opts.visibleMs }))}`)
  console.log(`[update-reminder] 顯示提醒視窗 ${JSON.stringify(bounds)}:${msg.title} / ${msg.hint}`)
  return t
}

/** presentToast 要顯示一般提示時,先收回畫面上的更新提醒(第 34 步;排程稍後重試) */
let interruptUpdateReminder: (() => void) | null = null

function toastDataUrl (msg: ToastMessage, animate?: boolean): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(toastHtml(msg, iconDataUrl(), { animate }))}`
}

/** 目前在畫面上的提示視窗(啟動提示、遊戲啟動提示、辨識開關通知共用一個,不疊多個) */
let activeToast: BrowserWindow | null = null
let activeToastTimer: NodeJS.Timeout | null = null

/**
 * 顯示提示:已有提示視窗在畫面上 → 換內容(重新 loadURL,淡入 / 淡出動畫從頭開始)並重新計時;沒有 → 開一個。
 * 計時從頁面載入完成開始,`TOAST_VISIBLE_MS + TOAST_FADE_MS` 後銷毀(與 CSS 淡出同步)。
 */
function presentToast (msg: ToastMessage, workArea?: WorkArea): void {
  // 第 34 步:同位置不疊兩個視窗 —— 一般提示(按鍵回饋 / 啟動提示)優先,更新提醒收回、等這個提示結束再出現
  interruptUpdateReminder?.()
  if (activeToastTimer) { clearTimeout(activeToastTimer); activeToastTimer = null }
  const reuse = activeToast && !activeToast.isDestroyed() ? activeToast : null
  // 換內容時也跟著移到這次的螢幕(遊戲換了螢幕)
  if (reuse) reuse.setBounds(toastBounds(workArea ?? screen.getPrimaryDisplay().workArea))
  const t = reuse ?? showStartupToast(msg, { autoClose: false, workArea })
  t.webContents.once('did-finish-load', () => {
    if (activeToastTimer) clearTimeout(activeToastTimer)
    activeToastTimer = setTimeout(() => {
      activeToastTimer = null
      if (!t.isDestroyed()) t.destroy()
    }, TOAST_VISIBLE_MS + TOAST_FADE_MS + 150)
  })
  if (reuse) {
    void reuse.loadURL(toastDataUrl(msg))
    console.log(`[toast] 更新提示:${msg.title} / ${msg.hint}`)
    return
  }
  activeToast = t
  t.once('closed', () => { if (activeToast === t) activeToast = null })
}

/** `--uiohook-selftest`:見上方旗標說明。回傳 0 = 每次 start 都成功 */
async function runUiohookSelftest (): Promise<number> {
  let ok = 0
  let fail = 0
  const attempt = (label: string) => {
    try {
      uIOhook.start()
      ok++
      console.log(`[uiohook-selftest] ${label} start OK`)
    } catch (e) {
      fail++
      console.log(`[uiohook-selftest] ${label} start FAIL ${describeStartError(e)}`)
    }
    try { uIOhook.stop() } catch (e) { console.log(`[uiohook-selftest] ${label} stop FAIL`, e) }
  }
  attempt('ready')
  await new Promise(resolve => setTimeout(resolve, 1000))
  attempt('after-1s')
  const report = process.report?.getReport() as { sharedObjects?: string[] } | undefined
  for (const so of report?.sharedObjects ?? []) {
    // 去掉長路徑前綴後的長度(從磁碟機代號算起)
    if (/uiohook/i.test(so)) console.log(`[uiohook-selftest] loaded ${so}(${so.slice(Math.max(0, so.indexOf(':') - 1)).length} 字元)`)
  }
  console.log(`[uiohook-selftest] RESULT ok=${ok} fail=${fail}`)
  return fail === 0 ? 0 : 1
}

/** `--toast-selftest <out.png>`:開提示視窗(不動畫、不自動關)、截圖存檔後結束。只截自己的 webContents,不送任何輸入。 */
async function runToastSelftest (out: string): Promise<number> {
  if (!out) { console.error('[toast-selftest] 用法:--toast-selftest <out.png> [--toast-lang=en] [--toast-updated] [--toast-hotkey=Ctrl + D] [--toast-scan=reveal:on,rune:paused] [--toast-update=install|download|releases] [--toast-update-version=x.y.z] [--toast-update-manual]'); return 2 }
  const argValue = (prefix: string) => process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
  // 第 16 步:`--toast-scan=reveal:on,rune:paused` → 辨識開關通知(一項 = 一行)
  const scanArg = argValue('--toast-scan=')
  const scanItems = (scanArg ?? '').split(',').map(x => x.trim().split(':'))
    .filter(([k]) => k === 'reveal' || k === 'rune')
    .map(([k, v]) => ({ kind: k as ScanToastKind, paused: v === 'paused' }))
  const msg = scanArg != null ? scanToastMessage(toastLang(argValue('--toast-lang=')), scanItems) : toastMessage({
    lang: toastLang(argValue('--toast-lang=')),
    version: app.getVersion(),
    // 預設 = 設定預設值(按住 Ctrl + D)
    hotkey: argValue('--toast-hotkey=') ?? priceCheckHotkeyLabel('Ctrl', 'D'),
    updated: process.argv.includes('--toast-updated')
  })
  // 截圖視窗畫在副螢幕(沒有副螢幕 → 主螢幕),不擋使用者的主螢幕;showInactive 不搶焦點
  const primary = screen.getPrimaryDisplay()
  const workArea = (screen.getAllDisplays().find(d => d.id !== primary.id) ?? primary).workArea
  // 第 34 步:`--toast-update=install|download|releases [--toast-update-version=0.2.0] [--toast-update-manual]` → 更新提醒樣式
  const updateArg = argValue('--toast-update=')
  if (updateArg === 'install' || updateArg === 'download' || updateArg === 'releases') {
    const target: ReminderTarget = {
      version: argValue('--toast-update-version=') ?? '0.2.0',
      action: updateArg as ReminderAction,
      url: 'https://github.com/Hsiung-Shao/exile-appraiser/releases',
      autoUpdate: !process.argv.includes('--toast-update-manual')
    }
    const r = showUpdateReminder(reminderMessage(toastLang(argValue('--toast-lang=')), target), {
      workArea, animate: false, onButton: () => {}, onTimeout: () => {}
    })
    return await captureToastSelftest(r, out)
  }
  const t = showStartupToast(msg, { animate: false, autoClose: false, workArea })
  return await captureToastSelftest(t, out)
}

/** 自我測試:等視窗顯示、截自己的 webContents 存 PNG、印 bounds / 焦點狀態後關掉。 */
async function captureToastSelftest (t: BrowserWindow, out: string): Promise<number> {
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
  /** 只給雙擊托盤圖示用(右鍵選單已不含「顯示」)。 */
  show: () => void
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
    { label: s.openInBrowser, click: a.openInBrowser },
    { label: s.version(app.getVersion()), enabled: false },
    { label: s.checkUpdate, click: a.checkUpdate },
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
  uiohookGate.shutdown()
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

  // 第 28 步:記錄檔(非同步寫入;先刪 7 天前的,再把已在緩衝裡的行補寫進去)+ 記錄分頁的即時追加
  // (只在記錄分頁打開、renderer 送 log-subscribe 後才送;不進 PREVIEW_EVENTS,預覽端改輪詢 log-get)
  const logWriter = new LogFileWriter({ dir: LOG_DIR(), onError: (e) => { rawConsoleWarn('[log] 寫記錄檔失敗(之後的錯誤不再重複回報)', e) } })
  void logWriter.purgeOld().then((removed) => {
    appLog.attachFile(logWriter)
    if (removed.length) console.log(`[log] 已刪除 ${removed.length} 個 7 天前的記錄檔`)
  })
  app.on('will-quit', () => { void logWriter.close() })
  logEmit = (entries) => { send('log-lines', entries) }
  // 視窗重新載入(F5 / 開發模式熱重載)後 renderer 的訂閱就沒了:重置,記錄分頁重新掛上時會再送 log-subscribe
  w.webContents.on('did-start-loading', () => { appLog.setSubscribed(false) })

  let overlay: OverlayWindow | undefined
  let poeWindow: GameWindow | undefined
  let areaTracker: WidgetAreaTracker | undefined
  if (windowMode === 'overlay') {
    poeWindow = new GameWindow()
    overlay = new OverlayWindow(w, send, poeWindow)
    // 2026-10-01 使用者裁定拿掉 APT 的「按住 Alt 隱藏 overlay」(OverlayVisibility):查價中按 Alt 不再藏介面
    areaTracker = new WidgetAreaTracker(send, overlay)
  }

  // 第五輪 30.4:遊戲在前景但 overlay 上沒有東西要畫(面板 / 設定 / 框選層 / 兩個徽章層都沒有、overlay 沒焦點)→ 延遲 500 ms hide();
  // 要畫時 showInactive(不搶焦點)。只藏 / 只再顯示我們自己藏的,遊戲失焦 / detach 交還給 electron-overlay-window(windowing/overlay-idle.ts)
  let overlayIdle: OverlayIdleHider | undefined
  if (overlay && poeWindow) {
    const gw = poeWindow
    const idle = overlayIdle = new OverlayIdleHider({
      win: {
        isVisible: () => !w.isDestroyed() && w.isVisible(),
        hide: () => { if (!w.isDestroyed()) w.hide() },
        // 同 electron-overlay-window 在遊戲 focus 時的做法
        showInactive: () => { if (w.isDestroyed()) return; w.showInactive(); w.setAlwaysOnTop(true, 'screen-saver') }
      },
      gameFocused: () => gw.targetHasFocus,
      log: (msg) => { console.log(msg) }
    })
    overlay.onInteractableChange = (v) => { idle.setInteractable(v) }
    w.on('show', () => { idle.onWindowShown() })
    gw.onFocusChange((focused) => { if (focused) idle.onGameFocus(); else idle.onGameBlur() })
    gw.onDetach(() => { idle.onGameBlur() })
    // renderer 重新載入:回報作廢,重新回報前當成要顯示(保守)
    w.webContents.on('did-start-loading', () => { idle.setContent(null) })
    app.on('will-quit', () => { idle.dispose() })
  }

  // WP-S:OCR 常駐 PowerShell 行程(第一次辨識才啟動,閒置 10 分鐘自動結束);褻瀆與符文塑形兩個掃描共用
  // 第 22 步:語言包跟著設定的客戶端語言(`ocr-lang.ts`;PoE2 英文 → en-US、其他 → zh-Hant-TW);host-config 到了才知道,之前掃描本來就不跑
  const winOcr = new WinOcr(WIN_OCR_SCRIPT, { idleMs: 10 * 60_000 })
  /** 兩個掃描的偵測器語言 = WinOcr 目前的語言包(換語言時兩者一起換) */
  const ocrTextLang = () => textLangFor(winOcr.lang)
  /** 第 11 步:設定頁「徽章外觀」的系統字體清單(一次性 PowerShell,成功後快取) */
  const fontLister = createFontLister()
  app.on('will-quit', () => { winOcr.close('app quit') })
  const gameBounds = () => {
    const b = poeWindow?.bounds
    return b && b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null
  }
  const scanEnv = () => ({ overlay: windowMode === 'overlay', gameActive: Boolean(poeWindow?.isActive), bounds: gameBounds() })
  /** code review 第 B 批:提示畫在遊戲所在螢幕的工作區;沒有遊戲視窗(視窗模式 / 還沒 attach)→ 主螢幕 */
  const gameToastArea = (): WorkArea => {
    // 第 34 步開發版驗證 `--toast-display=secondary`:提示畫在副螢幕(正式版不接受這個參數)
    if (REMINDER_DEV?.secondaryDisplay) {
      const primary = screen.getPrimaryDisplay()
      return (screen.getAllDisplays().find(d => d.id !== primary.id) ?? primary).workArea
    }
    return toastWorkArea(
      gameBounds(),
      screen.getAllDisplays().map(d => ({ rect: displayPhysRect(d), workArea: d.workArea })),
      screen.getPrimaryDisplay().workArea
    )
  }
  // 效能修正第 17 步:擷取先用 overlay 原生 screenshot()(只抓 attach 的遊戲 client、同步數十 ms),throw / 尺寸不符 / 全黑才退回 desktopCapturer;
  // 視窗模式沒有 attach 的遊戲視窗(掃描本來就不跑,scanBlock = not-overlay),不傳 screenshot = 一律 desktopCapturer
  const clientCapture = createOverlayClientCapture({
    screenshot: poeWindow ? () => poeWindow!.screenshot() : undefined,
    shotBounds: () => poeWindow?.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
    log: (msg) => { console.log(msg) }
  })
  // 效能修正第 18 步:擷取會截到我們自己的 overlay(徽章 / 提示)→ renderer 回報位置(`scan-mask`),擷取當下換算成影像像素,
  // OCR 前填掉、差分不比那幾格;送出 rows 後等 renderer ack 才擷取下一張(docs/reveal-ocr.md「遮掉自己畫的東西」)
  const scanMask = new ScanMaskStore()
  // 效能修正第 7 步:兩個掃描同一 client bounds 的擷取共用(完成後 100 ms 內用同一張)
  const sharedCapture = new SharedCapture(async (b) => {
    const c = await clientCapture.capture(b)
    const sz = c.image.getSize()
    return toScanCapture(c, () => winOcr, scanMask.imageRects(c.client, c.offset, { w: sz.width, h: sz.height }, Date.now()))
  })
  const scanCapture = sharedCapture.capture
  // 效能修正第 6 步:兩個掃描的自動定位(整個 client ×1、同一個 WinOcr / 語言)1 秒內共用同一次 OCR
  const sharedLocateOcr = new SharedLocateOcr()

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
    locateOcr: sharedLocateOcr,
    // 面板定位 / 判定用 tiers.json 的模板 skeleton(第一次掃描才讀;第 22 步:每種語言各一份)
    locateIndex: (lang) => loadLocateIndex(undefined, undefined, lang),
    textLang: ocrTextLang,
    drawPending: () => scanMask.pending(Date.now()),
    send: (ev) => {
      if (ev.reason === 'rows') scanMask.noteSent('reveal', ev.seq, Date.now())
      send('reveal-scan-result', ev)
    }
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
    textLang: ocrTextLang,
    ocrBusy: () => revealScan.busy,
    capture: scanCapture,
    locateOcr: sharedLocateOcr,
    drawPending: () => scanMask.pending(Date.now()),
    send: (ev) => {
      if (ev.reason === 'rows') scanMask.noteSent('rune', ev.seq, Date.now())
      send('runeshape-scan-result', ev)
    }
  })
  if (windowMode === 'overlay') {
    // 兩個掃描同時開著時錯開半個間隔,輪流使用 WinOcr
    revealScan.start(0)
    runeshapeScan.start(DEFAULT_SCAN_INTERVAL_MS / 2)
    poeWindow?.on('active-change', () => { revealScan.poke(); runeshapeScan.poke() })
    // 第 30.2 步:被擋下時不再每秒重排(10 秒保底;停用 / 不是 PoE2 不排)→ 會改變 scanBlock 結果的視窗事件要叫醒。
    // wake() 只在目前被擋下時才立刻重看,正常掃描中不插 tick(拖動視窗時 moveresize 很密)
    const wakeScans = () => { revealScan.wake(); runeshapeScan.wake() }
    poeWindow?.onAttach(wakeScans)
    poeWindow?.onDetach(wakeScans)
    poeWindow?.onMoveresize(wakeScans)
  }
  app.on('will-quit', () => { revealScan.stop(); runeshapeScan.stop() })

  const shortcuts = new Shortcuts({
    mode: windowMode,
    overlay,
    poeWindow,
    areaTracker,
    // 第五輪 30.4:熱鍵查價讀剪貼簿前,被閒置隱藏的 overlay 先顯示(renderer 隱藏期間收不到視窗位置更新)
    beforeItemCopy: () => { overlayIdle?.wake('熱鍵查價') },
    onItem: (e: ItemTextEvent) => {
      send('item-text', e)
      if (windowMode === 'window') showNear(e.position)
    },
    // 2026-10-01:原本「按一次辨識一次」→ 暫停 / 繼續褻瀆自動辨識
    // 第 16 步:切換後在右下角提示目前狀態(同一個提示視窗,連按更新內容)
    onOcrReveal: () => { notifyScan([{ kind: 'reveal', paused: revealScan.toggleUserPause() }]) },
    // WP-S2:框選 OCR 區域熱鍵 → renderer 開框選層(它自己呼叫 overlay-activate 取得焦點);
    // 2026-10-01:符文塑形的框選熱鍵帶 { target: 'runeshape' }(揭露面板不帶,形狀不變)
    onOcrRegionPick: (target) => { if (target === 'runeshape') send('ocr-region-pick', { target }); else send('ocr-region-pick') },
    // WP-R2:符文塑形自動查價暫停 / 繼續
    onRuneshapeToggle: () => { notifyScan([{ kind: 'rune', paused: runeshapeScan.toggleUserPause() }]) },
    // 第 16 步:兩個暫停熱鍵相同 → 合併動作(只在兩者都符合註冊條件時才有;任一個在執行 → 全部暫停,全部暫停 → 全部繼續)
    onScanToggleBoth: () => {
      const target = nextScanPaused([revealScan.paused, runeshapeScan.paused])
      if (target == null) return
      notifyScan([
        { kind: 'reveal', paused: revealScan.setUserPause(target) },
        { kind: 'rune', paused: runeshapeScan.setUserPause(target) }
      ])
    },
    // 第 33 步:正則書籤快速面板 → overlay 取得焦點(閒置隱藏的視窗在 focus() 前先顯示)→ renderer 開面板(鍵盤上下 + Enter、Esc 關)
    onRegexQuick: () => {
      console.log('[regex-quick] 快速面板熱鍵')
      overlay?.assertOverlayActive()
      send('regex-quick-open')
    },
    // 第 33 步:書籤個別熱鍵 → renderer 算出搜尋字串後呼叫 `regex-paste`(遊戲本來就在前景,不搶焦點、不顯示 overlay)
    onRegexBookmark: (e) => { send('regex-bookmark-run', e) }
  })
  // uiohook 掛鉤不在啟動時開:只在 WidgetAreaTracker 追蹤查價面板期間開(uiohook-gate.ts;送鍵不需要掛鉤)。
  // 例外(第 15 步):倉庫頁籤捲動開著時,遊戲在前景期間也持有一份(要收 wheel 事件);關著時維持上述行為。
  // 開關在第一次 host-config 才設(之前 enabled = false,不持有)。
  // 第五輪 30.1(使用者裁定):再縮小為「遊戲前景 + 按住 Ctrl」才持有;Ctrl 由常駐 PowerShell 輪詢 GetAsyncKeyState 偵測(ctrl-watch.ts,
  // 只在遊戲前景 + 功能開著時輪詢,不裝掛鉤);輪詢器用不了(沒有 PowerShell 等)→ 退回前景期間一直持有
  const ctrlWatch = windowMode === 'overlay' && poeWindow ? new CtrlWatcher() : undefined
  app.on('will-quit', () => { ctrlWatch?.dispose() })
  const stashScroll = windowMode === 'overlay' && poeWindow
    ? new StashScroll({
      ctrl: ctrlWatch,
      game: poeWindow,
      gate: uiohookGate,
      onWheel: (fn) => { uIOhook.on('wheel', fn) },
      onAttach: (fn) => { poeWindow!.onAttach(() => { fn() }) },
      onDetach: (fn) => { poeWindow!.onDetach(fn) },
      tap: (key) => { uIOhook.keyTap(UiohookKey[key]) }
    })
    : undefined
  app.on('will-quit', () => { stashScroll?.dispose() })

  const showApp = () => {
    if (overlay) {
      overlay.assertOverlayActive()
    } else {
      win?.show(); win?.focus()
    }
  }

  // ---- 一鍵從 PobTools 送正則分享碼(regex-share.ts;docs/regex-share-cli.md) ----
  // renderer 掛好監聽後呼叫 regex-share-take(= 就緒);之前收到的先留著。只做格式檢查,解碼與確認在 renderer。
  const regexShareInbox = new RegexShareInbox({ deliver: (req) => { send('regex-share', req) }, log: (m) => { console.log(m) } })
  w.webContents.on('did-start-loading', () => { regexShareInbox.reset() })
  const regexShareFs: RegexShareFs = {
    stat: async (p) => await fs.stat(p),
    readFile: async (p) => await fs.readFile(p, 'utf8')
  }
  /** 叫出視窗;overlay 還沒綁定遊戲視窗時套件可能丟例外 → 只記 log(分享碼請求照樣留給 renderer) */
  const showAppForRegexShare = () => {
    try { showApp() } catch (e) { console.warn('[regex-share] 叫出視窗失敗(請求仍會在設定 › 正則顯示)', e) }
  }
  // 首次啟動帶參數:overlay 還沒綁定 / 還沒收到遊戲 attach 前 gameAttached 一定是 false → 等啟動穩定再決定顯示在哪(regex-share.ts)
  const regexShareGate = new RegexShareStartupGate({
    settled: windowMode !== 'overlay' || !poeWindow,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => { clearTimeout(t as NodeJS.Timeout) },
    log: (m) => { console.log(m) }
  })
  /** 決定顯示目標 → 放進信箱 → 叫出視窗(overlay 而遊戲沒開 → 用預設瀏覽器開設定 › 正則) */
  const routeRegexShare = (req: Omit<RegexShareRequest, 'id'>) => {
    const target: RegexShareTarget = regexShareTarget(windowMode, windowMode === 'overlay' ? gameAttached : true)
    const full = regexShareInbox.push(req, target)
    if (full.error) console.warn(`[regex-share] 參數不合格 #${full.id}:${full.error.reason}(${full.error.detail})`)
    if (target === 'preview') {
      console.log(`[regex-share] #${full.id} overlay 模式且遊戲沒開 → 用瀏覽器開設定 › 正則`)
      openPreviewInBrowser('#tab=regex').catch((e) => { console.error('[regex-share] 開啟瀏覽器設定頁失敗', e) })
    } else {
      showAppForRegexShare()
    }
  }
  /** argv 有分享碼參數 → 檢查 / 讀檔後交給 routeRegexShare;沒有 = false(呼叫端照原本行為) */
  const handleRegexShareArgv = (argv: readonly string[], cwd: string): boolean => {
    const arg = findRegexShareArg(argv)
    if (!arg) return false
    void resolveRegexShareArg(arg, cwd, regexShareFs).then((req) => {
      regexShareGate.whenSettled(() => { routeRegexShare(req) })
    }).catch((e) => { console.error('[regex-share] 處理參數失敗', e) })
    return true
  }
  // 首次啟動就帶參數:先留在信箱,renderer 就緒(regex-share-take)時交出去
  handleRegexShareArgv(process.argv, process.cwd())
  // 自動更新:狀態推給 renderer;第一次收到 host-config(renderer 已就緒)時才檢查
  // 第 34 步:同一份狀態也交給更新提醒排程(有新版 → 右下角每 10 分鐘提醒)
  // eslint-disable-next-line prefer-const
  let updateReminder: UpdateReminderScheduler | undefined
  const updater = new AppUpdater((info) => {
    send('updater-state', info)
    updateReminder?.setInfo(info)
  })
  /** 先把視窗叫到前景,再請 renderer 開設定到該分頁。 */
  const openSettings = (tab: SettingsTabId) => {
    showApp()
    console.log(`[tray] open-settings tab=${tab}`)
    send('open-settings', { tab })
  }

  // ---- 第 34 步:有新版本時每 10 分鐘提醒(update-reminder.ts;docs/release-flow.md「更新提醒」) ----
  // 預覽啟動(`--preview`)不彈;還沒收到 Electron 視窗的 host-config 前擋住(設定 / 介面語言未知)。selftest 不會走到這裡。
  /** 「立即更新」:已下載 → 安裝(autoUpdate 開 = quitAndInstall(true, true));可下載 → 開設定 › 關於並開始下載;portable → Releases 頁 */
  const runReminderAction = (t: ReminderTarget) => {
    console.log(`[update-reminder] 立即更新 v${t.version}(${t.action})`)
    if (t.action === 'install') {
      reminder.stop()
      updater.install()
      return
    }
    reminder.closed('action')
    if (t.action === 'download') {
      openSettings('about')
      void updater.download()
    } else {
      openExternalSafe(t.url, '更新提醒').catch(() => {})
    }
  }
  /** 依目前狀態自動代按(只有開發版 `--reminder-auto=later,skip`;頁面內 DOM click,不是 OS 輸入) */
  const devAuto = [...(REMINDER_DEV?.auto ?? [])]
  const reminder: UpdateReminderScheduler = updateReminder = new UpdateReminderScheduler({
    timers: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => { clearTimeout(h as NodeJS.Timeout) } },
    canShow: () => !(activeToast && !activeToast.isDestroyed()),
    intervalMs: REMINDER_DEV?.intervalMs,
    log: (m) => { console.log(m) },
    persistSkip: (version) => { send('update-reminder-skip', version) },
    hide: () => { closeUpdateReminder() },
    show: (t) => {
      const win = showUpdateReminder(reminderMessage(toastLang(hostCfg?.uiLanguage), t), {
        workArea: gameToastArea(),
        onButton: (b) => {
          if (b === 'later') reminder.closed('later')
          else if (b === 'skip') reminder.skip()
          else runReminderAction(t)
        },
        onTimeout: () => { reminder.closed('timeout') }
      })
      const next = devAuto.shift()
      if (next) {
        win.webContents.once('did-finish-load', () => {
          setTimeout(() => {
            if (win.isDestroyed()) return
            console.log(`[update-reminder] (開發版驗證)代按 ${next}`)
            // 點頁面上那個按鈕連結(DOM click,不是 OS 輸入),走與真的點擊相同的 will-navigate 路徑
            void win.webContents.executeJavaScript(`document.querySelector('[data-btn="${next === 'later' ? 'later' : 'skip'}"]').click()`)
          }, 2000)
        })
      }
    }
  })
  interruptUpdateReminder = () => {
    if (!activeReminder) return
    closeUpdateReminder()
    reminder.closed('interrupted')
  }
  app.on('before-quit', () => { reminder.stop() })

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
      // 懸浮選單速查表:`<prefix>sheet/<檔名>`
      sheetDir: SHEET_DIR(),
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
  /** `hash` = 開哪個設定分頁(例:`#tab=regex`;預覽 boot script 讀 `#tab=`) */
  const openPreviewInBrowser = async (hash = ''): Promise<{ url: string }> => {
    const srv = await ensurePreview()
    const url = srv.url + hash
    console.log(`[preview] 以預設瀏覽器開啟 ${url}`)
    await shell.openExternal(url)
    return { url }
  }

  createTray({
    show: showApp,
    openInBrowser: () => { openPreviewInBrowser().catch((e) => { console.error('[preview] 開啟失敗', e) }) },
    checkUpdate: () => { void updater.check() }
  })
  // 第二個行程帶 `--quit` → 走與托盤「結束」相同的正常結束(exit code 0,會觸發結束時自動套用更新);
  // `--install-update` → 等同關於頁「立即重啟並更新」(只在 downloaded 時有作用);其餘 = 叫出視窗
  app.on('second-instance', (_e, argv, workingDirectory) => {
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
    // 一鍵從 PobTools 送正則分享碼:讀檔 / 檢查完才叫出視窗(相對路徑以第二個行程的工作目錄為準)
    if (handleRegexShareArgv(argv, workingDirectory)) return
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
    isCurrentGameForeground: () => overlay != null && Boolean(poeWindow?.isActive),
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
  // 第 30.3 步:兩款遊戲都不在時列舉退避 2 → 5 → 10 秒;拿得到的前景相關訊號 → nudge()(退避中才立刻重查並重設退避)。
  // electron-overlay-window 只對綁定的那個標題發 attach / detach / focus / blur(原生 WinEvent hook 不把其他視窗的前景變化交給 JS),
  // 所以另一款遊戲啟動沒有事件可接 → 最壞延遲 = 退避上限 10 秒 + 第 2 次確認 2 秒(docs/game-auto-switch.md)。
  poeWindow?.on('active-change', () => { detector.nudge() })
  powerMonitor.on('resume', () => { detector.nudge() })
  powerMonitor.on('unlock-screen', () => { detector.nudge() })

  /** 第 16 步:辨識暫停 / 繼續的通知(語言跟 `uiLanguage`;熱鍵只在收到 host-config 後才註冊,hostCfg 一定有值) */
  function notifyScan (items: Array<{ kind: ScanToastKind, paused: boolean }>): void {
    presentToast(scanToastMessage(toastLang(hostCfg?.uiLanguage), items), gameToastArea())
  }

  // 第 16 步:遊戲視窗從「不在」變成「附著到」→ 再顯示一次「已在背景執行」(startup-toast.ts `shouldShowGameAttachToast`)
  let gameAttached = false
  let attachCount = 0
  let trackingSince: number | null = null
  if (poeWindow) {
    poeWindow.onAttach(() => {
      regexShareGate.settle('遊戲 attach')
      // code review 第 B 批:重新 attach → overlay screenshot 的鎖存作廢,下一次擷取重新試原生路徑
      clientCapture.reset()
      detector.nudge() // 第 30.3 步:綁定的遊戲出現了 → 退避中立刻重查(回到每 2 秒)
      const wasAttached = gameAttached
      gameAttached = true
      attachCount++
      const cfg = hostCfg
      if (!cfg) return
      const show = shouldShowGameAttachToast({
        enabled: cfg.startupToast,
        mode: windowMode,
        preview: PREVIEW_ON_START,
        selftest: false, // selftest 不會走到這裡
        controlRequest: false,
        relaunching,
        wasAttached,
        firstAttach: attachCount === 1,
        msSinceTracking: trackingSince == null ? 0 : Date.now() - trackingSince
      })
      console.log(`[toast] 遊戲附著 #${attachCount} wasAttached=${String(wasAttached)} → ${show ? '顯示' : '不顯示'}提示`)
      if (show) {
        presentToast(toastMessage({
          lang: toastLang(cfg.uiLanguage),
          version: app.getVersion(),
          hotkey: priceCheckHotkeyLabel(cfg.hotkeyHold, cfg.hotkey),
          updated: false
        }), gameToastArea())
      }
    })
    poeWindow.onDetach(() => {
      gameAttached = false
      // code review 第 B 批:遊戲視窗被關掉 → 「只是最小化」的否決立即作廢(最小化後被關掉時更快切到另一款)
      detector.invalidateVeto()
      detector.nudge()
    })
  }

  let lastScanKey: string | null = null
  const onHostConfig = (ctx: HandlerCtx, cfg: HostConfigForMain): HotkeyRegistration => {
    const result = shortcuts.updateActions(cfg)
    hostCfg = cfg
    // 第 15 步:倉庫頁籤捲動(舊 renderer / 缺欄位 → 開;只在 overlay 模式有物件)
    stashScroll?.setEnabled(cfg.stashScroll !== false)
    // 第 22 步:客戶端語言改了 → OCR 語言包跟著換(WinOcr 重啟),兩個掃描丟掉舊語言的定位快取 / 基準,立刻重看
    if (winOcr.setLang(ocrLangFor(cfg))) {
      sharedLocateOcr.clear()
      revealScan.ocrLangChanged()
      runeshapeScan.ocrLangChanged()
    }
    // 開關 / 區域 / 間隔改了 → 立刻重新判斷(停用時即時清徽章;區域改了差分基準的鍵就不同,自然重看)
    // 只在影響掃描的欄位(開關 / 遊戲 / 區域 / 間隔)變了或第一次才 poke;設定頁每打一個字都會來,poke 會清計時器立刻 tick
    const scanKey = scanConfigKey(cfg)
    if (scanKey !== lastScanKey) {
      lastScanKey = scanKey
      revealScan.poke()
      runeshapeScan.poke()
    }
    if (cfg.uiLanguage === 'en' || cfg.uiLanguage === 'cmn-Hant') rebuildTrayMenu(cfg.uiLanguage)
    // 先套用 autoUpdate 再做第一次檢查(舊 renderer / 缺欄位 → 預設開)
    updater.setAutoUpdate(cfg.autoUpdate !== false)
    // 第 34 步:更新提醒開關 / 略過的版號(舊 renderer / 缺欄位 = 開、沒有略過);Electron 視窗的設定到了才解除擋住(預覽啟動一律擋)
    reminder.setConfig({ enabled: cfg.updateReminder !== false, skippedVersion: cfg.updateSkippedVersion ?? null })
    if (ctx.source !== 'preview') reminder.setBlocked(PREVIEW_ON_START)
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
      presentToast(toastMessage({
        lang: toastLang(cfg.uiLanguage),
        version: app.getVersion(),
        hotkey: priceCheckHotkeyLabel(cfg.hotkeyHold, cfg.hotkey),
        updated: startupUpdated
      }), gameToastArea()) // 啟動時遊戲已 attach → 遊戲所在螢幕;沒有遊戲 → 主螢幕
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
        trackingSince = Date.now()
        overlay.updateOpts(normalizeHotkey(cfg.overlayKey), title, cfg.game)
        regexShareGate.trackingStarted()
      } else {
        overlay.setOverlayKey(normalizeHotkey(cfg.overlayKey))
      }
    }
    applyDetector(cfg)
    return result
  }

  // ---- 第 29 步:效能診斷(perf/perf-monitor.ts;docs/perf/README.md) ----
  // `--perf-log` 或設定 › 記錄 › 效能(userData/perf.json)打開;預設關。關著時不開計時器、不掛 uiohook 監聽、不建寫檔器,
  // 只有各模組的計數器 `++`(GameDetector detectorCounters、PanelScan sched.captures / blockCounts)。
  // 開著時每 5 秒一筆:app-log 一行 `[perf] …` + userData/logs/perf-<日期>.log(JSONL,沿用 LogFileWriter 的輪替 / 保留 7 天)
  /** renderer 最近一次回報的查價面板 / 設定 / 框選層狀態(`runeshape-ui-state`,只有 overlay;情境標記用) */
  let lastUiState: RuneshapeUiState | null = null
  const PERF_SETTING_PATH = () => path.join(app.getPath('userData'), 'perf.json')
  let perfSetting = false
  try { perfSetting = (JSON.parse(fsSync.readFileSync(PERF_SETTING_PATH(), 'utf8')) as { enabled?: unknown }).enabled === true } catch { /* 沒有檔 = 關 */ }
  let perfWriter: LogFileWriter | null = null
  const perfWrite = (line: string) => {
    if (!perfWriter) {
      perfWriter = new LogFileWriter({
        dir: LOG_DIR(),
        fileName: perfFileName,
        isOwnFile: isPerfFile,
        onError: (e) => { rawConsoleWarn('[perf] 寫效能記錄檔失敗(之後的錯誤不再重複回報)', e) }
      })
      void perfWriter.purgeOld()
    }
    perfWriter.write(line)
  }
  /** 情境標記用:設定檔的背景圖開著且選了圖(只在效能診斷取樣時讀;讀不到 = null) */
  const readBgActive = async (): Promise<boolean | null> => {
    try {
      const c = JSON.parse(await fs.readFile(CONFIG_PATH(), 'utf8')) as { bg?: { enabled?: unknown, file?: unknown } }
      return c.bg?.enabled !== false && typeof c.bg?.file === 'string' && c.bg.file !== ''
    } catch { return null }
  }
  const perf = new PerfMonitor({
    metrics: () => app.getAppMetrics(),
    scenario: async (): Promise<ScenarioInput> => ({
      mode: windowMode,
      gameAttached: windowMode === 'overlay' ? gameAttached : null,
      gameForeground: windowMode === 'overlay' ? Boolean(poeWindow?.isActive) : null,
      ui: windowMode === 'overlay' ? lastUiState : null,
      revealReason: scanSnapshotOf(revealScan).reason,
      runeReason: scanSnapshotOf(runeshapeScan).reason,
      bg: await readBgActive(),
      windowVisible: !w.isDestroyed() && w.isVisible()
    }),
    scans: () => ({ reveal: scanSnapshotOf(revealScan), rune: scanSnapshotOf(runeshapeScan) }),
    uiohook: () => ({ running: uiohookGate.isRunning, holders: uiohookGate.holders }),
    hookEvents: { on: (fn) => { uIOhook.on('input', fn) }, off: (fn) => { uIOhook.off('input', fn) } },
    detector: () => ({ enums: detectorCounters.enums, processProbes: detectorCounters.processProbes, running: detector.running }),
    winOcr: () => (winOcr.running ? { running: true, pid: winOcr.pid } : { running: false }),
    write: perfWrite,
    log: (line) => { console.log(line) }
  })
  const perfState = (): PerfState => {
    const last = perf.last
    return {
      enabled: perf.enabled,
      byArg: PERF_ARG,
      setting: perfSetting,
      sampleMs: perf.intervalMs,
      file: path.join(LOG_DIR(), perfFileName(Date.now())),
      last: last ? { ts: last.ts, scenario: last.scenario, summary: formatPerfSummary(last) } : null
    }
  }
  // 排在其他 will-quit 之前:「效能診斷停止」那行要在記錄檔關閉前寫進去
  app.prependListener('will-quit', () => {
    perf.stop()
    void perfWriter?.close()
  })

  // 第 33 步:正則書籤一鍵貼進遊戲(regex-paste.ts;Ctrl+F → 貼上 → Enter,沿用倉庫搜尋的按鍵序列)
  const regexPaster = new RegexPaster({
    env: () => ({
      mode: windowMode,
      attached: gameAttached,
      gameFocused: Boolean(poeWindow?.targetHasFocus),
      overlayInteractable: Boolean(overlay?.isInteractable)
    }),
    writeClipboard: (text) => { clipboard.writeText(text) },
    tap: (key, mods) => { uIOhook.keyTap(UiohookKey[key], mods.map(m => UiohookKey[m])) },
    focusGame: () => { overlay?.assertGameActive() },
    gameFocused: () => Boolean(poeWindow?.targetHasFocus),
    quietCtrl: (on) => { stashScroll?.quietCtrl(on) },
    log: (msg) => { console.log(msg) }
  })
  /** IPC 參數不可信:只收 `{ text: string, name: string, source: bar|quick|hotkey, missing?: true }`(字串上限 2000 字元) */
  const regexPasteReq = (v: unknown) => {
    const o = (v != null && typeof v === 'object' ? v : {}) as Record<string, unknown>
    const source = o.source === 'bar' || o.source === 'quick' || o.source === 'hotkey' || o.source === 'menu' ? o.source : 'bar'
    return {
      text: typeof o.text === 'string' ? o.text.slice(0, 2000) : '',
      name: typeof o.name === 'string' ? o.name.slice(0, 80) : '',
      source,
      missing: o.missing === true
    }
  }

  /**
   * 檔案對話框選圖(只列 png / jpg / webp)→ 複製到 `dir`(檔名 = 清理後原名 + 內容雜湊,backgrounds.ts)→ 回傳檔名(取消 / 失敗回 null)。
   * 只複製選到的那一個檔;成功後刪掉資料夾裡其他舊圖(只刪合法檔名的檔)。背景圖(bg-pick)與速查表(sheet-pick)共用,各自一個資料夾
   */
  const pickImageInto = async (dir: string, tag: string, title: string): Promise<string | null> => {
    const opts = {
      title,
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const res = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const src = res.filePaths[0]
    try {
      const data = await fs.readFile(src)
      const name = storedBgName(src, data)
      if (!name) { console.warn(`[${tag}] 不支援的檔案類型`); return null }
      await fs.mkdir(dir, { recursive: true })
      const dest = resolveBgPath(dir, name)
      if (!dest) return null
      await fs.writeFile(dest, data)
      for (const f of await fs.readdir(dir)) {
        if (f !== name && normBgFile(f)) await fs.rm(path.join(dir, f), { force: true }).catch(() => {})
      }
      console.log(`[${tag}] 圖片 → ${name}(${data.length} bytes)`)
      return name
    } catch (e) {
      console.error(`[${tag}] 複製圖片失敗`, e)
      return null
    }
  }

  // ---- 所有 IPC handler 的登錄表(ipcMain 與瀏覽器預覽共用;見 host-handlers.ts) ----
  const table: HandlerTable = {
    'app-version': { kind: 'sync', fn: () => app.getVersion() },
    'window-mode': { kind: 'sync', fn: () => windowMode },
    'focus-game': { kind: 'send', fn: () => { overlay?.assertGameActive() } },
    'used-recently': { kind: 'send', fn: (_ctx, isOverlay: boolean) => { if (overlay) overlay.wasUsedRecently = isOverlay } },
    'track-area': { kind: 'send', fn: (_ctx, opts: TrackAreaOpts) => { areaTracker?.track(opts) } },
    // 預設 30 秒逾時;帶 requestId 的可由 `http-abort` 中止(鍵含來源 / 預覽 cid,各端只能中止自己的)
    'http-fetch': { kind: 'invoke', fn: (ctx, url: string, init?: HostFetchInit) => hostFetch(url, init, abortKeyOf(ctx, init?.requestId)) },
    'http-abort': { kind: 'invoke', fn: (ctx, requestId: unknown) => abortHostFetch(abortKeyOf(ctx, requestId)) },
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
    // 第五輪 30.5:這次啟動實際套用的硬體加速(設定頁「重新啟動後生效」提示用);預覽端不開放
    'hw-accel-active': { kind: 'invoke', preview: false, fn: () => HW_ACCEL_SETTING },
    // 第五輪 30.5:設定頁「重新啟動」:先把 renderer 目前的設定整份寫檔(debounce 中的變更不會遺失),再自我重新啟動;預覽端不開放
    'app-relaunch': {
      kind: 'invoke',
      preview: false,
      fn: async (_ctx, contents: unknown) => {
        if (isConfigContents(contents)) {
          await fs.mkdir(path.dirname(CONFIG_PATH()), { recursive: true })
          await fs.writeFile(CONFIG_PATH(), contents)
        }
        relaunchSelf('設定:重新啟動(硬體加速)')
      }
    },
    // 自訂背景圖:檔案對話框選圖(只列 png / jpg / webp)→ 複製到 userData/backgrounds → 回傳檔名(取消 / 失敗回 null)。
    // 只複製選到的那一個檔;成功後刪掉資料夾裡其他舊的背景圖(只刪合法檔名的檔)。預覽端不開放(對話框在桌面上)
    'bg-pick': { kind: 'invoke', preview: false, fn: () => pickImageInto(BG_DIR(), 'bg', 'Background image') },
    // 懸浮選單的速查表圖片(2026-10-08):流程與背景圖相同,存 userData/cheatsheets(另開資料夾,bg-pick 會清自己的資料夾)
    'sheet-pick': { kind: 'invoke', preview: false, fn: () => pickImageInto(SHEET_DIR(), 'sheet', 'Cheat sheet image') },
    // 第 28 步:設定 › 記錄。log-get 回快照({ entries, lastSeq },帶 sinceSeq 只回較新的;預覽端可用 = 輪詢);
    // log-subscribe(send)= 記錄分頁開著才讓 main 送 log-lines 即時追加;開資料夾只給 Electron 視窗
    'log-get': { kind: 'invoke', fn: (_ctx, sinceSeq?: unknown) => appLog.snapshot(typeof sinceSeq === 'number' ? sinceSeq : undefined) },
    'log-subscribe': { kind: 'send', fn: (_ctx, on: unknown) => { appLog.setSubscribed(on === true) } },
    'log-open-folder': {
      kind: 'invoke',
      preview: false,
      fn: async () => {
        const dir = LOG_DIR()
        await fs.mkdir(dir, { recursive: true })
        const err = await shell.openPath(dir)
        if (err) throw new Error(err)
      }
    },
    // 步 38:托盤「開啟設定資料夾」移到設定 › 關於;預覽端不開放
    'config-open-folder': {
      kind: 'invoke',
      preview: false,
      fn: async () => {
        const err = await shell.openPath(app.getPath('userData'))
        if (err) throw new Error(err)
      }
    },
    'preview-open':{ kind: 'invoke', fn: () => openPreviewInBrowser() },
    'preview-url': { kind: 'invoke', fn: () => preview && !preview.closed ? preview.url : null },
    // 第 11 步:系統已安裝字體(設定 › 徽章外觀的字體下拉);唯讀,預覽端可用;失敗回 []
    'list-fonts': { kind: 'invoke', fn: async () => await fontLister.list() },
    // WP-S:設定頁顯示 OCR 語言包狀態;預覽端不開放(shim 回 undefined)
    'ocr-available': { kind: 'invoke', preview: false, fn: () => winOcr.available() },
    // WP-S2:框選層開啟時讓 overlay 取得焦點(可點擊);預覽端不開放
    'overlay-activate': { kind: 'invoke', preview: false, fn: () => { overlay?.assertOverlayActive() } },
    // 一鍵從 PobTools 送正則分享碼:Electron renderer 掛好 `regex-share` 監聽後拿走啟動時留著的那一筆(之後的直接送事件);
    // 預覽分頁(overlay 而遊戲沒開時開的瀏覽器設定頁)啟動時拿走目標為 preview 的那一筆
    'regex-share-take': {
      kind: 'invoke',
      fn: (ctx) => {
        const target: RegexShareTarget = ctx.source === 'preview' ? 'preview' : 'app'
        const req = regexShareInbox.take(target)
        if (req && target === 'app') showAppForRegexShare()
        return req
      }
    },
    // 第 33 步:正則書籤複製 + 貼進遊戲搜尋列;不能貼(視窗模式 / 沒有遊戲 / 不在前景)只複製。書籤熱鍵沒貼成 → 右下角提示
    // (書籤列 / 快速面板由 renderer 自己顯示)。預覽端不開放(預覽分頁沒有遊戲可貼;renderer 改用 navigator.clipboard 只複製)
    'regex-paste': {
      kind: 'invoke',
      preview: false,
      fn: async (_ctx, raw: unknown): Promise<RegexPasteResult> => {
        const req = regexPasteReq(raw)
        console.log(`[regex-quick] 書籤「${req.name}」(${req.source},${[...req.text].length} 字)`)
        const res = await regexPaster.paste(req.text)
        if (req.source === 'hotkey' && !res.pasted && res.reason !== 'busy') {
          presentToast(regexToastMessage(toastLang(hostCfg?.uiLanguage), req.name, req.missing ? 'missing' : res.reason), gameToastArea())
        }
        return res
      }
    },
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
    'runeshape-ui-state': { kind: 'send', fn: (_ctx, s: RuneshapeUiState) => { lastUiState = s; runeshapeScan.setUiState(s); revealScan.setUiState(s) } },
    // 第五輪 30.4:renderer 回報 overlay 上有沒有東西要畫(閒置隱藏 overlay 視窗);預覽分頁畫的不在遊戲上 → 不開放
    'overlay-content': {
      kind: 'send',
      preview: false,
      fn: (_ctx, s: unknown) => {
        const c = sanitizeOverlayContent(s)
        if (c) overlayIdle?.setContent(c)
      }
    },
    // 第 18 步:renderer 回報畫在遊戲上的徽章 / 提示外框(CSS px + 視窗大小 + 處理到的掃描事件 seq);
    // 擷取後遮掉;在等這份回報的掃描立刻補一個 tick。send 一律不開放給預覽(預覽分頁畫的東西不在遊戲上)
    'scan-mask': {
      kind: 'send',
      preview: false,
      fn: (_ctx, r: unknown) => {
        const rep = sanitizeMaskReport(r)
        if (!rep) return
        scanMask.report(rep, Date.now())
        revealScan.drawSettled()
        runeshapeScan.drawSettled()
        // code review 第 B 批:renderer 沒畫出最近的 rows(資料當時沒載好 / 世代改了)→ 該掃描下一 tick 重新 OCR 並照送
        if (rep.resend) (rep.source === 'reveal' ? revealScan : runeshapeScan).resendRows()
      }
    },
    // 設定頁顯示褻瀆自動辨識統計;預覽端不開放
    'reveal-stats': { kind: 'invoke', preview: false, fn: () => revealScan.snapshot() },
    // WP-R2:設定頁顯示掃描統計;預覽端不開放
    'runeshape-stats': { kind: 'invoke', preview: false, fn: () => runeshapeScan.snapshot() },
    // 第 29 步:設定 › 記錄 › 效能(狀態 / 開關 / 開記錄檔);都只給 Electron 視窗
    'perf-get': { kind: 'invoke', preview: false, fn: () => perfState() },
    'perf-set': {
      kind: 'invoke',
      preview: false,
      fn: async (_ctx, on: unknown) => {
        const want = on === true
        perfSetting = want
        try {
          await fs.mkdir(path.dirname(PERF_SETTING_PATH()), { recursive: true })
          await fs.writeFile(PERF_SETTING_PATH(), JSON.stringify({ enabled: want }, null, 2))
        } catch (e) {
          console.warn('[perf] perf.json 寫入失敗(這次執行仍套用)', e)
        }
        if (want) perf.start()
        else perf.stop()
        return perfState()
      }
    },
    'perf-open-file': {
      kind: 'invoke',
      preview: false,
      fn: async () => {
        const file = path.join(LOG_DIR(), perfFileName(Date.now()))
        await fs.mkdir(LOG_DIR(), { recursive: true })
        const err = await shell.openPath(fsSync.existsSync(file) ? file : LOG_DIR())
        if (err) throw new Error(err)
      }
    },
    ...updater.handlers()
  }
  registerIpc(table)

  // 第 29 步:效能診斷(`--perf-log` 或 perf.json 開著才啟動)
  if (PERF_ARG || perfSetting) {
    console.log(`[perf] 啟動即開效能診斷(${PERF_ARG ? '--perf-log' : '設定開關'})`)
    perf.start()
  }

  if (PREVIEW_ON_START) {
    ensurePreview()
      .then((srv) => { console.log(`[preview] --preview:${srv.url}`) })
      .catch((e) => { console.error('[preview] 啟動失敗', e) })
  }

  // 備援視窗模式的開發版直接顯示視窗方便看;正式版等熱鍵或托盤。overlay 由 OverlayController 控制顯示。
  if (DEV_URL && windowMode === 'window') win.show()
})
