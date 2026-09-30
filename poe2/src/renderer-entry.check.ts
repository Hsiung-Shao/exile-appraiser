// exile-appraiser: 型別閘門 —— renderer 端手寫的宣告(renderer/src/web/games/poe2-entry.d.ts)必須是實作的「子集」。
// 實作改了簽章而宣告沒跟上,`npm run typecheck --workspace poe2`(vue-tsc -p tsconfig.vue.json)會在這裡紅。
import * as real from './renderer-entry'
import type * as decl from '../../renderer/src/web/games/poe2-entry'

export const conforms: {
  poe2Adapter: typeof decl.poe2Adapter
  browserDataSource: typeof decl.browserDataSource
  setTradeContextProvider: typeof decl.setTradeContextProvider
  setHostOptionsProvider: typeof decl.setHostOptionsProvider
  parseClipboard: typeof decl.parseClipboard
  createPresets: typeof decl.createPresets
  createTradeRequest: typeof decl.createTradeRequest
  // WP-S
  matchRevealLines: typeof decl.matchRevealLines
  revealPoolLabel: typeof decl.revealPoolLabel
  revealRangeLabel: typeof decl.revealRangeLabel
  // WP-R2
  matchRunesRows: typeof decl.matchRunesRows
  // 符文塑形點選查交易站
  planRuneTradeQuery: typeof decl.planRuneTradeQuery
  runeTradeUnavailable: typeof decl.runeTradeUnavailable
  summarizeRuneTrade: typeof decl.summarizeRuneTrade
  runeTradeStore: typeof decl.runeTradeStore
} = real
