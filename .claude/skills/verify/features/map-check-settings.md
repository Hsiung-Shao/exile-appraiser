# 旅程:地圖詞綴檢查的書籤設定(PoE1;設定 › 正則 › 書籤與快捷)

2026-11-18 起地圖詞綴檢查依正則書籤上色,設定入口在正則頁,沒有獨立分頁;同日設定重整後下拉在「書籤與快捷」子分頁的「地圖詞綴檢查」卡片(`MapCheckCard.vue`)。

1. `preview_start renderer`。`javascript_tool` 往 `localStorage['exile-appraiser.regex_state'].bookmarks` 推兩個書籤後 reload:
   `{name:'驗證-地圖危險',page:'map_mods',game:'poe1',mode:'none',lang:'zh',keys:['Monsters Poison on Hit'],alt:['被怪物擊中時中毒']}`、
   `{name:'驗證-藥劑',page:'flask_mods',game:'poe1',mode:'any',lang:'zh',keys:[],alt:[]}`。
2. 點「設定」→ 左選單「正則」→ 子分頁「書籤與快捷」(`[data-setting="regex-view"] [data-value="bookmarks"]`)→ 先記下 `[data-regex="bm-map-check"] select` 目前選中的文字(`autoBefore`;沒選過 + 只有一個地圖書籤 = 自動選)→ `[data-regex="bm-map-check"] select` 選「驗證-地圖危險」那個選項(值 = 清單索引)並送 `change`。等 1.5 秒。
3. 讀 nav / `location.hash` / 正則子分頁(`regexView` = 按下狀態的子分頁 `data-value`)/ 下拉選項與選中文字(`selectedLabel`) / `localStorage['exile-appraiser.config']` 的 `mapCheckBookmark`(`{ folder, name }`)與有沒有 `mapCheck` / 說明列 class(卡片裡 `p` 的 class) → 存 `state-after-select.json`。
4. `node .claude/skills/verify/check-map-check.mjs <證據目錄>`。

收尾:從 regex_state 刪掉兩個「驗證-」書籤、`mapCheckBookmark` 設回 null。
破壞點建議:`tabs/Regex.vue` 把 `<map-check-card v-if="config.game === 'poe1'" />` 的條件改成 `false` → 斷言「有地圖檢查書籤列」必須 FAIL。
不涵蓋:熱鍵叫出的 overlay 地圖檢查視窗(要真的 overlay + 遊戲;`renderer/test-vue/map-check-mount.test.ts` 掛載測試涵蓋畫面邏輯)。
