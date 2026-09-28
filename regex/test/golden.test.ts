// 最小 golden:C++ `pob-zh.exe --regex-selftest` 報告(pob-zh-engine `dist/regex_selftest.txt`,222 PASS)
// 裡**逐字印出**的 query 字串與數字。TS 版必須逐字相同。
// 完整 golden(固定勾選集 × 全頁 × 三模式的 Build().query)需要 PobTools 端加匯出旗標,見 golden/README.md。
import { describe, expect, it } from 'vitest'
import { Corpus, type Ambient, type Entry } from '../src/gen'
import { buildCorpus, entryLines } from '../src/data'
import { loadAllRegexPages } from '../src/node'
import { samplePicks } from '../src/rng'
import golden from './golden/selftest-report.json'

function make (texts: string[]): Corpus {
  return new Corpus(texts.map((t, i) => ({ id: `e${i}`, texts: [t] })))
}
function makeEx (es: Entry[], amb: Ambient = {}): Corpus {
  return new Corpus(es, amb)
}

/** 報告裡每一條印出字串的 check,用與 regex_selftest.cpp 相同的輸入重跑 */
const synthetic: Record<string, () => string> = {
  'T1 one pick': () => make(['怪物不能被詛咒', '怪物不能被嘲諷', '玩家有較少的護盾']).build([0], 'any').query,
  'T1 two picks': () => make(['怪物不能被詛咒', '怪物不能被嘲諷', '玩家有較少的護盾']).build([0, 1], 'any').query,
  'T2 different tails': () => make(['造成 # 點火焰傷害', '造成 # 點冰冷傷害']).build([0], 'any').query,
  'T3 prefix': () => make(['abc', 'xabc']).build([0], 'any').query,
  'T3 suffix': () => make(['abc', 'abcx']).build([0], 'any').query,
  'T4 mixed case': () => make(['Fire Damage', 'Cold Damage']).build([0], 'any').query,
  'T5 any': () => make(['甲', '乙', '丙']).build([0, 1], 'any').query,
  'T5 none': () => make(['甲', '乙', '丙']).build([0, 1], 'none').query,
  'T5 all': () => make(['甲', '乙', '丙']).build([0, 1], 'all').query,
  'T7 build': () => new Corpus([{ id: 'two-line', texts: ['第一行', '第二行'] }, { id: 'other', texts: ['無關的一行'] }]).build([0], 'any').query,
  'T9 repeat': () => make(['一二三四', '二三四五', '三四五六', '四五六七']).build([0, 2], 'any').query,
  'T13 printed only': () => makeEx([{ id: 'a', texts: ['甲乙'], hidden: ['丙丁'] }, { id: 'b', texts: ['戊己'] }]).build([0], 'any').query,
  'T14 longer piece': () => t14().build([0], 'any').query,
  'T14 both picked': () => t14().build([0, 1], 'any').query,
  'T14 all': () => t14().build([0, 1], 'all').query,
  'T15 past ambient': () => makeEx([
    { id: 'level', texts: ['怪物等級增加'] }, { id: 'life', texts: ['玩家生命'] }, { id: 'corrupted', texts: ['已汙染'] }
  ], { lines: ['怪物等級：#', '已汙染'] }).build([0], 'any').query,
  'T15 name seam': () => makeEx([{ id: 'dues', texts: ['pay dues'] }, { id: 'other', texts: ['other'] }],
    { nameLeft: ['Agony'], nameRight: [' Desire'] }).build([0], 'any').query,
  'T16 mid-way': () => makeEx([{ id: 'abc', texts: ['abc'] }, { id: 'xabc', texts: ['xabc'], hidden: ['zabcz'] }]).build([0], 'any').query,
  'T16 fully anchored': () => makeEx([{ id: 'abc', texts: ['abc'] }, { id: 'xabc', texts: ['xabc'], hidden: ['abcz'] }]).build([0], 'any').query
}
function t14 (): Corpus {
  return makeEx([
    { id: 'avoid-ailments', texts: ['元素異常狀態'] },
    { id: 'ignite', texts: ['玩家有更少護甲'], hidden: ['元素,火焰,異常狀態'] }
  ])
}

describe('golden: synthetic queries printed by the C++ selftest', () => {
  for (const [name, want] of Object.entries(golden.synthetic)) {
    it(`${name} → ${want}`, () => {
      const f = synthetic[name]
      expect(f, `golden 有 ${name} 但測試沒有對應的輸入`).toBeTypeOf('function')
      expect(f()).toBe(want)
    })
  }
  it('every synthetic input has a golden value', () => {
    expect(Object.keys(synthetic).sort()).toEqual(Object.keys(golden.synthetic).sort())
  })
})

describe('golden: shipped data', () => {
  const { pages } = loadAllRegexPages('poe1')

  // regex_selftest.cpp:714–734:種子 0x5EED1234 抽 10 個不重複列,Any 模式的長度與逐字寫出長度
  for (const g of golden.tenPicks) {
    it(`${g.lang} ${g.game}/${g.page}: 10 picks = ${g.length} characters (spelled out ${g.plain})`, () => {
      const page = pages.find(p => p.id === g.page && p.game === g.game)!
      expect(page, g.page).toBeDefined()
      const c = buildCorpus(page, g.lang as 'zh' | 'en')
      const sel = samplePicks(0x5EED1234, page.entries.length, 10)
      const r = c.build(sel, 'any')
      let plain = 0
      for (const i of sel) plain += [...entryLines(page.entries[i], g.lang as 'zh' | 'en').texts[0]].length + 1
      expect({ length: r.length, plain }).toEqual({ length: g.length, plain: g.plain })
    })
  }

  // regex_selftest.cpp:809–826:繁中地圖頁「怪物有 #% 機率避免元素異常狀態」單選 → "免元";裸「常」會碰到 11 筆
  it('zh map_mods 怪物有 #% 機率避免元素異常狀態 → "免元", bare 常 reaches 11 entries', () => {
    const page = pages.find(p => p.id === 'map_mods')!
    const idx = page.entries.findIndex(e => e.zh[0] === '怪物有 #% 機率避免元素異常狀態')
    expect(idx).toBeGreaterThanOrEqual(0)
    const c = buildCorpus(page, 'zh')
    expect(c.build([idx], 'any').query).toBe(golden.mapAilment.query)
    const v = c.verify([idx], '"常"')
    expect({ extra: v.extra.length, ambient: v.ambient.length }).toEqual({ extra: golden.mapAilment.bareExtra, ambient: golden.mapAilment.bareAmbient })
  })
})
