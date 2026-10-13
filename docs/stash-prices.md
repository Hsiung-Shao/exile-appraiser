# PoE1 倉庫價格疊層(Stash-Ninja 式)

2026-10-14 使用者需求:PoE1 打開倉庫「碎片」頁時,overlay 在每格疊 poe.ninja 價格。參考 Exile-UI 的 Stash-Ninja
(https://github.com/Lailloken/Exile-UI/wiki/Stash‐Ninja,MIT)。

## 範圍
- 碎片頁三個子頁:**一般**(60 格)、**聖甲蟲**(115 格)、**不滅之火**(8 格)。「異能」子頁沒有版面 → 不畫。
- 只在 PoE1 + overlay 模式;國際服才有價格(台服沒有 poe.ninja → 只顯示名稱,提示一次)。
- 第二段(未做):讀每格數量 → 堆疊總價、整頁總價。

## 為什麼物品身分不靠 OCR
格子裡只有圖示 + 數量,名稱要滑鼠移上去才看得到。物品身分改用**固定版面**依位置對應:
`data/poe1/stash/layouts.json` 由 `scripts/sync-stash-layouts.mjs --from <Exile-UI clone>` 從 Exile-UI
`data/global/[stash-ninja] tabs.json` 轉出(fragments / scarabs / betrayal 三組)。

- 座標:1440 基準;x 或 y 為 0 = 接續前一格。換算 `core/src/stash/layout.ts` `cellRects`,與 Exile-UI `stash-ninja.ahk` 逐格相同
  (x 先 `Format("{:.10f}")` 取 10 位小數再乘、y 直接 Floor;box = h/32、h/24、h/20;gap = h//160、Round(h/72)、Round(h/80))。
- 名稱:聖甲蟲 `of xxx` 接上一格前綴,以**英文全名**對 `data/poe1/en/items.ndjson` 的 refName;表的第 4 欄 ID(= tradeTag)有過期項
  (`abyss-scarab-of-emptiness` → 實為 Abyss Scarab of Descending「落降深淵」),不拿來對接。
- 驗證:使用者錄影(client 2012×1432 / 1976×1432,倉庫不在資料夾)三子頁逐格對齊;13 格滑鼠說明框名稱與版面對照一致
  (`core/test/stash/annotations.json`);預測框比實際底框約偏右下 2–5 px(Exile-UI 原式,不另校正)。

## OCR 只做偵測
`main/src/ocr/stash-scan.ts` `StashScan`(預設每 1 秒;與褻瀆 / 符文共用 WinOcr、擷取):
1. 擷取遊戲 client,取**子頁按鈕列**(`stripRect`:x 0 – h×37/60、y 140–300 / 1440)的灰階縮圖;與上次 OCR 時相同 → 不 OCR。
2. OCR ×3 → `findSubtabButtons`:去空白後整行等於按鈕文字、水平位置對得上的才算;**4 顆至少 3 顆**(使用者錄影裡目前子頁的「一般」OCR 沒讀到)。
   按鈕文字取自 GGPK clientstrings `FragmentStashSubTab{Other,Scarab,Betrayal,Eldritch}`:一般 / 聖甲蟲 / 不滅之火 / 異能、General / Scarab / Allflame / Eldritch。
3. 由文字垂直中心推整體偏移,吸附到 0 或資料夾偏移 47/1440·h(誤差 12/1440·h 內),都不近 = 沒找到。
4. 目前子頁:每顆按鈕的灰階 p99,最亮者比第二亮至少 8(錄影:目前子頁 158–162、其他 141–144);第 4 顆(異能)最亮或差距不足 → 不畫。
5. 沒找到按鈕:游標在倉庫面板內(遊戲說明框常蓋住按鈕列)→ 維持;否則連續 2 次才收起。

## 游標與說明框
遊戲說明框畫在格子附近,overlay 在遊戲上層會蓋住它。`main/src/stash-cursor.ts`:只在「疊層顯示中 + 遊戲前景」時每 80 ms 讀
`screen.getCursorScreenPoint()`(換成實體像素),換格才送 `stash-cursor`;renderer 只留那一格、放大並帶全名。不裝鍵盤滑鼠掛鉤、不送任何輸入。

## 呈現(照符文塑形徽章)
`renderer/src/web/overlay/StashPrices.vue` + `stash-view.ts`:徽章貼在格子下緣、格寬內置中;外觀沿用 `.rs-badge`、`config.ocrBadgeStyle`
的 `--badge-*` 變數與三段價格色(`badgeStyleVars(…, 'stash')`);門檻 `stashThresholds`(混沌石,預設 5 / 50);≥ 1 神聖石改神聖石。
名稱那一行 = 辨識檢視(`stashShowNames`,預設開)。設定在 設定 › 倉庫與聊天 › 倉庫價格(只在 PoE1 顯示)。

## 價格
`usePoeninja().priceOf(refName)`;poe.ninja 類別 Scarab / Fragment 原本就有,2026-10-14 補 `AllflameEmber`(網頁 slug `allflame-embers`;
錄製檔 `core/test/recordings/ninja/exchange_AllflameEmber.json`)。層顯示時 `queuePricesFetch()`。

## 測試
`core/test/stash-layout.test.ts`(S1–S4c)、`core/test/stash-detect.test.ts`(S5–S7,真實 OCR 快照 `core/test/stash/fixtures/ocr/`,
`node scripts/ocr-fixture.mjs --set stash` 產生)、`main/test/stash-scan.test.ts`(S8–S12)、`renderer/test/stash-prices.test.ts`(S13–S17)、
`core/test/ninja.test.ts` S15。

## 待使用者實機確認
真實 overlay 位置(含資料夾內、其他解析度 / 非 16:9)、子頁切換即時性、說明框遮住按鈕時不閃、滑鼠停格只留該格、英文客戶端按鈕文字。
