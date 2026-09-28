/**
 * 設定面板目前的分頁(模組層級:關掉再打開設定仍停在上次的分頁,不進設定檔)。
 * 托盤「設定」「關於」經 `open-settings {tab}` 直接指定(App.vue)。
 */
import { shallowRef } from 'vue'
import type { SettingsTabId } from '@ipc/types'

export type TabId = SettingsTabId

export const settingsTab = shallowRef<TabId>('general')
