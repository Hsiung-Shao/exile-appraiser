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

## WP-C:演算法頁 / 合併 / 分享碼 / 範本(2026-09-29)

全部自寫;**不參考 poe.re 原始碼**(無 LICENSE)。

### 資料 schema 2
- `regex_poe*.json` 頂層 `labels{zh,en}`(clientstrings 鍵 → 文字)、頁面 `kind`(`mods` / `names`)。`data.ts` 同時接受 schema 1(缺 `kind` = mods、缺 `labels` = null);未知 kind 當 mods。
- `normalizeLabel`:`{0}` → `#`、PoE2 的 `[Id|文字]` → 文字、`[Id]` → Id。
- 標籤合併 `mergeLabels(資料檔 labels, 暫代檔)`:資料檔**逐鍵優先**,暫代檔 `data/regex/labels.poe{1,2}.json` 只補缺鍵(PoE2 schema 2 目前缺 `ItemDisplayMap{Magic,Rare}MonsterQuantityBonus`、`ExperienceGained`、`MonsterEffectiveness`、`ItemPopupCorrupted`)。兩份都有的鍵在測試裡斷言逐字相同。
- 暫代檔產生:`node regex/scripts/gen-labels.mjs --from ../pob-zh-engine`(讀 `tools/ggpk_zh/out/poe1/tables/clientstrings.json`、`tools/ggpk2_zh/out/poe2/tables/clientstrings.json` 的 `Text` 欄,以**鍵**取值、缺鍵 exit 1、與 `regex_poe*.json` ambient 行交叉比對),寫完以 `verify-data-manifest --write --prefix data/regex/labels.<game>.json` 各記一個來源(最長前綴歸屬,不併入 PobTools 同步的 `data/regex` 前綴)。`templates.json` 同樣自成一個前綴。

### 數值 → 正則(`regex/src/numeric.ts`)
`rangeRegex({min?, max?}, {digits: 1|2|3})`:依位數切等長區間 → 首位頭 / 中 / 尾三段遞迴拆成字元類序列 → 兩位數以上首位 `[1-9]` 換 `\d` → `P` 與 `X P` 合併成 `X?P` → 與逐一列舉比取短。只用 `\d [] ? | ()`(不用 `{n}`、不用大寫跳脫)。
測試(`numeric.test.ts`):digits 1/2/3 每個 N 的 ≥N、≤N(2220 組)、digits=2 全部 5050 個區間、digits=3 常見 + 3000 組 LCG 區間,每組對 0–999 逐值 `RegExp.test`,且長度 ≤ 樸素寫法。

### 演算法頁(`regex/src/pages/`,kind `numeric` / `sockets`)
| 頁 | 遊戲 | 項目 |
|---|---|---|
| `map_numeric`(第 32 步起 = `map_mods` 頂端的數值區,不在下拉選單) | PoE1 | 地圖階級、物品數量、物品稀有度、怪物群大小、更多聖甲蟲 / 通貨 / 地圖 / 命運卡 |
| `waystone_numeric`(第 32 步起 = `waystone_mods` 頂端的數值區) | PoE2 | 換界石階級、物品稀有度、怪群大小、怪物稀有度、換界石掉落機率、魔法 / 稀有怪物、獲得經驗值、怪物效能 |
| `vendor_items` | PoE1 | 連結數 ≥(3–6L)、鏈接顏色(任意順序、需相鄰)、插槽顏色數 ≥、物品等級、品質、寶石等級 ≥、已汙染、勢力基底 |
| `vendor_items_poe2` | PoE2 | 物品等級、品質、寶石等級 ≥、已汙染 |

- 形狀與語料頁相同(`RegexPage` + entries),多 `input`(`range` / `select` / `colors` / `count`)與 `fragment(value, lang)`。鍵用**項目 id**(標籤文字會隨賽季變)。
- 屬性行片段(`propertyFragment`):≥ 百分比 `標籤.*數值%`;≥ 非百分比 `標籤.*[^\d]數值`;≤ / 區間 `標籤.*[^\d]數值(%|$)`。邊界推理見 `frag.ts` 註解;`pages.test.ts` 對 0–999、PoE1「：」/ PoE2 空白 / 剪貼簿「: 」與「+」逐值驗證。寶石等級行首錨定 `^等級`。
- 插槽:`.-.-.-.-.-.`(6L)、`r-(g-b|b-g)|…`(trie + 相同子樹合成字元類)、`插槽.*b.*b.*b`。⚠ **假設繁中客戶端插槽顯示 `R-G-B` 不翻譯,未實測**:這三項 `untested`,UI 標「待實測」。所有屬性行的分隔字元與「+」顯示也還沒進遊戲確認(頁 note 已寫)。

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

## 相關文件
- [phase2-summary.md](phase2-summary.md)(WP5 摘要與待辦:逐字 golden)
- [release-flow.md](release-flow.md)(資料同步後照發版流程出版)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
