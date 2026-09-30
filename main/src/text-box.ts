/**
 * 移植自 Awakened PoE Trade `main/src/shortcuts/text-box.ts`(MIT,Copyright (c) 2020 Alexander Drozdov;
 * 授權全文見 `LICENSES/awakened-poe-trade.MIT`)。
 *
 * 聊天指令熱鍵(`/hideout`、`@last ty`…)與倉庫搜尋一鍵輸入:把文字寫進剪貼簿,再對遊戲送出按鍵序列。
 * exile-appraiser 改動:
 * - 按鍵序列抽成純函式(`chatKeySequence` / `stashSearchSequence`),實際送鍵與剪貼簿由呼叫端注入(`TextBoxDeps`):
 *   main 的 `Shortcuts.ts` 給 uiohook `keyTap` 與 `HostClipboard`;**單元測試只給假的 tap / 剪貼簿,不送任何真實輸入**。
 * - 包在 `HostClipboard.restoreShortly`(120 ms 內不重入,防遊戲「Too many actions」;`restoreClipboard` 開著時之後還原剪貼簿)。
 * - 倉庫搜尋先 `assertGameActive`(overlay 有焦點時把焦點還給遊戲)。
 * - 兩個遊戲都可用(PoE1 / PoE2 聊天框與倉庫搜尋的鍵相同)。
 */

/** 會用到的鍵(名稱同 uiohook-napi 的 `UiohookKey`) */
export type TextBoxKey = 'Enter' | 'Home' | 'Delete' | 'A' | 'V' | 'F' | 'ArrowUp' | 'Escape' | 'Ctrl' | 'Meta'

export interface KeyTap {
  key: TextBoxKey
  mods: TextBoxKey[]
}

export interface TextBoxDeps {
  /** 送一次按鍵(含修飾鍵);main = `uIOhook.keyTap(UiohookKey[key], mods.map(...))` */
  tap: (key: TextBoxKey, mods: TextBoxKey[]) => void
  /** `HostClipboard`(`restoreShortly` 120 ms 節流 + 之後還原) */
  clipboard: { restoreShortly: (cb: (clipboard: { writeText: (text: string) => void }) => void) => void }
  platform?: string
}

const PLACEHOLDER_LAST = '@last'
const AUTO_CLEAR = [
  '#', // Global
  '%', // Party
  '@', // Whisper
  '$', // Trade
  '&', // Guild
  '/' // Command
]

/**
 * 聊天指令的剪貼簿內容與按鍵序列(APT `typeInChat` 逐步驟相同):
 * - `@last …`(前綴):寫入 `@last ` 之後的文字,Ctrl+Enter(回覆最後私訊的人,聊天框已帶 `@名字 `)。
 * - `… @last`(後綴):寫入 `@last` 之前的文字,Ctrl+Enter → Home ×2(手把要按兩次才聚焦)→ Delete(刪掉 `@`,名字留在後面)。
 * - 其他:寫入全文,Enter 開聊天框;不是頻道前綴(# % @ $ & /)開頭的要 Ctrl+A 先全選(蓋掉殘留的字)。
 * - 最後 Ctrl+V 貼上;`send` 時 Enter 送出,再 Enter → ↑ ↑ → Esc 還原到上一個頻道。
 */
export function chatKeySequence (text: string, send: boolean, platform: string = process.platform): { clipboard: string, keys: KeyTap[] } {
  const mod: TextBoxKey[] = platform === 'darwin' ? ['Meta'] : ['Ctrl']
  const keys: KeyTap[] = []
  const tap = (key: TextBoxKey, mods: TextBoxKey[] = []) => { keys.push({ key, mods }) }
  let clip: string
  if (text.startsWith(PLACEHOLDER_LAST)) {
    clip = text.slice(`${PLACEHOLDER_LAST} `.length)
    tap('Enter', mod)
  } else if (text.endsWith(PLACEHOLDER_LAST)) {
    clip = text.slice(0, -PLACEHOLDER_LAST.length)
    tap('Enter', mod)
    tap('Home')
    // press twice to focus input when using controller
    tap('Home')
    tap('Delete')
  } else {
    clip = text
    tap('Enter')
    if (!AUTO_CLEAR.includes(text[0])) {
      tap('A', mod)
    }
  }
  tap('V', mod)
  if (send) {
    tap('Enter')
    // restore the last chat
    tap('Enter')
    tap('ArrowUp')
    tap('ArrowUp')
    tap('Escape')
  }
  return { clipboard: clip, keys }
}

/** 倉庫搜尋:Ctrl+F → Ctrl+V → Enter(APT `stashSearch`) */
export function stashSearchSequence (text: string, platform: string = process.platform): { clipboard: string, keys: KeyTap[] } {
  return {
    clipboard: text,
    keys: [
      { key: 'F', mods: ['Ctrl'] },
      { key: 'V', mods: [platform === 'darwin' ? 'Meta' : 'Ctrl'] },
      { key: 'Enter', mods: [] }
    ]
  }
}

export function typeInChat (text: string, send: boolean, deps: TextBoxDeps): void {
  deps.clipboard.restoreShortly((clipboard) => {
    const seq = chatKeySequence(text, send, deps.platform)
    clipboard.writeText(seq.clipboard)
    for (const k of seq.keys) deps.tap(k.key, k.mods)
  })
}

export function stashSearch (text: string, deps: TextBoxDeps & { assertGameActive?: () => void }): void {
  deps.clipboard.restoreShortly((clipboard) => {
    deps.assertGameActive?.()
    const seq = stashSearchSequence(text, deps.platform)
    clipboard.writeText(seq.clipboard)
    for (const k of seq.keys) deps.tap(k.key, k.mods)
  })
}
