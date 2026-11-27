/**
 * 查價面板 B 改版(2026-10-14)詞綴卡片分組純函式:可見詞綴依來源分「詞綴」/「偽屬性(總和)」兩張卡片。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { modCardOf, splitModCards } from '../src/web/price-panel/mod-cards'

const row = (tag: string, disabled = false) => ({ tag, disabled })

describe('詞綴卡片分組', () => {
  it('pseudo 歸偽屬性卡、其他來源歸詞綴卡,順序不變', () => {
    const a = row('explicit')
    const b = row('pseudo')
    const c = row('implicit')
    const d = row('pseudo', true)
    const e = row('fractured')
    const { mods, pseudo } = splitModCards([a, b, c, d, e])
    expect(mods.rows).toEqual([a, c, e])
    expect(pseudo.rows).toEqual([b, d])
  })

  it('已選數只算沒停用的列', () => {
    const { mods, pseudo } = splitModCards([row('explicit'), row('explicit', true), row('pseudo', true), row('pseudo')])
    expect([mods.selected, mods.rows.length]).toEqual([1, 2])
    expect([pseudo.selected, pseudo.rows.length]).toEqual([1, 2])
  })

  it('PoE1 群組列看 meta 的來源與停用狀態', () => {
    const g = { group: 'mercenary', meta: { tag: 'filter-group', disabled: false } }
    const gp = { group: 'x', meta: { tag: 'pseudo', disabled: true } }
    expect(modCardOf(g)).toBe('mods')
    expect(modCardOf(gp)).toBe('pseudo')
    const { mods, pseudo } = splitModCards([g, gp])
    expect([mods.selected, pseudo.selected]).toEqual([1, 0])
  })

  it('空清單兩張卡都沒有列', () => {
    const { mods, pseudo } = splitModCards([])
    expect([mods.rows.length, pseudo.rows.length, mods.selected, pseudo.selected]).toEqual([0, 0, 0, 0])
  })

  it('沒有來源標籤的列歸詞綴卡', () => {
    expect(modCardOf({ disabled: false })).toBe('mods')
  })
})

// Discord 回報(2026-11-26):地圖的更多地圖 / 更多綢帶偽屬性沒有來源詞綴,卡片寫「來自 0 條詞綴」
describe('偽屬性列「來自 N 條詞綴」', () => {
  it.each(['poe1', 'poe2'])('%s FilterModifier 只在有來源時顯示,0 條也不退回「偽屬性」標籤', (game) => {
    const src = readFileSync(resolve(__dirname, `../../${game}/src/web/price-check/filters/FilterModifier.vue`), 'utf8')
    expect(src).toContain(`v-if="showTag && tag === 'pseudo' && filter.sources.length"`)
    expect(src).toContain(`v-else-if="showTag && tag !== 'pseudo'"`)
  })
})
