import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pyDumps, planLeadingNumber, planExtraZh, EXTRA_ZH_MATCHERS, applyStatPlan } from '../../scripts/poe2-season/lib.mjs'

/** PoE2 賽季腳本的純函式測試(合成輸入;最後一條讀真實 data/poe2 驗序列化)。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const stat = (ref: string, matchers: any[], id?: string) => ({ ref, better: 1, matchers, trade: { ids: { explicit: ['explicit.stat_1'] } }, ...(id ? { id } : {}) })
const toFile = (rows: unknown[]): string => rows.map(r => pyDumps(r)).join('\r\n') + '\r\n'
const parseRows = (text: string): any[] => text.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))

describe('pyDumps(PoE2 資料的序列化格式)', () => {
  it('與 Python json.dumps(ensure_ascii=False) 相同:分隔是「, 」與「: 」、中文不跳脫', () => {
    expect(pyDumps({ ref: '# A', better: 1, matchers: [{ string: '全部#', value: 1.5 }], trade: { ids: null } }))
      .toBe('{"ref": "# A", "better": 1, "matchers": [{"string": "全部#", "value": 1.5}], "trade": {"ids": null}}')
  })

  it('真實 data/poe2 的 stats:沒有計畫時整檔逐字不變(上游手補的列有「},{」等不一致寫法,只重寫有變動的列)', () => {
    for (const lang of ['en', 'cmn-Hant'] as const) {
      const text = fs.readFileSync(path.join(HERE, '../../data/poe2', lang, 'stats.ndjson'), 'utf8')
      expect(applyStatPlan(text, lang, { adds: [] }) === text, lang).toBe(true)
    }
  })
})

describe('planLeadingNumber(數字移到前面:「全部X技能等級#」→「#全部X技能等級」)', () => {
  const zhStats = [
    stat('# to Level of all Spell Skills', [{ string: '全部法術技能等級#' }], 'spell_skill_gem_level_+'),
    stat('# to Level of all Cold Spell Skills', [{ string: '全部冰冷法術技能等級#' }]),
    stat('Destined # to Level of all Attack Skills', [{ string: '命定: 全部攻擊技能等級#' }]),
    stat('# to Level of all Skill Gems', [{ string: '全部技能寶石等級#' }])
  ]

  it('只對「全部…技能等級#」補新寫法(標 superseded,篩選列與正則頁不變);「命定:」與其他句型不動', () => {
    expect(planLeadingNumber({ zhStats }).adds).toEqual([
      { lang: 'cmn-Hant', ref: '# to Level of all Spell Skills', matcher: { string: '#全部法術技能等級', superseded: true } },
      { lang: 'cmn-Hant', ref: '# to Level of all Cold Spell Skills', matcher: { string: '#全部冰冷法術技能等級', superseded: true } }
    ])
  })

  it('套用後只改那兩列(其餘逐字不變、保留 CRLF 與 PoE2 格式);重跑為空', () => {
    const before = toFile(zhStats)
    const after = applyStatPlan(before, 'cmn-Hant', planLeadingNumber({ zhStats }))
    const a = before.split('\r\n'); const b = after.split('\r\n')
    expect(b.length).toBe(a.length)
    expect(b.filter((l, i) => l !== a[i]).length).toBe(2)
    expect(parseRows(after)[0].matchers).toEqual([{ string: '全部法術技能等級#' }, { string: '#全部法術技能等級', superseded: true }])
    expect(planLeadingNumber({ zhStats: parseRows(after) }).adds).toEqual([])
  })
})

describe('planExtraZh(逐條列出的另一種繁中寫法,依實機樣本)', () => {
  it('條目都有依據;current 的新句當現行、舊句標 superseded;已經有了不重複', () => {
    expect(EXTRA_ZH_MATCHERS.every((x: any) => x.evidence)).toBe(true)
    const zhStats = [stat('Grants Skill: Raise Shield', [{ string: '賦予技能: 展開護盾' }], 'raise_shield')]
    const plan = planExtraZh({ zhStats })
    expect(plan.adds).toEqual([{ lang: 'cmn-Hant', ref: 'Grants Skill: Raise Shield', matcher: { string: '賦予技能: 舉盾' }, supersedes: '賦予技能: 展開護盾' }])
    const out = parseRows(applyStatPlan(toFile(zhStats), 'cmn-Hant', plan))
    expect(out[0].matchers).toEqual([{ string: '賦予技能: 展開護盾', superseded: true }, { string: '賦予技能: 舉盾' }])
    expect(planExtraZh({ zhStats: out }).adds).toEqual([])
  })
})
