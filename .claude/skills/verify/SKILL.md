---
name: verify
description: ExileAppraiser(流亡鑑價,Electron + Vue 查價工具)的實跑驗證。用 Vite 開發伺服器把 renderer 當網站開在內建瀏覽器,走使用者路徑、留證據。改了 renderer 介面(設定視窗、正則、查價面板的畫面)要宣稱「能用」之前、或 /handoff-check 的實跑驗證段使用。
---

# verify:ExileAppraiser 實跑驗證

## 這個驗證涵蓋什麼、不涵蓋什麼

**表面**:`renderer/`(Vite + Vue 3)以**純瀏覽器**方式執行。沒有 Electron main,`window.host` 不存在,所以:

- 涵蓋:設定視窗各分頁的畫面與互動、正則面板、書籤、存檔往返(純瀏覽器存在分頁的 `localStorage`,不會碰到 `%APPDATA%\exile-appraiser`)。
- **不涵蓋**(替身環境做不到,一律回報「未驗證,待使用者實機確認」):全域熱鍵、貼進遊戲、overlay 附著、OCR、交易站查詢(瀏覽器會被 CORS 擋,主控台那兩條 `pathofexile.com` 的 CORS 錯誤是預期的)、剪貼簿(內建瀏覽器分頁沒有剪貼簿權限,點書籤列會顯示「複製失敗」是預期的)。

**專案守則第 14 條**:不得對使用者的遊戲或桌面送合成鍵盤 / 滑鼠輸入。這份驗證的點擊與輸入只打在內建瀏覽器自己的分頁裡。

## Launch

1. `mcp__Claude_Browser__preview_start { name: "renderer" }`(`.claude/launch.json`:`npm run dev:renderer`,port 5173)。**不要用 Bash 起伺服器。**
2. 可用的判準:`read_page { filter: "interactive" }` 看得到 `button "設定"`。只看到空白頁 = 還沒好,等 2 秒重讀。
3. 關閉:`preview_stop { serverId }`(Launch 回傳的那個)。

## Doctor(唯讀)

- `mcp__Claude_Browser__preview_list` 有 `renderer`、port 5173。
- `read_console_messages { onlyErrors: true }`:只准出現 `pathofexile.com` 的 CORS 兩條;其他錯誤先處理再驅動。

## Drive

通則:

- 進設定:點 `button "設定"`;切分頁:點左選單的 `tab "<分頁名>"`(例 `tab "正則"`)。純瀏覽器下 `#tab=` 不會自動開設定視窗。
- 找元素先用 `find`(文字);找不到(捲出畫面外時常見)就用 `javascript_tool` 對 `data-regex` / `data-*` 把手 `scrollIntoView({block:'center'})` 再 `getBoundingClientRect()`,座標換算成截圖座標(`x * 800 / innerWidth`、`y * 600 / innerHeight`)後點擊。
- 文字欄位用 `form_input`(ref 由 `find { query: "textbox" }` 取)。`computer type` 對剛開的對話框常常晚一拍才落字,會重複輸入。
- 每次操作後等 1 秒再讀狀態(存檔有去抖)。

各功能的路徑在 `features/`(見 `features/README.md`)。

## Evidence

證據目錄:`.claude/skills/verify/evidence/<yyyyMMdd-HHmmss>/`(已被本目錄的 `.gitignore` 排除)。至少要有:

- `run.log`、`exit_code.txt`:由該功能的斷言腳本寫出(例 `node .claude/skills/verify/check-custom-bookmark.mjs <證據目錄>`),不要手寫。
- `state-*.json`:`javascript_tool` 執行 `dump-regex-bookmarks.js` 的回傳值,用 Write 原樣存檔(同時含畫面狀態與 `localStorage` 存檔 = 副作用)。
- 截圖:`computer screenshot` 後把工具結果列出的圖檔複製進證據目錄。

最後跑:

```
python C:\Users\jerry\.claude\scripts\evidence_gate.py <證據目錄> --source-root <專案根目錄>
```

必須 PASS。證據早於最後一次原始碼修改會被判過期,要重跑。

## Cleanup

- 走過的旅程自己收尾(刪掉自己建的書籤等,旅程檔有寫)。
- `preview_stop` 關掉自己起的伺服器。不按名稱殺行程,不刪證據。

## Helpers

| 檔案 | 用途 | 呼叫 |
|---|---|---|
| `dump-regex-bookmarks.js` | 讀正則書籤卡片 / 書籤列 / 存檔現況 | 內容貼進 `javascript_tool` |
| `check-custom-bookmark.mjs` | 自訂字串書籤旅程的斷言,寫 `run.log` 與 `exit_code.txt` | `node .claude/skills/verify/check-custom-bookmark.mjs <證據目錄>` |
| `dump-regex-page.js` | 讀正則面板目前頁的頁面選單 / 分類 / 勾選數 / 清單列 / 輸出字串 | 內容貼進 `javascript_tool` |
| `check-tincture-page.mjs` | 萃取物詞綴頁 + 物品基底萃取物分類旅程的斷言 | `node .claude/skills/verify/check-tincture-page.mjs <證據目錄>` |
| `check-cli-output.mjs` | 無頭查價輸出的斷言(必含字串、沒有 ⚠);純瀏覽器拿不到聯盟清單(CORS)→ 貼物品文字後查價面板是空的,查價條件改用這個留證據 | `npm run check -- <物品> --realm both > <證據目錄>/x.txt` 後 `node .claude/skills/verify/check-cli-output.mjs <證據目錄> x.txt <字串>...` |
| `check-season-data.mjs` | PoE1 賽季資料更新旅程(`features/poe1-season-data.md`)的斷言:正則頁新寫法 + 無頭查價 | `node .claude/skills/verify/check-season-data.mjs <證據目錄>` |
| `check-stash-330.mjs` | PoE1 3.30 碎片倉庫頁(一般 / 綢帶)疊層:使用者截圖貼回 2560×1440 → WinOcr 只用來定位裁圖 → runtime 同一條格子擬合(`fit.ts` `fitStashGrid`)判子頁與格框 → 每格讀數量對人工判讀,輸出標註圖;不開遊戲、不送輸入。破壞點:`fit.ts` `FORMULA_DX` 改成 0.3(格框整片左移、數量讀錯) | `node .claude/skills/verify/check-stash-330.mjs <證據目錄> --general <一般頁截圖> --threads <綢帶頁截圖>` |
| `dump-regex-layout.js` + `check-regex-layout.mjs` | 正則頁版面旅程(`features/regex-layout.md`):視窗寬 840 與 1000 各量一次(欄位位置、數值條件換欄、焦點、書籤頁),斷言兩欄門檻。破壞點:`RegexPanel.vue` 的 `52em` 改 `46em` | 貼 `dump-regex-layout.js` 進 `javascript_tool` → 存 `state-840.json` / `state-1000.json` → `node .claude/skills/verify/check-regex-layout.mjs <證據目錄>` |

## 破壞對照(新旅程第一次建立時要做)

故意弄壞一處(旅程檔有建議的破壞點)→ 重跑旅程 → 斷言腳本必須結束碼非 0,輸出存到 `<證據目錄>/negative/` → `git checkout -- <檔案>` 還原並 `git diff --quiet` 確認 → 重跑正向確認恢復通過。
