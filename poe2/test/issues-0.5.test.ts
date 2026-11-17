import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { setupTests } from './vitest.setup'

/** GitHub issue 的 PoE2 實機剪貼簿(繁中客戶端)。資料由 scripts/poe2-season 補,不手改。 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (name: string): ParsedItem => {
  const r = parseClipboard(fs.readFileSync(path.join(HERE, 'docs', name), 'utf8'))
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`)
  return r.value
}
const unknownOf = (item: ParsedItem): string[] => item.unknownModifiers.map(u => u.text)
const rollsOf = (item: ParsedItem, ref: string): number[] =>
  item.statsByType.filter(s => s.stat.ref === ref).flatMap(s => s.sources.map(x => x.stat.roll?.value as number))

beforeAll(async () => {
  setupTests({ language: 'cmn-Hant' })
  await init('cmn-Hant')
})

describe('PoE2 GitHub issue 的實機文字', () => {
  it('#24 血石項鍊「+3全部法術技能等級」(數字移到前面的新寫法)解析成原詞綴、數值 3', () => {
    const item = read('issue-24.cmn-Hant.txt')
    expect(unknownOf(item)).toEqual([])
    expect(rollsOf(item, '# to Level of all Spell Skills')).toEqual([3])
  })

  it('#25 單挑法杖:符文與工藝的「+1全部法術技能等級」、「+5全部冰冷法術技能等級」都解析得到', () => {
    const item = read('issue-25.cmn-Hant.txt')
    expect(unknownOf(item)).toEqual([])
    expect(rollsOf(item, '# to Level of all Spell Skills').sort()).toEqual([1, 1])
    expect(rollsOf(item, '# to Level of all Cold Spell Skills')).toEqual([5])
  })

  it('#3 史瓦林「賦予技能: 舉盾」(不帶等級的寫法,譯名與帶等級的「賦予技能: 等級 # 舉盾」一致)不再是未解析;這條沒有交易站 id,不進篩選(同舊譯名)', () => {
    const item = read('issue-3.cmn-Hant.txt')
    expect(unknownOf(item)).toEqual([])
    expect(item.statsByType.map(s => s.stat.ref)).toContain('Grants Skill: Level # Cast on Block')
  })
})
