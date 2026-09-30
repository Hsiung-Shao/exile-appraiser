// 設定 `autoUpdate`(自動下載、結束程式時套用;Config.ts 五處:介面、預設、serialize、applyLoaded、host-config)
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'

describe('autoUpdate 設定檔往返', () => {
  it('全新 / 舊設定檔沒有這欄 → 預設開,且會寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.autoUpdate).toBe(true)
      expect(JSON.parse(serialized).autoUpdate).toBe(true)
    }
  })
  it('明確 false 才關;非布林值當成開', () => {
    expect(_roundTripForTest('{"autoUpdate":false}').config.autoUpdate).toBe(false)
    expect(JSON.parse(_roundTripForTest('{"autoUpdate":false}').serialized).autoUpdate).toBe(false)
    expect(_roundTripForTest('{"autoUpdate":"no"}').config.autoUpdate).toBe(true)
    expect(_roundTripForTest('{"autoUpdate":true}').config.autoUpdate).toBe(true)
  })
})
