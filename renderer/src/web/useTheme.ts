/**
 * 外觀:主題 / 強調色 / 基準字級 → 寫到 <html>(data-theme、--fs-base、--accent-user、--on-accent-user)。
 * 移植自 pob-zh-engine/ui/src/lib/prefs.svelte.ts(onColor 76–85、THEMES/ACCENTS 13–16、apply 158–169);
 * token 本身在 src/theme/pobtools.css。
 *
 * 本檔不 import Config(Config 反過來用這裡的常數與正規化函式),避免循環相依。
 */
import { watch } from 'vue'

export const THEMES = ['slate', 'light', 'contrast', 'parchment'] as const
export type Theme = (typeof THEMES)[number]
/** 設定頁提供的強調色("" = 跟主題)。 */
export const ACCENTS = ['#d8aa4b', '#5b9dff', '#4fbf7a', '#a77bff', '#e0645a', '#3fc1c9'] as const

export const FS_BASE_MIN = 11
export const FS_BASE_MAX = 18
export const DEFAULT_FS_BASE = 13

export function normTheme (v: unknown): Theme {
  return THEMES.includes(v as Theme) ? (v as Theme) : 'slate'
}
export function normAccent (v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : ''
}
export function clampFsBase (v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FS_BASE
  return Math.min(FS_BASE_MAX, Math.max(FS_BASE_MIN, Math.round(v)))
}

/** 填 `hex` 的按鈕上讀得清的字色(WCAG 相對亮度;> 0.18 用黑字,否則白字)。 */
export function onColor (hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return l > 0.18 ? '#17120a' : '#ffffff'
}

export interface ThemeSettings {
  theme: Theme
  accent: string
  fsBase: number
}

/** 把外觀寫到 <html>。 */
export function applyTheme (s: ThemeSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = normTheme(s.theme)
  root.style.setProperty('--fs-base', `${clampFsBase(s.fsBase)}px`)
  const accent = normAccent(s.accent)
  if (accent) {
    root.style.setProperty('--accent-user', accent)
    root.style.setProperty('--on-accent-user', onColor(accent))
  } else {
    root.style.removeProperty('--accent-user')
    root.style.removeProperty('--on-accent-user')
  }
}

// ---- 自訂背景圖(2026-10-01;照 PobTools prefs.svelte.ts 的 normBgFile / lookVars,去掉影片與天賦樹) ----

/** 設定 › 一般 › 背景。圖只畫在查價面板與設定視窗裡(`.bg-host` 內的 `.bgimg` 層),overlay 其他區域維持透明。 */
export interface BgSettings {
  enabled: boolean
  /** `userData/backgrounds/` 裡的檔名(main `bg-pick` 複製過去的);'' = 沒選 */
  file: string
  /** 亮度 0–100(%) */
  bright: number
  /** 面板不透明度 0–100(%):越低圖越明顯 */
  panelOpacity: number
  /** 霧面 0–100 → 模糊 0–24 px */
  blur: number
}

export const BG_DEFAULT: Readonly<BgSettings> = { enabled: true, file: '', bright: 60, panelOpacity: 75, blur: 0 }

/** 與 main `backgrounds.ts` 同一條規則:只准 png / jpg / jpeg / webp、不含路徑字元、不以點開頭 */
export function normBgFile (v: unknown): string {
  return typeof v === 'string' && /^[^\\/:*?"<>|.\x00-\x1f][^\\/:*?"<>|\x00-\x1f]{0,199}\.(png|jpe?g|webp)$/i.test(v) && !v.includes('..') ? v : ''
}

const pct = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : def)

export function normBg (v: unknown): BgSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof BgSettings, unknown>>
  return {
    enabled: o.enabled !== false,
    file: normBgFile(o.file),
    bright: pct(o.bright, BG_DEFAULT.bright),
    panelOpacity: pct(o.panelOpacity, BG_DEFAULT.panelOpacity),
    blur: pct(o.blur, BG_DEFAULT.blur)
  }
}

/** 背景圖網址:Electron 視窗 `app://bg/<檔名>`;瀏覽器預覽 `<頁面所在的 /t/<token>/>bg/<檔名>`(token 保護);純瀏覽器沒有 → null */
export function bgImageUrl (file: string, env: { electron: boolean, preview: boolean, baseURI: string }): string | null {
  const name = normBgFile(file)
  if (!name || !env.electron) return null
  const enc = encodeURIComponent(name)
  if (!env.preview) return `app://bg/${enc}`
  try { return new URL(`bg/${enc}`, env.baseURI).href } catch { return null }
}

/** 背景設定 → `<html>` 的 CSS 變數;沒有圖 / 關閉 / 拿不到網址 → null(= 不設 data-bg) */
export function bgVars (bg: BgSettings, url: string | null): Record<string, string> | null {
  if (!bg.enabled || !bg.file || !url) return null
  return {
    '--bg-image': `url("${url.replace(/["\\]/g, '\\$&')}")`,
    '--bg-bright': String(bg.bright / 100),
    '--bg-blur': `${Math.round((bg.blur / 100) * 24)}px`,
    '--bg-panel-pct': `${bg.panelOpacity}%`
  }
}
const BG_VARS = ['--bg-image', '--bg-bright', '--bg-blur', '--bg-panel-pct']

/** 寫到 <html>:有背景 → `data-bg` + 變數;沒有 → 清掉(pobtools.css 只在 `.bg-host` 內用它們,overlay 其他區域不受影響) */
export function applyBackground (vars: Record<string, string> | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (vars) {
    root.dataset.bg = ''
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  } else {
    delete root.dataset.bg
    for (const k of BG_VARS) root.style.removeProperty(k)
  }
}

/** 背景設定一變就重套(main.ts 啟動時呼叫) */
export function useBackground (settings: () => BgSettings, url: (file: string) => string | null): void {
  watch(() => {
    const s = settings()
    return bgVars(normBg(s), url(s.file))
  }, applyBackground, { immediate: true, deep: true })
}

/** 立即套用一次,之後設定一變就重套(main.ts 啟動時呼叫)。 */
export function useTheme (settings: () => ThemeSettings): void {
  watch(() => {
    const s = settings()
    return { theme: s.theme, accent: s.accent, fsBase: s.fsBase }
  }, applyTheme, { immediate: true })
}
