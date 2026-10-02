/**
 * exile-appraiser: renderer(Vite + Vue)用的 PoE2 入口。
 *
 * 為什麼另外一個檔:renderer 的 tsconfig 把 `@/parser` 等指到 poe1(poe1 的移植檔逐字用 `@/…`),
 * 同一個 TS program 不可能讓 poe2 的 `@/…` 指到 poe2。所以 renderer **型別上**不讀 poe2 的原始碼,
 * 只認 `renderer/src/web/games/poe2-entry.d.ts` 這份宣告;執行期由 Vite 的 `@poe2-entry` alias 指到這裡,
 * 再由 vite.config.mts 的 importer 感知解析器讓 poe2 檔案內的 `@/…` 先找 poe2/src、找不到才退回 renderer/src。
 * 宣告與實作是否一致,由 `renderer-entry.check.ts`(poe2 的 vue-tsc 專案)把關。
 */
export { poe2Adapter, browserDataSource, setTradeContextProvider, setHostOptionsProvider } from './index'
// exile-appraiser(第 24 步):查價面板「通貨價格區」—— renderer 注入 poe.ninja 價格源(web/background/Prices.ts)
export { setPriceSource } from '@/web/background/Prices'
// exile-appraiser: 一鍵回報(renderer/src/web/report.ts)用預設篩選重算查詢 JSON
export { createPresets, createTradeRequest } from './index'
export { parseClipboard } from '@/parser'
// exile-appraiser(WP-S):靈魂之井揭露面板 OCR 的比對與顯示字串(renderer/src/web/overlay/OcrBadges.vue)
export { matchRevealLines, poolLabel as revealPoolLabel, rangeLabel as revealRangeLabel } from './desecration/reveal-entry'
// exile-appraiser(WP-R2):符文塑形面板 OCR 列 → refName / poe.ninja 鍵(renderer/src/web/overlay/RuneshapePrices.vue;docs/runeshape.md)
export { matchRunesRows } from './runeshape/match'
// exile-appraiser:符文塑形無 ninja 價的列 → 自動查交易站(帶與產物相符的篩選;docs/runeshape.md「自動查市集」)
export { planRuneTradeQuery, runeTradeUnavailable, summarizeRuneTrade, createRuneTradeQueue, withRuneTrade429 } from './runeshape/trade-lookup'
export { default as CheckedItem } from '@/web/price-check/CheckedItem.vue'
export { default as RateLimiterState } from '@/web/price-check/trade/RateLimiterState.vue'
