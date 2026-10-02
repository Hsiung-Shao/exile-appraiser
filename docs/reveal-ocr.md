# 靈魂之井三選一揭露面板 OCR(WP-S)

PoE2 靈魂之井的「三選一」揭露面板無法複製文字。擷取遊戲畫面 → Windows 內建 OCR
→ 對 `data/poe2/desecration/tiers.json` 比對 → overlay 在每個選項右側顯示 `T4 · 一般 · 21–26 / 20–25`。
**2026-10-01 起改為自動持續辨識**(設定 `revealAutoEnabled`,預設開;見下節),原本的熱鍵(預設 **`Ctrl + Shift + R`**)改為「暫停 / 繼續」。
只在 **overlay 模式 + PoE2** 運作;PoE1 不掃描、不註冊熱鍵。**不送任何鍵盤 / 滑鼠輸入**(觸發時也不放開修飾鍵)。

## 自動持續辨識(2026-10-01)

使用者要求「與符文塑形一致:開關 + 自動持續辨識」。符文塑形的掃描骨架泛化成 `main/src/ocr/panel-scan.ts` 的 `PanelScan<PanelDetector>`
(排程、`scanBlock` 暫停條件、`bgraToGray` / `frameDiff` / `isChanged` 變化偵測、`ScanClock` / `ScanCapture` 注入、自動定位快取),
符文與褻瀆各注入自己的偵測器;褻瀆在 `main/src/ocr/reveal-scan.ts`(`RevealScan`、`createRevealDetector`)。

| 項目 | 褻瀆(`reveal-scan.ts`) | 符文塑形(`runeshape-scan.ts`,行為不變) |
|---|---|---|
| 設定 | `revealAutoEnabled`(預設**開**)、`revealIntervalMs`(100–3000,預設 1000)、區域沿用 `ocrRegion` | `runeshapeEnabled`(預設關)、`runeshapeIntervalMs`(同夾限)、`runeshapeRegion` |
| 資料 | `ready()` 第一次讀 `tiers.json` 建模板索引(`locate-data.ts`);讀不到 → 停止(`no-data`,清徽章) | 不需要 |
| 自動定位(沒快取時每 3 秒最多擷取一次;連續沒找到退避 3 → 6 → 12 → 15 秒、兩個掃描共用同一次整個 client ×1,見「排程與退避」) | `locatePanel`(像詞綴的行成簇 → 外擴) | `locateRunePanel` |
| 有沒有面板 | `findPanelHits` ≥ 2 行像詞綴(`REVEAL_MIN_HITS`,同 `checkRegion`),**且依 y 分成 ≥ 2 組**(`modGroupCount`:相鄰中心距 > 1.9 × 行高 = 下一組,同 renderer 分組門檻)——選項之間有空隙,物品浮窗的連續詞綴行不算(無頭驗證發現只看行數會把浮窗當面板);**第 13 步起每一簇再過否決規則**(見「面板判定:否決規則」) | ≥ 1 列 `isPanelRow` |
| 送出的行 | 區域 OCR 的**全部行**(renderer `matchRevealLines` 要用對不上的行補中間沒認出的組) | 含 CJK 的行 |
| 有框區域 | **只看區域**(第 13 步起與符文相同):區域內連續 2 次沒面板 → 送 `empty`、設定頁顯示「區域內沒找到面板」,**不改找整個畫面**;區域整塊在擷取影像外 → `region-outside` | 只看區域,不退回 |
| 暫停 | 遊戲失焦、設定 / 框選層開著;**查價面板開著不暫停**(看褻瀆時常同時開查價) | 另加查價面板開著 |
| 事件 | `reveal-scan-result`(`RevealScanEvent` = `PanelScanEvent`,不進 `PREVIEW_EVENTS`) | `runeshape-scan-result` |
| 熱鍵 | `hotkeyOcrReveal` = 暫停 / 繼續(`revealAutoEnabled` 關時不註冊);`hotkeyOcrRegion` = 框選區域 | `hotkeyRuneshapeToggle`(要啟用才註冊);`hotkeyRuneshapeRegion` = 框選區域(2026-10-01 新增) |

- **共用 WinOcr**:兩個掃描的 `ocrBusy` 互看對方的 `busy`,忙碌就丟掉這個 tick(不排隊);main 啟動時褻瀆第一個 tick 立刻跑、符文延後半個間隔,兩者同時開著時交錯。
- **徽章**(`OcrBadges.vue` + `ocr-reveal.ts` `revealScanAction`):`rows` → 重新比對並重畫;比對不成面板(背包物品浮窗等;被否決時 log 印 `no-panel:<規則>`)→ 靜靜清掉、不跳錯誤;
  `empty` / `inactive` / `user-paused` → 清除。**沒有 15 秒自動消失、沒有「再按一次清除」**;Esc 暫時清掉;overlay 改大小以最後結果重排。
  (第 13 步移除「已改找整個畫面」提示與 `fallbackNoteShows`;徽章排版見「徽章排版與「?」文案」。)
- 框選確認後 `ocr-reveal-now` → `revealScan.rescan()`(丟掉差分基準與退避,下一個 tick 一定重看)。
- 設定頁(熱鍵與視窗 › 褻瀆自動辨識卡片):開關、狀態列(`reveal-stats`:找到 / 尋找中 / 框選的區域內有 / 沒有找到面板 / 暫停,`revealScanStatus`)、掃描間隔等,見下節「設定頁(與符文塑形對等)」。

### 面板判定:否決規則(2026-10-01 第 13 步)

**使用者回報**:框了區域(左 19%、上 44%、寬 28%、高 25%),面板沒開時程式「區域內沒找到面板 → 改找整個畫面」,把背包裡一件手套的一般物品浮窗
(進階詞綴說明開著)當成揭露面板,疊出好幾個重疊、左右錯開的徽章,並顯示「?:…依三個選項共同的可能底材推算」(實際是交集為空)。

**根因**(三處疊加):
1. 判定太鬆:main `found = ≥ 2 行像詞綴 && 分成 ≥ 2 組`;tiers.json 模板含一般池 1,483 條,浮窗的詞綴本來就「像詞綴」,進階說明的標頭行把詞綴撐開成每行一組 → 組數 ≥ 2 過關;
   renderer `selectPanel` 也只看「連續、x 對齊、相距 ≤ 6 × 行高」,一段 5 組時挑分數最高的 3 組照畫。
2. 有框區域時 `regionFallback: true` → 區域內沒面板就改找整個畫面(`panel-scan.ts` 退回機制)。
3. 徽章 `left` = 各組右緣 + 14、`top` = 各組中心,沒有防碰撞;一組多候選各一列 → 行距 29 px 的浮窗詞綴疊成一團。
4. 「?」文案只看 `profileExact`,交集為空(`profileSource === 'all'`)時仍寫「三個選項共同的可能底材」。

**修正**:A. 褻瀆 `regionFallback` 移除(連同 `panel-scan.ts` 整套退回機制、`fallback` 事件欄位 / 統計欄位、`FALLBACK_RECHECK_MS`、`REGION_FALLBACK_AFTER`、
`strategy.ts` `recognizeRegionFirst`、「已改找整個畫面」提示與 i18n);B. 否決規則(下表);C. 負樣本;D. 徽章防碰撞;E. 「?」文案。

否決規則在 `poe2/src/desecration/panel-veto.ts`(零依賴、只 import `ocr-text.ts`;main 經 esbuild 打包、只准相對路徑),
main `ocr-locate.ts` `findPanelHits`(→ `classify` / `locatePanel` / `checkRegion`)對**每一簇**命中行套用(被否決的簇不採用,全被否決 = 沒有面板),
renderer `ocr-match.ts` `selectPanel` 對**每一段候選面板**套用(全被否決 → `no-panel` 帶 `veto`)。

**兩層套用(2026-10-02 code review 第 A 批)**:改前是整段 / 整簇先套全部規則再挑 3 組 → 真面板旁 6 × 行高內多一條像詞綴的行被串進同段(4 組)就整段否決(改版前的 `selectPanel` 會挑 3 組照畫)。改為:
1. 挑窗前 `rawRunVeto`:只擋「明顯是浮窗」—— 總組數 > 4(`MAX_RAW_GROUPS` = 面板 3 組 + 1 條雜行;合成 B / C 都是 5 組)、或一塊連續 > 3 行且語意切成 > 3 段(真實 tooltip-gloves ×3 的 4 行、合成 C' 的 6 行;main 沒有語意切段 → 該組 > 3 行即 `group-too-tall`,同改前);
2. 挑窗後 `panelVeto`:renderer 挑分數最高的連續 3 組,main(`panelWindows`)對 4 組的簇每個連續 3 組視窗各自判定、採用沒被否決的視窗聯集(main 只框裁切範圍,寧可框大),**只對挑中的組**套下表全部規則。
≤ 3 組的段 / 簇兩層合起來與改前完全相同(三張正樣本 ×3 的 `matchReveal` / `modLines` / `findPanelHits` / `locatePanel` / `checkRegion` 輸出逐位元組相同;tooltip-gloves ×3 的否決原因仍是 `too-many-groups`,只有 detail 從 `4 組` 變成 `連續 4 行切成 4 段`)。

| 規則 | 條件 | 為什麼面板不會觸發 |
|---|---|---|
| `group-too-tall` / `too-many-groups` | 組數 > 3 或任一組 > 3 行。組 = 依 y 間距(> 1.9 × 行高)切的幾何組,折行合併算一行;相鄰兩組中間夾一行「像詞綴數值(`%` / `+數字`)、只是沒認出」且緊貼兩邊的行 → 視為同一個選項(`glueGroups`,那行算進行數)。renderer 另給 `splitCount`:> 3 行的幾何組改算語意切段數(保留「門檻失準時 4 行幾何組再由語意切開」的容錯;浮窗連續 6 行仍切成 6 段) | 面板最多 3 個選項;tiers.json 每條褻瀆詞綴 parts ≤ 3 |
| `keyword-line` | 命中框上下各 6 × 行高、左右各 2 × 行高內,有對不上模板的行含「前綴 / 後綴 / 詞綴 / 階級 / 物品等級」或冒號(`:` `:` `∶` `﹕`,屬性格式如 `護甲值: 103`);「需求 / 品質」只在沒有 `%` 時算(模板有 `減少#%能力值需求`、`#%至全部技能的品質`) | 面板上沒有這些字;tiers.json 710 個寫法都不含前 5 個詞與冒號 |
| `tooltip-header` | **≥ 2 行**(`MIN_TOOLTIP_HEADERS`)標頭形狀的未命中 CJK 行:緊貼**下一條**命中行上方(中心距 ≤ 1.9 × 行高),且**上一條**命中行也 ≤ 1.9 ×、或上方沒有命中行;x 與上 / 下一條對齊(中心 / 左緣 / 右緣差 ≤ 4 × 行高);像詞綴數值的行(`%` / `+數字`)不算(第 A 批改,見下方「誤殺範圍」) | 面板選項之間 ≥ 2.31 × 行高:某選項認錯的第 1 行離上一個選項超過門檻、最後一行不貼下一條 → 都不是標頭形狀;3 行選項的中間行 / 第 1 個選項的第 1 行認錯是標頭形狀,但只有 1 行 |
| (加分)| 命中框正下方 ≤ 6 × 行高、x 對齊的「確認」+1、上方 ≤ 20 × 行高的「靈魂之井」(OCR 常掉首字,比對 `魂之井`)+1;renderer 挑面板時每分 +5 | **只加分,不是必要條件**(裁切圖 / 部分框選看不到) |

**正樣本量測**(三張真實快照,`poe2/test/desecration/panel-veto.test.ts` 斷言):

| 快照 | 行高 | 組 × 行 | 組內行距 | 組間行距 | 附近非詞綴行 | 固定元素分 |
|---|---|---|---|---|---|---|
| body-armour-01(裁切圖) | 23.3 | 2 / 2 / 3 | 1.54 | 3.09、2.31 | 無 | 0 |
| fullscreen-02 | 18.7 | 1 / 2 / 1 | 1.50 | 3.78、3.76 | 「確認」(下方 3.3 × 行高) | 1 |
| fullscreen-03 | 18.3 | 1 / 1 / 1 | — | 4.64、4.63 | 「確認」(下方 3.4 ×) | 2 |

三張整個畫面都沒有冒號 / 關鍵字行、詞綴行之間沒有夾任何未命中行;**body-armour-01 的第 3 組剛好 3 行 = 上限**(一條 3 parts 的詞綴)。

**×1 快照(第 A 批補)**:三張正樣本補了整張 ×1(`locate`,`node scripts/ocr-fixture.mjs --with-locate --locate-only well-of-souls`,×3 的 `lines` 原樣保留)。
body-armour-01 ×1 第 2 個選項的第 1 行認錯成 `增加25。/。護甲值和因`(`%` 掉了、沒有 `+數字`),離上一個選項 2.55 × 行高、離同選項第 2 行 1.17 × —— **舊 `tooltip-header` 把它當標頭,整個面板在自動定位那一段被否決**(真實誤殺);改後 `locatePanel` 找得到、沒有否決。
fullscreen-02 ×1 改前改後都找得到;fullscreen-03 ×1 只認出 1 行亂碼(字太小)、沒有像詞綴的行 → `locatePanel` null、沒有否決(runtime 退回整張 ×3,×3 是面板),不是規則問題。
改前 / 改後對三張快照跑 `matchReveal`(無 profile / `Rogue Armour` / 不取交集)、`modLines`、`findPanelHits`、`locatePanel`、`checkRegion` 的 JSON 輸出**逐位元組相同**。

**負樣本**:
- 真實:`fixtures/ocr/tooltip-gloves-advanced-01.png`(使用者的全螢幕截圖 1920×1080,`images/4.webp` 以 sharp 無損轉 PNG;畫面上還疊著舊版誤出的徽章與提示),
  `node scripts/ocr-fixture.mjs --with-locate tooltip` 產生 ×3 + 整張 ×1(`locate`)快照。整張 ×3 的浮窗簇 = 4 行連在一起 → main `group-too-tall`、renderer `too-many-groups`;
  ×1 只認出 2 行 → 附近「可以有1個額外工藝詞綴」→ `keyword-line`。`--ocr-selftest` 改前走 two-pass 框到浮窗 (1032,406 566×280),改後 `locate` 沒有候選 → full、像詞綴 0。
- 合成(依真實快照的行):A 同一個浮窗沒開進階說明 + 分隔線(前綴 2 行 / 後綴 3 行,舊判定會過)→ `keyword-line`;B 每條詞綴上方一行「前綴 / 後綴詞綴 …(階級: n)」標頭 → 否決
  (只留 2 條詞綴 + 標頭也否決);B' 標頭沒有關鍵字 → `tooltip-header`;C 稀有裝備 5 條詞綴有空隙 → `too-many-groups`;C' 6 條連在一起 → main `group-too-tall` / renderer `too-many-groups`;
  浮窗與面板同框(fullscreen-02 + 合成 5 組浮窗)→ 面板照常、裁切框不含浮窗。
- 斷言三層:`findPanelHits` / `locatePanel` null、`matchReveal` `no-panel`、`PanelScan`(假時鐘 60 秒,沒框區域)不送任何事件;使用者的區域 + 浮窗截圖 → 只 OCR 區域、不送列。

**殘留風險 / 需要更多真實截圖**:沒有屬性行、只有 2 組(例:1 行固有 + 分隔線 + 3 行詞綴)且組內 ≤ 3 行的浮窗,三條規則都不觸發(main 仍會送列,renderer 照舊挑面板);
沒框區域時才會遇到(有框區域只看區域)。
**誤殺範圍(第 A 批後)**:`tooltip-header` 要 ≥ 2 行標頭形狀才否決 —— 同一個面板裡同時有兩行「認錯、不像數值(沒有 `%` / `+數字`)、上下都緊貼命中行(3 行選項的中間行)或位於第 1 個選項第 1 行」才會誤殺;
某選項的最後一行或(第 2、3 個選項的)第 1 行認錯不會(改前這兩種只要一行就整個面板否決,body-armour-01 ×1 即是)。
反過來,浮窗只認出 1 行標頭、或標頭上方那條詞綴沒認出(上一條命中行超過 1.9 ×)時,這條規則不觸發,要靠關鍵字 / 組數規則。
面板 + 1 條雜行(4 組)的段改為挑窗後才判定;4 條詞綴有空隙、沒有屬性行 / 標頭的浮窗會被當成「面板 + 雜行」挑 3 組(改前會否決;實際浮窗的詞綴是連在一起的,已由「連續 > 3 段」擋)。
真實面板的詞綴折行但折行合併失敗(4 行)→ main `group-too-tall`。

### 徽章排版與「?」文案(2026-10-01 第 13 步)

- **防碰撞**(`ocr-reveal.ts` `layoutBadges` → `stackBadges`):左緣統一 = 所有組右緣的最大值 + 14(對齊同一個 x);依組中心由上而下,上緣 = max(組中心 − 半高, 上一枚下緣 + 4 px);
  最後一枚超出視窗下緣 → 整體上移(最多移到第一枚貼齊上緣,再多就讓下緣超出,不壓縮間距)。`top` 改為徽章**上緣**(CSS 拿掉 `translateY(-50%)`)。
  第一次用估計高度(`--fs-base` × 1.45 × 行數 + padding)排,畫出來後 `OcrBadges.vue` 量 `offsetHeight` 再排一次(字型 / 縮放讓估計不準也不重疊)。
- **多候選收合**:預設每組只列最可能的一個(候選順序同 `matchReveal`:Tier 下限 → 詞綴池;取第一個非模糊命中,沒有就第一個)+ 小字「+N」;
  設定 › 熱鍵與視窗 › 褻瀆卡片「一個選項有多個可能詞綴時全部列出」(`revealShowAllCandidates`,預設關,只影響 overlay、不送 main)開 = 全列。
  overlay 整層點擊穿透,`title` / hover 展開看不到,所以選設定開關(不失去資訊;renderer log 一律列全部候選)。
- **「?」文案**(`guessNoteKey`):`profileSource === 'all'`(三組候選的可能底材交集為空)→ `ppz.ocr.guess_title_all`「不知道底材…三個選項也找不到共同的可能底材,階層依全部可能底材推算」;
  交集 / 類別維持原文案;精確不顯示。繁中 / 英文都有。

### 徽章外觀(第 11 步,2026-10-02;與符文共用)

設定 › 熱鍵與視窗「徽章外觀」卡片的字體 / 大小 / 粗體 / 外框陰影也套用到褻瀆徽章(欄位與做法見 `docs/runeshape.md`「徽章外觀」);價格三段色**不**套用,
模糊命中警告色(`.fuzzy`)、dim / 原文列的灰色照舊。防碰撞:估計高度改用設定的字級(`revealBadgeFontPx`;跟隨時仍是 `--fs-base`),
改外觀 → 以最後結果重新排版,畫出來後量 `offsetHeight` 再排,`document.fonts.ready` 之後再量一次(換字體時字型載入較慢)。
`renderer/test/badge-style.test.ts` 對 10 / 13 / 18 / 24 / 32 px 驗證行距 29 px 的三組多列徽章間距 ≥ 4 px(估計高度與實測高 10% 兩種)。

### 排程與退避(效能修正第 6 步,2026-10-01;褻瀆與符文共用 `panel-scan.ts`)

只改「什麼時候 OCR / 送事件」,擷取、JPEG、WinOcr、比對演算法都沒動;辨識結果不變(`--ocr-selftest` / `--runeshape-selftest` 改前改後逐行對照,只差下面第 5 點的「不重送」)。

1. **大幅變化**(`isLargeChange` / `tileMaxDiff`):寬 64 的灰階縮圖切成 8×8 小塊,任一塊平均差 ≥ 6 或變動比例(單像素差 ≥ 16)≥ 0.15。
   門檻以 `well-of-souls-fullscreen-02` 推導(「沒有面板」用同張截圖的場景塊合成):面板出現時最大一塊 18–89 / 0.63–1.0,**淡入一半**(最難)8.3 / 0.20;
   鏡頭平移 4 px 3.0–3.5 / ≤ 0.08、8 px 6.2–7.3 / 0.11–0.20。看最大一塊是因為整張平均會被面積稀釋(只有詞綴框出現時整個 client 平均差只有 0.6–2.7)。
2. **手動區域沒有面板的退避**:空結果送出之後(連續第 2 次無列起,空結果的時機不變),區域「有變化但不大」的 OCR 間隔變成掃描間隔 × 2、× 4…,上限 `IDLE_BACKOFF_MAX_MS` 2.5 秒;
   退避中差分基準不動(下次仍與上次 OCR 的畫面比,累積的變化會變大幅);**大幅變化立即 OCR 並把退避歸零**;找到面板 → 完全回到原行為(每次有變化就 OCR)。
3. ~~**褻瀆退回自動定位**~~:第 13 步已移除整個退回機制(有框區域只看區域),這一條不再適用。
4. **自動定位**(沒框區域 / 退回中、沒有快取):擷取節流照舊每 3 秒最多一次;擷取後以整個 client 的縮圖與上次定位時比 ——
   大幅變化 → 立刻定位並把退避歸零;距上次定位 ≥ 15 秒 → 必定位;幾乎沒變(`isChanged` 為否)→ 跳過;連續沒找到 n 次 → 間隔 `locateGapMs`:3 → 6 → 12 → 15 秒。
   兩個掃描共用 `SharedLocateOcr`(main 建一個):同一 client 大小 / 擷取偏移 / 影像大小 1 秒內的整個 client ×1 只 OCR 一次(兩邊都是 ×1、同一個 WinOcr、同一語言;各自跑自己的 `detector.locate`,只決定裁切框)。
5. **不重送相同結果**:`rows` 的簽章(列文字 + 四捨五入座標 + client,`rowsSignature`;第 13 步拿掉 fallback)與上次送出的相同且未滿 10 秒(`REPEAT_ROWS_MS`)→ 不送(統計 / 基準照常);
   `empty` / `inactive` / `user-paused` / `user-resumed` 一律送,送過就清掉簽章;暫停、框選確認、換模式也清掉(恢復後同一份列照送,Esc 清掉的徽章因此會回來)。
   main 的 OCR log 同一結果不重複印,下一行不同時附「其間 N 次相同」。renderer(`scan-dedupe.ts`):鍵 = 列 + client + 會影響比對的輸入(褻瀆:profile 提示;兩者:遊戲、資料集世代 `dataGeneration`),
   與**目前畫著的**相同就不重比 / 重排 / 印 log;符文每列的市集查詢計畫一次結果只算一次(`plans` computed)。
6. **tick 不重入**:一進 tick 就設 `ticking`(原本 `inFlight` 在 `await det.ready()` 之後才設,第一次讀 tiers.json 時 `poke()` 會再開一個 tick);`busy`(給另一個掃描丟 tick 用)仍只在擷取 / OCR 期間為真。

「面板出現 → 徽章」的延遲:面板出現屬大幅變化 → 與原本同一個 tick OCR(手動區域);自動定位仍在原本的 3 秒擷取節奏內定位到。
殘留風險:面板出現時最大一塊的變化 < 門檻(例如暗色面板疊在幾乎一樣暗的背景、而且框的區域遠大於面板)→ 最多晚 2.5 秒(手動)/ 15 秒(自動定位退避上限)。待使用者實機確認。

### 擷取與 OCR 傳輸(效能修正第 7 步,2026-10-01;褻瀆與符文共用)

硬性要求「辨識結果不可變」:送進 WinRT 的影像位元組完全不變(仍是 `nativeImage.resize({ quality: 'best' })` + `toJPEG(95)`),只改傳輸與腳本輸出。
`--ocr-selftest`(整張 / 加 `--ocr-selftest-region`)、`--runeshape-selftest`(兩張樣本 × 自動定位 / 預設整張 / 指定區域)改前改後去掉耗時逐行相同(含每列名稱比對與價格);
`node scripts/ocr-fixture.mjs --set all` 重產的 5 份快照與 repo 位元組相同;舊 / 新腳本對 5 張樣本 ×1 / ×3 的 stdout 原始行(去掉 `ms`)位元組相同,`words:false` 的回應 = 舊回應去掉 `words`。

1. **影像改走暫存檔**(`WinOcr.ts`):原本整張 JPEG base64 塞進 stdin 一行(整張 ×3 約 4 MB),PowerShell 要對 4 MB 字串跑 regex + `FromBase64String`。
   改為非同步寫到 `os.tmpdir()/exile-appraiser-ocr/<pid>-<實例>-<id>.img`、stdin 只送 `{"id","path","words":false}`;回應 / 錯誤 / 逾時 / 行程結束後刪檔;
   第一次寫入前清掉殘留(檔名的 pid 已不在、或超過 1 小時;本行程的檔與其他檔名不碰,`cleanStaleOcrFiles`)。暫存目錄寫不進去 → 退回舊的 stdin base64(只警告一次)。
2. **不輸出 words**:runtime(`rectRecognizer`)帶 `words:false`,腳本不組每個 word 的 JSON(行的外框仍由 word 算,與原本相同);不帶時照舊輸出(fixture 快照沿用)。全 repo 沒有讀 `.words` 的地方。
3. **腳本小修**(`win-ocr.ps1`):三個 `AsTask<T>` 啟動時建好(原本每次反射 `MakeGenericMethod`);`Esc` 改 .NET `Regex.Replace` + `MatchEvaluator`
   (只有要跳脫的字元進 PowerShell;0–0xFFFF 全部字元與舊版逐位元組比對相同,一行約 0.19 → 0.11 ms);有 `path` 時先讀路徑。
4. **兩個掃描共用擷取**(`panel-scan.ts` `SharedCapture`,main 建一個):同一 client bounds 進行中的擷取一起等、完成後 100 ms 內直接用同一張。
   兩個掃描本來就錯開半個間隔且對方擷取 / OCR 中會丟 tick,所以只在「對方剛擷取完、沒 OCR」時命中;命中時省一次 `getSources`(見下)。
5. **評估後不做**(實測會改結果,或量到沒有效益):
   - **差分 tick 用小縮圖、要 OCR 才抓全解析度**:本機(2560×1440 + 1440×2560 兩個螢幕)量 `desktopCapturer.getSources`,每次在 main 執行緒卡 **300–480 ms**,
     縮圖 2560×1440 / 1280×720 / 1024×576 / 512×288 都一樣(時間花在擷取本身,不在縮圖大小);兩階段反而讓要 OCR 的 tick 多一次 `getSources`。
     真正的解法是常駐的擷取串流(例如隱藏 renderer 的 `getDisplayMedia`),屬架構變更,未做(第 12 步原型因 I420 幀改變 OCR 結果放棄;**第 17 步改用 overlay 原生 `screenshot()`,見下**)。
   - **放大 / JPEG 移出 main 執行緒**:(a) 送 ×1 給 PowerShell 用 `BitmapTransform` 放大 —— Cubic / Fant / Linear / NearestNeighbor 對 5 張樣本(整張 + 面板區)
     都有文字改變(例:`1 × 崇 敬 狩 獵 符 文` → `lx 崇 敬 狩 獵 符 文`、整張 ×3 行數 15 → 7~13);連「同一張 'best' 放大圖改送無損 BMP」都會改文字。
     (b) `utilityProcess` / worker 沒有 `nativeImage`,換別的縮放 / 編碼器位元組必不同。→ 維持原做法(本機 1440p 以下:面板區 ×3 約 11 ms、整張 ×1 約 15 ms、整張 ×3 約 165 ms)。

耗時(本機,同一張圖、各兩次):

| 項目 | 改前 | 改後 |
|---|---|---|
| WinOcr 往返:整張 2000×1125 ×1(定位) | 264 ms(傳輸 + 解析 12 ms) | 186 ms(3 ms) |
| WinOcr 往返:面板 499×302 ×3 | 92 ms(4 ms) | 78 ms(3 ms) |
| WinOcr 往返:整張 ×3(JPEG 3 MB) | 1071 ms(61 ms) | 846 ms(6 ms) |
| `--ocr-selftest` ① two-pass(冷) / ④ two-pass(熱) | 502–554 / 303–471 ms | 427–443 / 254–261 ms |
| `--ocr-selftest` ③ 整張 ×3 | 1096–1260 ms | 1001–1054 ms |
| `--runeshape-selftest` 整張 ×1 定位(skills-01 / rewards-02) | 400–416 / 250–271 ms | 265–296 / 199–212 ms |

「行程內」耗時也下降(不再對大字串跑 regex / base64 解碼、少組 words 字串)。main 執行緒上原本的 base64 + JSON 只有 1.4 ms(595 KB)~ 3.3 ms(3 MB),省下的主要是 PowerShell 端。

#### 擷取改用 overlay 原生 `screenshot()`(效能修正第 17 步,2026-10-02)

第 7、12 步量到 `desktopCapturer.getSources` 每次卡 main 300–600 ms;第 12 步的常駐串流原型(分支 `proto/capture-stream`)因幀是 I420(YUV 轉換)改變 OCR 結果而放棄。
改用 APT / EE2 同款的 `OverlayController.screenshot()`(electron-overlay-window 4.1.0,根 `node_modules` 那份;原生 `windows.c` `ow_screenshot`):
`GetDC(GetDesktopWindow())` → 32 bpp top-down `CreateDIBSection` → `BitBlt SRCCOPY`,同步、在呼叫執行緒、只擷取**目前 attach 的視窗的 client 區**
(位置 = `ClientToScreen(hwnd)`、寬高 = 原生最後收到的 attach / moveresize bounds),回傳 BGRA Buffer;非 win32 throw。

| 檔案 | 做什麼 |
|---|---|
| `main/src/ocr/overlay-shot.ts` | 純函式(不 import electron):`clientCropOnDisplay`(兩條路共用的裁切)、`planOverlayShot`(尺寸 / bounds / 螢幕檢查 → 裁切框與 `offset`)、`looksBlack`(32×18 點抽樣,B/G/R 全 0 = 黑)、`createGameClientCapture`(先 overlay、不行退回 getSources,每種原因只記一次 log) |
| `main/src/ocr/capture.ts` | `captureGameClientViaSources`(原 `captureGameClient`,改用 `clientCropOnDisplay`,行為不變)、`createOverlayClientCapture`(接 `pickDisplay` / `nativeImage.createFromBitmap` / getSources 後援) |
| `main/src/windowing/GameWindow.ts` | 加回 `screenshot()`(APT 原本就有,移植時因沒有 OCR 拿掉) |
| `main/src/main.ts` | `SharedCapture` 改用 `createOverlayClientCapture`;overlay 模式才傳 `screenshot`(視窗模式 `scanBlock` = `not-overlay`,掃描本來就不跑,傳了也用不到) |

- **擷取對象**:掃描用的 `bounds` = `GameWindow.bounds` = `OverlayController.targetBounds`,就是 overlay attach 的遊戲 client(與原生 `last_reported_bounds` 由同一個事件更新);
  仍逐次比對,不同就退回。
- **裁切與 `offset`**:與 getSources 路徑共用 `clientCropOnDisplay` —— 只留含 client 中心點的那個螢幕內的部分(跨螢幕 / 部分在螢幕外時兩條路裁出同一塊、同一個 `offset`;BitBlt 對螢幕外的部分是 0,一併裁掉)。
  DPI:Electron 是 per-monitor DPI aware,原生 `GetClientRect` / `ClientToScreen` / BitBlt 都是實體像素,與 getSources 縮圖(= 實體大小)同座標系。
- **後援(退回 `captureGameClientViaSources`)**:`screenshot()` throw(非 win32 等)、Buffer 長度 ≠ 寬 × 高 × 4、遊戲 bounds 與原生記得的不同、
  裁切後的區域全黑(全螢幕獨占 / 硬體 overlay 時 BitBlt 可能拿到黑畫面;抽 576 點全 0 才算,很暗的畫面不會誤判,真的全黑的讀取畫面退回也只是多一次擷取)、
  client 不在任何螢幕上(交給 getSources,它照舊 throw `no-game-window`)。每種原因第一次記 `[capture] overlay screenshot 不可用(原因)` log。
- **alpha**:BitBlt 回來的 alpha 實測全是 255(抽樣 36,131 / 38,005 點),`createFromBitmap` 直接用。

量測(`npx electron main/dist/main.js --capture-bench --bench-title=<前景視窗標題> --bench-blt=scripts/capture-bench-bitblt.ps1 --bench-fixture=<6 張>`,
不拿單一實例鎖、不送輸入、不搶焦點、不存影格;本機 2560×1440 主螢幕 + 1440×2560 直立副螢幕,Electron 40.10.6):

| 項目 | getSources(現行) | overlay `screenshot()` |
|---|---|---|
| main 執行緒最長卡頓(事件迴圈探針,每次;7 輪 × 10 次) | 253–497 ms(各輪中位數 298–354) | 13–48 ms(各輪中位數 20–34) |
| 單次耗時 | wall 311–629 ms(各輪中位數 362–501) | 同步呼叫 16.5–49 ms(各輪中位數 21.5–22.4);含 `createFromBitmap` 的整條路徑 17–29 ms(中位數 21–24) |
| 擷取範圍 | 整個螢幕 2560×1440 再裁 | 只有 attach 的 client(實測 2560×1369) |

GDI 序列在另一個行程(`scripts/capture-bench-bitblt.ps1`,與 `ow_screenshot` 相同呼叫;檔案帶 UTF-8 BOM,PowerShell 5.1 才不會把中文註解讀壞)擷取 2560×1440:19–29 ms,與原生同量級。

一致性(門檻:三條 OCR 路徑的輸出全部與 getSources 相同):

| 比對 | 結果 |
|---|---|
| 副螢幕(使用者要求量測視窗只開在副螢幕;GDI 序列像素 → 同一條 `createGameClientCapture` 路徑),6 張 fixture 1:1 顯示 | overlay vs getSources **逐像素相同(差異 0 個像素)**、`toJPEG(95)` **逐位元組相同**;getSources 自身前後兩次差 0 |
| 同上,OCR(`smartRecognize` / 整張 ×3 / 整張 ×1 定位)× 6 張 | **18 / 18 相同**(行文字、座標、走哪條路都一樣) |
| 主螢幕(原生 `screenshot()`,attach 當時的前景視窗,fixture 放在它的 client 左上;使用者要求改副螢幕之前量的)× 6 張 | OCR **18 / 18 相同**;像素差 3–477 個(兩種擷取各自與原圖不同的像素數相同,例 6317 / 6317;這一輪沒有逐像素歸因) |
| 主螢幕(GDI 序列)× 6 張 | OCR 18 / 18 相同;像素差 64–1030 個,**全部**落在「兩種擷取都與原圖不同」的像素上(只有一邊錯 = 0):那幾個像素在主螢幕上前後幀不穩定,不是擷取方法造成(副螢幕上同樣的比對差 0) |
| 透明、不可點擊的置頂 Electron 視窗(模擬 overlay 徽章)蓋在 fixture 上 | 兩種擷取**都**包含它(紅塊 100% / 100%)—— 與現行行為相同 |
| 寬 2000 的 fixture 在 1440 寬的副螢幕上(client 跨出螢幕) | 兩條路都裁成 1440 寬、`offset` 相同 |

與原圖(同頁 canvas 解碼)比,兩種擷取都有約 0.3–0.5% 的像素不同(瀏覽器顯示與 canvas 解碼的差異,兩邊完全一樣),所以部分 fixture 的 OCR「擷取 vs 原圖」不同,但「overlay vs getSources」全部相同。
**未實測**:遊戲全螢幕獨占模式(預期 BitBlt 全黑 → 退回 getSources;getSources 在該模式本來也可能黑,建議無邊框視窗)、Wine(win32 API 由 Wine 實作,throw / 全黑都會退回)、遊戲 client 在副螢幕時的原生路徑(原生只能 attach 前景視窗,量測時副螢幕上沒有前景視窗;副螢幕改用相同 GDI 序列驗證)。

### 模糊比對(效能修正第 8 步,2026-10-01;定位 / 揭露比對 / 符文名稱共用 `ocr-text.ts`)

比對結果與改前**逐位元相同**(門檻、分數、同分順序都沒變),只少算:
- **長度剪枝**(`fuzzyLengthPossible`):Levenshtein ≥ 長度差 d,故相似度 ≤ `1 − d / max(L, m, 1)`;用與比對處同一個浮點式判定,
  換算為 d = 0 恆比、d = 1 要較長者 ≥ 7 字、d = 2 要 ≥ 14 字(L ≤ 5 只比同長;6 → 6–7;7–11 → ±1;12–13 → −1…+2;≥ 14 → ±2)。
  被剪掉的候選原本也是「低於門檻 → 跳過」,不影響最高分與命中清單。
- **分桶 + 原順序**(`FuzzyCandidates`):模板 skeleton / 名稱 key 依碼點長度分桶、碼點陣列預先切好;候選取出後依原始索引排序,
  「取最高分、同分依出現順序」與全掃相同。符文名稱的 `digitsOf(key)` 預算。
- **Levenshtein** 改吃碼點陣列、兩列 `Int32Array` 緩衝重用(不遞迴、不呼叫外部程式碼 → 不重入)。
- **結果 LRU**(上限 2,000):`lineLooksLikeMod` / `matchLine`(鍵 = 正規化後的 skeleton)、`lookupRuneName`(鍵 = 名稱);
  掛在索引物件上(WeakMap / `OcrIndex` 欄位),換資料自然失效;回傳的物件每次新建,不與快取共用。
- 等價測試 `poe2/test/desecration/ocr-fuzzy-equivalence.test.ts`(oracle = 改前實作,只放在測試檔):全部 OCR 快照的行(含相鄰兩行接起來)、
  所有 skeleton / key 本身、固定種子擾動各 6,000 筆,第二次呼叫(走快取)也要相同。

耗時(vitest 內、快照行,中位數;冷 = 新索引第一次、熱 = 同一份畫面再算):

| 呼叫 | 改前 冷 / 熱 | 改後 冷 / 熱 |
|---|---|---|
| `findPanelHits` fullscreen-02(13 行) | 0.6–0.8 / 0.43 ms | 0.16–0.88 / 0.02 ms |
| `findPanelHits` tooltip-gloves-advanced-01(88 行) | 13.8–17.4 / 13.9–15.7 ms | 3.1–4.3 / 0.15 ms |
| `matchReveal` tooltip-gloves-advanced-01 | 14.2–14.6 / 12.7–13.4 ms | 2.2–4.1 / 0.13–0.21 ms |
| `matchRunesRowsWith` skills-01(12 列) | 8.6–13.5 / 9.9–11.4 ms | 1.7–2.2 / 0.02 ms |

### 設定頁(與符文塑形對等,2026-10-01)

使用者要求「褻瀆詞綴辨識與符文的辨識開關一樣可以做設定;設定褻瀆的快捷設定位置移到褻瀆框中;移除褻瀆手動輸入比例;
框選 OCR 區域快捷鍵都於各自的設定中給予按鈕設定;掃描的間隔開放下限」。兩張卡片共用 `renderer/src/web/settings/OcrScanSection.vue`(`kind` = `reveal` / `runeshape`):

| 列(兩者相同順序) | 褻瀆 | 符文塑形 |
|---|---|---|
| 啟用 | `revealAutoEnabled` | `runeshapeEnabled` |
| 目前狀態(+「更新」讀 main 統計) | `revealScanStatus`:找到 / 尋找中、框選區域內有 / 沒有找到(第 13 步起與符文同文案)、已暫停 | 自動定位:已找到 / 尋找中、框選區域內有 / 沒有找到、已暫停 |
| 掃描間隔 | `revealIntervalMs` | `runeshapeIntervalMs` |
| 區域 + 「在遊戲上框選」「清除」 | `ocrRegion` | `runeshapeRegion` |
| 暫停 / 繼續熱鍵 | `hotkeyOcrReveal` | `hotkeyRuneshapeToggle` |
| 框選區域熱鍵 | `hotkeyOcrRegion` | `hotkeyRuneshapeRegion` |
| 最近耗時 | `reveal-stats` 的 `last` / 平均 | renderer 最近一次事件 + `runeshape-stats` 平均 |
| 專屬 | OCR 語言包狀態 +「重新檢查」、「一個選項有多個可能詞綴時全部列出」(第 13 步) | 台服提示、顏色門檻 |

- **掃描間隔 100–3000 ms**(main `clampScanInterval` / renderer `clampRuneshapeInterval` 同值 `SCAN_INTERVAL_MIN_MS` / `MAX`;原本 500–3000);低於 500 ms(`SCAN_INTERVAL_CPU_WARN_MS`)設定頁顯示 CPU 負擔提示。
  `PanelScan` 在上一次 tick 做完才排下一次,間隔再短也不會重疊;兩個掃描共用 WinOcr,對方忙碌就丟 tick。
- **兩個暫停鍵可以設成同一個**(第 16 步):`hotkeyOcrReveal` 與 `hotkeyRuneshapeToggle` 正規化後相同、且兩者都符合註冊條件
  (褻瀆:overlay + PoE2 + `revealAutoEnabled`;符文:overlay + PoE2 + `runeshapeEnabled`)→ `shortcut-actions.ts` 合併成一個 `scan-toggle-both`
  (放在 `ocr-reveal` 的位置),`Shortcuts.ts` `onScanToggleBoth`;切換規則 `nextScanPaused`:任一個在執行 → 全部暫停,全部暫停 → 全部繼續
  (`PanelScan.setUserPause`,已是目標狀態的不重送事件)。只有一個符合條件時照舊是單一切換。設定頁(`hotkey-conflicts.ts` `shared`)兩欄不標重複,
  改顯示「與符文辨識 / 褻瀆辨識共用,一次切換兩者」;與其他熱鍵(查價、框選、聊天指令…)重複的規則不變。
- **切換通知**(第 16 步):按暫停 / 繼續熱鍵後右下角提示「褻瀆辨識:已啟動 / 已暫停」(合併時兩行),沿用啟動提示的視窗(docs/release-flow.md「啟動提示」)。
- **熱鍵移進各自卡片**:通用「熱鍵」卡片只剩查價 / 鎖定 / overlay;四個辨識熱鍵在卡片內。衝突檢查(`hotkey-conflicts.ts` + `useHotkeyIssues.ts`)仍涵蓋全部熱鍵(含聊天指令),依 main 註冊順序先到先得,
  保留鍵 / 重複 / 被其他程式佔用都顯示在該欄位下方;對不回任何欄位的 main 錯誤顯示在熱鍵卡片底部。
- **符文框選熱鍵** `hotkeyRuneshapeRegion`(預設空):`shortcut-actions.ts` 動作 `runeshape-region`(overlay + PoE2,不看是否啟用)→ `Shortcuts.ts` `onOcrRegionPick('runeshape')`
  → main 送 `ocr-region-pick` 帶 `{ target: 'runeshape' }`(揭露面板照舊不帶內容)→ `OcrRegionPicker.vue` `openRegionPicker('hotkey', 'runeshape')`。
- **手動比例欄位已移除**(原「進階:手動輸入比例」四個數字欄位);`Config.ts` 仍讀寫舊檔的 `ocrRegion`(`normOcrRegion`)。
- 舊的按熱鍵辨識一次(`RevealOcr`、`ocr-reveal-result`)已移除;兩段式 `strategy.ts`(`smartRecognize` / `recognizeRegionFirst`)仍給 `--ocr-selftest` 用,下文「兩段式辨識」「框選辨識區域」的**單次**流程描述保留作歷史紀錄。
- 測試:`main/test/reveal-scan.test.ts`(三張真實截圖快照當畫面:偵測器定位 / 判定、自動定位 → ×3、畫面沒變不 OCR、面板關了 empty、查價面板開著照常、設定開著暫停、no-data、共用 WinOcr 忙碌、暫停熱鍵、區域內有面板 / 沒面板只送 empty 不改找整個畫面、rescan、停用清徽章;
  第 6 步:區域沒面板時小變化退避且從不整張定位、兩個掃描共用定位 OCR 且結果與自己 OCR 相同、tick 不重入;第 13 步:負樣本 classify / locate / PanelScan 不送列、使用者的區域 + 浮窗截圖只看區域、浮窗與面板同框)、
  `renderer/test/reveal-scan.test.ts`(事件 → 徽章動作、狀態列、設定往返)、`renderer/test/scan-dedupe.test.ts`(同一份列不重算)、`main/test/runeshape-scan.test.ts`(泛化後符文行為不變;第 6 步的退避 / 大幅門檻 / 定位退避 / 不重送)。

#### 遮掉自己畫的東西(效能修正第 18 步,2026-10-02;褻瀆與符文共用)

**症狀**(使用者錄影 + log #32–#40,手動區域 1258×907 ×3):乾淨畫面「5 行 → 5 列(面板命中 3)」→ 畫出三枚徽章 → 下一輪「7 行 → 7 列(面板命中 2)」只剩 2 組
(第一行「此武器的攻擊穿透25%的火焰抗性」那組掉了)→ 再下一輪「5 行 → 0 列(面板命中 1)」→「清除徽章(面板關了)」→ 回到乾淨,約 3 秒一循環。
**根因**:擷取(第 17 步的 overlay `screenshot()` = BitBlt 桌面,舊的 `desktopCapturer` 也一樣)會截到我們自己的 overlay 視窗。徽章畫在每組右側
(左緣 = 組右緣 + 14 px、與該組同高),WinRT 把徽章文字(`T1? · 阿姆那姆 · 15–25`)併進同一行的詞綴或自成一行 → 那組對不上 → 少組 / 判定沒有面板 → 清徽章 → 畫面又乾淨。
合成重現(`scripts/ocr-mask-check.mjs`,見下):fullscreen-02 dpr 1 → 3 組變 2 組、fullscreen-03 dpr 1 → 判定沒有面板、body-armour-01 → 第 1 / 3 組 Tier 改變。

**做法**(不用 `setContentProtection`:會讓使用者自己的截圖 / 錄影也看不到徽章):

| 段 | 檔案 | 做什麼 |
|---|---|---|
| 回報 | `renderer/src/web/overlay/scan-mask.ts` + `OcrBadges.vue` / `RuneshapePrices.vue` | 每層在 DOM 更新後、paint 前(`watch(..., { flush: 'post' })`、`nextTick`)量自己的**直接子元素**(褻瀆:徽章 + 「?」說明;符文:徽章 + 提示)的 `getBoundingClientRect`,送 IPC `scan-mask`(`{ source, seq?, viewport: innerWidth/innerHeight, rects }`,CSS px);**每個掃描事件處理完都帶它的 `seq`(ack)**,不論畫 / 清 / 被 dedupe 略過;內容相同且沒有新 seq 不重送;清除 = 空陣列。**字型**:量外框會強制排版,第一次用到的字型這時才開始載入、載完寬度會變(離屏實測徽章 139 → 161 px)→ `reportWithAck` 先送外框不 ack,`document.fonts` 載完(褻瀆再 `restackMeasured`)重量才 ack;另聽 `loadingdone` 重量 |
| 保存 / 換算 | `main/src/ocr/scan-mask.ts` `ScanMaskStore` + `main.ts` | 每個來源一份(新的取代舊的;被取代的那份再遮 `MASK_LINGER_MS` 300 ms = DOM 已移除、畫面上可能還有一兩幀)。擷取當下依**這次擷取的 client 大小**換算:client px = CSS × client.w / innerWidth(renderer 收結果時 `innerWidth / client.w` 的反向)、外擴 `MASK_PAD_CSS_PX` 3 CSS px、外取整,再減擷取偏移成影像像素、夾在影像內(`imageRects`)。不讓 renderer 自己換成 client px:提示可能比第一個掃描結果先出現(還不知道 client 大小),而 main 擷取時一定知道 |
| OCR 前填掉 | `capture.ts` `toScanCapture(cap, ocr, mask)` → `prepareRect` | 與裁切塊有交集才處理:裁切後 `toBitmap` → `fillMaskRects` → `createFromBitmap` → 照舊 `resize('best')` + JPEG q95;沒有交集時影像位元組與之前完全相同。1258×907 區域遮 3 塊:填色約 1 ms + 點陣往返約 1.3 ms(`prepareRect` ×3 中位數 70.8 → 76.1 ms) |
| 差分不比 | `panel-scan.ts` `Fingerprint.ignore`、`frameDiff` / `tileMaxDiff`;`capture.ts` `grayFingerprint` | 遮罩蓋到的縮圖格子(再外擴 1 格,縮放濾鏡會混邊)標成不比;前後兩張**任一張**標了就跳過 → 徽章出現 / 消失本身不算畫面變化(否則徽章一畫上就是「大幅變化」立即 OCR)。小塊剩不到半塊可比的略過;全被蓋住 = 沒變化。沒有遮罩時與之前逐值相同 |
| 競態 | `panel-scan.ts` `drawPending` / `drawSettled`、`ScanMaskStore.pending` | 見下 |

- **填色**(`fillMaskRects`,runtime 用 `feather`):每塊外第 1–2 圈、不在任何遮罩內的像素逐通道取中位數實心填滿,靠邊 4 px 從外圈原像素線性漸變到填色(不留硬邊);
  全部先取樣再填,相鄰 / 重疊的徽章(褻瀆徽章間距 4 px < 兩邊各外擴 3 px)不會吃到彼此的填色。
- **外擴只取 3 CSS px**:涵蓋 `box-shadow` 的 1 px 外框環與量測取整(第 11 步外框是 8 方向 1 px `text-shadow`,在徽章框內);柔和陰影(blur 32 px)不遮 ——
  徽章左緣距該組最右的字只有 14 px,遮大了會蓋到面板自己的字;陰影只讓背景變暗,下表實驗 OCR 不受影響。

**填色的選擇**(`node scripts/ocr-mask-check.mjs --fill feather,ring-median,dark --control`;褻瀆 3 張 + 符文 2 張正樣本 × dpr 1 / 1.5 × 自動定位框 / 「定位框 ∪ 徽章外擴 40 px」手動框 = 20 個情境,真 WinOcr;
徽章依 runtime 排版(褻瀆 `layoutBadges` → 以畫出的實際高度 `stackBadges`;符文 = 列右緣 + 14、垂直置中)用 sharp 畫:暗底 #131820、金色左條 3 px、`--ink-0` 字、13 / 12 CSS px × dpr、1 px 黑環):

| | 比對結果與無徽章原圖相同 | 行文字逐字相同 |
|---|---|---|
| 有徽章、不遮 | 褻瀆 6 / 12 改變(重現掉組) | 5 / 20 |
| `feather`(採用) | **20 / 20** | 17 / 20 |
| `ring-median`(只填中位色,硬邊) | 19 / 20(符文 skills-01 一列尾巴多了「ㄗ」被判成面板外) | 18 / 20 |
| `dark`(固定 #101010) | 20 / 20 | 16 / 20 |
| Coons 曲面內插(四邊往內插,試過後刪除) | 20 / 20 | 12 / 20 |
| 對照:原圖掃描區平移 1 px(沒有徽章) | 20 / 20 | **8 / 20** |

比對結果(褻瀆 = 分組與每組候選;符文 = 每列名稱比對 `matchRunesRowsWith`)是判準;逐字差異全是列尾的 `|` `!` `,` `~` 之類雜字,
原圖本身換個裁切(平移 1 px)就有 12 / 20 會出現,屬 WinRT 的雜訊範圍。
Electron 端到端(runtime 的 `toScanCapture` + `ScanMaskStore` + `prepareRect` 遮罩 + `nativeImage` 'best' 放大 + 真 WinOcr,offset = 裁切左上模擬遊戲部分在螢幕外;scratchpad 腳本,未進 repo):
褻瀆 12 個情境的詞綴行全部與乾淨圖相同(fullscreen-03 整張時只有背景雜訊行不同),遮罩後的差分縮圖 20 / 20 判為沒變化。

**競態**(徽章剛畫上、遮罩還沒到 main 的那一次擷取):兩道防線。
1. renderer 在 paint **之前**就送遮罩(`flush: 'post'` / `nextTick` 都在同一個 task 的 microtask 裡,畫面還沒合成),IPC 依序送達;正常情況遮罩一定比像素先到。
2. main 送出 `rows` 後記下 seq(`noteSent`),renderer 回報的 `seq` ≥ 它之前 `pending` 為真 → 掃描 tick 不擷取(`mask-wait`);回報一到 `drawSettled()` 立刻補一個 tick;
   最多等 `MASK_ACK_TIMEOUT_MS` 1 秒(renderer 沒在聽 / 卡住 / 重新載入時照常掃描,不會卡死)。只在 `rows` 之後等:清除(`empty` / 暫停)不會畫新東西,移除的部分由 300 ms 保留期涵蓋。
   兩個來源共用:褻瀆的 rows 還沒 ack 時,符文掃描也不擷取(徽章可能落在符文區域內)。
   選這個而不是「main 依送出的列推算徽章位置」:徽章大小取決於字型 / 字級 / 候選數 / 設定,main 推不準;也不用固定延遲:正常 ack 只要幾 ms,固定延遲要嘛太長拖慢、要嘛 renderer 忙時不夠。
- 假時鐘(`main/test/scan-mask.test.ts`,fullscreen-02 快照當畫面、假 OCR 把「畫面上沒被遮掉」的徽章文字併進最近一行):不遮 → 3 組 / 清除反覆出現(重現);
  遮罩 + ack → 20 秒內一直 3 組、沒有 empty、只 OCR 1 次(徽章出現不算變化);renderer → main IPC 400 ms、掃描間隔 100 ms 時,只遮不等會截到沒遮的徽章並掉組,加上 ack 等待後 0 次。

**renderer 端實測**(Electron 隱藏的離屏視窗載入 `renderer/dist` + 假 `window.host`,注入 fullscreen-02 / skills-01 快照事件;scratchpad 腳本,不顯示視窗、不送輸入):
褻瀆 4 個元素(3 徽章 + 「?」說明)、符文 12 枚徽章,ack 那份外框 = 字型載完後的 DOM 外框(逐值相同);字型已載入後,事件 → 帶 seq 的回報在同一個 task 的 microtask 內送出(paint 前);`empty` → 空陣列 + seq。

**涵蓋範圍**:overlay 視窗裡的褻瀆徽章層與符文徽章層(含「?」說明列、符文提示)。**不含**:查價面板本身(褻瀆在查價面板開著時照常掃描;面板若蓋到框的區域,上面的字仍會被 OCR —— 與第 18 步之前相同)、
右下角的啟動 / 辨識開關提示視窗(另一個視窗,約 3 秒,文字不像詞綴)。

log:擷取有遮到東西時,掃描結果那行多「遮掉自己的徽章 N 塊」(`[reveal-scan] #n manual 區域 … 總計 … ms、遮掉自己的徽章 3 塊;5 行 → 5 列`)。

## 管線(2026-09-30 單次辨識時的設計;擷取 / OCR / 比對 / 座標系沿用)

| 段 | 檔案 | 做什麼 |
|---|---|---|
| 熱鍵 | `main/src/Shortcuts.ts` | 動作 `ocr-reveal`(`hotkeyOcrReveal`);`trigger` 最前面分支,只呼叫 `onOcrReveal` |
| 擷取 | `main/src/ocr/capture.ts` + `overlay-shot.ts`(+ 第 18 步 `scan-mask.ts`:擷取後遮掉我們自己的徽章 / 提示再 OCR / 差分,見「遮掉自己畫的東西」) | **第 17 步起先用 overlay 原生 `OverlayController.screenshot()`**(只抓 attach 的遊戲 client,同步約 20 ms;throw / 尺寸不符 / 全黑才退回下面這條,見「擷取改用 overlay 原生 `screenshot()`」);後援:`desktopCapturer.getSources({ types: ['screen'], thumbnailSize: 該螢幕實體像素 })` → 用 `GameWindow.bounds`(client 區螢幕實體像素)減螢幕原點(`display.nativeOrigin`,沒有就 DIP × scaleFactor)裁出 client 區 |
| 前處理 | `capture.ts` `prepareRect()` / `rectRecognizer()` | 可選 `ocrRegion`(client 比例,`strategy.ts` `regionSearchRect` 以 client 尺寸換算再減擷取偏移)= 優先搜尋範圍 → 依下一列選的矩形裁切 → 放大(`×1` 或 `s = min(3, floor(9000 / max(w, h)))`:1080p / 1440p 3×、4K 2×;WinRT `MaxImageDimension` = 10000)→ `nativeImage.resize({ quality: 'best' })` → **JPEG q95**(`toPNG` 對 5760×3240 要 1.3–1.6 秒,JPEG 約 0.1 秒;逐字結果相同) |
| 選範圍 | `main/src/ocr/strategy.ts` `recognizeRegionFirst` / `smartRecognize` + `poe2/src/desecration/ocr-locate.ts` | 有框選區域 → 先只在區域內跑、找不到再整張(WP-S2,見「框選辨識區域」);每一輪都是**兩段式**:快取區 ×3 → 整張 ×1 定位 + 面板區 ×3 → 整張 ×3(見下節) |
| OCR | `main/src/ocr/win-ocr.ps1` + `WinOcr.ts` | 常駐 PowerShell 5.1 + WinRT `Windows.Media.Ocr`(`zh-Hant-TW`);`-EncodedCommand` 傳腳本(stdin 留給資料);協定見 ps1 檔頭(2026-10-01 第 7 步起影像寫暫存檔送路徑、runtime 不要 words,見「擷取與 OCR 傳輸」);單張逾時 8 秒 / 崩潰 → 下一次自動重啟;閒置 10 分鐘結束;缺語言包的結果記 30 秒 |
| 廣播 | `main/src/ocr/reveal.ts` | `ocr-reveal-result`:先 `{phase:'pending'}`,再 `{phase:'result', ok, lines(client 實體像素), client, scale, tookMs, ocrMs, stage, stages}` 或 `{ok:false, error}`;`stage` = `cached \| two-pass \| full`(有框選區域時 `region \| region-fallback`,`inner` = 採用那一輪的內層路徑)、`stages` = 各段範圍 / 倍率 / 耗時 / 命中數 / 未採用原因 / `scope`(`region` / `screen`)(診斷用;renderer 只讀 `stage === 'region-fallback'` 顯示提示);**不在** `PREVIEW_EVENTS`(預覽端收不到) |
| 比對 | `poe2/src/desecration/ocr-match.ts`(renderer 經 `@poe2-entry` 的 `matchRevealLines`) | 正規化 → skeleton → 精確 / 模糊命中 → 折行合併 → 分組 → entry 一一對應 → profile → Tier(見下) |
| 顯示 | `renderer/src/web/overlay/OcrBadges.vue` + `ocr-reveal.ts` | 每組右側一枚徽章(第 13 步起左緣對齊、上下不重疊);清除:再按一次熱鍵、Esc(overlay 有焦點時)、15 秒、overlay 視窗移動或改大小(2026-10-01 起按住 Alt 不再隱藏) |

## 座標系

- main 送的行座標 = **遊戲 client 區的實體像素**(OCR 座標 ÷ 放大倍率 + 範圍偏移 + 擷取偏移),另附 `client {w, h}`。
- overlay 視窗與 client 區對齊(CSS 原點 = client 左上),renderer 以 `innerWidth / client.w`、`innerHeight / client.h` 換算,與螢幕 DPI 無關。
- 徽章 `left` = **所有組**右緣的最大值 + 14 px(第 13 步起對齊同一個 x)、`top` = 徽章上緣(以組垂直中心置中,被上一枚推開時往下;見「徽章排版與「?」文案」)。

## 兩段式辨識(2026-09-30)

整個 client ×3 對真實全螢幕(2000×1125,面板 + 背包 + 小地圖)要 0.9–1.4 秒,面板只佔畫面一小塊。改成先便宜地找面板、再只放大面板:

| 路徑 | 做什麼 | 什麼時候 |
|---|---|---|
| `cached` | 上次成功的面板區直接 ×3 | 記憶體快取有這個鍵(client 大小 + 擷取偏移 + 搜尋範圍;程式重啟失效),且 `checkRegion` 通過 |
| `two-pass` | 第 1 段:搜尋範圍 ×1 → `locatePanel` 找「像詞綴」的行 → 外擴成裁切框;第 2 段:裁切框 ×3(倍率仍受 9000 上限約束) | 沒快取,或快取區沒通過(清掉快取) |
| `full` | 搜尋範圍 ×3(原本的做法) | 第 1 段一行都不像詞綴、第 2 段沒通過 `checkRegion`、或 main 讀不到 tiers.json;full 的結果定位得到面板時也寫快取 |

- **定位(`ocr-locate.ts`,main 經 esbuild 打包)**:與 renderer 同一套正規化 + skeleton(`ocr-text.ts`,兩邊共用),對 `tiers.json` 的模板 skeleton(`text.zh` 394 個 + `text.zhVariants` 其他寫法 = 706 個)做精確 / 模糊(Levenshtein ≥ 0.85、長度差 ≤ 2)命中;
  自己對不上、接下一行才對上的折行兩行都算命中。**只回答「像不像詞綴」**,不看數值範圍、不分 entry、不推 Tier(那些仍在 renderer)。
  命中行依 y 成簇(相鄰中心距 ≤ 6 × 行高、x 中心對齊),採用所有 ≥ 2 行的簇(畫面上另有詞綴簇,例如背包物品浮窗,一起框進來——寧可框大也不框錯,挑面板是 renderer 的事);沒有 ≥ 2 行的簇就用全部命中行。
- **外擴**:水平每邊 `max(0.75 × 框寬, 8 × 行高)`(= 至少 1.5 倍半寬;最長的詞綴行可能比認出的行寬很多)、垂直每邊 `max(3 × 行高, (14 × 行高 − 框高) / 2)`(只認出 1–2 行時仍蓋得住 3 組 × 最多 3 行),夾在搜尋範圍內。
- **`checkRegion`**(cached 與第 2 段的驗收):≥ 2 行像詞綴,且命中框離範圍每個邊 ≥ 1 個行高(該邊本來就是搜尋範圍邊界時不算)。貼邊 = 面板可能有一部分在框外 → 換下一條路。
- **資料**:main 讀 `data/poe2/desecration/tiers.json`(`locate-data.ts`:打包後在 app 根目錄 `data/…`,renderer build 複製進去;開發 / selftest 讀 repo 根的 `data/`),第一次按熱鍵才讀(1.4 MB,解析 + 建索引約 17 ms)。
  選這個而不是「CJK + 數字」啟發式:真的對上模板才不會被小地圖、金幣、堆疊數、背包物品名誤導;代價只是 main 多讀一次資料檔。讀不到 → 只走 full(記一次 log)。
- **倍率只用 ×1 與 ×3**:同一張全螢幕實測 ×1 整張 534 ms、4 行全對;×1.5 / ×2 反而錯字(「閃避」→「因」、「增」→日文「増」);×3 全對。第 1 段只需要「找得到」,×1 最快且在這個解析度逐字正確。
  ×1 在更小的字(低解析度 / UI 縮放)可能一行都認不出 → 自動退回 full,只是變回原本的速度。

## 框選辨識區域(WP-S2,2026-09-30)

使用者回報原本「四個 0–1 數字欄位」不直觀。改成**在遊戲畫面上直接拖曳框選**;辨識時**優先用區域、失敗再自動找整個畫面**
(**2026-10-01 第 13 步起改為只看區域、不退回整個畫面**,見「面板判定:否決規則」;下面「優先區域、失敗退回整張」一節保留作歷史紀錄)。

### 流程

| 步驟 | 檔案 | 做什麼 |
|---|---|---|
| 入口 | `settings/tabs/Hotkeys.vue`、`Shortcuts.ts` / `shortcut-actions.ts` | 設定 › 熱鍵與視窗 › 靈魂之井揭露 OCR 卡片:狀態(「未設定(自動找整個畫面)」/「已設定:左 19%、上 44%、寬 28%、高 25%」)+「在遊戲上框選」「清除」(2026-10-01 起手動比例欄位已移除,見「設定頁(與符文塑形對等)」)。選用熱鍵 `hotkeyOcrRegion`(預設空 = 不註冊;註冊條件同 OCR 熱鍵:overlay + PoE2 + 遊戲前景)→ main 送 `ocr-region-pick`。瀏覽器預覽 / window 模式沒有框選鈕,改顯示說明 |
| 開啟 | `overlay/OcrRegionPicker.vue`、`overlay/ocr-reveal.ts` | `regionPickerOpen = true` → 呼叫 `overlay-activate`(main `assertOverlayActive`,overlay 可點擊);`App.vue` 隱藏設定視窗 / 查價面板;`OcrBadges.vue` 清掉徽章 |
| 回到設定 | `App.vue`、`ocr-reveal.ts` `returnsToSettings` | 由設定視窗開的框選(`regionPickerSource = 'settings'`),確認 / 取消鈕 / 清除後**自動重開設定並停在熱鍵分頁**(不 `focus-game`,overlay 維持可點擊);**這條路徑確認後不自動試辨識**(置中的設定視窗會擋住揭露面板)。失焦 / 視窗隱藏結束的不回設定;熱鍵開的框選行為不變 |
| 畫面 | 同上 | 暗幕 `rgba(0,0,0,.55)`,選取框內挖空(選取框的超大 `box-shadow`);選取框 `--gold` 邊框 + 8 個方形把手 + 即時百分比;參考框:「目前區域」實線、「上次偵測」`--accent` 虛線;頂部說明條與按鈕(確認 / 套用上次偵測 / 清除區域 / 取消)是深色島(`.pob-dark`,淺色主題也維持深色,與徽章一致) |
| 操作 | `overlay/region-geom.ts`(純函式) | 空白處拖曳 = 新框(點一下 < 3 px 不改選取);框內拖曳 = 移動;把手 = 只動該邊;最小 40×40 CSS px;全部夾在視窗內;方向鍵移動 1 px、Shift 10 px,Ctrl + 方向鍵調右 / 下邊 |
| 確認 | `OcrRegionPicker.vue` | Enter 或「確認」→ `config.ocrRegion = normOcrRegion(toRegion(box))`(四位小數)→ 關層 → `focus-game` → **150 ms 後 `ocr-reveal-now`**(= 按一次 OCR 熱鍵;main 先確認是 PoE2 overlay 且有遊戲視窗)。面板還開著就能立刻看到徽章驗證(由設定開的框選例外,見「回到設定」) |
| 取消 | 同上 | Esc、「取消」、overlay 失焦(`focus-change` overlay=false)、視窗隱藏(`document.hidden`)→ 不存、關層。overlay 內按 Esc 會先被 main 的 `before-input-event` 攔下並把焦點還給遊戲 → 走「失焦」取消,結果相同 |
| 框選中 | `App.vue` | 忽略背景點擊關閉(overlay 已沒有按住 Alt 隱藏) |
| 清快取 | `main.ts` → `RevealOcr.regionChanged` → `RegionCacheGuard` | `host-config` 帶來的 `ocrRegion` 與上次不同 → 清 `RevealOcr.cache`(舊區域算出的面板區不再可信) |

「上次偵測」= renderer 最近一次比對成功的所有組矩形聯集(client 實體像素),外擴水平每邊 50% 框寬、垂直每邊 2 × 平均行高,換成 client 比例夾在 0–1(`detectedRegion`)。
「套用上次偵測」把它設成選取框(還要按確認才存)。

### 座標系

- 框選層在 overlay 視窗裡,CSS 原點 = 遊戲 client 左上;`ocrRegion` = CSS px ÷ `innerWidth / innerHeight`(client 比例,與 DPI 無關)。
- main `regionSearchRect(影像, ocrRegion, { client, offset })`:**比例 × client 尺寸 − 擷取偏移**,再夾進擷取影像。
  遊戲視窗部分跑出螢幕時,擷取影像只有螢幕內那塊(`offset` = 影像左上在 client 內的位置),舊版「比例 × 影像大小」會偏移;
  視窗完全在螢幕內時(client = 影像、offset 0)兩者結果相同(`main/test/ocr-strategy.test.ts` 抽 400 組對照)。區域整塊落在螢幕外 → 當成沒有區域。

### 優先區域、失敗退回整張(`recognizeRegionFirst`;**2026-10-01 第 13 步已移除**,以下為歷史紀錄)

1. 沒有區域 → 與原本相同(整張跑兩段式,`stage` = 內層路徑)。
2. 有區域 → 以區域為搜尋範圍跑兩段式(快取鍵含範圍,與整張的快取分開)。`cached` / `two-pass` 本來就過了 `checkRegion`;走到 `full` 時以區域本身為邊界再跑 `checkRegion`(貼邊不算,只剩「≥ 2 行像詞綴」)。
   找到 → `stage: 'region'`。
3. 區域內像詞綴的行 < 2 → 以整個畫面再跑一次兩段式 → `stage: 'region-fallback'`,`stages` 前半 `scope: 'region'`、後半 `scope: 'screen'`;
   renderer 在徽章上方提示「框選的區域內沒找到面板,已改找整個畫面」5 秒。
4. main 讀不到 tiers.json(沒有模板索引)→ 無從判斷,直接用區域的結果。

## 比對規則(`ocr-match.ts`)

1. **正規化**:刪所有空白(WinRT 在 CJK 字與字之間插空白:`+ 86 護 甲 值`)、全形 ASCII → 半形、數字旁的 `O/o` → `0`、`l/I/|` → `1`。
2. **skeleton**:數值(與 parser 同一支 `STAT_VALUE_RE`,`+`/`-` 一起吃掉)→ `#`。模板同樣處理,`[+-]?#` 視為一個動態槽
   (`擲彈技能有+#次冷卻使用次數`),寫死的數字(`每100點最大生命`)記成固定槽。395 個模板去掉空字串 = **394 個 skeleton,互不相撞**。
   **寫法變體(`text.zhVariants`,2026-09-30)**:同一 stat 在遊戲裡不只一種寫法(`增加#%精魂保留效用` 實際顯示 `技能增加10%精魂保留效用`,
   相似度 0.83 < 0.85 對不上)。產生器另輸出同 ref 的其他繁中 matcher(269 個模板、317 個寫法:效用 / 效率、`技能` 前綴、`施法` / `施放`、
   反向的 `減少` / `增加` 270 個、不含 `#` 的 18 個如 `無物理傷害`、`擊中時必定造成流血`),全部建進同一個 skeleton 索引(共 706 個 skeleton)。
   一個 skeleton 可能同時是 A 的 `text.zh` 與 B 的反向寫法(`增加#%攻擊速度`),refs 各自記槽位與 `negate`,到數值階段再分。
3. **命中**:skeleton 相等 → 精確;否則 Levenshtein 相似度 ≥ 0.85 且長度差 ≤ 2 → 模糊(只留最高分,徽章前加 `≈`)。
4. **數值**:OCR 數值個數 = 模板槽數時,動態槽逐一比對該 part 的 `ranges`(已取絕對值);個數不齊(OCR 漏字)只靠文字。
   ranges 是「以 part 的 `text.zh` 寫法顯示時的數字」,一律非負。**反向寫法(`negate`,相對 `text.zh`)**:畫面上的 X 在 `text.zh` 語意下是 −X,
   要 −X 落在 range 內才算 → 實務上反向寫法永遠對不上該 part(例:part `減少#%攻擊速度`〔direction decrease,15〕、畫面 `增加15%攻擊速度`
   → −15 ∉ [15, 15] → 不是它,改由一般池的 `增加#%攻擊速度` 接手);OCR 漏數字時只要有一個 `#` 的下限 > 0 也排除。
   反向寫法仍收進索引,是為了讓它在定位階段算「像詞綴」、比對階段不誤判到錯的極性。不含 `#` 的寫法(`無物理傷害` = 特殊值)只靠文字,不驗數值。
5. **折行**:一行自己對不上、接下一行後精確命中 → 合併(前半本身也是合法模板時,只在下一行完全對不上時合併:`增加23%護甲值` + `和閃避`)。
6. **分組**:y 中心距 > 1.9 × 中位行高就切組(樣本:組內 1.54×、組間 ≥ 2.31×),x 中心要對齊(面板文字置中)。
   每組內命中的行必須與某個 entry 的 parts 一一對應;對不上時切成最少的連續段(等距單行詞綴幾何切不開也能拆)。
7. **面板**:連續、x 對齊、相距 ≤ 6 × 行高的 2–3 組,取有 entry 對上最多的一段;不足 2 組 → `no-panel`。對不上的 CJK 行貼到最近的組,灰色顯示原文。
   **第 13 步**:每一段先過否決規則(`panel-veto.ts`,見「面板判定:否決規則」),被否決的段不用;全被否決 → `no-panel` 帶 `veto`;「確認」/「靈魂之井」只加分。
   **中間那個選項沒認出(`bridgeUnmatched`,2026-09-30)**:三組等距時(fullscreen-03 組距約 4.6 行高),中間沒命中會讓第 1、3 組相距約 8 行高 > 6 → 拆成兩個各 1 組的「面板」→ `no-panel`。
   現在把**夾在相鄰兩組之間**、x 中心與兩組都對齊(≤ 4 × 行高)、行高與命中行相近(比值 ≤ 1.3)、離兩組每一行中心距都 > 1.9 × 行高的未命中行
   自成一組 `partial`(顯示原文、沒有候選),面板以包含它後的組數判定(兩側間距仍要 ≤ 6 × 行高)。
   防誤併:只補「之間」(面板上方字大的標題、下方「確認」按鈕、旁邊的小地圖 / 背包字不會進來);一段超過 3 組時先拿掉這種組(3 個選項都認得出時,中間的未命中行只是雜字);
   每個面板至少要有 2 組是真的對上詞綴。
8. **profile**:最近 10 分鐘內查價的 PoE2 物品 `refName`(`App.vue` 解析成功時記下)→ `resolveProfiles`(base_profiles 精確,否則類別)。
   沒有 → 三組候選 entry 可擲出的 profile **取交集**(三個選項屬於同一件物品),交集空才用全部 profile;Tier 取聯集(`T3–T5`),徽章加「?」。

## 驗證

- `node scripts/ocr-fixture.mjs`:對 `poe2/test/desecration/fixtures/ocr/*.{webp,png}` 跑**同一支** `win-ocr.ps1`(經 Node 24 型別剝除直接 import `WinOcr.ts`)
  → `*.ocr.json` 快照(進 repo)。前處理用 sharp(lanczos3 + JPEG q95)模擬 runtime。需要 Windows + `zh-Hant-TW` 語言包。
  Node 會警告 `MODULE_TYPELESS_PACKAGE_JSON`(main 不是 ESM package),無害。
- `electron main/dist/main.js --ocr-selftest <png> [--ocr-selftest-region=x,y,w,h]`:不開視窗、不拿單一實例鎖,走 runtime 的 `smartRecognize` + `WinOcr`,
  依序跑 ① 快取空(two-pass)② 同一張(cached)③ 強制整張 ×3 對照 ④ 清快取再跑(熱的 two-pass),印每段範圍 / 倍率 / 耗時 / 命中數與採用那段的行(client 座標)
  (先 `npm run build --workspace main`、清 `ELECTRON_RUN_AS_NODE`;nativeImage 不吃 webp,先用 sharp 轉 png)。擷取不在這裡測。
- `poe2/test/desecration/ocr-locate.test.ts`:定位(fullscreen-02 快照 ÷ 3 當 ×1 輸入):裁切框包住 4 行詞綴、不含背包(x > 1300)、外擴下限;框內的行跑 `matchReveal` 與整張結果相同;`checkRegion` ok / 貼邊 / 太少;只認出 1 行仍蓋得住面板。
- `main/test/ocr-strategy.test.ts`:假 recognize 驗三條路的切換(two-pass → cached、面板移位 → 清快取改 two-pass、×1 認不出 → full 並寫快取、第 2 段貼邊 → full、沒有模板索引 → full)、倍率、快取鍵、`locate-data` 從 `main/dist` 找得到 tiers.json。
- `poe2/test/desecration/ocr-match.test.ts`:① 真實截圖快照三組全中(Rogue Armour → 三組全 T4);①b fullscreen-02;
  ①c fullscreen-03(`減少49%你身上的中毒持續時間` → ReducedPoisonDuration3 一般池 46–50 T3 /
  `技能增加10%精魂保留效用`(變體)→ AbyssModBodyArmourAmanamuSuffixSpiritReservationEfficiency 阿姆那姆 6–12 T1 /
  `+11點力量與敏捷` → AbyssModArmourJewelleryUlamanSuffixStrengthAndDexterity 烏拉曼 9–15 T1;profile 交集、無「精確底材」;
  另以去掉 zhVariants 的資料驗證中間那行自成 partial 組、仍是 3 組);
  ② 394 個模板 round-trip + 317 個寫法變體 round-trip(反向寫法驗數值語意)+ `減少#%攻擊速度` vs `增加15%攻擊速度`;③ 模糊 200 次 + 200 對不誤命中;
  ④ 分組邊界、2 組、1 組 no-panel、折行、等距單行、未辨識行、中間選項沒認出(partial 組)、x 不對齊 / 行高不同 / 標題 / 確認鈕不被併入、3 組都認得出時雜字不擠掉選項。
- `poe2/test/desecration/ocr-locate.test.ts` 另有:變體寫法算「像詞綴」(沒有變體的索引 394 個 skeleton 認不出 `技能增加…`)、fullscreen-03 三行全命中。
- `renderer/test/ocr-reveal.test.ts`:徽章座標換算、文字、profile 有效期;第 13 步:左緣對齊、相鄰徽章間距 ≥ 2 px(估計高度 / 量到的高度都不重疊)、超出下緣整體上移、多候選收合「+N」/ 全列、「?」文案分支(`guessNoteKey`)。
- `poe2/test/desecration/panel-veto.test.ts`(第 13 步):正樣本量測與不觸發、`vetoLineReason`、固定元素加分、真實負樣本三層(main 定位 ×3 / ×1、renderer)、合成負樣本 A / B / B' / C / C'、不誤殺(認錯的數值行、確認 / 標題 / 遠處聊天)。
- WP-S2:`renderer/test/region-geom.test.ts`(新框、最小尺寸、移動、8 把手、夾限、方向鍵 / Shift / Ctrl、比例換算、上次偵測外擴)、
  `main/test/ocr-strategy.test.ts`(`regionSearchRect` 400 組對照舊版 / 出界偏移、`recognizeRegionFirst` 區域找到 / 退回整張 / 只框到 1 行 / 沒區域 / 沒索引、`RegionCacheGuard`)、
  `main/test/shortcut-actions.test.ts`(`ocr-region` 註冊條件:預設空不註冊、PoE1 / window 不註冊、撞鍵先到先得)。
  無頭 Chrome + 假 host 用 CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent`(只作用於無頭頁面,不是作業系統層輸入)拖曳、調把手、方向鍵、Enter / Esc,驗證寫入值與呼叫序列(見 `docs/phase5-summary.md` S6)。
- 無頭 Chrome + 假 `window.host`:注入快照事件,徽章位置 = 各組右緣 + 14 px / 垂直中心(誤差 0 px)、再按清除、Esc、錯誤提示(Alt 隱藏已於 2026-10-01 移除)。
- 第 18 步(遮掉自己畫的東西):`node scripts/ocr-mask-check.mjs [--fill feather,ring-median,dark] [--dpr 1,1.5] [--control] [--keep <資料夾>]`(需 Windows + 語言包;不開視窗、不送輸入)——
  正樣本畫上徽章 → 不遮(必須重現掉組,否則結束碼 1)/ 遮罩後(比對結果必須與原圖相同)走真 WinOcr;`main/test/scan-mask.test.ts`(純函式 + 假時鐘循環 / 競態)、`renderer/test/scan-mask.test.ts`(回報與 ack)。

### 本機實測(2026-09-29,`--ocr-selftest`)

| 輸入 | 放大 | 前處理 | OCR 冷 / 熱 | 結果 |
|---|---|---|---|---|
| 樣本截圖 987×1005 | 3× | 88 ms | 618 / 501 ms | 7 行詞綴全對 |
| 樣本貼在 1920×1080 假 client | 3× | 143 ms | 610 / 558 ms | 7 行全對 |
| 樣本貼在 2560×1440 假 client | 3× | 219 ms | 849 / 576 ms | 7 行全對 |

PowerShell 行程第一次啟動約 0.3–1.8 秒(之後常駐)。

### 兩段式實測(2026-09-30,`--ocr-selftest`,真實全螢幕 `well-of-souls-fullscreen-02` 2000×1125)

| 做法 | 範圍 | 耗時(含前處理 / 傳輸) | 結果 |
|---|---|---|---|
| 整張 ×1(使用者先前實測) | 2000×1125 | 534 ms | 4 行全對 |
| 整張 ×1.5 / ×2(使用者先前實測) | 2000×1125 | — | 錯字(「閃避」→「因」、「增」→「増」)→ 不用 |
| **full** 整張 ×3(舊做法) | 2000×1125 | 1080 ms(OCR 838);使用者先前實測 904–1412 ms | 4 行全對 + 11 行雜訊 |
| **two-pass**(行程剛啟動) | ×1 整張 → ×3 (405,489 499×302) | 515 ms = 425 + 89 | 4 行全對,框內沒有雜訊 |
| **two-pass**(熱) | 同上 | 383 ms = 272 + 111 | 同上 |
| **cached** | ×3 (405,489 499×302) | 113 ms(OCR 96) | 同上 |

四條路的 4 行詞綴逐字相同;renderer 比對結果:`增加71%護甲值和閃避`(LocalIncreasedArmourAndEvasion5,無 profile T3–T4)|
`+60護甲值` + `+59閃避值`(LocalBaseArmourAndEvasionRating3,T2–T6)| `+16最大生命`(IncreasedLife1,T9–T13)。

## 限制

- **全螢幕(獨占)模式**:overlay `screenshot()`(BitBlt)與 `desktopCapturer` 都可能拿到黑畫面(前者全黑會自動退回後者,第 17 步)→ 請用無邊框視窗;若普遍,備案是原生 `PrintWindow`(未做)。
- **只驗過三張截圖**(繁中客戶端;面板裁切圖 987×1005 胸甲、全螢幕 2000×1125 與 2000×1121;都無折行);
  寫法變體只收 stats.ndjson 有的 matcher,遊戲若還有別的寫法仍會對不上(面板不會因此拆開,該組顯示原文);兩段式的快取鍵只含 client 大小與範圍,遊戲 UI 縮放改了但 client 大小不變時,第一次按會走 cached → 不通過 → two-pass(多花一次快取區 OCR 約 0.1 秒);其他解析度 / UI 縮放 / 字型、真的折行、`減少…`、`附加#至#` 模板都只有合成測試。
- 假 client 測試的字高與樣本相同;真實 1080p 的字可能更小,3× 放大後是否仍逐字正確待使用者親測。
- 語言包:設定 → 時間與語言 → 語言與地區 → 中文(台灣)→ 語言選項 → 光學字元辨識。缺少時提示並在設定 › 熱鍵與視窗顯示狀態。
- 英文客戶端不支援(OCR 固定 `zh-Hant-TW`、比對用繁中模板)。
- profile 不明時只能給範圍(標「?」);查價過同一件物品(10 分鐘內)才是精確底材。
- Esc 只在 overlay 有焦點時收得到(遊戲在前景時 Esc 屬於遊戲);其餘靠再按熱鍵 / 15 秒。
- 框選(WP-S2)只在 overlay 模式;window 模式與瀏覽器預覽不能框選(2026-10-01 起設定頁沒有數字欄位,只能沿用既有 `ocrRegion` 或清除)。區域以 client 比例存,遊戲換解析度 / UI 縮放後面板位置可能不同 → 區域內找不到時設定頁顯示「區域內沒找到面板」(第 13 步起不再退回整張),重新框選或清除區域即可。
- 否決規則只在三張正樣本 + 一張真實浮窗截圖上量過;殘留風險見「面板判定:否決規則」。
- 框選熱鍵與 OCR 熱鍵一樣只在遊戲前景時註冊;overlay 取得焦點後熱鍵暫停(要用設定頁按鈕或先回遊戲)。

## 隱私

OCR 使用 Windows 內建辨識,在本機執行;截圖只在記憶體裡傳給本機 PowerShell 行程,不存檔、不上傳。

## 待使用者親測

- **第 18 步遮掉自己的徽章**:開井(手動框區域與自動定位各一次)→ 三枚徽章出現後**不再 3 組 → 2 組 → 消失地循環**,會一直留著直到關面板;
  log 的掃描行有「遮掉自己的徽章 N 塊」、徽章出現後不再每秒 OCR(畫面沒變);同時開符文塑形時符文徽章也不閃;用自己的截圖 / 錄影工具仍拍得到徽章。
- **第 11 步徽章外觀**:設定 › 熱鍵與視窗 › 「徽章外觀」字體下拉列出系統字體(含中文名)、可篩選;改字體 / 大小 / 粗體 / 外框 / 三段色後遊戲上的符文與褻瀆徽章立即改變、
  預設設定下外觀與改版前相同;大字級(例 28 px)時褻瀆徽章不重疊、符文徽章相鄰列是否重疊;外框 / 陰影在遊戲亮處(雪地、亮色面板)是否清楚。
0. **2026-10-01 自動持續辨識**:PoE2 開井 → 不按任何鍵,約 1–3 秒內出現三枚徽章;關掉面板徽章消失;開著查價面板時仍會出現;
   `Ctrl + Shift + R` 暫停(徽章消失)/ 繼續;與符文塑形同時開著時兩邊都會更新;平常遊玩時的 CPU(沒面板時整張 ×1 定位連續沒找到會退避到最多每 15 秒一次、兩個掃描共用;
   框了區域但沒面板時小變化最多每 2.5 秒 OCR 一次);**第 6 步待確認**:暗色背景 / 大框區域時面板出現仍立即出徽章(大幅變化門檻)、退回中能自動定位到區域外的面板;
   背包物品浮窗不會誤出徽章;~~框了區域但面板不在區域內時,設定頁顯示「改找整個畫面」且仍出徽章~~(第 13 步起:框了區域只看區域,面板不在區域內 → 不出徽章、設定頁顯示「區域內沒找到面板」)。
   **第 13 步待確認**:框了區域、面板沒開、游標指著背包物品(進階說明開 / 關)→ 不出徽章;沒框區域時同樣情況也不出徽章;真的開井 → 三枚徽章左緣對齊、不重疊;
   一個選項多候選時只列一個 + 「+N」,設定開「全部列出」後全列;沒查價時「?」的說明文字與實際來源相符。
1. PoE2 開井 → 三枚徽章位置與內容;視窗化 / 無邊框 / 全螢幕三種模式各一次。
2. 先查價那件物品(10 分鐘內)再按,徽章沒有「?」。
3. PoE1 下熱鍵無反應;再按一次熱鍵清除;移動遊戲視窗清除。
4. WP-S2:設定 › 熱鍵與視窗 ›「在遊戲上框選」→ 設定視窗隱藏、框選層出現且可拖曳(overlay 真的取得焦點)→ 框住揭露面板按「確認」→ 設定視窗回來停在熱鍵分頁、顯示「已設定」;
   用框選熱鍵(`hotkeyOcrRegion`)開的框選按 Enter → 焦點回遊戲、約 0.15 秒後自動出徽章;關掉設定後按 `Ctrl + Shift + R` 走區域路徑(log `region:` + `[region]cached`,應約 0.1 秒)。Esc / 點回遊戲取消且設定不變。
5. WP-S2:~~把區域框在面板以外的地方 → 仍出徽章並提示「已改找整個畫面」~~(第 13 步起不出徽章,設定頁顯示「區域內沒找到面板」);視窗化且遊戲視窗部分拖出螢幕時,區域仍對得上。
