import { describe, expect, it } from 'vitest'
import { buildReport, diffSweep, lineShape, sweepKey } from '../../scripts/poe1-season/sweep-diff.mjs'

/**
 * 類型掃描差異(`scripts/poe1-season/sweep-diff.mjs`):新舊兩份掃描只留「新版才有」的句子,並標來源。
 * 全部用合成資料,不讀 repo 資料檔。
 */

const L = (en: string, zh: string): [string, string] => [en, zh]
const M = (mods: string[], stats: string[]) => ({ mods, stats })
const cls = (explicit: number[], implicit: number[] = []) => ({ class: L('Ring', '戒指'), bases: [] as Array<[string, string]>, explicit, implicit })

// 舊版:ring 有三句(生命 / 火焰傷害 / 舊寫法),amulet 有生命與「出現詞綴」
const OLD: any = {
  lines: [
    L('+10 to maximum Life', '+10 最大生命'),
    L('Adds 5 Fire Damage', '增加 5 火焰傷害'),
    L('Old wording of thing', '舊寫法'),
    L('Spawn mod line', '出現詞綴')
  ],
  classes: { ring: cls([0, 1, 2]), amulet: cls([0, 3]) },
  meta: [M(['m1'], ['d|s1|c']), M(['m2'], ['d|s2|c']), M(['m3'], ['d|s3|c']), M(['m4'], ['d|s4|c'])]
}

// 新版:生命只差數字、火焰傷害沒變、舊寫法改字、「出現詞綴」多出現在 ring、多一條全新詞綴(隱性)
const NEW: any = {
  lines: [
    L('+12 to maximum Life', '+12 最大生命'),
    L('Adds 5 Fire Damage', '增加 5 火焰傷害'),
    L('New wording of thing', '新寫法'),
    L('Spawn mod line', '出現詞綴'),
    L('Brand new mod', '全新詞綴')
  ],
  classes: { ring: cls([0, 1, 2, 3], [4]), amulet: cls([0, 3]) },
  meta: [M(['m1'], ['d|s1|c']), M(['m2'], ['d|s2|c']), M(['m3'], ['d|s3|c']), M(['m4'], ['d|s4|c']), M(['m5'], ['d|s5|c'])]
}

describe('類型掃描差異', () => {
  it('DS2 新增詞綴、改字、舊詞綴多出現在新類別各留一句並標對 origin', () => {
    const d = diffSweep(OLD, NEW) as any
    expect(d.lines).toEqual([L('New wording of thing', '新寫法'), L('Spawn mod line', '出現詞綴'), L('Brand new mod', '全新詞綴')])
    expect(d.origins).toEqual(['changed', 'new-spawn', 'new-mod'])
    // 各自落在對的類別與段(新詞綴原本在 implicit 段)
    expect(d.classes.ring.explicit).toEqual([0, 1])
    expect(d.classes.ring.implicit).toEqual([2])
    // 沒有新句的類別整個不出現(amulet 的句子舊版都有)
    expect(Object.keys(d.classes)).toEqual(['ring'])
    // class 照新版原樣
    expect(d.classes.ring.class).toEqual(L('Ring', '戒指'))
    // meta 與 lines 同索引
    expect(d.meta).toEqual([NEW.meta[2], NEW.meta[3], NEW.meta[4]])
  })

  it('DS2 舊版某類別已有的句子不因為別的類別而重複保留', () => {
    // 「出現詞綴」在舊 amulet 已有,所以 amulet 不留;只有 ring(舊版沒有)才留
    const d = diffSweep(OLD, NEW) as any
    expect(d.classes.amulet).toBeUndefined()
    expect(d.lines.filter((l: [string, string]) => l[0] === 'Spawn mod line')).toHaveLength(1)
  })

  it('DS3 只差數值的句子不出現在差異、sweepKey 相同', () => {
    const d = diffSweep(OLD, NEW) as any
    expect(d.lines.map((l: [string, string]) => l[0])).not.toContain('+12 to maximum Life')
    expect(sweepKey('+10 to maximum Life', '+10 最大生命')).toBe(sweepKey('+12 to maximum Life', '+12 最大生命'))
    // 小數也算數字
    expect(sweepKey('Regenerate 1.5% of Life', '回復 1.5% 生命')).toBe(sweepKey('Regenerate 2.25% of Life', '回復 2.25% 生命'))
    // 文字不同就不同,不能把所有句子都當同一句
    expect(sweepKey('+10 to maximum Life', '+10 最大生命')).not.toBe(sweepKey('+10 to maximum Mana', '+10 最大魔力'))
    // 中文不同、英文相同也算不同
    expect(sweepKey('+10 to maximum Life', '+10 最大生命')).not.toBe(sweepKey('+10 to maximum Life', '+10 生命上限'))
  })

  it('DS2b 同一句被兩個類別引用時 lines 不重複、兩類別共用同一個新索引', () => {
    const oldS: any = { lines: [L('Old line', '舊句')], classes: { ring: cls([0]) }, meta: [M(['m1'], ['d|s1|c'])] }
    const newS: any = {
      lines: [L('Old line', '舊句'), L('Shared new line', '共用新句')],
      classes: { ring: cls([0, 1]), amulet: cls([1]) },
      meta: [M(['m1'], ['d|s1|c']), M(['m2'], ['d|s2|c'])]
    }
    const d = diffSweep(oldS, newS) as any
    expect(d.lines).toEqual([L('Shared new line', '共用新句')])
    expect(d.classes.ring.explicit).toEqual([0])
    expect(d.classes.amulet.explicit).toEqual([0])
    expect(d.origins).toHaveLength(d.lines.length)
    expect(d.meta).toHaveLength(d.lines.length)
    expect(d.origins).toEqual(['new-mod'])
  })

  it('DS2c 舊版沒有的類別其所有句子都保留', () => {
    const newS: any = {
      lines: [...OLD.lines],
      classes: { ...OLD.classes, belt: cls([0, 1], [2]) },
      meta: [...OLD.meta]
    }
    const d = diffSweep(OLD, newS) as any
    // 句子本身舊版都有,但 belt 是新類別 → 全留(含 implicit 段)
    expect(Object.keys(d.classes)).toEqual(['belt'])
    expect(d.lines).toEqual([OLD.lines[0], OLD.lines[1], OLD.lines[2]])
    expect(d.classes.belt.explicit).toEqual([0, 1])
    expect(d.classes.belt.implicit).toEqual([2])
    // 詞綴 id 舊版都有 → 不是 new-mod;舊版其他類別有同一句的描述句鍵且同文 → 都屬 new-spawn
    expect(d.origins).toEqual(['new-spawn', 'new-spawn', 'new-spawn'])
  })

  it('DS2e 舊版存在但沒進掃描的詞綴(allMods 有)不算 new-mod', () => {
    // m5 舊版就有(例:domain 沒命名被濾掉),只是沒產出句子
    const d = diffSweep({ ...OLD, allMods: ['m1', 'm2', 'm3', 'm4', 'm5'] }, NEW) as any
    expect(d.origins[d.lines.findIndex((l: [string, string]) => l[0] === 'Brand new mod')]).toBe('new-spawn')
  })

  it('DS2d 沒有任何差異時回傳空結果', () => {
    const d = diffSweep(OLD, OLD) as any
    expect(d.lines).toEqual([])
    expect(d.classes).toEqual({})
    expect(d.origins).toEqual([])
    expect(d.meta).toEqual([])
  })
})

describe('類型掃描差異報告', () => {
  const lines = [
    L('Mod alpha', '甲'), L('Mod beta', '乙'), L('Mod gamma', '丙'), L('Mod delta', '丁'), L('Mod epsilon', '戊')
  ]
  const origins = ['new-mod', 'new-mod', 'changed', 'changed', 'new-spawn']
  const diff: any = {
    lines,
    classes: { ring: cls([0, 1, 2, 3, 4]) },
    origins,
    meta: lines.map((_, i) => M([`m${i}`], [`d|s${i}|c`])),
    diff: { old: '3.29.3', new: '3.30.0' }
  }
  // alpha 同時有 gaps 與 queryGaps(只算一句)、gamma 有兩個段的 queryGaps(只算一句)→ 有缺口句數 2,條目數 4
  const gaps = { 'ring|explicit|Mod alpha': 'GAPNOTE-ALPHA-UNPARSED' }
  const queryGaps = {
    'ring|explicit|Mod alpha|id|en': 'QGAPNOTE-ALPHA-ID',
    'ring|explicit|Mod gamma|query|zh': 'QGAPNOTE-GAMMA-QUERY',
    'ring|explicit|Mod gamma|same': 'QGAPNOTE-GAMMA-SAME'
  }
  const report: string = buildReport({ diff, gaps, queryGaps })
  const standalone = (n: number) => new RegExp(`(^|[^\\d])${n}([^\\d]|$)`)

  it('DS6 標題含新舊版本字串', () => {
    expect(report).toContain('3.29.3')
    expect(report).toContain('3.30.0')
  })

  it('DS6 總表句數 = diff.lines 數、有缺口句數 = 不同句子數(不是缺口條目數)', () => {
    expect(report).toMatch(standalone(5))
    expect(report).toMatch(standalone(2))
    // 條目數 4 不該被當成有缺口句數寫出來:總表那行不含獨立的 4
    expect(report).not.toMatch(standalone(4))
  })

  it('DS6 依 origin 分組:三種標題都出現、各自列出自己的英文句', () => {
    for (const o of ['new-mod', 'changed', 'new-spawn']) expect(report).toContain(o)
    for (const l of lines) expect(report).toContain(l[0])
    // 分組順序下,同一 origin 的句子落在該標題與下一個標題之間
    const idx = (s: string) => report.indexOf(s)
    const sec = (o: string) => idx(o)
    // 第一次出現的 origin 名稱順序 = 報告分組順序;句子必須在自己 origin 的第一次標題之後
    expect(idx('Mod alpha')).toBeGreaterThan(sec('new-mod'))
    expect(idx('Mod gamma')).toBeGreaterThan(sec('changed'))
    expect(idx('Mod epsilon')).toBeGreaterThan(sec('new-spawn'))
  })

  it('DS6 缺口句子看得到缺口說明', () => {
    for (const note of ['GAPNOTE-ALPHA-UNPARSED', 'QGAPNOTE-ALPHA-ID', 'QGAPNOTE-GAMMA-QUERY', 'QGAPNOTE-GAMMA-SAME']) expect(report).toContain(note)
  })

  it('DS6 沒有缺口的句子不帶任何缺口說明', () => {
    const notes = ['GAPNOTE', 'QGAPNOTE']
    const lns = report.split(/\r?\n/)
    for (const clean of ['Mod beta', 'Mod delta', 'Mod epsilon']) {
      const hit = lns.filter(x => x.includes(clean))
      expect(hit.length).toBeGreaterThan(0)
      for (const x of hit) for (const n of notes) expect(x).not.toContain(n)
    }
  })

  it('DS6 找不到底材的類別:每句標「未驗」並算進有缺口句數', () => {
    const r: string = buildReport({ diff, gaps: { 'ring|base': '找不到認得的底材:en,cmn-Hant' }, queryGaps: {} })
    for (const l of lines) expect(r.split('\n').find(x => x.includes(l[0]))).toContain('未驗')
    expect(r).toMatch(/有缺口 \| 5 \|/)
  })

  it('DS6 沒有任何缺口時不出現缺口說明、仍列出全部句子', () => {
    const r: string = buildReport({ diff, gaps: {}, queryGaps: {} })
    expect(r).not.toContain('GAPNOTE')
    for (const l of lines) expect(r).toContain(l[0])
  })

  // 2026-11-25:「1% … per 15 Dexterity」(野變)與「3% … per 100 Dexterity」(Eldritch 固定)被當成同一句,傳奇類別拿到錯的句子
  it('DS7 只有模板代入的數字算「只差數字」,句子本身寫死的數字不同就是兩句', () => {
    const per15 = lineShape('{0}% increased Damage per 15 Dexterity', '每 15 點敏捷增加 {0}% 傷害', [1])
    const per100 = lineShape('{0}% increased Damage per 100 Dexterity', '每 100 點敏捷增加 {0}% 傷害', [3])
    expect(per15).not.toBe(per100)
    // 同一個模板代入不同數值 = 同一句
    expect(lineShape('{0:+d} to maximum Life', '{0:+d} 最大生命', [10])).toBe(lineShape('{0:+d} to maximum Life', '{0:+d} 最大生命', [99]))
    // 正負號不同是兩句(負值寫法是另一個要測的情況)
    expect(lineShape('{0:+d} to maximum Life', '{0:+d} 最大生命', [10])).not.toBe(lineShape('{0:+d} to maximum Life', '{0:+d} 最大生命', [-10]))
    // 代入名稱的槽:名稱不同是不同句
    expect(lineShape('Grants {0}', '賦予{0}', [{ en: 'A', zh: '甲' }])).not.toBe(lineShape('Grants {0}', '賦予{0}', [{ en: 'B', zh: '乙' }]))
  })

  it('DS7 差異比對用 meta 的 shape:寫死數字改了算新句', () => {
    const s = (en: string, zh: string, shape: string): any => ({ lines: [L(en, zh)], classes: { ring: cls([0]) }, meta: [{ mods: ['m'], stats: ['d|s|c'], shape }] })
    const d = diffSweep(s('1% per 15 Dex', '每 15', 'A'), s('3% per 100 Dex', '每 100', 'B')) as any
    expect(d.lines).toEqual([L('3% per 100 Dex', '每 100')])
  })
})
