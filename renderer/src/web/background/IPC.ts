/**
 * 取代上游 `web/background/IPC.ts`(WebSocket + `/proxy/` HTTP 代理)。
 *
 * - 在 Electron 內:`window.host`(preload 的 contextBridge)。所有交易站請求都經 main process 的
 *   session fetch 送出,才帶得到 Cloudflare 的 cookie。
 * - 在純瀏覽器(`npm run dev` 直接開 5173 看 UI):沒有 host,`proxy` 直接用 `fetch`(會被 CORS/CF 擋,
 *   只夠看畫面),設定存 localStorage。
 */
import type { HostApi, HostFetchInit, HostFetchResult, ItemTextEvent, HostConfigForMain, FocusChangeEvent, TrackAreaOpts, WindowMode, GameId } from '@ipc/types'
import type { HotkeyRegistration, SettingsTabId, UpdaterInfo } from '@ipc/types'
import { shallowRef } from 'vue'
import type { HttpFetch } from '@exile-appraiser/core/http'
import { withRetryAfter } from '@exile-appraiser/core/http'

const LS_KEY = 'exile-appraiser.config'
const LS_REGEX_KEY = 'exile-appraiser.regex_state'

function toResponse (r: HostFetchResult): Response {
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers })
}

class HostTransport {
  get isElectron (): boolean { return window.host != null }
  get version (): string { return window.host?.version ?? 'dev' }
  /** 純瀏覽器(沒有 host)一律當備援視窗版面。 */
  get windowMode (): WindowMode { return window.host?.windowMode ?? 'window' }
  get isOverlay (): boolean { return this.windowMode === 'overlay' }

  /**
   * 最近一次送出的交易站查詢(POST `/api/trade{,2}/search|exchange/…` 的 body),一鍵回報附上「實際送出的查詢」用。
   * 只記 body 與網址,不記回應。
   */
  readonly lastTradeQuery = shallowRef<{ url: string, body: unknown, at: number } | null>(null)

  /** 與 `fetch` 同形狀;交易層透過 `httpFetch` 拿到裝了 429 重試的版本。 */
  proxy = async (url: string, init?: HostFetchInit): Promise<Response> => {
    if (init?.method === 'POST' && init.body && /\/api\/trade2?\/(search|exchange)\//.test(url)) {
      try { this.lastTradeQuery.value = { url, body: JSON.parse(init.body), at: Date.now() } } catch {}
    }
    if (window.host) return toResponse(await window.host.fetch(url, init))
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

  onVisibility (cb: (e: { isVisible: boolean }) => void): () => void {
    return window.host?.onVisibility(cb) ?? (() => {})
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
}

export const MainProcess = new HostTransport()
export const Host: HostTransport & Pick<HostApi, never> = MainProcess
