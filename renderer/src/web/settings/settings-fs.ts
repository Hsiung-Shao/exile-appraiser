/**
 * 設定視窗獨立字級(第 21 步)的注入:SettingsWindow.vue provide,視窗內的元件 inject。
 * - `fs`:有效字級(px)—— 虛擬捲動的列高(DustTable / RegexList)依它算,字級一變 rowH 跟著重算。
 * - `style`:CSS 變數(或 null = 跟隨全域,不輸出)—— 綁在 Teleport 到 body 的提示框 / 對話框上,
 *   讓它們跟設定視窗同一個字級(Teleport 出去就不在設定視窗根元素底下,繼承不到)。
 * 不在設定視窗裡(沒有 provide)→ 退回全域 `fsBase`、style null。
 */
import { computed, inject, type ComputedRef, type InjectionKey } from 'vue'
import { AppConfig } from '@/web/Config'

export interface SettingsFsContext {
  fs: ComputedRef<number>
  style: ComputedRef<Record<string, string> | null>
}

export const SETTINGS_FS_KEY: InjectionKey<SettingsFsContext> = Symbol('settings-fs')

export function useSettingsFs (): SettingsFsContext {
  const ctx = inject(SETTINGS_FS_KEY, null)
  if (ctx) return ctx
  const config = AppConfig()
  return { fs: computed(() => config.fsBase || 13), style: computed(() => null) }
}
