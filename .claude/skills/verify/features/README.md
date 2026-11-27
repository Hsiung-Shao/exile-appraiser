# 功能地圖(實跑驗證)

只列**實際跑過**的旅程;沒列的功能代表還沒有腳本化的驗證,不是「不需要驗證」。新增旅程時照既有檔的四節寫,並做一次破壞對照。

| 功能 | 檔案 | 斷言腳本 |
|---|---|---|
| 正則 › 自訂字串書籤(新增 / 編輯 / 存檔 / 刪除) | [regex-custom-bookmark.md](regex-custom-bookmark.md) | `check-custom-bookmark.mjs` |
| 正則 › 萃取物詞綴頁、物品基底的萃取物分類(選頁 / 勾選 / 輸出字串) | [regex-tincture-page.md](regex-tincture-page.md) | `check-tincture-page.mjs` |
| 設定視窗重整(三組選單 / 頁首 / 搬家的卡片 / 這頁的熱鍵 / 熱鍵總表跳轉 / 正則子分頁) | [settings-ia.md](settings-ia.md) | `check-settings-ia.mjs` |
| 地圖詞綴檢查的書籤設定(正則 › 書籤與快捷) | [map-check-settings.md](map-check-settings.md) | `check-map-check.mjs` |
| 懸浮選單 › 速查表(一次匯入多張 / 釘住後滾輪、拖曳、按鈕放大;假 host overlay) | [cheat-sheet.md](cheat-sheet.md) | `check-cheat-sheet.mjs` |
| 計時器三種模式(設定頁切模式 / 倒數時長 / 試聽;假 host overlay 碼表與倒數歸零) | [timer-modes.md](timer-modes.md) | `check-timer-modes.mjs` |

待補(純瀏覽器做得到、尚未寫):正則清單勾選 → 輸出字串、書籤資料夾、設定分頁導覽、拆粉排行表。
純瀏覽器做不到(見 `../SKILL.md`):查價、熱鍵、貼進遊戲、OCR、overlay。
| 正則頁版面(兩欄門檻 / 數值條件換欄與焦點 / 書籤頁兩張小卡) | [regex-layout.md](regex-layout.md) | `check-regex-layout.mjs` |
