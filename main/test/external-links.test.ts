// exile-appraiser:外部網址規則(`src/external-links.ts`):open-external / setWindowOpenHandler / will-navigate 共用。不啟動 Electron。
import { describe, expect, it } from 'vitest'
import { isAppNavigation, isExternalWebUrl } from '../src/external-links'

describe('isExternalWebUrl', () => {
  it('交易站 / poe.ninja / GitHub 的 http(s) 網址可交給系統瀏覽器', () => {
    expect(isExternalWebUrl('https://www.pathofexile.com/trade/search/Standard?q=%7B%7D')).toBe(true)
    expect(isExternalWebUrl('https://pathofexile.tw/trade/search/%E6%A8%99%E6%BA%96%E6%A8%A1%E5%BC%8F?q=%7B%7D')).toBe(true)
    expect(isExternalWebUrl('https://poe.ninja/economy/mercenaries/unique-armours/foo')).toBe(true)
    expect(isExternalWebUrl('http://127.0.0.1:1234/t/abc/')).toBe(true)
  })
  it('其他 scheme、壞網址、非字串一律拒絕', () => {
    for (const u of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'app://app/index.html',
      'ms-settings:', 'smb://host/share', 'not a url', '', '//www.pathofexile.com/trade']) {
      expect(isExternalWebUrl(u), u).toBe(false)
    }
    expect(isExternalWebUrl(undefined)).toBe(false)
    expect(isExternalWebUrl(42)).toBe(false)
    expect(isExternalWebUrl('https://x/' + 'a'.repeat(40_000))).toBe(false)
  })
})

describe('isAppNavigation', () => {
  const prod = ['app://app']
  const dev = ['app://app', 'http://localhost:5173/']
  it('app 自己的頁面放行(重新載入、開發模式 Vite)', () => {
    expect(isAppNavigation('app://app/index.html', prod)).toBe(true)
    expect(isAppNavigation('app://app/index.html#x', prod)).toBe(true)
    expect(isAppNavigation('http://localhost:5173/?x=1', dev)).toBe(true)
  })
  it('外部網站、其他 host / port、其他 scheme 攔下', () => {
    expect(isAppNavigation('https://www.pathofexile.com/trade', prod)).toBe(false)
    expect(isAppNavigation('https://www.pathofexile.com/trade', dev)).toBe(false)
    expect(isAppNavigation('http://localhost:5174/', dev)).toBe(false)
    expect(isAppNavigation('app://evil/index.html', prod)).toBe(false)
    expect(isAppNavigation('file:///C:/index.html', prod)).toBe(false)
    expect(isAppNavigation('garbage', prod)).toBe(false)
  })
})
