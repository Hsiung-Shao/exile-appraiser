# ExileAppraiser(流亡鑑價)專案守則

> 2026-09-28 由 `poe-price-zh` 改名:英文 ExileAppraiser、slug `exile-appraiser`、中文顯示名「流亡鑑價」。
> main 啟動時若新 userData 沒有 `config.json` 而舊的 `%APPDATA%\poe-price-zh\config.json` 存在,會複製過來(`migrateLegacyConfig`)。

Path of Exile 查價工具(Electron + TypeScript)。把 `apt-patched`(Awakened PoE Trade 繁中 fork,PoE1)與
`ee2-patched`(Exiled Exchange 2 繁中 fork,PoE2)合併成一支 app;設計參考 poenavi(日文客戶端用的 PoE1/PoE2 一體查價)。
**獨立 git repo**,寄放在 `D:\codeproject\Pob2\exile-appraiser\`(Pob2 的 `.gitignore` / `info/exclude` 已排除),不併進 PobTools。

## 佈局(npm workspaces)
| 目錄 | 內容 | 規則 |
|---|---|---|
| `core/` | 純 TS 共用層:`http/`(HttpFetch 介面、RateLimiter 去 Vue 版、Cache、429 Retry-After)、`realm/`(intl/tw 模型、聯盟純函式)、`realm/config.ts` 的 `TRADE_PATHS` / `tradeApiBase(realm, game)`(PoE1 `/api/trade`、PoE2 `/api/trade2`)、`games/adapter.ts`(GameAdapter 介面) | 不得 import Vue / Electron / DOM API |
| `core/src/ninja/` | poe.ninja 價格源(WP-A):`client.ts`(item overview + exchange 端點、300ms 間隔、AbortController)、`keys.ts`(`unique\|name\|baseType[\|6L]`、`currency\|name`…)、`cache.ts`(快照 schema、15 分鐘 TTL、30 天清除)、`lookup.ts` | 只 intl;renderer 殼 `web/background/Prices.ts` 呼叫(WP-R2 起 PoE2 也抓,`priceOf(refName, level?)` 給符文塑形自動查價;快照 schema 2 多存 `exaltedRate`,格式見 `docs/ninja-poe2.md`);poe2 查價元件自己的 `poe2/src/web/background/Prices.ts` 仍是「沒有價格」 |
| `core/src/dust/` | 拆粉純函式(WP-A/B):`formula.ts`(`dustAt` = APT `calcDisenchantDust` 逐字)、`data.ts`(poe-dust / items.ndjson 解析、`inherentInfluencesFromPoeDust`)、`crosscheck.ts`、`rank.ts`(`rankUniques` 四種效率、催化劑、固有勢力)、`trade.ts`、`ui-state.ts` | 對接一律英文 `name + baseType`;說明見 `docs/dust-tool.md` |
| `poe1/` | PoE1 adapter。`src/{parser,assets/data,web/price-check/{filters,trade}}` **與 apt-patched `renderer/src` 同路徑、同 `@/…` 匯入**;`src/index.ts` 是對外入口;`src/cli.ts` 無頭驗證;`test/` 回歸網 | 移植檔逐字不改,只切耦合點(見下) |
| `poe2/` | PoE2 adapter。`src/{parser,assets,web/price-check/{filters,trade,item-editor},web/{background,ui}}` 與 ee2-patched `renderer/src` 同路徑、同 `@/…` 匯入(含 .vue);`src/index.ts` 對外入口、`src/renderer-entry.ts` 給 renderer(`@poe2-entry`)、`src/cli.ts`;`test/` = E 的 `renderer/specs` + golden-query / trade-client / src-coupling | 同 poe1;耦合點清單在 `docs/poe2-port-notes.md`。型別檢查兩段:`tsconfig.json`(.ts)+ `tsconfig.vue.json`(.vue,`@/*` → poe2/src 再退回 renderer/src)|
| `renderer/` | Vite + Vue 3 殼:`App.vue`、`settings/`、`web/{Config,i18n}.ts`、`web/background/{IPC,Leagues,Prices}.ts`(取代上游同名模組)、`web/ui/*.vue` | `@/…` 由 `vite.config.mts` 的 `gameAwareAtAlias()` 依 importer 解析:poe2/src 的檔先找 poe2/src 再退回本目錄;其餘把 `@/parser*`、`@/assets/data*`、`@/web/price-check/*` 指到 poe1、其餘 `@/web/*` 指本目錄。renderer 引用遊戲元件用 `@poe1/…`、`@poe2/…`、`@poe2-entry`(tsconfig 不讀 poe2 原始碼,只認 `src/web/games/poe2-entry.d.ts`)。設定 `game` 切換 → main.ts 重載資料與 app_i18n、`web/games/active.ts` 的 `loadedGame` 決定 parser 與元件 |
| `renderer/src/theme/pobtools.css` + `renderer/src/web/useTheme.ts` | 主題 token(取自 PobTools `pob-zh-engine/ui/src/app.css`,四主題 `data-theme=slate|light|contrast|parchment`)與套用(`<html>` 的 `data-theme`、`--fs-base`、`--accent-user`、`--on-accent-user`) | Tailwind `gray.*` 等色階是 token 的**別名**(`renderer/tailwind.config.cjs`),移植元件的 class 不改 |
| `renderer/src/web/settings/` | `SettingsWindow.vue`(APT 式方正設定視窗:標題列 + 左選單 + 右側捲動內容,選單底部「結束程式」= IPC `app-quit`,`preview: false`)+ `tabs/{General,PriceCheck,Hotkeys,Chat,Regex,Dust,About}.vue` 七分頁(`Chat` = 聊天指令與倉庫搜尋,2026-10-01;`Dust` = 拆粉排行,內容區加 `.fill` 不捲動、表格自己虛擬捲動)、`HotkeyInput.vue`(移植自 APT)、`tabState.ts`。overlay:`App.vue` 的 `.settings-layer` 暗幕 + 置中浮動(寬 min(50rem, 92vw)、高 min(38rem, 88vh),rem = `--fs-base` × 1.23),點暗幕 / Esc / ✕ 關閉;設定開著時查價面板(含標題列、側邊限流鈕)整個隱藏,只剩設定視窗,關閉後有物品回查價面板、沒物品(overlayKey 叫出)整個收起並還焦點給遊戲;window 模式 / 瀏覽器預覽填滿內容區,容器寬 < 640px 左選單收成上方分頁(container query)。即時套用,沒有儲存 / 取消 | 根元素保留 `.settings-panel`(各分頁 unscoped 選擇器與關於頁授權 modal 以它為範圍);`.srow` 等列樣式在 `SettingsWindow.vue`。OCR 框選由設定開啟時隱藏設定,確認 / 取消 / 清除後回到熱鍵分頁(`ocr-reveal.ts` `returnsToSettings`;這條路徑確認後**不**自動試辨識) |
| `renderer/src/web/dust/` | 拆粉排行面板:`DustPanel.vue`、`DustTable.vue`(虛擬捲動,欄寬依表格寬 container query)、`store.ts`;記憶 `userData/dust_ui.json`(標記/隱藏按聯盟分)。2026-09-30 起**在設定視窗的「拆粉排行」分頁**(`settings/tabs/Dust.vue`);查價標題列 ⚖ = 開設定並切到該分頁。WP-Q 的停靠 / 分隔條 / `dustDockRatio` 已移除(`Config.ts` 只挑已知欄位,舊設定檔帶這個鍵照常載入、不再寫出) | 單件拆粉在 `poe1/src/web/price-check/expected-value/DustValue.vue`(留在查價面板) |
| `renderer/src/web/trade-site.ts` | **開交易站網頁的唯一入口** `openTradeSite(url)`:預設系統瀏覽器(`Host.openExternal`,與查價「交易」鈕 TradeLinks 同一條路,使用者已登入);只有上游 `priceCheck.builtinBrowser`(設定頁不提供、預設 false)開著才用內建視窗 `Host.openCaptcha`。App.vue `provide('builtin-browser', openTradeSite)`(兩遊戲錯誤框「瀏覽器」鈕)、拆粉排行「交易 ↗」都走它 | `Host.openCaptcha` 只留給「開啟驗證視窗」(Cloudflare cookie,沒有登入狀態);**不要**再把看交易站接到 openCaptcha(使用者回報要重新登入)|
| `main/src/host-handlers.ts` | IPC handler 登錄表(`kind: invoke\|send\|sync`、`preview: false` 不開放給預覽);`registerIpc(table)` 給 ipcMain、`previewHandlers(table)` 給預覽伺服器;事件走 `Broadcaster.broadcast` | 新增 IPC 一律加在登錄表,並決定預覽能不能用 |
| `main/src/text-box.ts` + `ipc/reserved-hotkeys.ts` + `renderer/src/web/settings/{tabs/Chat.vue,hotkey-conflicts.ts}` | **聊天指令與倉庫搜尋熱鍵(2026-10-01,移植 APT `text-box.ts` / `chat.vue` / Config `commands`,MIT,檔頭註明)**:設定 `commands: {text, hotkey, send}[]`(預設 APT 六條:`/hideout`=F5、`/exit`=F9、`@last ty`、`/invite @last`、`/tradewith @last`、`/hideout @last`)、`stashSearch: {text, hotkey}[]`(預設空;Poe Regex 頁「加到倉庫搜尋」帶入)→ host-config → `shortcut-actions.ts` 動作 `paste-in-chat` / `stash-search`(兩遊戲皆可、**只在 overlay 模式**;遊戲保留鍵 Ctrl+C/V/A/F、Ctrl+Enter、Home、Delete、Enter、方向鍵 + PoE2 `Ctrl + Alt + C` 一律不註冊)→ `Shortcuts.ts` 先放開熱鍵按鍵 → `typeInChat` / `stashSearch`(按鍵序列純函式 `chatKeySequence` / `stashSearchSequence`,`@last` 前綴 / 後綴、AUTO_CLEAR、send 時 Enter + 還原頻道;倉庫搜尋 Ctrl+F → Ctrl+V → Enter,先 `assertGameActive`;包在 `HostClipboard.restoreShortly` 120 ms 節流)。設定新分頁「聊天指令」(`SettingsTabId` `chat`),每列顯示遊戲保留 / 重複 / 被佔用 | **這是本專案第一個在執行期對遊戲送出聊天 / 搜尋按鍵的功能(使用者要求)**;測試只用假 keyTap / 假剪貼簿(`main/test/text-box.test.ts`、`shortcut-actions.test.ts`、`renderer/test/chat-commands.test.ts`),真實送鍵只能使用者在遊戲裡測 |
| `main/src/backgrounds.ts` + `renderer/src/web/{useTheme.ts,ui/BgLayer.vue}` | **自訂背景圖(2026-10-01)**:設定 `bg: { enabled, file, bright, panelOpacity, blur }`(`normBg`;檔名規則 `normBgFile` 照 PobTools 去掉影片,main / renderer 各一份同 regex);設定 › 一般 › 背景「選擇圖片…」→ IPC `bg-pick`(`preview: false`)→ `dialog.showOpenDialog`(png / jpg / webp)→ 複製到 `userData/backgrounds/`(檔名 = 清理後原名 + sha256 8 碼,成功後刪舊圖)→ 設定只存檔名。載入 `app://bg/<檔名>`(`installAppProtocol`,開發模式也有)/ 預覽 `<prefix>bg/<檔名>`(token 保護),都經 `resolveBgPath` 防穿越。呈現:`useBackground` 在 `<html>` 設 `data-bg` + `--bg-image/--bg-bright/--bg-blur/--bg-panel-pct`;**只畫在 `.bg-host`(`#price-window`、設定視窗)內**的 `.bgimg` + `.bgtint`(absolute、z-index -1、容器 isolation);面板不透明度只在 `.bg-host` 內重算表面色;overlay 的 html / 其他區域維持透明(`:root[data-bg]:not(.ppz-overlay)` 才塗 html)。**可讀性(2026-10-01 使用者回報「透明面板後字不明顯」)**:`bgReadability` 另算 `--bg-read-pct` / `--bg-lift` / `--bg-halo`:只有圖上那層 `.bgtint` 照使用者的面板不透明度,容器內所有表面色(物品名列、篩選器、輸入框、標題列、表格列、按鈕、設定卡片)= max(使用者值, 地板值)(霧面 0 → 70%,霧面 ≥ 50 → 55%,中間線性);本身沒底色的閱讀區塊補一層 `--bg-lift` 到同一覆蓋率;文字加主題底色的光暈(面板越透明越濃,按鈕 / 輸入框另設 `text-shadow: inherit`,金底按鈕 / 徽章 / 彈出層 / 深色島不加);次要字色(`--ink-2/3`、`text-gray-600`)在背景模式提高對比。量測(四主題 × 面板 0/30/70 × 霧面 0/12,像素取樣):主要文字 ≥ 4.5:1、次要 ≥ 3:1 | 測試 `main/test/backgrounds.test.ts`(檔名 / 防穿越 / 預覽路由)、`renderer/test/background.test.ts`(正規化、網址、CSS 變數、地板值 / 補足層 / 光暈、設定往返、樣式守門) |
| `main/src/preview-server.ts` | 瀏覽器預覽(WP-P):Node `http` 供應 `renderer/dist` + 注入 boot script 造 `window.host`,`POST ~rpc` + SSE `~events`;入口:托盤、設定 › 一般、`--preview`。見 `docs/browser-preview.md` | 測試 `main/test/preview-server.test.ts`(純 Node) |
| `poe2/src/desecration/` | PoE2 褻瀆詞綴 Tier 推定(WP-R):`infer.ts`(`inferDesecratedTiers`,Parser 末段 virtual;`matchStats()` 與 ParsedItem 解耦)、`display.ts`(推定/候選字串)、`types.ts`。一般格式詞綴區由 `Parser.ts` 的 `parsePlainModifiers` 解析 | 見 `docs/desecration-tiers.md`;測試 `poe2/test/desecration/` |
| `main/src/ocr/{panel-scan,reveal-scan}.ts` | **2026-10-01 褻瀆自動持續辨識**:符文塑形掃描骨架泛化成 `PanelScan` + `PanelDetector`(排程 / 暫停 / 變化偵測 / 自動定位快取 / 事件節奏),符文與褻瀆各注入偵測器。褻瀆 `RevealScan`:`revealAutoEnabled`(預設開)+ `revealIntervalMs`、`tiers.json` 模板索引定位(`locatePanel`)與判定(≥ 2 行像詞綴)、送全部行、有 `ocrRegion` 時區域優先且連續 2 次沒面板退回自動定位(區域畫面**大幅**變了、或還沒找到面板且 ≥ 2 秒沒看區域才回來,事件 `fallback`)、**查價面板開著不暫停**;事件 `reveal-scan-result`、IPC `reveal-stats`;`hotkeyOcrReveal` 改為暫停 / 繼續;與符文共用 WinOcr(對方忙碌丟 tick、符文首 tick 延後半個間隔)。**排程與退避(效能修正第 6 步)**:大幅變化 = 8×8 小塊最大差(平均 ≥ 6 或變動 ≥ 0.15,真實截圖推導)→ 一律立即 OCR / 定位;手動區域沒面板時小變化 OCR 退避(× 2 遞增、上限 2.5 秒);自動定位連續沒找到退避 3 → 6 → 12 → 15 秒、client 沒變不定位、15 秒保底;兩個掃描共用 `SharedLocateOcr`(1 秒內整個 client ×1 只跑一次);tick 進入即設 `ticking`;相同 `rows` 10 秒內不重送(狀態轉換照送),renderer `scan-dedupe.ts` 同一份列不重算。徽章 `OcrBadges.vue` 跟著事件持續更新(empty / inactive / 暫停才清,沒有 15 秒 TTL / 再按清除)。舊 `RevealOcr` / `ocr-reveal-result` 已移除。**設定頁(2026-10-01 使用者要求對等)**:褻瀆與符文兩張卡片共用 `settings/OcrScanSection.vue`(啟用、目前狀態、掃描間隔 100–3000 ms 且 < 500 顯示 CPU 提示、區域 + 框選 / 清除、暫停 / 繼續熱鍵、框選區域熱鍵、最近耗時;專屬:褻瀆 OCR 語言包、符文台服提示 / 顏色門檻),四個辨識熱鍵從通用熱鍵卡片移入各自卡片,衝突提示走 `settings/useHotkeyIssues.ts`(涵蓋全部熱鍵,聊天指令分頁共用);褻瀆的手動比例欄位已移除(`ocrRegion` 舊值照讀) | 見 `docs/reveal-ocr.md`「自動持續辨識」「設定頁(與符文塑形對等)」;測試 `main/test/reveal-scan.test.ts`、`renderer/test/reveal-scan.test.ts`;泛化後符文行為不變(`runeshape-scan.test.ts`) |
| `main/src/ocr/` + `poe2/src/desecration/ocr-match.ts` + `renderer/src/web/overlay/{OcrBadges.vue,ocr-reveal.ts}` | 靈魂之井三選一揭露面板 OCR(WP-S;以下為 2026-09-30 單次辨識時的描述,觸發方式已改為上一列的自動辨識):`win-ocr.ps1`(常駐 PowerShell 5.1 + WinRT OCR,esbuild text loader 內嵌)、`WinOcr.ts`、`capture.ts`(整個螢幕 desktopCapturer → 裁 client → 放大 → JPEG)、`reveal.ts`(廣播 `ocr-reveal-result`)、`selftest.ts`(`--ocr-selftest`);比對在 renderer(`@poe2-entry` 的 `matchRevealLines`);熱鍵 `hotkeyOcrReveal` 預設 `Ctrl + Shift + R`,只在 overlay + PoE2 註冊。WP-S2 框選辨識區域:`renderer/src/web/overlay/{OcrRegionPicker.vue,region-geom.ts}`(在遊戲畫面上拖曳 → `ocrRegion` client 比例 → `focus-game` → 150 ms 後 `ocr-reveal-now`)、`strategy.ts` `recognizeRegionFirst`(優先區域、命中 < 2 退回整張,`stage` `region` / `region-fallback`)、`shortcut-actions.ts`(熱鍵動作表純函式;`hotkeyOcrRegion` 預設空)、IPC `overlay-activate` / `ocr-reveal-now`(`preview: false`)、事件 `ocr-region-pick` | 見 `docs/reveal-ocr.md`;`WinOcr.ts` 只用可抹除 TS 語法(`scripts/ocr-fixture.mjs` 以 Node 型別剝除直接 import);快照 `poe2/test/desecration/fixtures/ocr/*.ocr.json` 由 fixture 腳本產生 |
| `main/src/ocr/{runeshape-scan,runeshape-selftest}.ts` + `poe2/src/runeshape/{row-format,match-core,match}.ts` + `renderer/src/web/overlay/{RuneshapePrices.vue,runeshape-view.ts}` + `renderer/src/web/background/price-of.ts` | PoE2 符文塑形面板自動查價(WP-R2,計畫 `wise-seeking-hippo.md`,規則全文 `docs/runeshape.md`):main 掃描迴圈(`runeshapeEnabled` + PoE2 + overlay + 遊戲前景;**有框 `runeshapeRegion` 優先用它(沒找到面板不改掃全畫面,設定頁顯示「區域內沒找到面板」),沒框就自動定位**:沒快取時每 3 秒最多擷取一次(連續沒找到退避到 15 秒,見上一列「排程與退避」)整個 client ×1 → `locateRunePanel`(≥ 2 列面板列、右緣對齊)→ 外擴框記憶體快取(鍵 = client 大小 + 擷取偏移),連續 5 次框內沒面板列清快取;每 `runeshapeIntervalMs` 100–3000(2026-10-01 下限由 500 放寬)擷取 → 區域寬 64 灰階縮圖差分,沒變不 OCR → 共用 `WinOcr` ×3(直書 `looksVertical` → ×1 找列 + 只裁面板列重辨識並記住),揭露面板忙碌就丟 tick;沒有任何 `isPanelRow` 的結果當成沒有列;連續 2 次無列送空結果)→ 事件 `runeshape-scan-result`(不進 `PREVIEW_EVENTS`)→ renderer `matchRunesRows`(前綴限定 namespace:`技能等級N:` / `技能:` → 技能寶石、`輔助:` → 輔助寶石、`Nx` / 無前綴 → ITEM;items.ndjson 繁中名精確 → 模糊 0.85(數字須相同)→ 類別優先序,無法唯一 = ambiguous 不查價;技能 / 輔助寶石 poe.ninja 沒有 → 自動查市集;面板外的列、「未發現」列(`isUndiscoveredRow`,只認繁中)不畫)→ `priceOf`(`currency\|<refName>`)→ 徽章(崇高石計價、≥ 1 div 改神聖石、數量 > 1 總價 + 單價、三段顏色 `runeshapeThresholds`)。renderer 以 `runeshape-ui-state` 回報查價面板 / 設定 / 框選層開著 → 暫停;選用熱鍵 `hotkeyRuneshapeToggle`、框選熱鍵 `hotkeyRuneshapeRegion`(2026-10-01,皆預設空;後者 main 動作 `runeshape-region` → `ocr-region-pick` 帶 `{ target: 'runeshape' }`)。框選沿用 `OcrRegionPicker.vue`(`ocr-reveal.ts` `REGION_PICKER_SPECS` 參數化,不帶 target = 揭露面板)。`--runeshape-selftest <png> [--runeshape-selftest-region=x,y,w,h]`(自動定位 + 手動區域兩條路,印耗時、定位框、每列比對與錄製檔價格) | 台服沒有 poe.ninja → 全部走市集查詢 + 一次提示;**自動查市集**(`poe2/src/runeshape/trade-lookup.ts` `createRuneTradeQueue` + `runeshape-view.ts` `runeTradeBadge`,docs/runeshape.md「自動查市集」;2026-10-01 取代舊的 Shift+Space 點選模式 —— **overlayKey 一律開設定、徽章整層點擊穿透,不要再加可點模式**):無 ninja 價的可查列自動排入單一佇列(同時一筆、30 分鐘記憶體快取、重複不重排、每筆最多 1 search + 1 fetch / 1 exchange),查詢**必帶與產物相符的篩選**(gem:`misc_filters.gem_level` min = max、`misc_filters.corrupted` false、`type_filters.quality` max 0;有 tradeTag 的物品走 bulk);**不影響一般查價**:送出前 `runeTradeWaitMs` 預估要等就延後(不進限流器佇列)、查價面板 / 設定開著暫停(App.vue `runeshapeTradeHold`)、429 整個佇列暫停(佇列用原始 `Host.proxy` + `withRuneTrade429`,一般查價的 `rateLimitWait` 也 `pauseFor`)、面板消失 `clearPending`;徽章 `市 … · L20` → `市 查詢中` → `市 80 崇高 · L20`(< 3 筆最低價 + 「少」),完整篩選寫 log,台服原幣;錄製回應 `poe2/test/runeshape/fixtures/trade/`(已剝帳號 / 角色名);不送任何輸入;`row-format.ts` / `match-core.ts` 零依賴(main 經 esbuild 打包,只准相對路徑);名稱只用 repo 資料、不自行翻譯;測試 `main/test/runeshape-scan.test.ts`(假時鐘,含自動定位 / 快取 / 失效 / 直書)、`poe2/test/runeshape/`(兩張真實截圖快照 `fixtures/ocr/*.ocr.json`,`node scripts/ocr-fixture.mjs --set runeshape` 產生)、`renderer/test/runeshape-*.test.ts` |
| `data/poe2/desecration/` | `tiers.json`(profiles / entries / diagnostics)、`base_profiles.json`(refName → profile);`scripts/build-desecration-tiers.mjs` 由 PoB2 portable `Data/*.lua` + `data/poe2/*/stats.ndjson` 產生 | 不手改;MANIFEST `commit` = PoB2 `manifest.xml` 裡 `ModVeiled.lua` 的 sha1 |
| `data/poe2/runeshape/` | `recipes.json`:符文塑形配方結果泛稱(GGPK `expedition2recipes` Description,29 筆;`zhPlain` / `enPlain` 已剝 `[Rarity|X]`);`scripts/sync-runeshape-data.mjs` 由 pob-zh-engine 本機 GGPK 抽取表產生 | 不手改;MANIFEST 記 `fetchedAt` = 抽取時間 + game_version + 來源檔 sha256(來源在 gitignored `tools/`,沒有 commit) |
| `renderer/src/web/regex/` | Poe Regex UI(`RegexPanel/RegexList/RegexBookmarks.vue`、`store.ts`);書籤與勾選存 `userData/regex_state.json`(main tmp + rename) | UI 用的純邏輯放 `regex/src/view.ts`(有 vitest) |
| `renderer/src/web/{feedback,report}.ts` | 一鍵回報:組 issue 標題/內文 → 開預填的 `issues/new`;網址 > 6000 字元改只帶標題、全文進剪貼簿 | 不自動上傳;不含 accountName |
| `regex/` | `@exile-appraiser/regex`:`gen/data/state/rng/view.ts` 逐函式移植 PobTools `host/regex_gen.cpp` 等(純 TS,可在 renderer 與 Node 跑)、`node.ts`(讀檔)、`cli.ts`;資料 `data/regex/regex_poe{1,2}.json`(schema 2:`labels`、頁 `kind`)。WP-C 自寫:`numeric.ts`(數值範圍 → 最短正則)、`pages/`(演算法頁 `map_numeric` / `waystone_numeric` / `vendor_items` / `vendor_items_poe2`)、`combine.ts`(多頁合併 + 聯集 Verify)、`share.ts`(分享碼 gzip+base64url)、`scripts/gen-labels.mjs` | renderer 不得 import `@exile-appraiser/regex/node`;對應表與已知差異見 `docs/regex-port.md` |
| `main/` | Electron main + preload:熱鍵(`Shortcuts.ts`,globalShortcut + uiohook Ctrl+C)、uiohook 全域掛鉤開關 `uiohook-gate.ts`(2026-10-01 效能修正:不在啟動時 start,只在 `WidgetAreaTracker` 追蹤查價面板期間 acquire,歸零 5 秒後 stop,結束 / 重新啟動 `shutdown()` 強制停;`keyTap` / `keyToggle` 走 `SendInput` 不需要掛鉤,window 模式從不 start;測試 `main/test/uiohook-gate.test.ts`)、`windowing/`(照 APT 的 overlay:`electron-overlay-window` 附著遊戲視窗、WidgetAreaTracker、`GameDetector` 自動切換;**APT 的 OverlayVisibility(按住 Alt 隱藏 overlay)2026-10-01 使用者裁定移除、不留開關**;`--window` / `overlayMode:false` 為獨立視窗備援)、`AppUpdater.ts` + `updater-core.ts`(electron-updater,GitHub Releases;自動下載、結束時套用)、`tray-strings.ts`(托盤選單雙語字串,跟 `uiLanguage`)、剪貼簿輪詢、session fetch(帶 Cloudflare cookie)、設定檔、`app://` 協定。外部網址規則 `external-links.ts`(有測試):IPC `open-external` 只收 http(s);主視窗與驗證視窗 `setWindowOpenHandler` 一律 deny、http(s) 轉系統瀏覽器(不讓 Electron 自開沒有登入狀態的新視窗);主視窗 `will-navigate` 非 app 頁面攔下並轉系統瀏覽器 | session fetch(`http.ts` `ALLOWED_HOSTS`)只准 www.pathofexile.com / pathofexile.tw / poe.ninja;更新檢查由 electron-updater 直連 github.com |
| `renderer/public/brand/{icon,tray}.svg` | app 圖示來源 → `npm run build-icons`(sharp,冪等)產生 `renderer/public/icon.{png,ico}`、`tray-*.png`;`electron-builder.yml` `win.icon` 指向 `icon.ico` | 改圖只改 SVG 再重跑,不手改 png/ico |
| `data/dust/` | `poe-dust.json`(poe-disenchant-tool `data/dust/poe-dust.js` 逐筆轉 JSON,`scripts/sync-dust-data.mjs`) | 不手改;goldCost / slots / 固有勢力只從這裡取 |
| `data/regex/` | `regex_poe{1,2}.json`(PobTools 單向同步)、`labels.poe{1,2}.json`(clientstrings 暫代標籤,`regex/scripts/gen-labels.mjs`,只補資料檔缺鍵)、`templates.json`(內建範本,手寫) | 三者在 MANIFEST 各自一個前綴 |
| `data/poe1/`、`data/poe2/` | 資料檔,**逐位元組來自 apt-patched / ee2-patched**(poe2 的 `*.index.bin` 由 `make-index-files --game poe2` 產生);`data/poe2/trade/` 是 GGG `/api/trade2/data/{stats,items}` 兩區快照(parser 後援用 intl);`data/MANIFEST.json` 每個前綴一個來源(commit 或 fetchedAt)+ sha256 | 不在這裡改資料 |
| `scripts/` | `sync-data-from-apt.mjs`(`--game poe1|poe2`)、`sync-regex-data.mjs`、`sync-runeshape-data.mjs`、`sync-dust-data.mjs`、`dust-crosscheck.mjs`(→ `docs/dust-crosscheck.md`)、`fetch-poe2-trade-data.mjs`、`check.mjs`(CLI 依 `--game` 轉 workspace)、`verify-data-manifest.mjs`、`make-index-files.mjs`、`verify-datasets.mjs`、`check-user-agent.mjs`、`build-icons.mjs`、`make-fake-update-feed.mjs`(更新器離線驗證)、`make-local-update-test.mjs`(兩個真安裝檔 + 本機 feed 的端到端更新實測,產物在 gitignored `.local-update-test/`) | |
| `docs/` | `poe2-port-notes.md`(PoE2 移植紀錄)、`game-auto-switch.md`(PoE1/PoE2 自動切換)、`regex-port.md`(Poe Regex 移植、資料同步、WP-C 演算法頁/合併/分享碼/範本)、`dust-tool.md`(拆粉公式/資料/排行)、`dust-crosscheck.md`(產生的交叉比對報告,勿手改)、`release-flow.md`(發版 + 自動更新)、`browser-preview.md`(瀏覽器預覽:用法、同步、安全模型、協定)、`desecration-tiers.md`(褻瀆 Tier 資料表與推定、PoE2 複製鍵)、`reveal-ocr.md`(靈魂之井揭露面板 OCR;2026-10-01 起自動持續辨識)、`chat-commands.md`(聊天指令與倉庫搜尋熱鍵:按鍵序列、保留鍵、註冊條件)、`ninja-poe2.md`(poe.ninja PoE2 exchange 回應格式、exalted 匯率、快照 schema 2)、`runeshape.md`(符文塑形面板:列格式、名稱比對、價格對應、手動 / 自動定位與快取、耗時)、`phase5-summary.md`、`phase2-summary.md`、`phase3-summary.md`、`phase4-summary.md`(各工作包摘要與已知限制) | |

**PoE1 / PoE2 切換 = 寫 config.json 的 `game` + 自我重新啟動,不是換綁**:`electron-overlay-window` 原生碼 `windows.c:176`
用 `strcmp` 精確比對單一視窗標題,`attachByTitle` 每行程只能呼叫一次。`GameDetector` 每 2 秒看視窗清單,
目前遊戲不在、另一款在連續 2 次才切;overlay 模式下手動切 game / 改該遊戲標題 / 改 overlayMode 也立即重新啟動。詳見 `docs/game-auto-switch.md`。

## 必守規則
1. **資料只單向同步,不在本 repo 產生**:`npm run sync-data -- --from ../apt-patched`、`npm run sync-data -- --game poe2 --from ../ee2-patched`(會拒絕來源有未 commit 變更)→ 自動重寫 MANIFEST 該前綴。PoE2 交易站快照:`node scripts/fetch-poe2-trade-data.mjs`(新賽季重跑)。
   `npm test` 第一步就是 `verify-data`;MANIFEST 不符一律紅。改行尾/改 ndjson 必重跑 `make-index-files`(byte offset 索引)。
2. **語言無關鍵對接**:詞綴送 trade stat id、物品名送 `refName`(intl)或 `name`(tw)。`items` 端點沒有 id,**禁止位置對位**。
3. **realm 模型**:`intl` = `www.pathofexile.com` + 英文名;`tw` = `pathofexile.tw`(裸 host)+ 繁中名。`useIntlSite` 由 realm+language 推導,不是開關。
   `TradeClient` 狀態(限流、快取)每個 realm 各一套(`tradeSession(realm)`)。
4. **版號與 User-Agent**:版號用 `0.x.y` 語意版號(v0.1.0 起),root、`main/` 與各 workspace 的 `version` 保持一致。
   Electron 把 `exile-appraiser/<version>` 寫進 User-Agent;GGG 的 Cloudflare 擋過舊版 Awakened PoE Trade 的產品名+版號
   (`awakened-poe-trade/0.1.0` 403),但本產品名 0.1.0 / 0.1.1 / 3.29.0 實測皆 200(2026-09-30)——「major.minor 必須等於遊戲版本」是從 APT 照搬、**不適用本專案**。
   **發版前跑 `npm run check-user-agent`**(以實際 UA 打 GGG 驗 200);遊戲改版或 GGG 政策改變時重驗。
5. **匿名查詢**:沒有 POESESSID、沒有登入。Cloudflare cookie 靠內建瀏覽器視窗(`openCaptcha`)解一次,與 `session.fetch` 共用。
   **給使用者看的交易站網頁一律開系統瀏覽器**(`trade-site.ts` `openTradeSite` / `Host.openExternal`,使用者在那裡已登入);`openCaptcha` 只給「開啟驗證視窗」。
6. **移植檔只切耦合點**,每處加 `// exile-appraiser:` 註解。已切的:
   - `poe1/src/assets/data/index.ts`:fetch/import.meta → `configureDataSource(DataSource)`
   - `poe1/src/web/price-check/trade/common.ts`:Vue/AppConfig → `createRateLimitRules` / `tradeSession(realm)` / `adjustRateLimits(..., latencySeconds)`;`activeTradeContext()` 由 shell 注入
   - `pathofexile-trade.ts` / `pathofexile-bulk.ts`:`Host.proxy` → `ctx.http`,函式第一個參數是 `TradeContext`
   - `core/src/http/RateLimiter.ts`:去 Vue,`queue = { value }`,`subscribe()`
   - `poe1/src/web/background/Leagues.ts`、`trade/{RateLimiter,Cache}.ts`:轉接殼
   - `.vue` 元件的改動見各檔頭 `exile-appraiser:` 註解
   - PoE2(`poe2/`)的完整清單見 `docs/poe2-port-notes.md`;`poe2/test/src-coupling.test.ts` 擋 src 再 import `@/web/Config` / IPC / `import.meta.env`
7. **未解析詞綴不丟棄**:`unknownModifiers` 一律顯示(UI 的 UnknownModifier、CLI 的 ⚠ 清單)。
8. Windows 環境:寫含中文的檔案用 Write/Edit,不用 PowerShell 讀改寫;spawn Electron 前移除 `ELECTRON_RUN_AS_NODE`(build/script.mjs 已做)。
9. **介面語言 `uiLanguage` ≠ 客戶端語言 `language`**:`language` 決定資料集與剪貼簿解析(切換要重載資料);`uiLanguage`(`cmn-Hant|en`)只換 UI 字串與托盤選單,不重載資料。新增 UI 字串兩語系都要補(`renderer/src/i18n/{cmn-Hant,en}.json` 的 `ppz.*`;托盤在 `main/src/tray-strings.ts`)。
10. **主題 token 來自 PobTools `app.css`**(`renderer/src/theme/pobtools.css`);Tailwind 的 gray 色階等是指向 token 的別名,**移植的 poe1/poe2 `.vue` 不改 class**;要改色改 token。淺色主題下 tooltip 維持深色島。
11. **Regex 資料只單向同步**:`node scripts/sync-regex-data.mjs --from ../pob-zh-engine`(來源 `dist/Data/regex_poe*.json`,必須與 `host/data` 已提交版本逐位元組相同;PobTools 未 commit 時只能 `--allow-dirty`,MANIFEST 會記 `dirty: true`)→ 重寫 MANIFEST `data/regex`。不在本 repo 改 regex 資料;演算法改動要與 C++ 版同步並對 `regex/test/golden/` 比對。
12. **更新器**(2026-09-30 使用者裁定改為自動):設定 `autoUpdate`(預設開)+ 安裝版 = 背景自動下載、**正常結束程式時靜默套用**(`autoInstallOnAppQuit`),
    關於頁另有「立即重啟並更新」(`quitAndInstall(true, true)`);`autoUpdate` 關 = 手動下載 / 安裝;portable 只導去 Releases。狀態機與旗標規則在 `main/src/updater-core.ts`(有測試)。
    ⚠ electron-updater 只在**下載完成那一刻** `autoInstallOnAppQuit` 為 true 才註冊 quit handler,下載完成前旗標必須維持 true。
    無輸入控制:第二個行程帶 `--quit`(= 托盤「結束」)/ `--install-update`(= 立即重啟並更新)轉交主行程(`second-instance`)。
    本機真安裝檔實測:`scripts/make-local-update-test.mjs`(docs/release-flow.md「本機實測」)。`electron-builder` 永遠 `-p never`;發版照 `docs/release-flow.md`,**使用者說「發」才 `gh release create`**。
    發版紀錄:v0.1.1 為線上更新測試版,已撤下(Release / tag 刪除,版號還原為 0.1.0 重新發佈)。Release 建立後約 1 分鐘內 GitHub `releases/latest` 可能仍回舊版。
    **啟動提示**(`main/src/startup-toast.ts` 純邏輯有測試 + `main.ts` `showStartupToast`):第一次收到 Electron 視窗的 host-config 時在主螢幕工作區右下角顯示約 3 秒
    (不搶焦點 `showInactive`、點擊穿透、data URL 無腳本);`userData/last_run.json` 的 `lastRunVersion` 較舊 = 更新後第一次啟動 → 顯示「已更新至 vX」。
    設定 `startupToast`(一般分頁,預設開);控制參數 / `--preview` / 預覽端 / 第二實例 / selftest 不顯示;`--toast-selftest <png>` 只截自己的 webContents(docs/release-flow.md「啟動提示」)。
13. **一鍵回報不含 accountName**(`feedback.ts` 也會遞迴剝掉 account/token/cookie 類鍵);只開預填網址,不自動上傳。
14. **派工/驗證禁止合成鍵盤/滑鼠輸入**(SendInput、uiohook 模擬、PowerShell SendKeys 等):GUI 行為由使用者實測,自動驗證只用 log、DOM 錨點、`--window` 無輸入啟動。
    聊天指令 / 倉庫搜尋(`text-box.ts`)在執行期會對遊戲送鍵,**驗證只准注入假 keyTap / 假剪貼簿的單元測試**,不得為了驗證真的觸發。
15. **poe.ninja 只有國際服**:只在 `realm === 'intl'` 抓;價格表快照 15 分鐘 TTL(`userData/cache/ninja/`),同一執行抓過後 31 分鐘才更新,且最近 20 分鐘有人查價才上網。
    自動驗證/測試**只用錄製檔**(`core/test/recordings/ninja/`),不為了測試真的打 ninja。
16. **Regex 資料 schema 2**:`labels{zh,en}` 以資料檔為準,`data/regex/labels.poe*.json` 只補缺鍵(`regex/scripts/gen-labels.mjs` 從 PobTools clientstrings 以**鍵**取值);
    `templates.json` 手寫,鍵必須在資料檔 / 演算法頁找得到(測試擋)。演算法頁、合併、分享碼全部自寫,**不參考 poe.re 原始碼**(無 LICENSE)。
17. **拆粉基數以 APT `unique.disenchantValue` 為主**;poe-dust 只補 `goldCost` / `slots` 與排行的**固有勢力**(`inherentInfluencesFromPoeDust`:只接受 n=1/2 且 q0、q20 兩欄恰好吻合),不覆寫 disenchantValue。
    單件查價有物品文字,勢力照 parser;資料同步後重跑 `node scripts/dust-crosscheck.mjs` 並更新 `core/test/dust.test.ts` 的統計。
18. **瀏覽器預覽伺服器只綁 `127.0.0.1` + 每次啟動隨機 token(`/t/<32 hex>/`,錯一律 404)+ `Host` 必須正好是 `127.0.0.1:<port>`(否則 421)**,跨站 `Origin` 403。
    RPC 權限不得多於 Electron renderer(`http-fetch` 仍受 `ALLOWED_HOSTS`);`item-text` 不送預覽(避免重複查價)。
    **預覽端改遊戲 / 視窗標題 / overlayMode 不 relaunch**,只回 `needsRestart: true` 顯示「下次啟動才生效」(overlay 綁定只能在啟動時做)。
19. **褻瀆 Tier:進階複製以遊戲給的為準(不動);一般複製是推定,UI 一律標「推定」**(候選多個就列候選、範圍外不硬給)。
    **PoE2 的複製鍵是 `Ctrl + Alt + C`**(進階格式;`Shortcuts.ts` `copyItemHotkey`),PoE1 維持 `Ctrl + C`。
20. **PoB2 資料版本鎖 = portable `manifest.xml` 的逐檔 sha1**:`build-desecration-tiers.mjs` 驗證磁碟檔與 manifest 相符才產生(`--allow-mismatch` 只給本機實驗);
    輸出不含時間戳、可逐位元組重現;profile id(`p000…`)隨 PoB2 版本漂移,不得存到資料檔以外的地方。
21. **揭露面板 OCR 不送任何輸入、不上傳**:自動辨識只截圖 + 本機 Windows OCR;`reveal-scan-result` 不進 `PREVIEW_EVENTS`;
    OCR 腳本只有 `main/src/ocr/win-ocr.ps1` 一份(runtime 內嵌、fixture 工具讀同檔);比對結果一律標出 profile 不精確(「?」)與模糊命中(「≈」),對不上的行顯示原文。
    **框選區域(WP-S2)只在 overlay 的無頭頁面 / 假 host 驗證**(CDP `Input.dispatch*` 只作用於無頭頁面);`ocrRegion` 一律存 client 比例,main 以 client 尺寸換算再減擷取偏移;
    區域內沒找到面板必須退回整張並提示,不能靜默失敗;`ocr-region-pick` 不進 `PREVIEW_EVENTS`。

## 指令
```bash
npm install                      # 一次裝完四個 workspace(含 Electron)
npm test                         # verify-data + poe1 vitest + poe2 vitest(parser 回歸網 + realm golden query + 離線交易層)
npm run typecheck                # core / poe1 / poe2(tsc + vue-tsc)/ renderer(vue-tsc)/ main
npm run check -- <物品.txt> [--game poe2] --realm both [--online]   # 無頭驗證:兩區 payload / 端點 / 網頁網址;--online 真的打(可能被 CF 擋)
npm run cli --workspace regex -- --game poe1 --page map_mods --lang zh --mode any --random 7,5   # Regex 無頭產生 + Verify(--list 列頁面)
node scripts/sync-regex-data.mjs --from ../pob-zh-engine   # Regex 資料單向同步(PobTools host/data 有未提交變更時加 --allow-dirty,MANIFEST 記 dirty: true)
node scripts/sync-runeshape-data.mjs --from ../pob-zh-engine   # 符文塑形配方結果 → data/poe2/runeshape/recipes.json + MANIFEST(來源 tools/ggpk2_zh/out/poe2/tables/expedition2recipes.json;新賽季重抽 GGPK 後重跑)
node regex/scripts/gen-labels.mjs --from ../pob-zh-engine  # Regex 暫代標籤 data/regex/labels.poe*.json(clientstrings,以鍵取值)
node scripts/sync-dust-data.mjs --from <poe-disenchant-tool clone>   # 拆粉資料 data/dust/poe-dust.json + LICENSE + MANIFEST
node scripts/dust-crosscheck.mjs                            # APT vs poe-dust 交叉比對 → docs/dust-crosscheck.md
npm run build-icons              # brand/*.svg → icon.png/ico、tray-*.png(冪等,重跑 hash 不變)
npm run dev:renderer             # Vite 5173(純瀏覽器只能看 UI)
npm run dev:main                 # esbuild watch + 啟動 Electron(需先起 dev:renderer)
npm run dev:main -- --window --preview --no-updates   # 另開瀏覽器預覽,log 印 `[preview] --preview:<網址>`(預覽供應已 build 的 renderer/dist)
node scripts/build-desecration-tiers.mjs --from ../pob-zh-engine/dist/PathOfBuildingCommunity-PoE2-Portable/Data   # 褻瀆 Tier 資料表 → data/poe2/desecration + MANIFEST
node scripts/ocr-fixture.mjs     # WP-S:fixtures/ocr/*.{webp,png} → *.ocr.json 快照(需 Windows + zh-Hant-TW OCR 語言包)
node scripts/ocr-fixture.mjs --set runeshape   # WP-R2:poe2/test/runeshape/fixtures/ocr(整張 ×3 + 定位段 ×1 + 定位框 ×3);--set all 兩組都跑
npx electron main/dist/main.js --runeshape-selftest <png>   # WP-R2:自動定位 + 手動區域兩條路的耗時、定位框、每列比對與錄製檔價格
npx electron main/dist/main.js --ocr-selftest <png>   # WP-S:無視窗跑 prepare + WinOcr,印行與耗時(先 build main、清 ELECTRON_RUN_AS_NODE)
npm run package                  # 先 build(renderer/dist + main/dist)再 electron-builder(nsis + portable),-p never;產物見 docs/release-flow.md
UPDATE_FIXTURES=1 npm test       # 改寫 parser / golden-query 快照;產出必人工 review
```

## 發版 checklist
1. 改 root、main 與各 workspace 的 `version`(`0.x.y`)→ `npm run check-user-agent`;更新說明寫在 `docs/release-notes/v<version>.md`。
2. `npm run sync-data -- --from ../apt-patched` → `npm test` 全綠(快照差異逐筆 review)。
3. `npm run typecheck` → `npm run package` → 乾淨機器裝一次:熱鍵 → 列表;intl / tw 各查一件真實物品。
4. 產物內含 `LICENSE.txt`、`NOTICE.md`、`LICENSES/`;`latest.yml` 的 `path` = `ExileAppraiser-Setup-<version>.exe`。GitHub Release 由 `gh release create` 手動建(electron-builder 永遠 `-p never`),四個檔與步驟見 `docs/release-flow.md`。
5. 發版前必先讓使用者確認;`git push` 也算對外動作。

## 測試守則
- `poe1/test/parser-fixtures`:真實繁中剪貼簿 → ParsedItem 快照(上游移植,86 項)。
- `poe1/test/golden-query`:同一件物品 intl / tw 兩份查詢;不變式:intl 名稱全 ASCII、tw 含 CJK 或語言無關 id、stat id 集合相同、其餘結構相同、`?q=` 有 encode。
- `poe1/test/trade-client`:離線 HttpFetch:host、POST JSON、10+10 分批、快取鍵含 realm、`X-Rate-Limit-*` 對齊、error.message、429 Retry-After。
- `poe2/test/`:E 的 `renderer/specs/`(zhTW 回歸網 14 組 fixture、`KNOWN_STAT_GAPS` 棘輪)+ `golden-query`(快照在 `test/golden-query/`)+ `trade-client`(`/api/trade2/*`)+ `src-coupling`。
- `regex/test/`:合成 T1–T16 + 資料性質測試(兩遊戲 × 兩語言 × 各頁),基準抽自 PobTools `dist/regex_selftest.txt`(`test/golden/selftest-report.json`)。
- `core/test/`:`ninja.test.ts`(錄製的 poe.ninja 回應 `recordings/ninja/`;PoE2 exchange 在 `recordings/ninja/poe2/`)、`dust.test.ts`(公式金標、交叉比對統計、排行含固有勢力)。
- `regex/test/` 另有 `numeric`(0–999 逐值)、`pages`、`combine`、`share`(含範本鍵可還原)、`state` 測試。
- `renderer/test/`:`feedback.test.ts`(回報網址/剪貼簿路徑/剝帳號鍵)、`trade-site.test.ts`(交易站開啟方式、舊 `dustDockRatio` 相容)等純函式測試。
- `main/test/external-links.test.ts`:`open-external` 只收 http(s)、主視窗導覽放行 / 攔截規則。
- `main/test/preview-server.test.ts`:預覽伺服器(token 404 / Host 421 / Origin 403、防穿越、boot script、RPC 往返、SSE 續傳、自動關閉),純 Node。
- `poe2/test/desecration/`:資料表統計與 poenavi 抽樣逐欄比對(`build.test.ts`)、推定(`infer.test.ts`,含三件真實物品的進階 vs 一般複製)、
  揭露面板 OCR 比對(`ocr-match.test.ts`:真實截圖快照、394 模板 round-trip、模糊、分組)。`renderer/test/ocr-reveal.test.ts` 測徽章座標與文字;`renderer/test/region-geom.test.ts` 測框選幾何(WP-S2)。
- `main/test/updater-core.test.ts`:自動更新狀態轉移(假 updater 模仿 electron-updater 下載完成才註冊 quit handler)、`autoUpdate` 開關、portable / `--no-updates` / 開發模式、錯誤分類。
- `main/test/startup-toast.test.ts`:啟動提示是否顯示、更新後首次(版本比較 / `last_run.json`)、訊息組字(熱鍵、兩語)、HTML 跳脫與 CSP、位置;`renderer/test/startup-toast-config.test.ts`:`startupToast` 設定往返。
- `main/test/ocr-strategy.test.ts`:兩段式路徑、WP-S2 區域換算(client / 擷取偏移)與「優先區域、失敗退回整張」、快取清除;`main/test/shortcut-actions.test.ts`:熱鍵註冊條件。
- `poe2/test/runeshape/trade-lookup.test.ts`:符文塑形自動查市集的查詢組法(intl / tw 名稱、篩選清單)、錄製回應回放(search / fetch / exchange)、中位數規則、429 偵測、佇列(假時鐘 + 假 http:同時一筆、快取命中不重送、重複不重排、限流需等待延後、fetch 前延後、429 整個暫停、面板消失清佇列、查價面板開著暫停、失敗 5 分鐘不重排);`renderer/test/runeshape-trade.test.ts`:哪些列查市集、「未發現」不畫、市價換算與顯示、徽章文字(含篩選短字)。
- GUI(熱鍵、Cloudflare、真實掛單)由使用者實測;不得宣稱已驗。

## 剩餘待辦(Phase 4 完成後)
Phase 2 / 3 / 4 各工作包的摘要與已知限制見 `docs/phase2-summary.md`、`docs/phase3-summary.md`、`docs/phase4-summary.md`。
- **OCR 三選一揭露面板(WP-S)**:已實作(`docs/reveal-ocr.md`、`docs/phase5-summary.md`);**待使用者親測**真實遊戲擷取(視窗化 / 無邊框 / 全螢幕)與徽章位置;只有一張真實截圖,需要更多(武器 / 珠寶、折行、其他解析度)補 fixture。
  **WP-S2 在遊戲畫面上框選辨識區域**已實作(`docs/reveal-ocr.md`「框選辨識區域」);**待使用者親測**真實 overlay 焦點切換、框選後自動試辨識、區域路徑耗時與退回整張提示。
- **自訂「顯示進階詞綴」鍵**:照 EE2 讀 `poe2_production_Config.ini` 的 `show_advanced_item_descriptions`;目前固定送 `Ctrl + Alt + C`,改過鍵的玩家會拿到一般格式 → 走推定。
- **poe.ninja Map 類沒有 `mapTier`**:地圖類價格無法依階級對上,目前不處理。
- **待使用者親測(Phase 4)**:PoE2 `Ctrl + Alt + C` 是否讓 Alt 卡住;overlay 下預覽改遊戲不重啟(見 `docs/phase4-summary.md`)。拆粉排行 2026-09-30 移進設定視窗(停靠已移除),待使用者親測設定視窗內的觀感與「交易 ↗」開到已登入的系統瀏覽器。
- **待使用者實測**:Regex 商店頁插槽 `R-G-B` 在繁中客戶端的寫法、寶石等級行首錨定 `^等級`、各屬性行分隔字元(`：` / `: ` / 空白)與「+」;拆粉排行與單件拆粉在真實聯盟的觀感。
- **PobTools 端**:`host/data/regex_poe{1,2}.json`(schema 2 + 新頁)**尚未 commit**,本 repo 以 `--allow-dirty` 同步(MANIFEST `data/regex` 帶 `dirty: true`);PoE1 既有兩頁 `max_stats` 維持 6(改 8 會替 3 行補上隱藏文字)——commit 與 6→8 都等使用者決定,commit 後不帶旗標重跑同步。
- PoE2 的 poe.ninja 參考價(`poe2/src/web/background/Prices.ts` 仍是「沒有價格」;renderer 殼的 `priceOf` 已可用,目前只接符文塑形自動查價)。
- **符文塑形自動查價(WP-R2)**:§1–§5 與區域自動定位已實作(`docs/runeshape.md`;§2 以兩張真實繁中截圖定案)。**待使用者親測**:真實擷取、CPU、
  自動定位在真實 client(2560×1440 / 4K、其他 UI 縮放)的準確度與耗時、面板捲動 / 列數變化時的重新定位。只有兩張截圖(1 倍縮放);
  英文客戶端的前綴寫法未確認;`維里西姆堆` 不在 items.ndjson(對不上);技能 / 輔助寶石 poe.ninja 沒有價格(自動查市集)。
  **自動查市集待使用者親測**:真實遊戲中徽章自動變「市 …」→「市 X」、與一般查價同時使用時是否受影響、Shift+Space 開設定
  (自動驗證只在無頭頁面 + 錄製回應 + 假時鐘);「未發現」只認繁中,英文客戶端字串未確認。
- Regex 逐字 golden:需在 PobTools 端(`pob-zh.exe --regex-selftest`)加匯出固定勾選集 `Build().query` 的旗標(另開 PobTools 任務)。
- 台服 + 英文客戶端組合驗證後解禁(`isSupportedCombination`)。
- commit / push / 發版逐項等使用者指示。
