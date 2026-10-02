# PoE2 褻瀆詞綴 Tier(WP-R,階段 1:資料表 + 剪貼簿顯示)

進階複製(Ctrl+Alt+C)的褻瀆詞綴,遊戲會在 `{ 已褻瀆 後綴 "烏拉曼之"(階層：1) — … }` 標頭給 Tier,parser 原本就讀得到。
一般複製(Ctrl+C)只剩 `+16%閃電和混沌抗性 (desecrated)`,沒有 Tier 與範圍 —— 這裡用 PoB2 的詞綴資料**推定** Tier,
UI 一律標「推定」。階段 2(三選一揭露面板 OCR)沿用同一份資料表與比對引擎,見文末前置清單。

## 資料

| 檔案 | 內容 |
|---|---|
| `data/poe2/desecration/tiers.json` | schema 2(2026-10-02 第 22 步;1 → 2 只多了 parts 的 `text.enVariants`,其餘欄位與 schema 1 逐位元組相同、舊讀取端照讀):`source`(版本鎖)、`profiles`(底材類別 + tags)、`entries`(每條詞綴的 pool / type / group / 需求等級 / 各 profile 的 Tier / parts)、`diagnostics` |
| `data/poe2/desecration/base_profiles.json` | 英文 refName → profile id(ITEM 底材名;UNIQUE 只收所有底材同一 profile 者) |

MANIFEST 前綴 `data/poe2/desecration`,`commit` 欄 = PoB2 `manifest.xml` 裡 `Data/ModVeiled.lua` 的 sha1。

### 來源與版本鎖

- **PoB2 portable**(`pob-zh-engine/dist/PathOfBuildingCommunity-PoE2-Portable/`,非 git):`Data/{ModItem,ModJewel,ModVeiled}.lua`、`Data/Bases/*.lua`。
  版本號取 `manifest.xml` 的 `<Version number>`(目前 0.23.1),`source.files` 記每個輸入檔在 manifest 的 sha1。
  產生器會驗證磁碟上的檔與 manifest 相符(照 PoB `UpdateCheck.lua`:`sha1(content)` 或 `sha1(LF→CRLF)` 任一相符;
  manifest 記的是 CRLF 版,portable 磁碟上是 LF),不符就拒絕產生(`--allow-mismatch` 只給本機實驗)。
- **stats.ndjson**(`data/poe2/{en,cmn-Hant}/`,來自 ee2-patched):tradeHash → `trade.ids`(desecrated 優先,其次 explicit)
  → 英文 `ref`(模板)與 cmn-Hant 同 `ref` 的 `matchers[0].string`(繁中模板;其餘 matcher 進 `text.zhVariants`,見產生規則 8)。`source.statsCommit` = MANIFEST `data/poe2` 的 commit,
  `source.statsSha256` 記三個輸入 ndjson 的雜湊。
- 輸出不含時間戳,同一輸入重跑逐位元組相同。

### 產生規則(逐段移植 poenavi `scripts/build_poetore_poe2_desecration_tiers.py`,MIT)

1. lua 逐行 regex:`["id"] = { type, affix, group, level, weightKey/weightVal, modTags, tradeHashes }`。
2. Bases → profiles:類別(type 轉小寫底線)+ 排序去重的 tags;排除 charm / flask / traptool / fishing_rod / 肢體;
   `Staff` 帶 `warstaff` tag → `quarterstaff`。profile id = 依 (類別, tags) 排序的序號 `p000…`(**PoB 版本一變序號就漂**,別存到別處)。
3. spawn weight:`weightKey` 中**第一個**出現在 profile tags 的鍵的值(遊戲語意)。
4. pool:`normal`(ModItem/ModJewel 且正權重 tag 含基底 tag)、`desecration_exclusive`(ModVeiled 且帶 ulaman/amanamu/kurgal tag,
   另記 `gods`)、`desecration_exclusive_jewel`(ModVeiled 的 `AbyssModJewel*`,只套珠寶 profile)。
   `MISSING_PROFILE_OVERRIDES`:PoB 權重表漏了基底 tag 的兩條手動補(同 poenavi)。
5. 合併重複(pool, type, group, level, tradeHashes 全同)→ `mod_id` 以 `;` 連接。
6. **Tier = 同 (pool, type, group, profile) 內依需求等級降序編號**(1 = 最高)。
7. parts:每個 tradeHash 一個 part;`ranges` 由模板的 `#` 對 PoB 文字 fullmatch 取 `(lo-hi)` 或單值。
   模板 increased/reduced 與 PoB 文字相反時翻轉一次、ranges 取絕對值、記 `direction`。
   **本專案追加**(poenavi 沒有):`ref` 對不上時改試同一 stat 的其他英文 matcher(單複數 / 措辭變體,記 `matched_template`);
   模板跨兩行而 PoB 拆成兩段文字時接回一段。
8. **`text.zhVariants`(本專案追加,2026-09-30,揭露面板 OCR 用)**:cmn-Hant stats.ndjson 同一 `ref` 的**其他** matcher
   (去重、不含等於 `text.zh` 的那個與空字串;沒有就不輸出這個鍵,舊資料相容)。每筆 `{ text, negate?: true }`:
   `negate` 是**相對 `text.zh`** 的極性(stats.ndjson 的 `negate` 相對英文 `ref`;`text.zh` 本身相對 ref 的極性 = `matchers[0].negate` XOR 第 7 步的
   increased/reduced 翻轉,兩者再 XOR)。例:`減少#%攻擊速度`(direction decrease)的變體是 `{ text: "增加#%攻擊速度", negate: true }`。
   不含 `#` 的寫法(`無物理傷害`、`擊中時必定造成流血`)也收。數值語意與用法見 [reveal-ocr.md](reveal-ocr.md)「比對規則」。
   加這個欄位時驗證過:去掉 `zhVariants` 後的 tiers.json 與加之前**逐位元組相同**(entries / profiles / ranges / diagnostics 全不變)。
9. **`text.enVariants`(本專案追加,2026-10-02 第 22 步,schema 2,英文客戶端的揭露面板 OCR 用)**:同一 stat 列(en stats.ndjson,經 trade hash 找到的那一列 = 語言無關鍵)
   的**其他**英文 matcher(去重、不含等於 `text.en` 的那個與空字串;沒有就不輸出這個鍵)。每筆 `{ text, negate?: true }`,`negate` 是**相對 `text.en`** 的極性:
   `text.en` = `ref`(極性 = ref 本身)或 increased / reduced 翻轉後的寫法(第 7 步),所以 `negate` = matcher 的 `negate` XOR 有沒有翻轉。
   例:`#% reduced Attack Speed`(翻轉過)的變體是 `{ text: "#% increased Attack Speed", negate: true }`;`#% increased Physical Damage` 的變體是
   `#% reduced Physical Damage`(negate)與 `No Physical Damage`。與第 8 步共用同一個函式(`textVariants`)。
   加這個欄位時驗證過:去掉 `enVariants`、schema 改回 1 後與加之前的 tiers.json **逐位元組相同**(base_profiles.json 不變);MANIFEST `data/poe2/desecration` 依規則重寫。

### 目前統計(PoB2 0.23.1)

- profiles 422;entries 1,713(normal 1,483 / desecration_exclusive 198〔amanamu 70、kurgal 63、ulaman 65〕/ desecration_exclusive_jewel 32)
- 全部 1,713 條可比對(unparsed 0);極性翻轉 23 條;base_profiles 1,673(含 unique 168);未對上的裝備 refName 8 個(6 個 Runeforged 長棍/弓、2 個 Runemastered 長棍)
- `zhVariants`:395 個繁中模板中 269 個有其他寫法,共 317 個(相對 `text.zh` 反向 270、不含 `#` 18);1,054 個 part 帶這個欄位。
  OCR 索引 skeleton 394(只有 `text.zh`)→ 706(加上變體)
- `enVariants`(schema 2):271 個英文模板有其他寫法,共 277 個(相對 `text.en` 反向 248、不含 `#` 12);1,058 個 part 帶這個欄位。英文 OCR 索引 670 個寫法 → 669 個 skeleton
- 與 poenavi 產物(PoB2 revision `ce566eac…`,1,713 條 / 426 profiles)對照:mod_id 集合相同、三 pool 數量相同;
  1,698 條 pool/type/group/level/共有 profile 的 Tier/ranges 完全一致;15 條差在 poenavi 解析不到範圍(ranges null)而這裡解得出來
  (模板來源不同:poenavi 用 GGG trade2 文字,如 `Recover #% of maximum Mana on Kill (Jewel)` 多了尾綴)。
  profiles 426 vs 422:poenavi 那版的法杖/長杖/權杖底材帶 `*_implicit_skill` tag,0.23.1 沒有。
  抽樣 35 條的逐欄比對在 `poe2/test/desecration/build.test.ts`(fixture `fixtures/poenavi-sample.json`)。

## 推定(`poe2/src/desecration/infer.ts`)

掛點:`Parser.ts` 解析末段 `{ virtual: inferDesecratedTiers }`。資料由 `assets/data/index.ts` 的 `init()` 經 DataSource 載入一次
(`DESECRATION_TIERS` / `BASE_PROFILES`),`loadForLang` 不重載(語言無關);缺檔只 `console.error`、不擋啟動。

1. 只處理 `info.type === Desecrated && info.tier == null`(進階複製的 Tier 以遊戲為準,不動)。
2. 候選 entry:parts 的 stat hash 與詞綴各 stat 的 trade id hash(`*.stat_<hash>`,不分類型)一一對應。
3. profile = `base_profiles[item.info.refName]`;查不到 → 同類別所有 profile(`ItemCategory` 轉 PoB 類別;Warstaff→quarterstaff、
   Abyss Jewel→jewel、Buckler→shield),tooltip 註記「依物品類別推定」。
4. 每個候選 × profile:該 profile 有 Tier,且每個 stat 的 roll 落在 part 範圍內(多個 `#` 的 stat 比平均值,
   與 parser `getRollOrMinmaxAvg` 同語意;極性翻轉或 `trade.inverted` 的比絕對值)。範圍外 → 不推定(不硬給)。
5. Tier 唯一 → `info.tier = T`、`info.tierInferred = true`、`info.pool`(唯一時)、`info.ranges`(候選範圍一致時);
   多個 → `info.tierCandidates = [2, 3]`(`info.tier` 維持空,UI 顯示 `等級 2/等級 3`),`info.inferredCandidates` 留全部候選給 tooltip。
6. **混合詞綴**:一般複製把 hybrid 拆成每行一個 mod。先把同物品的單行褻瀆詞綴三三 / 兩兩組合去對多 part entry,
   對得上就當混合詞綴(兩行同 Tier);剩下的逐行推定。

### 顯示

- `FilterModifierTiers.vue`:推定 Tier 加虛線框與「推定」小字,**不受 `alwaysShowTier` 限制**(一般複製唯一的 Tier 來源);
  `title` tooltip:說明 + 每個候選一行「等級 N · 詞綴池 · 範圍」(詞綴池:一般 / 烏拉曼 / 阿姆那姆 / 柯戈 / 深淵珠寶專屬)。
- `SourceInfo.vue`(「修改詞綴」開關展開的詞綴來源):`已褻瀆 (等級 1 推定 · 烏拉曼 · 13–17)`,tooltip 同上。
- `create-stat-filters.ts`(精確查詢的預設勾選):推定 Tier 視同遊戲 Tier;多個候選取最差者,全部 ≤ T2 才勾。
- i18n:`renderer/src/i18n/{cmn-Hant,en}.json` 的 `ppz.desecration.*`。
- 共用字串邏輯:`poe2/src/desecration/display.ts`。

### 一般複製的詞綴區解析(Parser.ts `parsePlainModifiers`)

上游 EE2 parser 只認進階格式:一般格式的固有 / 外加詞綴區**整段被略過**(連 unknownModifiers 都沒有 —— 實測一般複製的稀有鞋子
只剩符文一行)。為了讓推定有東西可推,加了 `parsePlainModifiers`(沿用上游既有但沒掛上的 `parseModifiersPoe2`,逐行一個 mod),防護:
段落不得有 `{…}` 標頭,且**每一行都必須能單獨翻成 stat**(或是未揭露的 Veiled 行),否則整段略過。

## 熱鍵:PoE2 送 Ctrl+Alt+C

EE2(`main/src/shortcuts/Shortcuts.ts` 的 `pressKeysToCopyItemText`)送的是 `mergeTwoHotkeys("Ctrl + C", showModsKey)`,
`showModsKey` 讀 `poe2_production_Config.ini` 的 `show_advanced_item_descriptions`,預設 `Alt`(`host-files/GameConfig.ts`)——
**PoE2 的 Ctrl+C 只給一般格式,進階格式要 Ctrl+Alt+C**。本專案原本固定 Ctrl+C(PoE1 3.29 規則),PoE2 因此只拿到一般格式,
連一般詞綴都解析不到(見上節)。

現況:`main/src/Shortcuts.ts` 的 `copyItemHotkey(game)`:PoE1 `Ctrl + C`、PoE2 `Ctrl + Alt + C`;`updateActions` 與每次觸發都在 log 印出
`[shortcuts] 複製鍵(poe2):Ctrl + Alt + C` / `[shortcuts] 送出複製鍵 …`。

**待使用者親測**(自動驗證不得合成鍵盤輸入):
1. PoE2 遊戲中按查價熱鍵 → log 出現 `送出複製鍵 Ctrl + Alt + C(poe2)`,查價面板的稀有物品詞綴齊全、褻瀆詞綴 Tier 沒有「推定」字樣(遊戲給的)。
2. 按住 Alt 在 PoE2 會切換地上物品標籤顯示 —— 確認查價時不會留下 Alt 卡住(EE2 同一做法)。
3. 改過「顯示進階詞綴」鍵(不是 Alt)的玩家:目前仍送 Alt,會拿到一般格式 → 走推定。要支援就照 EE2 讀 ini(未做)。

## 限制

- **pool 歧義**:同一 hash 同時在一般池與三神專屬池時,靠數值範圍分;範圍重疊就列多個候選(`等級 1/等級 2`)。
- **混合詞綴**:一般複製拆行後靠組合比對;兩條獨立褻瀆詞綴恰好湊成某混合詞綴(hash 與範圍都吻合)時會被當成混合。
- **跨行 stat**:一般格式下跨兩行的 stat 不會被 `parsePlainModifiers` 接受(整段略過)。
- **底材對不上**:base_profiles 沒有的 refName 以類別推;類別內 profile 的 Tier 不一致時給候選。
- **PoB2 版本**:0.23.1(2026-07-28)可能落後遊戲;PoB2 更新後重跑產生器。profile id 會漂,資料以外的地方不要存 id。
- **Tier 編號**:照 poenavi「同 pool/type/group/profile 內需求等級降序」;與遊戲在進階複製顯示的階層以三件真實物品驗證一致
  (`poe2/test/desecration/infer.test.ts`),未逐條對全表。

## 更新方式

```bash
# PobTools 更新 PoB2 portable 後,或 data/poe2/{en,cmn-Hant}/stats.ndjson 同步後(sync-data --game poe2)都要重跑:
node scripts/build-desecration-tiers.mjs --from ../pob-zh-engine/dist/PathOfBuildingCommunity-PoE2-Portable/Data
# → 重寫 data/poe2/desecration/{tiers,base_profiles}.json 與 MANIFEST 的 data/poe2/desecration 前綴
cd poe2 && npx vitest run test/desecration   # 統計斷言(1713 / 198 / 32 / 1483 / 422;enVariants 271 / 277 / 248 / 1058)會紅 → 逐項確認後更新
```

## 階段 2(OCR 三選一揭露面板)——已實作(WP-S)

見 [reveal-ocr.md](reveal-ocr.md)。與原前置清單的差異:
- 比對不經 stat hash / `matchStats()`:OCR 行直接對繁中模板的 skeleton(`poe2/src/desecration/ocr-match.ts`),再以 entry 的 parts 一一對應 + 數值落在 ranges 內;
  寫死數字的模板(`diagnostics.mixed_fixed_dynamic_parts`)以固定槽處理;`擲彈技能有+#次…` 這種自帶正負號的模板 `+#` 視為一個槽。
- 底材:揭露面板上沒有物品名 → 改用「最近 10 分鐘查價的 PoE2 物品」`refName`;沒有就取三組共同可擲出的 profile 交集,Tier 顯示範圍並加「?」。
- 目前有三張使用者截圖(`poe2/test/desecration/fixtures/ocr/well-of-souls-body-armour-01.webp`、`well-of-souls-fullscreen-02.webp`、`well-of-souls-fullscreen-03.webp`;
  03 帶出「只收一種寫法」與「中間行沒對上就拆散面板」兩個缺陷,已修);更多截圖(武器 / 珠寶、折行、其他解析度)請放同目錄再跑 `node scripts/ocr-fixture.mjs`。
- 遊戲顯示的寫法不一定是 `text.zh`(`技能增加#%精魂保留效用`),比對同時用 `text.zhVariants`(產生規則 8)。

## 相關文件

- [browser-preview.md](browser-preview.md):同為 Phase 4(WP-P)。預覽頁不跟著查價(不收 `item-text`),要看 Tier 推定請用 overlay 或視窗模式的貼上框。
- [phase4-summary.md](phase4-summary.md):Phase 4 各工作包摘要、限制、待親測。
- 專案守則:[../CLAUDE.md](../CLAUDE.md)(必守規則 19、20)
