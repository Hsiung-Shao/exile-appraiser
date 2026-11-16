import { describe, expect, it } from 'vitest'
import { toMatcherText, planStatText, planTradeText, planDeadIds, planItems, applyStatPlan, applyItemPlan, planUniques, planTradeBases, planSupportGemNames, planGems, planMinionDoubled, planRandomSkillGem, planExtraZh, planNewStats, planGrantsSkill, planFillIds, planEffectStats, planTypeIds, planRoomNames, planGrownPassives, betterOf, BETTER_OVERRIDES } from '../../scripts/poe1-season/lib.mjs'

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

  it('組合句只差大小寫:子句在 GGPK 改了大小寫才補交易站那句', () => {
    const REF = 'While a Boss is in your Presence, Bleeding you inflict deals Damage #% faster'
    const enStats = [stat(REF, [{ string: REF }], { implicit: ['implicit.stat_1'] })]
    const tradeStats = [{ id: 'implicit.stat_1', text: REF.replace('faster', 'Faster'), type: 'implicit' }]
    const ggpkOld = [{ key: 'c', en: 'Bleeding you inflict deals Damage {0}% faster', zh: null }]
    const ggpkNew = [{ key: 'c', en: 'Bleeding you inflict deals Damage {0}% [DamageFaster|Faster]', zh: null }]
    const plan = planTradeText({ enStats, zhStats: [], tradeStats, ggpkNew, ggpkOld })
    expect(parseRows(applyStatPlan(toFile(enStats), 'en', { adds: plan.adds }))[0].matchers).toEqual([
      { string: REF, superseded: true }, { string: REF.replace('faster', 'Faster') }])
    // 沒有 GGPK 子句改字的證據(交易站自己的大小寫習慣)→ 不動
    expect(planTradeText({ enStats, zhStats: [], tradeStats, ggpkNew: ggpkOld, ggpkOld }).adds).toEqual([])
  })

  it('舊句搬到新鍵仍存在時不標成被取代', () => {
    const enStats = [stat('Foo', [{ string: '#% increased Foo in Area' }])]
    const old = [{ key: 'a', en: '{0}% increased Foo in Area', zh: null }]
    const nw = [{ key: 'a', en: '{0}% increased Foo', zh: null }, { key: 'b', en: '{0}% increased Foo in Area', zh: null }]
    const plan = planStatText({ enStats, zhStats: [], ggpkOld: old, ggpkNew: nw })
    expect(parseRows(applyStatPlan(toFile(enStats), 'en', { adds: plan.adds }))[0].matchers).toEqual([
      { string: '#% increased Foo in Area' }, { string: '#% increased Foo' }])
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

describe('planUniques / applyItemPlan', () => {
  const enRows = () => [
    { name: 'Basalt Flask', refName: 'Basalt Flask', namespace: 'ITEM' },
    { name: 'Old Unique', refName: 'Old Unique', namespace: 'UNIQUE', unique: { base: 'Basalt Flask' } }
  ]
  const zhRows = () => [
    { name: '石化藥劑', refName: 'Basalt Flask', namespace: 'ITEM' },
    { name: '舊傳奇', refName: 'Old Unique', namespace: 'UNIQUE', unique: { base: 'Basalt Flask' } }
  ]
  const tradeItems = [
    { name: 'New Unique', type: 'Basalt Flask', flags: { unique: true } },
    { name: 'Two Base Unique', type: 'Missing Base', flags: { unique: true } },
    { name: 'Two Base Unique', type: 'Basalt Flask', flags: { unique: true } },
    { name: 'Old Unique', type: 'Other Base', flags: { unique: true }, disc: 'legacy' },
    { name: 'No Base Unique', type: 'Missing Base', flags: { unique: true } },
    { name: 'No Zh Unique', type: 'Basalt Flask', flags: { unique: true } },
    { type: 'Basalt Flask' }
  ]
  const words = [{ en: 'New Unique', zh: '新傳奇' }, { en: 'Two Base Unique', zh: '雙底材' }, { en: 'No Base Unique', zh: '沒底材' }]

  it('交易站新傳奇加到檔尾;已有的名稱、缺底材、缺繁中名不加並列入拒收', () => {
    const p = planUniques({ enItems: enRows(), tradeItems, words })
    expect(p.adds).toEqual([{ refName: 'New Unique', zh: '新傳奇', base: 'Basalt Flask' }, { refName: 'Two Base Unique', zh: '雙底材', base: 'Basalt Flask' }])
    expect(p.rejects.map((r: any) => r.id)).toEqual(['Two Base Unique', 'No Base Unique', 'No Zh Unique'])
    const enOut = parseRows(applyItemPlan(toFile(enRows()), 'en', { uniques: p.adds }))
    const zhOut = parseRows(applyItemPlan(toFile(zhRows()), 'cmn-Hant', { uniques: p.adds }))
    expect(enOut.at(-2)).toEqual({ name: 'New Unique', refName: 'New Unique', namespace: 'UNIQUE', unique: { base: 'Basalt Flask' } })
    expect(zhOut.at(-2)).toEqual({ name: '新傳奇', refName: 'New Unique', namespace: 'UNIQUE', unique: { base: 'Basalt Flask' } })
    // 重跑不重複加
    expect(planUniques({ enItems: enOut, tradeItems, words }).adds).toEqual([])
  })
})

describe('planTradeBases / applyItemPlan', () => {
  const enRows = () => [{ name: 'Cobalt Jewel', refName: 'Cobalt Jewel', namespace: 'ITEM', craftable: { category: 'Jewel' } }]
  const baseOld = [{ path: 'j1', en: 'Cobalt Jewel', zh: '鈷藍珠寶' }, { path: 'old', en: 'Old Missing', zh: '舊缺口' }]
  const baseNew = [...baseOld, { path: 'j2', en: 'Mycelium Core', zh: '菌潮核心' }, { path: 'v1', en: "Gladiator's Heart", zh: '角鬥士之心' },
    { path: 'a1', en: 'New Plate', zh: '新鎧甲' }, { path: 'x1', en: 'Not On Trade', zh: '交易站沒有' }]
  const tradeItems = [
    { type: 'Cobalt Jewel', group: 'jewel' }, { type: 'Mycelium Core', group: 'jewel' },
    { type: 'Mycelium Core', name: 'Putrid Seed', flags: { unique: true }, group: 'jewel' },
    { type: "Gladiator's Heart", group: 'viscera' }, { type: 'New Plate', group: 'armour' }, { type: 'Old Missing', group: 'jewel' }
  ]

  it('GGPK 新增且交易站列出的底材才加;珠寶帶類別、臟器不帶;沒規則的群組拒收', () => {
    const p = planTradeBases({ enItems: enRows(), baseOld, baseNew, tradeItems })
    expect(p.adds).toEqual([{ refName: 'Mycelium Core', zh: '菌潮核心', category: 'Jewel' }, { refName: "Gladiator's Heart", zh: '角鬥士之心', category: null }])
    expect(p.rejects.map((r: any) => r.id)).toEqual(['New Plate'])
    const zhOut = parseRows(applyItemPlan(toFile(enRows()), 'cmn-Hant', { bases: p.adds }))
    expect(zhOut.slice(-2)).toEqual([
      { name: '菌潮核心', refName: 'Mycelium Core', namespace: 'ITEM', craftable: { category: 'Jewel' } },
      { name: '角鬥士之心', refName: "Gladiator's Heart", namespace: 'ITEM' }
    ])
    const enOut = parseRows(applyItemPlan(toFile(enRows()), 'en', { bases: p.adds }))
    expect(planTradeBases({ enItems: enOut, baseOld, baseNew, tradeItems }).adds).toEqual([])
  })
})

describe('方向校正(BETTER_OVERRIDES)', () => {
  it('指定的詞綴:新增時用指定方向,既有資料列也會被改;沒指定的不動;重跑不再變', () => {
    expect(betterOf('#% reduced Mana Cost of Attacks')).toBe(1)
    expect(betterOf('+# Physical Damage taken from Hits per Level')).toBe(-1)
    const rows = [stat('+# Physical Damage taken from Hits per Level', [{ string: 'x' }]), stat('#% reduced Something', [{ string: 'y' }])]
    const once = applyStatPlan(toFile(rows), 'en', { better: BETTER_OVERRIDES })
    expect(parseRows(once).map((r: any) => r.better)).toEqual([-1, 1])
    expect(applyStatPlan(once, 'en', { better: BETTER_OVERRIDES })).toBe(once)
  })
})

describe('planGrantsSkill / applyStatPlan', () => {
  const REF = 'Grants Level # Thirst for Blood Skill'
  const en = () => [stat(REF, [{ string: REF }], {}), stat('Grants Level # Determination Skill', [{ string: 'Grants Level # Determination Skill' }]),
    stat('Grants Level # No Such Skill', [{ string: 'x' }]), stat('Grants Level # A Skill\nSecond line', [{ string: 'y' }])]
  const zh = () => [stat(REF, [{ string: '獲得等級 # 的嗜血技能' }], {}), stat('Grants Level # Determination Skill', [{ string: '獲得等級 # 的堅定技能' }]),
    stat('Grants Level # No Such Skill', [{ string: 'x' }])]
  const skills = [{ en: 'Thirst for Blood', zh: '嗜血' }, { en: 'Determination', zh: '堅定' }, { en: 'Determination', zh: '瓦爾．堅定' }, { en: 'A', zh: '甲' }]
  const template = { en: 'Grants Level {1} {0}', zh: '賦予等級 {1} 的 {0}' }

  it('句型 + 技能名的新句加進去、舊句標 superseded;瓦爾同名取原版;找不到名字拒收;多行不處理;重跑為空', () => {
    const p = planGrantsSkill({ enStats: en(), zhStats: zh(), skills, template })
    expect(p.rejects.map((r: any) => r.ref)).toEqual(['Grants Level # No Such Skill'])
    const zhOut = parseRows(applyStatPlan(toFile(zh()), 'cmn-Hant', { adds: p.adds }))
    expect(zhOut[0].matchers).toEqual([{ string: '獲得等級 # 的嗜血技能', superseded: true }, { string: '賦予等級 # 的 嗜血' }])
    expect(zhOut[1].matchers[1]).toEqual({ string: '賦予等級 # 的 堅定' })
    const enOut = parseRows(applyStatPlan(toFile(en()), 'en', { adds: p.adds }))
    expect(enOut[0].matchers).toEqual([{ string: REF, superseded: true }, { string: 'Grants Level # Thirst for Blood' }])
    expect(enOut[3].matchers).toEqual([{ string: 'y' }])
    expect(planGrantsSkill({ enStats: enOut, zhStats: zhOut, skills, template }).adds).toEqual([])
    expect(planGrantsSkill({ enStats: en(), zhStats: zh(), skills, template: undefined }).adds).toEqual([])
  })
})

describe('planFillIds / applyStatPlan', () => {
  it('沒有 id 的詞綴補同文字的 id;已有 id 的只加 effect_ 新 id(舊 id 留著);用掉的 id、被取代的舊句不算;重跑為空', () => {
    const rows = [
      stat('Grants Level # Foo Skill', [{ string: 'Grants Level # Foo Skill', superseded: true }, { string: 'Grants Level # Foo' }], {}),
      stat('Has Ids', [{ string: 'Grants Level # Bar' }]),
      stat('Taken', [{ string: 'Used Text' }], {}),
      stat('Owner', [{ string: 'z' }], { explicit: ['explicit.stat_9'] })
    ]
    const tradeStats = [
      { id: 'explicit.effect_1', text: 'Grants Level # Foo' }, { id: 'implicit.effect_1', text: 'Grants Level # Foo' },
      { id: 'explicit.stat_7', text: 'Grants Level # Foo Skill' }, { id: 'explicit.effect_2', text: 'Grants Level # Bar' },
      { id: 'explicit.stat_9', text: 'Used Text' }, { id: 'pseudo.x', text: 'Grants Level # Foo' }
    ]
    const fill = planFillIds({ enStats: rows, tradeStats })
    // 2026-11-15 苦夢:3.30 物品的輔助寶石詞綴只索引在 effect_ 新 id,舊 id 搜尋 0 筆 → 兩個都送
    expect(fill).toEqual({
      'Grants Level # Foo Skill': { explicit: ['explicit.stat_7', 'explicit.effect_1'], implicit: ['implicit.effect_1'] },
      'Has Ids': { explicit: ['explicit.effect_2'] }
    })
    const out = parseRows(applyStatPlan(toFile(rows), 'en', { fill }))
    expect(out[0].trade.ids).toEqual(fill['Grants Level # Foo Skill'])
    expect(out[1].trade.ids).toEqual({ explicit: ['explicit.stat_1', 'explicit.effect_2'] })
    expect(planFillIds({ enStats: out, tradeStats })).toEqual({})
  })
})

describe('planEffectStats(規則 15)', () => {
  const strings = {
    ModGrantsEffect: { en: 'Grants {0}', zh: '賦予 {0}' },
    ModGrantsEffectWithLevel: { en: 'Grants Level {1} {0}', zh: '賦予等級 {1} 的 {0}' },
    ModGrantsSupportEffectWithLevel: { en: 'Socketed Gems are Supported by Level {1} {0}', zh: '插槽中的寶石被等級 {1} 的 {0} 輔助' }
  }
  const skills = [{ en: 'Foo', zh: '甲' }, { en: 'Summon Bar', zh: '召喚乙' }, { en: 'Twin', zh: '丙' }, { en: 'Twin', zh: '丁' }]
  const supports = [{ en: 'Awakened Baz Support', zh: '覺醒．戊輔助' }, { en: 'Old Qux Support', zh: '己輔助' }]
  const tradeStats = [
    { id: 'explicit.effect_1', text: 'Grants Level # Foo' }, { id: 'implicit.effect_1', text: 'Grants Level # Foo' },
    { id: 'explicit.effect_2', text: 'Grants Summon Bar' },
    { id: 'explicit.effect_3', text: 'Socketed Gems are Supported by Level # Awakened Baz Support' },
    { id: 'explicit.effect_4', text: 'Grants Level # Twin' },
    { id: 'explicit.effect_5', text: 'Grants Level # Used' },
    { id: 'explicit.effect_6', text: 'Socketed Gems are Supported by Level # Old Qux Support' },
    { id: 'explicit.stat_9', text: 'Grants Level # Other' }
  ]

  it('資料沒有的 effect_ 詞綴由句型 + 技能 / 寶石名新增;已有舊句的詞綴只加新寫法;名稱不唯一拒收', () => {
    const enStats = [
      stat('Grants Summon Bar Skill', [{ string: 'Grants Summon Bar Skill' }]),
      stat('Used', [{ string: 'Grants Level # Used' }], { explicit: ['explicit.effect_5'] }),
      stat('Socketed Gems are Supported by Level # Old Qux', [{ string: 'Socketed Gems are Supported by Level # Old Qux' }], {})
    ]
    const zhStats = [stat('Grants Summon Bar Skill', [{ string: '獲得召喚乙技能' }]), stat('Used', [{ string: 'x' }]), stat('Socketed Gems are Supported by Level # Old Qux', [{ string: '插槽中寶石被等級 # 的己輔助' }], {})]
    const plan = planEffectStats({ enStats, zhStats, tradeStats, skills, supports, strings })
    expect(plan.newStats.map((s: any) => [s.ref, s.ids, s.en[0].string, s.zh[0].string])).toEqual([
      ['Grants Level # Foo', { explicit: ['explicit.effect_1'], implicit: ['implicit.effect_1'] }, 'Grants Level # Foo', '賦予等級 # 的 甲'],
      ['Socketed Gems are Supported by Level # Awakened Baz Support', { explicit: ['explicit.effect_3'] }, 'Socketed Gems are Supported by Level # Awakened Baz Support', '插槽中的寶石被等級 # 的 覺醒．戊輔助 輔助']
    ])
    expect(plan.adds).toEqual([
      { lang: 'en', ref: 'Grants Summon Bar Skill', matcher: { string: 'Grants Summon Bar' }, supersedes: 'Grants Summon Bar Skill' },
      { lang: 'cmn-Hant', ref: 'Grants Summon Bar Skill', matcher: { string: '賦予 召喚乙' }, supersedes: '獲得召喚乙技能' },
      // 舊列的 ref 沒有「 Support」(審查 2026-11-15:不認得會多出重複列)
      { lang: 'en', ref: 'Socketed Gems are Supported by Level # Old Qux', matcher: { string: 'Socketed Gems are Supported by Level # Old Qux Support' }, supersedes: 'Socketed Gems are Supported by Level # Old Qux' },
      { lang: 'cmn-Hant', ref: 'Socketed Gems are Supported by Level # Old Qux', matcher: { string: '插槽中的寶石被等級 # 的 己輔助 輔助' }, supersedes: '插槽中寶石被等級 # 的己輔助' }
    ])
    expect(plan.rejects.map((r: any) => r.id)).toEqual(['explicit.effect_4'])
    // 同一輪規則 14 會掛走的 id 不再另外新增一列
    expect(planEffectStats({ enStats, zhStats, tradeStats, skills, supports, strings, taken: ['explicit.effect_1', 'implicit.effect_1'] }).newStats.map((s: any) => s.ref)).toEqual(['Socketed Gems are Supported by Level # Awakened Baz Support'])
  })
})

describe('planTypeIds(規則 16)', () => {
  const tradeStats = [
    { id: 'explicit.stat_1', text: '#% increased Foo' }, { id: 'implicit.stat_1', text: '#% increased Foo' },
    { id: 'fractured.stat_2', text: 'Bar #' },
    { id: 'crafted.stat_3', text: 'Twin #' },
    { id: 'explicit.stat_4|7', text: 'Option Seven' },
    { id: 'enchant.stat_1', text: '#% increased Foo' },
    { id: 'implicit.stat_5', text: 'In Group #' },
    { id: 'implicit.stat_6', text: 'Nowhere #' }, { id: 'explicit.stat_8', text: '#% increased Foo' }, { id: 'fractured.stat_8', text: '#% increased Foo' }
  ]
  const rows = [
    stat('#% increased Foo', [{ string: '#% increased Foo' }]),
    stat('Bar Old', [{ string: 'Bar Old #', superseded: true }, { string: 'Bar #' }], { explicit: ['explicit.stat_2'] }),
    stat('Twin A', [{ string: 'Twin #' }], { explicit: ['explicit.stat_30'] }),
    stat('Twin B', [{ string: 'Twin #' }], { explicit: ['explicit.stat_31'] }),
    stat('Option Seven', [{ string: 'Option Seven' }], { implicit: ['implicit.stat_4|7'] }),
    { resolve: { strat: 'trivial-merge' }, stats: [stat('In Group #', [{ string: 'In Group #' }], { explicit: ['explicit.stat_5'] })] }
  ]

  it('交易站有、資料沒掛上的 id 加到文字相同且唯一的那條詞綴;多條同文字、選項 id、合併群組、雜湊與既有 id 不同(任何類型)、其他類型不動', () => {
    const plan = planTypeIds({ enStats: rows, tradeStats })
    expect(plan.extra).toEqual({ '#% increased Foo': { implicit: ['implicit.stat_1'] }, 'Bar Old': { fractured: ['fractured.stat_2'] } })
    expect(plan.rejects.map((r: any) => [r.id, r.reason])).toEqual([
      ['crafted.stat_3', '同文字的詞綴不只一條'],
      ['explicit.stat_4|7', '選項型 id'],
      ['implicit.stat_5', '在合併群組裡'],
      ['explicit.stat_8', '與既有 id 不是同一個 stat'],
      ['fractured.stat_8', '與既有 id 不是同一個 stat']
    ])
    const out = parseRows(applyStatPlan(toFile(rows), 'en', { extra: plan.extra }))
    expect(out[0].trade.ids).toEqual({ explicit: ['explicit.stat_1'], implicit: ['implicit.stat_1'] })
    expect(out[1].trade.ids).toEqual({ explicit: ['explicit.stat_2'], fractured: ['fractured.stat_2'] })
    expect(planTypeIds({ enStats: out, tradeStats }).extra).toEqual({})
  })
})

describe('planRoomNames(規則 17)', () => {
  it('壞掉的裂痕房間列(交易站叫法、matcher 帶前綴、沒有 option)補上遊戲內寫法並標成選項型,重跑為空', () => {
    const ref = 'Has Room: Splinter Research Lab (Tier 1)'
    const row = (s: string) => [{ ref, better: 1, matchers: [{ string: s }], trade: { ids: { pseudo: ['pseudo.x'] } } }]
    const enStats = row('Has Room: Splinter Research Lab (Tier 1) ')
    const zhStats = row('有房間：裂界研究室（階級 1） ')
    const rooms = [{ en: 'Anomaly Research Lab', zh: '異常研究所' }]
    const plan = planRoomNames({ zhStats, enStats, rooms })
    expect(plan.adds.map(a => [a.lang, a.matcher.string])).toEqual([['cmn-Hant', '異常研究所 (階級 1)'], ['en', 'Anomaly Research Lab (Tier 1)']])
    expect(plan.option).toEqual([ref])
    const en = parseRows(applyStatPlan(toFile(enStats), 'en', plan))
    const zh = parseRows(applyStatPlan(toFile(zhStats), 'cmn-Hant', plan))
    expect(en[0].matchers).toEqual([{ string: 'Has Room: Splinter Research Lab (Tier 1) ', superseded: true }, { string: 'Anomaly Research Lab (Tier 1)' }])
    expect(zh[0].matchers.at(-1)).toEqual({ string: '異常研究所 (階級 1)' })
    expect(zh[0].trade.option).toBe(true)
    expect(planRoomNames({ zhStats: zh, enStats: en, rooms })).toEqual({ adds: [], option: [] })
  })

  it('改過名的房間以英文現行名對照:再改名、只改繁中名都補得到', () => {
    const row = (ms: any[]) => [{ ref: 'Has Room: Throne of Atziri (Tier 3)', better: 0, matchers: ms, trade: { ids: { pseudo: ['pseudo.x'] }, option: true } }]
    const enStats = row([{ string: 'Throne of Atziri (Tier 3)', superseded: true }, { string: 'Cradle of Creation (Tier 3)' }])
    const zhStats = row([{ string: '阿茲里宴殿 (階級 3)', superseded: true }, { string: '創造之搖籃 (階級 3)' }])
    expect(planRoomNames({ zhStats, enStats, rooms: [], renames: [{ from: 'Cradle of Creation', en: 'Nest', zh: '巢' }] }).adds.map(a => a.matcher.string)).toEqual(['巢 (階級 3)', 'Nest (Tier 3)'])
    expect(planRoomNames({ zhStats, enStats, rooms: [{ en: 'Cradle of Creation', zh: '創世搖籃' }] }).adds).toEqual([{ lang: 'cmn-Hant', ref: 'Has Room: Throne of Atziri (Tier 3)', matcher: { string: '創世搖籃 (階級 3)' }, supersedes: '創造之搖籃 (階級 3)' }])
  })

  it('史記房間的繁中名與 GGPK 不同就加上 GGPK 的寫法、舊名標 superseded(GitHub issue #14 保險箱之殿);名稱不唯一或相同不動', () => {
    const room = (ref: string, zh: string) => ({ ref, better: 0, matchers: [{ string: zh }], trade: { ids: { pseudo: ['pseudo.x'] }, option: true } })
    const zhStats = [room('Has Room: Strongbox Chamber (Tier 1)', '寶箱之殿 (階級 1)'), room('Has Room: Vault (Tier 1)', '金庫 (階級 1)'), room('Has Room: Twin (Tier 2)', '舊 (階級 2)')]
    const rooms = [{ en: 'Strongbox Chamber', zh: '保險箱之殿' }, { en: 'Vault', zh: '金庫' }, { en: 'Twin', zh: '甲' }, { en: 'Twin', zh: '乙' }]
    const plan = planRoomNames({ zhStats, rooms })
    expect(plan.adds).toEqual([{ lang: 'cmn-Hant', ref: 'Has Room: Strongbox Chamber (Tier 1)', matcher: { string: '保險箱之殿 (階級 1)' }, supersedes: '寶箱之殿 (階級 1)' }])
    const out = parseRows(applyStatPlan(toFile(zhStats), 'cmn-Hant', { adds: plan.adds }))
    expect(out[0].matchers).toEqual([{ string: '寶箱之殿 (階級 1)', superseded: true }, { string: '保險箱之殿 (階級 1)' }])
    expect(planRoomNames({ zhStats: out, rooms }).adds).toEqual([])
  })

  it('3.30 房間改名:依改名表同時補繁中與英文新名、舊名標 superseded、改名目標不唯一或沒改名不動、重跑為空', () => {
    const room = (ref: string, name: string) => ({ ref, better: 0, matchers: [{ string: name }], trade: { ids: { pseudo: ['pseudo.x'] }, option: true } })
    const zhStats = [room('Has Room: Throne of Atziri (Tier 3)', '阿茲里宴殿 (階級 3)'), room('Has Room: Vault (Tier 1)', '金庫 (階級 1)'), room('Has Room: Twin (Tier 2)', '舊 (階級 2)')]
    const enStats = [room('Has Room: Throne of Atziri (Tier 3)', 'Throne of Atziri (Tier 3)'), room('Has Room: Vault (Tier 1)', 'Vault (Tier 1)'), room('Has Room: Twin (Tier 2)', 'Twin (Tier 2)')]
    const renames = [{ from: 'Throne of Atziri', en: 'Cradle of Creation', zh: '創造之搖籃' }, { from: 'Twin', en: 'A', zh: '甲' }, { from: 'Twin', en: 'B', zh: '乙' }]
    const plan = planRoomNames({ zhStats, enStats, rooms: [], renames })
    expect(plan.adds).toEqual([
      { lang: 'cmn-Hant', ref: 'Has Room: Throne of Atziri (Tier 3)', matcher: { string: '創造之搖籃 (階級 3)' }, supersedes: '阿茲里宴殿 (階級 3)' },
      { lang: 'en', ref: 'Has Room: Throne of Atziri (Tier 3)', matcher: { string: 'Cradle of Creation (Tier 3)' }, supersedes: 'Throne of Atziri (Tier 3)' }
    ])
    const zhOut = parseRows(applyStatPlan(toFile(zhStats), 'cmn-Hant', { adds: plan.adds }))
    const enOut = parseRows(applyStatPlan(toFile(enStats), 'en', { adds: plan.adds }))
    expect(zhOut[0].matchers).toEqual([{ string: '阿茲里宴殿 (階級 3)', superseded: true }, { string: '創造之搖籃 (階級 3)' }])
    expect(enOut[0].matchers).toEqual([{ string: 'Throne of Atziri (Tier 3)', superseded: true }, { string: 'Cradle of Creation (Tier 3)' }])
    expect(planRoomNames({ zhStats: zhOut, enStats: enOut, rooms: [], renames }).adds).toEqual([])
  })
})

describe('planNewStats', () => {
  const row = (key: string, en: string, zh: string) => ({ key, en, zh })
  const ggpkOld = [row('old_imp', 'Gain {0} Foo', '獲得 {0} 甲'), row('old_exp', '{0}% more Bar', '{0}% 更多乙'), row('old_mix', 'Baz {0}', '丙 {0}')]
  const ggpkNew = [...ggpkOld, row('new_exp', 'Brand new {0}', '全新 {0}')]
  const tradeStats = [
    { id: 'implicit.stat_1', text: 'Gain # Foo' },
    { id: 'explicit.stat_2', text: '#% more Bar' },
    { id: 'implicit.stat_3', text: 'Baz #' }, { id: 'explicit.stat_3', text: 'Baz #' },
    { id: 'explicit.stat_4', text: 'Brand new #' }
  ]

  it('這季新增的 stat 照收;舊 stat 只收交易站只列為固定詞綴的', () => {
    const out = planNewStats({ enStats: [], ggpkOld, ggpkNew, tradeStats })
    expect(out.map((s: any) => [s.ref, s.ids])).toEqual([
      ['Gain # Foo', { implicit: ['implicit.stat_1'] }],
      ['Brand new #', { explicit: ['explicit.stat_4'] }]
    ])
    expect(out[0].zh).toEqual([{ string: '獲得 # 甲' }])
  })

  it('舊版就有的地圖 / 輿圖詞綴(stat id 全部 map_ 開頭,或出自地圖 / 輿圖描述檔)交易站有 id 也收(使用者 2026-11-15 要求)', () => {
    const old = [
      row('map_monsters_foo_+%|#|stat_descriptions.txt|0', 'Monsters have {0}% more Foo', '怪物有 {0}% 更多甲'),
      row('breach_bar|#|atlas_stat_descriptions.txt|0', 'Breaches in your Maps have {0} Bar', '你地圖中的裂痕有 {0} 乙'),
      row('local_baz_+%|#|skill_stat_descriptions.txt|0', '{0}% increased Baz', '增加 {0}% 丙'),
      row('map_one map_two|#|map_stat_descriptions.txt|0', 'Area has {0} One', '區域有 {0} 丁'),
      row('map_fixed|#|stat_descriptions.txt|0', 'Area has 2 Qux', '區域有 2 戊'),
      // 同一句話一般描述檔也有 → 不當地圖詞綴收(下面由物品詞綴的例外收)
      row('atlas_minion|#|atlas_stat_descriptions.txt|0', 'Minions have {0}% Dup', '召喚物有 {0}% 己'), row('minion_dup|#|stat_descriptions.txt|0', 'Minions have {0}% Dup', '召喚物有 {0}% 己')
    ]
    const trade = [
      { id: 'explicit.stat_1', text: 'Monsters have #% more Foo' }, { id: 'explicit.stat_2', text: 'Breaches in your Maps have # Bar' },
      { id: 'explicit.stat_3', text: '#% increased Baz' }, { id: 'explicit.stat_4', text: 'Area has # One' }, { id: 'explicit.stat_5', text: 'Area has 2 Qux' }, { id: 'explicit.stat_6', text: 'Minions have #% Dup' }
    ]
    const enStats = [{ ref: 'Area has # Qux', matchers: [{ string: 'Area has # Qux' }], trade: { ids: {} } }]
    const out = planNewStats({ enStats, ggpkOld: old, ggpkNew: old, tradeStats: trade })
    // 技能描述檔等非物品詞綴的舊句不收;英文把數字換成 # 後與既有 matcher 同形的不收
    // 「Minions have #% Dup」不算地圖詞綴(一般描述檔也有這句),但它是主描述檔的物品詞綴、交易站列為隨機詞綴 → 由例外 2 收進來
    expect(out.map((s: any) => s.ref)).toEqual(['Monsters have #% more Foo', 'Breaches in your Maps have # Bar', 'Area has # One', 'Minions have #% Dup'])
  })

  it('舊版就有、主描述檔的物品詞綴(交易站列為隨機 / 固定 / 破裂 / 工藝)也收;只列為附魔等其他類型的不收(GitHub issue #16 殘酷的效果)', () => {
    const old = [
      row('cruelty_effect_+%|1|#|stat_descriptions.txt|0', '{0}% increased Effect of Cruelty', '增加 {0}% 殘酷的效果'),
      row('only_enchant|#|stat_descriptions.txt|0', '{0}% increased Lab Thing', '增加 {0}% 迷宮')
    ]
    const trade = [
      { id: 'explicit.stat_1', text: '#% increased Effect of Cruelty' }, { id: 'fractured.stat_1', text: '#% increased Effect of Cruelty' },
      { id: 'enchant.stat_2', text: '#% increased Lab Thing' }
    ]
    const out = planNewStats({ enStats: [], ggpkOld: old, ggpkNew: old, tradeStats: trade })
    expect(out.map((s: any) => [s.ref, s.ids, s.zh])).toEqual([
      ['#% increased Effect of Cruelty', { explicit: ['explicit.stat_1'], fractured: ['fractured.stat_1'] }, [{ string: '增加 #% 殘酷的效果' }]]
    ])
  })

  it('兩個交易站文字的繁中是同一句(督軍印記:Warlords 與 Warlord 拼法不同、id 不同)→ 併成一列,兩個英文寫法與兩個 id 都留', () => {
    const rows2 = [row('a|#|stat_descriptions.txt|0', "Trigger {0} Warlords's Mark", '觸發 {0} 督軍印記'), row('b|#|stat_descriptions.txt|0', "Trigger {0} Warlord's Mark", '觸發 {0} 督軍印記')]
    const trade = [{ id: 'explicit.stat_1', text: "Trigger # Warlords's Mark" }, { id: 'explicit.stat_2', text: "Trigger # Warlord's Mark" }]
    const out = planNewStats({ enStats: [], ggpkOld: rows2, ggpkNew: rows2, tradeStats: trade })
    expect(out).toHaveLength(1)
    expect(out[0].en.map((m: any) => m.string)).toEqual(["Trigger # Warlords's Mark", "Trigger # Warlord's Mark"])
    expect(out[0].zh).toEqual([{ string: '觸發 # 督軍印記' }])
    expect(out[0].ids).toEqual({ explicit: ['explicit.stat_1', 'explicit.stat_2'] })
  })

  it('繁中新句把數字換成 # 後與既有 matcher 同形的不加(會搶走既有詞綴的比對)', () => {
    const fixed = [row('new_fixed', 'Gain 1 Foo on Hit', '擊中時獲得 1 甲')]
    const zhStats = [{ ref: 'Gain # Foo when Hit', matchers: [{ string: '擊中時獲得 # 甲' }] }]
    const trade = [{ id: 'implicit.stat_9', text: 'Gain 1 Foo on Hit' }]
    expect(planNewStats({ enStats: [], zhStats, ggpkOld: [], ggpkNew: fixed, tradeStats: trade })).toEqual([])
    expect(planNewStats({ enStats: [], ggpkOld: [], ggpkNew: fixed, tradeStats: trade })).toHaveLength(1)
  })
})

describe('planGems / applyItemPlan', () => {
  const enRows = () => [{ name: 'Fireball', refName: 'Fireball', namespace: 'GEM', icon: 'i', gem: { maxLevel: 20 } },
    { name: 'Vaal Arc', refName: 'Vaal Arc', namespace: 'GEM', gem: { vaal: true, maxLevel: 20 } },
    { name: 'Fireball', refName: 'Fireball', namespace: 'ITEM' }]
  const gems = [{ en: 'Fireball of Radiation', zh: '火球．輻射' }, { en: 'Two Names', zh: '甲' }, { en: 'Two Names', zh: '乙' }]
  const tradeItems = [
    { type: 'Fireball', group: 'gem' },
    { type: 'Fireball', text: 'Fireball of Radiation', disc: 'alt_x', group: 'gem' },
    { type: 'Fireball', text: 'Fireball of Radiation', disc: 'alt_x', group: 'gem' },
    { type: 'Vaal Arc', text: 'Vaal Arc (Arc of Oscillating)', disc: 'alt_y', group: 'gem' },
    { type: 'Fireball', text: 'Two Names', disc: 'alt_y', group: 'gem' },
    { type: 'No Base', text: 'No Base of X', disc: 'alt_x', group: 'gem' },
    { type: 'Fireball', text: 'Not A Gem', disc: 'alt_x', group: 'map' }
  ]

  it('交易站新變異寶石加一列(分支、原版、等級上限、圖示照原版);判不準的拒收;重跑為空', () => {
    const p = planGems({ enItems: enRows(), tradeItems, gems })
    expect(p.adds).toEqual([{ refName: 'Fireball of Radiation', zh: '火球．輻射', disc: 'alt_x', normal: 'Fireball', maxLevel: 20, icon: 'i' }])
    expect(p.rejects.map((r: any) => r.id)).toEqual(['Two Names', 'No Base of X'])
    const zhRows = enRows().map(r => (r.icon ? { ...r, icon: 'zh-i' } : r))
    const zhOut = parseRows(applyItemPlan(toFile(zhRows), 'cmn-Hant', { gems: p.adds }))
    expect(zhOut.at(-1)).toEqual({ name: '火球．輻射', refName: 'Fireball of Radiation', namespace: 'GEM', tradeDisc: 'alt_x', icon: 'zh-i', gem: { transfigured: true, normalVariant: 'Fireball', maxLevel: 20 } })
    const enOut = parseRows(applyItemPlan(toFile(enRows()), 'en', { gems: p.adds }))
    expect(planGems({ enItems: enOut, tradeItems, gems }).adds).toEqual([])
  })
})

describe('新的一般寶石、隨機技能寶石進階寫法、verified 補寫法(issue #18–#23)', () => {
  it('新的一般寶石只收列出等級上限的,其餘拒收;寫出的列沒有變異欄位', () => {
    const enItems = [{ name: 'Fireball', refName: 'Fireball', namespace: 'GEM', gem: { maxLevel: 20 } }]
    const tradeItems = [{ type: 'Fireball', group: 'gem' }, { type: 'Arcane Link', group: 'gem' }, { type: 'Unknown Gem', group: 'gem' }, { type: 'Vaal New', group: 'gem' }]
    const p = planGems({ enItems, tradeItems, gems: [], skills: [{ en: 'Arcane Link', zh: '連結：秘能' }] })
    expect(p.adds).toEqual([{ refName: 'Arcane Link', zh: '連結：秘能', maxLevel: 20 }])
    expect(p.rejects.map((r: any) => r.id)).toEqual(['Unknown Gem'])
    const out = parseRows(applyItemPlan(toFile(enItems), 'cmn-Hant', { gems: p.adds }))
    expect(out.at(-1)).toEqual({ name: '連結：秘能', refName: 'Arcane Link', namespace: 'GEM', gem: { maxLevel: 20 } })
  })

  it('「全部 X 寶石等級 #」多一個「(...)」進階寫法、舊的標 superseded;別的詞綴不動;重跑為空', () => {
    const REF = '+# to Level of all Summon Reaper Gems (Random Skill Gem)'
    const zh = () => [{ ref: REF, matchers: [{ string: '全部 召喚奪魂鐮 寶石等級 #', advanced: '全部 召喚奪魂鐮(火球-魔能長杖) 寶石等級 #' }] },
      { ref: 'other', matchers: [{ string: '別的', advanced: '別的(1-2) 寶石等級 #' }] }]
    const en = () => [{ ref: REF, matchers: [{ string: '# to Level of all Summon Reaper Gems', advanced: '# to Level of all Summon Reaper(Fireball-Mana-Infused Staff) Gems' }] }]
    const p = planRandomSkillGem({ enStats: en(), zhStats: zh() })
    const out = parseRows(applyStatPlan(toFile(zh()), 'cmn-Hant', { adds: p.adds }))
    expect(out[0].matchers).toEqual([{ ...zh()[0].matchers[0], superseded: true }, { string: '全部 召喚奪魂鐮 寶石等級 #', advanced: '全部 召喚奪魂鐮(...) 寶石等級 #' }])
    expect(out[1]).toEqual(zh()[1])
    const enOut = parseRows(applyStatPlan(toFile(en()), 'en', { adds: p.adds }))
    expect(enOut[0].matchers[1].advanced).toBe('# to Level of all Summon Reaper(...) Gems')
    expect(planRandomSkillGem({ enStats: enOut, zhStats: out }).adds).toEqual([])
  })

  it('verified 的補寫法不查 GGPK、帶進階寫法並標舊句;沒標 verified 的仍要 GGPK 佐證', () => {
    const zh = [{ ref: 'Increased Area of Effect', matchers: [{ string: '增加效果範圍', advanced: '增加效果範圍(階層：2)' }] },
      { ref: '+# to Accuracy Rating', matchers: [{ string: '# 命中' }] }]
    const p = planExtraZh({ zhStats: zh, ggpkNew: [] })
    expect(p.adds.map((a: any) => a.ref)).toEqual(['Increased Area of Effect'])
    const out = parseRows(applyStatPlan(toFile(zh), 'cmn-Hant', { adds: p.adds }))
    expect(out[0].matchers).toEqual([{ string: '增加效果範圍', advanced: '增加效果範圍(階層：2)', superseded: true }, { string: '增加範圍效果', advanced: '增加範圍效果(階層：2)' }])
  })
})

describe('planMinionDoubled / applyStatPlan', () => {
  const REF = 'Maximum number of Raised Spectres is Doubled\nCannot have Minions other than Raised Spectres'
  const zh = () => [{ ref: REF, matchers: [{ string: '喚醒幽魂的最大數量加倍\n無法擁有喚醒幽魂以外的召喚物', advanced: '喚醒幽魂（幻化武器-神聖軍備）的最大數量加倍\n無法擁有喚醒幽魂（幻化武器-神聖軍備）以外的召喚物' }] },
    { ref: 'other', matchers: [{ string: '別的詞綴', advanced: '別的詞綴(1-2)' }] }]
  const en = () => [{ ref: REF, matchers: [{ string: REF, advanced: 'old' }] }]
  const ggpkNew = [{ key: 'maximum_number_of_X_minion_type_doubled|#|stat_descriptions.txt|0', en: 'Maximum number of {0} is Doubled\\nCannot have Minions other than {0}', zh: '{0}的最大數量加倍\\n無法擁有{0}以外的召喚物' }]

  it('多一個「(...)」進階寫法、舊的標 superseded、其他詞綴不動;重跑計畫為空', () => {
    const p = planMinionDoubled({ enStats: en(), zhStats: zh(), ggpkNew })
    const out = parseRows(applyStatPlan(toFile(zh()), 'cmn-Hant', { adds: p.adds }))
    expect(out[0].matchers).toEqual([
      { ...zh()[0].matchers[0], superseded: true },
      { string: '喚醒幽魂的最大數量加倍\n無法擁有喚醒幽魂以外的召喚物', advanced: '喚醒幽魂(...)的最大數量加倍\n無法擁有喚醒幽魂(...)以外的召喚物' }
    ])
    expect(out[1]).toEqual(zh()[1])
    const enOut = parseRows(applyStatPlan(toFile(en()), 'en', { adds: p.adds }))
    expect(enOut[0].matchers[1].advanced).toBe('Maximum number of Raised Spectres (...) is Doubled\nCannot have Minions other than Raised Spectres (...)')
    expect(planMinionDoubled({ enStats: enOut, zhStats: out, ggpkNew }).adds).toEqual([])
  })
})

describe('planSupportGemNames / applyStatPlan', () => {
  const REF = 'Socketed Gems are Supported by Level # Spell Echo (Random Support Gem)'
  const en = () => [{ ref: REF, matchers: [{ string: 'Socketed Gems are Supported by Level # Spell Echo' }] },
    { ref: 'Socketed Gems are Supported by Level # No Such (Random Support Gem)', matchers: [{ string: 'x' }] }]
  const zh = () => [{ ref: REF, matchers: [{ string: '插槽中的寶石被等級 # 的 施放迴響 輔助' }] }]
  const ggpkNew = [{ key: 'local_random_support_gem_level local_random_support_gem_index|# #|stat_descriptions.txt|0', en: 'Socketed Gems are Supported by Level {0} {1}', zh: '插槽中的寶石被等級 {0} 的 {1} 輔助' }]
  const baseNew = [{ path: 'Metadata/Items/Gems/SupportGemMulticast', en: 'Spell Echo Support', zh: '施放迴響輔助' }]

  it('寶石全名的新句加進去,舊句標 superseded;重跑計畫為空', () => {
    const p = planSupportGemNames({ enStats: en(), zhStats: zh(), ggpkNew, baseNew })
    expect(p.rejects.map((r: any) => r.ref)).toEqual(['Socketed Gems are Supported by Level # No Such (Random Support Gem)'])
    const enOut = parseRows(applyStatPlan(toFile(en()), 'en', { adds: p.adds }))
    const zhOut = parseRows(applyStatPlan(toFile(zh()), 'cmn-Hant', { adds: p.adds }))
    expect(enOut[0].matchers).toEqual([{ string: 'Socketed Gems are Supported by Level # Spell Echo', superseded: true }, { string: 'Socketed Gems are Supported by Level # Spell Echo Support' }])
    expect(zhOut[0].matchers).toEqual([{ string: '插槽中的寶石被等級 # 的 施放迴響 輔助', superseded: true }, { string: '插槽中的寶石被等級 # 的 施放迴響輔助 輔助' }])
    expect(planSupportGemNames({ enStats: enOut, zhStats: zhOut, ggpkNew, baseNew }).adds).toEqual([])
  })
})

describe('betterOf', () => {
  it('帶數值 → 1(含「減少 / 更少」:標 0 會讓這條在物品上預設勾選、只找數值一模一樣的掛單;審查 2026-11-15);逐條指定的照指定;沒有數值、技能索引 → 0', () => {
    expect(betterOf("#% increased Attack Speed if you've used an Attack Movement Skill Recently")).toBe(1)
    expect(betterOf('# to # Added Cold Damage with Unarmed Attacks')).toBe(1)
    expect(betterOf('Enemies have #% reduced Life Regeneration Rate')).toBe(1)
    expect(betterOf('Anger has #% reduced Reservation')).toBe(1)
    expect(betterOf('#% reduced Spark Duration')).toBe(-1)
    expect(betterOf('#% chance to lose an Endurance Charge on Kill')).toBe(-1)
    expect(betterOf('Can Attack as though using a Claw while main hand is empty')).toBe(0)
    expect(betterOf('Grants Level 20 #, which will be used by Shaper Memory')).toBe(0)
  })
})

describe('planGrownPassives(規則 18)', () => {
  it('交易站「1 added passive skill is X」(腐敗之種洗出的塗油天賦)= 既有「Allocates X」同編號 → 新增一列,繁中取「配置 X」的名字;已有同句的詞綴只掛 id', () => {
    const allocates = (name: string, zh: string, n: number) => ({ ref: `Allocates ${name}`, better: 0, matchers: [{ string: zh }], trade: { ids: { enchant: [`enchant.stat_2954116742|${n}`] } } })
    const enStats = [
      { ...allocates('Foo', 'Allocates Foo', 11) }, { ...allocates('Bar', 'Allocates Bar', 22) }, { ...allocates('Other', 'Allocates Other', 33) },
      stat('1 Added Passive Skill is Bar', [{ string: '1 Added Passive Skill is Bar' }])
    ]
    const zhStats = [allocates('Foo', '配置 甲', 11), allocates('Bar', '配置 乙', 22), allocates('Other', '配置 丙', 33), stat('1 Added Passive Skill is Bar', [{ string: '1 個附加的天賦為乙' }])]
    const tradeStats = [
      { id: 'enchant.stat_3599615742|11', text: '1 added passive skill is Foo' },
      { id: 'enchant.stat_3599615742|22', text: '1 added passive skill is Bar' },
      { id: 'enchant.stat_3599615742|33', text: '1 added passive skill is Renamed' }, // 同編號不同名 → 不猜
      { id: 'enchant.stat_3599615742|44', text: '1 added passive skill is Nobody' }
    ]
    const plan = planGrownPassives({ enStats, zhStats, tradeStats })
    expect(plan.newStats).toEqual([{
      ref: '1 Added Passive Skill is Foo', better: 1, en: [{ string: '1 Added Passive Skill is Foo' }], zh: [{ string: '1 個附加的天賦為甲' }],
      ids: { enchant: ['enchant.stat_3599615742|11'] }
    }])
    expect(plan.extra).toEqual({ '1 Added Passive Skill is Bar': { enchant: ['enchant.stat_3599615742|22'] } })
    expect(plan.rejects.map((r: any) => r.id)).toEqual(['enchant.stat_3599615742|33', 'enchant.stat_3599615742|44'])
    const out = parseRows(applyStatPlan(toFile(enStats), 'en', { newStats: plan.newStats, extra: plan.extra }))
    const again = planGrownPassives({ enStats: out, zhStats, tradeStats })
    expect([again.newStats, again.extra]).toEqual([[], {}])
  })
})

describe('planGrownPassives:繁中同名', () => {
  it('兩個不同天賦的繁中名相同(復仇 = Vengeance / Retaliation)→ 兩條都不給繁中寫法(繁中客戶端顯示未解析,不會配到別的天賦)並列入拒收', () => {
    const allocates = (name: string, zh: string, n: number) => ({ ref: `Allocates ${name}`, better: 0, matchers: [{ string: zh }], trade: { ids: { enchant: [`enchant.stat_2954116742|${n}`] } } })
    const enStats = [allocates('Vengeance', 'Allocates Vengeance', 1), allocates('Retaliation', 'Allocates Retaliation', 2), allocates('Solo', 'Allocates Solo', 3)]
    const zhStats = [allocates('Vengeance', '配置 復仇', 1), allocates('Retaliation', '配置 復仇', 2), allocates('Solo', '配置 獨', 3)]
    const tradeStats = [1, 2, 3].map(n => ({ id: `enchant.stat_3599615742|${n}`, text: `1 added passive skill is ${['Vengeance', 'Retaliation', 'Solo'][n - 1]}` }))
    const plan = planGrownPassives({ enStats, zhStats, tradeStats })
    expect(plan.newStats.map((s: any) => [s.ref, s.zh])).toEqual([
      ['1 Added Passive Skill is Vengeance', []],
      ['1 Added Passive Skill is Retaliation', []],
      ['1 Added Passive Skill is Solo', [{ string: '1 個附加的天賦為獨' }]]
    ])
    expect(plan.rejects.map((r: any) => [r.id, r.reason])).toEqual([
      ['enchant.stat_3599615742|1', '繁中名與另一個天賦相同'], ['enchant.stat_3599615742|2', '繁中名與另一個天賦相同']
    ])
  })
})
