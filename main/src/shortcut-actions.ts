/**
 * exile-appraiser(WP-S2):熱鍵 → 動作表(純函式,不 import electron / uiohook;`main/test/shortcut-actions.test.ts` 測)。
 * 原本在 `Shortcuts.ts` 的 `updateActions` 內;`Shortcuts` 仍負責 globalShortcut 註冊與觸發。
 */
import { hotkeyToString, mergeTwoHotkeys } from '@ipc/KeyToCode'
import { isGameReservedHotkey } from '@ipc/reserved-hotkeys'
import type { HostConfigForMain, WindowMode } from '@ipc/types'

export interface ShortcutAction {
  shortcut: string
  keepModKeys: boolean
  action:
  | { type: 'copy-item', focusOverlay: boolean } | { type: 'toggle-overlay' } | { type: 'ocr-reveal' } | { type: 'ocr-region' } | { type: 'runeshape-toggle' }
  /** 2026-10-01:框選符文塑形面板區域(renderer 開同一個框選層,target = runeshape) */
  | { type: 'runeshape-region' }
  /** 2026-10-01(移植 APT):聊天指令 / 倉庫搜尋 —— 會對遊戲送出按鍵(main/src/text-box.ts) */
  | { type: 'paste-in-chat', text: string, send: boolean } | { type: 'stash-search', text: string }
  /** 第 16 步:`hotkeyOcrReveal` 與 `hotkeyRuneshapeToggle` 相同且兩者都會註冊 → 合併成一個動作,一次切換兩個辨識(`nextScanPaused`) */
  | { type: 'scan-toggle-both' }
}

/** 聊天指令 / 倉庫搜尋最多各幾條(設定檔被手改成超大陣列時不註冊一大堆熱鍵) */
export const MAX_TEXT_ACTIONS = 50

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
  Partial<Pick<HostConfigForMain, 'runeshapeEnabled' | 'hotkeyRuneshapeToggle' | 'hotkeyRuneshapeRegion' | 'revealAutoEnabled' | 'commands' | 'stashSearch'>>

/**
 * 依設定組出要註冊的熱鍵(先到先得;空字串 / 重複 / 遊戲保留的不註冊)。
 * - 遊戲保留鍵(`ipc/reserved-hotkeys.ts`:Ctrl+C/V/A/F、Ctrl+Enter、Home、Delete、Enter、方向鍵、PoE2 的 Ctrl+Alt+C)一律不註冊
 *   (APT 同規則;聊天指令會送出這些鍵,註冊了會觸發自己)。
 * - 聊天指令(`paste-in-chat`)與倉庫搜尋(`stash-search`):兩個遊戲都有,**只在 overlay 模式**(熱鍵只在遊戲前景時註冊;
 *   window 模式熱鍵一律註冊,會把字打進別的程式)。文字空白的不註冊。
 * - 查價兩個動作一律有;overlay 模式多 `toggle-overlay`。
 * - WP-S / WP-S2:`ocr-reveal`、`ocr-region` 只在 overlay + PoE2、熱鍵非空時註冊(要 overlay 才有地方疊徽章 / 框選層)。
 *   2026-10-01 起 `ocr-reveal` = 暫停 / 繼續褻瀆自動辨識,另外要 `revealAutoEnabled`(省略 = 開)。
 * - WP-R2:`runeshape-toggle`(符文塑形自動查價暫停 / 繼續)另外要 `runeshapeEnabled`。
 *   2026-10-01:`runeshape-region`(框選符文塑形面板,`hotkeyRuneshapeRegion` 預設空)註冊條件同 `ocr-region`(不看是否啟用,
 *   關著時也能先框好區域)。
 * - 第 16 步:`ocr-reveal` 與 `runeshape-toggle` 兩者都成立且熱鍵正規化後相同 → 合併成一個 `scan-toggle-both`(放在 `ocr-reveal` 的位置,
 *   不算重複);只有一個成立時照舊是單一動作。與其他熱鍵重複的規則不變(先到先得)。
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
      const revealOn = Boolean(cfg.hotkeyOcrReveal) && cfg.revealAutoEnabled !== false
      const runeOn = Boolean(cfg.runeshapeEnabled && cfg.hotkeyRuneshapeToggle)
      const merged = revealOn && runeOn && normalizeHotkey(cfg.hotkeyOcrReveal) === normalizeHotkey(cfg.hotkeyRuneshapeToggle ?? '')
      if (revealOn) {
        actions.push({ shortcut: normalizeHotkey(cfg.hotkeyOcrReveal), keepModKeys: false, action: { type: merged ? 'scan-toggle-both' : 'ocr-reveal' } })
      }
      if (cfg.hotkeyOcrRegion) {
        actions.push({ shortcut: normalizeHotkey(cfg.hotkeyOcrRegion), keepModKeys: false, action: { type: 'ocr-region' } })
      }
      // WP-R2:符文塑形自動查價「暫停 / 繼續」只在功能開著時註冊(預設空 = 不註冊)
      if (runeOn && !merged) {
        actions.push({ shortcut: normalizeHotkey(cfg.hotkeyRuneshapeToggle ?? ''), keepModKeys: false, action: { type: 'runeshape-toggle' } })
      }
      if (cfg.hotkeyRuneshapeRegion) {
        actions.push({ shortcut: normalizeHotkey(cfg.hotkeyRuneshapeRegion), keepModKeys: false, action: { type: 'runeshape-region' } })
      }
    }
    for (const c of (cfg.commands ?? []).slice(0, MAX_TEXT_ACTIONS)) {
      if (c && typeof c.hotkey === 'string' && c.hotkey && typeof c.text === 'string' && c.text.trim()) {
        actions.push({ shortcut: normalizeHotkey(c.hotkey), keepModKeys: false, action: { type: 'paste-in-chat', text: c.text.trim(), send: c.send !== false } })
      }
    }
    for (const s of (cfg.stashSearch ?? []).slice(0, MAX_TEXT_ACTIONS)) {
      if (s && typeof s.hotkey === 'string' && s.hotkey && typeof s.text === 'string' && s.text.trim()) {
        actions.push({ shortcut: normalizeHotkey(s.hotkey), keepModKeys: false, action: { type: 'stash-search', text: s.text.trim() } })
      }
    }
  }
  const seen = new Set<string>()
  return actions.filter(a => {
    if (!a.shortcut || seen.has(a.shortcut) || isGameReservedHotkey(a.shortcut)) return false
    seen.add(a.shortcut)
    return true
  })
}

/** 設定裡被當成遊戲保留鍵而不註冊的熱鍵(log / 設定頁提示用) */
export function reservedShortcuts (cfg: ActionCfg): string[] {
  const all = [
    mergeTwoHotkeys(normalizeHotkey(cfg.hotkeyHold), normalizeHotkey(cfg.hotkey)), cfg.hotkeyLocked, cfg.overlayKey, cfg.hotkeyOcrReveal, cfg.hotkeyOcrRegion,
    cfg.hotkeyRuneshapeToggle ?? '', cfg.hotkeyRuneshapeRegion ?? '', ...(cfg.commands ?? []).map(c => c?.hotkey ?? ''), ...(cfg.stashSearch ?? []).map(s => s?.hotkey ?? '')
  ]
  return [...new Set(all.filter(Boolean).map(k => normalizeHotkey(k)).filter(isGameReservedHotkey))]
}

/** 兩份動作清單(熱鍵字串 + 動作內容 + keepModKeys)完全相同 → true。設定頁每打一個字都會送 host-config,相同就不必重註冊全域熱鍵。 */
export function sameShortcutActions (a: ShortcutAction[], b: ShortcutAction[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 第 16 步:合併熱鍵(`scan-toggle-both`)按下後,參與的辨識要變成的暫停狀態。
 * `paused` = 參與的各功能目前是否被使用者暫停;任一個在執行 → 全部暫停(true);全部暫停 → 全部繼續(false)。
 * 空陣列 → 不動作(null)。
 */
export function nextScanPaused (paused: boolean[]): boolean | null {
  if (paused.length === 0) return null
  return !paused.every(Boolean)
}
