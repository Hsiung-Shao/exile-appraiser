// 交易站網頁的開啟方式(trade-site.ts)與拆粉排行移進設定視窗後的設定檔相容(dustDockRatio 舊鍵)。
import { describe, expect, it } from 'vitest'
import { tradeSiteVia } from '../src/web/trade-site'
import { _roundTripForTest } from '../src/web/Config'

describe('tradeSiteVia(查價「交易」鈕、錯誤框「瀏覽器」、拆粉排行「交易 ↗」共用)', () => {
  it('預設(builtinBrowser 關)= 系統瀏覽器,Electron / 預覽 / 純瀏覽器都一樣', () => {
    expect(tradeSiteVia(false, true)).toBe('external')
    expect(tradeSiteVia(false, false)).toBe('external')
  })
  it('只有 builtinBrowser 開且在 Electron 內才開內建視窗', () => {
    expect(tradeSiteVia(true, true)).toBe('builtin')
    expect(tradeSiteVia(true, false)).toBe('external')
  })
  it('設定檔預設 builtinBrowser = false(設定頁不提供這個選項)', () => {
    expect(_roundTripForTest(null).config.priceCheck.builtinBrowser).toBe(false)
  })
})

describe('dustDockRatio(WP-Q 拆粉停靠比例)已移除', () => {
  it('舊設定檔仍有此鍵:照常載入、其他欄位不受影響,存檔不再寫出', () => {
    const { config, serialized } = _roundTripForTest('{"game":"poe1","realm":"tw","dustDockRatio":33,"autoUpdate":false}')
    expect(config.game).toBe('poe1')
    expect(config.realm).toBe('tw')
    expect(config.autoUpdate).toBe(false)
    expect('dustDockRatio' in config).toBe(false)
    expect(JSON.parse(serialized)).not.toHaveProperty('dustDockRatio')
  })
  it('壞值(字串 / null)也不影響載入', () => {
    for (const v of ['"x"', 'null', '1e999']) {
      const { serialized } = _roundTripForTest(`{"dustDockRatio":${v},"theme":"light"}`)
      expect(JSON.parse(serialized).theme).toBe('light')
      expect(JSON.parse(serialized)).not.toHaveProperty('dustDockRatio')
    }
  })
})
