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
