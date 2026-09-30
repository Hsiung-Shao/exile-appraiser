/**
 * exile-appraiser(WP-S2):熱鍵 → 動作表(純函式,不 import electron / uiohook;`main/test/shortcut-actions.test.ts` 測)。
 * 原本在 `Shortcuts.ts` 的 `updateActions` 內;`Shortcuts` 仍負責 globalShortcut 註冊與觸發。
 */
import { hotkeyToString, mergeTwoHotkeys } from '@ipc/KeyToCode'
import type { HostConfigForMain, WindowMode } from '@ipc/types'

export interface ShortcutAction {
  shortcut: string
  keepModKeys: boolean
  action: { type: 'copy-item', focusOverlay: boolean } | { type: 'toggle-overlay' } | { type: 'ocr-reveal' } | { type: 'ocr-region' } | { type: 'runeshape-toggle' }
}

/** 設定檔可能寫 `Ctrl+D` / `ctrl + d`;統一成 APT 的 `Ctrl + D`。 */
export function normalizeHotkey (hotkey: string): string {
  const keys = hotkey.split('+').map(s => s.trim()).filter(Boolean)
    .map(k => {
      const lower = k.toLowerCase()
      if (lower === 'ctrl' || lower === 'control') return 'Ctrl'
      if (lower === 'alt') return 'Alt'
      if (lower === 'shift') return 'Shift'
      return k.length === 1 ? k.toUpperCase() : k
    })
  return hotkeyToString(keys)
}

type ActionCfg = Pick<HostConfigForMain, 'hotkey' | 'hotkeyHold' | 'hotkeyLocked' | 'overlayKey' | 'game' | 'hotkeyOcrReveal' | 'hotkeyOcrRegion'> &
  Partial<Pick<HostConfigForMain, 'runeshapeEnabled' | 'hotkeyRuneshapeToggle' | 'revealAutoEnabled'>>

/**
 * 依設定組出要註冊的熱鍵(先到先得;空字串 / 重複的不註冊)。
 * - 查價兩個動作一律有;overlay 模式多 `toggle-overlay`。
 * - WP-S / WP-S2:`ocr-reveal`、`ocr-region` 只在 overlay + PoE2、熱鍵非空時註冊(要 overlay 才有地方疊徽章 / 框選層)。
 *   2026-10-01 起 `ocr-reveal` = 暫停 / 繼續褻瀆自動辨識,另外要 `revealAutoEnabled`(省略 = 開)。
 * - WP-R2:`runeshape-toggle`(符文塑形自動查價暫停 / 繼續)另外要 `runeshapeEnabled`。
 *   「遊戲在前景才註冊」由 `Shortcuts` 的 active-change 處理(對所有動作一樣)。
 */
export function buildShortcutActions (cfg: ActionCfg, mode: WindowMode): ShortcutAction[] {
  const quick = mergeTwoHotkeys(normalizeHotkey(cfg.hotkeyHold), normalizeHotkey(cfg.hotkey))
  const locked = normalizeHotkey(cfg.hotkeyLocked)
  const overlayKey = normalizeHotkey(cfg.overlayKey)
  const actions: ShortcutAction[] = [
    { shortcut: quick, keepModKeys: true, action: { type: 'copy-item', focusOverlay: false } },
    { shortcut: locked, keepModKeys: false, action: { type: 'copy-item', focusOverlay: true } }
  ]
  if (mode === 'overlay') {
    actions.push({ shortcut: overlayKey, keepModKeys: false, action: { type: 'toggle-overlay' } })
    if (cfg.game === 'poe2') {
      if (cfg.hotkeyOcrReveal && cfg.revealAutoEnabled !== false) {
        actions.push({ shortcut: normalizeHotkey(cfg.hotkeyOcrReveal), keepModKeys: false, action: { type: 'ocr-reveal' } })
      }
      if (cfg.hotkeyOcrRegion) {
        actions.push({ shortcut: normalizeHotkey(cfg.hotkeyOcrRegion), keepModKeys: false, action: { type: 'ocr-region' } })
      }
      // WP-R2:符文塑形自動查價「暫停 / 繼續」只在功能開著時註冊(預設空 = 不註冊)
      if (cfg.runeshapeEnabled && cfg.hotkeyRuneshapeToggle) {
        actions.push({ shortcut: normalizeHotkey(cfg.hotkeyRuneshapeToggle), keepModKeys: false, action: { type: 'runeshape-toggle' } })
      }
    }
  }
  const seen = new Set<string>()
  return actions.filter(a => {
    if (!a.shortcut || seen.has(a.shortcut)) return false
    seen.add(a.shortcut)
    return true
  })
}
