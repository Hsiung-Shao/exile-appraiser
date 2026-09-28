# ExileAppraiser(流亡鑑價)

> 前身名稱 `poe-price-zh`;舊設定(`%APPDATA%\poe-price-zh\config.json`)首次啟動時自動搬過來。

Path of Exile 查價工具:在遊戲裡對物品按熱鍵,立刻查官方交易站的掛單。

## 功能
- **PoE1 與 PoE2 一支搞定**:依前景遊戲視窗自動切換(PoE1 ↔ PoE2),不必手動改設定。
- **國際服 / 台服**:國際服(`www.pathofexile.com`)與台服(`pathofexile.tw`)兩區查詢,詞綴以語言無關的 stat id 對接。
- **繁體中文 / 英文客戶端**:剪貼簿解析依客戶端語言;**介面語言可另外切換**(中文 / English),互不影響。
- **遊戲內 overlay**:附著在遊戲視窗上,滑鼠移到物品按熱鍵即在游標旁彈出;也可用獨立視窗模式。
- **四種主題**(石板 / 淺色 / 高對比 / 羊皮紙)+ 強調色 + 字級,風格與 PobTools 一致。
- **Poe Regex 搜尋字串產生器**:地圖、探險日誌、PoE2 換界石 / 碑牌 / 聖物 / 探險遺物詞綴勾選後產生遊戲搜尋列字串(Any / All / None),可存書籤。
- **一鍵回報**:查價出錯時把物品原文、解析結果、查詢內容整理成 GitHub issue 草稿,由你自己確認後送出(不自動上傳、不含帳號名)。
- **自動更新**:啟動時檢查 GitHub Releases,有新版在「關於」顯示,按下才下載與安裝(portable 版提供下載連結)。
- 匿名查詢,不需要 POESESSID、不需登入。

## 來源與致謝
- 剪貼簿解析、詞綴篩選、數值容差、大宗通貨查詢皆移植自 [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade)
  的繁中 fork [awakened-poe-trade-zh-TW](https://github.com/Hsiung-Shao/awakened-poe-trade-zh-TW)(MIT);
  PoE2 部分移植自 Exiled Exchange 2 的繁中版 [Exiled-Exchange-2-zh-TW](https://github.com/Hsiung-Shao/Exiled-Exchange-2-zh-TW)(MIT)。
- PoE1 / PoE2 一體化與台服/國際服分區的做法參考 [PoENavi](https://github.com/buri34/poenavi)(MIT)。
- Poe Regex 演算法與資料來自同作者的 PobTools。

## 安裝與使用
1. 從 Releases 下載安裝檔或 portable 版。
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
