# 計時器三種模式(設定 › 計時器 + overlay 計時器)

## 設定頁(純瀏覽器)
1. `preview_start renderer` → 點「設定」→ 左選單「計時器」。
2. 點 `[data-setting="timer-mode"] [data-value="countdown"]`;讀 `[data-setting="countdown-min|countdown-sec"]`、`[data-action="sound-test"]` 是否存在、`[data-setting="speedrun"]` 不存在。
3. 點「試聽」(不得拋錯);分 = 1、秒 = 30 → `change`,1 秒後讀 `localStorage['exile-appraiser.config']` 的 `timerCountdownSec` / `timerMode`。截圖。

## overlay 計時器(假 host)
1. `../harness/overlay-host.html` 複製成 `renderer/zz-verify-timer.html`(**不 commit**,收尾刪掉)。
2. `localStorage['zz.config'] = {timerMode:'stopwatch', timerDisplay:'always', overlayMode:true}` → 開頁,`window.__cbs.onTimerAction('toggle')`,1.3 秒後讀 `[data-timer="widget"]` 文字;再 toggle 暫停,隔 0.5 秒讀兩次要相同。
3. `{timerMode:'countdown', timerCountdownSec:2}` → toggle,2.7 秒後讀文字 / `[data-timer="main"]` class、console `[timer]`。
4. `{timerMode:'countdown', timerCountdownSec:90}` → 讀未開始文字、toggle 後 1.5 秒文字,截圖。
5. 結果寫 `state-timer.json`(欄位見 `check-timer-modes.mjs`)→ `node .claude/skills/verify/check-timer-modes.mjs <證據目錄>`。

## 收尾
刪 `renderer/zz-verify-timer.html`;`preview_stop`。

## 破壞對照
`TimerWidget.vue` `simpleShown` 拿掉「倒數還沒開始:顯示設定的時長」那行 → 未開始顯示 0:00.00 → 斷言非 0。
