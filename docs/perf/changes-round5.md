# 第五輪閒置降耗(步 30.2 / 30.3 / 30.8):改前改後

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
