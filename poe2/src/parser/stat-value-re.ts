/**
 * exile-appraiser(WP-S):數值(含進階格式的 `(lo-hi)`)的 regex,從 `stat-translations.ts` 抽出成**零依賴**模組,
 * 讓 main process(`main/src/ocr/locate-data.ts` → `desecration/ocr-locate.ts`)也能 import,不必把整個 parser 打包進 main。
 * 字面與旗標與上游 `stat-translations.ts` 原本內嵌的完全相同;`stat-translations.ts` 從這裡 import 並 re-export。
 */
export const STAT_VALUE_RE =
  /(?<value>(?<!\d|\))[+-]?\d+(?:\.\d+)?)(?:\((?<min>.[^)-]*)(?:-(?<max>[^)]+))?\))?/gm;
