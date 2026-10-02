# 查價依物品文字自動判斷語言(第 27 步)

使用者回報(2026-10-03):客戶端語言設繁中、遊戲改成英文後,英文物品查價全部失敗,log 是
`解析(poe2) 失敗: item.wrong_language|English|正體中文`。

## 行為

| 伺服器 | 複製文字的語言 | 用哪個語系解析 |
|---|---|---|
| 國際服 | 與客戶端語言相同 | 客戶端語言(同改版前) |
| 國際服 | 與客戶端語言不同(繁中 ↔ 英文) | **文字的語言**(第一次另載該語系資料,之後快取) |
| 國際服 | 判斷不出(沒有名牌標頭、其他語言) | 客戶端語言(該報錯就照舊報錯) |
| 台服 | 任何 | 客戶端語言(台服只支援繁中;英文文字照舊提示語言不符) |

國際服的查詢一律用語言無關鍵(stat id、`refName`),所以「用文字的語言解析」的 trade query 與
「客戶端語言設對時」**逐字相同**(測試對全部第 23 步 fixture 斷言)。面板上的物品名 / 詞綴文字是該物品的語言
(就是解析結果);介面語言不變。設定頁「客戶端語言」下方有說明:國際服自動判斷,這個設定是預設值與台服用。

## 語言判斷

`core/src/realm/item-language.ts`(純函式):

- 標頭字串**取自各語系 `client_strings.js`** 的 `ITEM_CLASS`(`Item Class: ` / `物品種類: `)與 `RARITY`
  (`Rarity: ` / `稀有度: `)—— `markersFromClientStrings`;兩代各自從自己的資料讀。
- `detectItemTextLanguage`:只看名牌區(第一條 `--------` 之前、最多 4 個非空行);先比物品種類,沒有再比稀有度
  (PoE2 meta 技能寶石沒有物品種類行)。標頭後面必須接半形 `:` 或全形 `:`(與 PoE1 `normalizeLabelPunctuation` 一致),
  `物品稀有度:`(地圖詞綴)、`Rarityx:` 不算。兩種語言同時命中或都沒命中 → undefined。
- `chooseParseLanguage(realm, clientLanguage, detected)`:國際服 = `detected ?? clientLanguage`;台服 = `clientLanguage`。

## 資料怎麼載與快取

上游把語系資料放在 `@/assets/data` 的模組層級 `export let`(parser / filters 經 ESM live binding 讀),一個 process 一個語系。
兩代的 `assets/data/index.ts` 加了「每個語系一套繫結」(`// exile-appraiser(第 27 步)`):

- `LangDataSet` = 該語系的 `CLIENT_STRINGS`、items / stats 的查表函式與迭代器(PoE2 另含 augment / catalyst 衍生表);
  語言無關的 `ITEM_DROP`、`CLIENT_STRINGS_REF`、褻瀆 / 符文塑形資料、PoE2 `TRADE_*`(交易站快照)不在套內。
- `activateLangData(lang)`:有快取(同一個 DataSource)→ 整套賦值回去,不讀檔;沒有 → 照上游 `loadForLang` 本體載入後存起來。
  載入失敗 → 換回原本那一套再拋錯(不留半套)。語系只有 `en` / `cmn-Hant`,所以**最多兩套**(兩語系 items + stats 的 ndjson 合計:PoE1 約 8.1 MB、PoE2 約 5.1 MB;另一語系只在第一次遇到該語言的文字時才載)。
  DataSource 換了(renderer 改客戶端語言時會建新的)→ 舊快取全部作廢。
- `loadForLang(lang)` = 載入客戶端語言那一套並記為 primary(PoE2 `PRIMARY_DATA`、PoE1 `PRIMARY_LANG`);`LOADED_DATA` / `ACTIVE_LANG` = 目前繫結的那一套。
- adapter(`poe{1,2}/src/index.ts`):`prepareItemText(text, realm)` 判斷 → 選語系 → `activateLangData`;
  `dataLanguage()` = 目前資料集語系;`loadData` 與 `prepareItemText` **共用一個佇列**(兩個載入交錯會留下半套)。
  `loadData` 同語系(切遊戲回來)不換 DataSource,只換回 primary(兩套快取才不會作廢)。PoE2 另把 host 選項 `language`
  設成實際解析的語系(magic-name、錯語系提示讀它)。

## renderer 接線

- `App.vue` `load()` 改成 async:`prepareItemText` → 設 `dataLanguage`(`web/games/active.ts`)→ `parseClipboard`;
  等資料期間又來一件 → 較舊的那次不覆蓋(`loadSeq`)。log 會多一段 `[依文字改用 en 解析(客戶端 cmn-Hant)]`。
- `Config.useIntlSite`(送英文名與否)改依 `dataLanguage ?? language`:客戶端英文收到繁中物品時要送 `refName`,
  否則會把繁中名送進國際服。一鍵回報重算查詢同理。
- `main.ts`:載入完成 `dataLanguage = lang`;PoE2 host 選項 provider 不再給 `language`(由 adapter 依資料集設)。
- CLI(`scripts/check.mjs`)同樣先 `prepareItemText`(`--lang` = 客戶端語言;`--realm both` 以第一個 realm 決定),輸出多 `parseLanguage`。

## 連帶流程

| 流程 | 處理 |
|---|---|
| 拆粉(PoE1 `DustValue`、`calcDisenchantDust`) | 以 `refName` / 基數對接,語言無關,不需處理 |
| 褻瀆 Tier 推定(`desecration/infer.ts`) | stat hash + `refName` 對接,語言無關;進階複製以遊戲為準不動 |
| PoE2 查價結果懸停浮窗繁中(`display-zh.ts`) | 條件仍是國際服 + 介面繁中;重用 `LOADED_DATA`(目前那一套)與同一套迭代器,一致 |
| 揭露面板 OCR / 符文塑形(背景持續辨識) | 「客戶端語言」改取 `PRIMARY_DATA`(不跟著查價的物品語言換);符文塑形索引用 primary 的 items |
| PoE2 通貨價格區崇高石名稱、物品編輯器 | 讀目前那一套 → 顯示成該物品的語言(面板本來就是該物品的語言) |
| Regex | 自有資料,與查價資料集無關 |
| 物品編輯器的語言快取(`AugmentEditor` / `QualityEditor` watch `language`) | 每件物品重建元件(`:key="itemKey"`),快取不會跨語言 |

## 測試

- `core/test/item-language.test.ts`:標頭取自實際 client_strings、CRLF / 全形冒號 / meta 寶石 / 只看名牌區 / 其他語言、`chooseParseLanguage`。
- `poe2/test/auto-language.test.ts`:使用者那件 Gloom Hide(`Parser/fixtures/gloom-hide-rare-advanced.en.txt`)在客戶端繁中
  解析成功且 query 與客戶端英文逐字相同;第 23 步全部 en fixture(繁中客戶端)與 cmn-Hant fixture(英文客戶端)同上;
  host 選項 language 跟著換;OCR 語言不跟著換;第一次換語系才讀檔、之後(含改客戶端語言)零讀檔;台服仍 `item.wrong_language`;載入失敗回復。
- `poe1/test/auto-language.test.ts`:同上(PoE1 fixture;成對比對清單同 `en-client.test.ts`)。
- `renderer/test/auto-language.test.ts`:`useIntlSite` 依 `dataLanguage`、App / main / report 接線守門、設定頁字串。
