# 功能地圖(實跑驗證)

只列**實際跑過**的旅程;沒列的功能代表還沒有腳本化的驗證,不是「不需要驗證」。新增旅程時照既有檔的四節寫,並做一次破壞對照。

| 功能 | 檔案 | 斷言腳本 |
|---|---|---|
| 正則 › 自訂字串書籤(新增 / 編輯 / 存檔 / 刪除) | [regex-custom-bookmark.md](regex-custom-bookmark.md) | `check-custom-bookmark.mjs` |
| 正則 › 萃取物詞綴頁、物品基底的萃取物分類(選頁 / 勾選 / 輸出字串) | [regex-tincture-page.md](regex-tincture-page.md) | `check-tincture-page.mjs` |

待補(純瀏覽器做得到、尚未寫):正則清單勾選 → 輸出字串、書籤資料夾、設定分頁導覽、拆粉排行表。
純瀏覽器做不到(見 `../SKILL.md`):查價、熱鍵、貼進遊戲、OCR、overlay。
