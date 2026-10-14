// 查價面板 B 改版 P4(2026-10-14):掛單「方塊 / 長條」設定(Q12)與兩代接線守門。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest, defaultPriceCheck } from '../src/web/Config'
import { DEFAULT_LISTING_LAYOUT, normListingLayout, withListingLayout } from '../src/web/price-panel/listing-layout'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('normListingLayout', () => {
  it('缺值或壞值回預設(一般方塊、通貨長條)', () => {
    for (const v of [undefined, null, 'grid', 3, [], {}]) expect(normListingLayout(v)).toEqual({ item: 'grid', bulk: 'list' })
    expect(DEFAULT_LISTING_LAYOUT).toEqual({ item: 'grid', bulk: 'list' })
  })
  it('逐欄正規化,一欄壞不影響另一欄', () => {
    expect(normListingLayout({ item: 'list', bulk: 'x' })).toEqual({ item: 'list', bulk: 'list' })
    expect(normListingLayout({ item: 7, bulk: 'grid' })).toEqual({ item: 'grid', bulk: 'grid' })
  })
  it('切換只改指定那一類且回傳新物件', () => {
    const cur = { item: 'grid', bulk: 'list' }
    const next = withListingLayout(cur, 'bulk', 'grid')
    expect(next).toEqual({ item: 'grid', bulk: 'grid' })
    expect(next).not.toBe(cur)
    expect(cur.bulk).toBe('list')
  })
})

describe('設定檔往返', () => {
  it('全新與舊設定檔沒有這欄時用預設並寫進檔', () => {
    expect(defaultPriceCheck().listingLayout).toEqual({ item: 'grid', bulk: 'list' })
    for (const raw of [null, '{"game":"poe1"}', '{"priceCheck":{"showSeller":"ign"}}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.priceCheck.listingLayout).toEqual({ item: 'grid', bulk: 'list' })
      expect(JSON.parse(serialized).priceCheck.listingLayout).toEqual({ item: 'grid', bulk: 'list' })
    }
  })
  it('一般物品與通貨分開記住', () => {
    const { config, serialized } = _roundTripForTest('{"priceCheck":{"listingLayout":{"item":"list","bulk":"grid"}}}')
    expect(config.priceCheck.listingLayout).toEqual({ item: 'list', bulk: 'grid' })
    expect(JSON.parse(serialized).priceCheck.listingLayout).toEqual({ item: 'list', bulk: 'grid' })
  })
  it('壞值逐欄回預設', () => {
    expect(_roundTripForTest('{"priceCheck":{"listingLayout":"list"}}').config.priceCheck.listingLayout).toEqual({ item: 'grid', bulk: 'list' })
    expect(_roundTripForTest('{"priceCheck":{"listingLayout":{"item":"list","bulk":1}}}').config.priceCheck.listingLayout).toEqual({ item: 'list', bulk: 'list' })
  })
  it('預設值物件不共用(改一份不影響下一份)', () => {
    const a = defaultPriceCheck(); a.listingLayout.item = 'list'
    expect(defaultPriceCheck().listingLayout.item).toBe('grid')
  })
})

const FILES = {
  poe1Listing: 'poe1/src/web/price-check/trade/TradeListing.vue',
  poe1Bulk: 'poe1/src/web/price-check/trade/TradeBulk.vue',
  poe2Listing: 'poe2/src/web/price-check/trade/TradeListing.vue',
  poe2Bulk: 'poe2/src/web/price-check/trade/TradeBulk.vue',
  poe2Item: 'poe2/src/web/price-check/trade/TradeItem.vue'
}

describe('兩代接線', () => {
  it('四個掛單元件都有方塊 / 長條切換、照類別讀設定、保留回報掛點', () => {
    for (const [k, f] of Object.entries(FILES)) {
      if (k === 'poe2Item') continue
      const src = read(f)
      expect(src, f).toContain('<listing-layout-toggle')
      expect(src, f).toMatch(new RegExp(`useListingLayout\\(["']${k.endsWith('Bulk') ? 'bulk' : 'item'}["']\\)`))
      expect(src, f).toContain('mode="trade"')
    }
  })
  it('改到的移植檔檔頭標註 B 改版', () => {
    for (const f of Object.values(FILES)) expect(read(f), f).toContain('2026-10-14 B 改版:呈現層已重寫')
  })
  it('通貨「用什麼買」改膠囊、只看在線開關沿用篩選狀態', () => {
    for (const f of [FILES.poe1Bulk, FILES.poe2Bulk]) {
      const src = read(f)
      expect(src, f).toContain('<listing-chip')
      expect(src, f).toContain('<listing-online-switch')
    }
    expect(read(FILES.poe1Bulk)).toMatch(/filters\.trade\.offline/)
    expect(read(FILES.poe2Bulk)).toMatch(/filters\.trade\.listingType/)
  })
  it('PoE2 每筆掛單在 TradeItem:長條仍是表格列、方塊是卡片,兩者都當浮窗目標', () => {
    const src = read(FILES.poe2Item)
    expect(src).toMatch(/<tr\s+v-if="layout !== 'grid'"\s+ref="target"/)
    expect(src).toMatch(/<div\s+v-else\s+ref="target"/)
  })
  it('PoE2 通貨圖示走 PoE2 自己的圖,PoE1 維持 /images/', () => {
    expect(read(FILES.poe2Bulk)).not.toMatch(/"\/images\/(exa|chaos|divine)\.png"/)
    expect(read(FILES.poe1Bulk)).not.toContain('/images/poe2/')
  })
  it('字串兩語都有', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const l = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz.listing
      for (const k of ['title', 'lowest', 'layout_group', 'layout_grid', 'layout_list', 'conditions', 'pay_with', 'online_only', 'stock', 'fulfill', 'market_ratio']) {
        expect(l?.[k], `${lang} ppz.listing.${k}`).toBeTruthy()
      }
      for (const c of ['exalted', 'chaos', 'divine']) expect(l?.currency?.[c], `${lang} ${c}`).toBeTruthy()
    }
  })
})
