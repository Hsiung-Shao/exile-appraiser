# PoE2 adapter 移植筆記(**已完成**,2026-09-28)

來源:`D:\codeproject\過時專案\ee2-patched`(Exiled Exchange 2 zh-TW fork,MIT)@ `fc7de73c`。
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
| 12 | `web/background/Prices.ts`(整檔取代) | poe.ninja(EE2 自家代理 `api.exiledexchange2.dev`) | 第 24 步起是**轉接殼**:renderer 以 `setPriceSource()` 注入 poe.ninja 價格源(`renderer/src/web/background/poe2-price-source.ts`),本檔包成上游 `usePoeninja()` 介面(`findPriceByQuery` 回 divine 計價的 `primaryValue` / `volumePrimaryValue` / `maxVolumeCurrency` / `sparkline` / `url` / `cx`,`autoCurrency`、`cachedCurrencyByQuery`、`xchgRate` = 1 div 換幾 ex、區間運算);沒注入或沒有價格表 = 原本的「沒有價格」行為。型別、`DivCurrency`、`displayRounding` 照抄。不 import Vue(getter 讀 renderer 的 shallowRef)|
| 13 | `.vue` | 見各檔頭 | `CheckedItem.vue`:移除 PricePrediction / Tip / 贊助區塊(PriceTrend / StackValue 第 24 步加回,見「通貨價格區」),`useEn` 改 `AppConfig().useIntlSite`,網址 encode;`TradeListing/TradeBulk.vue`:網址 encode、外開走 `Host.openExternal`;`TradeLinks.vue`:`Host.openExternal`;`UnknownModifier.vue`:移除「重載交易站資料」鈕(離線快照重載無意義、`Host.selfDispatch` 不存在);`RateLimiterState.vue` 沿用 poe1 的改寫版 |
| 14 | `trade/TradeItem.vue`(2026-10-01,檔案是 CRLF,保持) | 結果列物品浮窗:`tippy(row, { interactive: true, placement: "left", … })` 沒設 `appendTo`,interactive 預設掛在 reference 的 parentNode(結果表格內);祖先 `.price-main` `overflow-y:auto`、`.price-panel.is-overlay` / `.bg-host` `overflow:hidden` 把面板左側的 popup 裁掉 | 加 `appendTo: () => document.body`(脫離所有 overflow 祖先);`.pob-dark`(Popover.vue `setDefaultProps`)與 `item-tooltip` 樣式是全域規則、色票在 `:root`,掛點改變不影響。另加 `popperOptions` flip 後備 `right → bottom → top`:window 模式面板佔滿視窗寬、左右都放不下時預設 flip 失敗(實測 popup left = -445px),後備讓它落在列的上下並由 preventOverflow 夾回視窗內。overlay 模式照 EE2 放面板左側 |
| 16 | `filters/{UnknownModifier,FiltersBlock}.vue`、`trade/{TradeListing,TradeBulk}.vue`(2026-10-08 就地回報;PoE1 同名四檔同樣改) | 回報按鈕只在查價面板最下方,使用者不知道有這個功能 | 各加一個 `<report-inline>`(renderer `web/ui/ReportInline.vue`,經 `@/web/ui/` 退回 renderer):未解析詞綴旁「回報這條」(`mode="mod"`)、詞綴清單上方條數 +「回報問題」(`mode="summary"`,`showUnknownMods` 時)、查價錯誤框 actions「回報問題」(`mode="trade"`,帶錯誤訊息)。元件 `inject(REPORT_INLINE_KEY)`,App.vue provide;沒注入(CLI / 測試)整個不畫。報告內容同底列「回報這件」,另帶一行 `error` 說明是哪條詞綴 / 哪個錯誤(`renderer/src/web/report-inline.ts`) |
| 17 | `filters/{FilterModifier,FiltersBlock,create-presets}`(2026-10-14 破裂切換鈕 + 破裂詞綴預設可見;PoE1 同名三檔同樣改) | 破裂物品的破裂詞綴預設送 explicit id,破裂版本是 `hide_for_crafting` 的隱藏孿生;顯示的 explicit 列又常被 pseudo 合計吃掉(PoE1 戒指破裂智慧)或因「用在 DPS 屬性」隱藏(PoE2 弓破裂物理)→ 使用者只在「已隱藏」看到破裂詞綴(實機回報) | `create-presets` 在 pseudo 預設建好後加一行 `revealFracturedRows(pseudoPreset.stats, item)`:每條破裂詞綴挑一列代表列顯示(有 explicit 列用它、被 pseudo 吃掉就把孿生拿出來,同組其他列維持隱藏;不可再製作的物品沒有孿生 → 唯一來源、無倍率的 pseudo 列)。孿生當代表列時改成一般詞綴(tag explicit、送 explicit id、鈕不亮,與有自己 explicit 列時起始狀態一致);pseudo 合計列照上游不動。**查詢差異**:孿生雖未勾選仍以 `disabled: true` 隨查詢送出,這條的 id 由 fractured 變 explicit(快照 `poe1/test/fixtures/en/ring-rare-01.query.intl.json` 一行,2026-10-14 使用者接受);其餘情況只改 hidden。`FilterModifier.vue` 只加 import + 註冊 + 一個 `<filter-modifier-fractured>`(PoE2 在 `flex-col` 內、元素詞綴按鈕下方;PoE1 在詞綴列下方 `ml-5 mt-1`);`FiltersBlock.vue` 只加 `provide(FRACTURED_FILTERS_KEY, () => props.stats)`。自寫 `filters/FilterModifierFractured.vue`(圓角膠囊 + 閃電圖示 +「破裂」,送破裂 id 時 = 金框 / 淡金底 / 金色粗體,`aria-pressed`;字串 `ppz.fractured_toggle.*`)與純邏輯 `filters/fractured-toggle.ts`:可見、來源全部是破裂詞綴的列才有鈕(PoE2 explicit 類來源會合併,混了一般詞綴不給);打開 = tradeId 換 `stat.trade.ids.fractured`、勾選、其他送同一組 fractured id 的列取消勾選;關閉 = 換回 explicit(pseudo 退路列回 pseudo id);切換時不改 tag。測試 `poe{1,2}/test/**/fractured-{toggle,visible}.test.ts`、`renderer/test-vue/fractured-toggle-mount.test.ts` |
| 15 | `trade/pathofexile-trade.ts` `requestResults`(2026-10-02 第 19 步) | 浮窗詞綴 / 物品名照 fetch 回應顯示(國際服 = 英文) | `displayZhFor(ctx.realm)` 一行(code review 第 B 批起同步、不 await)+ `parseFetchResult` 之後套 `toZh(displayItem, result.item)` 一行;邏輯全在自寫的 `trade/display-zh.ts`(下方「物品浮窗繁中」)|

## 行為修正(非耦合點,ee2-patched 同樣有這些問題、尚未回補)
| 檔案 | 問題 | 修正 | 回歸 |
|---|---|---|---|
| `parser/Parser.ts` `parseNamePlate` | 沒有 `Item Class:` 行一律當寶石(上游 meta 技能寶石 hack)→ 交易站「複製物品」文字(無 Item Class)的傳奇 / 稀有 / 魔法 / 普通物品全部 `item.unknown` | 稀有度是物品稀有度時不強制歸類,交給 `findInDatabase` | `test/Parser/auspex-and-magic-tablet.test.ts`(觀鳥者:英文原文 + GGPK 組的繁中) |
| `parser/magic-name.ts` `magicBasetype` | 只比長度、同長取先出現 → 詞綴名含物品名時挑錯底材(繁中「昇華的幻像異界之譫妄碑牌」→「幻像異界」) | `anchorRank`:繁中底材必在名稱結尾、英文底材緊接 `of` 之前或在結尾,位置優先再比長度 | 同上 + `test/Parser/magic-name-collisions.test.ts`(`scripts/scan-magic-name-collisions.mjs --from ../Pob2/pob-zh-engine` 產生的 GGPK 詞綴名 × 底材潛在碰撞,已知歧義列在測試檔) |

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
- **未鑑定傳奇(2026-10-03 修空白面板)**:上游 `PriceCheckWindow.vue` 在 `CheckedItem` 上方掛 `unidentified-resolver/UnidentifiedResolver.vue`,
  本專案移植時沒掛 → 未鑑定傳奇(`noUniqueSelection`)整塊不畫、也沒有任何錯誤,查價面板只剩標題列(v0.1.1 起就有)。
  現在元件逐字移植到 `poe2/src/web/price-check/unidentified-resolver/`,經 `@poe2-entry` 的 `UnidentifiedResolver` 由 App.vue 掛在 PoE2 `CheckedItem` 上方;
  行為照上游:列出這個基底的傳奇(`ITEMS_ITERATOR` 找 `unique.base`,變體不分;只有一個就自動選),選定 = 物品 `info` 換成那個傳奇
  (`App.vue` `onIdentify` → `parsed = ok(identified)`,同上游 `handleIdentification`),之後照一般傳奇查(名稱 + 基底 + `identified: false`)。
  查價區另包 `renderer/src/web/ui/ErrorBoundary.vue`:元件出錯時顯示錯誤框 + 寫 `[renderer-error]`(含堆疊)進 main log,不再整塊空白。
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
| `web/prices.test.ts`(2) | 不適用:測的是 EE2 自家代理的 blob 切割;價格源改由 renderer 注入,轉接殼另測 `test/web/background/prices-adapter.test.ts`(第 24 步) |
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
- 元件(`TradeItem.vue` / `TooltipItem.vue` / `UiDetailedItemImg.vue`、`pathofexile-trade.ts` `parseFetchResult` / `getTier`)原本就已移植;補的是設定頁選項(設定 › 查價,**只在 PoE2 顯示**(2026-10-15 起 PoE1 也有浮窗、兩代都顯示,見下「PoE1 查價結果懸停浮窗」),`renderer/src/web/settings/tabs/PriceCheck.vue` + `price-check-options.ts`;三選一 關閉 / SHIFT + 懸停 / 始終懸停顯示,預設 keybind,綁 `priceCheck.itemHoverTooltip`,字串 `ppz.item_hover*`)與上表第 14 項的掛點修正。
- 切換選項要重新查價(新結果列)才生效:tippy 在列 mounted 時依當時設定建立(與 EE2 相同)。
- 資源:`/images/item-display/*.png` 24 張、`/images/augments/*` 皆在 `renderer/public/images/`;`item.*` 字串在 `data/poe2/<lang>/app_i18n.json`。上游缺 `item.duplicates`(繁中,會退回英文)與 `item.map_item_quantity`(程式裡已註解掉),資料單向同步不手補。物品圖示是 `web.poecdn.com` 外部圖。
- 驗證:node 單元測試 `renderer/test/price-check-options.test.ts`;畫面以無頭 Chrome + 假 `window.host`(錄製的 `poe2/test/docs/fetchResponses*.json` 當 search / fetch 回應)驗過 overlay / window 模式、背景開關、淺色主題、三種選項。

## 物品浮窗繁中(2026-10-02 第 19 步)
- 條件:**國際服**且**介面語言** `uiLanguage === 'cmn-Hant'`(浮窗的 `item.*` 標籤本來就跟介面語言,詞綴跟著它);英文介面、台服(回應本身是繁中)完全不動。`HostOptions` 新增 `uiLanguage`(renderer `main.ts` provider 傳 `AppConfig().uiLanguage`,型別 `Poe2HostOptions`)。
- 資料:`data/poe2/en/stats.ndjson` + `data/poe2/cmn-Hant/{stats,items}.ndjson`,與目前載入的客戶端語言無關,第一次需要時由 DataSource 讀一次(`loadDisplayZhData`,失敗只記錄、浮窗維持英文)。**不自行翻譯任何字**。
- 載入不擋查價(2026-10-02 code review 第 B 批):懸停浮窗設成「關閉」(`HostOptions.itemHoverTooltip === 'off'`,renderer 傳 `AppConfig().priceCheck.itemHoverTooltip`)→ 不載不翻;
  `requestResults` 不 await 資料 —— 已載好就同步翻,還沒載 → 這次英文、背景載入,載好後下一次查價(含快取結果)就是繁中。
  重用 `@/assets/data` 已載入的那一個語系(`LOADED_DATA`,`loadForLang` 全部載完才設):客戶端繁中 → 繁中 stats / items 用記憶體的 `STATS_ITERATOR` / `ITEMS_ITERATOR`,只另讀 `en/stats.ndjson`;
  客戶端英文 → en stats 用記憶體的,另讀繁中 stats / items。建出的對照表與三個檔直接讀**深度相同**(測試守著);換語系載入中(`LOADED_DATA` 為 undefined)就三個檔都讀。
- 對接(語言無關鍵,不做位置對位):每行自己的 trade stat id(新格式 `mods[i].hash`,去掉 `stat.` 前綴;舊格式 `extended.hashes[type][i][0]`;選項型 `…|64921` 退回去掉選項;完整 id 查不到才用 `stat_N` 跨類別)→ 繁中條目的 `trade.ids` → 以 `ref` 配英文條目。英文行(`parseAffixStrings` 後、`
` 兩側空白正規化)必須**完整匹配**某個英文 matcher(`#` = 數值、其餘字面相同);繁中 matcher 以 `negate` / `value` 旗標挑(英文 value 單數形而繁中沒有對應變體時,退用同 negate、無 value、恰一個 `#` 的繁中 matcher;選項型詞綴不退)。數值依 `#` 順序原字串代入,模板字面 `+#` / `-#` 的正負號兩邊對齊。結果不唯一(同旗標多種寫法)→ 保留英文。
- 物品名:傳奇 `name` → `UNIQUE::refName`;`typeLine === baseType` → `ITEM` / `GEM`;繁中名必須唯一。稀有隨機名、魔法物品 typeLine(帶詞綴名)保留英文。
- 不動:tier 標籤、顏色、行數與順序、veiled、物品屬性 / 標籤(`Quality`、`Corrupted` 等仍是上游原樣;類別行與需求行 2026-10-14 起翻,見下)。
- 覆蓋率(錄製回應 `poe2/test/docs/fetchResponses*.json` + 符文塑形 fetch 錄製):92 / 104 行。保留英文 12 行:同旗標多種繁中寫法 6(`explicit.stat_3917489142` 物品稀有度、`2065500219` 怪物效用、`2777224821` 換界石數量、`1825943485` 精髓、`1276056105` 金幣、`1263695895` 照亮範圍);英文模板對不上 3(`791928121` ×2「Causes …Stun Buildup」:繁中條目 ref 是不帶 Causes 的另一條;`3793155082` 交易站文字少了「Map has」);資料沒有的 id 1(`explicit.stat_3076483222|64921` 最後通牒獻祭);回應沒有 hashes 2(Vase Relic)。清單與逐行結果在 `poe2/test/web/price-check/trade/__snapshots__/display-zh.test.ts.snap`。
- 測試 `poe2/test/web/price-check/trade/display-zh.test.ts`(逐行快照、覆蓋率、tier 不變、刻意破壞、錯置 hashes、英文介面 / 台服不翻、`requestResults` 端到端);畫面以第 14 步同法(無頭 Chrome + 假 `window.host`)截圖比對繁中 / 英文介面。
- **2026-10-14 補翻(使用者實機 Viper Coat 領主鎖甲:符文詞綴、類別行、需求行仍是英文)**:
  - 根因:符文詞綴 `rune.stat_3523867985`「#% increased Armour, Evasion and Energy Shield」的繁中條目有兩種同旗標寫法(`增加#%護甲、閃避、和能量護盾` / `增加#%護甲值、閃避和能量護盾`)→ 判為不唯一保留英文(不是符文合計值的問題);類別行(`properties[0]`)與需求行原本就不在翻譯範圍。
  - 同旗標多種寫法:另讀台服交易站快照 `data/poe2/trade/tw/stats.json`,同一個 trade stat id 的文字代入同樣數值後**恰好命中其中一個候選**才採用(只用來挑、不產生新字串;交易站只有正向寫法,reduced 行仍保留英文)。錄製回應覆蓋率 92 → 97 / 104(物品稀有度、怪物效用、換界石數量、精髓、照亮範圍解開;金幣 `1276056105` 仍不唯一)。
  - 類別行(2026-10-15 改用遊戲本身的物品種類名,使用者裁定):`properties[0]`(無數值)名稱 → GGPK `ItemClasses` 繁中名(`data/poe2/item-classes/item-classes.json`,`node scripts/sync-poe2-item-classes.mjs --from ../Pob2/pob-zh-engine` 由 pob-zh-engine 的 PoE2 GGPK 抽取表 `itemclasses` 單向同步,MANIFEST 前綴 `data/poe2/item-classes` 記 fetchedAt / game_version / 來源 sha256,不手改)。對接:交易站名稱 = GGPK `Id` 或英文名(`Body Armour` → 胸甲、`Helmet` → 頭部、`Tablet` → 碑牌),沒有才比「英文名去掉結尾 s」(`Charm` ↔ `Charms` → 護符、`Waystone` ↔ `Waystones` → 換界石);繁中名必須唯一。對不上保留英文(`Quarterstaff`:GGPK 英文 `Quarterstaves`、`Flask`:GGPK 只有生命 / 魔力藥劑)。
  - 需求行:依 `requirements[].type`(62 等級 / 63 力量 / 64 敏捷 / 65 智慧)取繁中 `client_strings` 的 `REQUIRES`(`需求: `)與 `REQUIRES_LINE` 裡的字 → `需求: 等級 ` + `80, 67 力量, 67 敏捷`;有未知 type 整行保留英文。
  - 三份補充資料各自載入,失敗只記錄、該部分維持英文。測試 `poe2/test/web/price-check/trade/display-zh-props.test.ts`。
  - **啟動後預先載入(2026-10-15,使用者回報重啟後第一次查價浮窗全英文)**:`scheduleDisplayZhPreload(realm)`(`@poe2-entry` 匯出),renderer `main.ts` 在 PoE2 資料載好後與 遊戲 / 資料語言 / 伺服器 / 介面語言 / 浮窗設定 改變時呼叫;符合翻譯條件且還沒載才排到 `requestIdleCallback`(最多等 5 秒;沒有就 `setTimeout` 2 秒),不拖慢啟動。查價時的背景載入仍是後備。量測(Node,同一份資料):整份載入約 50 ms、常駐約 6 MB(客戶端繁中時重用記憶體裡的 stats / items,增加更少);翻 21 件約 9 ms(第一次編 RegExp)/ 2.4 ms —— 與使用者 log 的記憶體 560 MB → 1.1 GB、1.4 秒 longtask 不在同一量級,不是它造成。

## PoE1 查價結果懸停浮窗(2026-10-15,計畫 `cheerful-riding-pearl.md`「二」)
- PoE1 原本沒有浮窗;移植 EE2(MIT)的 `TooltipItem.vue` / `TradeItem.vue` tippy 設定與 `parseFetchResult` / `parseModBlock` / `getTier`,改寫成 PoE1 版:
  `poe1/src/web/price-check/trade/display-item.ts`(`parseFetchItem`:PoE1 `frameType` → 稀有度、新格式詞綴依 `domain` 分到破裂 / 隨機 / 工藝區、舊格式字串以 `extended.hashes` 取 tier 與 trade id、
  勢力 / 破裂 / 追憶 / 分化 / 汙染 / 複製 / 未鑑定 → 底部標籤、插槽 `B-G B`、多值屬性各自上色;每行帶語言無關的 `key` 與 `tradeId`)、
  `TooltipItem.vue`(物品卡片;插槽以文字行顯示,不疊在圖示上 —— PoE1 插槽是顏色 + 連線,與 PoE2 `UiDetailedItemImg` 的符文插槽不同,故不共用)、
  `TradeItem.vue`(一筆掛單:長條 `<tr>` / 方塊 `.listing-tile` 原本寫在 TradeListing,搬過來並持有 tippy;設定照 PoE2:interactive、left、`appendTo` body、flip 後備;
  `itemHoverTooltip` off = 不建 tippy 也不畫掛點、keybind = 按住 Shift 才啟用、always)。合併掛單顯示 `groupedResults` 第一筆的物品。
- `pathofexile-trade.ts`:`FetchResult.item` 加 `FetchItem` 型別、`PricingResult.displayItem`、`requestResults` 解析(try / catch,失敗只記錄);**查詢組法不動**(golden-query 0 差異)。
- 繁中化 `poe1/.../trade/display-zh.ts`:演算法同上一節(PoE2 耦合點 15),改接 PoE1:`stats.ndjson` 有群組 → 攤平;
  台服交易站快照 `data/poe1/trade/tw/stats.json`(`node scripts/fetch-poe1-trade-data.mjs`,2026-10-15 抓一次,2.6 MB / 17757 條)當同旗標多寫法的決勝;
  類別行 / 屬性名 / 物品等級 / 插槽 / 需求行 / 底部標籤 → `data/poe1/item-classes/item-classes.json`(`node scripts/sync-poe1-item-classes.mjs --from ../Pob2/pob-zh-engine`:
  PoE1 GGPK `itemclasses` + `clientstrings` 白名單,GGPK 3.29.0.1)。PoE1 client_strings 沒有 `REQUIRES`,需求行改用 GGPK `ItemRequirementsLabel` / `Level` / `StrengthShort`…;
  依 `requirements[].type` 重組成 `需求 等級 68, 103 敏捷`。PoE1 `@/assets/data` 沒有 `LOADED_DATA` → 用 `ACTIVE_LANG` + `STATS_ITERATOR` / `ITEMS_ITERATOR` 重用目前繫結的語系。
  宿主注入 `configureDisplayZh({ options, source })`(renderer `main.ts`;CLI / 測試不注入 = 不翻),idle 預載 `scheduleDisplayZhPreload` 同 PoE2(`main.ts` 的 watch 擴及 PoE1)。
- 設定 › 查價「滑鼠懸停顯示物品」兩代都顯示(`hasItemHover` 一律 true)。
- 錄製:`poe1/test/docs/fetchResponses.json`(`node scripts/record-poe1-fetch.mjs`,2026-10-15 國際服 Standard 實查 6 類 × 2 件:稀有戒指 / 傳奇金縷帽 / 電弧寶石 / 破裂手套 / 工藝弓 / 塑者胸甲;
  已剝帳號名 / 角色名(→ sellerN)、whisper、倉庫、非標價備註)。覆蓋率:有 trade id 的詞綴 55 / 55 行全翻;寶石詞綴(回應沒有 hash)6 行保留英文、寶石標籤行與寶石屬性值(`20 (Max)`、`29 Mana`)保留英文。
- 測試:`poe1/test/display-item.test.ts`(P1)、`poe1/test/display-zh.test.ts`(P3–P5)、`renderer/test-vue/poe1-item-tooltip-mount.test.ts`(P6)、`renderer/test/price-check-options.test.ts`(P7)。
  **待使用者實機確認**:真實 overlay 浮窗位置、Shift 模式、繁中化結果與圖示載入。

## 通貨價格區(2026-10-02 第 24 步,使用者要求 PoE1 / PoE2 都要有)
- 元件:PoE2 `web/price-check/trends/PriceTrend.vue`、`stack-value/StackValue.vue`、`web/ui/CoreCurrencyImg.vue`(EE2 移植,檔頭 MIT 出處);PoE1 同名兩檔在 `poe1/src/web/price-check/{trends,expected-value}/`(APT 移植 + EE2 的成交量區塊)。兩代 `CheckedItem.vue` 把它們掛回原位(filter-name 之後 / 搜尋鈕與結果之後)。
- 改動(`exile-appraiser:` 註解):走勢圖 `vue3-apexcharts` → 手繪 SVG `renderer/src/web/ui/PriceSparkline.vue`(y 軸 drawMin / drawMax、面積填到底,漲 `--ok` 跌 `--bad` 持平 `--ink-3`;不加依賴);**只對 poe.ninja exchange 類顯示**(`cx` / `exchange`;傳奇等 item overview 不顯示);沒有價格整塊不顯示(上游的「? ×」後援刪掉);`trade_result.highest_volume` 只有 en → `ppz.highest_volume`、`/hr` → `ppz.per_hour`;外開 `window.open` → `Host.openExternal`;成交量顯示依設定 `priceCheck.currencyVolume`(`price-trend.ts` `volumeParts`)。
- 「漲跌 %」照上游:7 點走勢的標準差 × 2(不是 totalChange),箭頭依 7 點中正負個數 / 最後三點判斷。
- 價格源 / 單位見上表第 12 項與 `docs/ninja-poe2.md`「查價面板『通貨價格區』」。PoE2 剪貼簿查價也呼叫 `queuePricesFetch`(節流不變);台服 / 私人聯盟沒有價格表 → 整塊與 StackValue 都不顯示、不發 poe.ninja 請求。
- 設定 › 查價「通貨每小時成交量」四選一(不顯示 / 通貨 / 物品 / 兩者,預設兩者;兩代都顯示)。
- **連帶影響(價格源接上後 PoE2 開始有值,行為 = EE2)**:結果列「(X ex)」換算價(`pathofexile-trade.ts` `requestResults` 的 `normalizedPrice`;掛單幣別不是 ex / div 才顯示)、`ExtractionValue`(第一筆掛單低於「符文合計 − 萃取石」時紅框)、`ItemSumPrice`(物品編輯器 / 結果列的符文合計)、`FilterModifierAnointment`、`QualityEditor` 的觸媒總價。符文塑形 `priceOf` 不經這條路,行為不變。上游已知小毛病照舊:`normalizedPrice` 是 `displayRounding` 字串(小數點兩側有 hair space),`ExtractionValue` 以 `parseFloat` 讀回時小數會被截掉。
- 驗證:`core/test/ninja.test.ts`「走勢與成交量」、`core/test/units.test.ts`、`renderer/test/price-trend.test.ts`、`poe2/test/web/background/prices-adapter.test.ts`;畫面以無頭 Chrome + 假 `window.host`(錄製的 ninja 快照 + 錄製的 trade2 exchange 回應)截圖:PoE1 神聖石、PoE2 破裂石(錄製檔沒有 Delirium / 液態情緒類別)× 成交量「兩者」/「不顯示」、台服、PoE1 傳奇(不顯示)。

## 相關物品(2026-10-06,使用者要求「過去 APT 有的這個功能」)
- 元件:PoE2 `web/price-check/related-items/RelatedItems.vue`(EE2 移植)、PoE1 同名檔在 `poe1/src/web/price-check/related-items/`(APT 移植),兩者模板 / 樣式與上游相同;`getItemPrices` 等搬到 core `games/related-items.ts`(純函式、兩代共用),上游 id 找不到物品時整塊變英文 `Can't find "…"`,這裡改成略過那一筆 + log `[related]` 一次。
- 資料 `data/poe{1,2}/item-drop.json`(本來就同步進來);**耦合點 12 補充**:轉接殼 `web/background/Prices.ts` 的 `ITEM_DROP` 原本寫死空陣列,改成 getter 讀 `@/assets/data` 已載入的 `ITEM_DROP`(上游 EE2 由價格源附帶)。
- 接線(renderer `App.vue`,上游 PriceCheckWindow.vue 同位置):overlay 在側欄、緊貼查價面板、限流鈕上方(包 ErrorBoundary);window 模式沒有側欄 → 查價區 CheckedItem 下方;`relatedItemsComponent` 依 `loadedGame` 切兩代;**只在國際服**(價格只有 poe.ninja,台服整塊不出現)。
- 已知資料缺口(測試鎖數字):PoE1 2 筆(The Beachhead 系列傳奇地圖不在 items.ndjson)、PoE2 6 筆(`Techrod's Revenge`、`Zarokh's Reliquary Key: …`、`Sekhema's Resolve // Ring`、`Edyrns Tusks` 少撇號等)。
- 驗證:`poe1/test/related-items.test.ts`、`poe2/test/related-items.test.ts`(真實資料 + ninja 錄製檔 / 假價格源、全量 id 對照)、`renderer/test-vue/related-items-mount.test.ts`(兩代真掛載 + App.vue 接線守門)。

## 查價面板 B 改版(2026-10-14,設計稿 B,計畫 `cheerful-riding-pearl.md`)
使用者裁定:為了差異化,查價面板**呈現層**可直接改移植檔(推翻守則 6「只切耦合點」在這一層的限制);資料 / 查詢邏輯不動(`createPresets`、filters 資料結構、trade / bulk API),golden-query 快照 0 差異。改到的移植檔檔頭加一段「2026-10-14 B 改版:本檔呈現層已重寫」,不再逐處加 `// exile-appraiser:`。

### P3 詞綴卡片
- 共用元件(renderer `web/price-panel/`,移植檔以 `@/web/price-panel/…` 引用):`mod-cards.ts`(純函式 `splitModCards` / `modCardOf`:pseudo → 「偽屬性(總和)」卡、其餘 → 「詞綴」卡,PoE1 群組列看 `meta`;順序不變、已選數 = 沒停用的列)、`ModCard.vue`(卡片標題 + 「N / M 選用」,`data-card` / `data-part` 錨點)、`ModSwitch.vue`(`role="switch"` 開關)、`ModRange.vue`(最小–最大範圍膠囊,輸入框以具名插槽放入)、`ModSeg.vue`(二選一分段鈕)。顏色全用主題 token(`--edge-*`、`--surface-*`、`--ink-*`、`--gold*`),尺寸用 em。
- 兩代 `FiltersBlock.vue`:可見詞綴(`filteredStats`,含「顯示已隱藏」時)分兩張卡;詞綴卡另放未解析詞綴、空清單提示(PoE2 另有「無法判斷破裂詞綴」提示),只有偽屬性列時詞綴卡不畫;`report-inline mode="summary"` 掛點保留在卡片上方;預設組合改分段鈕、收合鈕改膠囊;隱藏 / 收合 / 詞綴來源切換照舊。物品標頭膠囊列(物品等級、品質、「已選 N 項」等 FilterBtn)維持在卡片上方。
- 兩代 `FilterModifier.vue`:勾選框 → `ModSwitch`(同一個 `toggleFilter`、同 `type`:PoE1 `submit`、PoE2 `button`,行為等同勾選);最小 / 最大 → `ModRange`(ref / v-model / focus / 右鍵清除 / 滾輪不變);偽屬性列的「偽屬性 x N」標籤改「來自 N 條詞綴」;未選用列文字變淡;第二列縮排由 `w-5` 改成開關寬度(`.lead`)。PoE2 的勾選框原本與文字同一顆按鈕,改成開關 + 文字按鈕兩顆(都呼叫 `toggleFilter`)。PoE1 群組展開時的未勾選提示動畫改在開關底色上。
- 兩代 `FilterModifierFractured.vue`(自寫):單一「破裂」切換鈕 → 「一般 / 破裂」二選一(`ModSeg`,`data-action="fractured-toggle"`、`data-choice`);邏輯仍是 `fractured-toggle.ts`,只新增呈現用包裝 `fracturedMode` / `selectFracturedMode`(選到目前那一邊不做事)。代表列 / 隱藏規則(`revealFracturedRows`)不變。
- 兩代 `FilterBtnLogical.vue` / `FilterBtnNumeric.vue`:外觀改膠囊(選用中 = 金色淡底),行為不變。
- 新字串(只新增 `ppz.*`):`ppz.mod_cards.{mods,pseudo,count,from_n,switch}`、`ppz.fractured_toggle.{normal,group,title_normal}`。
- 驗證:`renderer/test/mod-cards.test.ts`(分組純函式)、`renderer/test-vue/mod-cards-mount.test.ts`(兩代 FiltersBlock 真掛載:兩張卡 + 已選數、開關切換 `filter.disabled`、範圍膠囊、來自 N 條詞綴)、`renderer/test-vue/fractured-toggle-mount.test.ts`(二選一)。`test-vue/mini-dom.ts` 補了 no-op `addEventListener` 與 `<select>` 的 `options`(v-model 指令需要)。

### 實機後調整(2026-10-14)
- 一般物品頂端「建議售價」價格區(`PriceHero` `mode="item"`、`buildItemHero`、兩代 `price-hero-adapter.ts`、CheckedItem 讀 TradeListing ref 的接線)使用者看過實機後移除;一般物品只看掛單卡標題列「最低」。通貨市價卡 / 你的這一疊保留。
- 掛單卡被壓扁:CheckedItem 是 `.layout-column`(height 100%),掛單根節點 / 卡片帶 `min-h-0` 被 flex 壓到 22px、內層 `overflow-y-auto` 再裁掉掛單 → 兩代 TradeListing / TradeBulk 改 `.listing-root` / `.listing-card` / `.listing-body`(`flex: none`、不另開捲動區),跟著面板捲動。
- 金額 `fmtAmount(n, unit)`:div / exalted / mirror 保留一位小數(12.5 div 不再顯示 13)。
- 市價卡補回「底材」標示(有價值的底材,原本 ItemQuickPrice `#item` 插槽的 `:base_item`;新字串 `ppz.hero.base_item`)。
- 範圍膠囊「最小 / 最大」placeholder 與「–」改 `--ink-2`(placeholder 選擇器原本寫成 `:slotted(input::placeholder)`,編出來無效)。

## 魔法 / 稀有底材預設查 type(2026-10-15,使用者裁定,與 APT / EE2 不同)

使用者回報 PoE1 查術士手套 / 螺旋戒指 / 動能魔杖時預設只查類別(「類別:戒指」),結果混進其他底材。使用者原話:查詢內容本身照查價面板調整,「固定查底材只是為了確保查詢不出現其他底材」。

APT / EE2 規則:魔法 / 稀有走 pseudo preset,`searchRelaxed = { category, disabled: opts.exact }` → 預設查類別;另有工藝價值時多一個「底材」preset(預設不選)。

改法(兩代 `filters/create-item-filters.ts`,`// exile-appraiser:` 註解):`isMagicOrRareBase(item)`(魔法 / 稀有的武器 / 防具 / 飾品 / 箭袋,範圍同 `trends/getDetailsId.ts` `isValuableBasetype`;因 getDetailsId 反向 import 本檔,為免循環引用另寫一份)時 `searchRelaxed.disabled = true` —— 預設查該底材 `type`、不送 `category`,**不看物等、成品也一樣**。preset 仍是 pseudo,詞綴勾選 / DPS / 防禦等照上游;FilterName 點一下可切回類別。普通物品本來就查 `type`;珠寶、換界石、地圖、星團等不動。

(同日先試過「預設切到底材 preset」(commit 7236d68),會把詞綴與 DPS 換成底材 preset 的查法,使用者否決後撤回。)

影響(golden-query 逐筆比對 8294d40,每份只有 `type_filters.filters.category` 移除 + `query.type` 新增):PoE1 `en/ring-rare-01.query.intl`(Opal Ring);PoE2 `boots-rare-luxurious-slippers-01`、`helmet-rare-kamasan-tiara-01`、`spear-rare-soaring-spear-01`、`wand-rare-dueling-wand-01` 各 intl / tw + `en-` intl(共 12 份)。測試 `poe1/test/default-base-preset.test.ts`、`poe2/test/web/price-check/filters/default-base-preset.test.ts`;`poe2/test/zhTW/trade-query.test.ts`「sends English names/types」的法杖 / 便鞋改為預期 `type`。

## 工藝詞綴「一般 / 工藝」二選一(2026-10-16,使用者回報)

> **已被取代**(2026-10-16 同日):由下一段「詞綴全部列出 + 統一機制選擇」接手;`crafted-toggle.ts`、`FilterModifierCrafted.vue`、`ppz.crafted_toggle.*` 與三支測試已移除。以下保留當時的紀錄。

回報:PoE2 稀有藍寶石「海怪 裂毀者」的「增加20%法術暴擊傷害加成」是**已工藝**後綴,面板卻標「隨機」、送 `explicit.stat_274716455`。原因:`filters/create-stat-filters.ts` 有 explicit id 時把工藝併成 explicit 列,另推隱藏的工藝孿生(`crafted.stat_…`、`hide_for_crafting`)—— 與破裂同構。

做法(照「一般 / 破裂」):自寫 `filters/crafted-toggle.ts`(`craftedIds` / `canToggleCrafted` / `craftedMode` / `selectCraftedMode`)+ `FilterModifierCrafted.vue`(`ModSeg`,`ppz.crafted_toggle.*`),掛在 `FilterModifier.vue` 破裂二選一旁。只對可見、來源全部是工藝、同時有 explicit / crafted id 的非 pseudo 列;選工藝 = 改送 crafted id 並勾選、孿生取消勾選;選一般 = 換回 explicit。預設一般 = golden-query 0 差異。只做 PoE2(PoE1 工藝台詞綴本來就是獨立的工藝列);褻瀆同樣有隱藏孿生,可同法擴充。

上線實測(Forbidden Rites,四條不帶數值):一般 9 筆(1–36 div,交易站 explicit id 也命中工藝貨)、工藝 7 筆(1–20 div)。使用者實機回報「一般仍出現工藝詞綴」→ 一般且勾選時,`trade/pathofexile-trade.ts` 另加 `not` 群組排除這條的 crafted id(已有勾選中的列直接送同一組 crafted id 時不加,避免矛盾),實測一般 2 筆(27、36 div)+ 工藝 7 筆 = 原本 9 筆。同日先做過「無工藝詞綴」按鈕(整件物品排除工藝,條件須用 `not` 群組排除工藝數 ≥ 1,`max 0` 對無工藝掛單一筆都不中),使用者改採本做法後已 revert。測試 `poe2/test/web/price-check/filters/crafted-toggle.test.ts`、`renderer/test-vue/crafted-toggle-mount.test.ts`、`renderer/test/crafted-toggle-i18n.test.ts`。

## 詞綴全部列出 + 統一機制選擇(2026-10-16,計畫 `rustling-shimmying-charm.md`,PoE1 / PoE2)

回報(PoE2 胸甲「末日的 真實之衛」):防禦詞綴被併進護甲 / 閃避合計(`hide_used_in_prop`)、抗性與生命被偽屬性合計**直接丟掉**、工藝火焰抗性只剩隱藏孿生、符文詞綴被藏起。

**A 詞綴全部列出**(兩代 `filters/`):
- 偽屬性吃掉的詞綴:`create-stat-filters.ts` `initUiModFilters` 在 `filterPseudo` 前後比對 `ctx.statsByType`,被拿掉的照常產生自己的列(`pushAggregatedRows`)—— 可見、`disabled: true`、`revealed` + `fromAggregate`。可再製作的物品,沒有 explicit id 的破裂 / 褻瀆 / 工藝稍後會被推回自己的列,這裡略過。PoE1 另把 `filterEquipmentProps` 用掉的(防禦 / DPS 合計)同樣列出並標 `fromAggregate`(上游原本直接丟掉)。
- PoE2 防禦 / DPS 合計用掉的(`item-property.ts` `removeUsedStats`):不再設 `hide_used_in_prop`,改標 `revealed`(本來就以未勾選條件送出,查詢不變)。
- PoE2 傳奇的符文 / 增幅詞綴(`hideAllAugments`):不再 `hide_const_roll`,改標 `revealed`、預設不勾。
- `revealed` = preset 自動勾選(`enableAllFilters` / `enableGoodRolledFilters`、PoE1 Variant / Foulborn / Vestigial 預設勾選)跳過、傳奇「可見列 ≤ 3 全勾」不計入;`fromAggregate` = 未勾選時**不送進查詢**(兩代 `trade/pathofexile-trade.ts`,避免條件數暴增 / Query is too complex)。
- 破裂:`fractured-toggle.ts` `revealFracturedRows` 不拿 `fromAggregate` 列當代表列(照舊孿生 / pseudo 退路);已有代表列的同一條 `fromAggregate` 列收成 `hide_for_crafting` 免得重複;`canToggleFractured` 對 `fromAggregate` 列回 false。

**B 統一機制選擇**:兩代 `filters/mechanism-toggle.ts`(`mechanismOptions` / `mechanismMode` / `selectMechanism` / `mechanismNotIds`)+ `FilterModifierMechanism.vue`(`ModSeg`,`data-action="mechanism"`,`ppz.mechanism.*`),掛在 `FilterModifier.vue`,取代 PoE2「一般 / 工藝」二選一;一般列不再出現 `FilterModifierFractured`,只有 pseudo 退路列保留。
- 選項:非 pseudo / property、來源全部是隨機詞綴(PoE1:explicit / fractured / crafted;PoE2 另加 desecrated / rune(符文)/ added-rune)、stat 有 explicit id 的列 → `normal` + 該 stat 有 id 的機制(PoE1:破裂 / 工藝;PoE2:破裂 / 工藝 / 褻瀆 / 增幅 = `rune`);只有一般不顯示;固定 / 附魔不列。id 一律取自 `trade.ids[ModifierType.X]`。
- 只對魔法 / 稀有物品(主對話裁定):傳奇 / 普通、地圖類(PoE2 換界石 / 碑牌 / 地圖 / 地圖碎片;PoE1 地圖 / 異界地圖 / 邀請 / 探險日誌)不給選項。元件與 PoE2 查詢傳 item 判斷;兩代 `create-presets.ts` 另包一層 `markMechanismEligibility` 在不適用物品的列標 `noMechanism`(PoE1 `createTradeRequest` 沒有 item)。golden-query / en-client 0 差異。
- 模式由 tradeId 對應(PoE1 工藝台詞綴送 crafted id → 預設「工藝」;PoE2 符文列 → 「增幅」)。選非一般 = 改送該機制 ids、勾選、送同一組 ids 的孿生取消勾選;選一般 = 換回 explicit(勾選不動)。
- 「一般」排除(使用者 2026-10-16 裁定,code review 後改):**只排除該列「來源本身」的機制** —— 勾選中、模式一般、來源全部是單一機制 X(PoE1 破裂 / 工藝;PoE2 破裂 / 工藝 / 褻瀆)的列,`not` 只放該列 X 的 ids;一般隨機來源與符文(增幅)列不排除。原因:交易站 `not` 群組是「整件物品含該 stat id 即排除」,符文與隨機詞綴可同 stat 並存、PoE1 工藝混合詞綴亦同,排除其他機制會誤殺正常掛單(且 base_item preset 預設查詢會帶 not)。多列合併成**一個** `not` 群組(去重;已被勾選列直接送出的 id 不放)。PoE2 取代 v0.3.1 每列一組的工藝排除;PoE1 併進既有的 `qNot`。

**呈現(使用者實機回饋:機制按鈕太佔畫面、新列出的詞綴要另一區折疊;純呈現層,查詢組法不變)**:`renderer/src/web/price-panel/mod-cards.ts` `splitModCards` 多分「原始詞綴」卡(`raw`:`revealed` 且非 pseudo,PoE1 群組看 meta),兩代 `FiltersBlock.vue` 放在詞綴卡與偽屬性卡之間、`ModCard` `collapsible`(標題列 `data-part="card-toggle"`)、預設收起、換物品回收起;底部「機制」開關(`data-action="mechanism-visible"`,設定 `priceCheck.showMechanism`,預設關,`mechanism-visibility.ts` / `useShowMechanism.ts`)—— 關著時只有模式被改過(不等於該列原本機制 `mechanismDefault`:tag 本身是機制就是它,例如符文列 = 增幅、PoE1 工藝台詞綴 = 工藝,其餘一般)的列顯示機制按鈕。測試 `renderer/test/raw-card.test.ts`、`renderer/test-vue/raw-card-mount.test.ts`。

測試:`poe{1,2}/test/**/mechanism-toggle.test.ts`、`renderer/test-vue/mechanism-mount.test.ts`、`renderer/test/mechanism-i18n.test.ts`;破裂既有測試不動。

## 未做 / 待辦
- 預測價(PricePrediction)。
- GUI 實機(熱鍵 → overlay 附著 PoE2 視窗 → 台服真實掛單)由使用者實測。
- 交易站 data 快照是手動更新(`node scripts/fetch-poe2-trade-data.mjs`);新賽季要重跑。

## 相關文件
- [game-auto-switch.md](game-auto-switch.md)(PoE1/PoE2 自動切換)
- [regex-port.md](regex-port.md)(PoE2 的 Poe Regex 頁面)
- [phase2-summary.md](phase2-summary.md)(Phase 2 摘要)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
