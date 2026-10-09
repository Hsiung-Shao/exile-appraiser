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
2. 本 repo:`node scripts/sync-regex-data.mjs --from ../Pob2/pob-zh-engine`
   - 守門:`dist/Data` 與 git 追蹤的 `host/data` 兩份必須逐位元組相同,且 `host/data/regex_*.json` 不得有未提交變更。
   - 逐位元組複製到 `data/regex/`,以 `verify-data-manifest.mjs --write --prefix data/regex --commit <HEAD>` 重寫 MANIFEST 該前綴。
3. `node regex/test/golden/extract-from-report.mjs ../Pob2/pob-zh-engine/dist/regex_selftest.txt` 更新基準 → `npm test`。
   數量類斷言(data.test.ts 的 `EXPECTED`)也要跟著改;任何差異都要能用資料變更解釋。

## WP-C:演算法頁 / 合併 / 分享碼 / 範本(2026-09-29)

全部自寫;**不參考 poe.re 原始碼**(無 LICENSE)。

### 資料 schema 2
- `regex_poe*.json` 頂層 `labels{zh,en}`(clientstrings 鍵 → 文字)、頁面 `kind`(`mods` / `names`)。`data.ts` 同時接受 schema 1(缺 `kind` = mods、缺 `labels` = null);未知 kind 當 mods。
- `normalizeLabel`:`{0}` → `#`、PoE2 的 `[Id|文字]` → 文字、`[Id]` → Id。
- 標籤合併 `mergeLabels(資料檔 labels, 暫代檔)`:資料檔**逐鍵優先**,暫代檔 `data/regex/labels.poe{1,2}.json` 只補缺鍵(PoE2 schema 2 目前缺 `ItemDisplayMap{Magic,Rare}MonsterQuantityBonus`、`ExperienceGained`、`MonsterEffectiveness`;`ItemPopupCorrupted` 早期也缺,2026-10-06 確認資料檔已有)。兩份都有的鍵在測試裡斷言逐字相同。
- 暫代檔產生:`node regex/scripts/gen-labels.mjs --from ../Pob2/pob-zh-engine`(讀 `tools/ggpk_zh/out/poe1/tables/clientstrings.json`、`tools/ggpk2_zh/out/poe2/tables/clientstrings.json` 的 `Text` 欄,以**鍵**取值、缺鍵 exit 1、與 `regex_poe*.json` ambient 行交叉比對),寫完以 `verify-data-manifest --write --prefix data/regex/labels.<game>.json` 各記一個來源(最長前綴歸屬,不併入 PobTools 同步的 `data/regex` 前綴)。`templates.json` 同樣自成一個前綴。

### 數值 → 正則(`regex/src/numeric.ts`)
`rangeRegex({min?, max?}, {digits: 1|2|3})`:依位數切等長區間 → 首位頭 / 中 / 尾三段遞迴拆成字元類序列 → 兩位數以上首位 `[1-9]` 換 `\d` → `P` 與 `X P` 合併成 `X?P` → 與逐一列舉比取短。只用 `\d [] ? | ()`(不用 `{n}`、不用大寫跳脫)。
測試(`numeric.test.ts`):digits 1/2/3 每個 N 的 ≥N、≤N(2220 組)、digits=2 全部 5050 個區間、digits=3 常見 + 3000 組 LCG 區間,每組對 0–999 逐值 `RegExp.test`,且長度 ≤ 樸素寫法。
第 35 步另有**可讀模式** `readableRangeRegex`(地圖 / 換界石數值區專用,見下方「第 35 步」);商店頁仍用 `rangeRegex`。

### 演算法頁(`regex/src/pages/`,kind `numeric` / `sockets`)
| 頁 | 遊戲 | 項目 |
|---|---|---|
| `map_numeric`(第 32 步起 = `map_mods` 頂端的數值區,不在下拉選單) | PoE1 | 地圖階級、物品數量、物品稀有度、怪物群大小、更多聖甲蟲 / 通貨 / 地圖 / 命運卡 |
| `waystone_numeric`(第 32 步起 = `waystone_mods` 頂端的數值區) | PoE2 | 換界石階級、物品稀有度、怪群大小、怪物稀有度、換界石掉落機率、魔法 / 稀有怪物、獲得經驗值、怪物效能 |
| `vendor_items` | PoE1 | 連結數 ≥(3–6L)、鏈接顏色(任意順序、需相鄰)、插槽顏色數 ≥、物品等級、品質、寶石等級 ≥、已汙染、勢力基底 |
| `vendor_items_poe2` | PoE2 | 物品等級、品質、寶石等級 ≥、已汙染 |
| `item_mod_values` / `item_mod_values_poe2`(第 37 步) | PoE1 / PoE2 | 物品詞綴數值(資料取自 stats.ndjson,第一次開頁才載入;見下方「第 37 步」) |

- 形狀與語料頁相同(`RegexPage` + entries),多 `input`(`range` / `select` / `colors` / `count`)與 `fragment(value, lang)`。鍵用**項目 id**(標籤文字會隨賽季變)。
- 屬性行片段(`propertyFragment`,**第 35 步起只剩商店頁用**;地圖 / 換界石數值區改用嚴格寫法,見「第 35 步」):≥ 百分比 `標籤.*數值%`;≥ 非百分比 `標籤.*[^\d]數值`;≤ / 區間 `標籤.*[^\d]數值(%|$)`。邊界推理見 `frag.ts` 註解;`pages.test.ts` 對 0–999、PoE1「：」/ PoE2 空白 / 剪貼簿「: 」與「+」逐值驗證。寶石等級行首錨定 `^等級`。
- 插槽:`.-.-.-.-.-.`(6L)、`r-(g-b|b-g)|…`(trie + 相同子樹合成字元類)、`插槽.*b.*b.*b`。⚠ **假設繁中客戶端插槽顯示 `R-G-B` 不翻譯,未實測**:這三項 `untested`,UI 標「待實測」。商店頁屬性行(物品等級、品質)的分隔字元仍未進遊戲確認;地圖 / 換界石數值區第 35 步起依社群實用寫法(下方)。

### 合併(`regex/src/combine.ts`)
- 語料頁依面板模式:any → 全部頁 token `|` 併成一個 term;all → 每 token 一個 term;none → 併進唯一的 `"!…"` term。演算法頁每個勾選各一個 term(AND)。自訂文字 → `escapeTerm` 跳脫後獨立 term(`unverified`)。排除詞 → 併進 none term(開頭 `!` 也跳脫)。順序:any、all、演算法、自訂、none。單一語料頁時與 `Corpus.build().query` 逐字相同(測試 3 模式 × 2 語言 × 20 組)。
- 驗證:參與的語料頁 **corpus 聯集**(entries 與 ambient 都聯集)對 `verifyQuery`(只含語料 token)做 `Verify`;跨頁誤中 → `extra` 衝突。演算法片段**不送進 Verify**(它把 term 當字面 token,片段裡的 `.`、`-`、數字在它的模型是數值字元,只會得到無意義的 extra),改以 `RegExp` 對聯集每一條詞綴行(`#` 代入 11 個樣本值)檢查 → `fragment` 衝突;排除詞命中已勾選詞綴 → `exclude` 衝突;輸入不成立 → `invalid`。
- 已知真衝突:PoE2「稀有怪物 ≥N%」會中聖物頁「稀有怪物減少 #% 傷害」(兩頁一起合併才會報)。
- 回傳 `perPage[{id, kind, picked, length, unresolved, fragments}]`(貢獻 = 片段字數 + 每片段 1 分隔)、`customLength`、`excludesLength`、`length`(整串碼點數)、`limit`(參與頁最小值,250)。

### 分享碼與範本(`regex/src/share.ts`、`data/regex/templates.json`)
- `ShareState = {v:2, game, mode, pages:{pageId:[鍵]}, sections:{宿主頁 id:[項目 id]}, numeric:{pageId 或宿主頁 id:{entryId:{min,max,choice}}}, custom[], excludes[]}`(v1 → v2 見下方「第 32 步」)→ JSON → gzip(`CompressionStream`)→ base64url(無填充,開頭 `H4sI`)。解碼:版本 / 遊戲不符丟例外;未知欄位與型別不符的欄位丟掉並回 warnings。`resolveState` 還原勾選,回報還原不到的鍵數與不存在的頁。
- 範本 7 組(PoE1:T17 危險詞綴、地圖無反射 / 無 -最大抗性、6L 商店、RGB 鏈接商店、探險日誌(排除難打詞綴);PoE2:換界石危險詞綴、碑牌高價值),雙語名稱 / 說明;測試斷言每個鍵都還原得到、兩語合併無衝突且不超長。⚠「探險日誌 高價值」:日誌清單只有怪物 / 玩家詞綴,沒有標示價值的行,所以做成「排除難打詞綴」。

### UI
- 標題列:遊戲 / **檢視**(`已選(合併)· N 頁` | `單頁清單`)/ 清單(下拉,附勾選數)/ 模式 / 雙語;第二列「套用範本…」下拉(套用前確認一次,覆蓋該遊戲全部頁)、「複製分享碼」、「貼上分享碼」(對話框,貼上 = 套用)。
- `RegexCombined.vue`:各頁勾選數 / 貢獻長度 / 無法單獨指定、自訂文字與排除詞 chips、衝突清單。`RegexAlgoList.vue`:演算法頁每列 勾選 + `.seg`(≥ / ≤ / 區間、選項)+ `.input.sm` + 片段預覽;改值自動勾選。
- 輸出區 `.seg` 合併 / 單頁(`outScope`,預設合併),合併時列出每頁貢獻。
- 狀態 schema 2(`state.ts`):`numeric`、`custom`、`excludes`、`outScope`、書籤的 `numeric`;schema 1 舊檔照讀。(第 32 步起 schema 3,見下)
- DOM 錨點新增:`[data-regex=view|template|template-dialog|template-ok|share-copy|share-paste|share-dialog|share-input|share-ok|out-scope|parts|conflict-count|combined|combined-pages|clear-all|custom-input|custom-add|excludes-input|excludes-add|excludes-remove|algo-list|algo-check-<id>|algo-op-<id>|algo-min-<id>|algo-max-<id>|algo-choice-<id>|algo-color-<id>-<c>|algo-frag|untested]`。

### WP-C 驗證(2026-09-29,headless Chrome + CDP,只用 DOM 事件)
PoE1 地圖詞綴 3 條 + 階級 ≥16 + 物品數量 ≥80 + 6L → `"成凋| 怪物傷| 怪物攻" 地圖階級.*[^\d](1[6-9]|[2-9]\d) 物品數量.*([89]\d|\d\d\d)% .-.-.-.-.-.`(77 字,每頁 13 / 51 / 12,與 combine.test 同一串);None + 排除詞「反射」→ 只有一個 `!`;分享碼複製 → 全部清除 → 貼上 → 同一串、同樣勾選;範本 T17 → map_mods 8 條、None;淺色、英文介面各截一張;console 無錯誤。

## 第 32 步:數值條件嵌進詞綴頁(2026-10-04)

使用者找不到獨立頁「地圖數值條件 / 換界石數值條件」(要另選頁再看合併)。改成 PoE1「地圖詞綴」(`map_mods`)/ PoE2「換界石詞綴」(`waystone_mods`)
頁頂端的可收合**數值區**,與詞綴輸出合成同一條正則;兩個獨立頁從頁面下拉選單移除。

### 內部模型(`regex/src/sections.ts`、`embed.ts`)
- 數值區仍是 `numericPages()` 的演算法頁物件(id `map_numeric` / `waystone_numeric` 只在內部用:合併的 `perPage`、golden 雜湊、CLI `--page`),
  多一個 `sectionOf`(宿主頁 id)。`listedPages()` = 下拉選單上的頁(去掉數值區);`sectionPageOf(pages, host)`;`hostIdOf()`(合併檢視的數值區列 → 宿主頁)。
- 合併:`combineOrder()` / `combineSels()` = 清單頁依序、**宿主頁後面緊接它的數值區**。`combine()` 的演算法 term 只依演算法頁的相對順序排列,數值區仍在商店頁之前
  → 與舊版「cat.pages = 語料頁 → 數值頁 → 商店頁」**逐字相同**(`combine.ts` 規則不變;limit / 衝突也相同)。單頁輸出(`outScope: page`)= 宿主頁 + 它的數值區。
- renderer store 的勾選仍以頁 id 為鍵(數值區 = 內部 id),值以**存放鍵** `numericKeyOf()`(數值區 = 宿主頁 id)存在 `ui.numeric`;
  狀態 ↔ 勾選 / 書籤 / 分享碼的轉換全部走 `embed.ts` 純函式(`savedPicksOf` / `bookmarkBodyOf` / `bookmarkApplyOf` / `shareStateOf` / `resolvedValues`),store 不另寫一套。

### 新格式與遷移(讀入一律轉成新結構,寫回一律新結構)
| 資料 | 舊(數值頁 id) | 新 |
|---|---|---|
| `regex_state.json` | schema 2:`current[{page:'map_numeric', keys:[項目 id]}]`、`numeric.map_numeric`、`page:'map_numeric'`、書籤 `page:'map_numeric'` | **schema 3**:宿主頁那筆 `current[{page:'map_mods', keys, alt, num:[項目 id]}]`、`numeric.map_mods`、`page:'map_mods'`;書籤 `{page:'map_mods', keys:[], alt:[], num, numeric}`;`collapsed:[宿主頁 id]`(收合的數值區,預設展開)。`parseRegexState` 內 `migrateSections()`;舊檔載入後 renderer 立刻寫回 schema 3 |
| 書籤 | 數值頁書籤 = 只有數值 | 宿主頁書籤 = **整頁快照**(詞綴 + 數值區):載入時兩者一起覆寫;舊的詞綴書籤(沒有 `num`)載入 = 數值區不勾 → 單頁輸出與當初存的一樣;只勾數值也能存 |
| 分享碼 | v1:`pages.map_numeric`、`numeric.map_numeric` | **v2**:`sections.map_mods`、`numeric.map_mods`。v1 照讀(`normalizeShareState` 內 `migrateShareSections()`);舊版程式讀 v2 會明確回「版本不符」 |
| 範本 `templates.json` | 同分享碼 v1 形狀 | 讀入同樣轉換;出貨的 7 組都沒有引用數值頁(檔案不需改) |
| 合併頁 | 下拉選單裡的「地圖數值條件」頁 | 合併檢視裡數值區自成一列(名稱沿用「地圖數值條件」),點它跳到宿主頁 |

### UI(`renderer/src/web/regex/RegexNumericSection.vue`)
- 宿主頁 = 數值區卡片(標題列:▾/▸、「數值條件」、`已設 N / M`、單頁輸出中的貢獻字數)+ 下方原本的詞綴清單。列 UI 重用 `RegexAlgoList.vue`(`embedded`;勾選 / 清除以 `page.id` 指定頁,不依賴目前頁)。
- 收合時標題列顯示已設條件摘要(`view.ts` `sectionSummary` / `condText`:`地圖階級 ≥16 · 物品數量 ≥80%`,輸入不成立標紅),沒有就「沒有設定數值條件」。
- 下拉選單的勾選數、書籤「存成書籤」可用條件、書籤列項數都含數值區。長度警示照原本三色(輸出區)。
- i18n `ppz.regex.section_{title,hint,expand,collapse,count,length,none}`(繁中 / 英文);英文頁說明 `page_note.{map,waystone}_numeric` 移除(頁已不在選單,實測提示改寫進 `section_hint`)。
- DOM 錨點:`[data-regex=section|section-toggle|section-count|section-length|section-summary|section-list|section-clear]`(數值區內的列沿用 `algo-check-<id>` 等)。

### 行為差異
- 宿主頁的**單頁輸出**現在含數值區(以前只有詞綴);合併輸出不變。
- 舊 state 記住的頁若是數值頁 → 改選宿主頁。
- 載入數值頁的舊書籤現在會一併把宿主頁的詞綴勾選清空(書籤 = 整頁快照);以前只動數值頁、詞綴頁不變。單頁輸出與當初相同。

### 測試
- `regex/test/sections.test.ts`:頁組成 / 順序;固定案例遷移(勾選、數值、記住的頁、書籤、可重複遷移、寫回無舊 id);兩遊戲 × 40 組隨機舊檔 × 2 語 × 3 模式
  合併輸出逐字相同(含再存再讀);舊書籤(數值 / 詞綴 / 商店)單頁輸出逐字相同;新書籤本體往返;兩遊戲 × 20 組 v1 舊分享碼 → v2 → 輸出逐字相同、再複製 v2 往返;
  舊格式範本;`templates.json` 無舊 id;`condText` / `sectionSummary`。突變檢查:把數值區改排到全部清單頁之後 → 6 項紅。
- `renderer/test/regex-section.test.ts`:字串兩語與參數、元件用到的鍵、接線守門。
- 既有 golden(`selftest-report.json`、`perf-equivalence.json`)與 `combine` / `pages` 測試不變(內部仍有 `map_numeric` 頁)。

## 第 33 步:書籤快捷存取 + 一鍵貼進遊戲(2026-10-04)

使用者覺得入口太深、複製再自己貼很麻煩。書籤不必打開正則分頁、不動目前的勾選,點一下 / 按一下熱鍵就把搜尋字串貼進遊戲搜尋列。

### 動作(一次點擊 / 一次熱鍵 = 一次搜尋)
1. 字串 = `regex/src/quick.ts` `bookmarkQuery`:書籤 → `bookmarkApplyOf` → `combineSels(…, 書籤頁)` → `combine`,**與「載入書籤後的單頁輸出」逐字相同**
   (宿主詞綴頁含數值區;數值只用書籤存的值,不混目前面板的值)。清單(~3 MB)第一次用到才載(`store.ts` `catalogueFor`)。
2. renderer `renderer/src/web/regex/quick.ts` → IPC `regex-paste`(`preview: false`)→ main `main/src/regex-paste.ts` `RegexPaster`:
   - 不能貼 → **只複製**並回原因:視窗模式(`window-mode`)、沒有附著的遊戲視窗(`no-game`)、遊戲與 overlay 都不在前景(`game-inactive`)。
     上一次還在送(`busy`)/ 空字串(`empty`)什麼都不做。
   - overlay 有焦點(從書籤列 / 快速面板點的)→ `assertGameActive`(electron-overlay-window `focusTarget`)→ 每 20 ms 看 `targetHasFocus`,
     最多等 800 ms(等不到 = 只複製 `focus-timeout`,**不對別的視窗送鍵**)→ 再等 80 ms → 送鍵。書籤熱鍵(遊戲本來就在前景)不等。
   - 寫剪貼簿(**不還原**,使用者要的是複製 + 貼上)→ 沿用倉庫搜尋的 `stashSearchSequence`:Ctrl+F → Ctrl+V → Enter。
   - 送鍵期間(含之後 250 ms)`StashScroll.quietCtrl(true)`:第五輪 30.1 的 Ctrl 輪詢器看得到我們自己送的 Ctrl,凍結掛鉤持有狀態,
     不為了這一下去 acquire uiohook 掛鉤。
3. 瀏覽器預覽 / 純瀏覽器:`Host.canRegexPaste` = false → renderer 用 `navigator.clipboard` 只複製(`preview`)。

### 三個入口
| 入口 | 檔案 | 說明 |
|---|---|---|
| 設定視窗旁的書籤列 | `RegexBookmarkBar.vue` + `quick-geom.ts` `placeBookmarkBar` | 設定 `regexBookmarkBar`(window 模式 / 瀏覽器預覽:設定填滿視窗 → 改成設定上方一條橫排 `inline`,點了只複製並顯示原因)(預設開,熱鍵與視窗分頁「正則書籤快捷存取」卡片可關)。在 App.vue 的 `.settings-layer` 暗幕裡,量設定視窗實際外框(ResizeObserver + MutationObserver 看 inline style = 拖曳中即時跟著):右側直排 → 左側 → 上方橫排 → 下方 → 都沒空間就不顯示;直排比可用高度高就捲動,橫排橫向捲動。點一下:貼上了 → 關設定(焦點已在遊戲);只複製 → 列底顯示原因 5 秒。沒有書籤時顯示「前往正則」 |
| 快速面板 | `RegexQuickPanel.vue` + `quickPanelKey` | 熱鍵 `hotkeyRegexQuick`(預設空 = 不註冊,overlay 限定)→ main `assertOverlayActive`(被閒置隱藏的 overlay 在 focus() 前先顯示)+ 事件 `regex-quick-open` → 面板。↑↓ / Home / End / PageUp / PageDown 選、Enter 執行、1–9 直接執行、Esc 關(overlay 的 Esc 由 main before-input-event 攔下 → 焦點回遊戲 → focus-change 關面板)、點外面關。貼上了自動關;只複製 → 面板留著顯示原因。overlay 失焦 / 收到物品 / 開框選層也關;overlay-content 回報多一欄 `quick` |
| 書籤個別熱鍵 | `RegexBookmarks.vue`(每個書籤一個 HotkeyInput)、`shortcut-actions.ts` `regex-bookmark` | 存在書籤上 `hotkey`(state **schema 4**;舊檔照讀、空白不寫出)。renderer 啟動就讀 `regex_state.json`(`ensureStateLoaded`,不載清單)→ `bookmark-hotkeys.ts` → host-config `regexBookmarkHotkeys`(`{index, name, game, hotkey}`)→ main 只註冊 `game` = 目前遊戲的(overlay 限定、接在倉庫搜尋與快速面板之後、先到先得、遊戲保留鍵不註冊)→ 觸發 = 先放開熱鍵按鍵 → 事件 `regex-bookmark-run` → renderer `findBookmark`(索引 + 名字,對不上以名字找)→ `regex-paste`(source `hotkey`)。沒貼成 / 找不到書籤 → main 右下角提示視窗(`regexToastMessage`) |

- 衝突:`hotkey-conflicts.ts` 多 `regexQuick` 與 `rxbm:<書籤索引>`(只算目前遊戲),熱鍵分頁、聊天指令分頁、書籤列表共用 `useHotkeyIssues`;熱鍵分頁另列目前遊戲的書籤熱鍵(唯讀)。
- i18n `ppz.regex.quick_*` / `bm_hotkey_tip`(繁中 / 英文);main 提示字串在 `regex-paste.ts`(同辨識開關通知的作法)。
- DOM 錨點:`[data-regex=quick-bar|quick-bar-item|quick-bar-empty|quick-bar-open-regex|quick-bar-notice|quick-bar-running|quick-layer|quick-panel|quick-list|quick-item|quick-empty|quick-notice|bm-hotkey]`、`[data-setting=regex-quick|regex-bookmark-bar|hotkey-regex-quick|regex-bm-hotkey]`。

### 行為差異
- regex_state.json 寫出 `schema: 4`;書籤多 `hotkey`。舊版程式讀新檔會忽略熱鍵(下次存檔就沒了),其餘相容。schema 3 檔載入**不會**為了版號立刻寫回。
- renderer 啟動時就讀 regex_state.json(以前是第一次打開正則分頁才讀);清單仍是用到才載。
- 書籤 = 存書籤當下的單頁輸出;用書籤列 / 快速面板 / 熱鍵執行**不會**改動正則分頁目前的勾選。

### 測試
- `regex/test/quick.test.ts`:兩遊戲 × 每個清單頁 × 隨機勾選 / 數值 / 模式 / 語言,`bookmarkQuery` = 存書籤當下的單頁輸出(逐字、長度、上限);熱鍵往返、schema 3 舊檔、`regexStateSchemaOf`、`bookmarkHotkeys` / `findBookmark`。
- `main/test/regex-paste.test.ts`:判斷優先序、送鍵序列(假剪貼簿 / 假送鍵 / 假焦點 / 假 sleep,**不送真實輸入**)、交還焦點後等待 / 逾時 / 中途切走、busy 不重入、quietCtrl、提示兩語、接線守門;
  `shortcut-actions.test.ts`(註冊條件、順序、另一遊戲 / 壞資料 / 保留鍵)、`stash-scroll.test.ts`(quietCtrl 凍結)、`overlay-idle.test.ts`(`quick`)。
- `renderer/test/regex-quick.test.ts`:`placeBookmarkBar`(右 / 左 / 上 / 下 / 不顯示、3000 組隨機不重疊不出界)、`quickPanelKey`、提示字串兩語與 vue-i18n 特殊字元、衝突表、設定往返 / host-config、接線守門;`overlay-content.test.ts`。
- 無頭 Chrome(CDP,假 `window.host` overlay 模式,只作用於無頭頁面):置中預設 → 右側直排;設定視窗貼右 → 左側;設定視窗幾乎全寬 → 上方橫排;沒有書籤 → 空狀態 +「前往正則」;
  淺色 + 英文介面;點書籤列 → `regexPaste {text, name, source: 'bar'}`、只複製顯示原因、貼上了關設定;快速面板 ↓↓ Enter → 第 3 筆、1 → 貼上後自動關、Esc 關;書籤熱鍵事件 → 對的書籤、找不到 → `missing`;host-config 帶目前全部書籤熱鍵。
- **真實遊戲內送鍵(Ctrl+F → 貼上 → Enter)、焦點交還時機、與倉庫頁籤捲動同時使用只能使用者實測**(守則 14)。

## 第 36 步:書籤資料夾 + PoE1 / PoE2 分頁管理(2026-10-04)

書籤多了以後一長串不好找;另一代的書籤要切遊戲才看得到。資料夾**只有一層**,依遊戲各自一組。

### 資料(`regex/src/folders.ts`、`state.ts`)
- 書籤 `folder`(空 = 未分類,不寫出);`regex_state.json` **schema 5** 多 `folders: {poe1: [{name, collapsed}], poe2: [...]}`(陣列順序 = 資料夾順序)
  與 `uncatCollapsed`(「未分類」收合的遊戲)。分享碼 / 範本格式不變;書籤熱鍵照舊屬於書籤本身。
- schema 1–4 舊檔讀入 = 全部未分類、沒有資料夾,**不為了升版號立刻寫回**(只有 schema ≤ 2 的數值頁遷移會寫回,第 32 步);
  舊版程式讀 schema 5 檔會忽略資料夾,書籤內容照讀。
- **順序不變式**:`ui.bookmarks` 裡同一遊戲的書籤永遠依「資料夾順序 → 未分類」排好(`sortBookmarks`,穩定排序,**只在該遊戲原本佔的格子裡換**,
  另一遊戲 / 孤兒書籤的索引不變)。所以畫面順序 = 陣列順序 = main 註冊書籤熱鍵的先後(先到先得)= 熱鍵總表的列順序,不另存排序。
- 讀入時 `normalizeFolders`:名稱正規化(去頭尾、合併空白、40 字)、去重 / 去空;書籤指向不存在的資料夾 → 補到清單最後(不丟);排好順序。
  補上遊戲的舊孤兒書籤(`onCatalogueReady`)也再整理一次。
- 純函式:`addFolder` / `renameFolder`(書籤跟著改)/ `deleteFolder`(書籤移回未分類,回傳數量)/ `moveFolderTo` / `moveFolderBy` /
  `setFolderCollapsed` / `moveBookmark(index, folder, before?)`(下拉選單 = 該資料夾最後;拖曳 = 放在某書籤前並進它的資料夾)/
  `moveBookmarkBy`(同資料夾內上移下移)/ `groupBookmarks(state, game, {skipEmpty})`(管理頁不略過空資料夾;書籤列 / 快速面板略過;
  只剩未分類一組 = `headers: false` = 不畫標題、收合無效 = 與第 36 步前相同外觀)。renderer store 包一層 `scheduleSave()`。

### 管理(設定 › 工具 › 正則 › 書籤卡,`RegexBookmarks.vue`)
- 上方 PoE1 / PoE2 分頁(帶筆數;預設 = 正則清單目前的遊戲 `selGame`,清單換遊戲時跟著換)。另一代的書籤可改名、刪除、設熱鍵、移資料夾、排序,不必切遊戲;
  「載入」= 正則清單切到那一代並載入(`loadBookmark` 本來就會切 `selGame`);「更新」用的是目前清單頁的勾選 → 書籤遊戲 ≠ 清單遊戲時停用並說明。
  熱鍵衝突提示只算 `AppConfig().game`(main 只註冊目前遊戲)。「存成書籤」存到清單目前的遊戲(未分類),分頁切過去。
- 依資料夾分組、標題可收合(▾ / ▸ + 筆數);新增 / 改名資料夾(對話框,空白 / 重名提示)、刪除資料夾(`.modal` 確認,書籤移回未分類)。
- 書籤移到資料夾:每列下拉選單 + 拖曳;排序:拖曳書籤 / 資料夾標題的握把 ⠿(pointer events + `setPointerCapture`,超過 4 px 才開始、Esc 取消、
  拖到清單上 / 下緣自動捲動;放在書籤上半 / 下半 = 插到前 / 後,放在資料夾標題或空資料夾 = 移到該資料夾最後;資料夾放在別的資料夾上半 / 下半 = 前 / 後)。
  鍵盤替代:書籤與資料夾都有上移 / 下移按鈕。
- 清單最高 32em 捲動(原本 240px);尺寸 em / `--fs-*`;兩個新對話框 Teleport 綁 `fsStyle` + `fsClass`(`.rx-modal` 已在 `:is()` 補高範圍內)。

### 書籤列 / 快速面板 / 熱鍵總表
- 書籤列(`RegexBookmarkBar.vue`)與快速面板(`RegexQuickPanel.vue`)依資料夾分組(`bookmarkGroupsOf(game, true)`:空資料夾不列、未分類最後;
  沒有資料夾時不畫標題),點標題收合 / 展開;收合狀態存 state,與管理頁共用並記住。
- 快速面板鍵盤改 `quick-geom.ts` `quickGroupedKey`(選擇以列鍵 `b:<索引>` / `h:<資料夾>` 記,收合後不跑掉):↑↓ 跳過展開的標題、收合的標題可停;
  ← 收合目前書籤所在的資料夾(選擇移到標題)、→ / Enter 在收合的標題上展開(選擇移到第一筆);1–9 照**看得見的**書籤順序;Enter / Esc 照舊。
  沒有資料夾時與舊 `quickPanelKey` 逐鍵相同(測試對照),← / → 不處理。有資料夾時提示列改 `quick_panel_hint_folders`。
- 熱鍵總表的書籤唯讀列標資料夾名(`資料夾 › 書籤`;`bookmark-hotkeys.ts` `regexBookmarkFolders`,**不進 host-config**)。
- 順手修:熱鍵總表的**選填**熱鍵(框選 ×2、符文暫停、快速面板;Config 預設空)「未設定」改灰字(`HotkeyInput` `optional` prop →
  `.is-empty.is-optional::placeholder` = `--ink-3`;`hotkey-table.ts` `OPTIONAL_HOTKEY_FIELDS` / 列 `optional`);紅字只留給必填與衝突 / 註冊失敗。
  書籤熱鍵欄、倉庫與聊天頁的聊天指令 / 倉庫搜尋熱鍵欄也用同一個 prop(書籤原本在 RegexBookmarks.vue 自己蓋顏色)。
- i18n `ppz.regex.{bm_title, bm_save_tip, bm_other_note, bm_load_other, bm_update_other, bm_drag, bm_up, bm_down, fd_*, quick_panel_hint_folders}`(繁中 / 英文);
  移除 `bookmarks`、`bm_elsewhere`、`bm_elsewhere_tip`(分頁取代「另一個遊戲還有 N 筆」)。
- DOM 錨點:`[data-regex=bm-tabs|bm-tab|bm-other-note|bm-groups|bm-folder|bm-folder-toggle|bm-folder-grip|bm-folder-up|bm-folder-down|bm-folder-rename|bm-folder-delete|bm-folder-empty|bm-folder-add|bm-folder-dialog|bm-folder-name|bm-folder-ok|bm-folder-error|bm-folder-delete-dialog|bm-folder-delete-ok|bm-grip|bm-folder-select|bm-up|bm-down|quick-bar-folder|quick-folder]`、`[data-hk-folder]`。

### 行為差異
- `regex_state.json` 寫出 `schema: 5`、`folders`、`uncatCollapsed`;書籤可能帶 `folder`。
- 書籤卡不再只列清單目前遊戲的書籤 + 「另一個遊戲還有 N 筆」,改成兩個分頁。
- 有資料夾時,同遊戲書籤的陣列順序會隨資料夾順序重排 → 書籤熱鍵的註冊先後(重鍵時誰贏)跟著畫面順序走;另一遊戲的書籤索引不受影響。
- 沒有建任何資料夾的使用者:書籤列 / 快速面板 / 熱鍵總表外觀與鍵盤操作與第 36 步前相同(只多了管理卡片的分頁與「新增資料夾」)。

### 測試
- `regex/test/folders.test.ts`:schema 1–4 舊檔 → 5 往返(全部未分類、書籤順序 / 鍵 / 熱鍵 / 數值不變、`bookmarkQuery` 逐字相同、熱鍵清單相同);schema 5 帶資料夾往返;
  壞資料整理;資料夾 CRUD / 排序 / 收合;書籤移動(下拉 / 拖曳 / 上下移、跨遊戲 / 孤兒不動、另一遊戲格子位置不動);分組顯示;
  **另一代書籤隨機編輯 30 輪 × 40 步 → 目前遊戲的清單 / 資料夾 / 索引 / 熱鍵清單逐項相同**;2000 步隨機操作不變式(書籤不增不減、順序、`normalizeFolders` 冪等、往返)。
- `renderer/test/regex-folders.test.ts`:`quickRows` / `quickGroupedKey` 跨分組鍵盤(含與舊 `quickPanelKey` 逐鍵對照)、字串兩語、接線守門(分頁、`setPointerCapture`、`.modal`、fs-own、無 rem、store 都 `scheduleSave`、資料夾名不進 host-config)。
- `renderer/test/settings-ia.test.ts`:選填熱鍵 = Config 預設空的欄位、灰字 / 紅字 CSS、書籤列標資料夾名;`settings-window-geom.test.ts` Teleport 對話框數 5 → 7。
- 無頭 Chrome(CDP,假 `window.host` overlay 模式,只作用於無頭頁面):管理頁 PoE1 / PoE2 分頁、書籤列分組與共用收合、新增資料夾對話框、快速面板分組
  (↓↓ → 收合的標題、← 收合、→ 展開)、熱鍵總表(資料夾名、選填灰字),石板 + 淺色;拖曳(書籤 → 資料夾標題、資料夾排序、書籤插到別的書籤前、拖到下緣自動捲動)、
  下拉選單移入、下移按鈕;另一代書籤的格子位置不變;console 0 錯誤。
- **真實 overlay 的拖曳手感、快速面板在遊戲前景時的 ← / → 只能使用者實測**。

## 第 35 步:數值區嚴格寫法 + 稀有度列(2026-10-04)
> 第 40 步(2026-10-06)起稀有度列擴充為「稀有度 | 汙染」條件列(稀有度可多選、併入汙染,舊值照讀),並加到其他頁;見「第 40 步」。

使用者提供社群在遊戲裡實際使用的寫法(= 遊戲搜尋列支援 `[:：]`、`\+`、`{n,}` 的證據):
`"稀有度[:：] *稀有" "物品稀有度[:：] *\+?([1-9]\d|[1-9]\d{2,}) *%" "怪群大小[:：] *\+?([2-9]\d|[1-9]\d{2,}) *%" "怪物效能[:：] *\+?([1-9]\d|[1-9]\d{2,}) *%" "怪物稀有度[:：] *\+?([5-9]|[1-9]\d{1,}) *%" "換界石掉落機率[:：] *\+?([5-9]\d|[1-9]\d{2,}) *%"`、`"階級 14"`。
舊片段 `標籤.*數值%` 的 `\d\d\d` 難讀,且 `.*` 有跨行誤判風險。**範圍:只有地圖 / 換界石數值區(`map_numeric` / `waystone_numeric`)**;商店頁(`vendor_items*`)與 `rangeRegex` 最短模式不變。

### 寫法(`regex/src/pages/frag.ts`)
| 片段 | 寫法 | 依據 |
|---|---|---|
| 百分比屬性行 `strictPropertyFragment` | `標籤[:：] *\+?<數值> *%` | 社群寫法;PoE1 繁中剪貼簿 `物品數量: +84% (augmented)`(`poe1/test/fixtures/cmn-Hant/map-*.txt`);PoE2 解析器前綴 `怪群大小: `(`data/poe2/cmn-Hant/client_strings.js`);PoE2 英文樣本 `Pack Size: +34% (augmented)` |
| 非百分比(匯出的通用版,目前數值區沒用) | `標籤[:：]? *\+?<數值>` + ≤ / 區間後界 `([^0-9]|$)` | ≥ 不需後界(吃到前段 ⇒ 整數更大) |
| 階級 `mapTierFragment` | 繁中 `階級 *<數值>）`、英文 `Tier <數值>\)` | **階級不在屬性行,在物品名稱尾端**:PoE1「地圖（階級 16）」(12 個繁中剪貼簿樣本都沒有「地圖階級」行;APT 解析器 `MAP_TIER = /（階級 (\d+)）$/` 也取自名稱)、PoE2「換界石（階級 14）」(`items.ndjson` 基底名稱;英文樣本 `waystone-rare-01.txt` 有 `Waystone (Tier 14)`、沒有 `Waystone Tier:` 行;社群「階級 14」比對的就是它)。繁中 ` *`:剪貼簿有空白、PobTools 語料行「地圖（階級#）」沒有,兩種都涵蓋 |
| 稀有度 `rarityFragment` | `稀有度[:：] *稀有` | 社群寫法;PoE1 剪貼簿 `稀有度: 稀有`。冒號後是文字,「物品稀有度: +50%」「怪物稀有度: +30%」不會中(不用 `^`,與社群寫法一致;測試對兩遊戲全部語料行與 0–999 證明) |

- 前界固定在冒號後,所以數值片段要**整段**比對整個數字 → `regex/src/numeric.ts` `readableRangeRegex`:只寫 `[0-9]`(使用者裁定,不寫 `\d`)、兩位數以上首位維持 `[1-9]`、百分比沒有上界 `[1-9][0-9]{n,}`(≥30 → `([3-9][0-9]|[1-9][0-9]{2,})`,≥100 → `[1-9][0-9]{2,}`);有 max / 階級(digits 2)= 有界,同 `rangeRegex` 拆法。
- 不用 `.*` → 標籤行數值不符時不會跨到下一行找數字。
- 片段含空白 → `combine` 照舊整個 term 加引號(和社群寫法一樣)。

### 稀有度列
- 數值區**最後**一列(既有列位置不變)`item_rarity_class`,select:一般 / 魔法 / 稀有 / 傳奇,預設「稀有」。標籤 `ItemDisplayStringRarity`、選項 `ItemDisplayString{Normal,Magic,Rare,Unique}`(clientstrings,兩遊戲同鍵;`gen-labels.mjs` KEYS 加這五鍵後重產 `labels.poe{1,2}.json`,既有鍵逐字不變)。
  ⚠ 「普通」的繁中:PoE1 =「普通」、PoE2 =「中」(各自 clientstrings 原文,與兩個剪貼簿解析器的 `RARITY_NORMAL` 相同);選項文字一律照 clientstrings,不自行翻成「一般」。
- 收合摘要 `condText`:select 顯示選項文字(以前顯示 id)。

### combine
- `AlgoEntry.ownLine`:語料行本身就是這個項目要比對的對象 → fragment 衝突檢查略過。階級項目用 `isTierNameLine`(`（階級 *#）` / `(Tier #)`):PoE1 地圖詞綴頁的隱藏行收了魔法地圖名稱「堅定的地圖（階級#）」,階級片段中它是對的。
- 以前「PoE2 稀有怪物 ≥N% 誤中聖物頁『稀有怪物減少 #% 傷害』」的已知衝突消失(片段要求冒號)。

### 行為差異
- **PoE1 階級**:舊 `地圖階級.*…` 在剪貼簿格式下沒有可中的行(名稱才有階級);新寫法比對名稱。⚠ T17「夢魘地圖」名稱沒有階級,任何階級條件都不會中它。
- **PoE2 階級**:舊 `換界石階級.*…` 改比對名稱「換界石（階級 N）」;「換界石階級: 16」這種行(若遊戲有)不再中。
- 百分比:真實格式的屬性行命中集合與舊片段相同(測試 ⑤);舊寫法誤中、新寫法不中的只有非屬性行,樣本中有 `地圖物品數量詞綴同時以 20% 的值影響凋落保險箱`、`物品數量以 20% 它的值增加圖拉克斯掉落獎勵的總量`、`Map's Item Quantity Modifiers also affect Blight Chest count at 25% value`(條件 ≤ / 區間時)。沒有冒號的「物品數量 +80%」、負值不再中。
- **長度變長**:百分比項目每條 +18~22 字(引號 2 + `[:：] *\+?` + `[1-9][0-9]{2,}` + ` *%`);階級 −1~−6;稀有度 13。數值區全勾預設:PoE1 197 → 364(不含稀有度 350)、PoE2 216 → 401(不含稀有度 387),超過 250 照舊三色警示。
- 舊書籤 / 分享碼 / state 只存項目 id 與數值 → 照常載入,輸出字串換成新寫法(sections / share / quick 測試照舊通過)。

### 測試
- `regex/test/strict-fragments.test.ts`:① 0–999 逐值 × 9 種分隔寫法(`:`/`：`/有無空白/有無 `+`/`(augmented)`/`% 前空白`)× 12 種條件、開放上界 1000+、無冒號 / 負值 / 別的標籤不中;② 跨行負例(`.` 跨行與不跨行兩種 flags 都不中,舊寫法在跨行假設下確實中);③ 稀有度:四選項 × 分隔、物品 / 怪物稀有度 0–999、兩遊戲全部語料行、PoE1 真實剪貼簿只中稀有度那行、condText;④ 階級:APT 解析器 / `items.ndjson` 16 個換界石名稱 / 剪貼簿樣本證據、0–99 合成名稱、語料行與詞綴說明「(階級: 1)」不中;⑤ 舊片段 vs 新片段命中集合。
- `numeric.test.ts`:可讀模式例子(社群同型)、open ≥ / ≤ 0–999 與 3000 組 LCG 區間對 0–9999 逐值、有界 digits 1/2 全部區間、不含 `\`、前導零不中。
- `pages.test.ts` / `combine.test.ts`:實際片段字串、合併字串與每頁貢獻改成新寫法。
- `perf-equivalence.json` 重產:804 鍵只有數值頁相關的 120 鍵變(說明在檔頭)。

## 第 37 步:物品詞綴數值頁(2026-10-04)

使用者:PoE1 常用正則是地圖、聖甲蟲、物品詞綴的數值;既有頁面沒有「物品詞綴數值」篩選。新增演算法頁 `item_mod_values`(PoE1)與
`item_mod_values_poe2`(PoE2;stats.ndjson 同構,同一套程式,成本低所以一併提供)。與其他演算法頁同一套機制(勾選 / 數值 / 合併 / 書籤 / 分享碼 / 快捷書籤)。

### 資料與收錄(`regex/src/pages/item-mods.ts`)
- 來源:`data/<game>/{cmn-Hant,en}/stats.ndjson`(APT / EE2 同步的 stat 表,本 repo 不改)。`parseStatsNdjson` 只留 `ref`、stat id、`dp`、matcher 字串(群組攤平)。
- **鍵 = 交易站 stat id(去掉類別前綴,例 `stat_3299347043`)**;兩語言各自讀檔、以 `statId|ref` 配對(不用列位置);
  同一 stat id 在資料裡有兩行不同 ref(例「增加 #% 暴擊率」與「增加 #% 全域暴擊率」)時,第二個以後的項目 id = `statId|ref`。
- 收錄條件:有 explicit / implicit / crafted / fractured 任一類 trade id;該語言恰好一條「非 negate、非固定值、恰好一個 `#`、單行」模板
  (多種寫法時取被其他寫法包含的那一種,例 PoE2「增加#%移動速度」⊂「玩家增加#%移動速度」);兩語言都找得到唯一片段。
  兩語模板都相同的不同 stat(同字的區域 / 全域詞綴)併成一列。
- 統計(2026-10-04 資料;`regex/test/item-mods.test.ts` 鎖住,資料同步後數字變了要看過再改):

| | 物品詞綴 | 可選 | 同字併列 | 多數值 | 多種寫法 | 小數 | 多行 | 太長 | 無唯一寫法 | 缺另一語 |
|---|---|---|---|---|---|---|---|---|---|---|
| PoE1 | 7550 | **4786** | 47 | 2129 | 86 | 149 | 142 | 209 | 2 | 0 |
| PoE2 | 1847 | **1198** | 0 | 441 | 135 | 30 | 35 | 6 | 0 | 2 |

  多數值 = 「附加 # 至 # 火焰傷害」這類兩個以上 `#`(本步不收,UI 與頁說明註明);太長 = 整行超過上限(繁中 40、英文 60 字;英文同樣辨識度約要 1.5 倍字數),
  在詞界往回縮也找不到夠短又唯一的寫法(幾乎全是英文長句,例「#% additional Physical Damage Reduction while affected by Determination」);
  無唯一寫法 = 放寬到 400 字仍分不開(PoE1 2 條)。

### 片段(`itemModFragment`)—— 預設整行,好讀優先
`^` + P + `\+?` + 數值 + S + `$`(實際輸出 `($| \()`,見下方「行尾標記」),例 `^\+?([89][0-9]|[1-9][0-9]{2,}) 最大生命$`、`^增加 \+?(2[5-9]|[3-9][0-9]|[1-9][0-9]{2,})% 移動速度$`:
- **協調者裁定(使用者 2026-10-04「寧可多幾個字也要好讀」)**:不截成最短唯一字(`最大生`、`火焰抗`、`移`、`to I` 讀不懂),
  預設 P = `#` 前整段文字 + 行首 `^`、S = `#` 後整段文字 + 行尾 `$`(PobTools 產生器同樣以行為單位使用 `^` / `$`)。
- 整行超過長度上限才往回縮:可拿掉錨點、P 只能從詞界開始、S 只能在詞界結束(`isWordBreak`:空白與標點;**繁中沒有標點就不縮** —— 寧可整條不收,
  不以單字為單位切),在仍**唯一**的候選裡取最長(縮最少)。PoE1 + PoE2 共 11968 組(詞綴 × 語言)中 9489 組是整行;
  縮過的例子:繁中「當你施放詛咒法術時，有 \+?N% 機率觸發插槽中的詛咒法術，有 0\.25 秒冷卻時間」(去掉錨點)、英文「^\+?N% chance for Energy Shield Recharge to start when you Kill」(在空白處截)。
- 數值 = `readableRangeRegex`(第 35 步;只寫 `[0-9]`;≥ 開放上界 `[1-9][0-9]{n,}`;≤ / 區間上限最多 999,超過 = 條件不成立,不悄悄夾成 999)。
- 邊界:≥ 不需要;≤ / 區間在沒有 P 時補前界 `(^|[^0-9])`、沒有 S 時補後界 `([^0-9]|$)`。
- `\+?`:ref 或模板寫 `+#`、或 P 不是空的、或有行首錨點時加。
- 與第一版(最短唯一字)比較(兩版都有的詞綴、條件 ≥30 的平均片段長度):PoE1 繁中 38.1 → 50.1、英文 56.4 → 79.9;PoE2 繁中 35.8 → 47.2、英文 51.6 → 77.1。
  可選數 PoE1 4905 → 4786(−121 太長,+2 原本無唯一寫法)、PoE2 1202 → 1198(−4,例「Notable Passive Skills in Radius also grant #% increased maximum Life」)。

### 唯一性(`buildModIndex` / `chooseAnchor`,結構化判斷)
- 語料 = 該語言**全部** stat 的全部 matcher 行(全部類別:含 enchant / pseudo / negate / 固定值;多行拆開);英文摺小寫。
- 每行拆成「數字位置」(`#` 或字面數字串);片段能命中某行 ⇔ 某個數字位置「前文以 P 結尾、後文以 S 開頭」(`#` 前的 `+`、字面數字前的 `+` 都當可有可無;
  別行的 `#` 可對上 P / S 裡的整串數字 → 一律當衝突,保守)。
- 例外(不算誤中):與自己文字相同的行(英文不分大小寫)、同一 stat 的非 negate 行(固定值寫法「1 個附加的天賦為珠寶插槽」)。negate 行(「減少 #% 移動速度」)算衝突。
- 演算法:後文依字典序排序,每個候選 S(整段 + `$`、各詞界)用二分取得衝突區間,再算 P 至少要多長 / 是否要行首錨點,P 只取詞界起點。
  renderer 實測 PoE1 讀檔 + 解析 + 建索引 + 選錨點約 0.5 秒(Node 約 0.4 秒,PoE2 約 0.1 秒)。

### 載入時機(renderer `store.ts`)
- 清單載入時只放一個**沒有項目**的頁(`itemModPage(game, null)`,下拉選單看得到);第一次選到它、或存檔 / 書籤 / 分享碼 / 範本 / 快捷書籤引用它時,
  `ensureItemMods` 才 fetch 兩語 stats.ndjson(各 ~2.5 MB)→ `buildItemModData` → 換掉清單裡的空頁(`slot.cat` 換新物件,computed 全部重算)→ 還原那一頁的勾選。
  沒載入前不還原那一頁(否則存檔的鍵會被當成「還原不到」)。解析後只留模板與錨點,原始字串丟掉。

### UI(`renderer/src/web/regex/RegexItemModList.vue`)
- 搜尋框(繁中模板 / 英文 ref / 英文模板,空白分隔多個字全部要出現)+ 分類下拉(生命 / 魔力 / 能量護盾 / 抗性 / 屬性 / 攻速施速 / 傷害 / 移速 / 其他,附數量)+「只看已勾選」。
  分類是純函式 `itemModCategory(ref)`(英文 ref 關鍵字,先符合先贏:移速 → 抗性 → 屬性 → 能量護盾 → 生命 → 魔力 → 攻速施速 → 傷害 → 其他)。
- 篩選 `filterItemMods`:已勾選的永遠在最上面,其餘最多 150 列(提示「還有 N 條符合」);列 UI 沿用 `RegexAlgoList.vue`(新 prop `rows-only` / `hint`)。
- 長度警示照既有三色;i18n `ppz.regex.imv_*`(繁中 / 英文)、英文頁說明 `page_note.item_mod_values(_poe2)`。
- DOM 錨點:`[data-regex=imv|imv-loading|imv-error|imv-retry|imv-search|imv-group|imv-picked-only|imv-count|imv-note|imv-more|imv-empty]`(列沿用 `algo-check-<id>` 等)。

### 已知限制
- 只收單一數值詞綴;小數詞綴(`dp`)不收;負值(「-5% 火焰抗性」)在 ≥ 條件下會被當成正數命中(片段不看 `-`)。
- 唯一性只對 stats 模板語料保證;物品名稱、屬性行(物品等級、品質…)、詞綴說明不在語料內。
- 多種寫法取「被包含的那一種」:片段帶 `^` 時較長的寫法不會中(PoE2 移動速度的「玩家增加#%移動速度」)。互不包含的改查仲裁檔,見下方「多種寫法仲裁」。
- 遊戲內 `^` / `$` 以行為單位:2026-10-09 使用者在 PoE2 繁中實測成立(`^增加238`、`238%法術傷害$` 對一般行都中);PoE2 繁中模板數字後沒有空白(`#最大生命`)同樣命中。

### 行尾標記(2026-10-09 使用者回報「破裂詞綴搜不到」)
- 遊戲搜尋文字在**破裂**詞綴行的文字後面多一段「空白 + 括號標記」(剪貼簿對應 ` (fractured)`;搜尋 `已破裂`、`fractured` 都會中該物品)。
  實測(PoE2 繁中、破裂「增加238%法術傷害」):`增加238%法術傷害` 中、`^增加238` 中、`238%法術傷害$` **不中**、`法術傷害 \(` 中、`法術傷害\(` 不中。
- 修正:片段的行尾錨點輸出 `LINE_END` = `($| \()`(行尾或接著「空白 + 左括號」;每條多 5 字,片段含空白 → `combine` 照既有規則包引號)。
  固定 / 工藝 / 符文等行若有同樣的標記也一併涵蓋(未逐一實測)。
- 唯一性:整段後文的衝突另加「本行文字 + ` (`…」的模板(`conflictsOf`、`afterMatches` exact);錨點挑選與 `cost` 仍以 `$` 一字計 → 收錄與排除統計不變。
- 測試:`regex/test/item-mods-marker.test.ts`(破裂行重現、一般行不變、非標記尾巴不放行、兩遊戲 × 兩語全量「自身加四種標記要中 / 他行與其加標記版 0 命中」、英文)。

### 多種寫法仲裁(2026-10-10,`data/regex/item-mod-forms.json`)
- 問題:同一 stat 有多種單一 `#` 寫法、且沒有一種被其他每一種包含時,原本一律排除(`multi_form`;PoE2 135 條、PoE1 87 條),例如 PoE2「增加#%施法速度 / 增加#%施放速度」、「增加#%格擋率 / 增加#%格擋機率」。
- 仲裁檔:`regex/scripts/gen-item-mod-forms.mjs` 由 poe2db / poedb(tw / us)產生(不手改,MANIFEST 有一項);格式 `{schema:1, fetchedAt, sources, note, poe1:{zh:{…}, en:{…}}, poe2:{…}}`,
  鍵 = `<statId>|<ref>`(= `keyOfStat`),值 = 網站上查得到的寫法(stats.ndjson 原 matcher 字串、原順序)。
  解析 = 純函式 `parseItemModForms(text, game)`(格式不符回 `null`);`buildItemModData(game, zh, en, forms?)` 第 4 參數省略 / `null` = 舊行為。
  `node.ts loadItemModData` 有檔就帶入;renderer `store.ts ensureItemMods` 與兩語 stats.ndjson 並行 fetch,失敗或格式不符只 log 一行 `[regex] item-mod-forms.json …`、退回沒有仲裁(不讓整頁載入失敗)。
- 規則(`templateOf`,中英各自查自己那一語的仲裁):
  1. 原本「被包含寫法」能決定的維持原狀,不看仲裁檔。
  2. 否則仲裁檔沒有該鍵 → 維持 `multi_form`。
  3. 仲裁只有一種 → 用它當模板,走原本的 `chooseAnchor`(可縮短;同 stat 其他寫法照舊不算誤中)。只有一種但多行 → `multiline`。
  4. 仲裁多種 → **一律交替**(取所有寫法的字元級共同前綴 / 共同後綴,中間差異段寫成群組:兩種且一種為空 → `(X)?`,否則 `(A|B)`;遊戲正則不用 `(?:`)。
     例:`^增加\+?N%格擋(機)?率($| \()`、`^\+?N% increased Gold found in (Map|this Area)($| \()`。差異段含 `#` 或任一寫法多行 → `multi_form`。
     **與需求原稿的差異**:原稿是「仲裁多種先套規則 1(彼此包含取被包含者)」;但仲裁寫法用整行錨點,較短那種的整行片段中不了較長的寫法
     (PoE2 英文「#% increased Pack Size」整行不中「#% increased Pack Size in Map」,T6 會紅),所以彼此包含也走交替(差異段之一為空 → `( in Map)?`)。
- 交替的表示:`ModAnchor.alt = { side: 'p'|'s', at, len, opts }`(選填;`p` / `s` 仍是第一種寫法的原字形,`side` 那段第 `at` 起 `len` 字換成群組),
  `itemModFragment` 組字串時展開;沒有 `alt` = 舊輸出逐字相同。`cost` 含群組字元。
- 唯一性:每種仲裁寫法各自以**整行**(行首 + 行尾錨點、不縮短)過一次 `chooseAnchor`(上限放寬,只看整行是否唯一);交替只會命中這幾種寫法本身,逐一驗證 = 整條驗證。
  任一寫法整行不唯一 → 排除,原因沿用既有分類(放寬到 400 字仍不行 = `no_unique`)。
- 長度上限:**組合後**片段(P + S 含交替群組,跳脫後,+ `^` `$` 各一字)不得超過 `MAX_ANCHOR_TEXT`(繁中 40 / 英文 60);超過 = `too_long`。格擋、Gold found in Map 等都在上限內,不需改成「每種寫法各自計」。
- 收錄變化(兩語都要有錨點才收):PoE2 entries 1198 → 1294、`multi_form` 135 → 33、`too_long` 6 → 12;PoE1 entries 4785 → 4854、`multi_form` 87 → 12、`multiline` 142 → 144、`too_long` 209 → 213。
  仍 `multi_form`:PoE2 = 仲裁檔沒有該鍵 12(繁中 11、英文 1)+ 差異段含 `#` 21(繁中 14、英文 7;例「Map contains # additional Strongboxes」三種繁中寫法 `#` 位置不同);
  PoE1 = 仲裁檔沒有該鍵 11(繁中 3、英文 8)+ 差異段含 `#` 1。
- 測試:`regex/test/item-mod-forms.test.ts`(施法速度只用仲裁寫法、交替兩種都中且不放行其他字、`#` 在差異段仍排除、單一仲裁收錄、查無仍排除、
  兩遊戲 × 兩語全量「每種仲裁寫法 × 16 數值 × 有無 `+` × 有無破裂標記都中 / 其他模板 0 命中」、英文不分大小寫、仲裁檔格式與 MANIFEST、收錄統計、沒有仲裁參數 = 舊數字)。

### 測試
- `regex/test/item-mods.test.ts`:
  ① 唯一性**全量**:每個可選詞綴 × 兩語,片段數值換成 `[0-9]+`,對該語言全部模板行(`#` 代入 16 種數值 × 有無 `+`)用真 RegExp 測;
     先以片段字面文字篩候選行(不含它的行不可能命中,篩選是證明不是抽樣)。PoE1 繁中 174837 行 / 555 萬個實例、英文 213070 行 / 674 萬;PoE2 繁中 10460 / 33 萬、英文 13015 / 41 萬,0 命中。
  ② 自身模板逐值:每條 × 兩語,輪替一種條件(≥ / ≤ / 區間)0–999 逐值 + 1000 以上,另兩種條件在門檻 ±3、0、999、1000、12345 抽查;有無 `+` 兩種寫法(PoE1 9572 組 + 19144 組邊界、PoE2 2396 + 4792)。
     常用 10 條三種條件 × 11 組門檻全部逐值。
  ③ 好讀守門:P / S 是模板原文、起訖在詞界、錨點 = 整段;整行沒超過上限就一定是整行。
  ④ 排除統計(鎖數字)、id 唯一、長度上限、條件不成立、分類、篩選、頁 id 不撞既有頁、書籤往返(單頁輸出逐字相同)、分享碼往返(鍵 = stat id)、與地圖詞綴頁合併無 fragment 衝突。
- `renderer/test/regex-item-mods.test.ts`:字串兩語 / 參數 / vue-i18n 特殊字元、元件鍵、接線守門(只放空頁、第一次才 fetch、沒載入不還原、書籤 / 分享碼 / 範本 / 快捷書籤先載)。
- 瀏覽器(Vite dev,只用 DOM 事件;第一版):選頁 → 約 0.5 秒載入、搜尋「最大生命」/「火焰抗性」勾選設值 → 合併輸出兩個片段。

### PoE1 常用 10 條(預設門檻;第一版 → 現行)
| 詞綴 | 繁中(第一版 → 現行) | 英文現行 |
|---|---|---|
| 最大生命 ≥ 80 | `… 最大生` → `^\+?([89][0-9]\|[1-9][0-9]{2,}) 最大生命$` | `^\+?([89][0-9]\|[1-9][0-9]{2,}) to maximum Life$` |
| 火焰抗性 ≥ 30 | `… 火焰抗` → `^\+?([3-9][0-9]\|[1-9][0-9]{2,})% 火焰抗性$` | `…% to Fire Resistance$` |
| 冰冷抗性 ≥ 30 | `… 冰冷抗` → `^\+?([3-9][0-9]\|[1-9][0-9]{2,})% 冰冷抗性$` | `…% to Cold Resistance$` |
| 閃電抗性 ≥ 30 | `… 閃電抗` → `^\+?([3-9][0-9]\|[1-9][0-9]{2,})% 閃電抗性$` | `…% to Lightning Resistance$` |
| 混沌抗性 ≥ 20 | `… 混沌抗` → `^\+?([2-9][0-9]\|[1-9][0-9]{2,})% 混沌抗性$` | `…% to Chaos Resistance$` |
| 全部元素抗性 ≥ 10 | `… 全部元` → `^\+?[1-9][0-9]{1,}% 全部元素抗性$` | `…% to all Elemental Resistances$` |
| 力量 ≥ 30 | 不變 `^\+?([3-9][0-9]\|[1-9][0-9]{2,}) 力量$` | `… to Strength$` |
| 敏捷 ≥ 30 | 不變 `… 敏捷$` | `… to Dexterity$` |
| 智慧 ≥ 30 | 不變 `… 智慧$` | `… to Intelligence$`(第一版 `… to I`) |
| 移動速度 ≥ 25 | `… 移` → `^增加 \+?(2[5-9]\|[3-9][0-9]\|[1-9][0-9]{2,})% 移動速度$` | `…% increased Movement Speed$` |

為什麼要 `^`:「`# 最大生命`」也出現在「每級 # 最大生命」「裝備中每個空的紅色插槽，# 最大生命」「每 10 點智慧 # 最大生命」等行尾,
「% 火焰抗性」也出現在「每 1% 火焰抗性 #% 混沌抗性」,只有行首錨點能分開;使用者範例 `\+?([89][0-9]|[1-9][0-9]{2,}) 最大生命` 會誤中這些行。

## 第 40 步:稀有度 | 汙染條件列(2026-10-06)
使用者轉述 Discord 回饋(keiyada):要有一排稀有度按鈕、地圖要能指定是否腐化。
第一版做成面板頂端的全域多選按鈕 + 數值區獨立汙染列(未 commit),使用者看過後裁定:**稀有度維持舊版「數值區裡一列」的做法,
同一列併入汙染(`普通 魔法 稀有 傳奇 | 未汙染 已汙染`),再擴充到其他用得到的頁**;全域按鈕撤回。

### 條件列(`regex/src/rarity.ts`,input kind `rarity`)
- 稀有度**可多選**、汙染**二選一可都不選**(再點同一個 = 取消);兩組 `.seg` 中間一條分隔線(`RegexAlgoList.vue`,`.rx-algo-row.cond` 輸入欄依內容寬,同一行)。
- 值存 `AlgoValue.choice`:稀有度字母(n 普通 / m 魔法 / r 稀有 / u 傳奇)+ 選填 `|u`(未汙染)/ `|c`(已汙染),例:`mr|u`、`|c`。
  第 35 步的單字 `normal` / `magic` / `rare` / `unique` 照讀 = 只選那一個;格式不完整一律當什麼都沒選(`nope` 不會被讀成「普通」)。
  → **存檔格式不變**(state 仍 schema 5、分享碼仍 v2),舊 state / 書籤 / 分享碼不用遷移。
- 一列輸出兩個獨立 AND term(`AlgoEntry.terms`,combine 逐 term 加入、各自加引號、各自做誤中檢查;`fragment` = 以空白相連,只給預覽與 `condText`):
  - 稀有度:選一個 = `rarityFragment`(第 35 步原樣);選多個 = `稀有度[:：] *(魔法|稀有)`(固定順序);全選 = 不加。
  - 汙染:已汙染 = `^已汙染$`(整行,與商店頁原片段相同);未汙染 = `!^已汙染$` —— combine 對 `!` 開頭的 term 加引號 → `"!^已汙染$"`,否定 term 不做誤中檢查;
    已汙染 term 對語料裡「已汙染」這一行本身不算誤中(`ownLine`)。
  - 什麼都沒選 = 輸入不成立(invalid,不輸出)。
- 標籤取自 clientstrings:`ItemDisplayStringRarity` + `ItemDisplayString{Normal,Magic,Rare,Unique}`(PoE2 普通 =「中」)、`ItemPopupCorrupted`;「未汙染」是介面字(去「已」加「未」)。
- 收合摘要 / `condText`:「魔法、稀有 · 未汙染」。

### 各頁
| 頁 | 位置 | 列 id | 勾選預設 |
|---|---|---|---|
| 地圖詞綴 / 換界石詞綴 | 數值區最後一列(第 35 步原位) | `item_rarity_class` | `rare`(同第 35 步) |
| 商店 / 物品條件 | 原「已汙染」勾選列的位置 | `corrupted`(沿用) | `\|c`(只有已汙染 → 舊勾選輸出逐字相同) |
| 物品基底(兩遊戲)、碑牌詞綴(PoE2)、物品詞綴數值(兩遊戲) | 頁頂新的「稀有度 / 汙染」條件區(只有這一列) | `item_rarity_class` | `r` |

條件區沿用第 32 步嵌入機制:`conditionSections()`(併進 `algoPages()`)產生 `vendor_bases_cond` / `tablet_mods_cond` / `item_mod_values_cond` / `item_mod_values_poe2_cond`,
`SECTION_HOSTS` 對到宿主;勾選存宿主那筆 `current.num`、值存 `numeric[宿主]`、書籤 `num` + `numeric`、分享碼 `sections` + `numeric`、`combineOrder` 宿主後緊接條件區。
**物品詞綴數值頁本身是演算法頁**:它的數值與條件區共用 `numeric[宿主]`(項目 id 不重疊)→ `bookmarkBodyOf` / `bookmarkApplyOf` / `shareStateOf` 改成合併,
`resolveState` 依項目 id 分回條件區與宿主頁。UI:`RegexNumericSection.vue` 條件區標題 `section_title_cond`、說明 `section_hint_cond`;`RegexPanel.vue` 物品詞綴數值頁上方也掛條件區。

### 測試
- `regex/test/rarity.test.ts`:條件區接線(宿主、預設、不在下拉選單、單頁 = 宿主 + 條件區)、數值區最後一列、商店頁舊「已汙染」輸出不變、一列兩 term(引號 / 三種 mode / 長度 / 無衝突)、
  已汙染對「已汙染」語料行不算衝突、全空 = invalid、schema 5 舊單字照讀、物品基底書籤往返、物品詞綴數值頁宿主數值 + 條件區書籤 / 分享碼往返、碑牌條件區分享碼往返。
- `regex/test/strict-fragments.test.ts` ③(改寫):14 種稀有度組合 × 分隔寫法、物品 / 怪物稀有度 0–999、單選與第 35 步逐字相同、choice 編解碼與按鈕切換、
  全部語料行(已汙染只中「已汙染」本身)、PoE1 地圖剪貼簿、兩遊戲中英剪貼簿「已汙染」⇔ 命中(含 `map-t16-corrupted.txt`)、`condText`。
- `golden/perf-equivalence.json` 重產:**既有 804 鍵 0 變動**(預設輸出與改版前相同),只新增 5 個條件區的 180 鍵。
- `renderer/test/regex-rarity.test.ts`:字串兩語(不含 `|@$`)、RegexAlgoList `rarity` 分支、條件區標題 / 說明、物品詞綴數值頁掛條件區、樣式不用 rem。
- 瀏覽器(Vite dev,只在預覽分頁內點 DOM):地圖數值區條件列(多選魔法 + 稀有 + 未汙染 → `"稀有度[:：] *(魔法|稀有)" "!^已汙染$"`、自動勾選)、物品基底 / 物品詞綴數值頁頂端「稀有度 / 汙染」區、商店頁預設已汙染;兩組按鈕同一行。

### 待使用者在遊戲內實測
- `"!^已汙染$"` 在倉庫 / 商店搜尋是否真的排除汙染物品。
- PoE2 白裝是否顯示「稀有度: 中」(照 clientstrings,沒有剪貼簿樣本);碑牌 / 換界石 / 物品基底的稀有度行寫法(PoE2 繁中樣本只有碑牌(魔法)與裝備)。

## 碑牌詞綴補缺漏:歸組與「依 roll 值換寫法」(2026-10-09)

使用者對照 poe2db 八種碑牌的 ModifiersCalc,要求以 poe2db 為準補齊。A+B 合計門檻的寫法遊戲內不會亮,已放棄。

### 缺漏與處理
| 缺漏 | 根因 | 處理 |
|---|---|---|
| 探險少 2 條(炸藥範圍、瓦爾遺物) | PobTools 抽取快取是 9/15 的 GGPK,當時這兩條沒有繁中(`quarantine.json` no_translation);10/8 更新後的 GGPK 已有 | 另一個任務重抽 GGPK(2026-10-08,0.5.5.4.2)後重跑產生器、同步:兩條補上,其他頁 0 變動;八種碑牌與 poe2db 逐條對過,只差「額外的一個召喚法陣」「額外一道深淵」兩條字面(roll 固定 1,GGPK 值 1 印「一個 / 一道」,poe2db 用通用模板顯示「1個 / 1道」)|
| 精髓 / 保險箱 / 神殿歸到「總督」 | `gen_regex_data2.py` `group_by_tablet` 只看 `tower_augment_*`;同一行另有 `default`(每種碑牌都出)也被歸成單一碑牌 | 有 `default` → 「通用」 |
| 數量 1–2 的詞綴只收一種寫法 | `Wording._pick` 只取第一個符合的變體;遊戲值 1 印「一個 / 首名 / an additional Strongbox」、≥ 2 印「#個 / 前#名 / # additional Strongboxes」 | 新欄位 `altZh` / `altEn` + 產生演算法(下節) |

不改的:「一道深淵」「一個精髓」是 GGPK 值 = 1 的真實寫法(poe2db 顯示「1道」是用通用模板渲染);尾巴多的 `]` 照 PobTools 既有決策保留;神廟沒有前後綴名稱是 GGPK `Mods.Name` 本身空的。

### `alts`(資料欄位 `altZh` / `altEn`,`gen.ts` `Entry.alts`)
- 產生:PobTools `regex_common.py` `Wording.lines_alt`(頁設定 `alt_wordings`,目前只開碑牌頁;PoE1 產出位元組不變)。roll 範圍也符合的其他變體;沒有條件(或條件全是 `#`)的後備變體,只有在前面的條件沒有完全涵蓋 roll 範圍時才算(否則「增加#%怪物群大小」會多出不可能的「減少」)。同時寫進 `hiddenZh` / `hiddenEn`。
- 演算法(`gen.ts` 與 PobTools `regex_gen.cpp` 同步改,C++ selftest T17 / TS `synthetic.test.ts` T17):token 要**同時一定命中每一種其他寫法**,才算「找到」該項(any 的覆蓋計數、all 的專屬 token 都照此);Verify 的 definite 同理;alts 也併入 hidden 否決其他項目。沒有 alts 的項目行為不變:`perf-equivalence.json` 984 鍵只有碑牌相關 42 鍵改變(重新歸組 + alts + 重抽補的 2 條),已重產。
- 例:英文總督「Map contains an additional Strongbox」原本產生 `"ox$"`,值 2 的「…2 additional Strongboxes」抓不到 → 現在 `"l st"`(神殿 `"l sh"`)兩種都中;繁中原本的片段(`"個保"`、`"土"`、`"守"`)本來就兩種都中,不變。英文「…Azmeri Spirit(s)」改版前就無法單獨指定(與通用那條幾乎同字),維持據實回報。

### 測試
`regex/test/tablet-variants.test.ts`:每個有 alts 的列 × 兩語 × any / all,單選產生的字串必須命中主寫法(代 1、2、10)與每種其他寫法(代 2、10);碑牌頁各組列數鎖數字(通用 24、裂痕 7、探險 13、譫妄 9、祭祀 9、深淵 9、總督 5、神廟 7 = 83)。`golden/selftest-report.json` 由新的 C++ 報告重抽(PASS 486 → 494 = T17 的 8 條;碑牌 81 → 83 列,繁中 83/83、英文 80/83 可單獨指定,卡住的 3 條與改版前相同)。

## 物品類型條件 class-term(2026-10-09)

使用者回報:碑牌頁產生的 `"圍|個瓦"` 在商店裡讓瓦爾珠寶也亮了(珠寶的「範圍效果」含「圍」)。語料片段只保證不中**同一頁清單**的其他詞綴,倉庫 / 商店搜尋卻掃所有物品;對整個物品詞綴庫否決代價太大(實驗:碑牌頁可單獨指定 繁中 83 → 42、英文 80 → 28),所以改成多一個 AND term:這類物品名稱一定含的字。

- **規則**(`regex/src/class-term.ts`):`classTermOf(page, lang)` 查表;`sharedClassTerm(pages, lang)` 只在**有勾選的語料頁全部**屬於同一類型時才回傳(碑牌頁 + 換界石頁一起勾時加了會把換界石擋掉)。演算法頁(數值區、條件區)不影響判斷。`combine.ts` 只拿**有產出 token** 的語料頁去判斷:只勾了無法單獨指定的詞綴(例:英文 `TowerMapBossAdditionalSpirit`)時字串會只剩 `"tablet"`、亮所有碑牌,所以不加(`tablet-variants.test.ts` C3)。
- **目前只有** `poe2/tablet_mods`:繁中 `碑牌`、英文 `tablet`(八種碑牌基底名都以「碑牌」/「Tablet」結尾,`regex/test/tablet-variants.test.ts` 對 items.ndjson 守門)。使用者裁定先只做碑牌頁。
- **term 位置**(`combine.ts`):any term → all terms → 演算法 terms(含 R10 合併後的稀有度 / 汙染 term)→ **物品類型 term** → 自訂 terms → none term。加引號(`"碑牌"`),長度算進 `length`;`CombineResult.classTerm` 另外給出。只有一個語料頁時,結果 = 該頁 `Corpus.build().query` 再多這一段。
- 例(R10 E1,碑牌為目前頁):`"%維" "度: 稀" "碑牌"`。
- 與 R10 的交互:R10 合併只併同一物品組(`sections.ts planMerge`),碑牌頁與換界石頁不同組,所以「已選(合併)」以碑牌為目前頁時一定只有碑牌語料 → 會加 class-term。R10 條件縮短的防護語料(`combine.ts mergeConditions`)也收 `altZh` / `altEn`(`merge-group.test.ts` M4)。
- PobTools 端已移植(PobTools 46d1ae2 / 829c19d;C++ golden 已由本分支重產,`--regex-selftest` 1056 / 0)。

## 相關文件
- [regex-share-cli.md](regex-share-cli.md)(從命令列 / PobTools 送分享碼:`--regex-share`、確認對話框、找 exe)
- [phase2-summary.md](phase2-summary.md)(WP5 摘要與待辦:逐字 golden)
- [release-flow.md](release-flow.md)(資料同步後照發版流程出版)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
