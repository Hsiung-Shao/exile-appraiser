// 競速計時設定:Config 往返與壞值、熱鍵總表新列、i18n 字串。純函式 / 讀 JSON,不開視窗、不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { presetRoute, type Route } from '../../core/src/speedrun/routes'
import { _roundTripForTest } from '../src/web/Config'
import { hotkeyTable } from '../src/web/settings/hotkey-table'
import type { HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const areasOf = (r: Route) => r.splits.map(s => s.area)
const rt = (obj: unknown) => _roundTripForTest(JSON.stringify(obj)).config as any

describe('設定往返(S14)', () => {
  it('S14 全新與舊設定檔(沒有 speedrun)→ 兩代都是內建路線,其他欄位預設', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw) as any
      for (const game of ['poe1', 'poe2'] as const) {
        const want = presetRoute(game, 'cmn-Hant')
        expect(areasOf(config.speedrun[game]), game).toEqual(areasOf(want))
        expect(config.speedrun[game].startArea, game).toBe(want.startArea)
        expect(config.speedrun[game].pb).toBeNull()
        expect(config.speedrun[game].attempts).toBe(0)
      }
      expect(config.clientLogPath).toBe('')
      expect(config.speedrunRows).toBe(5)
      expect(config.hotkeyTimerPause).toBe('')
      expect(config.hotkeyTimerUndo).toBe('')
      expect(config.hotkeyTimerSkip).toBe('')
      // 寫出的檔帶這些欄位
      const out = JSON.parse(serialized)
      expect(out.speedrun.poe1.splits.length).toBe(10)
      expect(out.speedrun.poe2.splits.length).toBe(7)
      expect(out.speedrunRows).toBe(5)
    }
  })

  it('S14 合法值往返不變(pb / golds / attempts / autoStart false / 手動分段 area null)', () => {
    const custom: Route = {
      splits: [{ name: '第一幕', area: '1_2_town' }, { name: '手動段', area: null }, { name: '終點', area: '1_4_town' }],
      startArea: '1_1_1',
      pb: [60_000, 100_000, null],
      golds: [60_000, 40_000, 50_000],
      attempts: 7,
      autoStart: false,
      autoSplit: true
    }
    const raw = {
      speedrun: { poe1: custom, poe2: { ...presetRoute('poe2', 'en'), attempts: 3, autoSplit: false } },
      clientLogPath: 'D:\\Games\\PoE\\logs\\Client.txt',
      speedrunRows: 8,
      hotkeyTimerPause: 'F3', hotkeyTimerUndo: 'F4', hotkeyTimerSkip: 'F5'
    }
    const { config, serialized } = _roundTripForTest(JSON.stringify(raw)) as any
    expect(config.speedrun.poe1).toEqual(custom)
    expect(config.speedrun.poe2.attempts).toBe(3)
    expect(config.speedrun.poe2.autoSplit).toBe(false)
    expect(config).toMatchObject({
      clientLogPath: 'D:\\Games\\PoE\\logs\\Client.txt', speedrunRows: 8,
      hotkeyTimerPause: 'F3', hotkeyTimerUndo: 'F4', hotkeyTimerSkip: 'F5'
    })
    // 寫出的檔可以被自己讀回,內容不變
    const again = _roundTripForTest(serialized).config as any
    expect(again.speedrun.poe1).toEqual(custom)
    expect(again.speedrun.poe2.attempts).toBe(3)
    expect(again.speedrunRows).toBe(8)
  })

  it('S14 speedrun.poe1 不是物件 → 該路線回內建,另一代不受影響', () => {
    const poe2 = { ...presetRoute('poe2', 'en'), attempts: 9 }
    for (const bad of ['oops', 5, null, []]) {
      const c = rt({ speedrun: { poe1: bad, poe2 } })
      expect(areasOf(c.speedrun.poe1), JSON.stringify(bad)).toEqual(areasOf(presetRoute('poe1', 'cmn-Hant')))
      expect(c.speedrun.poe1.startArea).toBe('1_1_1')
      expect(c.speedrun.poe2.attempts).toBe(9)
    }
  })

  it('S14 speedrun 整個不是物件 → 兩代都回內建', () => {
    const c = rt({ speedrun: 'bad' })
    expect(areasOf(c.speedrun.poe1)).toEqual(areasOf(presetRoute('poe1', 'cmn-Hant')))
    expect(areasOf(c.speedrun.poe2)).toEqual(areasOf(presetRoute('poe2', 'cmn-Hant')))
  })

  it('S14 splits 不是陣列 → 該路線回內建', () => {
    const c = rt({ speedrun: { poe1: { ...presetRoute('poe1', 'en'), splits: 'nope', attempts: 99 } } })
    expect(areasOf(c.speedrun.poe1)).toEqual(areasOf(presetRoute('poe1', 'cmn-Hant')))
    expect(c.speedrun.poe1.startArea).toBe('1_1_1')
  })

  it('S14 pb 長度與 splits 不同 → pb 清成 null,路線其餘保留', () => {
    const r = { ...presetRoute('poe1', 'en'), pb: [1000, 2000], attempts: 4 }
    const c = rt({ speedrun: { poe1: r } })
    expect(c.speedrun.poe1.pb).toBeNull()
    expect(c.speedrun.poe1.attempts).toBe(4)
    expect(c.speedrun.poe1.splits.length).toBe(10)
  })

  it('S14 golds 長度不符 → 全 null(長度跟 splits)', () => {
    const r = { ...presetRoute('poe1', 'en'), golds: [1000, 2000] }
    const c = rt({ speedrun: { poe1: r } })
    expect(c.speedrun.poe1.golds).toEqual(Array(10).fill(null))
  })

  it('S14 golds 內有字串 → 該欄清空(全 null),不會讓字串進到計時運算', () => {
    const r = { ...presetRoute('poe2', 'en'), golds: ['abc', 1000, 1000, 1000, 1000, 1000, 1000] }
    const c = rt({ speedrun: { poe2: r } })
    expect(c.speedrun.poe2.golds).toEqual(Array(7).fill(null))
  })

  it('S14 speedrunRows 超出 1–20 夾回,範圍內原樣', () => {
    expect(rt({ speedrunRows: 99 }).speedrunRows).toBe(20)
    expect(rt({ speedrunRows: 0 }).speedrunRows).toBe(1)
    expect(rt({ speedrunRows: -3 }).speedrunRows).toBe(1)
    expect(rt({ speedrunRows: 1 }).speedrunRows).toBe(1)
    expect(rt({ speedrunRows: 20 }).speedrunRows).toBe(20)
    expect(rt({ speedrunRows: 12 }).speedrunRows).toBe(12)
  })

  it('S14 speedrunRows 不是數字 → 回預設 5', () => {
    expect(rt({ speedrunRows: 'abc' }).speedrunRows).toBe(5)
  })

  it('S14 clientLogPath 不是字串 → 回空字串', () => {
    expect(rt({ clientLogPath: 123 }).clientLogPath).toBe('')
  })
})

describe('熱鍵總表(S18)', () => {
  function fullConfig (game: 'poe1' | 'poe2'): HotkeyConfigLike {
    return {
      hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space', game,
      hotkeyOcrReveal: '', hotkeyOcrRegion: '', hotkeyRuneshapeToggle: '', hotkeyRuneshapeRegion: '',
      revealAutoEnabled: true, runeshapeEnabled: true, hotkeyStashToggle: '', hotkeyStashRegion: '', stashPricesEnabled: true,
      commands: [], stashSearch: [], hotkeyRegexQuick: '', regexBookmarkHotkeys: [],
      hotkeyPoedb: '', hotkeyTimerToggle: '', hotkeyTimerReset: '',
      hotkeyTimerPause: 'F3', hotkeyTimerUndo: 'F4', hotkeyTimerSkip: 'F5'
    } as unknown as HotkeyConfigLike
  }

  it('S18 overlay:tools 群組含 timerPause / timerUndo / timerSkip,欄位接對且為選填', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      const g = hotkeyTable(fullConfig(game), { overlay: true }).find(x => x.id === 'tools')
      expect(g, game).toBeDefined()
      const rows = g!.rows.filter(r => r.kind === 'edit') as any[]
      for (const [id, field] of [['timerPause', 'hotkeyTimerPause'], ['timerUndo', 'hotkeyTimerUndo'], ['timerSkip', 'hotkeyTimerSkip']]) {
        const row = rows.find(r => r.id === id)
        expect(row, `${game} ${id}`).toBeDefined()
        expect(row.field, `${game} ${id}`).toBe(field)
        expect(row.optional, `${game} ${id}`).toBe(true)
      }
    }
  })

  it('S18 window 模式:tools 群組不列這三個(計時器只在 overlay)', () => {
    const g = hotkeyTable(fullConfig('poe2'), { overlay: false }).find(x => x.id === 'tools')
    const ids = (g?.rows ?? []).map(r => r.id)
    for (const id of ['timerPause', 'timerUndo', 'timerSkip']) expect(ids).not.toContain(id)
  })
})

describe('字串兩語(S18)', () => {
  const KEYS = [
    'hk.timer_pause', 'hk.timer_undo', 'hk.timer_skip',
    'timer.splits', 'timer.auto_start', 'timer.auto_split', 'timer.client_log', 'timer.pb', 'timer.sum_of_best', 'timer.clear_records'
  ]
  const lookup = (obj: any, key: string) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
  for (const [name, file] of [['繁中', 'cmn-Hant'], ['英文', 'en']] as const) {
    it(`S18 ${name}:十個鍵都有非空字串`, () => {
      const ppz = JSON.parse(read(`renderer/src/i18n/${file}.json`)).ppz
      for (const k of KEYS) {
        const v = lookup(ppz, k)
        expect(typeof v, `${file} ppz.${k}`).toBe('string')
        expect((v as string).trim().length, `${file} ppz.${k}`).toBeGreaterThan(0)
      }
    })
  }
})

describe('審查修正(2026-11-10)', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/web/Config.ts'), 'utf8')
  it('重新套用設定(預覽端存檔)時路線內容相同就沿用原物件,進行中的計時不被重設', () => {
    expect(src).toMatch(/keepRoute\(config\.speedrun\?\.poe1, normRoute\(sr\.poe1/)
    expect(src).toMatch(/JSON\.stringify\(old\) === JSON\.stringify\(next\) \? old : next/)
  })
  it('全新安裝的內建章節名跟系統介面語言(英文系統不是中文名)', () => {
    expect(src).toMatch(/presetRoute\('poe1', systemUiLanguage\(\) === 'en' \? 'en' : 'cmn-Hant'\)/)
  })
})
