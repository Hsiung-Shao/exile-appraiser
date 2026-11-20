# 計時器自動分段斷點(2026-11-20)

涵蓋:Client.txt 行 → 自動開始 / 分段(下一章第一張圖、基塔弗訊息、不重複分段、聊天不誤觸),用真的檔案追加 + 真的 `fs.watchFile`;設定 › 計時器 的分段清單顯示新斷點。
不涵蓋(待使用者實機確認):真實遊戲裡的分段時機、切到別的視窗自動暫停 / 回來繼續(焦點事件只有 Electron + 遊戲視窗才有)。

1. `node .claude/skills/verify/check-speedrun-breakpoints.mjs <證據目錄>`(寫 `run.log`、`exit_code.txt`、`events.json`)。
2. 內建瀏覽器:`button "設定"` → 左選單「計時器」→ 讀 `[data-setting^="split-area-"]` 的值(第 1–4、7、8 章應是「第 N 章第一張圖」),截圖存進證據目錄。

破壞點:`core/src/speedrun/client-log.ts` `KITAVA_RE` 的「奇塔弗」改一個字 → 「第 5 章:基塔弗訊息出現就分段」必須 FAIL。
