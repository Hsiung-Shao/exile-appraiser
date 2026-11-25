// 2026-11-08 3.30 移除聖甲蟲:地圖數值區拿掉「更多聖甲蟲」列;舊存檔 / 分享碼帶這列照樣還原其餘列。
// 2026-11-26 3.30 地圖拿掉物品數量(Discord 回報):數量列換成輿圖掉落物;舊存檔的數量列同樣算進 missed。
import { describe, expect, it } from 'vitest'
import { loadAllPagesFor } from '../src/node'
import type { AlgoPage } from '../src/pages'
import { resolveState, type ShareState } from '../src/share'

const pages = loadAllPagesFor('poe1')
const mapNum = pages.find(p => p.id === 'map_numeric') as AlgoPage

describe('地圖數值區沒有更多聖甲蟲', () => {
  it('列只剩階級 / 輿圖掉落物 / 稀有度 / 群大小 / 通貨 / 地圖 / 命運卡 / 稀有度條件', () => {
    expect(mapNum.entries.map(e => e.id)).toEqual(['tier', 'atlas_drops', 'rarity', 'pack', 'currency', 'maps', 'divination', 'item_rarity_class'])
  })

  it('舊分享碼勾了更多聖甲蟲:其餘列照還原、聖甲蟲算進 missed', () => {
    const s: ShareState = {
      v: 2,
      game: 'poe1',
      mode: 'any',
      pages: {},
      sections: { map_mods: ['tier', 'scarabs'] },
      numeric: { map_mods: { tier: { min: 16 }, scarabs: { min: 50 } } },
      custom: [],
      excludes: []
    }
    const r = resolveState(s, pages)
    expect(r.picks.map_numeric).toEqual([mapNum.entries.findIndex(e => e.id === 'tier')])
    expect(r.missed).toBe(1)
    expect(r.values.map_numeric).toEqual({ tier: { min: 16 } })
    expect(r.unknownPages).toEqual([])
  })

  it('舊分享碼勾了物品數量:其餘列照還原、數量算進 missed', () => {
    const s: ShareState = {
      v: 2, game: 'poe1', mode: 'any', pages: {},
      sections: { map_mods: ['tier', 'quantity'] },
      numeric: { map_mods: { tier: { min: 16 }, quantity: { min: 80 } } },
      custom: [], excludes: []
    }
    const r = resolveState(s, pages)
    expect(r.missed).toBe(1)
    expect(r.values.map_numeric).toEqual({ tier: { min: 16 } })
  })

  it('輿圖掉落物 ≥80 片段:+81 命中、+79 不中', () => {
    const e = mapNum.entries.find(x => x.id === 'atlas_drops')!
    const re = new RegExp(e.fragment({ min: 80 }, 'zh')!)
    expect(re.test('輿圖掉落物: +81% (augmented)')).toBe(true)
    expect(re.test('輿圖掉落物: +79% (augmented)')).toBe(false)
  })
})
