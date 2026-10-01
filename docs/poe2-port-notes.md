# PoE2 adapter 移植筆記(**已完成**,2026-09-28)

來源:`D:\codeproject\Pob2\ee2-patched`(Exiled Exchange 2 zh-TW fork,MIT)@ `fc7de73c`。
架構同 poe1(衍生自 Awakened PoE Trade),內容已分歧:Parser.ts 2,293 行 vs 1,750,多 `augment-builder.ts`、`calc-base.ts`。

## 結果一覽
| 項目 | 位置 |
|---|---|
| workspace | `poe2/`:`src/{parser,assets,web/price-check/{filters,trade,item-editor,trends},web/{background,ui}}` 與 E 的 `renderer/src` 同路徑、同 `@/…` 匯入 |
| 對外入口 | `poe2/src/index.ts`(`poe2Adapter`、`createPresets`、`createTradeRequest(preset, item)`、`searchPrices`、`bulkPrices`、`webSearchUrl`、`webExchangeUrl`)|
| renderer 入口 | `poe2/src/renderer-entry.ts`(Vite alias `@poe2-entry`;型別宣告 `renderer/src/web/games/poe2-entry.d.ts`,一致性由 `renderer-entry.check.ts` 把關)|
| CLI | `poe2/src/cli.ts`;root `npm run check -- <檔> --game poe2 --realm both [--online]`(`scripts/check.mjs` 依 `--game` 轉 workspace)|
| 資料 | `data/poe2/{cmn-Hant,en}/`、`item-drop.json`、`remnants.json`(逐位元組自 E);`*.index.bin` 由 `make-index-files --game poe2` 產生(與 E 本機產物逐位元組相同)|
| 交易站 data 快照 | `data/poe2/trade/{intl,tw}/{stats,items}.json`(`scripts/fetch-poe2-trade-data.mjs`;抓取時間記在 MANIFEST `sources["data/poe2/trade"].fetchedAt`)|
| 測試 | `poe2/test/`:E 的 `renderer/specs/` + `golden-query` + `trade-client` + `src-coupling`,共 546 項 |

## 實際切的耦合點(每處檔內有 `// exile-appraiser:` 註解)
| # | 檔案 | 上游 | 替換 |
|---|---|---|---|
| 1 | `assets/data/index.ts` | `fetch(import.meta.env.BASE_URL + 'data/…')` ×7 | `source().text/binary(...)`;`configureDataSource` 由 `assets/data/source.ts` 持有並 re-export |
| 2 | `assets/client-string-loader.ts` | 動態 `import(BASE_URL + client_strings.js)` | `source().module(...)` |
| 3 | `web/background/TradeData.ts`(整檔取代) | Vue `createGlobalState` + `Host.proxy` 線上抓 www `/api/trade2/data/{stats,items}`,30 分鐘重抓 | 同形狀的非 Vue 單例;來源是可注入的 `TradeDataLoader`,預設讀 DataSource 的 `trade/intl/*.json` 離線快照;拿掉計時器 |
| 4 | `parser/Parser.ts`(錯語系提示) | `AppConfig().language` | `hostOptions().language`(`parser/host-options.ts`)|
| 5 | `parser/magic-name.ts` | `AppConfig().language === 'cmn-Hant'` | `hostOptions().language` |
| 6 | `parser/augment-builder.ts` | `AppConfig('price-check').savedAugments` | `hostOptions().savedAugments`(預設 `{}`)|
| 7 | `web/price-check/filters/fill-augments.ts` | `AppConfig('price-check').searchStatRange` | `hostOptions().searchStatRange` |
| 8 | `trade/common.ts` | `shallowReactive` 單例 `RATE_LIMIT_RULES`、`AppConfig().apiLatencySeconds`、`getTradeEndpoint` re-export | `tradeSession(realm)`(每 realm 一套限流 + 快取)、`adjustRateLimits(..., latencySeconds)`、`getTradeEndpoint()` 讀 `activeTradeContext()`;provider 持有者在 `trade/context.ts` |
| 9 | `trade/pathofexile-trade.ts` / `pathofexile-bulk.ts` | `Host.proxy`、`opts.accountName` | `ctx.http`、`ctx.accountName`;函式第一參數 `TradeContext`;URL 用 core `tradeApiBase(realm, 'poe2')`(`/api/trade2/*`,聯盟 encode);快取鍵含 realm;`pathofexile-trade.ts` 的 `TradeRequest` 型別改 export(符文塑形點選查交易站 `runeshape/trade-lookup.ts` 直接組 body) |
| 10 | `trade/trade-api.ts` / `bulk-api.ts`(Vue composable) | `AppConfig().accountName` | `activeTradeContext()` |
| 11 | `trade/RateLimiter.ts` / `Cache.ts` | Vue 版 | 轉接 core(core `Cache` 併入 E 的 `purgeIfDifferentCurrency`)|
| 12 | `web/background/Prices.ts`(整檔取代) | poe.ninja | 「沒有價格」同介面實作(型別、`DivCurrency`、`displayRounding` 照抄;換算價不顯示)|
| 13 | `.vue` | 見各檔頭 | `CheckedItem.vue`:移除 PriceTrend / PricePrediction / StackValue / Tip / 贊助區塊,`useEn` 改 `AppConfig().useIntlSite`,網址 encode;`TradeListing/TradeBulk.vue`:網址 encode、外開走 `Host.openExternal`;`TradeLinks.vue`:`Host.openExternal`;`UnknownModifier.vue`:移除「重載交易站資料」鈕(離線快照重載無意義、`Host.selfDispatch` 不存在);`RateLimiterState.vue` 沿用 poe1 的改寫版 |
| 14 | `trade/TradeItem.vue`(2026-10-01,檔案是 CRLF,保持) | 結果列物品浮窗:`tippy(row, { interactive: true, placement: "left", … })` 沒設 `appendTo`,interactive 預設掛在 reference 的 parentNode(結果表格內);祖先 `.price-main` `overflow-y:auto`、`.price-panel.is-overlay` / `.bg-host` `overflow:hidden` 把面板左側的 popup 裁掉 | 加 `appendTo: () => document.body`(脫離所有 overflow 祖先);`.pob-dark`(Popover.vue `setDefaultProps`)與 `item-tooltip` 樣式是全域規則、色票在 `:root`,掛點改變不影響。另加 `popperOptions` flip 後備 `right → bottom → top`:window 模式面板佔滿視窗寬、左右都放不下時預設 flip 失敗(實測 popup left = -445px),後備讓它落在列的上下並由 preventOverflow 夾回視窗內。overlay 模式照 EE2 放面板左側 |
| 15 | `trade/pathofexile-trade.ts` `requestResults`(2026-10-02 第 19 步) | 浮窗詞綴 / 物品名照 fetch 回應顯示(國際服 = 英文) | `await displayZhFor(ctx.realm)` 一行 + `parseFetchResult` 之後套 `toZh(displayItem, result.item)` 一行;邏輯全在自寫的 `trade/display-zh.ts`(下方「物品浮窗繁中」)|

## 行為修正(非耦合點,ee2-patched 同樣有這些問題、尚未回補)
| 檔案 | 問題 | 修正 | 回歸 |
|---|---|---|---|
| `parser/Parser.ts` `parseNamePlate` | 沒有 `Item Class:` 行一律當寶石(上游 meta 技能寶石 hack)→ 交易站「複製物品」文字(無 Item Class)的傳奇 / 稀有 / 魔法 / 普通物品全部 `item.unknown` | 稀有度是物品稀有度時不強制歸類,交給 `findInDatabase` | `test/Parser/auspex-and-magic-tablet.test.ts`(觀鳥者:英文原文 + GGPK 組的繁中) |
| `parser/magic-name.ts` `magicBasetype` | 只比長度、同長取先出現 → 詞綴名含物品名時挑錯底材(繁中「昇華的幻像異界之譫妄碑牌」→「幻像異界」) | `anchorRank`:繁中底材必在名稱結尾、英文底材緊接 `of` 之前或在結尾,位置優先再比長度 | 同上 + `test/Parser/magic-name-collisions.test.ts`(`scripts/scan-magic-name-collisions.mjs --from ../pob-zh-engine` 產生的 GGPK 詞綴名 × 底材潛在碰撞,已知歧義列在測試檔) |

**與原計畫不同處**:`Parser.ts:1420,1425` 的 `useAugment` 沒有改成回呼 —— 它來自 `web/price-check/item-editor/augment.ts`,
實際是純 TS(無 Vue / 設定依賴),所以整檔照搬,Parser 的 import 不動;只有 `savedAugments` 為空(預設)時它不會被呼叫,
行為與「預設 no-op」相同,但使用者在物品編輯器存了符文時也能正確預填。

## renderer 接線
- 設定 `game: poe1 | poe2`(設定面板「遊戲」),`main.ts` 監看 `[game, language]` → 重載該遊戲資料集 + `app_i18n`
  (`./data/<game>/<lang>/app_i18n.json`),載完才更新 `web/games/active.ts` 的 `loadedGame`;App.vue 依它選 parser、
  `CheckedItem`、`RateLimiterState`,切換時清掉舊物品。不必重啟。
- 聯盟:`leagueBy[game][realm]`(舊 `leagueByRealm` 讀檔時併入 `poe1`);PoE2 清單 `/api/trade2/data/leagues`,
  預設規則照 E(清單 > 2 取 index 2)。
- 切到 PoE2 時若視窗標題仍是 `Path of Exile`,自動改 `Path of Exile 2`(反之亦然;自訂過的不動)。
- `main/src/HostClipboard.ts`:加 `Rarity: ` / `稀有度: ` 開頭(E 的 `uncutSkillGemLine`,PoE2 未切割技能寶石沒有「物品種類」行)。
- **`@/…` 解析依 importer**:`renderer/vite.config.mts` 的 `gameAwareAtAlias()` —— importer 在 `poe2/src` 時先找 poe2/src 再退回 renderer/src;
  其餘維持「parser / assets/data / web/price-check → poe1」。型別版是 `poe2/tsconfig.vue.json` 的 `@/*: [poe2/src, renderer/src]`。
  renderer 的 tsconfig **不讀** poe2 原始碼(同一 program 的 `@/parser` 只能指一邊),renderer 以 `@poe1/…`、`@poe2/…`、`@poe2-entry` 引用。
- `renderer/public/images` 補 E 的 `404.png`、`annul.png`、`extractor.png`、`jeweler.png`、`socket2.png`、`augments/`、`item-display/`;
  tailwind `content` 加兩個 package 的 .vue、colors 補 E 多的 fire/cold/lightning/normal/magic/rare/unique/rose/fuchsia/slate。

## 測試對照(E 562 項 → 本 repo)
| E 的 spec | 處置 |
|---|---|
| Parser/*、data/dataLoader、web/price-check/**、web/useTradeApi、zhTW/*(dataset-invariants 的 `KNOWN_STAT_GAPS` 棘輪、14 組 fixture) | 全搬,517 項全綠 |
| `web/client-log.test.ts`(30)、`web/item-check.test.ts`(4)、`web/library/libraryChaos.test.ts`(5) | 不適用:客戶端 log、物品檢查 widget、library 不在查價範圍,未搬 |
| `web/prices.test.ts`(2) | 不適用:poe.ninja 刻意不做 |
| `Parser/parsers.test.ts` 的 ja / ko / ru 三列 | 移除:本 app 只出貨 en / cmn-Hant 資料 |
| `zhTW/stat-coverage.test.ts`「其他語系只准變少」 | 移除(同上);cmn-Hant / en 兩個零缺陷斷言保留 |
| 新增 `golden-query`(16)、`trade-client`(8)、`src-coupling`(5) | |

`vitest.setup.ts` 的三個 mock → `setupTests()`:`configureDataSource(nodeDataSource(data/poe2))` + `configureTradeDataLoader(snapshot)` +
`setHostOptions`(照上游 mock:language 預設 en、savedAugments `{}`、searchStatRange undefined)+ 拒絕網路的 TradeContext provider。

## trade2 API(實測 2026-09-28)
- `/api/trade2/search/{league}`、`/api/trade2/fetch/{ids}?query=`、`/api/trade2/exchange/{league}`、`/api/trade2/data/leagues`;兩區相同。
- 聯盟清單兩區結構相同 `{ result: [{ id, realm: 'poe2', text }] }`,台服 id 為繁中(`阿德爾的符文` 等),路徑段必須 encode。
- 網頁 `/trade2/search/poe2/{league}/{id}`、`/trade2/exchange/poe2/{league}`。
- 搜尋 id 已是新式 gzip+base64url(`H4sI…`)。

## 資料規格差異(vs poe1)
- `items.ndjson`(4,072 筆):namespace 只有 ITEM/UNIQUE/GEM;多 `tags[]`、`augment`(符文/魂核)、`map.tier`、`gem.awakened`。
- `stats.ndjson`(2,524 筆,無群組列):多 `id`(GGPK stat id)、`trade.count`。
- 索引演算法與 poe1 不同(stats 的 `string` 與 `advanced` 都進索引;items 名稱索引沿用上游 `namespace::refName` 去重),見 `scripts/make-index-files.mjs`。
- 上游缺交易 id 還缺 42 條,清單在 `ee2-patched/ee2-交易id缺口清單.md` 與 `poe2/test/zhTW/dataset-invariants.test.ts` 的 `KNOWN_STAT_GAPS`。

## 物品浮窗(結果列滑鼠懸停,2026-10-01 第 14 步)
- 元件(`TradeItem.vue` / `TooltipItem.vue` / `UiDetailedItemImg.vue`、`pathofexile-trade.ts` `parseFetchResult` / `getTier`)原本就已移植;補的是設定頁選項(設定 › 查價,**只在 PoE2 顯示**,`renderer/src/web/settings/tabs/PriceCheck.vue` + `price-check-options.ts`;三選一 關閉 / SHIFT + 懸停 / 始終懸停顯示,預設 keybind,綁 `priceCheck.itemHoverTooltip`,字串 `ppz.item_hover*`)與上表第 14 項的掛點修正。
- 切換選項要重新查價(新結果列)才生效:tippy 在列 mounted 時依當時設定建立(與 EE2 相同)。
- 資源:`/images/item-display/*.png` 24 張、`/images/augments/*` 皆在 `renderer/public/images/`;`item.*` 字串在 `data/poe2/<lang>/app_i18n.json`。上游缺 `item.duplicates`(繁中,會退回英文)與 `item.map_item_quantity`(程式裡已註解掉),資料單向同步不手補。物品圖示是 `web.poecdn.com` 外部圖。
- 驗證:node 單元測試 `renderer/test/price-check-options.test.ts`;畫面以無頭 Chrome + 假 `window.host`(錄製的 `poe2/test/docs/fetchResponses*.json` 當 search / fetch 回應)驗過 overlay / window 模式、背景開關、淺色主題、三種選項。

## 物品浮窗繁中(2026-10-02 第 19 步)
- 條件:**國際服**且**介面語言** `uiLanguage === 'cmn-Hant'`(浮窗的 `item.*` 標籤本來就跟介面語言,詞綴跟著它);英文介面、台服(回應本身是繁中)完全不動。`HostOptions` 新增 `uiLanguage`(renderer `main.ts` provider 傳 `AppConfig().uiLanguage`,型別 `Poe2HostOptions`)。
- 資料:`data/poe2/en/stats.ndjson` + `data/poe2/cmn-Hant/{stats,items}.ndjson`,與目前載入的客戶端語言無關,第一次需要時由 DataSource 讀一次(`loadDisplayZhData`,失敗只記錄、浮窗維持英文)。**不自行翻譯任何字**。
- 對接(語言無關鍵,不做位置對位):每行自己的 trade stat id(新格式 `mods[i].hash`,去掉 `stat.` 前綴;舊格式 `extended.hashes[type][i][0]`;選項型 `…|64921` 退回去掉選項;完整 id 查不到才用 `stat_N` 跨類別)→ 繁中條目的 `trade.ids` → 以 `ref` 配英文條目。英文行(`parseAffixStrings` 後、`
` 兩側空白正規化)必須**完整匹配**某個英文 matcher(`#` = 數值、其餘字面相同);繁中 matcher 以 `negate` / `value` 旗標挑(英文 value 單數形而繁中沒有對應變體時,退用同 negate、無 value、恰一個 `#` 的繁中 matcher;選項型詞綴不退)。數值依 `#` 順序原字串代入,模板字面 `+#` / `-#` 的正負號兩邊對齊。結果不唯一(同旗標多種寫法)→ 保留英文。
- 物品名:傳奇 `name` → `UNIQUE::refName`;`typeLine === baseType` → `ITEM` / `GEM`;繁中名必須唯一。稀有隨機名、魔法物品 typeLine(帶詞綴名)保留英文。
- 不動:tier 標籤、顏色、行數與順序、veiled、物品屬性 / 需求 / 標籤(`Quality`、`Level 65, 74 Str`、`Corrupted` 等仍是上游原樣)。
- 覆蓋率(錄製回應 `poe2/test/docs/fetchResponses*.json` + 符文塑形 fetch 錄製):92 / 104 行。保留英文 12 行:同旗標多種繁中寫法 6(`explicit.stat_3917489142` 物品稀有度、`2065500219` 怪物效用、`2777224821` 換界石數量、`1825943485` 精髓、`1276056105` 金幣、`1263695895` 照亮範圍);英文模板對不上 3(`791928121` ×2「Causes …Stun Buildup」:繁中條目 ref 是不帶 Causes 的另一條;`3793155082` 交易站文字少了「Map has」);資料沒有的 id 1(`explicit.stat_3076483222|64921` 最後通牒獻祭);回應沒有 hashes 2(Vase Relic)。清單與逐行結果在 `poe2/test/web/price-check/trade/__snapshots__/display-zh.test.ts.snap`。
- 測試 `poe2/test/web/price-check/trade/display-zh.test.ts`(逐行快照、覆蓋率、tier 不變、刻意破壞、錯置 hashes、英文介面 / 台服不翻、`requestResults` 端到端);畫面以第 14 步同法(無頭 Chrome + 假 `window.host`)截圖比對繁中 / 英文介面。

## 未做 / 待辦
- poe.ninja 參考價(兩個遊戲都還是「沒有價格」實作)、預測價、PriceTrend、StackValue、ExtractionValue 的換算。
- GUI 實機(熱鍵 → overlay 附著 PoE2 視窗 → 台服真實掛單)由使用者實測。
- 交易站 data 快照是手動更新(`node scripts/fetch-poe2-trade-data.mjs`);新賽季要重跑。

## 相關文件
- [game-auto-switch.md](game-auto-switch.md)(PoE1/PoE2 自動切換)
- [regex-port.md](regex-port.md)(PoE2 的 Poe Regex 頁面)
- [phase2-summary.md](phase2-summary.md)(Phase 2 摘要)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
