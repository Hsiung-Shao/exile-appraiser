# PoE1 賽季資料更新(詞綴新寫法)

改了 `data/poe1` 或 `scripts/poe1-season/` 之後走這條。驗兩件事:解析與查詢組法吃得到新寫法、正則頁拿新寫法當模板。

## 步驟

1. 無頭查價(不連網):把 `poe1/test/fixtures/en/ring-rare-01.txt` 的 `+58(55-68) to maximum Mana` 換成 `+14(12-16)% to Item Rarity` 存成暫存檔,
   `npm run check -- <暫存檔> --realm intl > <證據目錄>/check-cli.txt 2>&1`。
2. `preview_start { name: "renderer" }` → 設定 › 正則 → 頁面選 `item_mod_values`(第一次會載入兩語系 stats,等 4 秒)→ 搜尋框 `[data-regex="imv-search"]` 輸入「物品稀有度」。
3. 勾 `[data-regex="algo-check-stat_3917489142"]`,把 `{ found, label, count, query }` 用 Write 存成 `<證據目錄>/state-item-rarity.json`(字串裡有反斜線,**不要用 heredoc 寫**),截圖。
4. `node .claude/skills/verify/check-season-data.mjs <證據目錄>`。

## 收尾

取消勾選(勾選存在分頁的 localStorage)→ `preview_stop`。

## 破壞對照

`git checkout <更新前的 commit> -- data/poe1` → 重跑步驟 1–4,斷言必須結束碼 1(列顯示舊寫法「增加 #% 物品稀有度」、無頭查價有 ⚠)→ `git checkout HEAD -- data/poe1` 還原。2026-11-14 已做,輸出在該次證據目錄的 `negative/`。
