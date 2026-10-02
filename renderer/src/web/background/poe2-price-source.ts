/**
 * 第 24 步:把 renderer 的 poe.ninja 價格表(`Prices.ts` `usePoeninja`)包成 PoE2 查價元件要的價格源
 * (`poe2/src/web/background/Prices.ts` `setPriceSource`;main.ts 啟動時注入)。
 *
 * - 只轉接、不另外抓:台服 / 私人聯盟 / 還沒抓到 → `find` 回 null、`revision` undefined(PoE2 元件整塊不顯示)。
 * - 單位換成上游的 divine(`toPoe2Entry`);沒有 divine 匯率 → 視為沒有價格。
 * - `ninja` 以 getter 傳入:第一次用到才建立 `usePoeninja()`(不改變它的建立時機)。
 */
import type { NinjaQuery } from '@exile-appraiser/core/ninja'
import type { Poe2PriceSource } from '../games/poe2-entry'
import { toPoe2Entry, type PriceTrendFields } from './price-trend'

/** `usePoeninja()` 用到的子集(測試可以給假的) */
export interface Poe2NinjaLike {
  readonly snapshot: { readonly value: { readonly game: string, readonly league: string, readonly fetchedAt: number } | null }
  readonly xchgRate: { readonly value: number | undefined }
  readonly exaltedRate: { readonly value: number | undefined }
  findPriceByQuery: (query: NinjaQuery) => ({ chaos: number, url: string, detailsId: string } & PriceTrendFields) | null
  queuePricesFetch: () => void
  initialLoading: () => boolean
}

export function createPoe2PriceSource (ninja: () => Poe2NinjaLike): Poe2PriceSource {
  return {
    revision () {
      const s = ninja().snapshot.value
      return s && s.game === 'poe2' ? `${s.game}|${s.league}|${s.fetchedAt}` : undefined
    },
    rates () {
      const n = ninja()
      return { divineRate: n.xchgRate.value, exaltedRate: n.exaltedRate.value }
    },
    find (query) {
      const n = ninja()
      if (n.snapshot.value?.game !== 'poe2') return null
      const hit = n.findPriceByQuery(query)
      return hit ? toPoe2Entry(hit, n.xchgRate.value) : null
    },
    queuePricesFetch () { ninja().queuePricesFetch() },
    initialLoading () { return ninja().initialLoading() }
  }
}
