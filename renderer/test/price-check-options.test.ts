// 設定 › 查價「滑鼠懸停顯示物品」(PoE1 / PoE2 TradeItem 物品浮窗;PoE1 2026-10-15 起):選項、顯示條件、字串、掛點。
// renderer 測試是 node 環境(不掛 Vue),所以元件行為(實際畫面)另以無頭瀏覽器驗,見 docs/poe2-port-notes.md。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { HOVER_OPTIONS, hasItemHover } from '../src/web/settings/tabs/price-check-options'
import { defaultPriceCheck } from '../src/web/Config'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('itemHoverTooltip 設定選項', () => {
  it('三選一,值與 EE2 相同', () => {
    expect(HOVER_OPTIONS.map(o => o.value)).toEqual(['off', 'keybind', 'always'])
  })
  it('預設 keybind(SHIFT + 懸停,照 EE2)', () => {
    expect(defaultPriceCheck().itemHoverTooltip).toBe('keybind')
  })
  it('PoE1 與 PoE2 都顯示(PoE1 2026-10-15 起有浮窗)', () => {
    expect(hasItemHover('poe2')).toBe(true)
    expect(hasItemHover('poe1')).toBe(true)
  })
  it('中英文字串都有(鍵不得缺)', () => {
    for (const lang of ['en', 'cmn-Hant']) {
      const ppz = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz
      for (const k of ['item_hover', 'item_hover_hint', ...HOVER_OPTIONS.map(o => o.key.replace('ppz.', ''))]) {
        expect(typeof ppz[k], `${lang} ppz.${k}`).toBe('string')
        expect(ppz[k].length).toBeGreaterThan(0)
      }
    }
  })
  it('設定頁以 showItemHover 控制顯示、綁 itemHoverTooltip', () => {
    const vue = read('renderer/src/web/settings/tabs/PriceCheck.vue')
    expect(vue).toMatch(/v-if="showItemHover"/)
    expect(vue).toMatch(/pc\.itemHoverTooltip = o\.value/)
  })
})

describe('TradeItem 物品浮窗掛點', () => {
  it('tippy 掛 document.body(脫離 overflow 祖先),且有 exile-appraiser 註解', () => {
    const src = read('poe2/src/web/price-check/trade/TradeItem.vue')
    expect(src).toMatch(/appendTo: \(\) => document\.body/)
    expect(src).toMatch(/exile-appraiser: interactive 的 tippy/)
  })
  it('interactive / theme / placement 仍與 EE2 相同', () => {
    const src = read('poe2/src/web/price-check/trade/TradeItem.vue')
    expect(src).toMatch(/interactive: true/)
    expect(src).toMatch(/theme: "item-tooltip"/)
    expect(src).toMatch(/placement: "left"/)
  })
})

describe('PoE1 TradeItem 物品浮窗掛點', () => {
  it('tippy 設定與 PoE2 相同:interactive、item-tooltip、左側、掛 document.body、flip 後備', () => {
    const src = read('poe1/src/web/price-check/trade/TradeItem.vue')
    expect(src).toMatch(/interactive: true/)
    expect(src).toMatch(/theme: 'item-tooltip'/)
    expect(src).toMatch(/placement: 'left'/)
    expect(src).toMatch(/appendTo: \(\) => document\.body/)
    expect(src).toMatch(/fallbackPlacements: \['right', 'bottom', 'top'\]/)
  })
  it('TradeListing 長條與方塊都用 TradeItem', () => {
    const src = read('poe1/src/web/price-check/trade/TradeListing.vue')
    expect(src.match(/<trade-item /g)?.length).toBe(2)
    expect(src).toMatch(/layout="grid"/)
    expect(src).toMatch(/layout="list"/)
  })
})
