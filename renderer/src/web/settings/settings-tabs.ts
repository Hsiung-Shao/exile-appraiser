/**
 * 第 39 步(設定頁資訊架構整理):設定視窗左選單的分頁表與舊分頁 id 的映射(純函式;`renderer/test/settings-ia.test.ts` 測)。
 * 左選單分兩組:「設定」(一般 / 遊戲 / 查價 / 倉庫與聊天 / 自動辨識 / 熱鍵 / 更新與關於)與「工具」(正則 / 拆粉排行 / 記錄)。
 * - 自動辨識只在 PoE2 出現在選單(兩個辨識功能都只有 PoE2);目前分頁是自動辨識但遊戲換成 PoE1 → 顯示「遊戲」。
 * - 舊值(第 39 步前):`chat`(聊天指令)→ `stash-chat`;其餘 id 沿用,但內容有搬:
 *   舊「熱鍵與視窗」(`hotkeys`)的視窗設定 → `game`、辨識卡片 → `recognition`、熱鍵 → `hotkeys`(總表)。
 *   OCR 框選由設定開啟時,結束後回 `recognition`(App.vue `returnsToSettings`)。
 * 相對路徑匯入(renderer vitest 不載別名)。
 */
import type { LegacySettingsTabId, SettingsTabId } from '../../../../ipc/types'

export type SettingsTabGroup = 'settings' | 'tools'

export interface SettingsTabDef {
  id: SettingsTabId
  /** 選單文字(i18n 鍵) */
  key: string
  group: SettingsTabGroup
  /** 只在 PoE2 出現在選單 */
  poe2Only?: boolean
  /** 內容區不捲動、子元素撐滿(表格 / 清單自己虛擬捲動) */
  fill?: boolean
}

export const SETTINGS_TABS: readonly SettingsTabDef[] = [
  { id: 'general', key: 'ppz.tab_general', group: 'settings' },
  { id: 'game', key: 'ppz.tab_game', group: 'settings' },
  { id: 'price-check', key: 'ppz.tab_price_check', group: 'settings' },
  { id: 'stash-chat', key: 'ppz.tab_stash_chat', group: 'settings' },
  { id: 'recognition', key: 'ppz.tab_recognition', group: 'settings', poe2Only: true },
  { id: 'hotkeys', key: 'ppz.tab_hotkeys', group: 'settings' },
  { id: 'about', key: 'ppz.tab_about', group: 'settings' },
  { id: 'regex', key: 'ppz.tab_regex', group: 'tools' },
  { id: 'dust', key: 'ppz.tab_dust', group: 'tools', fill: true },
  { id: 'log', key: 'ppz.tab_log', group: 'tools', fill: true }
]

/** 組標題(i18n 鍵) */
export const SETTINGS_TAB_GROUPS: ReadonlyArray<{ id: SettingsTabGroup, key: string }> = [
  { id: 'settings', key: 'ppz.nav_group_settings' },
  { id: 'tools', key: 'ppz.nav_group_tools' }
]

/** 第 39 步前的分頁 id → 新分頁 */
export const LEGACY_SETTINGS_TABS: Readonly<Record<LegacySettingsTabId, SettingsTabId>> = {
  chat: 'stash-chat'
}

const IDS = new Set<string>(SETTINGS_TABS.map(t => t.id))

/** 這一頁在目前遊戲會不會出現在選單 */
export function isTabVisible (id: SettingsTabId, game: 'poe1' | 'poe2'): boolean {
  const def = SETTINGS_TABS.find(t => t.id === id)
  return !!def && (!def.poe2Only || game === 'poe2')
}

/** 目前遊戲在選單上的分頁(依組、依順序) */
export function visibleTabs (game: 'poe1' | 'poe2'): SettingsTabDef[] {
  return SETTINGS_TABS.filter(t => isTabVisible(t.id, game))
}

/**
 * 任何來源的分頁 id(托盤 / 預覽網址 `#tab=` / 程式內跳轉 / 舊值)→ 實際要顯示的分頁。
 * 不認得的 → `general`;舊值照 `LEGACY_SETTINGS_TABS`;目前遊戲看不到的(PoE1 的自動辨識)→ `game`。
 */
export function resolveSettingsTab (id: string | null | undefined, game: 'poe1' | 'poe2'): SettingsTabId {
  let tab: SettingsTabId = 'general'
  if (id && IDS.has(id)) tab = id as SettingsTabId
  else if (id && Object.prototype.hasOwnProperty.call(LEGACY_SETTINGS_TABS, id)) tab = LEGACY_SETTINGS_TABS[id as LegacySettingsTabId]
  return isTabVisible(tab, game) ? tab : 'game'
}
