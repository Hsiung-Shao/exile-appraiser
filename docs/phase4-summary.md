# Phase 4 摘要(2026-09-29)

Phase 4 = 瀏覽器預覽 + 拆粉停靠 + PoE2 褻瀆詞綴 Tier,共三個實作包 + 收尾(WP-T)。細節在各自文件;這裡只列「做了什麼」「已知限制」「待親測」。

| 包 | 做了什麼 | 已知限制 |
|---|---|---|
| WP-P 瀏覽器預覽 | `main/src/preview-server.ts`(Node `http`,沒有新依賴;供應 `renderer/dist` + 注入 boot script 造 `window.host`;`POST ~rpc` + SSE `~events`,`Last-Event-ID` 續傳)、`main/src/host-handlers.ts`(IPC 登錄表,`registerIpc` / `previewHandlers` 共用一份,`preview: false` 不開放);入口:托盤「在瀏覽器開啟設定」、設定 › 一般(網址 + 複製)、`--preview`;`config-changed {contents, source}` 廣播同步兩端,發起端回音在傳輸層略過;main 21 項測試。見 [browser-preview.md](browser-preview.md) | 開發模式預覽供應**已 build 的** `renderer/dist`(不代理 Vite);預覽頁不收 `item-text`(不跟著查價);兩端同時改是最後寫入者勝;overlay 模式下預覽改遊戲 / 標題 / overlayMode 只提示「下次啟動才生效」 |
| WP-Q 拆粉停靠(**2026-09-30 已移除**:拆粉排行改成設定視窗的「拆粉排行」分頁,⚖ 直接開到該頁;`dustDockRatio` 不再使用,見 `docs/dust-tool.md`) | `App.vue` 的 `.price-stack`:上查價、下停靠拆粉排行;`.dust-splitter` 可拖曳或 ↑↓,比例存 `AppConfig().dustDockRatio`(預設 45,限 15–50%);收到新物品不收起拆粉;window 模式開拆粉時視窗高不足 900 會放大(只放大不縮小);設定頁當時仍獨佔整個面板(2026-09-30 起改成獨立的置中設定視窗 `settings/SettingsWindow.vue`,見 CLAUDE.md) | 拆粉佔比上限 50%,查價區在小視窗仍可能擠 |
| WP-R 褻瀆 Tier(階段 1) | `scripts/build-desecration-tiers.mjs`(逐段移植 poenavi 產生器,MIT;版本鎖 PoB2 portable `manifest.xml` 逐檔 sha1)→ `data/poe2/desecration/{tiers,base_profiles}.json`(PoB2 0.23.1:profiles 422、entries 1,713,unparsed 0);`poe2/src/desecration/`(`inferDesecratedTiers` 推定、`display.ts`);`Parser.ts` 新增 `parsePlainModifiers`(一般格式詞綴區原本整段被略過);`FilterModifierTiers.vue` / `SourceInfo.vue` 顯示「推定」與候選;PoE2 複製鍵改 `Ctrl + Alt + C`(`Shortcuts.ts` `copyItemHotkey`)。見 [desecration-tiers.md](desecration-tiers.md) | 一般複製是**推定**:pool 歧義、混合詞綴拆行組合比對可能誤併、跨行 stat 整段略過;PoB2 0.23.1 可能落後遊戲;改過「顯示進階詞綴」鍵的玩家仍會拿到一般格式 |
| WP-T 收尾 | CLAUDE.md(佈局表、必守規則 18–20、指令、剩餘待辦)、README 功能段、本文件、兩份文件互相引用;NOTICE 補 Path of Building PoE2(MIT,`LICENSES/path-of-building.MIT`)與 poenavi 產生器移植;全量驗證、打包、正式包無輸入啟動檢查 | commit / push / 發版等使用者指示 |

## 待使用者親測(自動驗證不得合成鍵盤 / 滑鼠輸入)
1. **PoE2 `Ctrl + Alt + C`**:遊戲內按查價熱鍵 → log 有 `送出複製鍵 Ctrl + Alt + C(poe2)`、稀有物品詞綴齊全、褻瀆 Tier 無「推定」;
   **Alt 是否卡住**(PoE2 按住 Alt 會切換地上物品標籤)。
2. **PoE2 一般複製推定**:遊戲內 `Ctrl + C` → 視窗模式貼上框 → 有詞綴,褻瀆 Tier 標「推定」(或列候選)。
3. **瀏覽器預覽同步**:托盤「在瀏覽器開啟設定」→ 瀏覽器改主題,overlay 同步。
4. **拆粉停靠**:標題列 ⚖ 開停靠 + 真實拖曳分隔條,重開後比例保留。
5. **overlay 下預覽改遊戲**:顯示「下次啟動才生效」提示,不自動重啟;之後在 overlay 裡改成別的值照舊重啟。

## 剩餘待辦
- ~~OCR 三選一揭露面板(WP-S,階段 2)~~:已在 Phase 5 實作,見 [phase5-summary.md](phase5-summary.md)、[reveal-ocr.md](reveal-ocr.md)。
- 照 EE2 讀 `poe2_production_Config.ini` 的 `show_advanced_item_descriptions`,支援自訂進階鍵。
- poe.ninja Map 類沒有 `mapTier`,地圖價格無法依階級對上。
- 設定 › 關於 的授權清單(`About.vue`)尚未列入 `path-of-building.MIT`(檔案已在 `LICENSES/` 與 `renderer/public/licenses/`)。

## 驗證(2026-09-29)
`npm run typecheck` 全過;`npm test`:verify-data 47 檔、core 43、poe1 107、poe2 556(含 desecration 10)、regex 582、renderer 11、main 21,無 skip;
`npm run build-icons` hash 不變;`npm run build`、`npm run package` 成功;正式包 `--window --preview --no-updates` 無輸入啟動:log 有 `mounted`、`資料載入完成`、`[preview]` 網址,正確 token 200、錯 token 404。

## 相關文件
- [browser-preview.md](browser-preview.md)、[desecration-tiers.md](desecration-tiers.md)、[phase3-summary.md](phase3-summary.md)、[phase2-summary.md](phase2-summary.md)、[release-flow.md](release-flow.md)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
