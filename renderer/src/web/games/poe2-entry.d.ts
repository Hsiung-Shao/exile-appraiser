/**
 * PoE2 adapter 在 renderer 端的型別宣告(執行期實作:poe2/src/renderer-entry.ts,經 Vite alias `@poe2-entry`)。
 *
 * renderer 的 tsconfig 不能直接讀 poe2 原始碼(`@/…` 會被指到 poe1),所以這裡手寫 renderer 真正用到的子集;
 * 與實作的一致性由 poe2/src/renderer-entry.check.ts 在 poe2 的型別檢查裡把關。
 * .vue 元件(`CheckedItem`、`RateLimiterState`)的型別走 env.d.ts 的 `*.vue` 宣告。
 */
import type { DefineComponent } from 'vue'
import type { Result } from 'neverthrow'
import type { DataSource, GameAdapter, PresetOptions, TradeContext } from '@exile-appraiser/core/games/adapter'

/** App.vue 只讀名稱做 log;其餘欄位原樣交給 poe2 的 CheckedItem.vue。 */
export interface Poe2ParsedItem {
  info: { name: string, refName: string }
}

export interface Poe2HostOptions {
  language: string
  savedAugments: { [key: string]: Array<string | null> }
  searchStatRange: number
}

/** 一鍵回報只需要 id 與 filters/stats 能原樣交回 createTradeRequest。 */
export interface Poe2FilterPreset {
  id: string
}

/**
 * 一鍵回報(report.ts)用:以預設篩選重算查詢 JSON。
 * 用 method 語法宣告(參數雙變),實作收的是完整的 poe2 ParsedItem / FilterPreset,這裡只認子集。
 */
export interface Poe2ReportFns {
  createPresets (item: Poe2ParsedItem, opts: PresetOptions & { defaultAllSelected?: boolean }): { presets: Poe2FilterPreset[], active: string }
  createTradeRequest (preset: Poe2FilterPreset, item: Poe2ParsedItem): unknown
}

export declare const poe2Adapter: Pick<GameAdapter, 'id' | 'loadData'>
export declare function browserDataSource (baseUrl: string): DataSource
export declare function setTradeContextProvider (provider: () => TradeContext): void
export declare function setHostOptionsProvider (next: (() => Partial<Poe2HostOptions>) | undefined): void
export declare function parseClipboard (clipboard: string): Result<Poe2ParsedItem, string>
export declare const CheckedItem: DefineComponent<{}, {}, any>
export declare const RateLimiterState: DefineComponent<{}, {}, any>
export declare const createPresets: Poe2ReportFns['createPresets']
export declare const createTradeRequest: Poe2ReportFns['createTradeRequest']
