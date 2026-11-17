# 旅程:設定 › 地圖詞綴(PoE1)

1. `preview_start renderer` → 點「設定」→ 左選單「地圖詞綴」(純瀏覽器預設 PoE1 + overlay)。
2. 找到「地圖含有兩個傳奇頭目」那一列,點第二個圈(危險)。等 1.5 秒(存檔去抖)。
3. `javascript_tool` 讀 nav / `location.hash` / 「屬性(找到 N 條)」/ `localStorage['exile-appraiser.config'].mapCheck` → 存 `state-after-click.json`。
4. `node .claude/skills/verify/check-map-check.mjs <證據目錄>`。

收尾:把那一列改回「好」(第三個圈)或清 `localStorage`。
破壞點建議:`settings-tabs.ts` 拿掉 `map-check` 列 → 斷言「左選單有地圖詞綴」必須 FAIL。
不涵蓋:熱鍵叫出的 overlay 地圖檢查視窗(要真的 overlay + 遊戲;由 `renderer/test-vue/map-check-mount.test.ts` 掛載測試涵蓋畫面邏輯)。
