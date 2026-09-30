# 靈魂之井三選一揭露面板 OCR(WP-S)

PoE2 靈魂之井的「三選一」揭露面板無法複製文字。擷取遊戲畫面 → Windows 內建 OCR
→ 對 `data/poe2/desecration/tiers.json` 比對 → overlay 在每個選項右側顯示 `T4 · 一般 · 21–26 / 20–25`。
**2026-10-01 起改為自動持續辨識**(設定 `revealAutoEnabled`,預設開;見下節),原本的熱鍵(預設 **`Ctrl + Shift + R`**)改為「暫停 / 繼續」。
只在 **overlay 模式 + PoE2** 運作;PoE1 不掃描、不註冊熱鍵。**不送任何鍵盤 / 滑鼠輸入**(觸發時也不放開修飾鍵)。

## 自動持續辨識(2026-10-01)

使用者要求「與符文塑形一致:開關 + 自動持續辨識」。符文塑形的掃描骨架泛化成 `main/src/ocr/panel-scan.ts` 的 `PanelScan<PanelDetector>`
(排程、`scanBlock` 暫停條件、`bgraToGray` / `frameDiff` / `isChanged` 變化偵測、`ScanClock` / `ScanCapture` 注入、自動定位快取),
符文與褻瀆各注入自己的偵測器;褻瀆在 `main/src/ocr/reveal-scan.ts`(`RevealScan`、`createRevealDetector`)。

| 項目 | 褻瀆(`reveal-scan.ts`) | 符文塑形(`runeshape-scan.ts`,行為不變) |
|---|---|---|
| 設定 | `revealAutoEnabled`(預設**開**)、`revealIntervalMs`(500–3000,預設 1000)、區域沿用 `ocrRegion` | `runeshapeEnabled`(預設關)、`runeshapeIntervalMs`、`runeshapeRegion` |
| 資料 | `ready()` 第一次讀 `tiers.json` 建模板索引(`locate-data.ts`);讀不到 → 停止(`no-data`,清徽章) | 不需要 |
| 自動定位(沒快取時每 3 秒最多一次整個 client ×1) | `locatePanel`(像詞綴的行成簇 → 外擴) | `locateRunePanel` |
| 有沒有面板 | `findPanelHits` ≥ 2 行像詞綴(`REVEAL_MIN_HITS`,同 `checkRegion`) | ≥ 1 列 `isPanelRow` |
| 送出的行 | 區域 OCR 的**全部行**(renderer `matchRevealLines` 要用對不上的行補中間沒認出的組) | 含 CJK 的行 |
| 有框區域 | 優先區域;區域內連續 2 次沒面板 → **退回自動定位**(事件帶 `fallback: true`,設定頁顯示「區域內沒找到,改找整個畫面」),區域的縮圖有變化才回到區域 | 只看區域,不退回 |
| 暫停 | 遊戲失焦、設定 / 框選層開著;**查價面板開著不暫停**(看褻瀆時常同時開查價) | 另加查價面板開著 |
| 事件 | `reveal-scan-result`(`RevealScanEvent` = `PanelScanEvent`,不進 `PREVIEW_EVENTS`) | `runeshape-scan-result` |
| 熱鍵 | `hotkeyOcrReveal` = 暫停 / 繼續(`revealAutoEnabled` 關時不註冊) | `hotkeyRuneshapeToggle` |

- **共用 WinOcr**:兩個掃描的 `ocrBusy` 互看對方的 `busy`,忙碌就丟掉這個 tick(不排隊);main 啟動時褻瀆第一個 tick 立刻跑、符文延後半個間隔,兩者同時開著時交錯。
- **徽章**(`OcrBadges.vue` + `ocr-reveal.ts` `revealScanAction`):`rows` → 重新比對並重畫;比對不成面板(背包物品浮窗等,main 端只看得出「≥ 2 行像詞綴」)→ 靜靜清掉、不跳錯誤;
  `empty` / `inactive` / `user-paused` → 清除。**沒有 15 秒自動消失、沒有「再按一次清除」**;Esc 暫時清掉;overlay 改大小以最後結果重排;退回整個畫面的提示只在剛切過去時顯示 5 秒(`fallbackNoteShows`)。
- 框選確認後 `ocr-reveal-now` → `revealScan.rescan()`(丟掉差分基準與退回狀態,下一個 tick 一定重看)。
- 設定頁(熱鍵與視窗 › 褻瀆自動辨識卡片):開關、掃描間隔、狀態列(`reveal-stats`:找到 / 尋找中 / 退回 / 暫停,`revealScanStatus`)。
- 舊的按熱鍵辨識一次(`RevealOcr`、`ocr-reveal-result`)已移除;兩段式 `strategy.ts`(`smartRecognize` / `recognizeRegionFirst`)仍給 `--ocr-selftest` 用,下文「兩段式辨識」「框選辨識區域」的**單次**流程描述保留作歷史紀錄。
- 測試:`main/test/reveal-scan.test.ts`(三張真實截圖快照當畫面:偵測器定位 / 判定、自動定位 → ×3、畫面沒變不 OCR、面板關了 empty、查價面板開著照常、設定開著暫停、no-data、共用 WinOcr 忙碌、暫停熱鍵、區域 / 退回 / 回到區域、rescan、停用清徽章)、
  `renderer/test/reveal-scan.test.ts`(事件 → 徽章動作、狀態列、設定往返)、`main/test/runeshape-scan.test.ts`(泛化後符文行為不變)。

## 管線(2026-09-30 單次辨識時的設計;擷取 / OCR / 比對 / 座標系沿用)

| 段 | 檔案 | 做什麼 |
|---|---|---|
| 熱鍵 | `main/src/Shortcuts.ts` | 動作 `ocr-reveal`(`hotkeyOcrReveal`);`trigger` 最前面分支,只呼叫 `onOcrReveal` |
| 擷取 | `main/src/ocr/capture.ts` | `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: 該螢幕實體像素 })` → 用 `GameWindow.bounds`(client 區螢幕實體像素)減螢幕原點(`display.nativeOrigin`,沒有就 DIP × scaleFactor)裁出 client 區 |
| 前處理 | `capture.ts` `prepareRect()` / `rectRecognizer()` | 可選 `ocrRegion`(client 比例,`strategy.ts` `regionSearchRect` 以 client 尺寸換算再減擷取偏移)= 優先搜尋範圍 → 依下一列選的矩形裁切 → 放大(`×1` 或 `s = min(3, floor(9000 / max(w, h)))`:1080p / 1440p 3×、4K 2×;WinRT `MaxImageDimension` = 10000)→ `nativeImage.resize({ quality: 'best' })` → **JPEG q95**(`toPNG` 對 5760×3240 要 1.3–1.6 秒,JPEG 約 0.1 秒;逐字結果相同) |
| 選範圍 | `main/src/ocr/strategy.ts` `recognizeRegionFirst` / `smartRecognize` + `poe2/src/desecration/ocr-locate.ts` | 有框選區域 → 先只在區域內跑、找不到再整張(WP-S2,見「框選辨識區域」);每一輪都是**兩段式**:快取區 ×3 → 整張 ×1 定位 + 面板區 ×3 → 整張 ×3(見下節) |
| OCR | `main/src/ocr/win-ocr.ps1` + `WinOcr.ts` | 常駐 PowerShell 5.1 + WinRT `Windows.Media.Ocr`(`zh-Hant-TW`);`-EncodedCommand` 傳腳本(stdin 留給資料);協定見 ps1 檔頭;單張逾時 8 秒 / 崩潰 → 下一次自動重啟;閒置 10 分鐘結束;缺語言包的結果記 30 秒 |
| 廣播 | `main/src/ocr/reveal.ts` | `ocr-reveal-result`:先 `{phase:'pending'}`,再 `{phase:'result', ok, lines(client 實體像素), client, scale, tookMs, ocrMs, stage, stages}` 或 `{ok:false, error}`;`stage` = `cached \| two-pass \| full`(有框選區域時 `region \| region-fallback`,`inner` = 採用那一輪的內層路徑)、`stages` = 各段範圍 / 倍率 / 耗時 / 命中數 / 未採用原因 / `scope`(`region` / `screen`)(診斷用;renderer 只讀 `stage === 'region-fallback'` 顯示提示);**不在** `PREVIEW_EVENTS`(預覽端收不到) |
| 比對 | `poe2/src/desecration/ocr-match.ts`(renderer 經 `@poe2-entry` 的 `matchRevealLines`) | 正規化 → skeleton → 精確 / 模糊命中 → 折行合併 → 分組 → entry 一一對應 → profile → Tier(見下) |
| 顯示 | `renderer/src/web/overlay/OcrBadges.vue` + `ocr-reveal.ts` | 每組右側一枚徽章;清除:再按一次熱鍵、Esc(overlay 有焦點時)、15 秒、overlay 視窗移動或改大小(2026-10-01 起按住 Alt 不再隱藏) |

## 座標系

- main 送的行座標 = **遊戲 client 區的實體像素**(OCR 座標 ÷ 放大倍率 + 範圍偏移 + 擷取偏移),另附 `client {w, h}`。
- overlay 視窗與 client 區對齊(CSS 原點 = client 左上),renderer 以 `innerWidth / client.w`、`innerHeight / client.h` 換算,與螢幕 DPI 無關。
- 徽章 `left` = 組右緣 + 14 px、`top` = 組垂直中心(`translateY(-50%)`)。

## 兩段式辨識(2026-09-30)

整個 client ×3 對真實全螢幕(2000×1125,面板 + 背包 + 小地圖)要 0.9–1.4 秒,面板只佔畫面一小塊。改成先便宜地找面板、再只放大面板:

| 路徑 | 做什麼 | 什麼時候 |
|---|---|---|
| `cached` | 上次成功的面板區直接 ×3 | 記憶體快取有這個鍵(client 大小 + 擷取偏移 + 搜尋範圍;程式重啟失效),且 `checkRegion` 通過 |
| `two-pass` | 第 1 段:搜尋範圍 ×1 → `locatePanel` 找「像詞綴」的行 → 外擴成裁切框;第 2 段:裁切框 ×3(倍率仍受 9000 上限約束) | 沒快取,或快取區沒通過(清掉快取) |
| `full` | 搜尋範圍 ×3(原本的做法) | 第 1 段一行都不像詞綴、第 2 段沒通過 `checkRegion`、或 main 讀不到 tiers.json;full 的結果定位得到面板時也寫快取 |

- **定位(`ocr-locate.ts`,main 經 esbuild 打包)**:與 renderer 同一套正規化 + skeleton(`ocr-text.ts`,兩邊共用),對 `tiers.json` 的模板 skeleton(`text.zh` 394 個 + `text.zhVariants` 其他寫法 = 706 個)做精確 / 模糊(Levenshtein ≥ 0.85、長度差 ≤ 2)命中;
  自己對不上、接下一行才對上的折行兩行都算命中。**只回答「像不像詞綴」**,不看數值範圍、不分 entry、不推 Tier(那些仍在 renderer)。
  命中行依 y 成簇(相鄰中心距 ≤ 6 × 行高、x 中心對齊),採用所有 ≥ 2 行的簇(畫面上另有詞綴簇,例如背包物品浮窗,一起框進來——寧可框大也不框錯,挑面板是 renderer 的事);沒有 ≥ 2 行的簇就用全部命中行。
- **外擴**:水平每邊 `max(0.75 × 框寬, 8 × 行高)`(= 至少 1.5 倍半寬;最長的詞綴行可能比認出的行寬很多)、垂直每邊 `max(3 × 行高, (14 × 行高 − 框高) / 2)`(只認出 1–2 行時仍蓋得住 3 組 × 最多 3 行),夾在搜尋範圍內。
- **`checkRegion`**(cached 與第 2 段的驗收):≥ 2 行像詞綴,且命中框離範圍每個邊 ≥ 1 個行高(該邊本來就是搜尋範圍邊界時不算)。貼邊 = 面板可能有一部分在框外 → 換下一條路。
- **資料**:main 讀 `data/poe2/desecration/tiers.json`(`locate-data.ts`:打包後在 app 根目錄 `data/…`,renderer build 複製進去;開發 / selftest 讀 repo 根的 `data/`),第一次按熱鍵才讀(1.4 MB,解析 + 建索引約 17 ms)。
  選這個而不是「CJK + 數字」啟發式:真的對上模板才不會被小地圖、金幣、堆疊數、背包物品名誤導;代價只是 main 多讀一次資料檔。讀不到 → 只走 full(記一次 log)。
- **倍率只用 ×1 與 ×3**:同一張全螢幕實測 ×1 整張 534 ms、4 行全對;×1.5 / ×2 反而錯字(「閃避」→「因」、「增」→日文「増」);×3 全對。第 1 段只需要「找得到」,×1 最快且在這個解析度逐字正確。
  ×1 在更小的字(低解析度 / UI 縮放)可能一行都認不出 → 自動退回 full,只是變回原本的速度。

## 框選辨識區域(WP-S2,2026-09-30)

使用者回報原本「四個 0–1 數字欄位」不直觀。改成**在遊戲畫面上直接拖曳框選**;辨識時**優先用區域、失敗再自動找整個畫面**。

### 流程

| 步驟 | 檔案 | 做什麼 |
|---|---|---|
| 入口 | `settings/tabs/Hotkeys.vue`、`Shortcuts.ts` / `shortcut-actions.ts` | 設定 › 熱鍵與視窗 › 靈魂之井揭露 OCR 卡片:狀態(「未設定(自動找整個畫面)」/「已設定:左 19%、上 44%、寬 28%、高 25%」)+「在遊戲上框選」「清除」;四個數字欄位收進「進階」`<details>`。選用熱鍵 `hotkeyOcrRegion`(預設空 = 不註冊;註冊條件同 OCR 熱鍵:overlay + PoE2 + 遊戲前景)→ main 送 `ocr-region-pick`。瀏覽器預覽 / window 模式沒有框選鈕,改顯示說明 |
| 開啟 | `overlay/OcrRegionPicker.vue`、`overlay/ocr-reveal.ts` | `regionPickerOpen = true` → 呼叫 `overlay-activate`(main `assertOverlayActive`,overlay 可點擊);`App.vue` 隱藏設定視窗 / 查價面板;`OcrBadges.vue` 清掉徽章 |
| 回到設定 | `App.vue`、`ocr-reveal.ts` `returnsToSettings` | 由設定視窗開的框選(`regionPickerSource = 'settings'`),確認 / 取消鈕 / 清除後**自動重開設定並停在熱鍵分頁**(不 `focus-game`,overlay 維持可點擊);**這條路徑確認後不自動試辨識**(置中的設定視窗會擋住揭露面板)。失焦 / 視窗隱藏結束的不回設定;熱鍵開的框選行為不變 |
| 畫面 | 同上 | 暗幕 `rgba(0,0,0,.55)`,選取框內挖空(選取框的超大 `box-shadow`);選取框 `--gold` 邊框 + 8 個方形把手 + 即時百分比;參考框:「目前區域」實線、「上次偵測」`--accent` 虛線;頂部說明條與按鈕(確認 / 套用上次偵測 / 清除區域 / 取消)是深色島(`.pob-dark`,淺色主題也維持深色,與徽章一致) |
| 操作 | `overlay/region-geom.ts`(純函式) | 空白處拖曳 = 新框(點一下 < 3 px 不改選取);框內拖曳 = 移動;把手 = 只動該邊;最小 40×40 CSS px;全部夾在視窗內;方向鍵移動 1 px、Shift 10 px,Ctrl + 方向鍵調右 / 下邊 |
| 確認 | `OcrRegionPicker.vue` | Enter 或「確認」→ `config.ocrRegion = normOcrRegion(toRegion(box))`(四位小數)→ 關層 → `focus-game` → **150 ms 後 `ocr-reveal-now`**(= 按一次 OCR 熱鍵;main 先確認是 PoE2 overlay 且有遊戲視窗)。面板還開著就能立刻看到徽章驗證(由設定開的框選例外,見「回到設定」) |
| 取消 | 同上 | Esc、「取消」、overlay 失焦(`focus-change` overlay=false)、視窗隱藏(`document.hidden`)→ 不存、關層。overlay 內按 Esc 會先被 main 的 `before-input-event` 攔下並把焦點還給遊戲 → 走「失焦」取消,結果相同 |
| 框選中 | `App.vue` | 忽略背景點擊關閉(overlay 已沒有按住 Alt 隱藏) |
| 清快取 | `main.ts` → `RevealOcr.regionChanged` → `RegionCacheGuard` | `host-config` 帶來的 `ocrRegion` 與上次不同 → 清 `RevealOcr.cache`(舊區域算出的面板區不再可信) |

「上次偵測」= renderer 最近一次比對成功的所有組矩形聯集(client 實體像素),外擴水平每邊 50% 框寬、垂直每邊 2 × 平均行高,換成 client 比例夾在 0–1(`detectedRegion`)。
「套用上次偵測」把它設成選取框(還要按確認才存)。

### 座標系

- 框選層在 overlay 視窗裡,CSS 原點 = 遊戲 client 左上;`ocrRegion` = CSS px ÷ `innerWidth / innerHeight`(client 比例,與 DPI 無關)。
- main `regionSearchRect(影像, ocrRegion, { client, offset })`:**比例 × client 尺寸 − 擷取偏移**,再夾進擷取影像。
  遊戲視窗部分跑出螢幕時,擷取影像只有螢幕內那塊(`offset` = 影像左上在 client 內的位置),舊版「比例 × 影像大小」會偏移;
  視窗完全在螢幕內時(client = 影像、offset 0)兩者結果相同(`main/test/ocr-strategy.test.ts` 抽 400 組對照)。區域整塊落在螢幕外 → 當成沒有區域。

### 優先區域、失敗退回整張(`recognizeRegionFirst`)

1. 沒有區域 → 與原本相同(整張跑兩段式,`stage` = 內層路徑)。
2. 有區域 → 以區域為搜尋範圍跑兩段式(快取鍵含範圍,與整張的快取分開)。`cached` / `two-pass` 本來就過了 `checkRegion`;走到 `full` 時以區域本身為邊界再跑 `checkRegion`(貼邊不算,只剩「≥ 2 行像詞綴」)。
   找到 → `stage: 'region'`。
3. 區域內像詞綴的行 < 2 → 以整個畫面再跑一次兩段式 → `stage: 'region-fallback'`,`stages` 前半 `scope: 'region'`、後半 `scope: 'screen'`;
   renderer 在徽章上方提示「框選的區域內沒找到面板,已改找整個畫面」5 秒。
4. main 讀不到 tiers.json(沒有模板索引)→ 無從判斷,直接用區域的結果。

## 比對規則(`ocr-match.ts`)

1. **正規化**:刪所有空白(WinRT 在 CJK 字與字之間插空白:`+ 86 護 甲 值`)、全形 ASCII → 半形、數字旁的 `O/o` → `0`、`l/I/|` → `1`。
2. **skeleton**:數值(與 parser 同一支 `STAT_VALUE_RE`,`+`/`-` 一起吃掉)→ `#`。模板同樣處理,`[+-]?#` 視為一個動態槽
   (`擲彈技能有+#次冷卻使用次數`),寫死的數字(`每100點最大生命`)記成固定槽。395 個模板去掉空字串 = **394 個 skeleton,互不相撞**。
   **寫法變體(`text.zhVariants`,2026-09-30)**:同一 stat 在遊戲裡不只一種寫法(`增加#%精魂保留效用` 實際顯示 `技能增加10%精魂保留效用`,
   相似度 0.83 < 0.85 對不上)。產生器另輸出同 ref 的其他繁中 matcher(269 個模板、317 個寫法:效用 / 效率、`技能` 前綴、`施法` / `施放`、
   反向的 `減少` / `增加` 270 個、不含 `#` 的 18 個如 `無物理傷害`、`擊中時必定造成流血`),全部建進同一個 skeleton 索引(共 706 個 skeleton)。
   一個 skeleton 可能同時是 A 的 `text.zh` 與 B 的反向寫法(`增加#%攻擊速度`),refs 各自記槽位與 `negate`,到數值階段再分。
3. **命中**:skeleton 相等 → 精確;否則 Levenshtein 相似度 ≥ 0.85 且長度差 ≤ 2 → 模糊(只留最高分,徽章前加 `≈`)。
4. **數值**:OCR 數值個數 = 模板槽數時,動態槽逐一比對該 part 的 `ranges`(已取絕對值);個數不齊(OCR 漏字)只靠文字。
   ranges 是「以 part 的 `text.zh` 寫法顯示時的數字」,一律非負。**反向寫法(`negate`,相對 `text.zh`)**:畫面上的 X 在 `text.zh` 語意下是 −X,
   要 −X 落在 range 內才算 → 實務上反向寫法永遠對不上該 part(例:part `減少#%攻擊速度`〔direction decrease,15〕、畫面 `增加15%攻擊速度`
   → −15 ∉ [15, 15] → 不是它,改由一般池的 `增加#%攻擊速度` 接手);OCR 漏數字時只要有一個 `#` 的下限 > 0 也排除。
   反向寫法仍收進索引,是為了讓它在定位階段算「像詞綴」、比對階段不誤判到錯的極性。不含 `#` 的寫法(`無物理傷害` = 特殊值)只靠文字,不驗數值。
5. **折行**:一行自己對不上、接下一行後精確命中 → 合併(前半本身也是合法模板時,只在下一行完全對不上時合併:`增加23%護甲值` + `和閃避`)。
6. **分組**:y 中心距 > 1.9 × 中位行高就切組(樣本:組內 1.54×、組間 ≥ 2.31×),x 中心要對齊(面板文字置中)。
   每組內命中的行必須與某個 entry 的 parts 一一對應;對不上時切成最少的連續段(等距單行詞綴幾何切不開也能拆)。
7. **面板**:連續、x 對齊、相距 ≤ 6 × 行高的 2–3 組,取有 entry 對上最多的一段;不足 2 組 → `no-panel`。對不上的 CJK 行貼到最近的組,灰色顯示原文。
   **中間那個選項沒認出(`bridgeUnmatched`,2026-09-30)**:三組等距時(fullscreen-03 組距約 4.6 行高),中間沒命中會讓第 1、3 組相距約 8 行高 > 6 → 拆成兩個各 1 組的「面板」→ `no-panel`。
   現在把**夾在相鄰兩組之間**、x 中心與兩組都對齊(≤ 4 × 行高)、行高與命中行相近(比值 ≤ 1.3)、離兩組每一行中心距都 > 1.9 × 行高的未命中行
   自成一組 `partial`(顯示原文、沒有候選),面板以包含它後的組數判定(兩側間距仍要 ≤ 6 × 行高)。
   防誤併:只補「之間」(面板上方字大的標題、下方「確認」按鈕、旁邊的小地圖 / 背包字不會進來);一段超過 3 組時先拿掉這種組(3 個選項都認得出時,中間的未命中行只是雜字);
   每個面板至少要有 2 組是真的對上詞綴。
8. **profile**:最近 10 分鐘內查價的 PoE2 物品 `refName`(`App.vue` 解析成功時記下)→ `resolveProfiles`(base_profiles 精確,否則類別)。
   沒有 → 三組候選 entry 可擲出的 profile **取交集**(三個選項屬於同一件物品),交集空才用全部 profile;Tier 取聯集(`T3–T5`),徽章加「?」。

## 驗證

- `node scripts/ocr-fixture.mjs`:對 `poe2/test/desecration/fixtures/ocr/*.{webp,png}` 跑**同一支** `win-ocr.ps1`(經 Node 24 型別剝除直接 import `WinOcr.ts`)
  → `*.ocr.json` 快照(進 repo)。前處理用 sharp(lanczos3 + JPEG q95)模擬 runtime。需要 Windows + `zh-Hant-TW` 語言包。
  Node 會警告 `MODULE_TYPELESS_PACKAGE_JSON`(main 不是 ESM package),無害。
- `electron main/dist/main.js --ocr-selftest <png> [--ocr-selftest-region=x,y,w,h]`:不開視窗、不拿單一實例鎖,走 runtime 的 `smartRecognize` + `WinOcr`,
  依序跑 ① 快取空(two-pass)② 同一張(cached)③ 強制整張 ×3 對照 ④ 清快取再跑(熱的 two-pass),印每段範圍 / 倍率 / 耗時 / 命中數與採用那段的行(client 座標)
  (先 `npm run build --workspace main`、清 `ELECTRON_RUN_AS_NODE`;nativeImage 不吃 webp,先用 sharp 轉 png)。擷取不在這裡測。
- `poe2/test/desecration/ocr-locate.test.ts`:定位(fullscreen-02 快照 ÷ 3 當 ×1 輸入):裁切框包住 4 行詞綴、不含背包(x > 1300)、外擴下限;框內的行跑 `matchReveal` 與整張結果相同;`checkRegion` ok / 貼邊 / 太少;只認出 1 行仍蓋得住面板。
- `main/test/ocr-strategy.test.ts`:假 recognize 驗三條路的切換(two-pass → cached、面板移位 → 清快取改 two-pass、×1 認不出 → full 並寫快取、第 2 段貼邊 → full、沒有模板索引 → full)、倍率、快取鍵、`locate-data` 從 `main/dist` 找得到 tiers.json。
- `poe2/test/desecration/ocr-match.test.ts`:① 真實截圖快照三組全中(Rogue Armour → 三組全 T4);①b fullscreen-02;
  ①c fullscreen-03(`減少49%你身上的中毒持續時間` → ReducedPoisonDuration3 一般池 46–50 T3 /
  `技能增加10%精魂保留效用`(變體)→ AbyssModBodyArmourAmanamuSuffixSpiritReservationEfficiency 阿姆那姆 6–12 T1 /
  `+11點力量與敏捷` → AbyssModArmourJewelleryUlamanSuffixStrengthAndDexterity 烏拉曼 9–15 T1;profile 交集、無「精確底材」;
  另以去掉 zhVariants 的資料驗證中間那行自成 partial 組、仍是 3 組);
  ② 394 個模板 round-trip + 317 個寫法變體 round-trip(反向寫法驗數值語意)+ `減少#%攻擊速度` vs `增加15%攻擊速度`;③ 模糊 200 次 + 200 對不誤命中;
  ④ 分組邊界、2 組、1 組 no-panel、折行、等距單行、未辨識行、中間選項沒認出(partial 組)、x 不對齊 / 行高不同 / 標題 / 確認鈕不被併入、3 組都認得出時雜字不擠掉選項。
- `poe2/test/desecration/ocr-locate.test.ts` 另有:變體寫法算「像詞綴」(沒有變體的索引 394 個 skeleton 認不出 `技能增加…`)、fullscreen-03 三行全命中。
- `renderer/test/ocr-reveal.test.ts`:徽章座標換算、文字、profile 有效期。
- WP-S2:`renderer/test/region-geom.test.ts`(新框、最小尺寸、移動、8 把手、夾限、方向鍵 / Shift / Ctrl、比例換算、上次偵測外擴)、
  `main/test/ocr-strategy.test.ts`(`regionSearchRect` 400 組對照舊版 / 出界偏移、`recognizeRegionFirst` 區域找到 / 退回整張 / 只框到 1 行 / 沒區域 / 沒索引、`RegionCacheGuard`)、
  `main/test/shortcut-actions.test.ts`(`ocr-region` 註冊條件:預設空不註冊、PoE1 / window 不註冊、撞鍵先到先得)。
  無頭 Chrome + 假 host 用 CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent`(只作用於無頭頁面,不是作業系統層輸入)拖曳、調把手、方向鍵、Enter / Esc,驗證寫入值與呼叫序列(見 `docs/phase5-summary.md` S6)。
- 無頭 Chrome + 假 `window.host`:注入快照事件,徽章位置 = 各組右緣 + 14 px / 垂直中心(誤差 0 px)、再按清除、Esc、錯誤提示(Alt 隱藏已於 2026-10-01 移除)。

### 本機實測(2026-09-29,`--ocr-selftest`)

| 輸入 | 放大 | 前處理 | OCR 冷 / 熱 | 結果 |
|---|---|---|---|---|
| 樣本截圖 987×1005 | 3× | 88 ms | 618 / 501 ms | 7 行詞綴全對 |
| 樣本貼在 1920×1080 假 client | 3× | 143 ms | 610 / 558 ms | 7 行全對 |
| 樣本貼在 2560×1440 假 client | 3× | 219 ms | 849 / 576 ms | 7 行全對 |

PowerShell 行程第一次啟動約 0.3–1.8 秒(之後常駐)。

### 兩段式實測(2026-09-30,`--ocr-selftest`,真實全螢幕 `well-of-souls-fullscreen-02` 2000×1125)

| 做法 | 範圍 | 耗時(含前處理 / 傳輸) | 結果 |
|---|---|---|---|
| 整張 ×1(使用者先前實測) | 2000×1125 | 534 ms | 4 行全對 |
| 整張 ×1.5 / ×2(使用者先前實測) | 2000×1125 | — | 錯字(「閃避」→「因」、「增」→「増」)→ 不用 |
| **full** 整張 ×3(舊做法) | 2000×1125 | 1080 ms(OCR 838);使用者先前實測 904–1412 ms | 4 行全對 + 11 行雜訊 |
| **two-pass**(行程剛啟動) | ×1 整張 → ×3 (405,489 499×302) | 515 ms = 425 + 89 | 4 行全對,框內沒有雜訊 |
| **two-pass**(熱) | 同上 | 383 ms = 272 + 111 | 同上 |
| **cached** | ×3 (405,489 499×302) | 113 ms(OCR 96) | 同上 |

四條路的 4 行詞綴逐字相同;renderer 比對結果:`增加71%護甲值和閃避`(LocalIncreasedArmourAndEvasion5,無 profile T3–T4)|
`+60護甲值` + `+59閃避值`(LocalBaseArmourAndEvasionRating3,T2–T6)| `+16最大生命`(IncreasedLife1,T9–T13)。

## 限制

- **全螢幕(獨占)模式**:`desktopCapturer` 可能拿到黑畫面 → 請用無邊框視窗;若普遍,備案是原生 `PrintWindow`(未做)。
- **只驗過三張截圖**(繁中客戶端;面板裁切圖 987×1005 胸甲、全螢幕 2000×1125 與 2000×1121;都無折行);
  寫法變體只收 stats.ndjson 有的 matcher,遊戲若還有別的寫法仍會對不上(面板不會因此拆開,該組顯示原文);兩段式的快取鍵只含 client 大小與範圍,遊戲 UI 縮放改了但 client 大小不變時,第一次按會走 cached → 不通過 → two-pass(多花一次快取區 OCR 約 0.1 秒);其他解析度 / UI 縮放 / 字型、真的折行、`減少…`、`附加#至#` 模板都只有合成測試。
- 假 client 測試的字高與樣本相同;真實 1080p 的字可能更小,3× 放大後是否仍逐字正確待使用者親測。
- 語言包:設定 → 時間與語言 → 語言與地區 → 中文(台灣)→ 語言選項 → 光學字元辨識。缺少時提示並在設定 › 熱鍵與視窗顯示狀態。
- 英文客戶端不支援(OCR 固定 `zh-Hant-TW`、比對用繁中模板)。
- profile 不明時只能給範圍(標「?」);查價過同一件物品(10 分鐘內)才是精確底材。
- Esc 只在 overlay 有焦點時收得到(遊戲在前景時 Esc 屬於遊戲);其餘靠再按熱鍵 / 15 秒。
- 框選(WP-S2)只在 overlay 模式;window 模式與瀏覽器預覽只能用「進階」的數字欄位。區域以 client 比例存,遊戲換解析度 / UI 縮放後面板位置可能不同 → 區域內找不到時會退回整張並提示,重新框選即可。
- 框選熱鍵與 OCR 熱鍵一樣只在遊戲前景時註冊;overlay 取得焦點後熱鍵暫停(要用設定頁按鈕或先回遊戲)。

## 隱私

OCR 使用 Windows 內建辨識,在本機執行;截圖只在記憶體裡傳給本機 PowerShell 行程,不存檔、不上傳。

## 待使用者親測

0. **2026-10-01 自動持續辨識**:PoE2 開井 → 不按任何鍵,約 1–3 秒內出現三枚徽章;關掉面板徽章消失;開著查價面板時仍會出現;
   `Ctrl + Shift + R` 暫停(徽章消失)/ 繼續;與符文塑形同時開著時兩邊都會更新;平常遊玩時的 CPU(沒面板時約每 3 秒整張 ×1 一次);
   背包物品浮窗不會誤出徽章;框了區域但面板不在區域內時,設定頁顯示「改找整個畫面」且仍出徽章。
1. PoE2 開井 → 三枚徽章位置與內容;視窗化 / 無邊框 / 全螢幕三種模式各一次。
2. 先查價那件物品(10 分鐘內)再按,徽章沒有「?」。
3. PoE1 下熱鍵無反應;再按一次熱鍵清除;移動遊戲視窗清除。
4. WP-S2:設定 › 熱鍵與視窗 ›「在遊戲上框選」→ 設定視窗隱藏、框選層出現且可拖曳(overlay 真的取得焦點)→ 框住揭露面板按「確認」→ 設定視窗回來停在熱鍵分頁、顯示「已設定」;
   用框選熱鍵(`hotkeyOcrRegion`)開的框選按 Enter → 焦點回遊戲、約 0.15 秒後自動出徽章;關掉設定後按 `Ctrl + Shift + R` 走區域路徑(log `region:` + `[region]cached`,應約 0.1 秒)。Esc / 點回遊戲取消且設定不變。
5. WP-S2:把區域框在面板以外的地方 → 仍出徽章並提示「框選的區域內沒找到面板,已改找整個畫面」;視窗化且遊戲視窗部分拖出螢幕時,區域仍對得上。
