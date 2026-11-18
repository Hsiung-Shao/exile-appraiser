# 設定 › 正則的版面(設計稿 P10 產生器 / P11 書籤與快捷)

## 涵蓋
兩欄門檻(窄單欄、寬左清單右輸出)、數值條件區收合 / 展開換欄與鍵盤焦點、輸出語言分段鈕、書籤頁的底線子分頁 / 兩張小卡並排 / 書籤列開關。不涵蓋:實機 overlay 裡的設定視窗、背景圖模式的外觀。

## 路徑
1. Launch(見 SKILL.md)→ 點「設定」→ 左選單「正則」→ 子分頁「產生器」→ 遊戲 PoE1、清單「地圖詞綴」→ 勾至少一條詞綴。
2. `resize_window` 寬 840 → 把 `dump-regex-layout.js` 整段貼進 `javascript_tool`,回傳值存成 `<證據目錄>/state-840.json`。
3. `resize_window` 寬 1000 → 同一段再跑一次,存成 `<證據目錄>/state-1000.json`。截一張圖放進證據目錄。
4. `node .claude/skills/verify/check-regex-layout.mjs <證據目錄>`,必須結束碼 0。

## 預期
840 寬(面板約 615px)單欄、輸出疊在清單上方;1000 寬(面板約 775px)兩欄。數值條件展開在左欄、收合在右欄,兩次切換後焦點都在標題鈕。

## 破壞對照
把 `renderer/src/web/regex/RegexPanel.vue` 的 `@container rx-panel (min-width: 52em)` 改成 `46em` → 840 寬重跑第 2 步(1000 的沿用)→ 斷言「窄(840…):單欄」必須 FAIL,輸出存 `<證據目錄>/negative/`→ 還原並 `git diff --quiet` 確認。
