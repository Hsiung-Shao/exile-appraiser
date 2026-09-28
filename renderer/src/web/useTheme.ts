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

/** 立即套用一次,之後設定一變就重套(main.ts 啟動時呼叫)。 */
export function useTheme (settings: () => ThemeSettings): void {
  watch(() => {
    const s = settings()
    return { theme: s.theme, accent: s.accent, fsBase: s.fsBase }
  }, applyTheme, { immediate: true })
}
