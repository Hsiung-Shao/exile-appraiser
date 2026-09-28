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
import type { HostConfigForMain, HotkeyRegistration } from '@ipc/types'
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
    priceCheck: defaultPriceCheck()
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
    priceCheck
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
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

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
    saveTimer = setTimeout(() => { void Host.saveConfig(contents) }, 300)
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
    uiLanguage: config.uiLanguage
  }), (cfg) => {
    void sendHostConfig(cfg)
  }, { immediate: true })
}
