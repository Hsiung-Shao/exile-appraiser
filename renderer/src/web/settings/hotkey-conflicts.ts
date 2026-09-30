/**
 * 設定頁的熱鍵衝突表(純函式;`renderer/test/chat-commands.test.ts` 測)。
 * 與 main `shortcut-actions.ts` 同一套規則:依註冊順序先到先得(查價 → 鎖定 → overlay → 褻瀆暫停 / 褻瀆框選 / 符文暫停 / 符文框選 → 聊天指令 → 倉庫搜尋),
 * 重複的後者不註冊;遊戲保留鍵(`ipc/reserved-hotkeys.ts`)一律不註冊。熱鍵與視窗分頁、聊天指令分頁共用。
 * 相對路徑匯入(renderer vitest 不載別名)。
 */
import { hotkeyToString, mergeTwoHotkeys } from '../../../../ipc/KeyToCode'
import { isGameReservedHotkey } from '../../../../ipc/reserved-hotkeys'

/** 同 main 的 normalizeHotkey(`Ctrl+D` / `ctrl + d` → `Ctrl + D`) */
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

export interface HotkeySlot {
  /** `quick` / `locked` / `overlay` / `ocr` / `region` / `runeshape` / `runeRegion` / `cmd:<i>` / `stash:<i>` */
  id: string
  hotkey: string
}

export interface HotkeyConfigLike {
  hotkey: string
  hotkeyHold: string
  hotkeyLocked: string
  overlayKey: string
  game: 'poe1' | 'poe2'
  hotkeyOcrReveal: string
  hotkeyOcrRegion: string
  hotkeyRuneshapeToggle: string
  hotkeyRuneshapeRegion?: string
  revealAutoEnabled?: boolean
  runeshapeEnabled?: boolean
  commands: Array<{ text: string, hotkey: string }>
  stashSearch: Array<{ text: string, hotkey: string }>
}

/**
 * 依 main 的註冊順序列出會註冊的熱鍵欄位(條件同 `buildShortcutActions`:PoE1 沒有 OCR / 符文那三個;
 * 褻瀆暫停鍵要自動辨識開著、符文暫停鍵要符文塑形開著;文字空白的指令不註冊,不列入)
 */
export function hotkeySlots (c: HotkeyConfigLike): HotkeySlot[] {
  const slots: HotkeySlot[] = [
    { id: 'quick', hotkey: mergeTwoHotkeys(normalizeHotkey(c.hotkeyHold), normalizeHotkey(c.hotkey)) },
    { id: 'locked', hotkey: c.hotkeyLocked },
    { id: 'overlay', hotkey: c.overlayKey }
  ]
  if (c.game === 'poe2') {
    if (c.revealAutoEnabled !== false) slots.push({ id: 'ocr', hotkey: c.hotkeyOcrReveal })
    slots.push({ id: 'region', hotkey: c.hotkeyOcrRegion })
    if (c.runeshapeEnabled) slots.push({ id: 'runeshape', hotkey: c.hotkeyRuneshapeToggle })
    slots.push({ id: 'runeRegion', hotkey: c.hotkeyRuneshapeRegion ?? '' })
  }
  c.commands.forEach((x, i) => { if (x.text.trim()) slots.push({ id: `cmd:${i}`, hotkey: x.hotkey }) })
  c.stashSearch.forEach((x, i) => { if (x.text.trim()) slots.push({ id: `stash:${i}`, hotkey: x.hotkey }) })
  return slots.map(s => ({ id: s.id, hotkey: s.hotkey ? normalizeHotkey(s.hotkey) : '' }))
}

export type HotkeyIssue = { kind: 'reserved', key: string } | { kind: 'duplicate', key: string, with: string }

/** 每個欄位的問題(沒有問題不在表裡) */
export function hotkeyIssues (slots: HotkeySlot[]): Map<string, HotkeyIssue> {
  const out = new Map<string, HotkeyIssue>()
  const owner = new Map<string, string>()
  for (const s of slots) {
    if (!s.hotkey) continue
    if (isGameReservedHotkey(s.hotkey)) { out.set(s.id, { kind: 'reserved', key: s.hotkey }); continue }
    const first = owner.get(s.hotkey)
    if (first) out.set(s.id, { kind: 'duplicate', key: s.hotkey, with: first })
    else owner.set(s.hotkey, s.id)
  }
  return out
}
