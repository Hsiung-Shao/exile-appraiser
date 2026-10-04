/**
 * 自動更新的純邏輯(不 import electron / electron-updater;`main/test/updater-core.test.ts` 用假的 updater 測)。
 * `AppUpdater.ts` 把真的 `autoUpdater` 與 `app.getVersion()` 注入進來。
 *
 * 狀態流:
 * - 共同:initial → checking → available | not-available | error
 * - `autoUpdate` 開(預設)+ 安裝版:checking →(update-available)downloading → downloaded
 *   → 使用者結束程式時 electron-updater 靜默執行安裝程式(`autoInstallOnAppQuit`);或按「立即重啟並更新」= `quitAndInstall(true, true)`。
 * - `autoUpdate` 關:available →(使用者按下載)downloading → downloaded →(使用者按安裝)`quitAndInstall(false)`。
 * - portable / 非 Windows(`not-supported`):只檢查、不下載,UI 導去 Releases。`--no-updates`(`disabled-by-flag`):連檢查都不做。
 *
 * ⚠ electron-updater 只在「下載完成那一刻」`autoInstallOnAppQuit === true` 才註冊 quit handler(BaseUpdater.addQuitHandler),
 * 之後才改成 true 也不會裝。所以下載完成前旗標一律維持 true(安裝版),`update-downloaded` 之後(下一個 tick,
 * handler 已註冊)才依 `autoUpdate` 設成真正的值;quit handler 在結束當下才讀旗標,所以之後切換設定仍即時生效。
 */
import type { NoDownloadReason, UpdaterInfo } from '@ipc/types'

export const RELEASES_URL = 'https://github.com/Hsiung-Shao/exile-appraiser/releases'

export type SendUpdaterState = (info: UpdaterInfo) => void

/** electron-updater `autoUpdater` 用到的部分。 */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on: (event: string, listener: (...args: any[]) => void) => unknown
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
}

export interface UpdaterEnv {
  argv: readonly string[]
  /** `PORTABLE_EXECUTABLE_DIR`(electron-builder portable 啟動器設的)有值 = portable。 */
  portableDir?: string
  platform: string
  version: string
  /** 開發模式(`VITE_DEV_SERVER_URL`)。 */
  isDev: boolean
}

export interface UpdaterCoreDeps {
  updater: UpdaterLike
  env: UpdaterEnv
  send: SendUpdaterState
  log?: (msg: string) => void
  /** 延後到下一個 tick(預設 setImmediate);測試可換成手動佇列。 */
  defer?: (fn: () => void) => void
}

export function releaseTagUrl (version: string): string {
  return `${RELEASES_URL}/tag/v${version}`
}

export function resolveReason (env: Pick<UpdaterEnv, 'argv' | 'portableDir' | 'platform'>): NoDownloadReason {
  if (env.argv.includes('--no-updates')) return 'disabled-by-flag'
  if (env.portableDir || env.platform !== 'win32') return 'not-supported'
  return 'unsigned-build'
}

/**
 * electron-updater 兩個旗標該是什麼。
 * - `autoDownload`:只有安裝版且 `autoUpdate` 開。
 * - `autoInstallOnAppQuit`:安裝版在「還沒下載完」時一律 true(讓下載完成時 quit handler 註冊得上,見檔頭 ⚠);
 *   下載完之後 = `autoUpdate`。portable / 停用一律 false。
 */
export function updaterFlags (reason: NoDownloadReason, autoUpdate: boolean, downloaded: boolean): { autoDownload: boolean, autoInstallOnAppQuit: boolean } {
  if (reason !== 'unsigned-build') return { autoDownload: false, autoInstallOnAppQuit: false }
  return { autoDownload: autoUpdate, autoInstallOnAppQuit: downloaded ? autoUpdate : true }
}

/** 第 34 步:常駐時重新檢查更新的間隔(原本 16 小時)。 */
export const UPDATE_RECHECK_INTERVAL_MS = 2 * 60 * 60_000

/**
 * 第 34 步:定期重新檢查該不該做(每 `UPDATE_RECHECK_INTERVAL_MS` 呼叫一次)。
 * 啟動檢查還沒做過(還沒收到 host-config)、`--no-updates`、開發模式(沒加 `--force-update-check`)、
 * 已下載(不再檢查,維持「安裝」)、下載中 / 檢查中 → 不檢查。`error` / `not-available` / `available` / `initial` → 檢查。
 */
export function shouldPeriodicCheck (s: { startupChecked: boolean, reason: NoDownloadReason, isDev: boolean, forceCheck: boolean, state: UpdaterInfo['state'] }): boolean {
  if (!s.startupChecked) return false
  if (s.reason === 'disabled-by-flag') return false
  if (s.isDev && !s.forceCheck) return false
  return s.state !== 'downloaded' && s.state !== 'downloading' && s.state !== 'checking'
}

/** 錯誤只取第一行(electron-updater 的訊息常夾整份 HTTP 回應標頭),並粗分 404 / 網路 / 其他。 */
export function classifyError (err: unknown): { error: string, errorKind: NonNullable<UpdaterInfo['errorKind']> } {
  const raw = err instanceof Error ? err.message : String(err)
  const first = raw.split(/\r?\n/)[0].trim().slice(0, 300)
  const code = (err as { code?: string } | null)?.code
  // repo 已建但還沒有任何 Release 時,GitHub provider 回的是「No published versions on GitHub」(不是 404)
  if (/\b404\b|No published versions/i.test(raw) || code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') {
    return { error: first, errorKind: 'not-found' }
  }
  if (/net::|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH/i.test(raw)) {
    return { error: first, errorKind: 'network' }
  }
  return { error: first, errorKind: 'other' }
}

export class UpdaterCore {
  private _checkedAtStartup = false
  private _info: UpdaterInfo
  /** 設定 `autoUpdate`(預設 true;第一次 host-config 前就用預設值)。 */
  private _autoUpdate = true

  readonly reason: NoDownloadReason
  private readonly updatesDisabled: boolean
  private readonly isDev: boolean
  private readonly forceCheck: boolean
  private readonly log: (msg: string) => void
  private readonly defer: (fn: () => void) => void

  constructor (private readonly deps: UpdaterCoreDeps) {
    const { env, updater } = deps
    this.log = deps.log ?? ((m) => { console.log(m) })
    this.defer = deps.defer ?? ((fn) => { setImmediate(fn) })
    this.updatesDisabled = env.argv.includes('--no-updates')
    this.isDev = env.isDev
    this.forceCheck = env.argv.includes('--force-update-check')
    this.reason = resolveReason(env)
    this._info = { state: 'initial', reason: this.reason, autoUpdate: this._autoUpdate, currentVersion: env.version, releaseNotesUrl: RELEASES_URL }
    this.applyFlags()
    this.log(`[updater] reason=${this.reason} current=${env.version}${this.isDev ? ` dev${this.forceCheck ? '(--force-update-check)' : ''}` : ''}`)

    updater.on('checking-for-update', () => {
      this.set({ state: 'checking' })
    })
    updater.on('update-available', (info: { version: string }) => {
      // autoDownload 開著時 electron-updater 在同一個 checkForUpdates 裡接著就開始下載
      const downloading = updater.autoDownload
      this.set({ state: downloading ? 'downloading' : 'available', version: info.version, releaseNotesUrl: releaseTagUrl(info.version), checkedAt: Date.now() })
    })
    updater.on('update-not-available', () => {
      this.set({ state: 'not-available', version: undefined, releaseNotesUrl: RELEASES_URL, checkedAt: Date.now() })
    })
    updater.on('error', (err: unknown) => {
      this.setError(err)
    })
    updater.on('download-progress', (p: { percent: number }) => {
      this.log(`[updater] download ${p.percent.toFixed(0)}%`)
    })
    updater.on('update-downloaded', (info: { version: string, downloadedFile?: string }) => {
      this.log(`[updater] downloaded ${info.version} → ${info.downloadedFile ?? '(unknown path)'}`)
      this.set({ state: 'downloaded', version: info.version, releaseNotesUrl: releaseTagUrl(info.version) })
      // electron-updater 在這個事件之後才(同步)註冊 quit handler;下一個 tick 再把旗標設成真正的值
      this.defer(() => {
        this.applyFlags()
        this.log(`[updater] autoInstallOnAppQuit=${String(updater.autoInstallOnAppQuit)}(autoUpdate=${String(this._autoUpdate)})`)
      })
    })
  }

  get info (): UpdaterInfo { return this._info }
  get autoUpdate (): boolean { return this._autoUpdate }

  private applyFlags () {
    const f = updaterFlags(this.reason, this._autoUpdate, this._info.state === 'downloaded')
    this.deps.updater.autoDownload = f.autoDownload
    // 開發模式(--force-update-check + make-fake-update-feed 的假 exe)結束時絕不執行下載檔
    this.deps.updater.autoInstallOnAppQuit = f.autoInstallOnAppQuit && !this.isDev
  }

  private set (patch: Partial<UpdaterInfo>) {
    this._info = { ...this._info, error: undefined, errorKind: undefined, ...patch, reason: this.reason, autoUpdate: this._autoUpdate }
    const extra = [this._info.version, this._info.error ? `(${this._info.errorKind}) ${this._info.error}` : ''].filter(Boolean).join(' ')
    this.log(`[updater] updater-state ${this._info.state}${extra ? ' ' + extra : ''}`)
    this.deps.send(this._info)
  }

  private setError (err: unknown) {
    // 只寫 log、不彈對話框:repo / Release 尚未建立時的 404 是預期中的
    this.set({ state: 'error', ...classifyError(err), checkedAt: Date.now() })
  }

  /**
   * 設定 `autoUpdate` 變更(每次 host-config 都會呼叫;值沒變不做事)。
   * 打開時若已有「available 但沒下載」的新版,直接開始下載。
   */
  setAutoUpdate (enabled: boolean) {
    if (enabled === this._autoUpdate) return
    this._autoUpdate = enabled
    this.applyFlags()
    this.log(`[updater] autoUpdate=${String(enabled)} → autoDownload=${String(this.deps.updater.autoDownload)} autoInstallOnAppQuit=${String(this.deps.updater.autoInstallOnAppQuit)}`)
    this.set({})
    if (enabled && this._info.state === 'available') void this.download()
  }

  checkAtStartup () {
    if (this._checkedAtStartup) return
    this._checkedAtStartup = true
    void this.check()
  }

  /**
   * 第 34 步:常駐期間定期重新檢查(`AppUpdater` 每 2 小時呼叫;原本 16 小時)。條件見上方 `shouldPeriodicCheck`:
   * 啟動檢查做過之後才開始、已下載 / 下載中 / 檢查中 / `--no-updates` / 開發模式不檢查(不寫 log);失敗只由 'error' 事件記 log。
   */
  periodicCheck (): boolean {
    const go = shouldPeriodicCheck({ startupChecked: this._checkedAtStartup, reason: this.reason, isDev: this.isDev, forceCheck: this.forceCheck, state: this._info.state })
    if (go) {
      this.log(`[updater] 定期重新檢查(state=${this._info.state})`)
      void this.check()
    }
    return go
  }

  check = async (): Promise<void> => {
    if (this.updatesDisabled) {
      this.log('[updater] --no-updates:不檢查')
      return
    }
    if (this.isDev && !this.forceCheck) {
      this.log('[updater] 開發模式不檢查更新(要測請加 --force-update-check 並放 main/dev-app-update.yml)')
      return
    }
    // 檢查中/下載中不重入;已下載完就維持「安裝」提示,不重新檢查
    const s = this._info.state
    if (s === 'checking' || s === 'downloading' || s === 'downloaded') return
    try {
      const r = await this.deps.updater.checkForUpdates() as { downloadPromise?: Promise<unknown> | null } | null
      // autoDownload 時的下載 promise:失敗已由 'error' 事件歸類,這裡只防 unhandled rejection
      r?.downloadPromise?.catch(() => {})
    } catch (err) {
      // 通常 'error' 事件已處理;沒進過 checking 的失敗(例如設定檔讀不到)在這裡補
      const state = this._info.state as UpdaterInfo['state']
      if (state === 'checking' || state === 'initial') this.setError(err)
    }
  }

  /** 手動模式由使用者的 `updater-download` 觸發;`autoUpdate` 開著時由 electron-updater 自己下載。 */
  download = async (): Promise<void> => {
    if (this._info.state !== 'available') return
    if (this.reason !== 'unsigned-build') {
      this.log(`[updater] reason=${this.reason}:不提供一鍵下載,請到 ${this._info.releaseNotesUrl ?? RELEASES_URL}`)
      return
    }
    this.set({ state: 'downloading' })
    try {
      await this.deps.updater.downloadUpdate()
    } catch (err) {
      // 通常 'error' 事件已處理(狀態已是 error);沒發事件的失敗在這裡補
      if ((this._info.state as UpdaterInfo['state']) === 'downloading') this.setError(err)
    }
  }

  /**
   * `autoUpdate` 開:「立即重啟並更新」= 靜默安裝後自動重新啟動(`quitAndInstall(true, true)`)。
   * `autoUpdate` 關:沿用手動流程,顯示安裝程式畫面(`quitAndInstall(false)`,裝完照 electron-updater 預設重新啟動)。
   */
  install () {
    if (this._info.state !== 'downloaded') return
    if (this.isDev) {
      // 開發模式下載的是 make-fake-update-feed 的假 exe:絕不執行(第 34 步起提醒視窗也能觸發安裝)
      this.log('[updater] 開發模式不執行安裝程式(假更新來源)')
      return
    }
    const silent = this._autoUpdate
    this.log(`[updater] quitAndInstall(${silent ? 'silent, run after' : 'interactive'})`)
    if (silent) this.deps.updater.quitAndInstall(true, true)
    else this.deps.updater.quitAndInstall(false)
  }
}
