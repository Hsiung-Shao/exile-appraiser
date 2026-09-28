/**
 * 自動更新(electron-updater + GitHub Releases)。移植自 apt-patched `main/src/AppUpdater.ts`,
 * 差別:APT 走 WebSocket broadcast,這裡用 `webContents.send('updater-state')` + `ipcMain.handle`。
 *
 * 狀態流:initial → checking → available | not-available | error;
 *         available →(使用者按下載)downloading → downloaded →(使用者按安裝)quitAndInstall。
 *
 * - 啟動後第一次收到 host-config 時檢查一次(`checkAtStartup`),之後每 16 小時。
 * - `--no-updates`:連檢查都不做(`disabled-by-flag`)。
 * - 開發模式(`VITE_DEV_SERVER_URL`)不檢查,只記 log;`--force-update-check` 可繞過(會讀 main/dev-app-update.yml,
 *   離線驗證用,見 `main/dev-app-update.yml.example` 與 `scripts/make-fake-update-feed.mjs`)。
 * - GitHub repo / Release 還不存在時檢查會 404:歸類成 `error`(errorKind `not-found`)**只寫 log,不彈對話框**。
 */
import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { NoDownloadReason, UpdaterInfo } from '@ipc/types'

const RELEASES_URL = 'https://github.com/Hsiung-Shao/exile-appraiser/releases'
const CHECK_INTERVAL_MS = 16 * 60 * 60 * 1000

export type SendUpdaterState = (info: UpdaterInfo) => void

function releaseTagUrl (version: string): string {
  return `${RELEASES_URL}/tag/v${version}`
}

/** 錯誤只取第一行(electron-updater 的訊息常夾整份 HTTP 回應標頭),並粗分 404 / 網路 / 其他。 */
function classifyError (err: unknown): { error: string, errorKind: NonNullable<UpdaterInfo['errorKind']> } {
  const raw = err instanceof Error ? err.message : String(err)
  const first = raw.split(/\r?\n/)[0].trim().slice(0, 300)
  const code = (err as { code?: string } | null)?.code
  if (/\b404\b/.test(raw) || code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') {
    return { error: first, errorKind: 'not-found' }
  }
  if (/net::|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH/i.test(raw)) {
    return { error: first, errorKind: 'network' }
  }
  return { error: first, errorKind: 'other' }
}

export class AppUpdater {
  private _checkedAtStartup = false
  private _info: UpdaterInfo

  /** `--no-updates` 時連檢查都不做(見下方 autoDownload 的說明)。 */
  private readonly updatesDisabled = process.argv.includes('--no-updates')
  /** 開發模式預設不檢查;`--force-update-check` 讓 electron-updater 讀 dev-app-update.yml(離線驗證)。 */
  private readonly isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
  private readonly forceCheck = process.argv.includes('--force-update-check')

  public readonly reason: NoDownloadReason

  constructor (private readonly send: SendUpdaterState) {
    /*
     * **永不自動下載,但使用者按下就可以下載安裝。**(理由照抄 apt-patched)
     *
     * 上游偵測到更新就在背景自己下載、關閉時安裝,使用者全程不知情。本專案
     * 沒有 code signing 憑證(⚠ 上游其實也沒有,官方安裝檔一樣是 NotSigned),
     * 那樣等於「任何能寫入 Release 的人可以在所有使用者機器上執行任意程式」,
     * 而且完全沒有一個環節需要使用者同意。
     *
     * 所以這裡把「自動」拆成「一鍵」:autoDownload 恆為 false,改由 UI 的
     * `download-update` 動作觸發 `downloadUpdate()`。差別不在於能不能被攻擊
     * (被掉包的 Release 兩種都會中),而在於**程式不會自作主張抓東西執行**。
     *
     * 下載本身由 electron-updater 比對 `latest.yml` 裡的 sha512,
     * 檔案在傳輸中被改會被擋下。擋不住的是發布來源本身被攻陷。
     *
     * portable 與 macOS 沒有就地安裝的能力,維持上游的 `not-supported`
     * —— 那條 UI 分支會引導使用者去 Releases 頁自己下載。
     */
    autoUpdater.autoDownload = false
    // 同一原則:使用者沒按「安裝」就結束程式時,不要偷偷裝。
    autoUpdater.autoInstallOnAppQuit = false
    // 只出貨完整的 nsis 安裝檔,沒有 web installer(不設會每次下載都印警告)
    autoUpdater.disableWebInstaller = true
    autoUpdater.logger = {
      info: (m?: unknown) => { console.log('[updater]', m) },
      warn: (m?: unknown) => { console.warn('[updater]', m) },
      // 錯誤另由 'error' 事件歸類記一行;這裡只留第一行(全文夾整份回應標頭)
      error: (m?: unknown) => { console.log('[updater] (detail)', String(m).split(/\r?\n/)[0]) },
      debug: () => {}
    }
    if (this.isDev && this.forceCheck) autoUpdater.forceDevUpdateConfig = true

    this.reason =
      this.updatesDisabled
        ? 'disabled-by-flag'
        : (process.env.PORTABLE_EXECUTABLE_DIR || process.platform !== 'win32')
            ? 'not-supported'
            : 'unsigned-build'

    this._info = { state: 'initial', reason: this.reason, currentVersion: app.getVersion(), releaseNotesUrl: RELEASES_URL }
    console.log(`[updater] reason=${this.reason} current=${app.getVersion()}${this.isDev ? ` dev${this.forceCheck ? '(--force-update-check)' : ''}` : ''}`)

    autoUpdater.on('checking-for-update', () => {
      this.set({ state: 'checking' })
    })
    autoUpdater.on('update-available', (info: { version: string }) => {
      this.set({ state: 'available', version: info.version, releaseNotesUrl: releaseTagUrl(info.version), checkedAt: Date.now() })
    })
    autoUpdater.on('update-not-available', () => {
      this.set({ state: 'not-available', version: undefined, releaseNotesUrl: RELEASES_URL, checkedAt: Date.now() })
    })
    autoUpdater.on('error', (err: unknown) => {
      this.setError(err)
    })
    autoUpdater.on('download-progress', (p: { percent: number }) => {
      console.log(`[updater] download ${p.percent.toFixed(0)}%`)
    })
    autoUpdater.on('update-downloaded', (info: { version: string, downloadedFile?: string }) => {
      console.log(`[updater] downloaded ${info.version} → ${info.downloadedFile ?? '(unknown path)'}`)
      this.set({ state: 'downloaded', version: info.version, releaseNotesUrl: releaseTagUrl(info.version) })
    })

    setInterval(() => { void this.check() }, CHECK_INTERVAL_MS).unref()

    ipcMain.handle('updater-info', () => this._info)
    ipcMain.handle('updater-check', () => this.check())
    ipcMain.handle('updater-download', () => this.download())
    ipcMain.handle('updater-install', () => { this.install() })
  }

  get info (): UpdaterInfo { return this._info }
  private currentState (): UpdaterInfo['state'] { return this._info.state }

  private set (patch: Partial<UpdaterInfo>) {
    this._info = { ...this._info, error: undefined, errorKind: undefined, ...patch, reason: this.reason }
    const extra = [this._info.version, this._info.error ? `(${this._info.errorKind}) ${this._info.error}` : ''].filter(Boolean).join(' ')
    console.log(`[updater] updater-state ${this._info.state}${extra ? ' ' + extra : ''}`)
    this.send(this._info)
  }

  private setError (err: unknown) {
    // 只寫 log、不彈對話框:repo / Release 尚未建立時的 404 是預期中的
    this.set({ state: 'error', ...classifyError(err), checkedAt: Date.now() })
  }

  checkAtStartup () {
    if (this._checkedAtStartup) return
    this._checkedAtStartup = true
    void this.check()
  }

  check = async (): Promise<void> => {
    if (this.updatesDisabled) {
      console.log('[updater] --no-updates:不檢查')
      return
    }
    if (this.isDev && !this.forceCheck) {
      console.log('[updater] 開發模式不檢查更新(要測請加 --force-update-check 並放 main/dev-app-update.yml)')
      return
    }
    // 檢查中/下載中不重入;已下載完就維持「安裝」提示,不重新檢查
    if (this._info.state === 'checking' || this._info.state === 'downloading' || this._info.state === 'downloaded') return
    try {
      // 只抓 latest.yml 比版號。那是純資料、不執行,風險等同一般網頁請求;
      // 會下載並執行 exe 的那一步要等使用者按下 `download-update`。
      await autoUpdater.checkForUpdates()
    } catch (err) {
      // 通常 'error' 事件已處理;沒進過 checking 的失敗(例如設定檔讀不到)在這裡補
      // (await 之後狀態可能已被事件改掉,另取一次避開 TS 的窄化)
      const state = this.currentState()
      if (state === 'checking' || state === 'initial') this.setError(err)
    }
  }

  /** 只由使用者的 `updater-download` 動作觸發,絕不自動呼叫。 */
  download = async (): Promise<void> => {
    if (this._info.state !== 'available') return
    if (this.reason !== 'unsigned-build') {
      console.log(`[updater] reason=${this.reason}:不提供一鍵下載,請到 ${this._info.releaseNotesUrl}`)
      return
    }
    this.set({ state: 'downloading' })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.setError(err)
    }
  }

  install () {
    if (this._info.state !== 'downloaded') return
    console.log('[updater] quitAndInstall')
    autoUpdater.quitAndInstall(false)
  }
}
