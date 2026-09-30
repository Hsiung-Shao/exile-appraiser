# 符文塑形面板自動查價(WP-R2)

PoE2 **符文塑形面板**(Runes of Aldur 機制)開著時,自動辨識每一列並在右側標出 poe.ninja 參考價。
計畫:`C:\Users\jerry\.claude\plans\wise-seeking-hippo.md`。參考專案 `Barragek0/RuneshapePriceChecker`、`pedro-quiterio/PoeAncientsPriceHelper`
**皆無授權**:只參考 README 層級的功能描述,不看、不抄原始碼與資料檔。

| 段 | 檔案 |
|---|---|
| 掃描迴圈(擷取、變化偵測、自動定位、OCR) | 2026-10-01 起骨架泛化為 `main/src/ocr/panel-scan.ts`(`PanelScan` + `PanelDetector`,褻瀆自動辨識 `reveal-scan.ts` 共用);`main/src/ocr/runeshape-scan.ts` 只剩符文偵測器(`RUNESHAPE_DETECTOR`:`locateRunePanel` / `isPanelRow` / `looksVertical`、區域不退回、查價面板開著暫停)與 `RuneshapeScan`,行為不變(測試 `main/test/runeshape-scan.test.ts`,假時鐘)。與褻瀆掃描共用 WinOcr:對方忙碌丟 tick,main 把符文第一個 tick 錯開半個間隔 |
| 列格式 + 面板定位 + 直書判定(零依賴,main / renderer 共用) | `poe2/src/runeshape/row-format.ts` |
| 名稱比對(零依賴核心 + renderer 入口) | `poe2/src/runeshape/match-core.ts`、`match.ts`(測試 `poe2/test/runeshape/match.test.ts`) |
| 配方結果資料 | `data/poe2/runeshape/recipes.json`(`scripts/sync-runeshape-data.mjs` 產生;renderer 由 `assets/data` 的 `RUNESHAPE_RECIPES` 載入) |
| 價格 | `renderer/src/web/background/{Prices,price-of}.ts`、`core/src/ninja/`(格式見 `docs/ninja-poe2.md`) |
| 徽章 | `renderer/src/web/overlay/{RuneshapePrices.vue,runeshape-view.ts}`(測試 `renderer/test/runeshape-prices.test.ts`) |
| 自動查市集 | `poe2/src/runeshape/trade-lookup.ts`(查詢組法 + 佇列;測試 `poe2/test/runeshape/trade-lookup.test.ts`,錄製回應 `fixtures/trade/`)、`runeshape-view.ts` 市價換算 / 徽章文字(測試 `renderer/test/runeshape-trade.test.ts`)、`App.vue` 查價面板開著 → `runeshapeTradeHold` |
| 設定 | `renderer/src/web/settings/tabs/Hotkeys.vue`「符文塑形自動查價」卡片 |
| 無頭驗證 | `--runeshape-selftest`(`main/src/ocr/runeshape-selftest.ts`)、`node scripts/ocr-fixture.mjs --set runeshape` |

## 列格式(2026-09-30 兩張繁中截圖確認)

截圖與 OCR 快照在 `poe2/test/runeshape/fixtures/ocr/`(`runeshape-skills-01`、`runeshape-rewards-02`)。
文字**靠右對齊**、左邊是符文圖示、列高一致(列距約 2.8 行高)。

| 寫法 | 類型(`kind`) | 例 |
|---|---|---|
| `技能等級 N：名稱` | `gem`(技能寶石 + 寶石等級) | `技能等級 20：傳導符文` |
| `技能：名稱` | `skill` | `技能：排斥` |
| `輔助：名稱` | `support` | `輔助：震盪符文` |
| `Nx 名稱` | `item` + 數量 | `1x 遠古控制符文`、`3x 富豪石` |
| `名稱（等級N）` | `item` + 名稱等級 | `1x 奇術熔劑（等級18）` |
| 沒有前綴 | `item` | `維里西姆堆` |
| `未發現`(尚未解鎖的配方) | `item` + `undiscovered`(不畫徽章) | `未發現` |

`normalizeOcrText` 先刪所有空白、全形轉半形(`：`→`:`、`（`→`(`);OCR 常見誤讀一併容忍:

- `1x` 讀成 `lx` / `Ix` / `1 ×` / `1X`(`l` `I` `|` 當 1);`Nx` 後面必須緊接 CJK(英文 `Ix …` 不算)。
- `技能等級20:` 漏字成 `技能等20:` / `技能級20:`;冒號讀成分號。
- 行尾雜訊:`,`(右緣別的工具畫的數字)、`1`、`丨`(框線);開頭 `…`。
- 等級後綴右括號被吃掉(`奇術熔劑(等級18`)。

**面板列**(`isPanelRow`)= 有前綴且名稱至少 2 個 CJK 字。自動定位、「面板還在不在」、以及「這次 OCR 算不算有列」都用它:
整批 OCR 行裡**沒有任何一列面板列就當成沒有列**(地上物品標籤、其他 UI 的中文字不會被畫徽章);有面板列時,同一批沒前綴的列(`維里西姆堆`)照樣送出比對。

## 名稱比對(`match-core.ts`)

1. 前綴限定 namespace / 類別:`gem` / `skill` → GEM 非輔助(Active / Meta)、`support` → GEM `Support Skill Gem`、`item` → ITEM。
   沒有前綴的列只找 ITEM(寶石名不會被當成物品)。
2. 名稱 → `refName`:**只用目前語系 `items.ndjson` 的 `name`**(GGPK 來源),不自行翻譯。帶等級的物品用含等級的全名比對
   (`奇術熔劑(等級18)` = items.ndjson `奇術熔劑（等級18）` 正規化後)。
3. 精確(正規化後相同)→ 模糊:Levenshtein 相似度 ≥ `FUZZY_MIN_SIM`(0.85)且長度差 ≤ `FUZZY_MAX_LEN_DIFF`(2),與揭露面板同門檻;
   **數字必須完全相同**(`(等級18)` 不會模糊到 `(等級19)`)。短名稱錯一字(6 字錯 1 = 0.83)不猜。UI 在價格前標「≈」。
4. 重名:ITEM 依類別優先序取最高那層(`ITEM_CATEGORY_PRIORITY`:Currency > SoulCore(符文 / 靈魂核心)> UncutSkillGem > Omen > MapFragment > …;
   不在表上的類別排表後、QuestItem 最後)。最高那層仍有 2 個以上不同 refName(或模糊同分)→ `ambiguous`(候選清單),**不給 refName、不查價**。
   例:`破碎三曲` 通貨 vs 任務物品 → 通貨;`絕望` 靠前綴分技能 `Despair` / 輔助 `Desperation`。
5. 面板外的列:沒前綴且右緣與面板列中位右緣差 > 2.5 行高 → `offPanel`(面板標題「符形組合」、英文紅框殘留),不畫徽章。
   「未發現」列(面板上尚未解鎖的配方,整列只寫「未發現」;2026-10-01 使用者截圖「寶石」分頁)→ `undiscovered`,不比對、不畫徽章
   (以前顯示「?」)。判準 `row-format.ts` `isUndiscoveredRow` / `UNDISCOVERED_ROW_NAMES`(剝掉頭尾 OCR 雜訊後名稱 = `未發現`);英文客戶端字串未確認,暫不收。
6. **配方結果**(只對 `Nx` / 沒有前綴的列):見下節。

## 配方結果(泛稱列)

面板上有些列不是具體物品,而是配方結果的**泛稱**:`維里西姆堆`、`[傳奇]胸甲`(遊戲顯示「傳奇胸甲」)、`5x 隨機通貨`、`未切割的寶石`、`稀有傳奇物品`。
這些不在 items.ndjson(或只有不帶等級的底名),poe.ninja 也沒有單一價格。

- **資料來源**:PoE2 GGPK 表 `expedition2recipes` 的 `Description` 欄(GGPK = 第一真值;poe2db Trade API 沒有「維里西姆堆」、poe.ninja Verisium 類也沒有),
  29 筆。`data/poe2/runeshape/recipes.json`:`{schema:1, source:{table, column, sha256, ggpkVersion, extractedAt}, recipes:[{id, en, zh, enPlain, zhPlain}]}`,
  `*Plain` 剝掉 `[Rarity|X]` 標記只留 X;以 GGPK `id`(如 `3SlotPileofVerisium1`)排序,不用 row 當鍵。
- **同步**(資料只單向同步,維護者管線 `pob-zh-engine/tools/` 不進本 repo):
  ```bash
  node scripts/sync-runeshape-data.mjs --from ../pob-zh-engine   # 讀 tools/ggpk2_zh/out/poe2/tables/expedition2recipes.json + meta.json
  ```
  守門:table / column 正確、id 不重複、標記只允許 `[Rarity|…]` 且中英數量相同、`zhPlain` / `enPlain` 不重複;輸出不含時間戳(同來源重跑逐位元組相同)。
  MANIFEST 前綴 `data/poe2/runeshape`:來源在 gitignored `tools/` 沒有 commit → 記 `fetchedAt` = meta.json 抽取時間、`repo` 欄帶 game_version 與來源檔 sha256。
  新賽季重抽 GGPK 後重跑。
- **比對**(`match-core.ts`):索引收 `zhPlain` 正規化後的名稱(英文客戶端列格式未確認,暫不收英文)。
  - `Nx` 前綴的列先試 `Nx名稱` 整串(`5x 隨機通貨` 的 5x 是配方文字的一部分)→ 命中時 `quantity` = 1,不當成外加 5 個;
    `2x 維里西姆堆` 這種原文沒有數量的配方照常是外加數量 2;`3x 隨機通貨` 數字不同不模糊到 5x → 對不上。
  - 再試名稱本身;精確 → 模糊(同門檻、數字必須相同)。
  - 與物品名的取捨(`pickItemOrRecipe`):只有一邊命中 → 那邊;物品精確命中 → 物品,**除非**配方也精確且物品 refName 就是配方英文
    (`未切割的輔助寶石` / `精魂寶石` = 不帶等級的 `Uncut Support Gem` / `Uncut Spirit Gem`,poe.ninja 只有帶等級的價)→ 配方;
    物品模糊 → 配方精確勝,都模糊取相似度高者(同分取物品)。
  - 命中:`kind: 'recipe'`、`refName` = `enPlain`、`recipeId`、`category: 'Recipe'`、`ninjaKey: null`、`unpriced: 'recipe'`。
- **顯示**:徽章「無固定價格」(`ppz.runeshape.no_fixed_price`),比「無價格」(有具體物品但價格表沒有 / 技能寶石)更淡、左框虛線、斜體;
  tooltip = 英文名 + 「泛稱獎勵,沒有單一市價」(`recipe_title`)。
- 缺檔(舊安裝)不擋啟動:`[runeshape] 配方結果資料載入失敗` 記在 console,泛稱列回到「?」。

## 價格對應

| 類型 | poe.ninja 鍵 | 說明 |
|---|---|---|
| `item` | `currency\|<refName>` | exchange 各類(Currency、Runes、SoulCores、UncutGems、Verisium、Expedition…)的名稱就是英文 refName;帶等級的物品 refName 本身帶 `(Level N)` |
| `gem` / `skill` / `support` | 無(`ninjaKey: null`、`unpriced: 'gem'`) | poe.ninja PoE2 的類別沒有技能寶石;已錄的 `LineageSupportGems` 也沒有這些符文技能 → 不猜 → 自動查市集(見下節);查不了才顯示「無價格」 |
| `recipe` | 無(`ninjaKey: null`、`unpriced: 'recipe'`) | 配方結果泛稱沒有單一價格 → 徽章「無固定價格」,不查 |

兩張樣本在錄製檔(2026-09-30 Forbidden Rites;1 div = 610.9 ex)上的結果:

| 列 | refName | 價格 |
|---|---|---|
| `技能等級 20：傳導符文` 等 6 列、`技能：…` 3 列、`輔助：震盪符文` | Conductive Runes / Repulsion / Frostflame Nova / Fragments Of The Past / Eternal March / Detonate Living / Concussive Runes | 無價格(poe.ninja 沒有技能寶石) |
| `維里西姆堆` | Verisium Pile(配方結果 `3SlotPileofVerisium1`;items.ndjson 沒有,最接近的「維里西姆」相似度 0.8 < 0.85 不會誤中) | 無固定價格 |
| `1x 遠古控制符文` / `崇敬積累符文` / `崇敬巧技符文` / `崇敬狩獵符文` | Ancient Rune of Control / Rune of Accumulation / Rune of Acrobatics / Rune of the Hunt | 1 / 19 / 31 / 26 ex |
| `1x 奇術熔劑（等級18）` | Thaumaturgic Flux (Level 18) | 23 ex(Expedition 類錄製時有等級 13~20;沒有的等級一律無價格,不拿別的等級頂替) |
| `1x 適應合金` | Adaptive Alloy | 50 ex |
| `3x 富豪石` | Regal Orb | 5.3 ex(每個 1.8 ex) |

## 自動查市集(無 ninja 價的列)

poe.ninja 沒有價格的列(技能 / 輔助寶石、ninja 沒收錄的等級、台服全部)**自動**排隊查交易站,不必點(2026-10-01 使用者回饋:
「市集的功能要在查不到價格時直接顯示」;舊的 Shift+Space 徽章可點模式會讓 Shift+Space 叫不出設定,已移除 —— overlayKey 一律開設定,徽章整層點擊穿透)。
同名寶石價差極大(使用者實例:維里西姆強化 等級 14、品質 20%、已汙染掛 415 c,等級 20、無品質、未汙染只要 3 c),
所以查詢**一定帶與產物相符的篩選**;徽章不能點,關鍵篩選以短字寫在徽章上,完整篩選寫進 log(`[runeshape] 市集排入 / 市集查詢 …`)。

**查詢內容**(`planRuneTradeQuery`;欄位位置以 `GET /api/trade2/data/filters` 2026-09-30 為準:`quality` 在 `type_filters`,
`gem_level` / `corrupted` 在 `misc_filters`):

| 列類型 | 方式 | 完整篩選(log) | 徽章短字 |
|---|---|---|---|
| `gem`(`技能等級 N：`) | search | realm、聯盟、type = 名稱、category = `gem`、`gem_level` min = max = N、`corrupted` = false、`quality` max = 0、status `securable` | `· L20` |
| `skill` / `support`(面板沒寫等級) | search | 同上但不帶 `gem_level`(等級不限,價格可能依等級差異很大) | `· 等級不限` |
| `item` 有 `tradeTag` | bulk exchange(1 次) | realm、聯盟、want = tag、have = `exalted` / `divine`、status `online` | (無) |
| `item` 沒有 `tradeTag` | search | realm、聯盟、type = 名稱、status `securable` | (無) |
| `recipe`、`ambiguous`、對不上、面板外、「未發現」 | 不查 | — | — |

- 名稱:國際服(繁中客戶端)送 refName、台服送繁中 name(`useEnglishNames`,同一般查價;`match-core.ts` 列多帶 `name` / `tradeTag`)。
- 價格:每次 search 只 fetch 一批(最便宜 10 筆);≥ 3 筆給**中位數**,不到 3 筆顯示最低價並標「少」。
  國際服用 poe.ninja 匯率換成崇高石(≥ 1 神聖石改神聖石;換不了的幣別不計);**台服沒有匯率 → 取筆數最多的幣別原幣顯示**。
- **徽章文字**(`runeshape-view.ts` `runeTradeBadge`,冷色左框 + 「市」字,與 ninja 參考價區分):
  排隊中 `市 … · L20` → 查詢中 `市 查詢中 · L20` → `市 80 崇高 · L20`(筆數少:`市 5 崇高 少 · L20`;沒有掛單:`市 無掛單`;失敗:`市 查詢失敗`)。
- **佇列**(`trade-lookup.ts` `createRuneTradeQueue`,renderer 在 `RuneshapePrices.vue` 建一個):
  - 單一佇列、同時一筆,由上而下依列順序;每筆物品最多 1 search + 1 fetch(bulk 1 次 exchange)。
  - 同一組篩選(plan key = realm + 聯盟 + 查詢內容)30 分鐘記憶體快取(重啟失效;另有交易層原本的快取);已排隊 / 查詢中 / 快取內的列重複出現不重排;
    非限流的失敗 5 分鐘內不再自動排入。
  - **不影響一般查價**:送出前用限流器預估(`runeTradeWaitMs`:search 看 SEARCH + FETCH、bulk 看 EXCHANGE;限流器上已有人排隊也算要等),
    要等就延後「預估 + 300 ms」再試 —— 不丟錯、不呼叫 `waitMulti` 排進限流器的佇列;search 完、fetch 前再預估一次,要等就把該筆放回隊首
    (search 結果在交易層快取,重試不會再 search)。
  - 查價面板 / 設定開著(App.vue 寫 `runeshapeTradeHold`)→ 暫停,關掉立刻繼續。
  - 429:佇列自己的請求走原始 http(`Host.proxy`,不經 `withRetryAfter` 的背景等待)包 `withRuneTrade429` → 整個佇列暫停到 Retry-After 期滿(沒給 = 60 秒);
    一般查價收到 429(`Host.rateLimitWait`)也 `pauseFor` 同樣秒數。
  - 面板消失(空結果 / 暫停)→ `clearPending` 清掉尚未送出的項目(查詢中那筆照跑);快取保留,面板再出現時直接顯示。換區服 / 聯盟也清。
- 錄製回應:`poe2/test/runeshape/fixtures/trade/`(2026-09-30 intl、Runes of Aldur,search / fetch / exchange 各打一次,UA = `exile-appraiser/0.1.0`,
  已剝帳號 / 角色名 / 密語 / 倉庫)。實測:`Powered by Verisium` 等級 20 + 未汙染 + 品質 max 0 → 共 379 筆,前 10 筆全是等級 20、無品質、未汙染,
  30~199 ex,中位數 80 ex(`quality` max 0 會命中沒有品質屬性的寶石)。

## 區域:手動框選 / 自動定位(`runeshape-scan.ts`)

- **手動**(`runeshapeRegion` 有值):優先用它;區域內沒找到面板列**不**改掃全畫面(持續掃描的成本),
  設定頁顯示「區域內沒找到面板」(`runeshape-stats` 的 `panel: 'not-found'`)。
- **自動**(沒框):
  - 沒有快取時,最多每 `LOCATE_INTERVAL_MS`(3 秒)一次整個 client ×1 OCR → `locateRunePanel`;這段期間的 tick 連擷取都不做(`locate-wait`)。
  - 判準:面板列依 y 排序,**右緣對齊**(與簇中位右緣差 ≤ 2.5 行高)且相鄰中心距 ≤ 6.5 行高的歸成一簇,取列數最多的一簇(≥ 2 列)。
  - 外擴:左 max(框寬 × 0.5, 6 行高)(較長名稱往左延伸)、右 0.6 行高(右緣外常有別的東西)、上下各半個列距(中位數)。夾進 client。
    樣本:skills-01 → (257,109 303×540),不含上方英文紅框殘留;rewards-02 → (237,40 343×405),不含右緣 x ≥ 585 的數字。
  - 快取在記憶體,鍵 = client 大小 + 擷取偏移;找到後同一個 tick 直接對框 ×3,之後照常每 `interval` 只掃框、畫面沒變不 OCR。
  - 失效:連續 `AUTO_MISS_LIMIT`(5)次在框內找不到面板列(OCR 沒列、或畫面沒變但上次就沒列)→ 清快取、回到低頻定位;
    client 大小 / 擷取偏移變了 → 立刻作廢重定位;框內有變化且距上次定位 ≥ `AUTO_REFRESH_MS`(30 秒)→ 順便重新定位(面板變高 / 移位)。
- **直書防護**(兩種模式都有):WinRT OCR 偶爾把整塊面板當成直書(實測 skills-01 整張 ×2 / ×3、以及手動區域 (31,109 550×545) ×3 時,
  每「欄」字變成一行、行高數百像素)。`looksVertical` 判到 → 同一塊 ×1 找面板列 → 只裁面板列 ×3 重辨識;成功後記住那塊(鍵 = 區域鍵),
  之後同一區域直接 OCR 那塊,那塊找不到面板列 / 又變直書才回到整個區域。

## 耗時(`--runeshape-selftest`,本機,PNG 當 client)

| 路徑 | skills-01(611×727) | rewards-02(591×445) |
|---|---|---|
| 自動:整張 ×1 定位 + 框 ×3(第一次) | 定位 308 ms + OCR 139 ms = 448 ms | 定位 192 ms + OCR 98 ms = 291 ms |
| 自動:畫面沒變 | 1 ms | 1 ms |
| 自動:框內有變化 | OCR 103 ms | OCR 79 ms |
| 手動整張:第一次(直書重試) | 546–687 ms | 189 ms(沒直書) |
| 手動整張:之後有變化(直接用記住的那塊) | 118 ms | 181 ms |

擷取(desktopCapturer)不在 selftest 內,由使用者在遊戲中親測;真實 client(2560×1440 等)的整張 ×1 定位會比樣本慢,但只在沒快取時每 3 秒一次。

## 驗證指令

```bash
node scripts/ocr-fixture.mjs --set runeshape        # 兩張樣本 → *.ocr.json(整張 ×3、定位段 ×1、定位框 ×3 三份)
npx electron main/dist/main.js --runeshape-selftest <png> [--runeshape-selftest-region=x,y,w,h]   # 先 build main、清 ELECTRON_RUN_AS_NODE;樣本要先轉 PNG
```

## 已知限制

- 英文客戶端的前綴寫法未確認(`Nx` 以外只認繁中 `技能等級` / `技能` / `輔助`);沒有任何前綴列的面板自動定位找不到(請手動框選)。
- 配方泛稱(`維里西姆堆`、傳奇某部位、隨機通貨)只標「無固定價格」,不估價、不查市集;poe.ninja 沒有的等級 / 新物品自動查市集。
- 自動查市集:真實遊戲中的交易站實際價格、與一般查價同時進行時的限流表現待使用者親測(自動驗證只在無頭頁面 + 錄製回應 + 假時鐘);
  `skill` / `support` 列面板沒寫等級,只能等級不限查詢;bulk 的神聖石 / 崇高石混合掛單在少量掛單時中位數波動大;
  面板列很多時,交易站 1 次 / 5 秒的限流下全部查完要一段時間(每筆約 5 秒)。
- 「未發現」列只認繁中字串;英文客戶端的對應字串未確認,暫不收(會顯示「?」)。
- 配方表只收 GGPK `expedition2recipes` 的 Description;面板若出現不在表裡的泛稱寫法仍會對不上(「?」),新賽季要重抽 GGPK + 重跑同步。
- 只有兩張 1 倍縮放的截圖;4K / 其他 UI 縮放、面板捲動、列數很多時的定位與 OCR 準確度待使用者親測。
