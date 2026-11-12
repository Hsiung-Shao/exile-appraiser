# 正則 › 自訂字串書籤

## Sub-features

- 書籤卡片「自訂書籤」→ 對話框(名稱 + 正則字串 + 字數)→ 存成書籤
- 自訂書籤那一列:「編輯」取代「載入」「更新」;改名 / 刪除 / 上下移 / 熱鍵欄照常
- 設定視窗上方的書籤列出現這筆書籤
- 存檔往返(純瀏覽器 = `localStorage` 的 `exile-appraiser.regex_state`,`page: "@custom"`、`keys: [字串]`)
- 輸出區「存成自訂書籤」把目前輸出字串帶進同一個對話框
- 輸出框可直接輸入自訂字串(`[data-regex="query"]`,`form_input` 填值)→ 出現 `manual-hint` → 「存成自訂書籤」→ 填名稱 → 確定 → `manual-reset` 還原;三步的 DOM 讀回存成 `state-typed.json` / `state-saved.json` / `state-reset.json`,跑 `node .claude/skills/verify/check-output-box.mjs <證據目錄>`

## How to get to it (user POV)

設定(右上角齒輪)→ 左選單「正則」→ 捲到「書籤」卡片 → 標題列「自訂書籤」。

## Driving it with 內建瀏覽器

證據目錄先建好,寫 `inputs.json`:`{ "name": "verify-<時間>", "text": "\"階級 1[6-7]\" \"!反射\"", "edited": "\"階級 17\" \"!反射|無法回復\"" }`(名稱帶時間,避免撞到分頁裡既有的書籤)。

1. 進設定 › 正則,等 `[data-regex="bookmarks"]` 出現。
2. 點 `[data-regex="bm-custom-add"]` → `find { query: "textbox" }` 最後兩個是名稱與字串 → `form_input` 填 `name`、`text` → 點 `button "確定"`。等 1 秒,執行 `dump-regex-bookmarks.js` → 存 `state-after-add.json`。
3. `find { query: "編輯" }` 點該列的 `button "編輯"` → `form_input` 把字串改成 `edited` → `button "確定"`。等 1 秒 → 存 `state-after-edit.json`。截圖一張存進證據目錄。
4. `navigate` 重新載入 `http://localhost:5173`,再進設定 › 正則 → 存 `state-after-reload.json`。
5. 點該列 `[data-regex="bm-delete"]` → 確認框 `[data-regex="bm-delete-ok"]`。等 1 秒 → 存 `state-after-delete.json`。
6. `node .claude/skills/verify/check-custom-bookmark.mjs <證據目錄>`(寫 `run.log`、`exit_code.txt`)。

## Gotchas

- 書籤卡片在頁面下方,`find` 常找不到捲出畫面外的按鈕 → 先 `scrollIntoView`。
- 對話框剛開時用 `computer type` 會晚一拍落字,之後再打會插在中間 → 一律 `form_input`。
- 點書籤列只會看到「複製失敗」(分頁沒有剪貼簿權限);字串有沒有算對由 `regex/test/custom-bookmark.test.ts` 守。
- 貼進遊戲、個別熱鍵、懸浮選單這三個入口純瀏覽器驗不到 → 回報「待使用者實機確認」。
- **破壞對照的破壞點**:把 `regex/src/quick.ts` 的 `isCustomBookmark` 改成 `return false` → 該列會變回「載入 / 更新」、說明行不含字串 → 斷言腳本必須失敗。還原用 `git checkout -- regex/src/quick.ts`。
