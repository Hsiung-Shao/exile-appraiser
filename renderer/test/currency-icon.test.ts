// P1 通貨圖示兩代分開:PoE2 用自己的圖(來源 items.ndjson icon),不再借 PoE1 的圖。
import { describe, expect, it } from 'vitest'
import { currencyIcon } from '../src/web/price-panel/currency-icon'

describe('currencyIcon', () => {
  it('Q1 兩代回傳不同路徑,PoE2 在 /images/poe2/ 底下', () => {
    for (const k of ['exa', 'divine', 'chaos', 'annul', 'wisdom'] as const) {
      expect(currencyIcon('poe1', k)).toBe(`/images/${k}.png`)
      expect(currencyIcon('poe2', k)).toBe(`/images/poe2/${k}.png`)
    }
  })
})
