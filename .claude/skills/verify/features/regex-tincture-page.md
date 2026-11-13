# 正則 › 萃取物詞綴頁與物品基底的萃取物分類

## Sub-features

- 頁面選單有「萃取物詞綴」(`tincture_mods`),排在「藥劑詞綴」後面;清單 17 列、分類 前綴 / 後綴
- 勾選詞綴 → 輸出框出現加引號的搜尋字串
- 「物品基底」頁的分類選單有「萃取物」,選了只列 10 個萃取物基底;滑過列的提示框會列出基底固有詞綴
- 這兩頁都是資料驅動(`data/regex/regex_poe1.json`,由 `scripts/gen-regex-data.mjs` 產生);清單沒出現先看資料檔有沒有重產

## How to get to it (user POV)

設定(右上角齒輪)→ 左選單「正則」→ 頁面下拉選單選「萃取物詞綴」;或選「物品基底」再把清單右上的分類選成「萃取物」。

## Driving it with 內建瀏覽器

1. `preview_start { name: "renderer" }`;瀏覽器面板沒顯示時 viewport 是 0×0,先 `resize_window { width: 1280, height: 800 }` 再 `navigate` 重載。
2. 點 `button "設定"` → `tab "正則"`。
3. `find { query: "combobox" }`:第二個是頁面選單、標「全部分類」的是分類選單。`form_input` 頁面選單填 `tincture_mods`。
4. `find` 詞綴文字(例「冷卻時間恢復率」「對貧血的敵人」)取 ref 點擊勾選 → 等 1 秒 → `javascript_tool` 貼 `dump-regex-page.js` → 存 `state-tincture-mods.json`。
5. `form_input` 頁面選單填 `vendor_bases`、分類選單填 `萃取物` → `find` 「灰樹皮萃取物」點擊 → 傾印存 `state-vendor-bases.json`。
6. `node .claude/skills/verify/check-tincture-page.mjs <證據目錄>`。
7. 收尾:`find { query: "取消所有勾選" }` 取清單的「清除」鈕點擊(物品基底頁有兩顆同名鈕,另一顆是稀有度 / 汙染條件區的)。

## Gotchas

- 面板隱藏時截圖可能是上一幀(第一次截到勾選前的畫面);以 `javascript_tool` 的傾印為準,截圖多等 1 秒重拍。
- `computer` 用座標點擊前要先有一張截圖,而且座標框是該截圖回報的大小(不一定是 800×600);能用 ref 就用 ref。
- 繁中的「增加 / 減少 #% 效果」等 8 列只差在數字兩側,勾了會顯示「無法單獨指定」,這是預期(頁說明有寫,改用「物品詞綴數值」頁)。
- 破壞對照:`git show <加萃取物之前的 commit>:data/regex/regex_poe1.json > data/regex/regex_poe1.json` → 重載 → 頁面選單沒有萃取物詞綴、物品基底沒有萃取物分類 → 斷言腳本結束碼 1;還原後 `npm run verify-data` 要通過。
