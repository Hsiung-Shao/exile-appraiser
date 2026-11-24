---
name: issue-fix-round
description: ExileAppraiser 一輪 GitHub issue 回報修正(詞綴未解析、查到 0 筆、Query is too complex、查價失敗)到備好發版的固定流程。使用者說「修 issue」「處理回報」「#NN 顯示未解析」「新的一批 issue」、或要把一批回報整理成下一版時使用;新賽季 / 小改版 GGPK 出來、說「開季」「主動掃描」「比對新舊兩季」時也用(先跑差異掃描再修)。整理自 v0.3.14–v0.3.18 的實際做法。
---

# 一輪 issue 修正(到備好發版)

依據:v0.3.16 → v0.3.17(commit `7cb953b`…`d737ee8`,issue #45 #57–#70)與前幾輪的做法。細節規則仍以 CLAUDE.md 規則 1 為準,本檔只講**順序與檢查點**。

## 開季 / 小改版:先主動掃描,再等回報

新版 GGPK 出來時不等 issue(使用者 2026-11-24 裁定),照 CLAUDE.md 規則 1「開季主動掃描」:

1. 請 PobTools 對話抽 GGPK 並匯入本機 Supabase(同一個 version_id 要有 `ggpk_stat` / `ggpk_cell` / `ggpk_row` / `rel_*`);本專案不自己匯入。抽取前確認遊戲沒開(開著會靜默沿用舊 cache)。
2. `update.mjs --write` 到摘要全 0。
3. `node scripts/poe1-season/dump-type-sweep.mjs --diff <舊>,<新>` → `poe1/test/docs/type-sweep-diff.json`。
4. 在 `poe1/`:`UPDATE_FIXTURES=1 DIFF_SWEEP_REPORT=../docs/poe1-season/<新版>-diff-sweep.md npx vitest run test/type-sweep.test.ts`,看報告與 `type-sweep-diff{-gaps,-query-gaps}.json` 的 diff。
5. 報告裡的缺口當成「沒人回報的 issue」,從第 2 步(先寫失敗測試)開始逐批修;缺口清單只能變少。

## 0. 收件與分類

```bash
gh issue list --repo Hsiung-Shao/exile-appraiser --state open
gh issue view <N> --repo Hsiung-Shao/exile-appraiser
```

每則先歸一類(寫在進度表的備註欄):

| 類 | 判斷 | 處理 |
|---|---|---|
| 舊版已修 | 回報版號比修正版舊,目前版本解析正常(#66) | **只補樣本測試**,不改程式 |
| 同一根因 | 與已修 / 本輪另一則同句型(#70 = #64 #65) | 樣本加進同一個 `it.each`,不另修 |
| PoE1 資料 | 句子寫法、譯名、交易站 id 對不上 | 第 3 步改產生器規則 |
| 程式 | 查詢組法、條件數、錯誤訊息、UI 選項(#45 #62 #63) | 改程式 + 單元測試 |
| PoE2 | `poe2/` | `scripts/poe2-season/lib.mjs` 或程式;**不要** `sync-data --game poe2` |

## 1. 存樣本、重現

- 物品原文存成 **CRLF** 檔:PoE1 `poe1/test/docs/3.30-issue-<N>.<cmn-Hant|en>.txt`、PoE2 `poe2/test/docs/issue-<N>.cmn-Hant.txt`。回報沒附原文時,用標題 / 截圖組最小樣本並在測試標題註明。
- 重現:`npm run check -- poe1/test/docs/3.30-issue-<N>.cmn-Hant.txt --realm both`(PoE2 加 `--game poe2`),看 ⚠ 未解析清單與 payload。

## 2. 先寫失敗測試(對的紅)

- **實機樣本測試**:PoE1 加在 `poe1/test/season-330-data.test.ts`(沿用 `D17w?` 編號、`unknownOf(item)` 為空 + 交易站 id + 數值),PoE2 加在 `poe2/test/issues-0.5.test.ts`。
- **規則單元測試**:改 `scripts/poe1-season/lib.mjs` 的規則時在 `poe1/test/season-update.test.ts` 對應 `describe` 加一條,**必附反例**(該拒收的情況照舊拒收)。第 b245737 次審查就是因為少了「matchers 不同 / 繁中不同」反例而被抓。
- 程式類:就近加測試檔(例 `poe1/test/issue-62-63.test.ts`),樣本要選**舊算法會誤報**的情況(d490492:改勾輔助最多的群組才攔得住回歸)。
- 跑 `npx vitest run <檔>` 確認紅在斷言,不是 import / 路徑錯。

## 3. 修在正確的層

詞綴修正的四層(決策 2026-11-20),由上往下找第一個能修的:

1. **產生**:`scripts/poe1-season/lib.mjs` 新增或放寬規則(規則 28 永恆珠寶、29 只差大小寫、16 例外…),寫進 CLAUDE.md 規則 1 一段。
2. **容錯**:解析器(「(...)」、英文名退回)— 只有一整類句子都受影響才動。
3. **交易站 id**:同文另一個 id 實測有物品 → `LIVE_TWIN_IDS`;新 id 補進 `poe1/test/docs/trade-stat-ids-3.30.json`(只加尾端)。
4. **例外**:`EXTRA_ZH_MATCHERS` 逐條列依據(GGPK 找不到時帶 `verified`)。

然後重產資料(**不手改 ndjson**,worktree 裡 `--from` 給絕對路徑):

```bash
node scripts/poe1-season/update.mjs --from D:/codeproject/Pob2/pob-zh-engine            # 先看摘要
node scripts/poe1-season/update.mjs --from D:/codeproject/Pob2/pob-zh-engine --write    # 寫入,重跑到摘要全 0
node scripts/poe2-season/update.mjs --write                                             # PoE2 才需要
```

寫入會自動重建索引與 MANIFEST。

## 4. 擴大檢查(使用者 2026-11-18 裁定的流程)

修好那一條 → **中英都解析得到** → **同類物品有沒有同樣問題**:

- `poe1/test/lang-parity.test.ts`:中英對齊。
- `poe1/test/type-sweep.test.ts`、`poe1/test/trade-id-audit.test.ts`:缺口檔 `poe1/test/docs/{type-sweep-gaps,type-sweep-query-gaps,trade-id-audit-gaps}.json` **只能變少**;變少時 `UPDATE_FIXTURES=1 npx vitest run <檔>` 重寫並看 diff。
- 正則連帶:`regex/test/item-mods.test.ts` / `item-mod-forms.test.ts` 的鎖定數字看過再改;有新寫法就重跑 `node regex/scripts/gen-item-mod-forms.mjs`。
- 範圍外發現(既有 bug、同類掃描命中)先記下,本輪測試完後一次列給使用者。

## 5. 驗收、commit、審查

```bash
npm test
npm run typecheck
git diff --shortstat
```

- 全綠才 commit。訊息格式:`PoE1:修 GitHub issue #A #B(一句話列每則)`,內文逐條「規則 N:…(#N)」;只補測試的寫 `測試:…`。
- commit 後派 **1 位** bug reviewer(`opus`/`high`,`name: reviewer-issue-<號>`)審 `git diff <base>..HEAD`;動到核心規則再加 `cross-reviewer`。修正另開 commit:`審查修正(#N):…`,第 2、3 輪 SendMessage 同一位。
- 標準符合性主對話自己對 `~/.claude/agents/standards-reviewer.md` 審。

## 6. 備好發版(不發、不 push)

1. 版號(只有修正 → patch):root、`main/`、`core/`、`poe1/`、`poe2/`、`regex/`、`renderer/` 的 `package.json` 一起改,`npm install` 更新 `package-lock.json`;`npm run check-user-agent`。
2. `docs/release-notes/v<版號>.md`:照 `release-notes-zh` skill,**玩家看得懂的症狀**為標題(「顯示為未解析」「查到 0 筆」),不寫規則編號;交易站新列等資料變動放「調整」。
3. `docs/release-flow.md` 發版紀錄加一行(issue 範圍、規則編號、只補測試的註明),commit `v<版號>:版號、更新說明、發版紀錄`。
4. 停下來問使用者「發不發」;發版步驟照 `docs/release-flow.md`。

## 已踩過的坑

- **Git Bash `sed -i` 會把 CRLF 檔轉成 LF**(7b78f00 整檔 2972 行 diff)。測試檔、產生器、ndjson 一律用 Edit;commit 前 `git diff --stat` 看到整檔重寫就是行尾壞了。
- 放寬規則的條件要**一次寫完整**(英文與繁中那組都要相同、正負相同),否則審查會抓到誤掛。
- 計數類提醒(傭兵條件數)只算**啟用群組裡沒停用的條件**,沒勾的不算。
- 交易站門檻、同文 id 是否有物品,都要**實測**才寫進規則(匿名查詢,見 CLAUDE.md 規則 1 `LIVE_TWIN_IDS` / `MERCENARY_FILTER_LIMIT`),不要用推的。
- 遊戲內 GUI 行為不得用合成輸入驗證(規則 14);要實機確認的寫進收尾的「還剩什麼」。
