import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'

// 2026-11-25 傳奇類型掃描:多行詞綴原本「最短先配到就停」,英文第一行單獨也是一條詞綴時整段被拆開
const COUNT_MAX = ['Count as having maximum number of Endurance Charges', 'Count as having maximum number of Frenzy Charges', 'Count as having maximum number of Power Charges']
const DOEDRE = ["Grants Level 20 Summon Doedre's Effigy Skill", "Socketed Hex Curse Skills are Triggered by Doedre's Effigy when Summoned", 'Hexes from Socketed Skills can apply 5 additional Curses', '20% less Effect of Curses from Socketed Hex Skills']

function parse (klass: string, name: string, base: string, mods: string[]) {
  const r = parseClipboard([`Item Class: ${klass}`, 'Rarity: Unique', name, base, '--------', 'Item Level: 84', '--------', '{ Unique Modifier }', ...mods].join('\n') + '\n')
  if (r.isErr()) throw new Error(String(r.error))
  return { refs: r.value.statsByType.map(s => s.stat.ref), unknown: r.value.unknownModifiers.map(u => u.text) }
}

describe('多行詞綴先配最長的', () => {
  beforeAll(async () => { await init('en') }, 180_000)

  // 失敗代表:三行被拆成三條單行詞綴(交易站索引的是三行合一的 id,拆開送查不到)
  it('三行「視為有最大數量的球」解析成合一的那條', () => {
    expect(parse('Boots', 'The Red Trail', 'Titan Greaves', COUNT_MAX)).toEqual({ refs: [COUNT_MAX.join('\n')], unknown: [] })
  })

  // 失敗代表:先配到前三行那條,第四行變成未解析
  it('德瑞肖像四行整段解析成四行那條', () => {
    const { refs, unknown } = parse('Body Armours', 'Blunderbore', 'Astral Plate', DOEDRE)
    expect(unknown).toEqual([])
    expect(refs).toEqual([DOEDRE.join('\n').replace('Level 20', 'Level #')])
  })

  // 失敗代表:最長優先跨過 `{ }` 標頭,把兩條獨立詞綴併成合一的那條(審查 2026-11-25)。
  // 已知歧義:一般複製沒有標頭,這兩行相鄰時會解析成合一的 stat_798009319(文字分不出來;舊程式反過來一律拆開)
  it('進階複製分成兩個標頭時仍是兩條單行詞綴', () => {
    const SPEED = ["Monsters' Action Speed cannot be modified to below Base Value", "Monsters' Movement Speed cannot be modified to below Base Value"]
    const r = parseClipboard(['Item Class: Maps', 'Rarity: Rare', 'Doom Loop', 'Map (Tier 16)', '--------', 'Item Level: 84', '--------',
      '{ Prefix Modifier "Testing" (Tier: 1) }', SPEED[0], '{ Suffix Modifier "of Testing" (Tier: 1) }', SPEED[1]].join('\n') + '\n')
    if (r.isErr()) throw new Error(String(r.error))
    expect(r.value.unknownModifiers).toEqual([])
    expect(r.value.statsByType.map(s => s.stat.ref).sort()).toEqual([...SPEED].sort())
  })

  // 失敗代表:改成最長優先後,單獨一行的同一條詞綴反而解析不到
  it('只有一行時仍解析成單行那條', () => {
    expect(parse('Boots', 'The Red Trail', 'Titan Greaves', [COUNT_MAX[0]])).toEqual({ refs: [COUNT_MAX[0]], unknown: [] })
  })
})
