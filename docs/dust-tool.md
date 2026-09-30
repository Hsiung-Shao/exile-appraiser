# 拆粉(Thaumaturgic Dust)工具

兩層:
- **單件**(WP-A):查價面板的 `DustValue.vue` 顯示這件的粉塵量,有 poe.ninja 價時加「每 chaos ≈ N 粉塵」。
- **排行**(WP-B,本文件):**設定視窗的「拆粉排行」分頁**(2026-09-30 起;左選單 一般/查價/熱鍵與視窗/正則/**拆粉排行**/關於),
  內容顯示在設定視窗右側內容區;查價標題列齒輪旁的「⚖」= 開設定並直接切到這一頁。列出所有有拆粉基數的 PoE1 傳奇,依效率排序。
  (WP-Q 曾把排行停靠在查價面板下方、用分隔條調高度,設定 `dustDockRatio`;已移除,舊設定檔帶這個鍵照常載入、下次存檔不再寫出。)
  單件拆粉仍在查價面板,不受影響。

## 公式

`core/src/dust/formula.ts` 的 `dustAt(disenchantValue, { ilvl = 84, quality = 0, influences = 0, corruptedMods = 0 })`,
逐字移植自 APT `calcDisenchantDust`(本 repo `poe1/src/parser/Parser.ts:1720-1749`,單件查價用的同一個公式):

```
dust    = floor(disenchantValue × 5 × base(ilvl) × (100 + 50×勢力數 + 2×品質 + 50×腐化詞綴數) / 100)
base(i) = 50 + 2×(clamp(i,46,68)−46) + floor(3×(clamp(i,46,68)−46)/11) + 25×(clamp(i,68,84)−68)
```

`base`:ilvl 46 以下 50、68 = 100、84 以上 500 ⇒ ilvl 84 品質 0 = `disenchantValue × 2500`,品質 20 = `× 3500`。
金標:parser 回歸網 `boots-unique-vestigial-02`(Sin Trek,6.07,ilvl 85)= 15175(`core/test/dust.test.ts`)。

## 資料來源

| 資料 | 位置 | 用途 |
|---|---|---|
| APT `unique.disenchantValue`(1,219 件) | `data/poe1/en/items.ndjson`(繁中名以 `refName` 對接 `data/poe1/cmn-Hant/items.ndjson`) | **拆粉基數的主要來源** |
| poe-disenchant-tool(deronek,MIT)`data/dust/poe-dust.js`,數值最初由 @alserom 的 gist 整理 | `data/dust/poe-dust.json`(1,103 筆) | `goldCost`(拆解手續費)、`slots`(背包格數)、交叉比對 |
| poe.ninja(WP-A 快照) | `usePoeninja().snapshot` | 價格 `unique|name|baseType`(不取 `|6L`)、催化劑價 `currency|<名> Catalyst` |

同步:`node scripts/sync-dust-data.mjs --from <poe-disenchant-tool clone>` —— 逐筆轉 JSON(欄位與數值原樣,依 name + baseType 排序)、
複製 LICENSE 到 `LICENSES/` 與 `renderer/public/licenses/`、重寫 MANIFEST `data/dust`(記來源 commit)。來源 clone 有未提交變更會拒絕。

## 交叉比對結論(`node scripts/dust-crosscheck.mjs` → `docs/dust-crosscheck.md`)

以英文名 + 基底對接(**不按位置**),比 `dustAt(dv, ilvl 84, q0 / q20)` 與 `dustValIlvl84 / dustValIlvl84Q20`,容忍 ±1。
2026-09-28 資料(APT `a73fe3b`、poe-disenchant-tool `75eb611`):

| 一致 | 不一致 | 只在 APT | 只在 poe-dust | poe-dust 缺 goldCost |
|---:|---:|---:|---:|---:|
| 955 | 25 | 239 | 123 | 0 |

- 不一致 25 筆中 24 筆,把 APT 公式的「勢力數」設成 1 或 2 就兩欄都吻合(Starforge、Voidforge、Mark of the Shaper/Elder、Indigon…
  這類**本身固定帶勢力**的傳奇)。原因:APT 的 `disenchantValue` 不含勢力倍率,單件查價是在解析物品文字(`Shaper Item` 等行)時才加;
  排行沒有物品文字,原本會低估這 24 件。
- **排行的修正(固有勢力)**:`core/src/dust/data.ts` 的 `inherentInfluencesFromPoeDust(dv, poeDustRow)` 依英文名 + 基底從 poe-dust 反推 n:
  APT 在 n=0 已吻合 → 0;否則 n = round((`dustValIlvl84` ÷ (dv × 2500) − 1) ÷ 0.5),**只接受 1(×1.5)/ 2(×2.0)**,
  且 q0、q20 兩欄套 n 後都在 ±1 內才採用。排行 `dustAt(dv, { ilvl, quality, influences: n })`(催化劑比較也套),
  列上標「固有勢力 ×n」;`RankedDust.inherentInfluences`、`RankStats.inherentInfluenced`(目前資料 = 24)。
  例:Starforge dv 703.49 → n=1,排行 ilvl 84 q0 = 2,638,087(poe-dust 2,638,088;APT 公式 floor 2,638,087.5,poe-dust 四捨五入,差 1 在容忍內),q20 = 3,341,577(poe-dust 3,341,578)。
- **不套的**:Venarius' Astrolabe(比值 4.0,無 1 / 2 的解釋)維持 APT 值,留在報告;單件查價(`DustValue.vue`,有物品文字)不改。
- 拆粉基數仍以 APT 為主,poe-dust 只補 `goldCost` / `slots` 與固有勢力,不覆寫 `disenchantValue`。
- 只在一邊的多半是一方沒收錄(APT 有地圖/珠寶/藥劑/碎片類,poe-dust 沒有;poe-dust 有 APT 沒有的舊/改名傳奇)
  或同名不同基底(報告有「同名但基底不同」欄,只當提示,不拿來對接)。

## 排行(`core/src/dust/rank.ts` 的 `rankUniques`)

- **品質**:非飾品 = 選項的品質(0 / 20;磨刀石等成本不計)。飾品(Ring / Amulet / Belt,依基底 `craftable.category`)只能靠催化劑:
  `自動` = 比較「品質 0 直接拆」與「買 20 顆最便宜的催化劑到 20%」的 粉塵 ÷ 總成本,取高者並在列上註記;`不用` = 品質 0。
  沒有物品價或催化劑價就不比較(品質 0)。催化劑清單寫死 11 種(poe.ninja PoE1 的催化劑在 exchange `Currency` 類)。
- **效率**(粗體欄,選項「效率指標」決定排序):
  - 粉塵 / c = 粉塵 ÷ 物品價
  - 粉塵 / 總成本 = 粉塵 ÷(物品價 + goldCost ÷ 1000 × gold 估值 + 催化劑成本);gold 估值 > 0 時,沒有 goldCost 的傳奇不算(避免缺資料的反而排前面)
  - 粉塵 / gold = 粉塵 ÷ goldCost
  - 粉塵 / c / 格 = (粉塵 ÷ 物品價)÷ slots
  - 算不出來的(沒價、沒 gold、沒格數)排在最後,再依粉塵量由大到小。
- **gold 估值**:每 1000 gold 值幾個混沌石,預設 0(不計手續費)。`goldCost` 來源未說明對應的 ilvl,當成固定值。
- **假設**:poe.ninja 的傳奇價多為低 ilvl、未腐化、無品質的掛單,粉塵卻依選項的 ilvl / 品質計算 → 排行是「買得到的話」的估計;
  交易站 ↗ 的查詢會帶 `ilvl ≥ 選項值`,實際價格可能更高。`count < 5` 標 ⚠ 低信心。
- **區服**:poe.ninja 只有國際服。台服顯示「poe.ninja 無台服價格,排行以國際服計算」+ 切到國際服鈕;台服下排行只有粉塵量,
  交易站 ↗ 開台服網站並送繁中名。PoE2 沒有拆粉,面板提示只適用 PoE1。

## 面板(設定 › 拆粉排行)

- 檔案:`renderer/src/web/settings/tabs/Dust.vue`(分頁,包 `DustPanel`)、`renderer/src/web/dust/{DustPanel,DustTable}.vue`、`store.ts`;
  字串 `renderer/src/i18n/*.json` 的 `ppz.dust.*`、分頁名 `ppz.tab_dust`。
- 版面:這一頁 `SettingsWindow.vue` 替內容區加 `.fill`(不捲動、`DustPanel` 撐滿),表格自己虛擬捲動;關閉 = 設定視窗的 ✕ / Esc / 點暗幕
  (面板沒有自己的關閉鈕)。選項卡預設收合,展開與否模組層級記住(換分頁再回來不變,不進檔)。
- 表格:表頭可排序(名稱 / gold / 粉塵 / 價格 / 效率),虛擬捲動(同 `regex/RegexList.vue`)。每列兩行:
  名稱(介面語言)、粉塵、價格(`autoCurrency`:接近或超過 1 div 顯示 div)、效率、動作;第二行 另一語言名稱 · 基底 · gold · 催化劑註記 · ⚠。
  欄寬依表格寬(container query):≥ 600px 數值欄與間距放寬、< 480px(window 模式預設 480px 寬)收緊,名稱欄吃掉其餘寬度。
- 動作:交易站 ↗(`@exile-appraiser/poe1` 的 `webSearchUrl`;`name` + `type`、`misc_filters.ilvl.min`、`corrupted`(預設不限)、
  `indexed`(預設 1 週內)、`status: available`)、ninja ↗(詳細頁,`Host.openExternal`)、★ 標記、⊘ 隱藏。
- **交易站 ↗ 的開啟方式 = 一般查價的「交易」鈕**:都走系統預設瀏覽器(`Host.openExternal` → main `shell.openExternal`),
  使用者在自己的瀏覽器已登入。拆粉呼叫 `renderer/src/web/trade-site.ts` 的 `openTradeSite`(App.vue `provide('builtin-browser')` 也是它);
  只有上游 APT 選項 `priceCheck.builtinBrowser`(設定頁不提供,預設 false)開著才改開內建視窗。
  網址規則兩者相同:intl = `https://www.pathofexile.com/trade/search/<聯盟>`、tw = `https://pathofexile.tw/trade/search/<繁中聯盟>`(送繁中名)。
  2026-09-30 以前拆粉走 `inject('builtin-browser')` = `Host.openCaptcha`,開的是沒有登入狀態的 Electron 視窗(使用者回報要重新登入),已修正。
- 記憶:`userData/dust_ui.json`(IPC `dust-ui-load/save`,main 端 `.tmp` → rename、依序排隊;純瀏覽器 localStorage):
  選項全域一份;標記 / 隱藏**按聯盟分開**(`leagues[<聯盟 id>]`,鍵 = 英文 `name|baseType`)。格式與解析在 `core/src/dust/ui-state.ts`。

## 測試

`core/test/dust.test.ts`:公式(金標、各 ilvl 分段、品質 / 勢力 / 腐化)、poe-dust 與 items 解析、交叉比對統計與「不按位置」、
固有勢力(`inherentInfluencesFromPoeDust` 合成案例;真資料:Starforge n=1 且排行 dust 與 poe-dust 差 ≤ 1、Voidforge n=2 恰等、
Venarius 不套、套用集合 = 交叉比對可解釋的 24 件且 n 相同、套用後所有對得上的列 q0 都在 ±1 內)、
排行(排序、6L 不採用、催化劑決策、無價 / 低信心、gold 估值、四種指標、篩選)、錄製的 poe.ninja 回應實測、交易站查詢、記憶狀態往返。
`renderer/test/trade-site.test.ts`:開啟方式判定(預設系統瀏覽器、只有 builtinBrowser + Electron 才內建視窗)、舊設定檔 `dustDockRatio` 相容。
`main/test/external-links.test.ts`:`open-external` 只收 http(s)、主視窗導覽攔截規則。
