# 第五輪閒置降耗(步 30.2 / 30.3 / 30.8 / 30.6 / 30.7):改前改後

量測方法(三項共用):用步 29 的內建診斷 `--perf-log`,自己啟動的建置版(`npm run build` 後把 `main/dist/main.js`、`preload.js`、
`renderer/dist/*` 組成一個資料夾,同打包的 `files` 規則,`npx electron <資料夾>`),獨立 `--user-data-dir`,預先放一份 `config.json`:
`game: "poe2"`、`overlayMode: true`、兩款 `windowTitleBy` 都設成不存在的名稱(不 attach、overlay 不顯示)、`autoSwitchGame: true`、
褻瀆 / 符文自動辨識都開、`startupToast: false`、`autoUpdate: false`、`stashScroll: false`。啟動約 80 秒後用同一個 `--user-data-dir` 帶 `--quit` 結束。
取情境 `no-game+reveal+rune` 的**最後 12 筆**(每筆 5 秒,約 60 秒)加總 / 平均。不送任何輸入、不開任何視窗。

> 這個情境的 PanelScan 擋下原因是 `no-window`(沒有 attach 的遊戲視窗),GameDetector 是「兩款遊戲都不在」。
> 「卡頓 最長」是 main 事件迴圈單次最長延遲(每 5 秒一筆的平均);`desktopCapturer.getSources` 每次在 main 卡約 150–200 ms,所以會反映在這欄。

## 30.2 PanelScan 閒置(被 scanBlock 擋下不再每秒重排)

**改了什麼**(`main/src/ocr/panel-scan.ts`、`main/src/windowing/GameWindow.ts`、`main/src/main.ts`):
- 一個 tick 做完後的下一次間隔改由純函式 `nextTickDelay` 決定:被 `scanBlock` 擋下時
  - `disabled` / `not-poe2`(OCR 功能停用)→ **不排**(連保底都沒有),等 host-config 的 `poke()`;
  - 其他原因(`no-window` / `game-inactive` / `ui-open` / `user-paused` / `not-overlay` / `no-data`)→ **10 秒保底**(`BLOCKED_FALLBACK_MS`)。
  - 其餘結果(含擷取後才知道的 `region-outside`、`busy`、`mask-wait`、例外)照原本的掃描間隔,行為不變。
- 會改變 scanBlock 結果的事件都會立刻重看:原本就有的 `active-change` / host-config(`scanConfigKey`)/ `runeshape-ui-state` / 暫停熱鍵 /
  框選確認 / OCR 語言改變(全部走 `poke()`);新增遊戲視窗 `attach` / `detach` / `moveresize` → `wake()`
  (只有目前被擋下才立刻重看;正常掃描中不插 tick,拖動視窗時 moveresize 很密)。
- 解除封鎖後的第一個 tick:事件當下 `poke()` → `schedule(0)`,比改前(最壞等一個掃描間隔)快或相同。

**改前改後**(no-game,60 秒):

| 指標 | 改前(HEAD 59d611e) | 改後 |
|---|---|---|
| 褻瀆 `reveal.ticks` | 60 | **6** |
| 符文 `rune.ticks` | 60 | **6** |
| `reveal.blocked` / `rune.blocked` | `no-window` 60 / 60 | `no-window` 6 / 6 |
| `detect.enums`(本項未動) | 30 | 30 |
| CPU(單核 100% 基準,平均) | 0.86 % | 0.78 % |
| 卡頓 p95 / 最長(平均) | 12.0 / 166.0 ms | 11.9 / 153.6 ms |

被擋下的 tick 本身只做判斷(不擷取、不 OCR),所以 CPU 差很小;主要省的是每秒兩次計時器喚醒與 `block()` 的狀態重設。
卡頓最長值主要來自 GameDetector 的列舉(30.3 處理)。

**測試**:`main/test/panel-scan-idle.test.ts`(14 項,假時鐘):`nextTickDelay` 各原因;遊戲失焦 60 秒只有 7 個 tick(t = 0, 10, …, 60 秒)、
`no-window` / 設定視窗開著同樣 10 秒保底、正常掃描每 intervalMs 不變;active-change / setUiState / `wake()` 事件當下就擷取、
`wake()` 在正常掃描中不插 tick;`disabled` / `not-poe2` 第一次判斷之後 0 tick、沒有計時器,host-config `poke()` 啟用後立刻掃描;
任何時候最多一個計時器、`stop()` 後 0 個、停用 ↔ 啟用來回切換不累積。既有 `runeshape-scan` / `reveal-scan` / `perf-monitor` 測試不改照過。

## 30.3 GameDetector 列舉退避(遊戲沒開)

**改了什麼**(`main/src/windowing/GameDetector.ts`、`main/src/main.ts`、`docs/game-auto-switch.md`):
- `setInterval(2 秒)` 改成 setTimeout 鏈;視窗清單裡**兩款遊戲都不在**時下一次列舉間隔 2 → 5 → 10 秒(`absentDelayMs`,上限 10 秒)。
  清單裡有任一款(含「目前不在、另一款在」的候選確認期)或前景跳過 → 每 2 秒,**「連續 2 次」的切換條件與兩次之間的 2 秒間隔不變**。
- 訊號調查:electron-overlay-window 的原生 WinEvent hook 有 `EVENT_SYSTEM_FOREGROUND`,但只把**綁定標題**的視窗變化交給 JS
  (`attach` / `detach` / `focus` / `blur` / `moveresize` / `fullscreen`),其他視窗的前景變化拿不到;Electron 也沒有全域前景事件。
  能接的訊號 → `nudge()`(只在退避中才立刻查一次並重設退避,有遊戲時不額外列舉):綁定遊戲 `attach` / `detach`、`active-change`、
  `powerMonitor` `resume` / `unlock-screen`。
- **遊戲啟動後被偵測到的最壞延遲**(另一款遊戲啟動,沒有事件可接):退避上限 10 秒(第 1 次命中)+ 2 秒(第 2 次確認)≈ **12 秒**,
  另加列舉(約 160 ms)與候選時的 PowerShell 確認;改前 2 + 2 ≈ 4 秒。綁定的那款遊戲啟動不受影響(原生直接 attach)。寫在 `docs/game-auto-switch.md`。

**改前改後**(no-game,60 秒;改前 = 30.2 之後的建置,只差這一項):

| 指標 | 改前(30.2 後) | 改後 |
|---|---|---|
| `detect.enums`(`getSources` 次數) | 30 | **6** |
| `detect.processProbes` | 0 | 0 |
| CPU(單核 100% 基準,平均) | 0.78 % | **0.19 %** |
| 卡頓 最長(每 5 秒一筆的平均) | 153.6 ms | 82.1 ms(有列舉的 5 秒 126–181 ms、沒列舉的 12–16 ms) |
| 卡頓 p95(平均) | 11.9 ms | 11.9 ms |
| `reveal.ticks` / `rune.ticks` | 6 / 6 | 6 / 6 |

每次列舉仍會在 main 卡 130–190 ms(`desktopCapturer.getSources`),只是次數變成約 1/5;要再降得換掉列舉方式(計畫 30.7 評估)。

**測試**:`main/test/game-detector.test.ts` 新增 8 項(假計時器 + 假時鐘):`absentDelayMs` / `anyGamePresent`;兩款都不在時列舉時間點
2, 4, 9, 19, 29… 秒(60 秒 8 次,改前 30 次);有遊戲視窗照舊每 2 秒;退避到 10 秒時另一款啟動 → 10 秒內第 1 次命中、2 秒後第 2 次 → 切換
(連續 2 次不變);`nudge()` 立刻查並重設退避、立刻命中後 2 秒確認、沒在退避 / 沒啟動時不做事;前景跳過重設退避;stop / start 重設、計時器不洩漏。
既有 12 項(前景跳過、否決沿用、連續 2 次)不改照過。

## 30.8 poe.ninja 4 分鐘定期更新只在查價後 20 分鐘內排

**改了什麼**(`renderer/src/web/background/Prices.ts`、新檔 `interest-refresh.ts`):
- 原本 `usePoeninja()` 建立時就開一個常駐 `setInterval(load, 4 分鐘)`;`load()` 進去後因「距上次查價 > 20 分鐘」直接 return,
  所以沒人查價時只是每 4 分鐘白白喚醒一次 renderer。
- 改成 `createInterestRefresh`:`queuePricesFetch()`(剪貼簿查價 / PoE2 符文塑形自動查價 / 拆粉等所有「有人在查價」的入口)
  記下查價時間並 `touch()` → 沒有計時器才開 4 分鐘 interval(已有就沿用節奏);interval 觸發時距上次查價 > 20 分鐘(與 `load()` 閘門同一個 `>`)
  → 關掉計時器、不呼叫。下次查價 `queuePricesFetch` 照舊立即 `load()`,資料過期(只有快取 15 分鐘、這次抓過 31 分鐘)就馬上抓。
- 節流常數(4 / 31 / 20 分鐘、15 分鐘快取 TTL)與 `load()` 本體都沒動;PoE2 轉接層(`poe2-price-source.ts`、`poe2/src/web/background/Prices.ts`)
  本來就沒有自己的計時器,不用改。

**改前改後**:這個計時器在 renderer,步 29 的 perf-log(main 的 getAppMetrics / 掃描 / 列舉計數)數不到它,所以**沒有實機 perf-log 數字**;
以單元測試的時間軸模擬(180 分鐘內在 0、50、52、130 分查價,資料 31 分鐘過期):

| 指標 | 改前(常駐 interval) | 改後 |
|---|---|---|
| 沒人查價時的定期喚醒 | 每 4 分鐘一次(每小時 15 次) | **0**(沒有計時器) |
| 180 分鐘內定期喚醒次數 | 45 | **15** |
| 實際上網抓的時間點 | 0、50、130 分 | 0、50、130 分(相同) |

每次喚醒本身只是一次提早 return 的 `load()`,CPU 差異小到量不出來;這項的目的是閒置時不留常駐計時器。

**測試**:`renderer/test/interest-refresh.test.ts`(8 項,假計時器):沒人查價不開計時器;查價後在 4、8、12、16、20 分鐘 refresh、之後關掉;
期間內再查價沿用同一個計時器、期限從最後一次查價起算;過期後再查價重開、`stop()`;與改前常駐 interval 的實際抓取時間點相同(上表);
`Prices.ts` 接線(沒有 `setInterval`、`queuePricesFetch` 先記時間再 `touch` 再立即 `load()`、常數不變)、PoE2 轉接層沒有自己的計時器。
既有 `price-trend.test.ts`(剪貼簿查價算「有人在查價」、快取讀取時序)不改照過。

## 30.6 背景圖:關閉零成本、隱藏時卸載、霧面 0 也預先處理

**改了什麼**(`renderer/src/web/ui/BgLayer.vue`、新檔 `ui/BgLayerImage.vue`、`bg-bake.ts`、`useTheme.ts`、`App.vue`):
- **BgLayer.vue 改成閘門**:背景開著(`bgShownUrl` 有值)且容器顯示中才掛載本體 `BgLayerImage.vue`(原本的 BgLayer 內容)。
  背景關閉 → 沒有 `.bgimg` / `.bgtint` DOM、沒有 ResizeObserver / MutationObserver / watcher、不載入圖。
  改前:兩個容器(查價面板、設定視窗)永遠掛著圖層,關閉時只是 `display: none`,observer 與 watcher 照樣在。
- **查價面板隱藏時卸載**:App.vue 把面板的 `v-show` 條件抽成 `panelVisible`,同一個值傳給 `<bg-layer :shown>`。
  卸載時把畫好的圖(blob URL + 已解碼 Image)交給 `bgBakeCache`(一個容器一張),再顯示時第一幀就直接換上,量到同樣大小 → 不重畫、不閃;
  設定在隱藏中變了 → 舊圖先留著,新圖好了才換。背景關閉 / 換圖時 `useBackground` 清掉快取。設定視窗(本來就 v-if)同樣走快取。
  改前:面板一藏,ResizeObserver 回報 0 → 丟掉預先處理的圖;再顯示要整張重畫(canvas 模糊 + PNG 編碼 + 解碼),期間是 CSS 即時模糊。
  ⚠ 實測抓到一個時序坑:掛載當幀的 rAF 比 ResizeObserver 早跑,照 0 × 0 呼叫 `update` 會把剛換上的快取圖當成「隱藏」丟掉
  → 改成 ResizeObserver 第一次回報前不呼叫 `update`(`measured`,有回歸測試)。
- **霧面 0 也預先處理**:`bgBakeSpec` 霧面 0 不再回 null(`blurPx: 0`),`BgBaker` 接受 0,filter 只有 `brightness()`。
  面板顯示時只是貼一張 1:1 的靜態圖,不再每次重繪都把原圖(常見 1920×1080 以上)即時縮放並套 brightness filter。CSS 路徑只剩圖還沒好 / 失敗時用。
- **繪製矩形對齊 CSS**:畫布寬高取整數後兩軸比例會差一點(例:框寬 897 × 1.04 = 932.88 → 933),以前直接在畫布上算 cover,拉回框之後圖會多 / 少 1 個畫布像素。
  `bgBakePlan` 改為兩軸比例不同時在「框」上算落點(= CSS background-position / size)再各軸換算到畫布,拉回去與 CSS 版矩形重合;比例相同時沿用原算法(逐位元不變)。

**量測方法**:
1. **背景開 / 關、霧面 0 改前改後的成本**:自己的 harness(`dist-perf/`,gitignore,用完刪)—— 啟動建置版 `--preview`(overlay、不存在的遊戲標題、
   獨立 `--user-data-dir`、1920×1080 測試圖、亮度 60 / 面板 75),另一個 Electron 行程以 **offscreen 繪製**(`webPreferences.offscreen`,不開視窗、不搶焦點、
   關硬體加速同本程式,60 fps)載入預覽網址,900×700、dpr 1。逐段量 10 秒 `getAppMetrics` 的 `cumulativeCPUUsage`:
   設定視窗閒置 / **設定內容每幀捲動**(全面重繪)/ 查價面板閒置 / **面板內一行字每幀改內容**(局部重繪)/ **開關設定 10 次**(面板藏起再顯示)。
   CPU 為單核 100% 基準(renderer = Tab 行程;「全部」= harness 內所有行程,含 GPU 行程的軟體合成)。
2. **實機閒置**(遊戲沒開、面板沒顯示):照本檔開頭的 perf-log 做法(no-game,最後 12 筆),背景關 vs 開(霧面 0)。
3. **外觀**:同一個 harness 截圖(`capturePage`),改前 vs 改後逐像素比;另一張把背景以外的內容藏起來只比背景本身。

**改前改後**(offscreen harness;改前 = HEAD 0cdbfb2 的建置):

| 情境 | 霧面 0 改前(CSS 即時) | 霧面 0 改後(預先處理) | 霧面 12 改前 | 霧面 12 改後 | 背景關 改前 | 背景關 改後 |
|---|---|---|---|---|---|---|
| 設定視窗每幀捲動:renderer CPU | 42.8 % | **25.3 %** | 25.8 % | 26.0 % | 16.4 % | 16.3 % |
| 同上:全部行程 CPU | 52.5 % | **35.0 %** | 35.7 % | 37.3 % | 26.4 % | 26.6 % |
| 面板一行字每幀重繪:renderer CPU | 5.3 % | 5.0 % | 4.8 % | 5.1 % | 4.4 % | 4.3 % |
| 開關設定 10 次:renderer CPU 秒數 | 0.348 s | 0.314 s | **1.684 s** | **0.309 s** | 0.256 s | 0.261 s |
| 同上:重畫張數(`createObjectURL`) | 0 | **0** | **20** | **0** | 0 | 0 |
| 設定 / 面板閒置:renderer CPU | 0 / 0.4 % | 0 / 0.4 % | 0 / 0.4 % | 0 / 0.4 % | 0 / 0.4 % | 0 / 0.4 % |
| 面板閒置:renderer WS | 177.4 MB | 189.6 MB | 191.4 MB | 192.3 MB | 169.5 MB | 171.7 MB |
| 每幀 rAF(60 fps 上限) | 16.6 ms | 16.6 ms | 16.6 ms | 16.6 ms | 16.6 ms | 16.6 ms |

- 霧面 0 的大面積重繪 renderer CPU **−41%**(42.8 → 25.3 %),降到與霧面 12(本來就預先處理)同一級;局部重繪差異在雜訊內。
- 霧面 > 0 時面板藏起再顯示不再重畫:10 次開關 renderer CPU 1.68 → 0.31 秒(每次約 −140 ms 的 canvas 模糊 + PNG 編碼),重畫 20 → 0 張;霧面 0 改前沒有預先處理所以本來就 0。
- 代價:霧面 0 時 renderer 工作集約 **+12 MB**(預先處理的點陣圖 + 解碼後的來源圖,與霧面 > 0 相同水準);背景關閉時不變。
- 60 fps 時 rAF 都卡在上限,這個 harness 不會掉幀,所以比的是 CPU 而不是幀時間。

**實機閒置**(perf-log,no-game,overlay、面板沒顯示,最後 12 筆):

| 指標 | 背景關 改前 | 背景開(霧面 0)改前 | 背景關 改後 | 背景開(霧面 0)改後 |
|---|---|---|---|---|
| renderer(Tab)CPU | 0.008 % | 0 % | 0 % | 0 % |
| renderer(Tab)WS | 97.3 MB | 97.7 MB | 94.3 MB | 97.2 MB |
| 全部 CPU | 0.25 % | 0.24 % | 0.17 % | 0.16 % |

面板沒顯示時改前也只是 `display: none` 的空殼(不載圖、不 bake),這個情境的差異在量測雜訊內(WS ±3 MB、CPU 差 0.07% 來自 main,與本項無關);
本項省下的是面板 / 設定顯示中重繪與每次再顯示的重畫。

**外觀**(offscreen 900×700,改前 vs 改後):

| 截圖 | 最大差 | 平均差 | 差 > 2 的像素 |
|---|---|---|---|
| 霧面 0 預設(cover 置中):設定 / 面板,只有背景 | 1 / 2 | 0.11 / 0.19 | 0 % |
| 霧面 0 預設:設定 / 面板,整個畫面(含文字) | 1 / 2 | 0.03 / 0.14 | 0 % |
| 霧面 0 版面 A(面板 contain 左下、設定 zoom 200% 右上) | 8 / 1(面板 / 設定) | 0.30 / 0.11 | 1.66 % / 0 % |
| 霧面 0 版面 B(面板 zoom 250% 焦點 20,0、設定 contain 左下) | 2 / 8 | 0.17 / 0.19 | 0 % / 0.73 % |
| 霧面 0 版面 C(cover 焦點 100,30 / 0,70) | 2 / 1 | 0.19 / 0.11 | 0 % |
| 霧面 12 預設 | 1 / 0 | 0.01 / 0 | 0 % |
| 背景關 | 0 / 0 | 0 / 0 | 0 % |

位置、填滿方式(cover / contain / zoom)與縮放都對;最大差 8/255 出現在 contain 留邊的邊界與 zoom 的重取樣,肉眼不可分。
(版面 A/B/C 的設定視窗整張圖另有一塊差異來自設定頁「顯示位置」預覽框的長寬比:預覽模式啟動時查價面板還沒顯示就被設定蓋住,
改後面板圖層沒掛載 → 沒量到面板大小 → 預覽框用代表比例 1:2;改前那一瞬間量到了。overlay 實機啟動時面板本來就是藏著的,兩版相同。)

**測試**:
- `renderer/test-vue/bg-layer-gate.test.ts`(新,mini-dom 真的掛載,observer / Image 換成計數替身,6 項):背景關 → 0 圖層 DOM、0 observer、0 載入;
  背景開但面板隱藏 → 0 掛載、改霧面也不 bake;開著且顯示 → 各 1 個 observer、量到大小才載入(霧面 0 也載入);顯示 → 隱藏 → observer 斷開、隱藏中改設定不載入;
  背景關掉 → 顯示中的圖層也卸載;**再顯示時快取圖第一幀就換上、掛載當幀的 rAF 不能丟掉它、量到同樣大小不載入不重畫**(拿掉 `measured` 這項會失敗)。
- `renderer/test/background.test.ts`:霧面 0 也有 bake spec / filter 只有亮度;BgBaker 霧面 0 照常載入繪製、霧面調回 0 重畫不重載、背景關閉回 CSS;
  **霧面 0 的繪製矩形與 CSS 版一致**(寬 / 高圖 × 面板 / 設定框 × dpr 1 / 1.5 × cover / contain / zoom × 3 個焦點,畫布拉回框後誤差 < 0.001 px);
  `detach` / `adopt` / `BgBakeCache`、`useBackground` 關閉 / 換圖清快取、接線守門(閘門條件、App.vue 的 v-show 與 `:shown` 同一個 `panelVisible`)。
  既有測試只改了三處:霧面 0 從「維持 CSS」改為「預先處理」的兩項、讀實作細節的守門改讀 `BgLayerImage.vue`。

## 30.7 electron-overlay-window 原生 hook thread(調查,**不改程式**)

**它在做什麼**(`node_modules/electron-overlay-window` 4.1.0,`src/lib/windows.c` / `dist/index.js`):
- `OverlayController.attachByTitle()` → 原生 `start()` → `uv_thread_create(hook_thread)`,這條執行緒跑 Win32 訊息迴圈到行程結束:
  - 全系統 `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`、`(EVENT_SYSTEM_MINIMIZEEND)`(out-of-context,只在前景切換 / 還原時被叫);
  - `SetTimer(83 ms)`(約 12 次 / 秒):`GetForegroundWindow()` 與上次不同才做 MSAA 確認並 `handle_new_foreground`;
  - 目前前景視窗那條執行緒的 `EVENT_OBJECT_NAMECHANGE`(每次前景換人就重掛):前景視窗改標題時比對綁定標題;
  - 綁定的遊戲 attach 之後另掛它的 `LOCATIONCHANGE` / `DESTROY`。
- **沒有任何停止 / detach API**:原生只匯出 `start` / `activateOverlay` / `focusTarget` / `screenshot`,JS 端 `attachByTitle` 每個行程只能呼叫一次(`isInitialized`);
  hook 與計時器的 handle 沒存起來,執行緒也沒有結束條件。遊戲關掉(detach)後執行緒照常在跑,等下一次同標題視窗出現。

**成本**(獨立量測,不靠本程式的其他部分):`dist-perf/owhook-probe.cjs`(gitignore,用完刪)在純 Node 行程裡用 `node-gyp-build` 載入同一個 `.node`,
`start(沒有 overlay 視窗, 不存在的標題)` = 本程式遊戲沒開時的狀態;對照組是同樣空轉、不 start 的 Node 行程。兩者同時跑,PowerShell `QueryProcessCycleTime` 量 100 秒:

| 指標 | 空轉對照 | hook thread 開著 | 差 |
|---|---|---|---|
| CPU cycles / 秒 | 10,876 | 2,113,017 | **約 2.1 M / 秒** |
| 換算單核(9800X3D,4.7 GHz) | — | — | **約 0.045 %**(16 執行緒的系統 ≈ 0.003 %) |
| `process.cpuUsage()`(GetProcessTimes,15.6 ms 刻度) | 0 ms / 120 s | 0 ms / 120 s | 低於 OS 計時刻度,量不出 |

量測當下的前景視窗是使用者正在玩的遊戲(不改它的標題);前景是一直改標題的程式(瀏覽器播放中、終端機)時 NAMECHANGE 事件會多一些,但每次只是取標題 + strcmp。

**能不能在遊戲沒開時停掉**:
| 做法 | 評估 |
|---|---|
| 遊戲沒開時 detach / 停 hook thread | **套件不支援**(沒有 stop API、handle 沒保存)。要做只能 fork 原生碼加 `stop`(UnhookWinEvent ×N、KillTimer、PostThreadMessage(WM_QUIT))並自建 win32-x64 prebuild,還要處理 JS 端 `isInitialized` 與 threadsafe function 的釋放;換來的是每秒 ~2 M cycles。不划算 |
| 不在啟動時 `attachByTitle`,等 GameDetector 偵測到綁定的遊戲才 attach | ① 停用自動切換(`autoSwitchGame: false`)時 GameDetector 根本不跑,得另開輪詢;② GameDetector 的偵測是 `desktopCapturer.getSources` 列舉,**每次在 main 卡 130–190 ms**(30.3 量到),遊戲沒開時每 10 秒一次 ≈ 1.5 % 的 main 執行緒時間,本身就比這條 hook thread 貴兩個數量級;③ 綁定的遊戲啟動後要等最多 10 秒 + 2 秒確認才 attach,這段時間 overlay / 熱鍵 / 掃描都不能用(現在是原生前景事件,幾乎立刻);④ attach 一次就再也停不掉,只省得到「這次執行從沒開過遊戲」的那段 |
| 拉長 83 ms 計時器 | 也要改原生碼;它是 ForegroundLockTimeout / 搶前景時的補救路徑,拉長會讓 focus / blur(overlay 顯示 / 隱藏、熱鍵是否作用)變慢 |

**結論**:不改。這條執行緒在遊戲沒開時約 0.045 % 單核,低於 GameDetector 一次列舉的成本,而唯一可行的「延後 attach」會增加偵測延遲、需要更貴的輪詢、
且 attach 後仍停不掉。記為限制:**electron-overlay-window 4.1.0 的 hook thread 一旦啟動就常駐到程式結束**。若之後要再降遊戲沒開時的 main 成本,
優先處理的是 GameDetector 的 `getSources` 列舉(換成 EnumWindows 之類的原生列舉),不是這條執行緒。
