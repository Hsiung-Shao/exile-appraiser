/**
 * 設定視窗左選單的分頁表與舊分頁 id 的映射(純函式;`renderer/test/settings-ia.test.ts` 測)。
 * 2026-11-18 重整(方案 B,設計稿 https://claude.ai/artifact/KApC4XJhMQFnm1dHotpecK):左選單分三組 ——
 * 「設定」一般 / 遊戲與視窗 / 熱鍵 / 啟動與更新、「功能」查價 / 倉庫 / 聊天指令 / 自動辨識(只 PoE2)/ 計時器、
 * 「工具」正則 / 拆粉排行 / 記錄與效能 / 關於。一個功能的設定集中在一頁;全域熱鍵仍只在熱鍵總表編輯。
 * - 舊值:`stash-chat`(倉庫與聊天,第 39 步 ~ 2026-11-18)→ `stash`;第 39 步前的 `chat` 現在就是「聊天指令」頁。
 * - `poe2Only` 分頁在 PoE1 → `fallback`(自動辨識 → 倉庫:PoE1 的倉庫價格 OCR 設定在倉庫頁)。
 * 相對路徑匯入(renderer vitest 不載別名)。
 */
import type { LegacySettingsTabId, SettingsTabId } from '../../../../ipc/types'

export type SettingsTabGroup = 'settings' | 'features' | 'tools'

export interface SettingsTabDef {
  id: SettingsTabId
  /** 選單文字(i18n 鍵) */
  key: string
  /** 頁首的一句說明(i18n 鍵) */
  lead: string
  group: SettingsTabGroup
  /** 選單圖示:lucide 風格 24 格線條路徑(stroke,currentColor) */
  icon: string
  /** 只在 PoE2 出現在選單 */
  poe2Only?: boolean
  /** 目前遊戲看不到時改顯示的分頁(預設 `game`) */
  fallback?: SettingsTabId
  /** 內容區不捲動、子元素撐滿(表格 / 清單自己虛擬捲動) */
  fill?: boolean
}

export const SETTINGS_TABS: readonly SettingsTabDef[] = [
  { id: 'general', key: 'ppz.tab_general', lead: 'ppz.tab_lead.general', group: 'settings', icon: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6' },
  { id: 'game', key: 'ppz.tab_game', lead: 'ppz.tab_lead.game', group: 'settings', icon: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M6 12h4 M8 10v4 M15 13h.01 M18 11h.01' },
  { id: 'hotkeys', key: 'ppz.tab_hotkeys', lead: 'ppz.tab_lead.hotkeys', group: 'settings', icon: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M6 8h.01 M10 8h.01 M14 8h.01 M18 8h.01 M8 12h.01 M12 12h.01 M16 12h.01 M7 16h10' },
  { id: 'startup', key: 'ppz.tab_startup', lead: 'ppz.tab_lead.startup', group: 'settings', icon: 'M12 2v10 M18.4 6.6a9 9 0 1 1-12.77.04' },
  { id: 'price-check', key: 'ppz.tab_price_check', lead: 'ppz.tab_lead.price_check', group: 'features', icon: 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M21 21l-4.3-4.3' },
  { id: 'stash', key: 'ppz.tab_stash', lead: 'ppz.tab_lead.stash', group: 'features', icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M3 9h18 M3 15h18 M9 3v18 M15 3v18' },
  { id: 'chat', key: 'ppz.tab_chat', lead: 'ppz.tab_lead.chat', group: 'features', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { id: 'recognition', key: 'ppz.tab_recognition', lead: 'ppz.tab_lead.recognition', group: 'features', poe2Only: true, fallback: 'stash', icon: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 12h10' },
  { id: 'timer', key: 'ppz.tab_timer', lead: 'ppz.tab_lead.timer', group: 'features', icon: 'M4 14a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M10 2h4 M12 14l3-3' },
  { id: 'regex', key: 'ppz.tab_regex', lead: 'ppz.tab_lead.regex', group: 'tools', icon: 'M17 3v10 M12.67 5.5l8.66 5 M12.67 10.5l8.66-5 M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z' },
  { id: 'dust', key: 'ppz.tab_dust', lead: 'ppz.tab_lead.dust', group: 'tools', fill: true, icon: 'M6 3h12l4 6-10 13L2 9Z M11 3 8 9l4 13 4-13-3-6 M2 9h20' },
  { id: 'log', key: 'ppz.tab_log', lead: 'ppz.tab_lead.log', group: 'tools', fill: true, icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01' },
  { id: 'about', key: 'ppz.tab_about', lead: 'ppz.tab_lead.about', group: 'tools', icon: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M12 16v-4 M12 8h.01' }
]

/** 組標題(i18n 鍵) */
export const SETTINGS_TAB_GROUPS: ReadonlyArray<{ id: SettingsTabGroup, key: string }> = [
  { id: 'settings', key: 'ppz.nav_group_settings' },
  { id: 'features', key: 'ppz.nav_group_features' },
  { id: 'tools', key: 'ppz.nav_group_tools' }
]

/** 已不存在的分頁 id → 新分頁 */
export const LEGACY_SETTINGS_TABS: Readonly<Record<LegacySettingsTabId, SettingsTabId>> = {
  'stash-chat': 'stash'
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
 * 不認得的 → `general`;舊值照 `LEGACY_SETTINGS_TABS`;目前遊戲看不到的 → 該頁的 `fallback`(沒有 → `game`)。
 */
export function resolveSettingsTab (id: string | null | undefined, game: 'poe1' | 'poe2'): SettingsTabId {
  let tab: SettingsTabId = 'general'
  if (id && IDS.has(id)) tab = id as SettingsTabId
  else if (id && Object.prototype.hasOwnProperty.call(LEGACY_SETTINGS_TABS, id)) tab = LEGACY_SETTINGS_TABS[id as LegacySettingsTabId]
  if (isTabVisible(tab, game)) return tab
  return SETTINGS_TABS.find(t => t.id === tab)?.fallback ?? 'game'
}
