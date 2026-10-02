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

## 倉庫頁籤捲動(Ctrl + 滾輪,2026-10-01 第 15 步)

移植 APT `main/src/shortcuts/Shortcuts.ts` 的 `uIOhook.on('wheel', …)` + `isStashArea`(與 `GameWindow.uiSidebarWidth`);EE2 上游兩者逐字相同,PoE2 沿用同一組比例。

| 項目 | 位置 | 說明 |
|---|---|---|
| 設定 | `renderer/src/web/Config.ts` | `stashScroll: boolean`,預設 `true`(同 APT);舊設定檔沒有這欄 / 非布林值 = 開,只有明確 `false` 才關;經 `hostConfigOf` 送進 host-config |
| UI | `renderer/src/web/settings/tabs/Hotkeys.vue` | 熱鍵卡片「倉庫頁籤捲動」:Ctrl + 滾輪 / 停用,說明註明只在 overlay 模式、遊戲在前景時有效 |
| 判斷 | `main/src/stash-scroll.ts` `stashScrollKey` | Ctrl 按著 + 遊戲 `isActive` + 開關開 → 游標在倉庫格子區(client 左側寬 = 高 × 370/600,且 y 在高 × 154/1600 ~ 1192/1600)不送(交給遊戲);其他位置 rotation > 0 → `ArrowRight`、< 0 → `ArrowLeft` |
| 接線 | `main/src/main.ts` | **只在 overlay 模式**建立 `StashScroll`;`uIOhook.on('wheel')`、`keyTap`;`onHostConfig` 設 `cfg.stashScroll !== false` |

**uiohook 掛鉤折衷**(`main/src/uiohook-gate.ts`):要收 wheel 事件掛鉤就得開著。功能開著時,遊戲在前景(且遊戲視窗沒 detach)期間 `acquire` 一份;
失焦、遊戲視窗 detach(`GameWindow.onDetach`,detach 不一定有 blur)、功能關閉、結束(`dispose`)→ `release`。功能關閉時完全維持效能修正第 5 步的行為
(只有查價面板追蹤期間才開掛鉤)。gate 歸零後延遲 5 秒才 stop,前景切換抖動不會頻繁 start / stop;重新啟動 / 結束仍由 `shutdown()` 強制停。
開關在第一次 host-config 才設(之前不持有);啟動時遊戲已在前景 → 收到設定立刻持有。

**掛鉤註冊失敗(2026-10-03 實機回歸)**:測試版放在很深的目錄時,每次 start 都丟 `UIOHOOK_ERROR_SET_WINDOWS_HOOK_EX`,倉庫頁籤捲動與查價面板游標離開自動關閉全部失效。根因不是延後 start,而是 `SetWindowsHookEx` 的 hMod 是 `uiohook-napi.node` 本身,其完整路徑 ≥ 252 字元時系統回 0x7E(ERROR_MOD_NOT_FOUND)(實測同一個 .node:≤ 251 字元成功、≥ 252 字元必失敗;啟動時 / 5 秒後 / stop 後再 start 結果都一樣)。修正:`main/src/uiohook-prebuild.ts` 在載入前發現路徑 > 240 字元就把 .node 複製到 `<userData>\native\uiohook-napi-<雜湊>\` 並設 `UIOHOOK_NAPI_PREBUILD`(node-gyp-build 讀這個環境變數)。gate 每次失敗只記一行錯誤碼,連續 3 次後本次執行停止重試。實機檢查:`node scripts/uiohook-hookcheck.mjs [--exe <ExileAppraiser.exe>]`(只註冊 / 解除掛鉤,不送輸入)。

**與查價面板的互動**:overlay 取得焦點(鎖定查價、設定、點進面板)時 `GameWindow.isActive` = false → 不送鍵,面板內 Ctrl + 滾輪不受影響。
快速查價(面板不取焦點、遊戲仍在前景)時照 APT 會送;熱鍵按住鍵是 Ctrl 時,按著 Ctrl 滾滾輪也會切頁籤(同 APT)。

測試:`main/test/stash-scroll.test.ts`(比例邊界、方向、無 Ctrl / 非前景 / 關閉、PoE1/PoE2、gate 計數 × 前景抖動 × 面板交錯、啟動時已前景、detach、dispose / shutdown;假 tap)、
`renderer/test/stash-scroll-config.test.ts`(預設 / 舊檔 / 往返、host-config 帶出與去抖比對)。

## 待使用者在遊戲裡實測

真實送鍵只能在遊戲裡驗:F5 回藏身處、F9 `/exit`、`@last ty` 回覆、`/invite @last` 名字接在後面、沒勾「直接送出」時停在聊天框;
倉庫搜尋在倉庫開著時輸入並套用;PoE2 同上;連按不觸發「Too many actions」;`restoreClipboard` 開著時剪貼簿被還原。
倉庫頁籤捲動:倉庫開著、游標在倉庫外 Ctrl + 滾輪往下 / 往上切到下一 / 上一頁;游標在倉庫格子上不動作(交給遊戲);PoE2 倉庫版面是否同樣適用;
鎖定查價面板開著時 Ctrl + 滾輪不切頁籤;設定改「停用」後不再切換。
