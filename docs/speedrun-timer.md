# speedrun 計時器(2026-11-10)

使用者實測 11-09 的單純碼表後要求「參考 speedrun 計時器」,選了:分段、與個人最佳比較、自動分段、外觀與毫秒;分段 = 內建章節可編輯。

## 畫面(overlay,`renderer/src/web/overlay/TimerWidget.vue`)
- 版面參考 LiveSplit:路線名 + 嘗試次數 → 分段列(名稱 | 與個人最佳的差值 | 累計;還沒跑到的段顯示 PB 累計)→ 大字主計時 `M:SS.cc` → 本段 / 上一段差值。
- 目前段放在倒數第二列;列數 = 設定 `speedrunRows`(1–20,預設 5)。
- 顏色:領先 `--ok`、落後 `--bad`、金段與新個人最佳 `--gold`、尚未開始 / 暫停灰。跑著的段只有比 PB 慢時才顯示即時差值(LiveSplit 慣例)。
- 只在跑著時每 50 ms 更新;拖曳、位置 `timerPos`、OCR 遮罩(scan-mask 來源 `timer`)、`overlayLayers.timer` 沿用 11-09 的做法。

## 規則(`core/src/speedrun/`,零依賴)
- `run.ts` 狀態機:idle → running ⇄ paused → finished。開始 / 分段同一個鍵(沒在跑 = 開始、暫停中 = 繼續、跑著 = 分段;跑完要先重設)。只算真實時間(RTA),**載入時間不扣**。
- **紀錄寫法(審查 2026-11-10 第 2 輪)**:開始時把路線的 PB / 金段存成快照 `base`;每次分段 / 撤銷都由「快照 + 這次的分段時間」重算路線的紀錄(`apply`)。
  紀錄隨分段立刻寫進設定檔,不靠重設 / 關閉流程(自動換遊戲重啟、當機都不會丟);撤銷誤按的分段連同紀錄一起還原;畫面一律跟快照比(`comparison`,跑完創 PB 那一刻仍看得到快了多少)。
- 金段:這段比快照的最佳段快 → 更新;前一段被跳過時段時間不可靠,不算。
- 個人最佳:跑完且總時間比快照 PB 快(或沒有 PB)→ PB 換成這次每段的累計。
- 撤銷分段回到上一段(跑完後撤銷,跑完到撤銷之間的時間照算);跳過分段把這段記成沒有時間(最後一段不能跳)。
- **每個遊戲一個 run,建立後不換**(`timer-state.ts`):run 每次操作才取目前的路線,不綁路線物件身分 → 設定檔被瀏覽器預覽重新套用、設定頁改名都不會重設進行中的計時;只有分段數改了才重設(對不上新清單)。「清除紀錄」會先重設進行中的計時(否則快照會把紀錄寫回去)。
- Client.txt 變小(被清空 / 截斷)→ 從頭讀;遊戲附著時同一路徑也重開(檔案可能被刪掉重建)。
- `autosplit.ts`:沒在跑 + 自動開始 + 進起跑區 → 開始;跑著 + 自動分段 + 進**目前這段**的觸發區 → 分段(重回之前的城鎮不觸發)。

## 路線(`routes.ts`,存設定 `speedrun.{poe1,poe2}`)
- 區域 id 來自使用者本機 Client.txt 實測(兩代)與 PoE2 GGPK `worldareas`。
- PoE1:第 1–10 章,分段觸發 = 進下一章城鎮 `1_2_town` … `1_5_town`、`2_6_town` … `2_10_town`,第 10 章 = 打完基塔弗進 `2_11_endgame_town`;起跑區 `1_1_1`。
- PoE2:第 1–4 章 + 間章 1–3:`G2_town`、`G3_town`、`G4_town`、`P1_Town`、`P2_Town`、`P3_Town`、`G_Endgame_Town`;起跑區 `G1_1`。**間章順序是依名稱推定,待使用者實機確認**。
- 設定頁可改名(直接改,不重設進行中的計時)、改觸發區域(內建城鎮 / 只能手動 / 自訂 id)、增刪、排序、還原內建。段數或任一段區域改了 → PB 與金段清空並提示(`replaceSplits`)。
- 設定檔壞值由 `normRoute` 收斂:路線壞 → 內建;pb / golds 長度或值不對 → 清空。

## Client.txt(`main/src/game-log.ts`,移植 APT GameLogWatcher,MIT)
- 行格式:`… [DEBUG Client N] Generating level <lv> area "<id>" with seed <n>`(與語言無關)。
- 只在 overlay + 計時器不是關閉 + 目前遊戲的路線開了自動開始或自動分段時監看(host-config `speedrunAutoLog`);`fs.watchFile` 每 250 ms,從檔尾開始、只讀新增,半行等補完。
- 路徑:設定 `clientLogPath`(手動)> 執行中 `PathOfExile*.exe` 目錄的 `logs\Client.txt`(一次性 PowerShell `Get-Process`,只讀;遊戲附著時重找)> 預設安裝位置。設定頁顯示狀態(IPC `client-log-status`)與「選擇檔案…」(`client-log-pick`)。
- 實跑(2026-11-10):scratchpad 複本 + 真 `fs.watchFile`:舊行不送、新行約 255 ms 送出、半行等補完。

## 熱鍵(設定 › 熱鍵 › 工具,預設全空,只在 overlay 且計時器不是關閉)
開始 / 分段 `hotkeyTimerToggle`、重設 `hotkeyTimerReset`、暫停 / 繼續 `hotkeyTimerPause`、撤銷分段 `hotkeyTimerUndo`、跳過分段 `hotkeyTimerSkip` → main `timer-action`。懸浮選單工具第二排:開始 / 分段、暫停、重設。

## 測試
`core/test/speedrun.test.ts`(S1–S10、S15、S17)、`main/test/game-log.test.ts`(S11–S13)、`main/test/speedrun-hotkeys.test.ts`(S16)、`renderer/test/speedrun-config.test.ts`(S14、S18)、`renderer/test-vue/speedrun-widget-mount.test.ts`(畫面)。

## 待使用者實機確認
進城自動分段的時機、PoE2 間章順序、Client.txt 自動找路徑(遊戲裝在 E 槽)、overlay 上的版面與顏色。
