# 聊天指令與倉庫搜尋熱鍵(2026-10-01)

從 Awakened PoE Trade(MIT,`LICENSES/awakened-poe-trade.MIT`)移植:`main/src/shortcuts/text-box.ts`、`renderer/src/web/settings/chat.vue`、
`renderer/src/web/Config.ts` 的 `commands` 預設、`main/src/shortcuts/Shortcuts.ts` 的遊戲保留鍵與 paste-in-chat / stash-search 分支。
兩個遊戲都可用。**這是本專案第一個在執行期對遊戲送出聊天 / 搜尋按鍵的功能**(使用者要求);查價的 Ctrl+C 之外,其他功能仍不送任何輸入。

| 段 | 檔案 | 做什麼 |
|---|---|---|
| 設定 | `renderer/src/web/Config.ts` | `commands: {text, hotkey, send}[]`(預設 APT 六條:`/hideout`=F5、`/exit`=F9、`@last ty`、`/invite @last`、`/tradewith @last`、`/hideout @last`,全部直接送出;APT 的 `hotkey: null` 讀檔時轉 `''`)、`stashSearch: {text, hotkey}[]`(預設空,text ≤ 250 字);各最多 50 條;兩者都送進 host-config |
| 分頁 | `renderer/src/web/settings/tabs/Chat.vue` | 「聊天指令」:每列文字 / 直接送出 / 熱鍵 / 刪除、新增、還原預設;「倉庫搜尋」一區。每列顯示熱鍵問題(`hotkey-conflicts.ts`:遊戲保留鍵、與其他熱鍵重複〔先到先得,順序同 main〕、main 回報被其他程式佔用)。window 模式顯示「只在疊加模式註冊」 |
| Poe Regex | `renderer/src/web/regex/RegexPanel.vue` | 「加到倉庫搜尋」:把目前字串加進 `stashSearch`(熱鍵空白,到聊天指令分頁設;同字串不重複、> 250 字不能加) |
| 註冊 | `main/src/shortcut-actions.ts` | 動作 `paste-in-chat` / `stash-search`:**只在 overlay 模式**(熱鍵只在遊戲前景時註冊;window 模式熱鍵一律註冊,會把字打進別的程式),文字空白 / 熱鍵空白不註冊;遊戲保留鍵(`ipc/reserved-hotkeys.ts`:APT 的 Ctrl+C/V/A/F、Ctrl+Enter、Home、Delete、Enter、↑ → ← + PoE2 進階複製 `Ctrl + Alt + C`)對所有動作一律不註冊 |
| 觸發 | `main/src/Shortcuts.ts` | 照 APT 先放開熱鍵本身的按鍵(`keyToggle up`),再呼叫 `typeInChat` / `stashSearch`;log 只記指令類型不記內容(可能含玩家名) |
| 按鍵序列 | `main/src/text-box.ts` | 純函式 `chatKeySequence` / `stashSearchSequence` + 注入式 `typeInChat` / `stashSearch`(`tap`、`clipboard` 由呼叫端給)。全部包在 `HostClipboard.restoreShortly`(120 ms 內不重入,防遊戲「Too many actions」;`restoreClipboard` 開著時之後還原剪貼簿) |

## 按鍵序列(與 APT 逐步驟相同)

| 指令 | 剪貼簿 | 按鍵 |
|---|---|---|
| `@last …`(前綴) | `@last ` 之後的文字 | Ctrl+Enter(回覆最後私訊的人)→ Ctrl+V |
| `… @last`(後綴) | `@last` 之前的文字 | Ctrl+Enter → Home → Home(手把要兩次)→ Delete → Ctrl+V |
| 其他 | 全文 | Enter;開頭不是 `# % @ $ & /` 就再 Ctrl+A 全選 → Ctrl+V |
| `send` | — | 再 Enter 送出 → Enter → ↑ → ↑ → Esc(還原到上一個頻道) |
| 倉庫搜尋 | 字串 | 先 `assertGameActive`(overlay 有焦點時還給遊戲)→ Ctrl+F → Ctrl+V → Enter |

macOS 的 Ctrl 改 Meta(倉庫搜尋的 Ctrl+F 維持 Ctrl)。

## 驗證

- `main/test/text-box.test.ts`:四種指令形態 + send、倉庫搜尋、macOS;**假 keyTap / 假剪貼簿**驗證先寫剪貼簿再送鍵、120 ms 節流(不送任何真實輸入)。
- `main/test/shortcut-actions.test.ts`:兩遊戲註冊、window 模式不註冊、保留鍵(含 Ctrl + Alt + C)、與查價 / OCR 熱鍵先到先得、最多 50 條。
- `renderer/test/chat-commands.test.ts`:預設 / 往返 / 正規化、衝突表、「加到倉庫搜尋」。
- 無頭 Chrome + 假 host:分頁內容、重複 / 保留提示、host-config 帶出 commands / stashSearch(截圖在 scratchpad `batch4\`)。

## 待使用者在遊戲裡實測

真實送鍵只能在遊戲裡驗:F5 回藏身處、F9 `/exit`、`@last ty` 回覆、`/invite @last` 名字接在後面、沒勾「直接送出」時停在聊天框;
倉庫搜尋在倉庫開著時輸入並套用;PoE2 同上;連按不觸發「Too many actions」;`restoreClipboard` 開著時剪貼簿被還原。
