// 2026-10-06:查價面板旁「相關物品」大小(使用者回報字太小)。設定 `relatedItemsScale` + 外層 CSS zoom。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import {
  RELATED_SCALE_DEFAULT, RELATED_SCALE_MAX, RELATED_SCALE_MIN, normRelatedItemsScale, relatedItemsZoom
} from '../src/web/related-items-scale'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('normRelatedItemsScale / relatedItemsZoom', () => {
  it('缺 / 壞值 → 預設 100;超出範圍夾回;取整', () => {
    for (const v of [undefined, null, 'x', NaN, Infinity, {}]) expect(normRelatedItemsScale(v)).toBe(RELATED_SCALE_DEFAULT)
    expect(normRelatedItemsScale(10)).toBe(RELATED_SCALE_MIN)
    expect(normRelatedItemsScale(999)).toBe(RELATED_SCALE_MAX)
    expect(normRelatedItemsScale(123.6)).toBe(124)
  })
  it('100% = APT 原本大小(16 / 13 ≈ 1.23,與 App.vue LEGACY_FS_SCALE 同值)', () => {
    expect(relatedItemsZoom(100)).toBe(1.23)
    expect(relatedItemsZoom(200)).toBe(2.46)
    expect(relatedItemsZoom(70)).toBe(0.86) // 取到小數兩位
    expect(relatedItemsZoom(undefined)).toBe(1.23)
    expect(read('renderer/src/web/App.vue')).toMatch(/const LEGACY_FS_SCALE = 1\.23/)
  })
})

describe('設定檔往返', () => {
  it('全新 / 舊設定檔沒有這欄 → 100,且會寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.relatedItemsScale).toBe(100)
      expect(JSON.parse(serialized).relatedItemsScale).toBe(100)
    }
  })
  it('合法值保留、壞值回預設、超出夾回', () => {
    expect(_roundTripForTest('{"relatedItemsScale":150}').config.relatedItemsScale).toBe(150)
    expect(_roundTripForTest('{"relatedItemsScale":"big"}').config.relatedItemsScale).toBe(100)
    expect(_roundTripForTest('{"relatedItemsScale":500}').config.relatedItemsScale).toBe(200)
  })
})

describe('接線', () => {
  it('App.vue 兩個擺放位置都套 zoom', () => {
    const app = read('renderer/src/web/App.vue')
    expect(app).toMatch(/relatedStyle: computed\(\(\) => \(\{ zoom: String\(relatedItemsZoom\(AppConfig\(\)\.relatedItemsScale\)\) \}\)\)/)
    expect(app.match(/:style="relatedStyle"/g)?.length).toBe(2)
  })
  it('可讀性:物品名稱不再用邊框色(text-gray-600 → --ink-2);overlay 外層是 .bg-host 跟著背景走', () => {
    const app = read('renderer/src/web/App.vue')
    expect(app).toMatch(/:is\(\.related-host, \.related-inline\) \.text-gray-600 \{\s*color: var\(--ink-2\);/)
    expect(app).toMatch(/class="related-host bg-host pointer-events-auto"/)
    // 移植檔維持上游 class(要改色改外層 / token,不改移植檔)
    for (const f of ['poe1/src/web/price-check/related-items/RelatedItems.vue', 'poe2/src/web/price-check/related-items/RelatedItems.vue']) {
      expect(read(f)).toContain('text-gray-600')
    }
  })
  it('設定 › 查價「面板顯示」有滑桿(只在國際服)、字串兩語都有', () => {
    const tab = read('renderer/src/web/settings/tabs/PriceCheck.vue')
    expect(tab).toMatch(/<div v-if="showVolume" class="srow">\s*<span class="k">\{\{ t\('ppz\.related_items_scale'\) \}\}/)
    expect(tab).toContain('v-model.number="config.relatedItemsScale"')
    for (const lang of ['cmn-Hant', 'en']) {
      const ppz = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz
      expect(ppz.related_items_scale).toBeTruthy()
      expect(ppz.related_items_scale_hint).toBeTruthy()
    }
  })
})
