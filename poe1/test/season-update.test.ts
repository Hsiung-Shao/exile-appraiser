import { describe, expect, it } from 'vitest'
import { toMatcherText, planStatText, planTradeText, planDeadIds, planItems, applyStatPlan, applyItemPlan } from '../../scripts/poe1-season/lib.mjs'

/**
 * 賽季更新腳本的純函式測試(合成輸入,不讀 data/)。
 * 規格見 `scripts/poe1-season/lib.mjs` 的介面說明。
 */

function toFile (rows: unknown[], eol = '\r\n'): string {
  return rows.map(r => JSON.stringify(r)).join(eol) + eol
}
function parseRows (text: string): any[] {
  return text.split(/\r?\n/).filter(l => l !== '').map(l => JSON.parse(l))
}
/** 攤平群組列,方便找 stat。 */
function flat (rows: any[]): any[] {
  return rows.flatMap(r => r.stats ?? [r])
}

function stat (ref: string, matchers: any[], ids: Record<string, string[]> = { explicit: ['explicit.stat_1'] }) {
  return { ref, better: 1, matchers, trade: { ids } }
}

describe('toMatcherText', () => {
  it('[A|B] 留 B、[A] 留 A', () => {
    expect(toMatcherText('[Foo|Bar] and [Baz]')).toBe('Bar and Baz')
  })
  it('{0} {0:+d} {} 都換成 #', () => {
    expect(toMatcherText('{0}% increased X')).toBe('#% increased X')
    expect(toMatcherText('{0:+d} to Life')).toBe('# to Life')
    expect(toMatcherText('{} items')).toBe('# items')
  })
  it('# 前的正負號被去掉', () => {
    expect(toMatcherText('+{0}% to X')).toBe('#% to X')
    expect(toMatcherText('{0:+d}% to X')).toBe('#% to X')
    expect(toMatcherText('+# to Life')).toBe('# to Life')
  })
  it('字面 \\n 兩個字元換成換行', () => {
    expect(toMatcherText('line1\\nline2')).toBe('line1\nline2')
  })
})

describe('planStatText / applyStatPlan', () => {
  const REF = '#% increased Rarity of Items found'
  const enRows = () => [
    stat('other', [{ string: 'other text' }], { explicit: ['explicit.stat_9'] }),
    stat(REF, [{ string: '#% increased Rarity of Items found' }, { string: '#% reduced Rarity of Items found', negate: true }]),
    stat('tail', [{ string: 'tail text' }], { explicit: ['explicit.stat_8'] })
  ]
  const zhRows = () => [
    stat('other', [{ string: '其他' }], { explicit: ['explicit.stat_9'] }),
    stat(REF, [{ string: '增加 #% 物品稀有度' }, { string: '減少 #% 物品稀有度', negate: true }]),
    stat('tail', [{ string: '尾' }], { explicit: ['explicit.stat_8'] })
  ]
  const ggpkOld = [{ key: 'k1', en: '{0}% increased Rarity of Items found', zh: '增加 {0}% 物品稀有度' }]
  const ggpkNew = [{ key: 'k1', en: '{0:+d}% to Item Rarity', zh: '{0:+d}%物品稀有度' }]

  it('改字時加上新 matcher 並保留舊的(en 與 cmn-Hant 各自拿到自己語言)', () => {
    const plan = planStatText({ enStats: enRows(), zhStats: zhRows(), ggpkOld, ggpkNew })
    const enFile = toFile(enRows())
    const zhFile = toFile(zhRows())
    const enOut = parseRows(applyStatPlan(enFile, 'en', { adds: plan.adds.filter((a: any) => a.lang === 'en') }))
    const zhOut = parseRows(applyStatPlan(zhFile, 'cmn-Hant', { adds: plan.adds.filter((a: any) => a.lang === 'cmn-Hant') }))

    expect(enOut[1].ref).toBe(REF)
    expect(enOut[1].matchers.map((m: any) => m.string)).toEqual([
      '#% increased Rarity of Items found', '#% reduced Rarity of Items found', '#% to Item Rarity'])
    expect(zhOut[1].matchers.map((m: any) => m.string)).toEqual([
      '增加 #% 物品稀有度', '減少 #% 物品稀有度', '#%物品稀有度'])
    // 其他列不被動到
    expect(enOut[0]).toEqual(enRows()[0])
    expect(zhOut[2]).toEqual(zhRows()[2])
  })

  it('比對舊文字不分大小寫', () => {
    const enStats = [stat(REF, [{ string: '#% INCREASED rarity of items found' }])]
    const plan = planStatText({ enStats, zhStats: [], ggpkOld, ggpkNew })
    expect(plan.adds.some((a: any) => a.lang === 'en' && a.ref === REF)).toBe(true)
  })

  it('減少型變體照抄 negate', () => {
    const enStats = [stat('Foo', [{ string: '#% increased Foo' }, { string: '#% reduced Foo', negate: true }])]
    const old = [
      { key: 'inc', en: '{0}% increased Foo', zh: null },
      { key: 'red', en: '{0}% reduced Foo', zh: null }
    ]
    const nw = [
      { key: 'inc', en: '{0}% increased Foo Amount', zh: null },
      { key: 'red', en: '{0}% reduced Foo Amount', zh: null }
    ]
    const plan = planStatText({ enStats, zhStats: [], ggpkOld: old, ggpkNew: nw })
    const out = parseRows(applyStatPlan(toFile(enStats), 'en', { adds: plan.adds }))
    const ms = out[0].matchers
    // 舊寫法留著但標成被取代(規格於實作中補上:正則頁不拿舊寫法當模板)
    expect(ms.slice(0, 2)).toEqual(enStats[0].matchers.map((m: any) => ({ ...m, superseded: true })))
    expect(ms[2]).toEqual({ string: '#% increased Foo Amount' })
    expect(ms[3]).toEqual({ string: '#% reduced Foo Amount', negate: true })
  })

  it('只改大小寫也要加上新寫法(解析器逐字比對)', () => {
    const enStats = [stat('Foo', [{ string: 'Deal damage #% faster' }])]
    const old = [{ key: 'a', en: 'Deal damage {0}% faster', zh: null }]
    const nw = [{ key: 'a', en: 'Deal damage {0}% [DamageFaster|Faster]', zh: null }]
    const plan = planStatText({ enStats, zhStats: [], ggpkOld: old, ggpkNew: nw })
    const file = applyStatPlan(toFile(enStats), 'en', { adds: plan.adds })
    expect(parseRows(file)[0].matchers).toEqual([
      { string: 'Deal damage #% faster', superseded: true }, { string: 'Deal damage #% Faster' }])
    // 再跑一次不重複加
    const again = planStatText({ enStats: parseRows(file), zhStats: [], ggpkOld: old, ggpkNew: nw })
    expect(again.adds).toEqual([])
  })

  it('交易站同一個 id 有兩句文字、已對上其中一句時不再加另一句', () => {
    const enStats = [stat('Area contains an additional Abyss', [{ string: 'Area contains an additional Abyss' }])]
    const tradeStats = [
      { id: 'explicit.stat_1', text: 'Area contains an additional Abyss', type: 'explicit' },
      { id: 'explicit.stat_1', text: 'Your Maps contain an additional Abyss', type: 'explicit' }
    ]
    const ggpkNew = [
      { key: 'a', en: 'Area contains an additional Abyss', zh: '區域含有 1 個額外深淵' },
      { key: 'b', en: 'Your Maps contain an additional Abyss', zh: '你的地圖含有 1 個額外深淵' }
    ]
    expect(planTradeText({ enStats, zhStats: [], tradeStats, ggpkNew }).adds).toEqual([])
  })

  it('id 的現行文字完全對不上時補上,並把舊的可當模板寫法標成被取代', () => {
    const enStats = [stat('#% increased Rarity of Items found', [
      { string: '#% increased Rarity of Items found' }, { string: '#% reduced Rarity of Items found', negate: true }])]
    const tradeStats = [{ id: 'explicit.stat_1', text: '+#% to Item Rarity', type: 'explicit' }]
    const ggpkNew = [{ key: 'n', en: '{0:+d}% to [PlayerItemRarity|Item Rarity]', zh: null }]
    const plan = planTradeText({ enStats, zhStats: [], tradeStats, ggpkNew })
    expect(parseRows(applyStatPlan(toFile(enStats), 'en', { adds: plan.adds }))[0].matchers).toEqual([
      { string: '#% increased Rarity of Items found', superseded: true },
      { string: '#% reduced Rarity of Items found', negate: true },
      { string: '#% to Item Rarity' }])
  })

  it('舊句在別的鍵仍沿用時不標成被取代', () => {
    const enStats = [stat('Foo', [{ string: '#% increased Foo' }])]
    const old = [{ key: 'a', en: '{0}% increased Foo', zh: null }, { key: 'b', en: '{0}% increased Foo', zh: null }]
    const nw = [{ key: 'a', en: '{0}% increased Foo Amount', zh: null }, { key: 'b', en: '{0}% increased Foo', zh: null }]
    const plan = planStatText({ enStats, zhStats: [], ggpkOld: old, ggpkNew: nw })
    const ms = parseRows(applyStatPlan(toFile(enStats), 'en', { adds: plan.adds }))[0].matchers
    expect(ms).toEqual([{ string: '#% increased Foo' }, { string: '#% increased Foo Amount' }])
  })

  it('新文字已存在時不重複加(第二次 plan 無新增、檔案字串不變)', () => {
    const plan1 = planStatText({ enStats: enRows(), zhStats: zhRows(), ggpkOld, ggpkNew })
    const enOut = applyStatPlan(toFile(enRows()), 'en', { adds: plan1.adds.filter((a: any) => a.lang === 'en') })
    const zhOut = applyStatPlan(toFile(zhRows()), 'cmn-Hant', { adds: plan1.adds.filter((a: any) => a.lang === 'cmn-Hant') })
    const plan2 = planStatText({ enStats: parseRows(enOut), zhStats: parseRows(zhOut), ggpkOld, ggpkNew })
    expect(plan2.adds).toEqual([])
    expect(applyStatPlan(enOut, 'en', { adds: plan2.adds })).toBe(enOut)
  })

  it('增加對到減少時拒收', () => {
    const enStats = [stat('Bar', [{ string: '#% increased Bar' }])]
    const zhStats = [stat('Bar', [{ string: '增加 #% 巴' }])]
    const old = [{ key: 'k', en: '{0}% increased Bar', zh: '增加 {0}% 巴' }]
    const nw = [{ key: 'k', en: '{0}% reduced Bar', zh: '減少 {0}% 巴' }]
    const plan = planStatText({ enStats, zhStats, ggpkOld: old, ggpkNew: nw })
    expect(plan.adds).toEqual([])
    expect(plan.rejects.some((r: any) => r.ref === 'Bar' && r.reason === 'direction')).toBe(true)
  })
})

describe('planDeadIds / applyStatPlan', () => {
  const deadRows = () => [
    { resolve: { strat: 'trivial-merge' }, stats: [
      stat('+# to Alpha', [{ string: '# to Alpha' }], { explicit: ['explicit.stat_dead'], implicit: ['implicit.stat_live'] })
    ] },
    stat('Beta', [{ string: 'Beta' }], { explicit: ['explicit.stat_dead'] })
  ]

  it('失效 id 有唯一同文字替代時替換', () => {
    const tradeStats = [
      { id: 'explicit.stat_new', text: '+# to Alpha', type: 'explicit' },
      { id: 'implicit.stat_live', text: 'something else', type: 'implicit' }
    ]
    const plan = planDeadIds({ enStats: flat(deadRows()), tradeStats })
    expect(plan.replace['explicit.stat_dead']).toBe('explicit.stat_new')
    expect(plan.remove).not.toContain('explicit.stat_dead')
    const out = applyStatPlan(toFile(deadRows()), 'en', { replace: plan.replace, remove: plan.remove })
    expect(out).not.toContain('explicit.stat_dead')
    expect(parseRows(out)[0].stats[0].trade.ids.explicit).toEqual(['explicit.stat_new'])
    // 未失效的 id 不動
    expect(parseRows(out)[0].stats[0].trade.ids.implicit).toEqual(['implicit.stat_live'])
  })

  it('失效 id 沒有替代時移除,modType 空了就刪鍵', () => {
    const rows = [stat('Gamma', [{ string: 'Gamma' }], { explicit: ['explicit.stat_dead'], implicit: ['implicit.stat_live'] })]
    const tradeStats = [
      { id: 'implicit.stat_live', text: 'x', type: 'implicit' },
      // 同文字但 type 不同,不能拿來當替代
      { id: 'implicit.stat_other', text: 'Gamma', type: 'implicit' }
    ]
    const plan = planDeadIds({ enStats: rows, tradeStats })
    expect(plan.remove).toContain('explicit.stat_dead')
    expect(plan.replace).toEqual({})
    const out = parseRows(applyStatPlan(toFile(rows), 'en', { replace: plan.replace, remove: plan.remove }))
    expect(out[0].trade.ids).toEqual({ implicit: ['implicit.stat_live'] })
    expect('explicit' in out[0].trade.ids).toBe(false)
  })

  it('同文字有兩個替代時不替換、移除並記 ambiguous', () => {
    const rows = [stat('Delta', [{ string: 'Delta' }], { explicit: ['explicit.stat_dead'] })]
    const tradeStats = [
      { id: 'explicit.stat_a', text: 'Delta', type: 'explicit' },
      { id: 'explicit.stat_b', text: 'Delta', type: 'explicit' }
    ]
    const plan = planDeadIds({ enStats: rows, tradeStats })
    expect(plan.replace['explicit.stat_dead']).toBeUndefined()
    expect(plan.remove).toContain('explicit.stat_dead')
    expect(plan.rejects.some((r: any) => r.id === 'explicit.stat_dead' && r.reason === 'ambiguous')).toBe(true)
  })
})

describe('planItems / applyItemPlan', () => {
  const row = (name: string, refName: string, tradeTag: string, icon = 'https://web.poecdn.com/old.png') =>
    ({ name, refName, namespace: 'ITEM', tradeTag, exchangeable: true, icon })
  const enRows = () => [row('Coin of Power', 'Coin of Power', 'coin-of-power'), row('Existing Item', 'Existing Item', 'existing')]
  const zhRows = () => [row('力量硬幣', 'Coin of Power', 'coin-of-power'), row('既有物品', 'Existing Item', 'existing')]
  const baseOld = [{ path: 'p1', en: 'Coin of Power', zh: '力量硬幣' }, { path: 'p4', en: 'Existing Item', zh: '既有物品' }]
  const baseNew = [
    { path: 'p1', en: 'Soul Core of Might', zh: '力量靈魂核心' },
    { path: 'p2', en: 'Not On Trade', zh: '交易站沒有' },
    { path: 'p3', en: 'Abyss Thread', zh: '深淵絲線' },
    { path: 'p4', en: 'Existing Item', zh: '既有物品' }
  ]
  const tradeStatic = [
    { id: 'soul-core-of-might', text: 'Soul Core of Might', image: '/gen/image/might.png' },
    { id: 'abyss-thread', text: 'Abyss Thread', image: '/gen/image/thread.png' }
  ]
  const plan = () => planItems({ enItems: enRows(), baseOld, baseNew, tradeStatic })

  it('改名物品更新 refName 與 tradeTag,cmn-Hant 的 name 取新版繁中', () => {
    const p = plan()
    expect(p.renames).toEqual([{ from: 'Coin of Power', to: 'Soul Core of Might', zh: '力量靈魂核心', tradeTag: 'soul-core-of-might' }])
    const enOut = parseRows(applyItemPlan(toFile(enRows()), 'en', { renames: p.renames }))
    const zhOut = parseRows(applyItemPlan(toFile(zhRows()), 'cmn-Hant', { renames: p.renames }))
    expect(enOut.map((r: any) => r.refName)).not.toContain('Coin of Power')
    expect(enOut[0]).toMatchObject({ name: 'Soul Core of Might', refName: 'Soul Core of Might', tradeTag: 'soul-core-of-might' })
    expect(zhOut[0]).toMatchObject({ name: '力量靈魂核心', refName: 'Soul Core of Might', tradeTag: 'soul-core-of-might' })
    // 沒改名的列不動
    expect(enOut[1]).toEqual(enRows()[1])
    expect(zhOut[1]).toEqual(zhRows()[1])
  })

  it('交易站沒有的新物品不加,有的接在檔尾', () => {
    const p = plan()
    expect(p.adds.map((a: any) => a.refName)).toEqual(['Abyss Thread'])
    expect(p.adds[0]).toMatchObject({ zh: '深淵絲線', tradeTag: 'abyss-thread', icon: 'https://web.poecdn.com/gen/image/thread.png' })
    const enOut = parseRows(applyItemPlan(toFile(enRows()), 'en', { adds: p.adds }))
    const zhOut = parseRows(applyItemPlan(toFile(zhRows()), 'cmn-Hant', { adds: p.adds }))
    expect(enOut.at(-1)).toEqual(row('Abyss Thread', 'Abyss Thread', 'abyss-thread', 'https://web.poecdn.com/gen/image/thread.png'))
    expect(zhOut.at(-1)).toEqual(row('深淵絲線', 'Abyss Thread', 'abyss-thread', 'https://web.poecdn.com/gen/image/thread.png'))
    expect(enOut.map((r: any) => r.refName)).not.toContain('Not On Trade')
  })
})

describe('寫檔行尾', () => {
  for (const [label, eol] of [['CRLF', '\r\n'], ['LF', '\n']] as const) {
    it(`${label} 檔只重寫有變動的列,行尾與檔尾換行保留`, () => {
      const rows = [
        stat('a', [{ string: 'a text' }], { explicit: ['explicit.stat_1'] }),
        stat('b', [{ string: 'b text' }], { explicit: ['explicit.stat_2'] }),
        stat('c', [{ string: 'c text' }], { explicit: ['explicit.stat_3'] })
      ]
      const text = toFile(rows, eol)
      const out = applyStatPlan(text, 'en', { adds: [{ lang: 'en', ref: 'b', matcher: { string: 'b new' } }] })
      const lines = out.split(eol)
      expect(lines.length).toBe(4)
      expect(lines[3]).toBe('')
      expect(lines[0]).toBe(JSON.stringify(rows[0]))
      expect(lines[2]).toBe(JSON.stringify(rows[2]))
      expect(JSON.parse(lines[1]).matchers).toEqual([{ string: 'b text' }, { string: 'b new' }])
      // 沒有混入另一種行尾
      const other = eol === '\r\n' ? /(?<!\r)\n/ : /\r/
      expect(other.test(out)).toBe(false)
    })
  }

  it('沒有變動時整份檔案逐字相同', () => {
    const text = toFile([stat('a', [{ string: 'a' }])])
    expect(applyStatPlan(text, 'en', {})).toBe(text)
  })
})
