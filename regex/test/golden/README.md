# Poe Regex golden

## 現況:最小 golden(不改 C++ 取得)

`selftest-report.json` 由 `extract-from-report.mjs` 從 C++ `pob-zh.exe --regex-selftest` 的報告
(`pob-zh-engine/dist/regex_selftest.txt`)抽出。報告只印了這些逐字值,`golden.test.ts` 全部逐字比對:

- 合成測試 19 個 query 字串(T1–T5、T7、T9、T13–T16 的 `check(..., "說明: " + r.query)`)
- 12 頁(2 語言 × 6 頁)種子 `0x5EED1234` 的 10 選 Any 長度與逐字寫出長度
- 繁中地圖頁「怪物有 #% 機率避免元素異常狀態」單選 = `"免元"`、裸「常」碰到 11 筆
- 另外 `properties.test.ts` 用同一份 JSON 比對 ambient 行數、單獨可指定數與卡住名稱

長度相同不代表字串相同。資料頁的 **Build().query 本身**報告沒有印,所以真實資料上還沒有逐字 golden。

## 要完整 golden:PobTools 端要加匯出旗標(另開 PobTools 任務)

建議在 `host/regex_selftest.cpp` 加 `--regex-golden <out.json>`(不影響 `--regex-selftest`):

```
for game/page in RegexDataset.Pages()(poe1 先), for lang in [zh, en]:
  corpus = 跟 DataTests 的 build(true) 一樣組
  for mode in [Any, None, All]:
    rng = Rng{0xC0FFEE + mi * 7919}; 120 輪,每輪 n = 1 + below(10)、sel = n 個 below(size)(可重複)
    記 { page, lang, mode, sel, query, length, unresolved, tokens }
  單選:每一列 i 記 Build({i}, Any).query
```

輸出 UTF-8 JSON(不要 BOM),放到本目錄 `cpp-golden.json`,`golden.test.ts` 加一段逐筆 `expect(ts.build(sel, mode)).toEqual(...)`。
輸入完全由 LCG 種子決定,TS 端已有同一個 `Rng`(`src/rng.ts`),所以只需要 C++ 的輸出。
