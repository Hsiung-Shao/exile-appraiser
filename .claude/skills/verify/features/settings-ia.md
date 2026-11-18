# 旅程:設定視窗重整(方案 B,2026-11-18)

左選單「設定 / 功能 / 工具」三組、每頁頁首、搬過家的卡片、功能頁「這頁的熱鍵」、熱鍵總表分組卡片與跳轉、正則子分頁。

1. `preview_start renderer`,點「設定」(標題列齒輪)。預設設定 = PoE1、overlay 模式。
2. `javascript_tool` 貼 `dump-settings-ia.js` 的內容(會逐頁點左選單,約 10 秒),回傳值用 Write 原樣存成 `<證據目錄>/state-settings-ia.json`。
3. `node .claude/skills/verify/check-settings-ia.mjs <證據目錄>`。
4. 截圖留證:一般、倉庫、熱鍵、正則 › 書籤與快捷各一張。

收尾:不改任何設定(只切分頁),不需要清理。
破壞點建議:`settings-tabs.ts` 把 `timer` 的 `group` 改成 `'settings'` → 斷言「左選單三組」必須 FAIL。
不涵蓋:overlay 浮動視窗的拖曳 / 縮放、PoE2 的自動辨識頁(要切遊戲)、真實熱鍵。
