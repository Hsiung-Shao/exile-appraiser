# PoE1 / PoE2 自動切換

## 為何用「寫設定 + 自我重新啟動」而不是換綁

`electron-overlay-window`(4.1.0)的限制:

- 原生碼 `node_modules/electron-overlay-window/src/lib/windows.c:176` 以
  `strcmp(title, target_info->title) == 0` **精確比對單一**視窗標題 —— 一次只能追一個標題,也沒有萬用字元。
- `OverlayController.attachByTitle()` 每個行程只能呼叫一次(內部 hook 只起一次,沒有 detach/re-attach API)。

所以同一個行程不能同時綁 PoE1 與 PoE2,也不能改綁。overlay 本身是透明無框視窗,重新啟動使用者看不到,
因此改成:把 `config.json` 的 `game` 寫成新值 → `app.relaunch()` → `app.exit(0)`,新行程照新 game 綁新標題。

## 模型

- 設定:`windowTitleBy: { poe1: 'Path of Exile', poe2: 'Path of Exile 2' }`(舊版單一 `windowTitle` 讀檔時併入當時 game 那格)、
  `autoSwitchGame`(預設 true)。
- `main/src/windowing/GameDetector.ts`:每 2 秒 `desktopCapturer.getSources({ types: ['window'] })` 取頂層視窗名稱
  (實測約 160 ms/次、Windows 不跳權限提示)。某遊戲「在」= 有名稱**完全等於**該遊戲標題(與原生 strcmp 同語意)。
  目前遊戲不在、另一款在,連續 2 次(約 4 秒)→ 切換;兩款都在或都不在 → 不動。`autoSwitchGame=false` → 不跑。
  ⚠ 實測 desktopCapturer **不列最小化的視窗**(全螢幕 PoE 切出去會最小化),只靠它會在「PoE1 最小化、PoE2 開著」時誤切。
  所以候選成立時再跑一次 PowerShell `Get-Process | ? MainWindowTitle`(含最小化)確認;否決結果 **10 秒內一律沿用**(`VETO_MIN_MS`,不看視窗清單 ——
  2026-10-02 code review 第 B 批:無關視窗標題(瀏覽器分頁、播放器)一直在變時,原本「清單一變立即重查」最壞每 2 秒 spawn 一次 PowerShell),
  之後「視窗清單(標題集合)不變」才沿用到 60 秒(`VETO_MS`),清單變了就重查;目前遊戲視窗 **detach**(`GameWindow.onDetach`,視窗被關掉)→ `invalidateVeto()` 立即作廢,
  「最小化後被關掉」不必等 10 秒下限就能切換。
  overlay 模式下目前綁定的遊戲視窗在前景(`poeWindow.isActive`)時視窗必在、判定必為不切換 → 該 tick 直接跳過列舉(連續計數照原行為重置;連續跳過 15 次會強制完整列舉一次,防 focus 狀態殘留)。
- **列舉退避(第 30.3 步,2026-10-03)**:視窗清單裡**兩款遊戲都不在**時,下一次列舉間隔 2 → 5 → 10 秒(`absentDelayMs`,上限 10 秒);
  清單裡有任一款(含「另一款在、目前不在」的候選確認期)或前景跳過 → 回到每 2 秒。**切換條件不變**:仍是「目前不在、另一款在」連續 2 次,兩次之間隔 2 秒。
  退避中收到訊號 → `nudge()` 立刻查一次並重設退避:綁定遊戲 attach / detach、`active-change`(綁定遊戲取得 / 失去前景)、`powerMonitor` `resume` / `unlock-screen`。
  沒在退避(有遊戲視窗)時 nudge 不做事,不額外列舉。
  ⚠ electron-overlay-window 的原生 WinEvent hook(`EVENT_SYSTEM_FOREGROUND`)只把**綁定標題**的視窗變化交給 JS(attach / detach / focus / blur / moveresize / fullscreen),
  其他視窗的前景變化拿不到 → **另一款遊戲啟動沒有事件可接**。
  **遊戲啟動後被偵測到的最壞延遲**:退避上限 10 秒(第 1 次命中)+ 2 秒(第 2 次確認)≈ **12 秒**,另加一次列舉(約 160 ms)與候選時的 PowerShell 確認;
  改前是 2 + 2 ≈ 4 秒。綁定的那款遊戲啟動不受影響(原生直接 attach,overlay 不靠偵測器)。
- `main/src/main.ts` 的 `host-config`:
  - overlay:第一次決定綁定(log `[overlay] attachByTitle "<title>" (game=<game>)`);之後 `game`、目前遊戲的標題、
    `overlayMode` 變了 → 等 500 ms(讓 renderer 300 ms debounce 的存檔落地)→ 寫 game → 重新啟動。
  - window(`--window` / `overlayMode:false`):沒有綁定,偵測到就寫 config 並送 `switch-game` 給 renderer,不重啟。
- 重新啟動前:`uIOhook.stop()`(`app.exit` 不發 will-quit)、`app.releaseSingleInstanceLock()`;relaunch 參數沿用 `process.argv.slice(1)`
  (`--user-data-dir`、`--window`、`--ppz-log-file` 都會帶過去)。

## 已知限制

- `npm run dev` 下自我重新啟動後,新 Electron 行程不再是 `build/script.mjs` 持有的那個子行程(未實測 watch 重建後的行為;
  推論是 esbuild 重建時另起的新行程會被單一實例鎖擋掉,舊的繼續跑)。改 main 程式碼後請手動關掉所有 electron 再重跑 dev。
- 驗證用 `--ppz-log-file=<path>`:main 的 console 另外附加寫檔(新行程的 stdout 接不回原終端機)。

## 相關文件
- [poe2-port-notes.md](poe2-port-notes.md)(PoE2 adapter 與 renderer 接線)
- [phase2-summary.md](phase2-summary.md)(Phase 2 摘要)
- 專案守則:[../CLAUDE.md](../CLAUDE.md)
