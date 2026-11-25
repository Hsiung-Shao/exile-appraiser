import { beforeAll, describe, expect, it } from 'vitest'

/**
 * PoE2 通用規則 planGeneric 的純函式測試(合成輸入)。
 * 實作:`scripts/poe2-season/lib.mjs`。
 */

let lib: any
beforeAll(async () => {
  lib = await import('../../scripts/poe2-season/lib.mjs')
})

const row = (str: string) => ({
  ref: 'Old # text',
  matchers: [{ string: str }],
  trade: { ids: { explicit: ['explicit.stat_1'] } }
})
const tradeStats = [{ id: 'explicit.stat_1', text: 'Old # text', type: 'explicit' }]

describe('planGeneric(S13)', () => {
  it('GGPK 新版只改繁中字時,補一筆 cmn-Hant 新寫法', () => {
    const ggpkOld = [{ key: 'k|1|f|0', en: 'Old # text', zh: '舊 # 文字' }]
    const ggpkNew = [{ key: 'k|1|f|0', en: 'Old # text', zh: '新 # 文字' }]
    const plan = lib.planGeneric({
      enStats: [row('Old # text')],
      zhStats: [row('舊 # 文字')],
      ggpkOld, ggpkNew, tradeStats
    })
    const hit = plan.adds.find((a: any) => a.lang === 'cmn-Hant' && a.ref === 'Old # text')
    expect(hit).toBeTruthy()
    expect(hit.matcher.string).toBe('新 # 文字')
  })

  it('新舊 GGPK 相同(只有一個版本)時 adds、replace、remove 皆為空', () => {
    const g = [{ key: 'k|1|f|0', en: 'Old # text', zh: '舊 # 文字' }]
    const plan = lib.planGeneric({
      enStats: [row('Old # text')],
      zhStats: [row('舊 # 文字')],
      ggpkOld: g, ggpkNew: g, tradeStats
    })
    expect(plan.adds).toEqual([])
    expect(plan.replace).toEqual([])
    expect(plan.remove).toEqual([])
  })
})
