// 設定 `startupToast`(啟動時顯示背景執行提示;Config.ts 五處:介面、預設、serialize、applyLoaded、host-config)
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'

describe('startupToast 設定檔往返', () => {
  it('全新 / 舊設定檔沒有這欄 → 預設開,且會寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.startupToast).toBe(true)
      expect(JSON.parse(serialized).startupToast).toBe(true)
    }
  })
  it('明確 false 才關;非布林值當成開', () => {
    expect(_roundTripForTest('{"startupToast":false}').config.startupToast).toBe(false)
    expect(JSON.parse(_roundTripForTest('{"startupToast":false}').serialized).startupToast).toBe(false)
    expect(_roundTripForTest('{"startupToast":0}').config.startupToast).toBe(true)
    expect(_roundTripForTest('{"startupToast":true}').config.startupToast).toBe(true)
  })
})
