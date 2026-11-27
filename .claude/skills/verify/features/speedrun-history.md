# speedrun 紀錄(設定 › 計時器 › 紀錄 + overlay 計時器的比較)

## 設定頁(純瀏覽器)
1. `preview_start renderer`。`localStorage['exile-appraiser.config']` 放一條 PoE1 內建 10 段路線(shape `10#<各段 area 以 | 連>`),history 四筆:rA 跑完慢、rB 跑完快、rC 未跑完 3/10、rD 跑完但 partial;pb = rA。重新整理。
2. 點「設定」→「計時器」。讀 `[data-setting="speedrun-history"] [data-record]` 的順序(新到舊)、各筆 `[data-action="record-set-pb"]` 的 disabled。
3. rB 改名、按「比較」、按「設為個人最佳」→ 1 秒後讀存檔的 compare / name / pb 末段。截圖。
4. 點 rB「刪除」→「確定刪除」;展開 rA「各段」→ 讀存檔 ids / compare / pb、各段列數。截圖。
5. 點 rA 名稱欄打字 + Tab → 重新整理 → 讀存檔名稱。
## overlay 計時器(假 host)
1. `../harness/overlay-host.html` 複製成 `renderer/zz-verify-timer.html`(**不 commit**,收尾刪掉)。
2. `localStorage['zz.config']`:同路線、pb 每章 11 分、history 只有 rB(每章 1 秒、已改名)、compare rB、`timerDisplay:'always'`、`overlayMode:true`、`speedrunRows:3`。
3. 讀 `[data-timer="compare"]`;`__cbs.onTimerAction('toggle')` → 1.5 秒 → 再 toggle(分段)→ 讀 `[data-split="0"]` 與存檔 history。截圖。
4. 結果寫 `state-history.json`(欄位見 `check-speedrun-history.mjs`)→ `node .claude/skills/verify/check-speedrun-history.mjs <證據目錄>`。
## 收尾
刪 `renderer/zz-verify-timer.html`;`preview_stop`。
## 破壞對照
`core/src/speedrun/run.ts` `comparison` 的 `run.base.ref ?? run.base.pb` 改成 `run.base.pb` → 差值變 −10:58 → 斷言非 0。
