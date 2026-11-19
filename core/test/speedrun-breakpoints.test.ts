// 基塔弗系統訊息解析、PoE1 分段點預設(新清單)與舊城鎮清單遷移。純函式,不碰檔案與時間。
import { describe, expect, it } from 'vitest'
import * as clientLog from '../src/speedrun/client-log'
import * as routes from '../src/speedrun/routes'

const { parseAreaLine } = clientLog
const { PRESET_TOWN_AREAS, presetRoute } = routes

const kitava = (line: string) => (clientLog as any).parseKitavaLine(line) as string | null
const migrate = (r: routes.Route) => (routes as any).migratePoe1TownPreset(r) as routes.Route

const HEAD = '2026/07/25 07:34:27 123456 cffb06be [INFO Client 1234]'
const ZH_CRUEL = `${HEAD} : 你永久性的受到奇塔弗的殘酷影響。你現在 -30% 最大抗性。`
const ZH_MERCILESS = '2026/07/25 10:47:29 123456 cffb06be [INFO Client 1234] : 你永久性的受到奇塔弗的無情影響。你的角色將減少 60% 所有抗性。'
const EN_CRUEL = `${HEAD} : You have been permanently weakened by Kitava's cruel affliction. You now have -30% to all Resistances.`
const EN_MERCILESS = `${HEAD} : You have been permanently weakened by Kitava's merciless affliction. You now have a total of -60% to all Resistances.`

const NEW_POE1 = ['1_2_1', '1_3_1', '1_4_1', '1_5_1', '2_6_town', '2_7_town', '2_8_1', '2_9_1', '2_10_town', '2_11_endgame_town']
const OLD_POE1 = ['1_2_town', '1_3_town', '1_4_town', '1_5_town', '2_6_town', '2_7_town', '2_8_town', '2_9_town', '2_10_town', '2_11_endgame_town']
const areasOf = (r: routes.Route) => r.splits.map(s => s.area)

describe('parseKitavaLine', () => {
  it('繁中第 5 章訊息(-30% 最大抗性)→ 2_6_town', () => {
    expect(kitava(ZH_CRUEL)).toBe('2_6_town')
  })
  it('繁中第 10 章訊息(減少 60% 所有抗性)→ 2_11_endgame_town', () => {
    expect(kitava(ZH_MERCILESS)).toBe('2_11_endgame_town')
  })
  it('英文 cruel 訊息 → 2_6_town', () => {
    expect(kitava(EN_CRUEL)).toBe('2_6_town')
  })
  it('英文 merciless 訊息 → 2_11_endgame_town', () => {
    expect(kitava(EN_MERCILESS)).toBe('2_11_endgame_town')
  })
  it('行尾帶 \\r(CRLF)照樣解析', () => {
    expect(kitava(ZH_CRUEL + '\r')).toBe('2_6_town')
  })
  it('玩家聊天行(#某玩家:)即使內文一樣也回 null', () => {
    expect(kitava(`${HEAD} #某玩家: 你永久性的受到奇塔弗的殘酷影響。你現在 -30% 最大抗性。`)).toBeNull()
  })
  it('密語行(@From)回 null', () => {
    expect(kitava(`${HEAD} @From 某人: Kitava's cruel affliction`)).toBeNull()
  })
  it('NPC 對白行(有名字欄)回 null', () => {
    expect(kitava(`${HEAD} 罪: 奇塔弗的殘酷…`)).toBeNull()
  })
  it('一般區域行與空字串回 null', () => {
    expect(kitava('2026/11/14 03:11:40 784780000 1186a803 [DEBUG Client 35540] Generating level 13 area "1_1_town" with seed 1')).toBeNull()
    expect(kitava('')).toBeNull()
  })
  it('既有 parseAreaLine 對基塔弗訊息行仍回 null', () => {
    expect(parseAreaLine(ZH_CRUEL)).toBeNull()
    expect(parseAreaLine(EN_MERCILESS)).toBeNull()
  })
})

describe('PoE1 預設分段點', () => {
  it('T6 兩種語言的 poe1 區域依序為新清單', () => {
    for (const lang of ['cmn-Hant', 'en'] as const) expect(areasOf(presetRoute('poe1', lang)), lang).toEqual(NEW_POE1)
  })
  it('poe2 區域維持不變', () => {
    for (const lang of ['cmn-Hant', 'en'] as const) {
      expect(areasOf(presetRoute('poe2', lang)), lang).toEqual(['G2_town', 'G3_town', 'G4_town', 'P1_Town', 'P2_Town', 'P3_Town', 'G_Endgame_Town'])
    }
  })
  it('PRESET_TOWN_AREAS.poe1 含六個新區域與原有城鎮,且中英名非空', () => {
    const rows = PRESET_TOWN_AREAS.poe1
    const ids = rows.map(r => r.area)
    for (const a of ['1_2_1', '1_3_1', '1_4_1', '1_5_1', '2_8_1', '2_9_1']) expect(ids, a).toContain(a)
    for (const a of OLD_POE1) expect(ids, a).toContain(a)
    for (const r of rows) {
      expect(r.zh.trim().length, r.area).toBeGreaterThan(0)
      expect(r.en.trim().length, r.area).toBeGreaterThan(0)
    }
  })
})

describe('migratePoe1TownPreset', () => {
  const oldRoute = (): routes.Route => ({
    ...presetRoute('poe1', 'cmn-Hant'),
    splits: OLD_POE1.map((a, i) => ({ name: `段${i}`, area: a })),
    pb: OLD_POE1.map((_, i) => (i + 1) * 1000),
    golds: OLD_POE1.map(() => 1000),
    attempts: 5,
    autoStart: true,
    autoSplit: false,
    startArea: '1_1_1'
  })

  it('舊內建清單 → 區域換新、紀錄清空、其餘原樣保留', () => {
    const old = oldRoute()
    const out = migrate(old)
    expect(areasOf(out)).toEqual(NEW_POE1)
    expect(out.pb).toBeNull()
    expect(out.golds).toEqual(Array(10).fill(null))
    expect(out.splits.map(s => s.name)).toEqual(old.splits.map(s => s.name))
    expect([out.attempts, out.autoStart, out.autoSplit, out.startArea]).toEqual([5, true, false, '1_1_1'])
  })
  it('段數不同 → 回同一個物件', () => {
    const r = oldRoute()
    r.splits = r.splits.slice(0, 9)
    r.pb = null
    r.golds = r.golds.slice(0, 9)
    expect(migrate(r)).toBe(r)
  })
  it('任一段區域被使用者改過 → 回同一個物件,紀錄不動', () => {
    const r = oldRoute()
    r.splits[3] = { ...r.splits[3], area: '1_1_town' }
    expect(migrate(r)).toBe(r)
    expect(r.pb).not.toBeNull()
  })
  it('已是新清單 → 回同一個物件', () => {
    const r = presetRoute('poe1', 'cmn-Hant')
    expect(migrate(r)).toBe(r)
  })
})
