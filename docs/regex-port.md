# Poe Regex 移植紀錄(`regex/` workspace)

來源:PobTools `pob-zh-engine/host/regex_gen.{h,cpp}`(597 行純演算法)、`regex_data.{h,cpp}`、`regex_state.{h,cpp}`、
`regex_selftest.cpp`(@ Pob2 repo `d9ef0b6`;資料最後異動 `df5c92c`)。同一作者自寫,**不含 poe.re 任何程式碼或資料**(poe.re 無 LICENSE)。

`@exile-appraiser/regex` 是純 TS(tsconfig `lib: es2022`,不含 dom):`gen` / `data` / `state` / `rng` 可在 renderer 與 Node 兩邊跑;
`node.ts`(讀檔)與 `cli.ts` 才用 Node API,renderer 不要 import `@exile-appraiser/regex/node`。
UI 在 `renderer/src/web/regex/`(見下方「UI」);UI 用的純邏輯(篩選、列文字、長度分級)在本 workspace 的 `view.ts`,有 vitest。

## 對應表

### `regex_gen.cpp` → `regex/src/gen.ts`

| C++(行號) | TS | 備註 |
|---|---|---|
| `kMeta` :14、`kNumChars` :19 | `kMeta`、`kNumChars` | 同字元集 |
| `IsNumChar` :21 | `isNumChar` | |
| `LowerAscii` :26 + `Fold` :30 | `fold` | 只摺 ASCII A–Z |
| `CharOffsets` :39 | `charOffsets` | 位元組偏移 → 碼點起點的 UTF-16 偏移 |
| `Line` :54、`Prepped` :58 | `Line`、`Prepped` | `Line.atoms` 是 TS 端快取 |
| `Prep` :63 | `prep` | 摺小寫、`#` 切片段、空行略過 |
| `Token` :83、`TokenHash` :94 | `Token`、`tokenKey` | 雜湊鍵 = `${head?'^':''}${body}${tail?'$':''}`(body 不含 `^$`,無碰撞) |
| `Render` :101 | `render` | 與 tokenKey 同字串 |
| `TokenChars` :110 | `tokenChars` | 碼點數 + 錨點 |
| `AlwaysMatchesLine` :121 | `alwaysMatchesLine` | 嚴格判是 |
| `Atom` :141、`Atoms` :146 | `Atom`、`atomsOf` | 每個字面**碼點**一個 atom(C++ 每個位元組) |
| `MatchFrom` :158 | `matchFrom` | `#` 至少吃一個數值字元 |
| `MayMatchLine` :179 | `mayMatchLine` | 寬鬆判否 |
| `AlwaysMatches` :192、`MayMatch` :199 | `alwaysMatches`、`mayMatch` | |
| `ForEachToken` :210 | `forEachToken` | 片段內 1–12 碼點 × 4 種錨點組合,含 kMeta 跳過 |
| `QuoteIfNeeded` :236 | `quoteIfNeeded` | |
| `ParseAlternation` :241 | `parseAlternation` | |
| `SplitTerms` :263 | `splitTerms` | |
| `Candidate` :281 | `Candidate` | 多存 `rendered` 省重算 |
| `CharCount` :291 | `charCount` | 碼點數(低位代理不計) |
| `Corpus::Impl::JoinsName` :325 | `Corpus.joinsName` | |
| `Corpus::Impl::Safe` :347 | `Corpus.safe` | 六條否決順序不變 |
| `Corpus::Reset` :383 | `Corpus.reset` / constructor | 三份索引:`index` / `hiddenIndex` / `ambientIndex` |
| `Corpus::Build` :445 | `Corpus.build` | `Result.tokens` 改名 `usedTokens` |
| `Corpus::Verify` :554 | `Corpus.verify` | |
| `Empty`/`Size`/`At` :379–381 | `empty()`/`size()`/`at()` | |
| `Mode::Any/All/None` | `'any' \| 'all' \| 'none'` | |

### 其他

| C++ | TS |
|---|---|
| `regex_data.cpp` `StringArray` :44、`NestedStringArray` :56、`LoadOne` :92 | `data.ts` `stringArray`、`nestedStringArray`、`parseRegexCatalogue` |
| `regex_data.cpp` `Load` :64(兩遊戲都載、偏好的排前面、一檔壞不拖垮另一檔) | `node.ts` `loadAllRegexPages` |
| `regex_tool_ui.cpp` `buildCorpus` :1059(語言退回 + hidden 跟著走) | `data.ts` `buildCorpus`(以 page 物件 + lang + 選項快取)、`entryLines`、`pageAmbient` |
| `regex_tool_ui.cpp` `KeyOf` :95、`ZhLine` :60、`collectKeys` :378、`applyKeys` :364 | `state.ts` `keyOf`、`zhLine`、`collectKeys`、`applyKeys` |
| `regex_state.cpp` `PicksFor` :60、`Load` :68、`Save` :137、`OneOf` :53、`RegexResolveKeys` :190 | `state.ts` `picksFor`、`parseRegexState`、`serializeRegexState`、`oneOf`、`resolveKeys` |
| `regex_selftest.cpp` `Rng` :55 | `rng.ts` `Rng`(`Math.imul` 做 32 位元乘法)、`samplePicks`(:715–723 的不重複抽樣) |

## 已知差異(皆不影響輸出;golden 與基準逐字相同即證據)

1. **UTF-8 位元組 vs 碼點**:C++ 的子字串、`find`、atom 都以位元組為單位,靠 `CharOffsets` 保證只在字元邊界切。
   合法 UTF-8 下「位元組比對 = 碼點比對」:多位元組字元的每個位元組 ≥ 0x80,不會等於 ASCII 語法字元(`kMeta`)或數值字元
   (`kNumChars`),所以 `#` 萬用只會吞 ASCII 數字;從字元中間開始比對一定失敗。TS 直接用碼點。
2. **字典序**:C++ `std::string <` 是位元組序(`char_traits<char>` 以 unsigned 比較),等於碼點序;TS 用 `lessCodePoint`
   逐碼點比,**不用** JS 的 `<`(UTF-16 序在 U+E000–U+FFFF vs 代理對時與碼點序不同;資料裡沒有,但照定義做)。
3. **fold**:兩邊都只摺 ASCII(遊戲搜尋列對中文無大小寫;全形/拉丁擴充字母兩邊都不摺)。
4. **`Atoms` 快取**:C++ 每次 `MayMatchLine` 重建,TS 存在 `Line.atoms`;純效能。
5. **型別不符的 JSON 欄位**:nlohmann `value()` 型別不符會丟例外、整個檔回滾;TS `parseRegexCatalogue` 同樣丟例外。
   `null` 值 TS 當缺鍵(nlohmann 會丟例外)——出貨資料沒有 null。
6. **state 檔案 IO**:C++ 在 `Save` 內做 temp + `MoveFileEx`;TS 只給字串(`serializeRegexState` = `dump(1, '\t')` 同縮排),
   原子寫入由呼叫端(main)做:`main/src/main.ts` 的 `regex-state-save` 寫 `userData/regex_state.json.tmp` → `fs.rename`(存檔排隊,不會兩個寫入搶同一個 .tmp)。

## UI(WP5,`renderer/src/web/regex/`)

掛在設定 › 正則(`settings/tabs/Regex.vue` → `RegexPanel.vue`)。版面照 PobTools `regex_tool_ui.cpp`,
PobTools 語彙(`.card .seg .chk .select .input .btn .pulse`):

| 檔案 | 內容 | 對應 C++ |
|---|---|---|
| `store.ts` | 模組層級單例:兩遊戲清單載入(`fetch('./data/regex/regex_<game>.json')`,dev 由 vite serveDataDir、prod 走 `app://`,一檔壞不拖垮另一檔)、每頁勾選 / 篩選、`RegexUiState` 記憶與書籤動作、debounce 300 ms 存檔 | `restoreState` :308、`picksChanged` :388、`switchGame` :1006、`loadBookmark` :832、`updateBookmark` :868、`commitName` :944 |
| `RegexPanel.vue` | 標題列(遊戲 `.seg`、清單下拉、模式三態、已勾選 N/M、雙語、頁 note)、載入中 `.pulse` / 失敗 `--bad` + 重試、輸出(唯讀多行、長度三色、複製、輸出語言、無法單獨指定、用到的片段)、提示訊息 | `drawHeader` :408、`drawOutput` :651 |
| `RegexList.vue` | 搜尋 / 分類 / T17 三態 / 全選(篩選後)/ 清除;自寫 windowing(列高依字級算成整數 px 並釘死,勾選浮頂);單一浮動提示框(全部行、來源詞綴、隱藏文字前 4 行) | `drawList` :493、`drawRow` :590、`drawEntryTooltip` :621 |
| `RegexBookmarks.vue` | 存成書籤 / 載入 / 更新 / 改名 / 刪除(`.modal` 確認),依遊戲過濾,另一遊戲筆數與孤兒書籤都明說 | `drawBookmarks` :737、`drawModals` :886 |

- **遊戲**:面板第一次打開跟 `AppConfig().game`;記住的頁屬於該遊戲才沿用(C++ 是記住的遊戲優先;本 app 會依執行中的遊戲自動切換,跟著目前遊戲比較直覺)。
- **語言**:主文字 / 語料跟「輸出語言」(`ui.lang`,存檔);頁名、分組名跟介面語言(`uiLanguage` = en 時用 `titleEn` / `groupsEn`);
  頁 note 資料檔只有中文,英文介面用 `ppz.regex.page_note.<page id>`。
- **持久化**:`Host.regexStateLoad/Save` → main `regex-state-load` / `regex-state-save`(`userData/regex_state.json`,tmp + rename);
  純瀏覽器退回 localStorage `exile-appraiser.regex_state`。目前勾選(`current`)也存,關掉再開仍在;還原不到的鍵計數顯示,不靜默丟。
- **i18n**:`renderer/src/i18n/{cmn-Hant,en}.json` 的 `ppz.regex.*`(中文沿用 PobTools 原字串)。
- **DOM 錨點**(驗證用):`[data-regex=panel|game|page|mode|count|search|group|t17|rows|query|length|over-limit|copy|lang|bookmarks|bm-*]`,
  列是 `label[data-id="<entry id>"]`。

### UI 驗證(2026-09-28)
- 無頭 Chrome(CDP,只用 DOM 事件)+ Vite 5173 + 假 `window.host`:PoE1 地圖 `--random 42,6 --mode any` 的 6 個 id 勾選 → 輸出與 CLI 逐字相同
  (zh 與 en 兩語);PoE2 換界石 `--random 7,5 --mode none` 同樣逐字相同;搜尋「反射」剩 2 列;T17 全部/只看/排除 = 125/35/90;
  全部都有 + 全選 = 375/250 紅字;書籤存 → 重整 → 載入回同一串;英文介面、淺色主題。
- Electron(打包佈局 main.js + preload.js + renderer/dist,`--window --user-data-dir=<暫存>`):renderer 存書籤 + 連發 5 次 `regexStateSave`
  → `regex_state.json` 可解析、含書籤與目前勾選、沒有 `.tmp` 殘留。

## 驗證

- `npm test --workspace regex`:合成 T1–T10、T13–T16(`synthetic.test.ts`)、T11–T12(`state.test.ts`)、
  真實資料性質(`properties.test.ts`:兩語言 × 六頁 × 三模式 × 120 輪 LCG,種子照 C++)、golden(`golden.test.ts`)、schema(`data.test.ts`)、面板純邏輯(`view.test.ts`:篩選、T17、勾選浮頂、長度分級、勾選 → 狀態字串 → 還原 → 同一串 query)。
- 基準來自 C++ 報告 `pob-zh-engine/dist/regex_selftest.txt`(222 PASS),由 `regex/test/golden/extract-from-report.mjs` 抽成
  `regex/test/golden/selftest-report.json`;對照項目:ambient 行數、10 選長度與逐字長度、單獨可指定數、卡住名稱(前 5)、
  「只因 hidden/ambient 卡住」數與名稱、繁中地圖「常」回歸、19 個合成逐字 query。**全部差 0**。
- 突變檢查(手動,2026-09-28):拿掉 `safe()` 的 hiddenIndex 否決 → 46 項紅;把平手的碼點序反過來 → 13 項紅。

## 資料同步(新賽季)

1. PobTools 端(維護者本機)重跑 `tools/gen_regex_data.py` / `gen_regex_data2.py` → commit `host/data/regex_poe*.json` →
   建置部署到 `pob-zh-engine/dist/Data/` → 跑 `pob-zh.exe --regex-selftest` 更新 `dist/regex_selftest.txt`。
2. 本 repo:`node scripts/sync-regex-data.mjs --from ../pob-zh-engine`
   - 守門:`dist/Data` 與 git 追蹤的 `host/data` 兩份必須逐位元組相同,且 `host/data/regex_*.json` 不得有未提交變更。
   - 逐位元組複製到 `data/regex/`,以 `verify-data-manifest.mjs --write --prefix data/regex --commit <HEAD>` 重寫 MANIFEST 該前綴。
3. `node regex/test/golden/extract-from-report.mjs ../pob-zh-engine/dist/regex_selftest.txt` 更新基準 → `npm test`。
   數量類斷言(data.test.ts 的 `EXPECTED`)也要跟著改;任何差異都要能用資料變更解釋。

## 相關文件
- [phase2-summary.md](phase2-summary.md)(WP5 摘要與待辦:逐字 golden)
- [release-flow.md](release-flow.md)(資料同步後照發版流程出版)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
