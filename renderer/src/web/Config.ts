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
import { nextTick, reactive, shallowRef, watch } from 'vue'
import { REALMS, useEnglishNames, type Game, type Language, type Realm } from '@exile-appraiser/core/realm'
import type { PriceCheckWidget } from './overlay/interfaces'
import type { ChatCommand, HostConfigForMain, HotkeyRegistration, OcrLangSetting, OcrRegion, RegexBookmarkHotkey, StashSearchEntry } from '@ipc/types'
import { regexBookmarkHotkeyList } from './regex/bookmark-hotkeys'
import { Host } from './background/IPC'
import { dataLanguage } from './games/active'
import { createHostConfigSync } from './host-config-sync'
import { clampFsBase, normAccent, normBg, normTheme, DEFAULT_FS_BASE, type BgSettings, type Theme } from './useTheme'
import { defaultOcrBadgeStyle, normOcrBadgeStyle, type OcrBadgeStyle } from './overlay/badge-style'
import { normSettingsFontSize, normSettingsWindow, type SettingsWindowRect } from './settings/settings-window-geom'
import { RELATED_SCALE_DEFAULT, normRelatedItemsScale } from './related-items-scale'

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
  /** 2026-10-01:自訂背景圖(查價面板與設定視窗;useTheme.ts `BgSettings`)。 */
  bg: BgSettings
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
  /** 第 25 步:OCR 辨識語言(褻瀆 / 符文塑形共用):`follow` = 跟隨客戶端語言(預設)、`cmn-Hant` / `en` = 固定該語言包。舊設定檔沒有 = follow */
  ocrLang: OcrLangSetting
  hotkeyOcrReveal: string
  /** 2026-10-01:褻瀆(揭露面板)自動持續辨識(預設開;舊設定檔沒有 = 開)。 */
  revealAutoEnabled: boolean
  /** 2026-10-01:褻瀆自動辨識掃描間隔 ms(100–3000,預設 1000)。 */
  revealIntervalMs: number
  /** 2026-10-01 第 13 步:褻瀆徽章一組多候選時全部列出(預設關 = 只列最可能的一個 + 「+N」;只影響 overlay 顯示,不送 main)。 */
  revealShowAllCandidates: boolean
  /** WP-S:OCR 搜尋範圍(client 比例 0–1);null = 整個遊戲畫面自動找面板。 */
  ocrRegion: OcrRegion | null
  /** WP-S2:在遊戲畫面上框選 OCR 區域的熱鍵(預設空 = 不註冊;overlay 模式 + PoE2 才註冊)。 */
  hotkeyOcrRegion: string
  /** WP-R2:PoE2 符文塑形面板自動查價(預設關;overlay + PoE2 + 已框選區域才掃描)。 */
  runeshapeEnabled: boolean
  /** WP-R2:符文塑形面板區域(client 比例 0–1);null = 未框選。 */
  runeshapeRegion: OcrRegion | null
  /** WP-R2:掃描間隔 ms(100–3000,預設 1000)。 */
  runeshapeIntervalMs: number
  /** WP-R2:徽章顏色門檻(崇高石):< low 暗色、≥ high 金色、之間一般。 */
  runeshapeThresholds: RuneshapeThresholds
  /**
   * 第 11 步:OCR 徽章外觀(符文價格徽章與褻瀆徽章共用;字體 / 大小 / 粗體 / 外框陰影,三段價格色只給符文)。
   * 只影響 overlay 顯示,不送 main;舊設定檔沒有 → 預設(= 改版前外觀)。`overlay/badge-style.ts`。
   */
  ocrBadgeStyle: OcrBadgeStyle
  /** WP-R2:暫停 / 繼續自動查價的熱鍵(預設空 = 不註冊)。 */
  hotkeyRuneshapeToggle: string
  /** 2026-10-01:框選符文塑形面板區域的熱鍵(預設空 = 不註冊;overlay 模式 + PoE2 才註冊)。 */
  hotkeyRuneshapeRegion: string
  /** 自動更新(預設 true):安裝版背景下載、結束程式時靜默套用;false = 手動下載 / 安裝(main/src/updater-core.ts)。 */
  autoUpdate: boolean
  /** 啟動時短暫顯示「已在背景執行」提示(預設 true;main/src/startup-toast.ts)。 */
  startupToast: boolean
  /** 第 34 步:有新版本時每 10 分鐘在右下角提醒(預設 true;舊設定檔沒有 = 開;main/src/update-reminder.ts)。 */
  updateReminder: boolean
  /** 第 34 步:提醒裡按「略過此版本」的版號(main 經 `update-reminder-skip` 事件寫進來;同版號不再提醒,新版號照常)。 */
  updateSkippedVersion: string | null
  /**
   * 第五輪 30.5:硬體加速(預設 false = 改版前一律關)。main 在 app ready 前同步讀設定檔決定(main/src/hw-accel.ts),
   * 改了要重新啟動才生效;不進 host-config。
   */
  hardwareAcceleration: boolean
  /** 2026-10-01:聊天指令熱鍵(移植 APT `commands`;預設同 APT)。 */
  commands: ChatCommand[]
  /** 2026-10-01:倉庫搜尋一鍵輸入熱鍵(預設空)。 */
  stashSearch: StashSearchEntry[]
  /** 2026-10-01(第 15 步,移植 APT):倉庫頁籤捲動 Ctrl + 滾輪(預設開;只在 overlay 模式、遊戲前景時有效)。 */
  stashScroll: boolean
  /**
   * 第 21 步:設定視窗大小 / 位置(CSS px,相對 overlay 左上角;只在 overlay 模式套用,拖曳結束才寫入)。
   * null = 置中預設(寬 min(50rem, 92vw)、高 min(38rem, 88vh));顯示時夾進 overlay 可視範圍(settings/settings-window-geom.ts)。
   */
  settingsWindow: SettingsWindowRect | null
  /** 第 21 步:設定視窗獨立字級(11–24 px);null = 跟隨全域 `fsBase`。只作用在設定視窗,查價面板不受影響。 */
  settingsFontSize: number | null
  /** 2026-10-06:查價面板旁「相關物品」的大小(70–200 %,100 = APT 原本大小;related-items-scale.ts)。 */
  relatedItemsScale: number
  /** 第 33 步:正則書籤快速面板熱鍵(預設空 = 不註冊;只在 overlay 模式)。 */
  hotkeyRegexQuick: string
  /** 第 33 步:打開設定時,設定視窗旁浮一排正則書籤(預設開;只在 overlay 模式)。 */
  regexBookmarkBar: boolean
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

/** 第 25 步:OCR 辨識語言設定正規化(只認 `cmn-Hant` / `en`,其餘 / 缺欄位 → `follow` = 跟隨客戶端語言) */
export function normOcrLang (v: unknown): OcrLangSetting {
  return v === 'cmn-Hant' || v === 'en' ? v : 'follow'
}

/**
 * 第 34 步:「略過此版本」的版號正規化:`x.y.z`(可帶後綴,最多 40 字)才算數,其他 → null。
 * 與 main `update-reminder.ts` `normSkippedVersion` 同規則(`renderer/test/update-reminder-config.test.ts` 對照)。
 */
export function normSkippedVersion (v: unknown): string | null {
  return typeof v === 'string' && v.length <= 40 && /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/.test(v) ? v : null
}

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

/**
 * 聊天指令預設(移植自 APT `renderer/src/web/Config.ts` defaultConfig().commands,MIT):
 * `/hideout` = F5、`/exit` = F9,其餘四條沒有熱鍵;全部直接送出。
 */
export function defaultCommands (): ChatCommand[] {
  return [
    { text: '/hideout', hotkey: 'F5', send: true },
    { text: '/exit', hotkey: 'F9', send: true },
    { text: '@last ty', hotkey: '', send: true },
    { text: '/invite @last', hotkey: '', send: true },
    { text: '/tradewith @last', hotkey: '', send: true },
    { text: '/hideout @last', hotkey: '', send: true }
  ]
}

/** 最多幾條(與 main `MAX_TEXT_ACTIONS` 相同) */
export const MAX_TEXT_ENTRIES = 50

/** 聊天指令正規化:不是陣列 → 預設;每條 text 字串(最多 500 字)、hotkey 字串(APT 的 null → '')、send 布林(省略 = true) */
export function normCommands (v: unknown): ChatCommand[] {
  if (!Array.isArray(v)) return defaultCommands()
  return v.slice(0, MAX_TEXT_ENTRIES).filter(c => c && typeof c === 'object').map((c: Record<string, unknown>) => ({
    text: typeof c.text === 'string' ? c.text.slice(0, 500) : '',
    hotkey: typeof c.hotkey === 'string' ? c.hotkey : '',
    send: c.send !== false
  }))
}

/** 倉庫搜尋正規化:不是陣列 → 空;text 最多 250 字(遊戲搜尋框上限) */
export function normStashSearch (v: unknown): StashSearchEntry[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, MAX_TEXT_ENTRIES).filter(s => s && typeof s === 'object').map((s: Record<string, unknown>) => ({
    text: typeof s.text === 'string' ? s.text.slice(0, 250) : '',
    hotkey: typeof s.hotkey === 'string' ? s.hotkey : ''
  }))
}

/** Poe Regex「加到倉庫搜尋」:能不能加(空白 / 超過 250 字 = invalid;已有同字串 = duplicate;清單滿了 = invalid) */
export function addStashSearchEntry (list: StashSearchEntry[], text: string): 'added' | 'duplicate' | 'invalid' {
  const q = text.trim()
  if (!q || q.length > 250 || list.length >= MAX_TEXT_ENTRIES) return 'invalid'
  return list.some(s => s.text.trim() === q) ? 'duplicate' : 'added'
}

/** WP-R2:徽章顏色門檻(單位:崇高石) */
export interface RuneshapeThresholds {
  low: number
  high: number
}
export const DEFAULT_RUNESHAPE_THRESHOLDS: Readonly<RuneshapeThresholds> = { low: 0.5, high: 5 }
export const DEFAULT_RUNESHAPE_INTERVAL_MS = 1000

/** 掃描間隔夾限(符文塑形與褻瀆共用;main `panel-scan.ts` 的 `SCAN_INTERVAL_MIN_MS` / `MAX` 同值)。下限 2026-10-01 由 500 放寬到 100 */
export const SCAN_INTERVAL_MIN_MS = 100
export const SCAN_INTERVAL_MAX_MS = 3000
/** 低於這個值設定頁顯示 CPU 負擔提示 */
export const SCAN_INTERVAL_CPU_WARN_MS = 500

/** WP-R2:掃描間隔 100–3000 ms(main `clampScanInterval` 同規則);不是數字 → 1000 */
export function clampRuneshapeInterval (v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_RUNESHAPE_INTERVAL_MS
  return Math.min(SCAN_INTERVAL_MAX_MS, Math.max(SCAN_INTERVAL_MIN_MS, Math.round(v)))
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
    bg: normBg(undefined), // 第 26 步:layout 是巢狀物件,不能淺拷貝 BG_DEFAULT(會共用、改到常數)
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
    ocrLang: 'follow' as OcrLangSetting,
    hotkeyOcrReveal: DEFAULT_HOTKEY_OCR_REVEAL,
    revealAutoEnabled: true,
    revealIntervalMs: DEFAULT_RUNESHAPE_INTERVAL_MS,
    revealShowAllCandidates: false,
    ocrRegion: null as OcrRegion | null,
    hotkeyOcrRegion: '',
    runeshapeEnabled: false,
    runeshapeRegion: null as OcrRegion | null,
    runeshapeIntervalMs: DEFAULT_RUNESHAPE_INTERVAL_MS,
    runeshapeThresholds: { ...DEFAULT_RUNESHAPE_THRESHOLDS },
    ocrBadgeStyle: defaultOcrBadgeStyle(),
    hotkeyRuneshapeToggle: '',
    hotkeyRuneshapeRegion: '',
    autoUpdate: true,
    startupToast: true,
    updateReminder: true,
    updateSkippedVersion: null as string | null,
    hardwareAcceleration: false,
    commands: defaultCommands(),
    stashSearch: [] as StashSearchEntry[],
    stashScroll: true,
    settingsWindow: null as SettingsWindowRect | null,
    settingsFontSize: null as number | null,
    relatedItemsScale: RELATED_SCALE_DEFAULT,
    hotkeyRegexQuick: '',
    regexBookmarkBar: true
  }
  return {
    ...base,
    get useIntlSite (): boolean {
      // 第 27 步:依目前查價資料集的語系(國際服會依複製文字自動判斷語言,可能 ≠ 客戶端語言設定)
      return useEnglishNames(this.realm, dataLanguage.value ?? this.language)
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
    configVersion, game, realm, language, uiLanguage, theme, accent, fsBase, bg: config.bg, leagueBy, accountName, restoreClipboard,
    hotkey, hotkeyHold, hotkeyLocked, overlayKey, windowTitleBy, autoSwitchGame, overlayMode, overlayBackgroundClose,
    priceCheck,
    ocrLang: config.ocrLang,
    hotkeyOcrReveal: config.hotkeyOcrReveal, ocrRegion: config.ocrRegion, hotkeyOcrRegion: config.hotkeyOcrRegion,
    revealAutoEnabled: config.revealAutoEnabled,
    revealIntervalMs: config.revealIntervalMs,
    revealShowAllCandidates: config.revealShowAllCandidates,
    runeshapeEnabled: config.runeshapeEnabled,
    runeshapeRegion: config.runeshapeRegion,
    runeshapeIntervalMs: config.runeshapeIntervalMs,
    runeshapeThresholds: config.runeshapeThresholds,
    ocrBadgeStyle: config.ocrBadgeStyle,
    hotkeyRuneshapeToggle: config.hotkeyRuneshapeToggle,
    hotkeyRuneshapeRegion: config.hotkeyRuneshapeRegion,
    autoUpdate: config.autoUpdate,
    startupToast: config.startupToast,
    updateReminder: config.updateReminder,
    updateSkippedVersion: config.updateSkippedVersion,
    hardwareAcceleration: config.hardwareAcceleration,
    commands: config.commands,
    stashSearch: config.stashSearch,
    stashScroll: config.stashScroll,
    settingsWindow: config.settingsWindow,
    settingsFontSize: config.settingsFontSize,
    relatedItemsScale: config.relatedItemsScale,
    hotkeyRegexQuick: config.hotkeyRegexQuick,
    regexBookmarkBar: config.regexBookmarkBar
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
  // 自訂背景圖:舊設定檔沒有 → 預設(沒選圖);檔名不合法(含路徑字元 / 非 png·jpg·webp)→ 清成 ''
  config.bg = normBg(loaded.bg)
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
  // 第 25 步:OCR 辨識語言(舊設定檔沒有 / 壞值 → follow)
  config.ocrLang = normOcrLang(loaded.ocrLang)
  config.hotkeyOcrReveal = typeof loaded.hotkeyOcrReveal === 'string' ? loaded.hotkeyOcrReveal : fresh.hotkeyOcrReveal
  config.ocrRegion = normOcrRegion(loaded.ocrRegion)
  // 2026-10-01:褻瀆自動辨識(舊設定檔沒有 → 開;只有明確 false 才關)、掃描間隔同符文塑形的夾限
  config.revealAutoEnabled = loaded.revealAutoEnabled !== false
  config.revealIntervalMs = clampRuneshapeInterval(loaded.revealIntervalMs)
  // 第 13 步:徽章全部候選(舊設定檔沒有 → 關;只有明確 true 才開)
  config.revealShowAllCandidates = loaded.revealShowAllCandidates === true
  // WP-S2:框選熱鍵預設空字串(不註冊)
  config.hotkeyOcrRegion = typeof loaded.hotkeyOcrRegion === 'string' ? loaded.hotkeyOcrRegion : fresh.hotkeyOcrRegion
  // WP-R2:符文塑形自動查價(舊設定檔沒有 → 預設關、未框選、1000 ms)
  config.runeshapeEnabled = loaded.runeshapeEnabled === true
  config.runeshapeRegion = normOcrRegion(loaded.runeshapeRegion)
  config.runeshapeIntervalMs = clampRuneshapeInterval(loaded.runeshapeIntervalMs)
  config.runeshapeThresholds = normRuneshapeThresholds(loaded.runeshapeThresholds)
  // 第 11 步:徽章外觀(舊設定檔沒有 → 預設;壞值逐欄回預設)
  config.ocrBadgeStyle = normOcrBadgeStyle(loaded.ocrBadgeStyle)
  config.hotkeyRuneshapeToggle = typeof loaded.hotkeyRuneshapeToggle === 'string' ? loaded.hotkeyRuneshapeToggle : fresh.hotkeyRuneshapeToggle
  // 2026-10-01:符文塑形框選熱鍵(舊設定檔沒有 → 空字串 = 不註冊)
  config.hotkeyRuneshapeRegion = typeof loaded.hotkeyRuneshapeRegion === 'string' ? loaded.hotkeyRuneshapeRegion : fresh.hotkeyRuneshapeRegion
  // 自動更新:舊設定檔沒有 → 預設開;只有明確 false 才關
  config.autoUpdate = loaded.autoUpdate !== false
  // 啟動提示:舊設定檔沒有 → 預設開;只有明確 false 才關
  config.startupToast = loaded.startupToast !== false
  // 第 34 步:更新提醒(舊設定檔沒有 → 開;只有明確 false 才關)、略過的版號(壞值 → null)
  config.updateReminder = loaded.updateReminder !== false
  config.updateSkippedVersion = normSkippedVersion(loaded.updateSkippedVersion)
  // 第五輪 30.5:硬體加速:舊設定檔沒有 → 關(改版前行為);只有明確 true 才開
  config.hardwareAcceleration = loaded.hardwareAcceleration === true
  // 聊天指令:舊設定檔沒有 → APT 預設六條;倉庫搜尋 → 空
  config.commands = normCommands(loaded.commands)
  config.stashSearch = normStashSearch(loaded.stashSearch)
  // 倉庫頁籤捲動:舊設定檔沒有 → 預設開;只有明確 false 才關(同 APT 預設)
  config.stashScroll = loaded.stashScroll !== false
  // 第 21 步:設定視窗大小 / 位置與獨立字級(舊設定檔沒有 → null = 置中預設 / 跟隨全域;壞值 → null)
  config.settingsWindow = normSettingsWindow(loaded.settingsWindow)
  config.settingsFontSize = normSettingsFontSize(loaded.settingsFontSize)
  // 2026-10-06:相關物品大小(舊設定檔沒有 → 100;壞值 → 100;超出範圍夾回)
  config.relatedItemsScale = normRelatedItemsScale(loaded.relatedItemsScale)
  // 第 33 步:正則書籤快速面板熱鍵(舊設定檔沒有 → 空 = 不註冊)、設定視窗旁的書籤列(舊設定檔沒有 → 開;只有明確 false 才關)
  config.hotkeyRegexQuick = typeof loaded.hotkeyRegexQuick === 'string' ? loaded.hotkeyRegexQuick : fresh.hotkeyRegexQuick
  config.regexBookmarkBar = loaded.regexBookmarkBar !== false
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

/**
 * 第五輪 30.5:設定頁「重新啟動」用:取消等待中的存檔(300 ms debounce),回傳目前整份設定 —— main `app-relaunch` 直接寫檔再重新啟動,
 * debounce 內的變更(例如剛切的硬體加速)不會遺失。
 */
export function configContentsForRelaunch (): string {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  return serialize()
}

/** main 的 `Shortcuts.updateActions` 回傳(熱鍵註冊結果);設定頁「熱鍵」總表(與倉庫與聊天、正則書籤)顯示在對應欄位下方。 */
export type { HotkeyRegistration }
export const hotkeyRegistration = shallowRef<HotkeyRegistration | null>(null)

/** 把設定送給 main,並收下熱鍵註冊結果(純瀏覽器沒有 main → null)。 */
/**
 * 送給 main 的 host-config(Config.ts watch 用;每個欄位都要列在這裡,main 才收得到 —— renderer/test/stash-scroll-config.test.ts 守門)。
 * 物件 / 陣列複製一份,watch 才會追蹤到內層欄位。
 */
export function hostConfigOf (c: Config, regexHotkeys: readonly RegexBookmarkHotkey[] = regexBookmarkHotkeyList.value): HostConfigForMain {
  return {
    hotkey: c.hotkey,
    hotkeyHold: c.hotkeyHold,
    hotkeyLocked: c.hotkeyLocked,
    overlayKey: c.overlayKey,
    game: c.game,
    windowTitleBy: { ...c.windowTitleBy },
    autoSwitchGame: c.autoSwitchGame,
    overlayMode: c.overlayMode,
    restoreClipboard: c.restoreClipboard,
    language: c.language,
    uiLanguage: c.uiLanguage,
    ocrLang: c.ocrLang,
    hotkeyOcrReveal: c.hotkeyOcrReveal,
    revealAutoEnabled: c.revealAutoEnabled,
    revealIntervalMs: c.revealIntervalMs,
    ocrRegion: c.ocrRegion ? { ...c.ocrRegion } : null,
    hotkeyOcrRegion: c.hotkeyOcrRegion,
    runeshapeEnabled: c.runeshapeEnabled,
    runeshapeRegion: c.runeshapeRegion ? { ...c.runeshapeRegion } : null,
    runeshapeIntervalMs: c.runeshapeIntervalMs,
    hotkeyRuneshapeToggle: c.hotkeyRuneshapeToggle,
    hotkeyRuneshapeRegion: c.hotkeyRuneshapeRegion,
    autoUpdate: c.autoUpdate,
    startupToast: c.startupToast,
    updateReminder: c.updateReminder,
    updateSkippedVersion: c.updateSkippedVersion,
    commands: c.commands.map(x => ({ ...x })),
    stashSearch: c.stashSearch.map(s => ({ ...s })),
    stashScroll: c.stashScroll,
    hotkeyRegexQuick: c.hotkeyRegexQuick,
    // 第 33 步:書籤個別熱鍵存在 regex_state.json(regex/store.ts 讀檔後寫入這個 ref);main 只註冊目前遊戲的
    regexBookmarkHotkeys: regexHotkeys.map(b => ({ ...b }))
  }
}

async function sendHostConfig (cfg: HostConfigForMain): Promise<void> {
  try {
    hotkeyRegistration.value = await Host.updateHostConfig(cfg)
  } catch (e) {
    console.error('[app] host-config 失敗', e)
    throw e // 交給 host-config-sync:失敗就不記為「已送出」
  }
}

/**
 * 不經 300 ms 去抖、一改就送的欄位:game / overlayMode(main 會據此重新啟動),以及掃描開關 / 區域 / 間隔
 * (= main `scanConfigKey` 的欄位;改了 main 立刻 poke 掃描器,設定頁狀態列接著讀新狀態 —— code review 第 C 批)。
 */
export const HOST_CONFIG_IMMEDIATE_KEYS: ReadonlyArray<keyof HostConfigForMain> = [
  'game', 'overlayMode', 'ocrLang',
  'revealAutoEnabled', 'revealIntervalMs', 'ocrRegion',
  'runeshapeEnabled', 'runeshapeRegion', 'runeshapeIntervalMs'
]

/** 設定頁每改一個欄位 watch 都會觸發:相同內容不送、一般欄位 300 ms trailing debounce;第一次與 `HOST_CONFIG_IMMEDIATE_KEYS` 立刻送 */
const hostConfigSync = createHostConfigSync<HostConfigForMain>({
  send: sendHostConfig,
  immediateKeys: [...HOST_CONFIG_IMMEDIATE_KEYS]
})

/**
 * 等到目前的設定都送到 main(且 main 已回覆)。設定頁狀態列讀掃描統計前呼叫(`OcrScanSection.vue`):
 * 先 `nextTick` 讓 Config 的 watch 把這次的改動交給 sync,再等它送完 —— 統計一定在新設定之後讀。
 */
export async function hostConfigSettled (): Promise<void> {
  await nextTick()
  await hostConfigSync.settled()
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
  // 第 34 步:更新提醒按了「略過此版本」(main 已立即生效;這裡寫進設定,下次啟動也記得)
  Host.onUpdateReminderSkip((version) => {
    const v = normSkippedVersion(version)
    if (v && config.updateSkippedVersion !== v) {
      console.log(`[app] 更新提醒:略過 v${v}`)
      config.updateSkippedVersion = v
    }
  })
  // main 偵測到另一款遊戲(window 模式;overlay 模式 main 直接寫設定並重新啟動)
  Host.onSwitchGame((game) => {
    if (config.game !== game) {
      console.log(`[app] 自動偵測:切換到 ${game}`)
      config.game = game
    }
  })
  watch(() => hostConfigOf(config), (cfg) => {
    hostConfigSync.update(cfg)
  }, { immediate: true })
  // 視窗關閉 / 重新載入前,把等待中(debounce 內)的設定送出
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { hostConfigSync.flush() })
}
