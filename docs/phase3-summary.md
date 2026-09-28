# Phase 3 摘要(2026-09-29)

Phase 3 = Poe Regex 完整化 + 拆粉(Thaumaturgic Dust)工具整合,共五個工作包。細節在各自文件;這裡只列「做了什麼」「已知限制」「待實測」。

| 包 | 做了什麼 | 已知限制 |
|---|---|---|
| WP-A poe.ninja + 單件拆粉 | `core/src/ninja/`(PobTools `warehouse_ninja.cpp` 同款 item overview + exchange 端點、300ms 間隔、`unique\|name\|baseType[\|6L]` 等鍵、快照 15 分鐘 TTL / 30 天清除,錄製檔測試);`renderer/src/web/background/Prices.ts` 換成真實作(介面對齊上游,移植元件不改);復原 `DustValue.vue` 並加「每 chaos ≈ N 粉塵」與低信心標記 | 只有國際服(台服一律無價);PoE2 的 `Prices.ts` 仍是「沒有價格」;ninja 價多為低 ilvl、未腐化、無品質掛單 |
| WP-B 拆粉排行 | `data/dust/poe-dust.json`(poe-disenchant-tool,MIT;`sync-dust-data.mjs`)、`core/src/dust/`(`dustAt` = APT 公式逐字、交叉比對、`rankUniques` 四種效率 + 飾品催化劑 + gold 估值)、標題列 ⚖ 面板(排序 / 篩選 / 虛擬捲動 / 標記與隱藏按聯盟記憶 / 交易站與 ninja 連結)。見 [dust-tool.md](dust-tool.md) | 排行是「買得到的話」的估計(ilvl / 品質照選項);`goldCost` 來源未說明 ilvl,當固定值 |
| WP-C Regex 演算法頁 / UX | `regex/src/numeric.ts`(數值 → 最短正則,0–999 逐值驗證)、`pages/`(`map_numeric`、`waystone_numeric`、`vendor_items`、`vendor_items_poe2`)、`combine.ts`(多頁合併 + 聯集 Verify + 衝突)、`share.ts`(分享碼)、`data/regex/templates.json`(7 組範本)、`labels.poe*.json` 暫代標籤;UI 合併檢視、自訂文字、排除詞、範本、分享碼。見 [regex-port.md](regex-port.md) | 全部自寫(poe.re 無 LICENSE);PoE2「稀有怪物 ≥N%」會中聖物頁一條(真衝突,合併時才報) |
| WP-D PobTools 產生器 | PobTools `tools/gen_regex_data.py` 改宣告式 `PAGES`、schema 2(`labels`、`kind`),新頁 PoE1 8 頁(scarabs、flask_mods、cluster_jewel、gem_names、tattoos、heist_equipment_mods、heist_contracts、vendor_bases)、PoE2 3 頁(flask_charm_mods、gem_names、vendor_bases);既有兩頁輸出逐位元組不變。本 repo 以 `sync-regex-data.mjs --allow-dirty` 同步 → 設定 › 正則共 17 頁(PoE1 10、PoE2 7) | PobTools 端資料**未 commit**(見下) |
| WP-E 收尾 | 排行的**固有勢力修正**(下述)、全量驗證、CLAUDE.md / README / docs / NOTICE、打包與正式包無輸入啟動檢查 | commit / push / 發版等使用者指示 |

## 拆粉排行的固有勢力修正(WP-E)
交叉比對 25 筆不一致中 24 筆 = APT 值 ×(1 + 0.5n),n = 1 或 2(Starforge、Voidforge、Mark of the Shaper/Elder、Indigon…)——這些傳奇本身固定帶勢力,
APT 的 `disenchantValue` 不含勢力倍率(單件查價是解析物品文字時才加),排行沒有物品文字所以原本低估。
`inherentInfluencesFromPoeDust`(`core/src/dust/data.ts`)從 poe-dust 反推 n,只接受 1 / 2 且 q0、q20 兩欄套 n 後都在 ±1 內;排行 `dustAt(dv, { ilvl, quality, influences: n })`,
列上標「固有勢力 ×n」。目前資料套用 24 件;Venarius' Astrolabe(比值 4.0)不套。單件查價不改。
例:Starforge 排行 ilvl 84 q0 = 2,638,087(poe-dust 2,638,088,差在 APT 公式 floor vs poe-dust 四捨五入),q20 = 3,341,577(poe-dust 3,341,578)。

## 待使用者實測 / 裁定
- **Regex 商店頁**:插槽 `R-G-B` 在繁中客戶端是否照英文字母與 `-` 顯示(連結數、鏈接顏色、插槽顏色數三項標「待實測」);
  寶石等級行首錨定 `^等級` 是否成立;屬性行分隔字元(PoE1 `：`、剪貼簿 `: `、PoE2 空白)與「+」在遊戲搜尋列的實際比對。
- **PobTools 端未 commit**:`pob-zh-engine/host/data/regex_poe{1,2}.json`(schema 2 + 新頁)尚未 commit,本 repo MANIFEST `data/regex` 帶 `dirty: true` 與各檔 sha256;
  commit 後不帶 `--allow-dirty` 重跑同步即清除。
- **`max_stats` 6 → 8**:PoE1 既有 `map_mods` / `logbook_mods` 維持讀前 6 個 stat 欄(逐位元組回歸閘門);改讀全部 8 欄會替 3 行(T17 詞綴在第 7/8 欄)補上隱藏文字,是真的缺口,但屬刻意的資料變更,待使用者決定。
- 拆粉排行 / 單件拆粉 / ninja 價格在真實聯盟的觀感(ninja 請求 20 個,15 分鐘快取)。

## 驗證(2026-09-29)
`npm run typecheck` 全過;`npm test`:verify-data 45 檔、core 43、poe1 107、poe2 546、regex 582、renderer 11,無 skip;`npm run build-icons` hash 不變;`npm run build`、`npm run package` 成功。

## 相關文件
- [dust-tool.md](dust-tool.md)、[dust-crosscheck.md](dust-crosscheck.md)、[regex-port.md](regex-port.md)、[phase2-summary.md](phase2-summary.md)、[release-flow.md](release-flow.md)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
