// 合成測試:逐條改寫自 PobTools `host/regex_selftest.cpp` SyntheticTests()(:63–325)。
// 每個 it() 註明 C++ 的 T 編號、行號與原本的 check() 說明。逐字 query 另在 golden.test.ts 比對。
import { describe, expect, it } from 'vitest'
import { Corpus, charCount, type Ambient, type Entry } from '../src/gen'

/** regex_selftest.cpp:31 `Make`:每個字串一筆,id = e<i> */
function make (texts: string[]): Corpus {
  return new Corpus(texts.map((t, i) => ({ id: `e${i}`, texts: [t] })))
}
/** regex_selftest.cpp:46 `MakeEx` */
function makeEx (es: Entry[], amb: Ambient = {}): Corpus {
  return new Corpus(es, amb)
}

describe('T1 separating three unrelated lines(:65)', () => {
  const c = make(['怪物不能被詛咒', '怪物不能被嘲諷', '玩家有較少的護盾'])
  it('one pick resolves', () => {
    expect(c.build([0], 'any').exact).toBe(true)
  })
  it('query selects exactly the pick', () => {
    const r = c.build([0], 'any')
    expect(c.verify([0], r.query).ok).toBe(true)
  })
  it('two picks', () => {
    const r = c.build([0, 1], 'any')
    expect(c.verify([0, 1], r.query).ok).toBe(true)
  })
})

describe('T2 a token may never cross a rolled number(:77)', () => {
  it('literal 5 cannot be told apart from the # that rolls it', () => {
    const c = make(['造成 # 點傷害', '造成 5 點傷害'])
    const r = c.build([1], 'any')
    expect(!r.exact && r.unresolved.length === 1).toBe(true)
  })
  it('and not the other way round either', () => {
    const c = make(['造成 # 點傷害', '造成 5 點傷害'])
    const r = c.build([0], 'any')
    expect(!r.exact && r.unresolved.length === 1).toBe(true)
  })
  const d = make(['造成 # 點火焰傷害', '造成 # 點冰冷傷害'])
  const r2 = d.build([0], 'any')
  it('different tails are separable', () => { expect(r2.exact).toBe(true) })
  it("the query never contains a '#'", () => { expect(r2.query.includes('#')).toBe(false) })
  it('and it selects only the first', () => { expect(d.verify([0], r2.query).ok).toBe(true) })
})

describe('T3 anchors(:98)', () => {
  it("a prefix-only match needs '^' / and it is exact", () => {
    const c = make(['abc', 'xabc'])
    const r = c.build([0], 'any')
    expect(r.exact && r.query.includes('^')).toBe(true)
    expect(c.verify([0], r.query).ok).toBe(true)
  })
  it("a suffix-only match needs '$' / and it is exact", () => {
    const d = make(['abc', 'abcx'])
    const r2 = d.build([0], 'any')
    expect(r2.exact && r2.query.includes('$')).toBe(true)
    expect(d.verify([0], r2.query).ok).toBe(true)
  })
})

describe('T4 the search is case-insensitive, so the corpus must be too(:113)', () => {
  const c = make(['Fire Damage', 'Cold Damage'])
  it('mixed case', () => {
    const r = c.build([0], 'any')
    expect(r.exact && c.verify([0], r.query).ok).toBe(true)
  })
  it('an upper-case query still finds the entry', () => {
    expect(c.verify([0], '"FIRE"').ok).toBe(true)
  })
})

describe('T5 every mode produces the shape the client expects(:122)', () => {
  const c = make(['甲', '乙', '丙'])
  const any = c.build([0, 1], 'any')
  it('Any is one quoted term', () => {
    expect(any.query.length > 0 && any.query.startsWith('"') && any.query.endsWith('"')).toBe(true)
  })
  it('and it is an alternation', () => { expect(any.query.includes('|')).toBe(true) })
  const none = c.build([0, 1], 'none')
  it('None negates it', () => { expect(none.query.startsWith('"!')).toBe(true) })
  it('and it still names exactly the picks', () => { expect(c.verify([0, 1], none.query).ok).toBe(true) })
  const all = c.build([0, 1], 'all')
  it('All is separate terms, never an alternation', () => { expect(all.query.includes('|')).toBe(false) })
  it('and each term names one pick', () => { expect(c.verify([0, 1], all.query).ok).toBe(true) })
})

describe('T6 identical text cannot be separated, and says so(:140)', () => {
  it('duplicated text is reported unresolved, not silently merged', () => {
    const c = make(['完全一樣的一行', '完全一樣的一行', '另一行'])
    expect(c.build([0], 'any').exact).toBe(false)
  })
})

describe('T7 an entry matches if ANY of its printed lines does(:147)', () => {
  const c = new Corpus([
    { id: 'two-line', texts: ['第一行', '第二行'] },
    { id: 'other', texts: ['無關的一行'] }
  ])
  it('a token cut from the second line finds it', () => {
    expect(c.verify([0], '"第二行"').ok).toBe(true)
  })
  it('and Build agrees', () => {
    const r = c.build([0], 'any')
    expect(r.exact && c.verify([0], r.query).ok).toBe(true)
  })
})

describe('T8 the checker can fail(:165)', () => {
  const c = make(['怪物不能被詛咒', '怪物不能被嘲諷'])
  it('an over-broad query is caught', () => {
    const over = c.verify([0], '"怪物"')
    expect(!over.ok && over.extra.length === 1).toBe(true)
  })
  it('a query that misses a pick is caught', () => {
    const under = c.verify([0, 1], '"詛咒"')
    expect(!under.ok && under.missing.length === 1).toBe(true)
  })
  it('a token shared by both entries is caught', () => {
    expect(c.verify([0], '"不能"').ok).toBe(false)
  })
})

describe('T9 the same picks always produce the same string(:178)', () => {
  const c = make(['一二三四', '二三四五', '三四五六', '四五六七'])
  const a = c.build([0, 2], 'any')
  it('repeat run', () => { expect(c.build([0, 2], 'any').query).toBe(a.query) })
  it('and the order the boxes were ticked does not matter', () => {
    expect(c.build([2, 0], 'any').query).toBe(a.query)
  })
})

describe('T10 length is counted the way the client counts it(:188)', () => {
  it('two Chinese characters cost two', () => { expect(charCount('怪物')).toBe(2) })
  it('two ASCII characters cost two', () => { expect(charCount('ab')).toBe(2) })
  it('and a mixture adds up', () => { expect(charCount('a怪')).toBe(2) })
  // TS 移植額外:BMP 以外的字(代理對)也算一個碼點 —— C++ 以 UTF-8 起始位元組計數,同樣是 1
  it('(port) a non-BMP code point is one character', () => { expect(charCount('a😀')).toBe(2) })
})

describe('T13 hidden text is never cut into tokens and never counts as finding an entry(:197)', () => {
  const c = makeEx([
    { id: 'a', texts: ['甲乙'], hidden: ['丙丁'] },
    { id: 'b', texts: ['戊己'] }
  ])
  it('the query is cut from the printed line only', () => {
    const r = c.build([0], 'any')
    expect(r.exact && !r.query.includes('丙') && !r.query.includes('丁')).toBe(true)
  })
  const v = c.verify([0], '"丙"')
  it('a term that only hits hidden text does not find the entry', () => {
    expect(!v.ok && v.missing.length === 1 && v.missing[0] === 0).toBe(true)
  })
  it('and nobody else is reported for it either', () => { expect(v.extra).toEqual([]) })
})

describe('T14 a token that also hits another entry\'s hidden text is rejected(:217)', () => {
  const c = makeEx([
    { id: 'avoid-ailments', texts: ['元素異常狀態'] },
    { id: 'ignite', texts: ['玩家有更少護甲'], hidden: ['元素,火焰,異常狀態'] }
  ])
  const r = c.build([0], 'any')
  it('still resolvable with a longer piece', () => { expect(r.exact).toBe(true) })
  it('and Verify agrees the hidden text is not touched', () => { expect(c.verify([0], r.query).ok).toBe(true) })
  it("a term that reaches the other entry's hidden text is an over-match", () => {
    const v = c.verify([0], '"常"')
    expect(!v.ok && v.extra.length === 1 && v.extra[0] === 1).toBe(true)
  })
  it('with both picked the shared text is fair game again', () => {
    const both = c.build([0, 1], 'any')
    expect(both.exact && c.verify([0, 1], both.query).ok).toBe(true)
  })
  const all = c.build([0, 1], 'all')
  it('All resolves both', () => { expect(all.exact).toBe(true) })
  it("each All term names one pick without reaching the other's hidden text", () => {
    let clean = true
    for (const t of all.usedTokens) {
      const q = `"${t}"`
      if (!(c.verify([0], q).ok || c.verify([1], q).ok)) clean = false
    }
    expect(clean).toBe(true)
  })
  it('a literal number a hidden wildcard could print cannot be singled out', () => {
    const d = makeEx([
      { id: 'literal', texts: ['持續 5 秒'] },
      { id: 'other', texts: ['其他'], hidden: ['持續 # 秒'] }
    ])
    expect(d.build([0], 'any').exact).toBe(false)
  })
})

describe('T15 text on every item vetoes a token, and Verify names the term(:260)', () => {
  const c = makeEx([
    { id: 'level', texts: ['怪物等級增加'] },
    { id: 'life', texts: ['玩家生命'] },
    { id: 'corrupted', texts: ['已汙染'] }
  ], { lines: ['怪物等級：#', '已汙染'] })
  const r = c.build([0], 'any')
  it('resolvable past the ambient text', () => { expect(r.exact).toBe(true) })
  it('and the query does not touch it', () => { expect(c.verify([0], r.query).ok).toBe(true) })
  it('a term found on every item is named as such', () => {
    const v = c.verify([0], '"怪物"')
    expect(!v.ok && v.ambient.length === 1).toBe(true)
  })
  it('an entry whose whole line is on every item cannot be singled out', () => {
    expect(c.build([2], 'any').exact).toBe(false)
  })
  const d = makeEx([
    { id: 'dues', texts: ['pay dues'] },
    { id: 'other', texts: ['other'] }
  ], { nameLeft: ['Agony'], nameRight: [' Desire'] })
  it('a token never straddles the seam of a rare name', () => {
    const r4 = d.build([0], 'any')
    expect(r4.exact && d.verify([0], r4.query).ok).toBe(true)
  })
  it('and a term that does is named', () => {
    const v2 = d.verify([0], '"y d"')
    expect(!v2.ok && v2.ambient.length === 1).toBe(true)
  })
})

describe('T16 anchors are honoured against hidden lines too(:301)', () => {
  it("a '^' token clears a hidden line that has the text mid-way", () => {
    const c = makeEx([
      { id: 'abc', texts: ['abc'] },
      { id: 'xabc', texts: ['xabc'], hidden: ['zabcz'] }
    ])
    const r = c.build([0], 'any')
    expect(r.exact && r.query.includes('^') && c.verify([0], r.query).ok).toBe(true)
  })
  const d = makeEx([
    { id: 'abc', texts: ['abc'] },
    { id: 'xabc', texts: ['xabc'], hidden: ['abcz'] }
  ])
  it('a hidden line starting with it forces the fully anchored form', () => {
    const r2 = d.build([0], 'any')
    expect(r2.exact && r2.query.includes('^abc$') && d.verify([0], r2.query).ok).toBe(true)
  })
  it('and Verify sees the anchored hidden hit', () => {
    const v = d.verify([0], '"^abc"')
    expect(!v.ok && v.extra.length === 1).toBe(true)
  })
})

describe("T17 a modifier's other wordings must be found too", () => {
  // 總督碑牌 1..2:值 1 "an additional Strongbox"、值 2 "# additional Strongboxes";"ox$" 只中單數
  const c = makeEx([
    { id: 'box', texts: ['Map contains an additional Strongbox'], alts: ['Map contains # additional Strongboxes'] },
    { id: 'chance', texts: ['Map has #% increased chance to contain Strongboxes'] }
  ])
  for (const mode of ['any', 'all'] as const) {
    it(`the token covers both wordings (${mode})`, () => {
      const r = c.build([0], mode)
      expect(r.exact && c.verify([0], r.query).ok).toBe(true)
      expect(r.query.includes('ox$')).toBe(false)
      expect(r.query).toBe(mode === 'any' ? '"l"' : 'l')
    })
  }
  it('a term that misses the other wording is a miss', () => {
    const v = c.verify([0], '"ox$"')
    expect(!v.ok && v.missing.length === 1).toBe(true)
  })
  it('the other wording vetoes like hidden text for everyone else', () => {
    const r2 = c.build([1], 'any')
    expect(r2.exact && c.verify([1], r2.query).ok).toBe(true)
    expect(r2.query).toBe('"%"')
  })
  it('a wording no token can cover leaves the pick unresolved', () => {
    const d = makeEx([{ id: 'box', texts: ['box'], alts: ['# boxes'] }, { id: 'found', texts: ['boxes found'] }])
    expect(d.build([0], 'any').exact).toBe(false)
  })
  it('an entry without alts behaves as before', () => {
    const e = makeEx([{ id: 'box', texts: ['box'] }, { id: 'found', texts: ['boxes found'] }])
    expect(e.build([0], 'any').query).toBe('"x$"')
  })
})

// TS 移植額外的邊界(C++ 沒有對應 T 編號,但行為照 regex_gen.cpp 推導)
describe('(port) edge cases', () => {
  it('empty selection → empty result; out-of-range and duplicate picks ignored(:449,:454)', () => {
    const c = make(['甲', '乙'])
    expect(c.build([], 'any')).toEqual({ query: '', length: 0, usedTokens: [], unresolved: [], exact: true })
    expect(c.build([5, -1], 'any').query).toBe('')
    expect(c.build([0, 0, 9], 'any').query).toBe(c.build([0], 'any').query)
  })
  it('an empty query misses every pick(:563)', () => {
    const c = make(['甲', '乙'])
    const v = c.verify([1], '')
    expect(v).toEqual({ ok: false, missing: [1], extra: [], ambient: [] })
  })
  it('anchors:false never emits ^ or $', () => {
    const c = new Corpus([{ id: 'a', texts: ['abc'] }, { id: 'b', texts: ['xabc'] }], {}, { anchors: false })
    expect(c.build([0], 'any').exact).toBe(false)
  })
  it('All quotes a term that contains a space(:236)', () => {
    const c = make(['a b', 'a', 'b'])
    const r = c.build([0], 'all')
    expect(r.query).toBe('" "')
    expect(c.verify([0], r.query).ok).toBe(true)
  })
})
