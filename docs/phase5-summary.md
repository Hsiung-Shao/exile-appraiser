# Phase 5 摘要(2026-09-29;S5 兩段式辨識、S6 框選辨識區域 2026-09-30)

Phase 5 = PoE2 褻瀆 Tier 階段 2:靈魂之井三選一揭露面板 OCR(WP-S)。細節見 [reveal-ocr.md](reveal-ocr.md)。

| 包 | 做了什麼 | 已知限制 |
|---|---|---|
| S1 main 擷取 + OCR | `main/src/ocr/`:`win-ocr.ps1`(常駐 PowerShell 5.1 + WinRT OCR,esbuild text loader 內嵌)、`WinOcr.ts`(佇列 / 逾時 8 秒 / 重啟 / 閒置 10 分鐘結束)、`capture.ts`(整個螢幕 `desktopCapturer` → 裁 client 區 → 放大 → JPEG q95)、`reveal.ts`(廣播 `ocr-reveal-result`)、`selftest.ts`(`--ocr-selftest <png>`,無視窗);`Shortcuts.ts` 動作 `ocr-reveal`(overlay + PoE2、預設 `Ctrl + Shift + R`,不送任何按鍵);IPC `ocr-available`(`preview: false`)| 全螢幕獨占可能黑畫面;擷取段只能親測 |
| S2 poe2 比對引擎 | `poe2/src/desecration/ocr-match.ts`(正規化、skeleton、精確 / 模糊、折行、分組、語意切段、profile 交集、Tier)、`reveal-entry.ts`;`infer.ts` export `partRange`;`stat-translations.ts` 數值 regex 抽成 `STAT_VALUE_RE`(行為不變);測試 `ocr-match.test.ts` 16 項 | 只有一張真實截圖;其他版面只有合成測試 |
| S3 renderer | `overlay/OcrBadges.vue`(徽章層,深色島、`pointer-events: none`)、`overlay/ocr-reveal.ts`(座標換算、最近 10 分鐘 PoE2 物品);`App.vue` 記 `lastPoe2Item`;設定 › 熱鍵與視窗:OCR 熱鍵列 + 「靈魂之井揭露 OCR」卡片(語言包狀態、進階 `ocrRegion`、隱私);`Config.ts` `hotkeyOcrReveal` / `ocrRegion`;i18n `ppz.ocr.*` 兩語;`renderer/test/ocr-reveal.test.ts` 5 項 | Esc 只在 overlay 有焦點時有效 |
| S5 兩段式辨識(2026-09-30)| `main/src/ocr/strategy.ts`(`smartRecognize`:cached → two-pass → full;`PanelRegionCache` 記憶體快取,鍵 = client 大小 + 擷取偏移 + 搜尋範圍)、`locate-data.ts`(main 讀 `data/poe2/desecration/tiers.json` 建模板索引,第一次按熱鍵才讀)、`capture.ts` `prepareRect` / `rectRecognizer`、`reveal.ts` 事件加 `stage` / `stages`;`poe2/src/desecration/ocr-text.ts`(正規化 / skeleton / Levenshtein 抽成零依賴,`ocr-match.ts` re-export)、`ocr-locate.ts`(定位 + 外擴 + `checkRegion`);`poe2/src/parser/stat-value-re.ts`(`STAT_VALUE_RE` 字面搬到零依賴模組,`stat-translations.ts` re-export);`--ocr-selftest` 改成跑 ①two-pass ②cached ③full 對照 ④熱 two-pass | 定位只驗過兩張真實截圖;×1 認不出任何詞綴的解析度(字太小)會退回整張 ×3,只是變回原本的速度 |
| S6 在遊戲畫面上框選辨識區域(WP-S2,2026-09-30)| renderer:`overlay/OcrRegionPicker.vue`(暗幕挖空、8 把手、即時百分比、「目前區域」實線 / 「上次偵測」虛線參考框、深色島說明條;確認 → 寫 `ocrRegion` → `focus-game` → 150 ms 後 `ocr-reveal-now`)、`overlay/region-geom.ts`(純函式)、`ocr-reveal.ts` 共用狀態(`regionPickerOpen` / `lastDetectedRegion`);`App.vue` 框選中忽略 Alt 隱藏與背景點擊;`OcrBadges.vue` 記上次偵測外框、`region-fallback` 提示 5 秒;設定卡片改成狀態 + 「在遊戲上框選」「清除」,四個數字欄位收進「進階」`<details>`;選用熱鍵 `hotkeyOcrRegion`(預設空)。main:`strategy.ts` `regionSearchRect`(以 client 尺寸換算再減擷取偏移)、`recognizeRegionFirst`(區域命中 < 2 → 整張再跑,`stage` = `region` / `region-fallback`)、`RegionCacheGuard`(`ocrRegion` 變更清快取);`shortcut-actions.ts`(熱鍵動作表抽成純函式)`ocr-region` 動作;IPC `overlay-activate`、`ocr-reveal-now`(皆 `preview: false`)、事件 `ocr-region-pick` | 框選 / 自動試辨識 / 退回整張都只在無頭頁面與假 recognize 驗過,真實 overlay 焦點切換待使用者親測;window 模式與瀏覽器預覽不提供框選 |
| S4 工具 / 文件 | `scripts/ocr-fixture.mjs`(同一支 ps1 → `*.ocr.json` 快照)、`docs/reveal-ocr.md`、本文件、CLAUDE.md / README | |

## 驗證(2026-09-29)
- `npm run typecheck` 全過;`npm test`:verify-data 47 檔、core 43、poe1 107、poe2 572(+16 ocr-match)、regex 582、renderer 16(+5)、main 21,無 skip。
- `node scripts/ocr-fixture.mjs`:樣本 7 行詞綴逐字正確(另有角落「倉庫」)。
- `--ocr-selftest`:樣本 / 1920×1080 / 2560×1440 假 client 皆 7 行全對,前處理 88–219 ms、OCR 0.5–0.85 秒。
- **S5(2026-09-30)**:`npm test` verify-data 47 檔、core 43、poe1 107、poe2 583(+2 fullscreen-02 回歸、+9 `ocr-locate`)、regex 582、renderer 16、main 29(+8 `ocr-strategy`),無 skip;`npm run typecheck` 全過。
  `--ocr-selftest` 真實全螢幕截圖 2000×1125:two-pass 515 ms(冷;第 1 段 ×1 425 ms + 第 2 段 ×3 89 ms)/ 383 ms(熱)、cached 113 ms、整張 ×3 對照 1080 ms;三條路 4 行詞綴逐字相同。
- 無頭 Chrome + 假 host:三枚徽章在各組右緣 + 14 px、垂直置中(0 px 誤差);Alt 隱藏、再按清除、Esc、`lang-missing` / `no-panel` 提示、查價過 Rogue Armour 後無「?」。
- **S6 / WP-S2(2026-09-30)**:`npm test` verify-data 47 檔、core 43、poe1 107、poe2 583、regex 582、renderer 38(+22 `region-geom`)、main 43(+9 `ocr-strategy`:client / 偏移換算 400 組對照舊版、出界、區域優先 / 退回整張、快取清除;+5 `shortcut-actions`),無 skip;`npm run typecheck` 全過;`npm run build --workspace renderer` 過。
  無頭 Chrome(2000×1125,背景 fullscreen-02)+ 假 host,滑鼠 / 鍵盤只用 CDP `Input.dispatch*`:設定卡片未設定 / 已設定 / 預覽端;從設定開框選層 → `overlayActivate`、設定與徽章關閉、上次偵測虛線框;拖曳 380,500→930,780 → 選取框 550×280、8 把手、「左 19%、上 44%、寬 28%、高 25%」→ Enter → `ocrRegion` = `{x:0.19, y:0.4444, w:0.275, h:0.2489}`,`focusGame` → 160 ms 後 `ocrRevealNow`;熱鍵事件開啟 → se 把手、框內移動、方向鍵(含 Shift / Ctrl)→ Esc 設定不變;overlay 失焦取消、點一下不改選取、套用上次偵測、`region-fallback` 提示;淺色 + 英文說明條維持深色島 `rgb(19,24,32)`。32 項檢查全 PASS(0 FAIL),頁面無 console 錯誤。

## 待使用者親測(不得合成輸入)
見 [reveal-ocr.md](reveal-ocr.md)「待使用者親測」。

## 相關文件
- [reveal-ocr.md](reveal-ocr.md)、[desecration-tiers.md](desecration-tiers.md)、[phase4-summary.md](phase4-summary.md)
