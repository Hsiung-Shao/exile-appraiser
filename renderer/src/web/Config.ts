/**
 * 設定(取代上游 `web/Config.ts`)。
 *
 * 移植來的 Vue 元件仍呼叫 `AppConfig()`(取 language / fontSize / leagueId / accountName / useIntlSite)
 * (`fontSize` 現在是 `fsBase` 的唯讀別名,不進檔)
 * 與 `AppConfig<PriceCheckWidget>('price-check')`,所以這裡保留同名 API;
 * 但底層模型改成本專案的 realm 模型:
 * - `realm: 'intl' | 'tw'`(上游是 `pc-ggg | pc-garena` + `useIntlSite` 開關)
 * - `useIntlSite` 變成由 realm + language **推導**的唯讀屬性
 * - `leagueId` 按 game + realm 分開存(`leagueBy[game][realm]`;切區/切遊戲不會把別處的聯盟名帶過來)
 * - `game: poe1 | poe2` 決定載入哪個 adapter(main.ts 監看它重載資料與 app_i18n)
 * - `language` = 遊戲客戶端語言(決定資料集與剪貼簿解析);`uiLanguage` = 介面字串語言,兩者分開
 * - `theme` / `accent` / `fsBase` = 外觀(src/web/useTheme.ts 寫到 <html>)
 */
import { reactive, shallowRef, watch } from 'vue'
import { REALMS, useEnglishNames, type Game, type Language, type Realm } from '@exile-appraiser/core/realm'
import type { PriceCheckWidget } from './overlay/interfaces'
import type { HostConfigForMain, HotkeyRegistration, OcrRegion } from '@ipc/types'
import { Host } from './background/IPC'
import { clampFsBase, normAccent, normTheme, DEFAULT_FS_BASE, type Theme } from './useTheme'

/** 介面字串語言(與客戶端語言 `language` 分開)。 */
export type UiLanguage = 'cmn-Hant' | 'en'

/** 全新啟動(沒有設定檔)時的介面語言:系統語系是中文就繁中,否則英文。 */
function systemUiLanguage (): UiLanguage {
  const lang = typeof navigator !== 'undefined' ? navigator.language : ''
  return /^zh/i.test(lang) ? 'cmn-Hant' : 'en'
}

export interface Config {
  configVersion: number
  game: Game
  realm: Realm
  language: Language
  /** 介面語言;舊設定檔沒有這欄 → 沿用 `language`。 */
  uiLanguage: UiLanguage
  /** 主題(`<html data-theme>`)。 */
  theme: Theme
  /** 強調色 `#rrggbb`;空字串 = 跟主題。 */
  accent: string
  /** 基準字級 px(11–18,`--fs-base`);舊設定檔的 `fontSize: 16` → 13。 */
  fsBase: number
  /** 聯盟選擇,依遊戲再依伺服器區分開存(舊版 `leagueByRealm` 讀檔時併入 `poe1`)。 */
  leagueBy: Record<Game, Partial<Record<Realm, string>>>
  accountName: string
  restoreClipboard: boolean
  /** 快速查價主鍵(APT 語意:不含修飾鍵,如 `D`);實際熱鍵 = hotkeyHold + hotkey。 */
  hotkey: string
  /** 快速查價按住的修飾鍵(`Ctrl` / `Alt`);放開後移動滑鼠面板就關。 */
  hotkeyHold: string
  /** 鎖定查價(面板可點擊、不隨滑鼠消失)。 */
  hotkeyLocked: string
  /** 切換 overlay / 遊戲焦點。 */
  overlayKey: string
  /** 每款遊戲 overlay 附著的視窗標題(精確比對;舊版單一 `windowTitle` 讀檔時併入當時 game 那格)。 */
  windowTitleBy: Record<Game, string>
  /** 偵測到另一款遊戲視窗(且目前這款不在)就自動切換(overlay 模式由 main 重新啟動)。 */
  autoSwitchGame: boolean
  /** overlay 模式(false = 獨立小視窗備援);變更時 main 立即重新啟動。 */
  overlayMode: boolean
  /** 點 overlay 透明背景 = 關閉面板(APT `overlayBackgroundClose`)。 */
  overlayBackgroundClose: boolean
  priceCheck: PriceCheckWidget
  /** WP-S:PoE2 靈魂之井揭露面板熱鍵(overlay 模式 + PoE2 + 自動辨識開著才註冊;空字串 = 不註冊)。2026-10-01 起 = 暫停 / 繼續褻瀆自動辨識。 */
  hotkeyOcrReveal: string
  /** 2026-10-01:褻瀆(揭露面板)自動持續辨識(預設開;舊設定檔沒有 = 開)。 */
  revealAutoEnabled: boolean
  /** 2026-10-01:褻瀆自動辨識掃描間隔 ms(500–3000,預設 1000)。 */
  revealIntervalMs: number
  /** WP-S:OCR 搜尋範圍(client 比例 0–1);null = 整個遊戲畫面自動找面板。 */
  ocrRegion: OcrRegion | null
  /** WP-S2:在遊戲畫面上框選 OCR 區域的熱鍵(預設空 = 不註冊;overlay 模式 + PoE2 才註冊)。 */
  hotkeyOcrRegion: string
  /** WP-R2:PoE2 符文塑形面板自動查價(預設關;overlay + PoE2 + 已框選區域才掃描)。 */
  runeshapeEnabled: boolean
  /** WP-R2:符文塑形面板區域(client 比例 0–1);null = 未框選。 */
  runeshapeRegion: OcrRegion | null
  /** WP-R2:掃描間隔 ms(500–3000,預設 1000)。 */
  runeshapeIntervalMs: number
  /** WP-R2:徽章顏色門檻(崇高石):< low 暗色、≥ high 金色、之間一般。 */
  runeshapeThresholds: RuneshapeThresholds
  /** WP-R2:暫停 / 繼續自動查價的熱鍵(預設空 = 不註冊)。 */
  hotkeyRuneshapeToggle: string
  /** 自動更新(預設 true):安裝版背景下載、結束程式時靜默套用;false = 手動下載 / 安裝(main/src/updater-core.ts)。 */
  autoUpdate: boolean
  /** 啟動時短暫顯示「已在背景執行」提示(預設 true;main/src/startup-toast.ts)。 */
  startupToast: boolean
  // ---- 相容上游元件的推導屬性 ----
  readonly useIntlSite: boolean
  /** 上游元件讀的字級;= `fsBase`(不進檔)。 */
  readonly fontSize: number
  leagueId: string | undefined
}

export function defaultPriceCheck (): PriceCheckWidget {
  return {
    showRateLimitState: false,
    apiLatencySeconds: 2,
    collapseListings: 'api',
    smartInitialSearch: true,
    lockedInitialSearch: true,
    activateStockFilter: false,
    builtinBrowser: false,
    showSeller: false,
    searchStatRange: 10,
    showCursor: true,
    requestPricePrediction: false,
    merchantOnly: true,
    defaultCurrency: null,
    // PoE2 欄位:預設值照 Exiled Exchange 2 的 PriceCheckWindow.vue
    rememberCurrency: false,
    defaultAllSelected: false,
    itemHoverTooltip: 'keybind',
    alwaysShowTier: false,
    coreCurrency: 'exalted',
    currencyVolume: 'both',
    rememberListingType: false,
    initialDelay: 48,
    savedAugments: {}
  }
}

export const DEFAULT_WINDOW_TITLE: Readonly<Record<Game, string>> = { poe1: 'Path of Exile', poe2: 'Path of Exile 2' }

/** WP-S:靈魂之井揭露面板 OCR 預設熱鍵(當初為了避開已移除的「按住 Alt 藏 overlay」選了不含 Alt 的組合,沿用不改)。 */
export const DEFAULT_HOTKEY_OCR_REVEAL = 'Ctrl + Shift + R'

/** OCR 範圍:四個 0–1 的有限數且寬高 > 0 才算數,其餘 → null(整個畫面)。 */
export function normOcrRegion (v: unknown): OcrRegion | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const nums = [r.x, r.y, r.w, r.h]
  if (!nums.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return null
  const [x, y, w, h] = nums as number[]
  if (w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) return null
  return { x, y, w, h }
}

/** WP-R2:徽章顏色門檻(單位:崇高石) */
export interface RuneshapeThresholds {
  low: number
  high: number
}
export const DEFAULT_RUNESHAPE_THRESHOLDS: Readonly<RuneshapeThresholds> = { low: 0.5, high: 5 }
export const DEFAULT_RUNESHAPE_INTERVAL_MS = 1000

/** WP-R2:掃描間隔 500–3000 ms(main `clampScanInterval` 同規則);不是數字 → 1000 */
export function clampRuneshapeInterval (v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_RUNESHAPE_INTERVAL_MS
  return Math.min(3000, Math.max(500, Math.round(v)))
}

/** WP-R2:門檻正規化:兩個非負有限數,high < low 時對調;壞掉 → 預設 */
export function normRuneshapeThresholds (v: unknown): RuneshapeThresholds {
  if (!v || typeof v !== 'object') return { ...DEFAULT_RUNESHAPE_THRESHOLDS }
  const r = v as Record<string, unknown>
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  const low = ok(r.low) ? r.low : DEFAULT_RUNESHAPE_THRESHOLDS.low
  const high = ok(r.high) ? r.high : DEFAULT_RUNESHAPE_THRESHOLDS.high
  return high < low ? { low: high, high: low } : { low, high }
}

function createConfig (): Config {
  const base = {
    configVersion: 1,
    game: 'poe1' as Game,
    realm: 'intl' as Realm,
    language: 'cmn-Hant' as Language,
    uiLanguage: systemUiLanguage(),
    theme: 'slate' as Theme,
    accent: '',
    fsBase: DEFAULT_FS_BASE,
    leagueBy: { poe1: {}, poe2: {} } as Record<Game, Partial<Record<Realm, string>>>,
    accountName: '',
    restoreClipboard: false,
    hotkey: 'D',
    hotkeyHold: 'Ctrl',
    hotkeyLocked: 'Ctrl + Alt + D',
    overlayKey: 'Shift + Space',
    windowTitleBy: { ...DEFAULT_WINDOW_TITLE },
    autoSwitchGame: true,
    overlayMode: true,
    overlayBackgroundClose: true,
    priceCheck: defaultPriceCheck(),
    hotkeyOcrReveal: DEFAULT_HOTKEY_OCR_REVEAL,
    revealAutoEnabled: true,
    revealIntervalMs: DEFAULT_RUNESHAPE_INTERVAL_MS,
    ocrRegion: null as OcrRegion | null,
    hotkeyOcrRegion: '',
    runeshapeEnabled: false,
    runeshapeRegion: null as OcrRegion | null,
    runeshapeIntervalMs: DEFAULT_RUNESHAPE_INTERVAL_MS,
    runeshapeThresholds: { ...DEFAULT_RUNESHAPE_THRESHOLDS },
    hotkeyRuneshapeToggle: '',
    autoUpdate: true,
    startupToast: true
  }
  return {
    ...base,
    get useIntlSite (): boolean {
      return useEnglishNames(this.realm, this.language)
    },
    get fontSize (): number {
      return this.fsBase
    },
    get leagueId (): string | undefined {
      return this.leagueBy[this.game]?.[this.realm]
    },
    set leagueId (id: string | undefined) {
      this.leagueBy = { ...this.leagueBy, [this.game]: { ...this.leagueBy[this.game], [this.realm]: id } }
    }
  }
}

const config = reactive<Config>(createConfig())

export function AppConfig (): Config
export function AppConfig<T> (widget: 'price-check'): T
export function AppConfig (widget?: 'price-check'): unknown {
  if (widget === 'price-check') return config.priceCheck
  return config
}

/** 上游同名函式:目前 realm 的 host(交易站 API 與網頁共用)。 */
export function poeWebApi (): string {
  return REALMS[config.realm].host
}

/** 只序列化資料欄位(getter 不進檔)。 */
function serialize (): string {
  const { configVersion, game, realm, language, uiLanguage, theme, accent, fsBase, leagueBy, accountName, restoreClipboard, priceCheck } = config
  const { hotkey, hotkeyHold, hotkeyLocked, overlayKey, windowTitleBy, autoSwitchGame, overlayMode, overlayBackgroundClose } = config
  return JSON.stringify({
    configVersion, game, realm, language, uiLanguage, theme, accent, fsBase, leagueBy, accountName, restoreClipboard,
    hotkey, hotkeyHold, hotkeyLocked, overlayKey, windowTitleBy, autoSwitchGame, overlayMode, overlayBackgroundClose,
    priceCheck,
    hotkeyOcrReveal: config.hotkeyOcrReveal, ocrRegion: config.ocrRegion, hotkeyOcrRegion: config.hotkeyOcrRegion,
    revealAutoEnabled: config.revealAutoEnabled,
    revealIntervalMs: config.revealIntervalMs,
    runeshapeEnabled: config.runeshapeEnabled,
    runeshapeRegion: config.runeshapeRegion,
    runeshapeIntervalMs: config.runeshapeIntervalMs,
    runeshapeThresholds: config.runeshapeThresholds,
    hotkeyRuneshapeToggle: config.hotkeyRuneshapeToggle,
    autoUpdate: config.autoUpdate,
    startupToast: config.startupToast
  }, null, 2)
}

function applyLoaded (raw: string) {
  const loaded = JSON.parse(raw) as Partial<Omit<Config, 'fontSize'>> & {
    leagueByRealm?: Partial<Record<Realm, string>>, windowTitle?: string, fontSize?: unknown
  }
  const fresh = createConfig()
  for (const key of ['game', 'realm', 'language', 'accountName', 'restoreClipboard', 'hotkey',
    'hotkeyHold', 'hotkeyLocked', 'overlayKey', 'autoSwitchGame', 'overlayMode', 'overlayBackgroundClose'] as const) {
    if (loaded[key] !== undefined) (config as any)[key] = loaded[key]
  }
  // 舊版設定 `hotkey: 'Ctrl+D'`(整組)→ APT 語意:主鍵 `D` + 按住 `Ctrl`
  if (loaded.hotkey?.includes('+') && loaded.hotkeyHold === undefined) {
    const keys = loaded.hotkey.split('+').map(k => k.trim()).filter(Boolean)
    const mods = keys.filter(k => /^(ctrl|control|alt|shift)$/i.test(k))
    const main = keys.filter(k => !mods.includes(k))
    if (mods.length === 1 && main.length === 1) {
      config.hotkeyHold = /^alt$/i.test(mods[0]) ? 'Alt' : /^shift$/i.test(mods[0]) ? 'Shift' : 'Ctrl'
      config.hotkey = main[0].length === 1 ? main[0].toUpperCase() : main[0]
    } else {
      config.hotkey = fresh.hotkey
      config.hotkeyHold = fresh.hotkeyHold
    }
  }
  if (!(config.realm in REALMS)) config.realm = fresh.realm
  if (config.language !== 'cmn-Hant' && config.language !== 'en') config.language = fresh.language
  if (config.game !== 'poe1' && config.game !== 'poe2') config.game = fresh.game
  // 介面語言:舊設定檔沒有 → 跟客戶端語言(升級後畫面語言不變)
  config.uiLanguage = loaded.uiLanguage === 'cmn-Hant' || loaded.uiLanguage === 'en'
    ? loaded.uiLanguage
    : config.language
  config.theme = normTheme(loaded.theme)
  config.accent = normAccent(loaded.accent)
  // 字級:新欄位 fsBase;舊欄位 fontSize(px,套在 #app)16 = 舊預設 → 13 = 新預設,其他夾到 11–18
  if (typeof loaded.fsBase === 'number') {
    config.fsBase = clampFsBase(loaded.fsBase)
  } else if (typeof loaded.fontSize === 'number') {
    config.fsBase = loaded.fontSize === 16 ? DEFAULT_FS_BASE : clampFsBase(loaded.fontSize)
  } else {
    config.fsBase = fresh.fsBase
  }
  // 舊版只有 PoE1:`leagueByRealm` → `leagueBy.poe1`
  config.leagueBy = {
    poe1: { ...(loaded.leagueByRealm ?? {}), ...(loaded.leagueBy?.poe1 ?? {}) },
    poe2: { ...(loaded.leagueBy?.poe2 ?? {}) }
  }
  config.priceCheck = { ...fresh.priceCheck, ...(loaded.priceCheck ?? {}) }
  // 視窗標題改成每遊戲一格;舊版單一 `windowTitle` 併入當時 game 那格(已有 windowTitleBy 的不動)
  const titles = { ...fresh.windowTitleBy }
  for (const g of ['poe1', 'poe2'] as const) {
    const v = loaded.windowTitleBy?.[g]
    if (typeof v === 'string' && v.trim()) titles[g] = v
  }
  if (loaded.windowTitleBy === undefined && typeof loaded.windowTitle === 'string' && loaded.windowTitle.trim()) {
    titles[config.game] = loaded.windowTitle
  }
  config.windowTitleBy = titles
  if (typeof config.autoSwitchGame !== 'boolean') config.autoSwitchGame = fresh.autoSwitchGame
  // 舊設定檔的 `dustDockRatio`(WP-Q 拆粉停靠比例;2026-09-30 拆粉排行移進設定視窗後不再使用):
  // 這裡只挑已知欄位,舊鍵直接略過,下次存檔就不會再寫出
  // WP-S:舊設定檔沒有 → 預設熱鍵;使用者清成空字串 = 停用(保留空字串)
  config.hotkeyOcrReveal = typeof loaded.hotkeyOcrReveal === 'string' ? loaded.hotkeyOcrReveal : fresh.hotkeyOcrReveal
  config.ocrRegion = normOcrRegion(loaded.ocrRegion)
  // 2026-10-01:褻瀆自動辨識(舊設定檔沒有 → 開;只有明確 false 才關)、掃描間隔同符文塑形的夾限
  config.revealAutoEnabled = loaded.revealAutoEnabled !== false
  config.revealIntervalMs = clampRuneshapeInterval(loaded.revealIntervalMs)
  // WP-S2:框選熱鍵預設空字串(不註冊)
  config.hotkeyOcrRegion = typeof loaded.hotkeyOcrRegion === 'string' ? loaded.hotkeyOcrRegion : fresh.hotkeyOcrRegion
  // WP-R2:符文塑形自動查價(舊設定檔沒有 → 預設關、未框選、1000 ms)
  config.runeshapeEnabled = loaded.runeshapeEnabled === true
  config.runeshapeRegion = normOcrRegion(loaded.runeshapeRegion)
  config.runeshapeIntervalMs = clampRuneshapeInterval(loaded.runeshapeIntervalMs)
  config.runeshapeThresholds = normRuneshapeThresholds(loaded.runeshapeThresholds)
  config.hotkeyRuneshapeToggle = typeof loaded.hotkeyRuneshapeToggle === 'string' ? loaded.hotkeyRuneshapeToggle : fresh.hotkeyRuneshapeToggle
  // 自動更新:舊設定檔沒有 → 預設開;只有明確 false 才關
  config.autoUpdate = loaded.autoUpdate !== false
  // 啟動提示:舊設定檔沒有 → 預設開;只有明確 false 才關
  config.startupToast = loaded.startupToast !== false
}

/** 測試用:套用一份設定檔內容後回傳序列化結果(`renderer/test/runeshape-config.test.ts`) */
export function _roundTripForTest (raw: string | null): { config: Config, serialized: string } {
  const fresh = createConfig()
  for (const k of Object.keys(fresh) as Array<keyof Config>) {
    if (k === 'useIntlSite' || k === 'fontSize' || k === 'leagueId') continue // getter
    ;(config as any)[k] = (fresh as any)[k]
  }
  if (raw) applyLoaded(raw)
  return { config, serialized: serialize() }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 剛從 `config-changed` 套用的內容(serialize 後):watch 看到同一份就不再存檔,避免兩端互相回存。 */
let appliedExternal: string | null = null

/** main 的 `Shortcuts.updateActions` 回傳(熱鍵註冊結果);設定頁「熱鍵與視窗」分頁顯示在對應欄位下方。 */
export type { HotkeyRegistration }
export const hotkeyRegistration = shallowRef<HotkeyRegistration | null>(null)

/** 把設定送給 main,並收下熱鍵註冊結果(純瀏覽器沒有 main → null)。 */
async function sendHostConfig (cfg: HostConfigForMain): Promise<void> {
  try {
    hotkeyRegistration.value = await Host.updateHostConfig(cfg)
  } catch (e) {
    console.error('[app] host-config 失敗', e)
  }
}

export async function initConfig (): Promise<void> {
  const raw = await Host.loadConfig()
  if (raw) {
    try { applyLoaded(raw) } catch (e) { console.error('設定檔損毀,使用預設值', e) }
  }
  watch(() => serialize(), (contents) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (contents === appliedExternal) return
    appliedExternal = null
    saveTimer = setTimeout(() => { void Host.saveConfig(contents) }, 300)
  })
  // 另一端(Electron 視窗 ↔ 瀏覽器預覽分頁)存了設定:內容不同才套用,且不觸發再次存檔
  Host.onConfigChanged(({ contents, source }) => {
    if (contents === serialize()) return
    try {
      applyLoaded(contents)
      appliedExternal = serialize()
      console.log(`[app] config-changed from ${source}:已套用`)
    } catch (e) {
      console.error('[app] config-changed 內容無法解析,略過', e)
    }
  })
  // main 偵測到另一款遊戲(window 模式;overlay 模式 main 直接寫設定並重新啟動)
  Host.onSwitchGame((game) => {
    if (config.game !== game) {
      console.log(`[app] 自動偵測:切換到 ${game}`)
      config.game = game
    }
  })
  watch(() => ({
    hotkey: config.hotkey,
    hotkeyHold: config.hotkeyHold,
    hotkeyLocked: config.hotkeyLocked,
    overlayKey: config.overlayKey,
    game: config.game,
    windowTitleBy: { ...config.windowTitleBy },
    autoSwitchGame: config.autoSwitchGame,
    overlayMode: config.overlayMode,
    restoreClipboard: config.restoreClipboard,
    language: config.language,
    uiLanguage: config.uiLanguage,
    hotkeyOcrReveal: config.hotkeyOcrReveal,
    revealAutoEnabled: config.revealAutoEnabled,
    revealIntervalMs: config.revealIntervalMs,
    ocrRegion: config.ocrRegion ? { ...config.ocrRegion } : null,
    hotkeyOcrRegion: config.hotkeyOcrRegion,
    runeshapeEnabled: config.runeshapeEnabled,
    runeshapeRegion: config.runeshapeRegion ? { ...config.runeshapeRegion } : null,
    runeshapeIntervalMs: config.runeshapeIntervalMs,
    hotkeyRuneshapeToggle: config.hotkeyRuneshapeToggle,
    autoUpdate: config.autoUpdate,
    startupToast: config.startupToast
  }), (cfg) => {
    void sendHostConfig(cfg)
  }, { immediate: true })
}
