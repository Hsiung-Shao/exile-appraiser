# ExileAppraiser(流亡鑑價)

> 前身名稱 `poe-price-zh`;舊設定(`%APPDATA%\poe-price-zh\config.json`)首次啟動時自動搬過來。

Path of Exile 查價工具:在遊戲裡對物品按熱鍵,立刻查官方交易站的掛單。

## 功能
- **PoE1 與 PoE2 一支搞定**:依前景遊戲視窗自動切換(PoE1 ↔ PoE2),不必手動改設定。
- **國際服 / 台服**:國際服(`www.pathofexile.com`)與台服(`pathofexile.tw`)兩區查詢,詞綴以語言無關的 stat id 對接。
- **繁體中文 / 英文客戶端**:剪貼簿解析依客戶端語言;**介面語言可另外切換**(中文 / English),互不影響。
- **遊戲內 overlay**:附著在遊戲視窗上,滑鼠移到物品按熱鍵即在游標旁彈出;也可用獨立視窗模式。
- **四種主題**(石板 / 淺色 / 高對比 / 羊皮紙)+ 強調色 + 字級,風格與 PobTools 一致。
- **Poe Regex 搜尋字串產生器**:詞綴 / 名稱清單 PoE1 10 頁(地圖、探險日誌、聖甲蟲、藥劑、星團珠寶、寶石、紋身、劫盜裝備、劫盜契約、商店基底)、PoE2 7 頁(換界石、碑牌、聖物、探險遺物、藥劑護符、寶石、商店基底),另有地圖數值與商店條件頁;勾選後產生遊戲搜尋列字串(Any / All / None),可存書籤。
  - **數值條件**:地圖階級、物品數量 / 稀有度、怪物群大小等「≥ / ≤ / 區間」自動轉成最短正則;商店頁可篩連結數、鏈接顏色、物品等級、品質、已汙染、勢力基底(插槽寫法待實測)。
  - **多頁合併**:各頁勾選合成一串並檢查跨頁誤中與長度(每頁貢獻看得到);可加自訂文字與排除詞。
  - **分享碼與範本**:整組勾選壓成一串分享碼,貼上即還原;內建範本(T17 危險詞綴、地圖無反射、6L 商店、換界石危險詞綴…)。
- **拆粉(Thaumaturgic Dust)**:查價面板顯示這件傳奇能拆出多少粉塵、有 poe.ninja 價時換算每 chaos 幾粉塵;標題列 ⚖ 開啟**拆粉排行**,列出所有傳奇依「粉塵 / chaos」等四種效率排序(含 gold 手續費、飾品催化劑、固有勢力),一鍵開交易站或 poe.ninja。價格來自 poe.ninja(僅國際服)。
  拆粉排行在設定視窗的「拆粉排行」分頁。
- **瀏覽器預覽**:托盤或設定 › 一般「在瀏覽器開啟設定」,用一般瀏覽器看、改設定,改動即時同步回 overlay;只開在本機(`127.0.0.1` + 隨機網址)。overlay 模式下在瀏覽器換遊戲會提示「下次啟動才生效」,不會自動重啟。
- **PoE2 褻瀆詞綴 Tier**:進階複製(PoE2 查價熱鍵會送 `Ctrl+Alt+C`)直接顯示遊戲給的 Tier;只有一般複製文字時(例如貼上 `Ctrl+C` 的內容),依 PoB2 詞綴資料**推定** Tier 並標示「推定」,無法唯一判定就列出候選。
- **PoE2 靈魂之井三選一 OCR**(overlay 模式):在揭露面板按 `Ctrl + Shift + R`,每個選項右側顯示褻瀆詞綴的 Tier、詞綴池與數值範圍。需要 Windows 繁中 OCR 語言包(設定 › 熱鍵與視窗會顯示狀態);辨識用 Windows 內建 OCR,**在本機執行,截圖不存檔、不上傳**。10 分鐘內查過那件物品的價可得到精確底材,否則 Tier 以範圍顯示並標「?」。全螢幕獨占模式可能擷取不到畫面,請用無邊框視窗。
  可在設定 › 熱鍵與視窗按「在遊戲上框選」,直接在遊戲畫面上拖曳框出揭露面板的位置(也可另設框選熱鍵):辨識會先只看這一塊(較快、較準),這塊裡沒找到面板時自動改找整個畫面並提示。
- **PoE2 符文塑形自動查價**(overlay 模式、國際服,設定 › 熱鍵與視窗開啟):開著符文塑形面板時,每一列旁顯示 poe.ninja 參考價(崇高石 / 神聖石)。同樣以本機 Windows OCR 辨識,不送任何輸入、不上傳。
- **一鍵回報**:查價出錯時把物品原文、解析結果、查詢內容整理成 GitHub issue 草稿,由你自己確認後送出(不自動上傳、不含帳號名)。
- **自動更新**:安裝版預設在背景下載新版,正常結束程式時自動套用(設定 › 關於可關閉,改為手動下載 / 安裝;portable 版提供下載連結)。
- 匿名查詢,不需要 POESESSID、不需登入。

## 來源與致謝
- 剪貼簿解析、詞綴篩選、數值容差、大宗通貨查詢皆移植自 [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade)
  的繁中 fork [awakened-poe-trade-zh-TW](https://github.com/Hsiung-Shao/awakened-poe-trade-zh-TW)(MIT);
  PoE2 部分移植自 Exiled Exchange 2 的繁中版 [Exiled-Exchange-2-zh-TW](https://github.com/Hsiung-Shao/Exiled-Exchange-2-zh-TW)(MIT)。
- PoE1 / PoE2 一體化與台服/國際服分區的做法參考 [PoENavi](https://github.com/buri34/poenavi)(MIT);PoE2 褻瀆 Tier 資料表的產生規則移植自 PoENavi,詞綴資料來自 [Path of Building PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)(MIT)。
- Poe Regex 演算法與資料來自同作者的 PobTools。
- 拆粉的 gold 手續費、背包格數與交叉比對數值來自 [poe-disenchant-tool](https://github.com/deronek/poe-disenchant-tool)(deronek,MIT),數值最初由 @alserom 整理;價格來自 [poe.ninja](https://poe.ninja)。

## 安裝與使用
1. 從 [Releases](https://github.com/Hsiung-Shao/exile-appraiser/releases/latest) 下載安裝檔 `ExileAppraiser-Setup-<版本>.exe`(可自動更新)或免安裝的 `ExileAppraiser-<版本>-portable.exe`。僅支援 Windows。
2. 首次啟動到設定(齒輪)› 一般:選介面語言、伺服器、客戶端語言、聯盟;外觀(主題 / 強調色 / 字級)也在這裡。
3. 遊戲內滑鼠移到物品上按 `Ctrl+D`(可改),視窗會在游標旁彈出。
4. 若聯盟清單載不出來,按「開啟交易站」在內建瀏覽器完成一次 Cloudflare 驗證。

## 開發
```bash
npm install
npm test               # 資料檔 MANIFEST 驗證 + 回歸網(parser 快照、兩區黃金查詢、離線交易層)
npm run check -- item.txt --realm both   # 不開 GUI 看兩區各會送什麼查詢
npm run dev:renderer & npm run dev:main  # 開發模式
npm run build-icons    # 由 renderer/public/brand/*.svg 重產圖示
npm run package        # 打包(Windows nsis + portable,不上傳;發版流程見 docs/release-flow.md)
```
詳細規則見 `CLAUDE.md`;第三方授權見 `NOTICE.md` 與 `LICENSES/`。

Path of Exile 及其資料為 Grinding Gear Games 所有。本專案與 GGG 無關。
