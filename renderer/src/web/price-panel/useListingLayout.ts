// 查價面板 B 改版 P4:兩代 TradeListing / TradeBulk 讀寫掛單顯示方式(切換即寫設定,Config 的 watch 300 ms 後存檔)。
import { computed, type ComputedRef } from 'vue'
import { AppConfig } from '@/web/Config'
import type { PriceCheckWidget } from '@/web/overlay/interfaces'
import { normListingLayout, withListingLayout, type ListingLayoutKind, type ListingLayoutMode } from './listing-layout'

export function useListingLayout (kind: ListingLayoutKind): {
  layout: ComputedRef<ListingLayoutMode>
  setLayout: (mode: ListingLayoutMode) => void
} {
  const widget = () => AppConfig<PriceCheckWidget>('price-check')
  return {
    layout: computed(() => normListingLayout(widget().listingLayout)[kind]),
    setLayout (mode) {
      const w = widget()
      if (normListingLayout(w.listingLayout)[kind] === mode) return
      w.listingLayout = withListingLayout(w.listingLayout, kind, mode)
    }
  }
}
