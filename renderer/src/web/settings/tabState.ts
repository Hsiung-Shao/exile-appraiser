/**
 * 設定面板目前的分頁(模組層級:關掉再打開設定仍停在上次的分頁,不進設定檔)。
 * 托盤「設定」「關於」經 `open-settings {tab}` 直接指定(App.vue)。
 * `settingsBack`:從熱鍵總表跳到別頁時的返回連結(settings-nav.ts;切到別的分頁由 SettingsWindow 清掉)。
 */
import { shallowRef } from 'vue'
import type { SettingsTabId } from '@ipc/types'
import type { SettingsBack } from './settings-nav'

export type TabId = SettingsTabId

export const settingsTab = shallowRef<TabId>('general')

export const settingsBack = shallowRef<SettingsBack | null>(null)

/** 跳到別頁並在那一頁頂端顯示「← 回到 {from}」;`scroll` = 返回時要捲回的位置 */
export function jumpToTab (from: TabId, to: TabId, scroll = 0): void {
  settingsBack.value = from === to ? null : { from, target: to, scroll }
  settingsTab.value = to
}
