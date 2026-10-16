// 2026-10-16:兩代 FiltersBlock / FilterModifierMechanism 讀寫「機制」開關(切換即寫設定,Config 的 watch 300 ms 後存檔)。
import { computed, type ComputedRef } from 'vue'
import { AppConfig } from '@/web/Config'
import type { PriceCheckWidget } from '@/web/overlay/interfaces'
import { normShowMechanism } from './mechanism-visibility'

export function useShowMechanism (): {
  show: ComputedRef<boolean>
  setShow: (on: boolean) => void
} {
  const widget = () => AppConfig<PriceCheckWidget>('price-check')
  return {
    show: computed(() => normShowMechanism(widget().showMechanism)),
    setShow (on) {
      widget().showMechanism = on
    }
  }
}
