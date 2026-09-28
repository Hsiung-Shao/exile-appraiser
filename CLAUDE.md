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
| `core/src/ninja/` | poe.ninja 價格源(WP-A):`client.ts`(item overview + exchange 端點、300ms 間隔、AbortController)、`keys.ts`(`unique\|name\|baseType[\|6L]`、`currency\|name`…)、`cache.ts`(快照 schema、15 分鐘 TTL、30 天清除)、`lookup.ts` | 只 intl;renderer 殼 `web/background/Prices.ts` 呼叫;PoE2 的 `Prices.ts` 仍是「沒有價格」 |
| `core/src/dust/` | 拆粉純函式(WP-A/B):`formula.ts`(`dustAt` = APT `calcDisenchantDust` 逐字)、`data.ts`(poe-dust / items.ndjson 解析、`inherentInfluencesFromPoeDust`)、`crosscheck.ts`、`rank.ts`(`rankUniques` 四種效率、催化劑、固有勢力)、`trade.ts`、`ui-state.ts` | 對接一律英文 `name + baseType`;說明見 `docs/dust-tool.md` |
| `poe1/` | PoE1 adapter。`src/{parser,assets/data,web/price-check/{filters,trade}}` **與 apt-patched `renderer/src` 同路徑、同 `@/…` 匯入**;`src/index.ts` 是對外入口;`src/cli.ts` 無頭驗證;`test/` 回歸網 | 移植檔逐字不改,只切耦合點(見下) |
| `poe2/` | PoE2 adapter。`src/{parser,assets,web/price-check/{filters,trade,item-editor},web/{background,ui}}` 與 ee2-patched `renderer/src` 同路徑、同 `@/…` 匯入(含 .vue);`src/index.ts` 對外入口、`src/renderer-entry.ts` 給 renderer(`@poe2-entry`)、`src/cli.ts`;`test/` = E 的 `renderer/specs` + golden-query / trade-client / src-coupling | 同 poe1;耦合點清單在 `docs/poe2-port-notes.md`。型別檢查兩段:`tsconfig.json`(.ts)+ `tsconfig.vue.json`(.vue,`@/*` → poe2/src 再退回 renderer/src)|
| `renderer/` | Vite + Vue 3 殼:`App.vue`、`settings/`、`web/{Config,i18n}.ts`、`web/background/{IPC,Leagues,Prices}.ts`(取代上游同名模組)、`web/ui/*.vue` | `@/…` 由 `vite.config.mts` 的 `gameAwareAtAlias()` 依 importer 解析:poe2/src 的檔先找 poe2/src 再退回本目錄;其餘把 `@/parser*`、`@/assets/data*`、`@/web/price-check/*` 指到 poe1、其餘 `@/web/*` 指本目錄。renderer 引用遊戲元件用 `@poe1/…`、`@poe2/…`、`@poe2-entry`(tsconfig 不讀 poe2 原始碼,只認 `src/web/games/poe2-entry.d.ts`)。設定 `game` 切換 → main.ts 重載資料與 app_i18n、`web/games/active.ts` 的 `loadedGame` 決定 parser 與元件 |
| `renderer/src/theme/pobtools.css` + `renderer/src/web/useTheme.ts` | 主題 token(取自 PobTools `pob-zh-engine/ui/src/app.css`,四主題 `data-theme=slate|light|contrast|parchment`)與套用(`<html>` 的 `data-theme`、`--fs-base`、`--accent-user`、`--on-accent-user`) | Tailwind `gray.*` 等色階是 token 的**別名**(`renderer/tailwind.config.cjs`),移植元件的 class 不改 |
| `renderer/src/web/settings/` | `SettingsPanel.vue` + `tabs/{General,PriceCheck,Hotkeys,Regex,About}.vue` 五分頁、`HotkeyInput.vue`(移植自 APT) | |
| `renderer/src/web/dust/` | 拆粉排行面板(標題列 ⚖):`DustPanel.vue`、`DustTable.vue`(虛擬捲動)、`store.ts`;記憶 `userData/dust_ui.json`(標記/隱藏按聯盟分)。WP-Q 起**停靠在查價面板下方**(`App.vue` 的 `.price-stack` + `.dust-splitter`,拖曳或 ↑↓ 調整;比例 `AppConfig().dustDockRatio`,15–50%) | 單件拆粉在 `poe1/src/web/price-check/expected-value/DustValue.vue`;設定頁仍獨佔整個面板 |
| `main/src/host-handlers.ts` | IPC handler 登錄表(`kind: invoke\|send\|sync`、`preview: false` 不開放給預覽);`registerIpc(table)` 給 ipcMain、`previewHandlers(table)` 給預覽伺服器;事件走 `Broadcaster.broadcast` | 新增 IPC 一律加在登錄表,並決定預覽能不能用 |
| `main/src/preview-server.ts` | 瀏覽器預覽(WP-P):Node `http` 供應 `renderer/dist` + 注入 boot script 造 `window.host`,`POST ~rpc` + SSE `~events`;入口:托盤、設定 › 一般、`--preview`。見 `docs/browser-preview.md` | 測試 `main/test/preview-server.test.ts`(純 Node) |
| `poe2/src/desecration/` | PoE2 褻瀆詞綴 Tier 推定(WP-R):`infer.ts`(`inferDesecratedTiers`,Parser 末段 virtual;`matchStats()` 與 ParsedItem 解耦)、`display.ts`(推定/候選字串)、`types.ts`。一般格式詞綴區由 `Parser.ts` 的 `parsePlainModifiers` 解析 | 見 `docs/desecration-tiers.md`;測試 `poe2/test/desecration/` |
| `data/poe2/desecration/` | `tiers.json`(profiles / entries / diagnostics)、`base_profiles.json`(refName → profile);`scripts/build-desecration-tiers.mjs` 由 PoB2 portable `Data/*.lua` + `data/poe2/*/stats.ndjson` 產生 | 不手改;MANIFEST `commit` = PoB2 `manifest.xml` 裡 `ModVeiled.lua` 的 sha1 |
| `renderer/src/web/regex/` | Poe Regex UI(`RegexPanel/RegexList/RegexBookmarks.vue`、`store.ts`);書籤與勾選存 `userData/regex_state.json`(main tmp + rename) | UI 用的純邏輯放 `regex/src/view.ts`(有 vitest) |
| `renderer/src/web/{feedback,report}.ts` | 一鍵回報:組 issue 標題/內文 → 開預填的 `issues/new`;網址 > 6000 字元改只帶標題、全文進剪貼簿 | 不自動上傳;不含 accountName |
| `regex/` | `@exile-appraiser/regex`:`gen/data/state/rng/view.ts` 逐函式移植 PobTools `host/regex_gen.cpp` 等(純 TS,可在 renderer 與 Node 跑)、`node.ts`(讀檔)、`cli.ts`;資料 `data/regex/regex_poe{1,2}.json`(schema 2:`labels`、頁 `kind`)。WP-C 自寫:`numeric.ts`(數值範圍 → 最短正則)、`pages/`(演算法頁 `map_numeric` / `waystone_numeric` / `vendor_items` / `vendor_items_poe2`)、`combine.ts`(多頁合併 + 聯集 Verify)、`share.ts`(分享碼 gzip+base64url)、`scripts/gen-labels.mjs` | renderer 不得 import `@exile-appraiser/regex/node`;對應表與已知差異見 `docs/regex-port.md` |
| `main/` | Electron main + preload:熱鍵(`Shortcuts.ts`,globalShortcut + uiohook Ctrl+C)、`windowing/`(照 APT 的 overlay:`electron-overlay-window` 附著遊戲視窗、WidgetAreaTracker、OverlayVisibility、`GameDetector` 自動切換;`--window` / `overlayMode:false` 為獨立視窗備援)、`AppUpdater.ts`(electron-updater,GitHub Releases)、`tray-strings.ts`(托盤選單雙語字串,跟 `uiLanguage`)、剪貼簿輪詢、session fetch(帶 Cloudflare cookie)、設定檔、`app://` 協定 | session fetch(`http.ts` `ALLOWED_HOSTS`)只准 www.pathofexile.com / pathofexile.tw / poe.ninja;更新檢查由 electron-updater 直連 github.com |
| `renderer/public/brand/{icon,tray}.svg` | app 圖示來源 → `npm run build-icons`(sharp,冪等)產生 `renderer/public/icon.{png,ico}`、`tray-*.png`;`electron-builder.yml` `win.icon` 指向 `icon.ico` | 改圖只改 SVG 再重跑,不手改 png/ico |
| `data/dust/` | `poe-dust.json`(poe-disenchant-tool `data/dust/poe-dust.js` 逐筆轉 JSON,`scripts/sync-dust-data.mjs`) | 不手改;goldCost / slots / 固有勢力只從這裡取 |
| `data/regex/` | `regex_poe{1,2}.json`(PobTools 單向同步)、`labels.poe{1,2}.json`(clientstrings 暫代標籤,`regex/scripts/gen-labels.mjs`,只補資料檔缺鍵)、`templates.json`(內建範本,手寫) | 三者在 MANIFEST 各自一個前綴 |
| `data/poe1/`、`data/poe2/` | 資料檔,**逐位元組來自 apt-patched / ee2-patched**(poe2 的 `*.index.bin` 由 `make-index-files --game poe2` 產生);`data/poe2/trade/` 是 GGG `/api/trade2/data/{stats,items}` 兩區快照(parser 後援用 intl);`data/MANIFEST.json` 每個前綴一個來源(commit 或 fetchedAt)+ sha256 | 不在這裡改資料 |
| `scripts/` | `sync-data-from-apt.mjs`(`--game poe1|poe2`)、`sync-regex-data.mjs`、`sync-dust-data.mjs`、`dust-crosscheck.mjs`(→ `docs/dust-crosscheck.md`)、`fetch-poe2-trade-data.mjs`、`check.mjs`(CLI 依 `--game` 轉 workspace)、`verify-data-manifest.mjs`、`make-index-files.mjs`、`verify-datasets.mjs`、`check-user-agent.mjs`、`build-icons.mjs`、`make-fake-update-feed.mjs`(更新器離線驗證) | |
| `docs/` | `poe2-port-notes.md`(PoE2 移植紀錄)、`game-auto-switch.md`(PoE1/PoE2 自動切換)、`regex-port.md`(Poe Regex 移植、資料同步、WP-C 演算法頁/合併/分享碼/範本)、`dust-tool.md`(拆粉公式/資料/排行)、`dust-crosscheck.md`(產生的交叉比對報告,勿手改)、`release-flow.md`(發版 + 自動更新)、`browser-preview.md`(瀏覽器預覽:用法、同步、安全模型、協定)、`desecration-tiers.md`(褻瀆 Tier 資料表與推定、PoE2 複製鍵)、`phase2-summary.md`、`phase3-summary.md`、`phase4-summary.md`(各工作包摘要與已知限制) | |

**PoE1 / PoE2 切換 = 寫 config.json 的 `game` + 自我重新啟動,不是換綁**:`electron-overlay-window` 原生碼 `windows.c:176`
用 `strcmp` 精確比對單一視窗標題,`attachByTitle` 每行程只能呼叫一次。`GameDetector` 每 2 秒看視窗清單,
目前遊戲不在、另一款在連續 2 次才切;overlay 模式下手動切 game / 改該遊戲標題 / 改 overlayMode 也立即重新啟動。詳見 `docs/game-auto-switch.md`。

## 必守規則
1. **資料只單向同步,不在本 repo 產生**:`npm run sync-data -- --from ../apt-patched`、`npm run sync-data -- --game poe2 --from ../ee2-patched`(會拒絕來源有未 commit 變更)→ 自動重寫 MANIFEST 該前綴。PoE2 交易站快照:`node scripts/fetch-poe2-trade-data.mjs`(新賽季重跑)。
   `npm test` 第一步就是 `verify-data`;MANIFEST 不符一律紅。改行尾/改 ndjson 必重跑 `make-index-files`(byte offset 索引)。
2. **語言無關鍵對接**:詞綴送 trade stat id、物品名送 `refName`(intl)或 `name`(tw)。`items` 端點沒有 id,**禁止位置對位**。
3. **realm 模型**:`intl` = `www.pathofexile.com` + 英文名;`tw` = `pathofexile.tw`(裸 host)+ 繁中名。`useIntlSite` 由 realm+language 推導,不是開關。
   `TradeClient` 狀態(限流、快取)每個 realm 各一套(`tradeSession(realm)`)。
4. **User-Agent 版號**:`main/package.json` 與 root 的 `version` major.minor **必須等於現行遊戲版本**(3.29),否則 GGG Cloudflare 403。
   遊戲改版先跑 `npm run check-user-agent`。
5. **匿名查詢**:沒有 POESESSID、沒有登入。Cloudflare cookie 靠內建瀏覽器視窗(`openCaptcha`)解一次,與 `session.fetch` 共用。
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
12. **更新器**:`autoDownload=false`(沒有 code signing,使用者按了才下載/安裝)、portable 只導去 Releases;`electron-builder` 永遠 `-p never`;發版照 `docs/release-flow.md`,**使用者說「發」才 `gh release create`**。
13. **一鍵回報不含 accountName**(`feedback.ts` 也會遞迴剝掉 account/token/cookie 類鍵);只開預填網址,不自動上傳。
14. **派工/驗證禁止合成鍵盤/滑鼠輸入**(SendInput、uiohook 模擬、PowerShell SendKeys 等):GUI 行為由使用者實測,自動驗證只用 log、DOM 錨點、`--window` 無輸入啟動。
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

## 指令
```bash
npm install                      # 一次裝完四個 workspace(含 Electron)
npm test                         # verify-data + poe1 vitest + poe2 vitest(parser 回歸網 + realm golden query + 離線交易層)
npm run typecheck                # core / poe1 / poe2(tsc + vue-tsc)/ renderer(vue-tsc)/ main
npm run check -- <物品.txt> [--game poe2] --realm both [--online]   # 無頭驗證:兩區 payload / 端點 / 網頁網址;--online 真的打(可能被 CF 擋)
npm run cli --workspace regex -- --game poe1 --page map_mods --lang zh --mode any --random 7,5   # Regex 無頭產生 + Verify(--list 列頁面)
node scripts/sync-regex-data.mjs --from ../pob-zh-engine   # Regex 資料單向同步(PobTools host/data 有未提交變更時加 --allow-dirty,MANIFEST 記 dirty: true)
node regex/scripts/gen-labels.mjs --from ../pob-zh-engine  # Regex 暫代標籤 data/regex/labels.poe*.json(clientstrings,以鍵取值)
node scripts/sync-dust-data.mjs --from <poe-disenchant-tool clone>   # 拆粉資料 data/dust/poe-dust.json + LICENSE + MANIFEST
node scripts/dust-crosscheck.mjs                            # APT vs poe-dust 交叉比對 → docs/dust-crosscheck.md
npm run build-icons              # brand/*.svg → icon.png/ico、tray-*.png(冪等,重跑 hash 不變)
npm run dev:renderer             # Vite 5173(純瀏覽器只能看 UI)
npm run dev:main                 # esbuild watch + 啟動 Electron(需先起 dev:renderer)
npm run dev:main -- --window --preview --no-updates   # 另開瀏覽器預覽,log 印 `[preview] --preview:<網址>`(預覽供應已 build 的 renderer/dist)
node scripts/build-desecration-tiers.mjs --from ../pob-zh-engine/dist/PathOfBuildingCommunity-PoE2-Portable/Data   # 褻瀆 Tier 資料表 → data/poe2/desecration + MANIFEST
npm run package                  # 先 build(renderer/dist + main/dist)再 electron-builder(nsis + portable),-p never;產物見 docs/release-flow.md
UPDATE_FIXTURES=1 npm test       # 改寫 parser / golden-query 快照;產出必人工 review
```

## 發版 checklist
1. 遊戲改版 → 改 root 與 main 的 `version`(3.XX.n)→ `npm run check-user-agent`。
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
- `core/test/`:`ninja.test.ts`(錄製的 poe.ninja 回應 `recordings/ninja/`)、`dust.test.ts`(公式金標、交叉比對統計、排行含固有勢力)。
- `regex/test/` 另有 `numeric`(0–999 逐值)、`pages`、`combine`、`share`(含範本鍵可還原)、`state` 測試。
- `renderer/test/`:`feedback.test.ts`(回報網址/剪貼簿路徑/剝帳號鍵)等純函式測試。
- `main/test/preview-server.test.ts`:預覽伺服器(token 404 / Host 421 / Origin 403、防穿越、boot script、RPC 往返、SSE 續傳、自動關閉),純 Node。
- `poe2/test/desecration/`:資料表統計與 poenavi 抽樣逐欄比對(`build.test.ts`)、推定(`infer.test.ts`,含三件真實物品的進階 vs 一般複製)。
- GUI(熱鍵、Cloudflare、真實掛單)由使用者實測;不得宣稱已驗。

## 剩餘待辦(Phase 4 完成後)
Phase 2 / 3 / 4 各工作包的摘要與已知限制見 `docs/phase2-summary.md`、`docs/phase3-summary.md`、`docs/phase4-summary.md`。
- **OCR 三選一揭露面板(WP-S)**:沿用 `data/poe2/desecration` 與 `matchStats()`;前置清單見 `docs/desecration-tiers.md` 文末(需使用者截圖 + 繁中 OCR 語言包)。
- **自訂「顯示進階詞綴」鍵**:照 EE2 讀 `poe2_production_Config.ini` 的 `show_advanced_item_descriptions`;目前固定送 `Ctrl + Alt + C`,改過鍵的玩家會拿到一般格式 → 走推定。
- **poe.ninja Map 類沒有 `mapTier`**:地圖類價格無法依階級對上,目前不處理。
- **待使用者親測(Phase 4)**:PoE2 `Ctrl + Alt + C` 是否讓 Alt 卡住;overlay 下預覽改遊戲不重啟;拆粉停靠真實拖曳(見 `docs/phase4-summary.md`)。
- **待使用者實測**:Regex 商店頁插槽 `R-G-B` 在繁中客戶端的寫法、寶石等級行首錨定 `^等級`、各屬性行分隔字元(`：` / `: ` / 空白)與「+」;拆粉排行與單件拆粉在真實聯盟的觀感。
- **PobTools 端**:`host/data/regex_poe{1,2}.json`(schema 2 + 新頁)**尚未 commit**,本 repo 以 `--allow-dirty` 同步(MANIFEST `data/regex` 帶 `dirty: true`);PoE1 既有兩頁 `max_stats` 維持 6(改 8 會替 3 行補上隱藏文字)——commit 與 6→8 都等使用者決定,commit 後不帶旗標重跑同步。
- PoE2 的 poe.ninja 參考價(`poe2/src/web/background/Prices.ts` 仍是「沒有價格」)。
- Regex 逐字 golden:需在 PobTools 端(`pob-zh.exe --regex-selftest`)加匯出固定勾選集 `Build().query` 的旗標(另開 PobTools 任務)。
- 台服 + 英文客戶端組合驗證後解禁(`isSupportedCombination`)。
- commit / push / 發版逐項等使用者指示。
