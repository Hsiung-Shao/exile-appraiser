# PoE1 倉庫價格疊層(Stash-Ninja 式)

2026-10-14 使用者需求:PoE1 打開倉庫「碎片」頁時,overlay 在每格疊 poe.ninja 價格。參考 Exile-UI 的 Stash-Ninja
(https://github.com/Lailloken/Exile-UI/wiki/Stash‐Ninja,MIT)。

## 範圍
- 碎片頁兩個子頁:**一般**(60 格)、**聖甲蟲**(115 格)。「不滅之火」(2026-10-14 使用者決定刪除)與「異能」子頁 → 不畫。
- 只在 PoE1 + overlay 模式;國際服才有價格(台服沒有 poe.ninja → 只顯示名稱,提示一次)。
- 第二段(2026-10-15,倉庫價值):讀每格堆疊數量 → 徽章顯示小計、整頁總價,見下方「倉庫價值」。

## 為什麼物品身分不靠 OCR
格子裡只有圖示 + 數量,名稱要滑鼠移上去才看得到。物品身分改用**固定版面**依位置對應:
`data/poe1/stash/layouts.json` 由 `scripts/sync-stash-layouts.mjs --from <Exile-UI clone>` 從 Exile-UI
`data/global/[stash-ninja] tabs.json` 轉出(fragments / scarabs 兩組;betrayal = 不滅之火不取)。

- 座標:1440 基準;x 或 y 為 0 = 接續前一格。換算 `core/src/stash/layout.ts` `cellRects`,與 Exile-UI `stash-ninja.ahk` 逐格相同
  (x 先 `Format("{:.10f}")` 取 10 位小數再乘、y 直接 Floor;box = h/32、h/24、h/20;gap = h//160、Round(h/72)、Round(h/80))。
- 名稱:聖甲蟲 `of xxx` 接上一格前綴,以**英文全名**對 `data/poe1/en/items.ndjson` 的 refName;表的第 4 欄 ID(= tradeTag)有過期項
  (`abyss-scarab-of-emptiness` → 實為 Abyss Scarab of Descending「落降深淵」),不拿來對接。
- 驗證:使用者錄影(client 2012×1432 / 1976×1432,倉庫不在資料夾)三子頁逐格對齊;13 格滑鼠說明框名稱與版面對照一致
  (`core/test/stash/annotations.json`);預測框比實際底框約偏右下 2–5 px(Exile-UI 原式,不另校正)。

## OCR 只做偵測
`main/src/ocr/stash-scan.ts` `StashScan`(預設每 1 秒;與褻瀆 / 符文共用 WinOcr、擷取):
1. 擷取遊戲 client,取**子頁按鈕列**(`stripRect`:x 0 – h×37/60、y 170–268 / 1440)的灰階縮圖;與上次**找到按鈕**時相同 → 不 OCR。
   範圍:按鈕文字中心 201、資料夾內 +47 = 248(文字下緣約 260 仍在條內);下緣不超過聖甲蟲第一列徽章頂端(約 269),
   免得換格 / 價格載入改變縮圖而重 OCR(2026-10-14 code review I1,原本 140–300)。**上緣 170 = 倉庫頁籤字下緣**:
   上緣切到頁籤字的一半時 Windows OCR 排版錯亂、按鈕只讀到 0–1 顆(使用者 2560×1440 實機截圖重現「徽章沒出現」,
   fixture `strip-general-1440*.png`;140 / 150 起算都失敗,170 起算在 1432 / 1440 × 是否在資料夾四種情況都讀到 ≥ 3 顆)。
   認到 ≥ 1 顆按鈕但判定失敗時記一行 `[stash] 沒找到子頁按鈕…`(最多每 30 秒一次)。
   **使用者可自訂 OCR 區域**(2026-10-14 使用者要求,同褻瀆 / 符文的框選):設定 `stashRegion`(client 比例,null = 上述預設),
   設定 › 自動辨識 › 倉庫價格「在遊戲上框選」/「還原預設」,框選層目標 `stash`(沒框過時參考框顯示預設區域 `defaultStripRegion`)。
   **自訂區域有上限**(code review R1):換成 client 像素後與 `stripZone`(按鈕可能出現的範圍:x 0 – h×37/60、
   y 120/1440·h – 268/1440·h;不加資料夾偏移:資料夾內按鈕文字下緣約 260 仍在內,再往下是聖甲蟲第一列自己的徽章,
   實機截圖 122–268 繁中 / 資料夾 / 英文都認到 ≥ 3 顆)取交集;交集為空 → 預設 `stripRect`;被縮小 / 完全在範圍外時記一行
   `[stash] 自訂 OCR 區域超出按鈕列範圍,已縮到 …`(同一個區域值只記一次;還原預設後再框回同值會再記)。最後減擷取偏移並夾在影像內。
   自訂區域**不會**自動跟著資料夾下移(預設掃描條會):倉庫頁放進資料夾後要重新框選或還原預設,設定頁與框選層字串有寫(R2)。
   區域只決定 OCR 讀哪一塊;按鈕位置判定、資料夾偏移、每格位置仍照固定版面。疊層顯示中沒找到按鈕時作廢基準 → 下一 tick 一定重 OCR(B1);沒顯示時照常記基準,畫面靜止不 OCR(N1)。
2. OCR ×3 → `findSubtabButtons`:去空白後整行等於按鈕文字(**不分大小寫**:英文介面按鈕是小型大寫字,OCR 讀成 GENERAL / SCARAB…,實機截圖 fixture `strip-general-1440-en.png`)、水平位置對得上的才算;**4 顆至少 3 顆**(使用者錄影裡目前子頁的「一般」OCR 沒讀到)。
   按鈕文字取自 GGPK clientstrings `FragmentStashSubTab{Other,Scarab,Betrayal,Eldritch}`:一般 / 聖甲蟲 / 不滅之火 / 異能、General / Scarab / Allflame / Eldritch。
3. 由文字垂直中心推整體偏移,吸附到 0 或資料夾偏移 47/1440·h(誤差 12/1440·h 內),都不近 = 沒找到。
4. 目前子頁:每顆按鈕的灰階 p99,最亮者比第二亮至少 8(錄影:目前子頁 158–162、其他 141–144);第 4 顆(異能)最亮或差距不足 → 不畫。
5. 沒找到按鈕:游標停在已顯示子頁的**格子上**(`StashCursor.onCell()`;遊戲說明框只在游標停在物品格上才出現,常蓋住按鈕列)→ 維持,
   但連續最多 `STASH_HOLD_LIMIT` = 5 次,之後照常累計(游標停在格上按 Esc 關倉庫時不卡住);找到按鈕時歸零。否則連續 2 次才收起。
   不用整個倉庫面板(`inPanel()`,含頁籤列)判定:點別的倉庫頁籤時游標在面板內,碎片頁徽章會錯畫在別頁上(code review B2)。
   副作用:說明框蓋住按鈕列且游標停在同一格超過約 5 次掃描,疊層會先收起,游標移開、按鈕列露出後再出現。
6. host-config 還沒送到 main 前不掃描(`enabled: hostCfg != null && …`;否則 PoE2 使用者啟動空窗也會擷取 + OCR)。

## 游標與說明框
遊戲說明框畫在格子附近,overlay 在遊戲上層會蓋住它。`main/src/stash-cursor.ts`:只在「疊層顯示中 + 遊戲前景」時每 80 ms 讀
`screen.getCursorScreenPoint()`(換成實體像素),換格才送 `stash-cursor`;renderer 只留那一格、放大並帶全名。不裝鍵盤滑鼠掛鉤、不送任何輸入。

## 呈現(照符文塑形徽章)
`renderer/src/web/overlay/StashPrices.vue` + `stash-view.ts`:徽章貼在格子下緣、格寬內置中;外觀沿用 `.rs-badge`、`config.ocrBadgeStyle`
的 `--badge-*` 變數與三段價格色(`badgeStyleVars(…, 'stash')`);門檻 `stashThresholds`(混沌石,預設 5 / 50);≥ 1 神聖石改神聖石。
價格單位:混沌石 **C**、神聖石 **D**(2026-10-14 使用者指定,兩語相同)。名稱那一行 = 辨識檢視(`stashShowNames`,預設開)。
設定在 **設定 › 自動辨識**(2026-10-14 使用者回報放在「倉庫與聊天」找不到,搬過來;自動辨識頁 PoE1 起也顯示,同日移到左選單「工具」組第一個):PoE1 時只有共用卡片、
「倉庫價格」卡片與「徽章外觀」(字體 / 大小 / 外框與 PoE2 共用 `ocrBadgeStyle`;價格門檻改綁 `stashThresholds`,單位 C,預覽顯示 C / D);褻瀆 / 符文卡片只在 PoE2。
倉庫價格卡片與褻瀆 / 符文**同一個元件** `OcrScanSection.vue kind="stash"`(2026-10-14 統一樣板;差異在 `settings/scan-card-specs.ts` `SCAN_SPECS.stash`:
統計 = `Host.stashStats` 每 2 秒輪詢、區域清除鈕 =「還原預設」、沒框過顯示預設按鈕列;台服警告在 `#top`、顯示物品名稱 `stashShowNames` 在 `#extra`;
`stash-*` data-setting 錨點不變)。舊的 `StashPricesSection.vue` 已刪除。懸浮選單的開關列(PoE1)也可直接開關倉庫價格與格子名稱。

## 熱鍵(2026-10-14 使用者補充)
`hotkeyStashToggle`(暫停 / 繼續倉庫價格)與 `hotkeyStashRegion`(框選倉庫 OCR 區域),預設空,在「熱鍵」總表的「自動辨識」組(PoE1)編輯。
路徑同符文塑形:Config → host-config → `shortcut-actions.ts`(`stash-toggle` / `stash-region`,只在 overlay + PoE1 註冊;暫停熱鍵另要 `stashPricesEnabled`;
遊戲保留鍵不註冊)→ `Shortcuts.ts` → `StashScan.toggleUserPause()`(暫停 = 立刻送 `hide` 收掉疊層、block `user-paused` 不排計時器;繼續 = 立刻 `poke()`)
+ 右下角通知「倉庫價格:已暫停 / 已啟動」(`scanToastMessage` kind `stash`);框選熱鍵送 `ocr-region-pick { target: 'stash' }`。兩者都不送任何按鍵。

## 只支援國際服(2026-10-15 使用者裁定)
台服(`realm` tw)時 main `StashScan` 完全不掃描(不讀按鈕、不讀數量):`stashBlock` 回 `not-intl`(收掉疊層、不排計時器);
host-config 帶 `realm`(`HOST_CONFIG_IMMEDIATE_KEYS`、main `scanConfigKey` 都有 → 切換時立刻 poke)。設定 › 自動辨識 › 倉庫價格狀態「只支援國際服」(`ppz.stash.status_not_intl`),
懸浮選單倉庫列在台服停用並顯示同樣說明(`ppz.menu.stash_tw`)。測試 `main/test/stash-scan.test.ts` S21、`renderer/test/stash-value.test.ts` V16。

## 價格
`usePoeninja().priceOf(refName)`;poe.ninja 類別 Scarab / Fragment 原本就有(曾為不滅之火補 `AllflameEmber`,刪除不滅之火時一併撤回)。層顯示時 `queuePricesFetch()`。

## 倉庫價值(2026-10-15,讀堆疊數量)
設計稿 `StashValue`(https://claude.ai/artifact/8G1wDzZxwYDtEMv3KU7U81)。設定 › 自動辨識 › 倉庫價格「讀取堆疊數量並計算總價」`stashReadQuantity`(預設開;
在 `HOST_CONFIG_IMMEDIATE_KEYS` 與 main `scanConfigKey`)。

- **判讀(core `src/stash/quantity.ts`,純函式)**:不用 WinOCR(研究:拼圖法 57–77%)。裁切 x = 格 x − 3、寬 = 格寬 × 0.85,y = 格 y、高 = 格高 × 0.65 →
  依 client 高把裁切區面積平均縮放到模板基準(1125)→ 白色程度 `max(0, min(R,G,B) − (max − min) − 100)` → 11×15 數字模板 NCC(積分影像算視窗平均 / 變異、
  只算非 0 像素、模板交錯排列)≥ 0.5 候選、NMS → 最強者為錨同列 ±1 px、間距 7–12 px 串接最多 3 位 → 門檻:每位 ≥ 0.6、與次佳差 ≥ 0.05、
  **低分(最低位 < 0.70)時次佳差須 ≥ 0.15**(使用者 2026-10-15 選「放寬一點」)、開頭非 0、**單獨的「0」→ null**(堆疊數不可能是 0)、
  漏讀檢查(① 末位右側純白像素 ≥ 4;② 首位前 / 末位後一個字距的筆畫帶白色程度 ≥ 串接數字最少者 × 1.3 —— 縮放 / 模糊後 ① 抓不到「87 只讀到 8」;
  ① 的檢查區超出裁切區(三位數頂到右緣)時改看往右多 8 基準像素的延伸裁切區,三位數另在延伸區做 ② 的右側檢查 → 4 位數堆疊回不確定;延伸區超出影像 = 不確定)。
  沒有候選 = 空格;**裁切區超出影像 = null(`outside`)**。寧缺勿錯:任何一項不過 → null(徽章只顯示單價 +「?」、不計入總價)。
  回傳數字帶 `band`(數字列 ± 2、左緣到末位右側再一位)給掃描判斷「徽章有沒有蓋到數字」。
- **模板** `data/poe1/stash/digit-templates.json`:`node scripts/build-stash-digit-templates.mjs`(`--check` 只比對)由 `core/test/stash/fixtures/qty/`
  (使用者 2000×1125 截圖裁左側 700 px + 人工判讀 `truth.json`)產生,數字連通元件數 = 真值位數的格才採樣;記來源截圖 sha256、逐位元組可重現;
  MANIFEST 前綴 `data/poe1/stash/digit-templates.json`(不手改)。數字 9 只有 3 個樣本。補截圖:放進 fixture、補 truth、重跑腳本。
  第二批(2026-10-15,`truth.more`):`scarabs2-1125.png`(使用者全螢幕 webp 有損截圖裁左側 700 px,無徽章)**只當驗證 fixture**(`train: false`):
  加入訓練後 V1 不確定 7 → 9、V5 6 → 8、本張 4 → 5,且 V4「87 截掉 7 的右半」變成讀出 8(錯讀)→ 不採用;這張的 115 格數量與第一批逐格相同(沒有新的數字樣本)。
  要真的改善需要**原解析度(2560×1440)無損 PNG**整頁截圖。
- **準確度**(175 格 + 合成空格 14;2026-10-15 低分門檻 < 0.70 且次佳差 < 0.15 後):全模板 正確 168、錯 0、不確定 7(改前 169 / 0 / 6);
  留一驗證 正確 166、錯 0、不確定 9(改前 166 / 1(19 → 10 @0.693/0.123)/ 8);放大到 1440 高 正確 169、錯 0、不確定 6(改前 170 / 0 / 5);
  空格 14 / 14;高斯 σ 0.6 錯 0、不確定 8;σ 1.0 錯 1(11 → 14 @0.718/0.226,不標高信心;較嚴的 < 0.72 / 0.23 擋得到但不確定約翻倍,使用者選放寬)、不確定 14。
  第二批驗證 fixture:正確 111 / 115、錯 0、不確定 4(31 低分;右側單獨欄 7 / 87 —— 灰白聖甲蟲圖示緊貼 / 疊在數字上,漏讀檢查擋下;20 低分)。
  耗時:聖甲蟲 115 格(1440)Node 約 30–40 ms;Electron 暖機後 13 ms(一般)/ 28 ms(聖甲蟲)(測試門檻 < 200 ms 只防退化)。
  `npx electron main/dist/main.js --stash-selftest <png> [--out <png>] [--stash-subtab=…]` 印每格讀數 / 準確度(同資料夾有 `truth.json`)/ 耗時並輸出標註圖。
- **掃描(main `StashScan`)**:判定子頁後在同一張擷取讀;第一次顯示讀全部格,之後每格以簽章(數字區 4 條直帶白色程度)比對,變了才重讀那一格;
  游標停在格上(遊戲說明框 / 游標上的物品)不讀。事件 `stash-scan-result` 的 `show` 帶 `quantities`(0 = 空格、null = 讀不到)與 `qtyMs`;數量變了再送一次同子頁的 `show`。
  計數 `qtyRuns / qtyCells / qtyPeeks / qtyCursorSkips / maskWaits` 只 `++`;`stash-stats` 多 `lastQtyMs`、`qtyCells`。
- **我們的徽章蓋住數字**:擷取截得到 overlay。疊層走 `useScanLayer`(遮罩 source `stash`,每個事件 ack,main `drawPending` 等 ack 才擷取);
  遮罩蓋到**數字帶**(上次讀到的數字列;沒讀過 / 空格 = 整個裁切區)的格不讀、沿用舊值(裁切區內其他地方的遮罩:像素不算、讀的時候一併遮掉);
  蓋到的格露出部分變了(同一組遮罩比上次被遮時的簽章;剛被蓋住 / 遮罩換位置時比上次乾淨讀數的字形 NCC < 0.97,徽章陰影變暗不算)→ 送 `peek`
  → renderer 暫時收起格子徽章 → ack 後**延後一個遮罩保留期**(`MASK_LINGER_MS` + 50 ms)才重看(`maskReported`;其他遮罩報告不插 tick)→ 乾淨畫面重讀
  → 送不帶 peek 的 `show`(等太久才放棄:至少 3 tick 且超過 `STASH_PEEK_TIMEOUT_MS` = 1.8 秒)。切換子頁時畫面上還有舊子頁的徽章 → 同樣先 peek。
  **游標換格**(`stash-cursor` 沒有 ack,renderer 只畫停的那格 ↔ 畫回全部):main `cursorMoved()` → **固定等滿 `MASK_LINGER_MS`(300 ms)** 才讀數量
  (code review 第 2 輪:換格前就在路上的舊報告分不出來,不因收到報告提早解除;改用 cursor 序號要動三個掃描層共用的遮罩回報器,不划算)。
  **防 peek 循環**(第 2 輪):peek 重讀出的值與舊值相同 = 字形比對誤判(例如陰影)→ 該格停止字形比對,剛被蓋住時直接以被蓋住的狀態為新基準;
  連續 2 次 peek 重讀沒讀到新數量也停止;乾淨讀到不同的值才恢復(子頁變更 = 狀態重建)。
  像素區右界含延伸裁切(`extW` × k):否則最右欄的三位數延伸區出界 → 永遠不確定(selftest 同改)。
  顯示名稱時(兩行徽章約 30 px)徽章實際蓋到數字(數字在格子上 55–65%),一般 / 聖甲蟲每格都算蓋住 → 數量只能靠露出部分的變化觸發 peek;
  一行徽章(不顯示名稱)一般頁 1125 / 1440 高 0 / 60 格算蓋住。
- **呈現**:徽章 = 小計(三段色 / C・D 依小計);空格不畫(停格時畫);停格明細卡(單價 / 數量 / 小計);倉庫面板**底部**「本頁價值」卡(總計 C、≈ D、已讀 / 未讀格數;
  `stashValueCardPos`:格子區下方的面板框飾之下、搜尋列上方的空白帶,1440 基準 y 1066–1146、x 24–864,跟著資料夾偏移,兩行、高寬受限;
  2026-10-15 使用者實機回報原本放在面板右緣外會蓋住倉庫頁籤清單);共用狀態 `renderer/src/web/overlay/stash-value.ts` → 懸浮選單「倉庫本頁價值」列。台服沒有價格 → 不顯示價值卡。
  **未計入總價的標記**(2026-10-15 使用者要求):`stash-view.ts` 徽章 `mark` = `qty-unknown`(數量讀不到)/ `no-price`(有數量但沒價格;讀取中不算)→
  徽章左側警示色圓角標記「?」/「無價」(N/A)+ 虛線框(`.st-mark` / `.st-flagged`,顏色 `var(--badge-warn, var(--warn))`),停格明細卡寫「數量未讀取 / 沒有價格,未計入總價」;
  本頁價值卡加「數量以畫面辨識,可能讀錯…」說明與「未計入 N 格(數量未讀 a、無價 b)」(`stashPageValue().excluded` = unknown + noPrice)。
- **待使用者實機確認**:2560×1440 一般 / 聖甲蟲的數量與總價、移動物品後更新(含 peek 時徽章短暫收起的觀感)、停格明細;準確度不足時請補原解析度 PNG 再調模板。

## 測試
`core/test/stash-quantity.test.ts`(V1–V6、V14 code review:4 位數 / 單獨 0 / 超出影像 / 已知錯讀)、`main/test/stash-quantity-scan.test.ts`(V7 / V8 / V13 / peek;code review:游標換格競態、peek 時序與放棄、陰影不算變化、數字帶)、`renderer/test/stash-value.test.ts`(V9 / V10 / V13)、
`renderer/test-vue/stash-prices-mount.test.ts`(V11)、`renderer/test-vue/float-menu-mount.test.ts`(V12);
`core/test/stash-layout.test.ts`(S1–S4c)、`core/test/stash-detect.test.ts`(S5–S7,真實 OCR 快照 `core/test/stash/fixtures/ocr/`,
`node scripts/ocr-fixture.mjs --set stash` 產生)、`main/test/stash-scan.test.ts`(S8–S12c、S9e–S9g、S19 暫停熱鍵)、`main/test/shortcut-actions.test.ts`(倉庫價格熱鍵)、`renderer/test/stash-prices.test.ts`(S13–S17,含 S14d 單位 C / D;S20 統一樣板)、`renderer/test/settings-ia.test.ts`(自動辨識頁兩代顯示)。

## 實機確認
- **已確認(2026-10-14,使用者 2560×1440、倉庫不在資料夾)**:繁中介面與英文介面的一般 / 聖甲蟲子頁都出現徽章與價格;滑鼠停格只留該格;倉庫頁在資料夾內;自訂 OCR 區域框選。
  過程中修了兩個只在實機出現的問題:掃描條切到倉庫頁籤字(上緣改 170)、英文小型大寫字(比對改不分大小寫)。
- **待確認**:其他解析度 / 非 16:9(使用者可用自訂 OCR 區域自行校正)。說明框遮住按鈕:使用者判斷以目前辨識速度幾乎不會發生,不另處理(保留維持上限 5 次的保護)。
