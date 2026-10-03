/**
 * 取代上游 `web/background/IPC.ts`(WebSocket + `/proxy/` HTTP 代理)。
 *
 * - 在 Electron 內:`window.host`(preload 的 contextBridge)。所有交易站請求都經 main process 的
 *   session fetch 送出,才帶得到 Cloudflare 的 cookie。
 * - 在純瀏覽器(`npm run dev` 直接開 5173 看 UI):沒有 host,`proxy` 直接用 `fetch`(會被 CORS/CF 擋,
 *   只夠看畫面),設定存 localStorage。
 * - 瀏覽器預覽(main 的 preview-server,docs/browser-preview.md):boot script 造的 `window.host` shim(`isPreview: true`),
 *   方法經 RPC 到 main,與 Electron 內行為相同(設定寫同一份 config.json);視窗控制類是 no-op。
 */
import type { HostApi, HostFetchResult, ItemTextEvent, HostConfigForMain, FocusChangeEvent, TrackAreaOpts, WindowMode, GameId } from '@ipc/types'
import type { ConfigChangedEvent, HotkeyRegistration, OcrAvailability, OcrRegionPickTarget, RevealScanEvent, SettingsTabId, UpdaterInfo } from '@ipc/types'
import type { LogEntry, LogSnapshot, PerfState, RuneshapeScanEvent, RuneshapeStats, RuneshapeUiState, ScanMaskReport } from '@ipc/types'
import { shallowRef } from 'vue'
import type { HttpFetch } from '@exile-appraiser/core/http'
import { withRetryAfter } from '@exile-appraiser/core/http'
import { fetchViaHost, type ProxyInit } from './host-fetch'

const LS_KEY = 'exile-appraiser.config'
const LS_REGEX_KEY = 'exile-appraiser.regex_state'
const LS_DUST_KEY = 'exile-appraiser.dust_ui'

function toResponse (r: HostFetchResult): Response {
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers })
}

class HostTransport {
  get isElectron (): boolean { return window.host != null }
  get version (): string { return window.host?.version ?? 'dev' }
  /** 純瀏覽器(沒有 host)一律當備援視窗版面。 */
  get windowMode (): WindowMode { return window.host?.windowMode ?? 'window' }
  get isOverlay (): boolean { return this.windowMode === 'overlay' }
  /** 在一般瀏覽器裡透過 main 的預覽伺服器執行(不是 Electron 視窗)。 */
  get isPreview (): boolean { return window.host?.isPreview === true }

  /**
   * 最近一次送出的交易站查詢(POST `/api/trade{,2}/search|exchange/…` 的 body),一鍵回報附上「實際送出的查詢」用。
   * 只記 body 與網址,不記回應。
   */
  readonly lastTradeQuery = shallowRef<{ url: string, body: unknown, at: number } | null>(null)

  /**
   * 與 `fetch` 同形狀;交易層透過 `httpFetch` 拿到裝了 429 重試的版本。
   * `init.signal`:經 main 代理時轉成 `requestId` + `http-abort`(`host-fetch.ts`);main 端另有 30 秒預設逾時。
   */
  proxy = async (url: string, init?: ProxyInit): Promise<Response> => {
    if (init?.method === 'POST' && init.body && /\/api\/trade2?\/(search|exchange)\//.test(url)) {
      try { this.lastTradeQuery.value = { url, body: JSON.parse(init.body), at: Date.now() } } catch {}
    }
    if (window.host) return toResponse(await fetchViaHost(window.host, url, init))
    return fetch(url, init)
  }

  /**
   * 429 Retry-After 等待事件(面板頂端 --warn 細條倒數用)。每次等待都換一個新物件(`seq` 遞增),
   * 同秒數連續兩次也會觸發 watch。
   */
  readonly rateLimitWait = shallowRef<{ seconds: number, seq: number }>({ seconds: 0, seq: 0 })

  /** 最近一次 Retry-After 等待秒數(唯讀;要跟著變化請 watch `rateLimitWait`)。 */
  get rateLimitWaitSeconds (): number { return this.rateLimitWait.value.seconds }

  /** 交給 core 交易層的 HttpFetch(含 Retry-After 一次重試)。 */
  httpFetch: HttpFetch = withRetryAfter(async (url, init) => await this.proxy(url, init), {
    onWait: (s) => { this.rateLimitWait.value = { seconds: s, seq: this.rateLimitWait.value.seq + 1 } }
  })

  async loadConfig (): Promise<string | null> {
    if (window.host) return window.host.loadConfig()
    try { return localStorage.getItem(LS_KEY) } catch { return null }
  }

  async saveConfig (contents: string): Promise<void> {
    if (window.host) return window.host.saveConfig(contents)
    try { localStorage.setItem(LS_KEY, contents) } catch {}
  }

  // ---- Poe Regex 面板狀態(main 寫 userData/regex_state.json;純瀏覽器用 localStorage) ----
  async regexStateLoad (): Promise<string | null> {
    if (window.host) return window.host.regexStateLoad()
    try { return localStorage.getItem(LS_REGEX_KEY) } catch { return null }
  }

  async regexStateSave (contents: string): Promise<void> {
    if (window.host) return window.host.regexStateSave(contents)
    try { localStorage.setItem(LS_REGEX_KEY, contents) } catch {}
  }

  // ---- 拆粉排行面板狀態(main 寫 userData/dust_ui.json;純瀏覽器用 localStorage) ----
  async dustUiLoad (): Promise<string | null> {
    if (window.host?.dustUiLoad) return window.host.dustUiLoad()
    try { return localStorage.getItem(LS_DUST_KEY) } catch { return null }
  }

  async dustUiSave (contents: string): Promise<void> {
    if (window.host?.dustUiSave) return window.host.dustUiSave(contents)
    try { localStorage.setItem(LS_DUST_KEY, contents) } catch {}
  }

  // ---- poe.ninja 價格表快取(main 寫 userData/cache/ninja/<game>_<league>.json;純瀏覽器只存在記憶體) ----
  private readonly ninjaMemory = new Map<string, string>()

  async ninjaCacheLoad (game: GameId, league: string): Promise<string | null> {
    if (window.host?.ninjaCacheLoad) return window.host.ninjaCacheLoad(game, league)
    return this.ninjaMemory.get(`${game}|${league}`) ?? null
  }

  async ninjaCacheSave (game: GameId, league: string, contents: string): Promise<void> {
    if (window.host?.ninjaCacheSave) return window.host.ninjaCacheSave(game, league, contents)
    this.ninjaMemory.set(`${game}|${league}`, contents)
  }

  /** 送設定給 main,回傳熱鍵註冊結果;純瀏覽器沒有 main → `null`。 */
  async updateHostConfig (cfg: HostConfigForMain): Promise<HotkeyRegistration | null> {
    if (!window.host) return null
    return await window.host.updateHostConfig(cfg)
  }

  onItemText (cb: (e: ItemTextEvent) => void): () => void {
    return window.host?.onItemText(cb) ?? (() => {})
  }

  onFocusChange (cb: (e: FocusChangeEvent) => void): () => void {
    return window.host?.onFocusChange(cb) ?? (() => {})
  }

  onHideWidget (cb: () => void): () => void {
    return window.host?.onHideWidget(cb) ?? (() => {})
  }

  onSwitchGame (cb: (game: GameId) => void): () => void {
    return window.host?.onSwitchGame(cb) ?? (() => {})
  }

  onOpenSettings (cb: (e: { tab: SettingsTabId }) => void): () => void {
    return window.host?.onOpenSettings?.(cb) ?? (() => {})
  }

  trackArea (opts: TrackAreaOpts): void { window.host?.trackArea(opts) }
  focusGame (): void { window.host?.focusGame() }
  usedRecently (isOverlay: boolean): void { window.host?.usedRecently(isOverlay) }

  async openExternal (url: string): Promise<void> {
    if (window.host) return window.host.openExternal(url)
    window.open(url, '_blank')
  }

  async openCaptcha (url: string): Promise<void> {
    if (window.host) return window.host.openCaptcha(url)
    window.open(url, '_blank')
  }

  async hideWindow (): Promise<void> { await window.host?.hideWindow() }
  async resizeWindow (w: number, h: number): Promise<void> { await window.host?.resizeWindow(w, h) }

  /** 設定視窗「結束程式」可用:只有 Electron 視窗(預覽端 / 純瀏覽器沒有 `app-quit`)。 */
  get canQuit (): boolean { return !this.isPreview && typeof window.host?.appQuit === 'function' }
  async appQuit (): Promise<void> { if (this.canQuit) await window.host?.appQuit?.() }

  /** 自訂背景圖:只有 Electron 視窗能開檔案對話框(預覽 / 純瀏覽器沒有) */
  get canPickBg (): boolean { return !this.isPreview && typeof window.host?.bgPick === 'function' }
  /** 檔案對話框選圖 → main 複製到 userData/backgrounds → 檔名;取消 / 失敗 / 不支援 → null */
  async bgPick (): Promise<string | null> { return this.canPickBg ? (await window.host?.bgPick?.()) ?? null : null }

  // ---- 自動更新(main/src/AppUpdater.ts)。純瀏覽器沒有更新器:一律「不支援」。 ----
  async getUpdaterInfo (): Promise<UpdaterInfo> {
    if (window.host) return window.host.getUpdaterInfo()
    return { state: 'not-available', reason: 'not-supported' }
  }

  async checkForUpdate (): Promise<void> { await window.host?.checkForUpdate() }
  async downloadUpdate (): Promise<void> { await window.host?.downloadUpdate() }
  async installUpdate (): Promise<void> { await window.host?.installUpdate() }

  onUpdaterState (cb: (info: UpdaterInfo) => void): () => void {
    return window.host?.onUpdaterState(cb) ?? (() => {})
  }

  // ---- 瀏覽器預覽同步(main 在 config-save 後廣播;自己存的不會收到) ----
  onConfigChanged (cb: (e: ConfigChangedEvent) => void): () => void {
    return window.host?.onConfigChanged?.(cb) ?? (() => {})
  }

  /** 啟動(或沿用)預覽伺服器並用預設瀏覽器開啟;純瀏覽器沒有 main → null。 */
  async openPreview (): Promise<{ url: string } | null> {
    if (!window.host?.openPreview) return null
    return await window.host.openPreview()
  }

  /** 系統字體清單(設定 › 徽章外觀);純瀏覽器 / 失敗 → [] */
  async listFonts (): Promise<string[]> {
    try {
      const r = await window.host?.listFonts?.()
      return Array.isArray(r) ? r.filter((n): n is string => typeof n === 'string') : []
    } catch (e) {
      console.warn('[fonts] 讀系統字體失敗', e)
      return []
    }
  }

  async getPreviewUrl (): Promise<string | null> {
    if (!window.host?.getPreviewUrl) return null
    return await window.host.getPreviewUrl()
  }

  // ---- 第 28 步:設定 › 記錄(main/src/app-log.ts) ----
  /** 記錄快照(帶 `sinceSeq` 只回較新的);純瀏覽器沒有 main → 空 */
  async getLog (sinceSeq?: number): Promise<LogSnapshot> {
    return (await window.host?.getLog?.(sinceSeq)) ?? { entries: [], lastSeq: 0 }
  }

  /** 記錄分頁開 / 關:通知 main 要不要送 `log-lines`(預覽端 no-op) */
  logSubscribe (on: boolean): void { window.host?.logSubscribe?.(on) }
  onLogLines (cb: (entries: LogEntry[]) => void): () => void {
    return window.host?.onLogLines?.(cb) ?? (() => {})
  }

  /** 預覽端收不到 `log-lines`(不在 PREVIEW_EVENTS),記錄分頁要改輪詢 */
  get logIsPolled (): boolean { return this.isPreview || typeof window.host?.onLogLines !== 'function' }
  /** 開記錄資料夾:只有 Electron 視窗(預覽 / 純瀏覽器沒有) */
  get canOpenLogFolder (): boolean { return !this.isPreview && typeof window.host?.openLogFolder === 'function' }
  async openLogFolder (): Promise<void> { if (this.canOpenLogFolder) await window.host?.openLogFolder?.() }

  // ---- 第 29 步:設定 › 記錄 › 效能(main/src/perf/perf-monitor.ts;只有 Electron 視窗) ----
  get canPerf (): boolean { return !this.isPreview && typeof window.host?.perfGet === 'function' }
  async perfGet (): Promise<PerfState | null> { return this.canPerf ? ((await window.host?.perfGet?.()) ?? null) : null }
  async perfSet (on: boolean): Promise<PerfState | null> { return this.canPerf ? ((await window.host?.perfSet?.(on)) ?? null) : null }
  async perfOpenFile (): Promise<void> { if (this.canPerf) await window.host?.perfOpenFile?.() }

  // ---- 靈魂之井揭露面板(褻瀆)自動辨識(main/src/ocr/reveal-scan.ts;只有 overlay 會收到事件) ----
  onRevealScanResult (cb: (e: RevealScanEvent) => void): () => void {
    return window.host?.onRevealScanResult?.(cb) ?? (() => {})
  }

  async revealStats (): Promise<RuneshapeStats | undefined> {
    return await window.host?.revealStats?.()
  }

  /** 純瀏覽器 / 預覽端 → undefined(無從檢查)。 */
  async ocrRevealAvailable (): Promise<OcrAvailability | undefined> {
    if (!window.host?.ocrRevealAvailable) return undefined
    return await window.host.ocrRevealAvailable()
  }

  // ---- WP-S2:在遊戲畫面上框選 OCR 區域(overlay 限定;預覽端 / 純瀏覽器 no-op) ----
  /** overlay 取得焦點(可點擊),框選層開啟時呼叫 */
  async overlayActivate (): Promise<void> { await window.host?.overlayActivate?.() }
  /** 框選確認後請褻瀆自動辨識立刻重看;main 判斷不適用時回 false */
  async ocrRevealNow (): Promise<boolean | undefined> { return await window.host?.ocrRevealNow?.() }
  /** 框選熱鍵:`hotkeyOcrRegion`(target 省略 = 揭露面板)、`hotkeyRuneshapeRegion`(target = runeshape,2026-10-01) */
  onOcrRegionPick (cb: (target?: OcrRegionPickTarget) => void): () => void {
    return window.host?.onOcrRegionPick?.(cb) ?? (() => {})
  }

  // ---- WP-R2:符文塑形面板自動查價(overlay 限定;預覽端 / 純瀏覽器 no-op) ----
  onRuneshapeScanResult (cb: (e: RuneshapeScanEvent) => void): () => void {
    return window.host?.onRuneshapeScanResult?.(cb) ?? (() => {})
  }

  /** 查價面板 / 設定 / 框選層開著 → main 暫停掃描 */
  runeshapeUiState (s: RuneshapeUiState): void { window.host?.runeshapeUiState?.(s) }

  async runeshapeStats (): Promise<RuneshapeStats | undefined> {
    return await window.host?.runeshapeStats?.()
  }

  /** 第 18 步:畫在遊戲上的徽章 / 提示外框(main 擷取後遮掉;overlay/scan-mask.ts) */
  scanMask (r: ScanMaskReport): void { window.host?.scanMask?.(r) }
}

export const MainProcess = new HostTransport()
export const Host: HostTransport & Pick<HostApi, never> = MainProcess
