/**
 * poe.ninja 參考價 —— Phase 1 **刻意不做**(見計畫 §5「延後」),但移植來的元件
 * (FilterModifierAnointment、ItemQuickPrice、TradeBulk)會 import 這個模組,
 * 所以提供同名、行為為「沒有價格」的實作。Phase 2 換成真的 ninja 來源時介面不變。
 */
import { shallowRef } from 'vue'
import { createGlobalState } from '@vueuse/core'

export interface CurrencyValue {
  min: number
  max: number
  currency: 'chaos' | 'div'
}

export interface DbQuery {
  ns: string
  name: string
  variant?: string
}

export const usePoeninja = createGlobalState(() => {
  const xchgRate = shallowRef<number | undefined>(undefined)
  const isLoading = shallowRef(false)

  function findPriceByQuery (_query: DbQuery): { chaos: number, detailsId: string } | undefined {
    return undefined
  }

  function autoCurrency (value: number | [number, number]): CurrencyValue {
    if (Array.isArray(value)) return { min: value[0], max: value[1], currency: 'chaos' }
    return { min: value, max: value, currency: 'chaos' }
  }

  return {
    xchgRate,
    isLoading,
    load: async (_force = false) => {},
    queuePricesFetch: () => {},
    findPriceByQuery,
    autoCurrency
  }
})

export function displayRounding (value: number, fraction = false): string {
  if (fraction && Math.abs(value) < 1) {
    if (value === 0) return '0'
    return '1∕' + displayRounding(1 / value)
  }
  if (Math.abs(value) < 10) {
    return Number(value.toFixed(1)).toString().replace(/\.0$/, '')
  }
  return Math.round(value).toString()
}
