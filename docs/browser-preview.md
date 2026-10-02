# 瀏覽器預覽(在瀏覽器開啟設定)

ExileAppraiser 在本機開一個網址,用一般瀏覽器就能看、改設定;改動寫進同一份 `config.json`,並即時同步到 overlay / 視窗。
做法照 PobTools `host/modern_ui_browser.cpp`(瀏覽器模式),用 Node `http`,沒有新增依賴。

## 用法

| 入口 | 行為 |
|---|---|
| 托盤「在瀏覽器開啟設定」 | 啟動(或沿用)預覽伺服器,用預設瀏覽器開 |
| 設定 › 一般 › 瀏覽器預覽「在瀏覽器開啟設定」 | 同上,並顯示網址與「複製」鈕 |
| `--preview` 啟動參數 | 啟動即開伺服器,log 印出 `[preview] --preview:<網址>`;不自動開瀏覽器 |

- 網址形如 `http://127.0.0.1:<臨時埠>/t/<32 位 hex token>/`;可加 `#tab=hotkeys`(`general|price-check|hotkeys|regex|about`)指定一開始的分頁,預設「一般」。
- 頁面載入後自動開設定視窗(boot script 在 `onOpenSettings` 第一次訂閱時觸發;填滿分頁,寬 < 640px 左選單收成上方分頁;沒有「結束程式」;記住的大小 / 位置不套用、沒有調整大小把手,獨立字級照樣套用),關掉設定只會看到空的查價面板。
- 結束 ExileAppraiser(`app.quit`)時伺服器一起關;頁面 4 秒連不上會在頂端顯示紅色「已斷線」條。

### 開發模式

Vite(5173)的模組路徑是絕對路徑(`/src/…`、`/@vite/client`),放不進 `/t/<token>/` 前綴,**所以預覽不代理 Vite**:
開發模式一律供應**已 build 的** `renderer/dist`。改了 renderer 要看預覽,先 `npm run build --workspace renderer`
(沒有 `renderer/dist/index.html` 時 main log 會印 `[preview] 找不到 …`)。Electron 視窗本身仍用 Vite。

```bash
npm run dev:renderer                                   # Vite 5173(Electron 視窗用)
npm run build --workspace renderer                     # 預覽用的 renderer/dist
npm run dev:main -- --window --preview --no-updates    # log 印預覽網址
```

## 同步

- main 在 `config-save` 寫檔後廣播 `config-changed {contents, source}`(`source` = `electron` 或 `preview:<clientId>`)。
- 發起端自己的回音在傳輸層就略過(preload 略過 `electron`,boot script 略過自己的 `preview:<cid>`)。
- renderer `Config.ts`:內容與本地 `serialize()` 不同才 `applyLoaded`,並記下套用後的內容;save watch 看到同一份不再存檔(不會兩端互相回存)。
- 兩端幾乎同時改設定時是「最後寫入者勝」:收到對方的 `config-changed` 會蓋掉本地尚未存檔(300 ms debounce 內)的改動。
- 預覽端送 `host-config`:熱鍵照常更新;**遊戲 / 該遊戲視窗標題 / overlayMode 與目前 overlay 的綁定不同時不重新啟動**,
  只回 `{ ok: true, needsRestart: true }`(設定頁顯示「下次啟動才生效」)。Electron 視窗隨後套用同一份設定送來的
  `host-config` 也不重新啟動(main 記住 `deferredByPreview`);之後若在 overlay 裡改成別的值,照舊重新啟動。
  window 模式沒有綁定,換遊戲照常即時生效。

## 能做 / 不能做

- 經 RPC(與 Electron 內行為相同):設定讀寫、`http-fetch`(Electron session,帶 Cloudflare cookie、同一套主機白名單、預設 30 秒逾時)、
  `http-abort`(`fetchAbort(requestId)`:中止自己這個分頁帶 `requestId` 送出的請求;鍵含預覽 cid,中止不到別的分頁 / Electron 視窗的請求)、
  Regex / 拆粉 / ninja 快取、更新器四個動作、`openExternal`、`openCaptcha`(**開在 Electron 視窗**,cookie 才進得了 session)。
- 瀏覽器端 no-op:`hideWindow`、`resizeWindow`、`trackArea`、`focusGame`、`usedRecently`(沒有視窗可控)。
- 設定 › 記錄(第 28 步):`log-get`(`getLog(sinceSeq)`)預覽可讀;`log-lines` 即時追加**不送預覽**,預覽端的記錄分頁每 2 秒用 `sinceSeq` 輪詢;`log-subscribe` 在 shim 是 no-op;`log-open-folder` 是 `preview: false`(預覽端沒有「開啟記錄資料夾」鈕)。
- 預覽分頁收得到的事件只有 `config-changed`、`updater-state`、`switch-game`。**`item-text` 不送**:否則按一次查價熱鍵,
  overlay 與每個預覽分頁都會各查一次,交易站限流加倍。所以預覽頁不會跟著查價。

## 安全模型

| 威脅 | 對策 |
|---|---|
| 區網 / 其他機器連入 | 只 `listen(0, '127.0.0.1')` |
| 本機其他網頁猜網址 | 每次啟動隨機 16 bytes token(`/t/<32 hex>/`),前綴不符一律 404;token 只在 log、托盤開的網址與設定頁出現 |
| DNS rebinding(惡意網域解析到 127.0.0.1) | `Host` 標頭必須**正好**是 `127.0.0.1:<port>`,否則 421(`localhost:<port>` 也拒) |
| 其他網頁跨站 POST `~rpc` | 帶 `Origin` 且不是本伺服器 origin → 403;且仍需 token |
| 路徑穿越 | 與 `app://` 相同的 `path.normalize` + 根目錄前綴檢查;`%00`、壞的百分比編碼一律拒 |
| 自訂背景圖 `<prefix>bg/<檔名>`(2026-10-01) | 同樣在 token 之後;與 `app://bg/` 共用 `main/src/backgrounds.ts` `resolveBgPath`:只准 png / jpg / jpeg / webp、檔名不含路徑字元、解析後必須正好在 `userData/backgrounds/`,其餘一律 404。選圖(`bg-pick`,檔案對話框)`preview: false`,預覽端只能看不能選 |
| 伺服器常駐 | 曾連線後 20 秒沒有任何 SSE 連線、或啟動 180 秒都沒人連 → 自動關閉並記 log(可從托盤 / 設定頁再開,會換新 token 與埠) |

RPC 能做的事與 Electron renderer 相同(沒有更多權限):`http-fetch` 仍受 `main/src/http.ts` 的 `ALLOWED_HOSTS` 限制。

## 協定(`main/src/preview-server.ts`)

- `index.html`:在第一個 `<script` 前注入 boot script,造出 `window.host`(`isElectron: true`、`isPreview: true`、`version`、`windowMode: 'window'` 烤入)。
- `POST ~rpc` `{id, cid, method, args}` → 立即 202;結果從 SSE 回 `{id, result}` / `{id, error: {message}}`,只送給該 `cid`。
  JSON 會把 `undefined` 參數變 `null`,伺服器端轉回 `undefined`。方法名 → channel 對照 `HOST_METHOD_CHANNELS`。
- `GET ~events?cid=<cid>`:SSE,每則 `id: <seq>`;事件 `{event, data}` 廣播。重連帶 `Last-Event-ID` 從下一則續傳;
  新連線補上給自己的舊回覆(RPC 可能比 SSE 先送出),但不重播連線前的廣播。15 秒一次 `: keep-alive`。
- 佇列保留(2026-10-01 效能修正第 9 步,`replyGraceMs` / `unclaimedReplyMs` 可注入):
  - 給 cid 的回覆**送達該 cid 的連線後只再留 5 秒**(這段時間內帶 `Last-Event-ID` 重連會補送在途中遺失的回覆),之後移出佇列;
  - 該 cid 的連線全部斷掉超過 5 秒 → 丟掉它未送達的回覆(shim 斷線 4 秒就把等待中的呼叫 reject `host.disconnected`,不會再用到);
    從沒連上過的 cid(RPC 比 SSE 先到)留 30 秒;
  - 廣播事件維持原本策略(不過期,只受總量上限);
  - 總量上限 512 則 / 32 MB,以 **UTF-8 位元組**計(以前是 UTF-16 長度,中文實際約 3 倍);單則 ≥ 256 KB 的大項目
    (`http-fetch` 回應、`ninja-cache-load` 快照)合計另限 4 MB,超過先丟最舊的已送達大回覆。
- 快取標頭:`assets/` 下 Vite 帶 hash 的檔 `Cache-Control: public, max-age=31536000, immutable`;其他靜態檔與背景圖
  `no-cache` + 弱 `ETag`(大小 + mtime),`If-None-Match` 相符回 304(不讀檔);`index.html` 的 boot script 內含 token 前綴,
  維持 `no-store`、不給 ETag(換 token = 換網址,也不會被別的伺服器的快取錯用)。token / Host / Origin 檢查都在快取判斷之前。
- main 端的 handler 全在 `main/src/host-handlers.ts` 的登錄表(`kind: invoke|send|sync`、`preview: false` 不開放),
  `registerIpc(table)` 給 ipcMain、`previewHandlers(table)` 給預覽伺服器;事件走 `Broadcaster.broadcast`(webContents + 放行清單內的預覽事件)。

## 測試

`main/test/preview-server.test.ts`(vitest,純 Node,不需要 Electron;root `npm test` 最後一步):token 錯 404、Host 錯 421、
Origin 錯 403、防穿越、boot script 注入位置與 shim 行為、RPC 往返 / 錯誤、回覆只給發起端、SSE 廣播、`Last-Event-ID` 續傳、
20 秒 / 180 秒自動關閉(注入假時鐘)、回覆送達後 5 秒移出 / 重連窗口補送 / 窗口外丟棄 / 位元組上限 / 大項目上限、
ETag / 304 / immutable / index.html 不快取 / 背景圖 token 保護。`main/test/http.test.ts`:`http-fetch` 逾時與 `http-abort`(mock electron)。

## 相關文件

- [desecration-tiers.md](desecration-tiers.md):同為 Phase 4(WP-R)。預覽頁不收 `item-text`,所以褻瀆 Tier 推定只在 overlay / 視窗的查價面板看得到。
- [phase4-summary.md](phase4-summary.md):Phase 4 各工作包摘要、限制、待親測。
- 專案守則:[../CLAUDE.md](../CLAUDE.md)(必守規則 18)
