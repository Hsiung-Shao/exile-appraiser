/**
 * 遊戲保留的熱鍵(main 不註冊、設定頁標紅)。
 * 移植自 Awakened PoE Trade `main/src/shortcuts/Shortcuts.ts` 的 `allShortcuts` 初始集合(MIT;`LICENSES/awakened-poe-trade.MIT`):
 * 聊天指令 / 倉庫搜尋會對遊戲送出這些鍵(Ctrl+C/V/A/F、Ctrl+Enter、Home、Delete、Enter、方向鍵),
 * 若被註冊成全域熱鍵,送出時會觸發自己。
 * exile-appraiser:另加 PoE2 的進階複製鍵 `Ctrl + Alt + C`(查價時送給遊戲,`Shortcuts.ts` `copyItemHotkey`)。
 * 零依賴(main 與 renderer 共用;renderer vitest 以相對路徑匯入)。
 */
export const GAME_RESERVED_HOTKEYS: readonly string[] = [
  'Ctrl + C', 'Ctrl + V', 'Ctrl + A',
  'Ctrl + F',
  'Ctrl + Enter',
  'Home', 'Delete', 'Enter',
  'ArrowUp', 'ArrowRight', 'ArrowLeft',
  // PoE2 進階複製(Ctrl + 顯示進階詞綴鍵 Alt + C)
  'Ctrl + Alt + C'
]

export function isGameReservedHotkey (shortcut: string): boolean {
  return GAME_RESERVED_HOTKEYS.includes(shortcut)
}
