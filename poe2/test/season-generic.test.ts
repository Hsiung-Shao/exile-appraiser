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

describe('planGeneric 規則細節', () => {
  const g = (en: string, zh: string) => [{ key: 'k|1|f|0', en, zh }]
  const ids = (x: any) => ({ ...x, trade: { ids: { explicit: ['explicit.stat_1'] } } })

  it('E1 英文變了 → 英文用 replace 換掉(英文是 GGPK 比對鍵),不加新句', () => {
    const plan = lib.planGeneric({
      enStats: [row('Old # text')], zhStats: [row('舊 # 文字')],
      ggpkOld: g('Old # text', '舊 # 文字'), ggpkNew: g('New # text', '舊 # 文字'), tradeStats
    })
    expect(plan.replace).toEqual([{ lang: 'en', ref: 'Old # text', from: 'Old # text', to: 'New # text' }])
    expect(plan.adds).toEqual([])
  })

  it('E2 繁中新句已經在同一條詞綴 → 不重複加', () => {
    const z = { ...row('舊 # 文字'), matchers: [{ string: '舊 # 文字' }, { string: '新 # 文字' }] }
    const plan = lib.planGeneric({
      enStats: [row('Old # text')], zhStats: [z],
      ggpkOld: g('Old # text', '舊 # 文字'), ggpkNew: g('Old # text', '新 # 文字'), tradeStats
    })
    expect(plan.adds).toEqual([])
  })

  it('R1 GGPK 拿掉的 key → 列在 remove(只報告)', () => {
    const plan = lib.planGeneric({
      enStats: [row('Old # text')], zhStats: [row('舊 # 文字')],
      ggpkOld: g('Old # text', '舊 # 文字'), ggpkNew: [], tradeStats
    })
    expect(plan.remove).toEqual([
      { lang: 'en', ref: 'Old # text', string: 'Old # text' },
      { lang: 'cmn-Hant', ref: 'Old # text', string: '舊 # 文字' }
    ])
    expect(plan.adds).toEqual([])
  })

  it('N1 沒有交易站 id 的詞綴 → 改了也不動(搜不到)', () => {
    const noId = (s: any) => ({ ...s, trade: { ids: {} } })
    const plan = lib.planGeneric({
      enStats: [noId(row('Old # text'))], zhStats: [noId(row('舊 # 文字'))],
      ggpkOld: g('Old # text', '舊 # 文字'), ggpkNew: g('New # text', '新 # 文字'), tradeStats
    })
    expect(plan).toEqual({ adds: [], replace: [], remove: [] })
  })

  it('A1 applyGenericReplace:英文換字串;新字串已存在時舊句改標 superseded', () => {
    const line = (matchers: any[]) => JSON.stringify({ ref: 'Old # text', better: 1, matchers, trade: { ids: { explicit: ['explicit.stat_1'] } } })
    const text = [line([{ string: 'Old # text' }]), line([{ string: 'Old # text' }, { string: 'New # text' }])].join('\n') + '\n'
    const out = lib.applyGenericReplace(text, 'en', [{ lang: 'en', ref: 'Old # text', from: 'Old # text', to: 'New # text' }])
    const [a, b] = out.trim().split('\n').map((l: string) => JSON.parse(l))
    expect(a.matchers).toEqual([{ string: 'New # text' }])
    expect(b.matchers).toEqual([{ string: 'Old # text', superseded: true }, { string: 'New # text' }])
  })
})
