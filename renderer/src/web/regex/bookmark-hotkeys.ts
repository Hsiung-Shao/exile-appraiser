/**
 * 第 33 步:正則書籤的個別熱鍵(由 `store.ts` 依 `regex_state.json` 的書籤寫入;`regex/src/quick.ts` `bookmarkHotkeys`)。
 * 獨立成一個只依賴 vue 的模組:`Config.ts` 要把它併進 host-config,而 store 本身 import Config(不能反過來 import store)。
 */
import { shallowRef } from 'vue'
import type { RegexBookmarkHotkey } from '@ipc/types'

/** 全部書籤的熱鍵(含另一個遊戲的;main 只註冊目前遊戲的,設定頁衝突判定也只看目前遊戲) */
export const regexBookmarkHotkeyList = shallowRef<RegexBookmarkHotkey[]>([])
