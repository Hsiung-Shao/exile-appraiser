/**
 * 第 39 步:設定 › 熱鍵(總表)的列(純函式;`renderer/test/settings-ia.test.ts` 測涵蓋 `hotkey-conflicts.ts` 的全部欄位)。
 * - 依功能分組:查價 / 設定選單 / 自動辨識(PoE2)/ 正則 / 倉庫與聊天。
 * - `edit` 列在總表直接編輯(綁 `field` 設定鍵);`ref` 列唯讀,點了跳到 `tab` 那一頁編輯
 *   (聊天指令、倉庫搜尋、個別正則書籤的熱鍵與項目綁在一起,留在各自頁面)。
 * - 條件同 main `buildShortcutActions`:只有查價兩個熱鍵在 window 模式也會註冊;其餘只在 overlay 模式,
 *   自動辨識四個只在 PoE2 → 不符條件的組整個不列(`overlay` / `game` 參數)。
 * - 列 id 與 `hotkey-conflicts.ts` 的 slot id 相同,衝突 / 保留鍵 / 被佔用提示直接用 `useHotkeyIssues().issueText(id, hotkey)`。
 * 相對路徑匯入(renderer vitest 不載別名)。
 */
import type { SettingsTabId } from '../../../../ipc/types'
import type { HotkeyConfigLike } from './hotkey-conflicts'

/** 總表直接編輯的設定鍵 */
export type HotkeyField = 'hotkey' | 'hotkeyLocked' | 'overlayKey' | 'hotkeyOcrReveal' | 'hotkeyOcrRegion' |
  'hotkeyRuneshapeToggle' | 'hotkeyRuneshapeRegion' | 'hotkeyRegexQuick'

export type HotkeyRow =
  | { kind: 'edit', id: string, label: string, field: HotkeyField, hold?: boolean, needs?: 'revealAutoEnabled' | 'runeshapeEnabled' }
  | { kind: 'ref', id: string, label: string, text: string, hotkey: string, tab: SettingsTabId }

export interface HotkeyGroup {
  id: 'price' | 'menu' | 'scan' | 'regex' | 'stash-chat'
  /** 組標題(i18n 鍵) */
  title: string
  /** 唯讀列的「到 … 編輯」連結目標(沒有唯讀列 → 無) */
  tab?: SettingsTabId
  rows: HotkeyRow[]
}

export interface HotkeyTableOpts {
  /** overlay 模式(設定 `overlayMode`):false 時只列查價 */
  overlay: boolean
}

/** 總表的組與列(順序 = main 的註冊順序,先到先得) */
export function hotkeyTable (c: HotkeyConfigLike, opts: HotkeyTableOpts): HotkeyGroup[] {
  const groups: HotkeyGroup[] = [{
    id: 'price',
    title: 'ppz.hk_group.price',
    rows: [
      { kind: 'edit', id: 'quick', label: 'ppz.hotkey', field: 'hotkey', hold: true },
      { kind: 'edit', id: 'locked', label: 'ppz.hotkey_locked', field: 'hotkeyLocked' }
    ]
  }]
  if (!opts.overlay) return groups
  groups.push({
    id: 'menu',
    title: 'ppz.hk_group.menu',
    rows: [{ kind: 'edit', id: 'overlay', label: 'ppz.hk.menu_toggle', field: 'overlayKey' }]
  })
  if (c.game === 'poe2') {
    groups.push({
      id: 'scan',
      title: 'ppz.hk_group.scan',
      rows: [
        { kind: 'edit', id: 'ocr', label: 'ppz.scan.slot_reveal_pause', field: 'hotkeyOcrReveal', needs: 'revealAutoEnabled' },
        { kind: 'edit', id: 'region', label: 'ppz.scan.slot_reveal_region', field: 'hotkeyOcrRegion' },
        { kind: 'edit', id: 'runeshape', label: 'ppz.scan.slot_rune_pause', field: 'hotkeyRuneshapeToggle', needs: 'runeshapeEnabled' },
        { kind: 'edit', id: 'runeRegion', label: 'ppz.scan.slot_rune_region', field: 'hotkeyRuneshapeRegion' }
      ]
    })
  }
  const chatRows: HotkeyRow[] = []
  c.commands.forEach((x, i) => {
    if (x.text.trim()) chatRows.push({ kind: 'ref', id: `cmd:${i}`, label: 'ppz.hk_group.chat_command', text: x.text.trim(), hotkey: x.hotkey, tab: 'stash-chat' })
  })
  c.stashSearch.forEach((x, i) => {
    if (x.text.trim()) chatRows.push({ kind: 'ref', id: `stash:${i}`, label: 'ppz.hk_group.stash_search', text: x.text.trim(), hotkey: x.hotkey, tab: 'stash-chat' })
  })
  groups.push({ id: 'stash-chat', title: 'ppz.hk_group.stash_chat', tab: 'stash-chat', rows: chatRows })
  const regexRows: HotkeyRow[] = [{ kind: 'edit', id: 'regexQuick', label: 'ppz.regex.quick_hotkey', field: 'hotkeyRegexQuick' }]
  for (const b of c.regexBookmarkHotkeys ?? []) {
    if (b.game === c.game && b.hotkey.trim()) regexRows.push({ kind: 'ref', id: `rxbm:${b.index}`, label: 'ppz.hk_group.regex_bookmark', text: b.name, hotkey: b.hotkey, tab: 'regex' })
  }
  groups.push({ id: 'regex', title: 'ppz.hk_group.regex', tab: 'regex', rows: regexRows })
  return groups
}

/** 總表上所有列的 id(守門測試用) */
export function hotkeyTableIds (c: HotkeyConfigLike, opts: HotkeyTableOpts): string[] {
  return hotkeyTable(c, opts).flatMap(g => g.rows.map(r => r.id))
}
