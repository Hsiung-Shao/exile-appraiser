// poedb 開啟流程、計時器狀態、設定欄位、熱鍵總表與字串。純函式 / 讀原始碼,不開瀏覽器、不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { openItemOnPoedb } from '../src/web/poedb-open'
import { createTimer, formatHms, timerVisible } from '../src/web/overlay/timer-state'
import { _roundTripForTest } from '../src/web/Config'
import { OPTIONAL_HOTKEY_FIELDS, hotkeyTable } from '../src/web/settings/hotkey-table'
import { hotkeySlots, type HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'
import { overlayLayers } from '../src/web/overlay/overlay-content'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('openItemOnPoedb', () => {
  const mk = (resolveUrl: (t: string) => Promise<string | null>) => {
    const open = vi.fn()
    const log = vi.fn()
    return { open, log, deps: { resolveUrl, open, log } }
  }

  it('T8 解析出網址 → 交給系統瀏覽器開一次並回 true', async () => {
    const { open, log, deps } = mk(async () => 'https://poedb.tw/tw/Headhunter')
    expect(await openItemOnPoedb('clip', deps)).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://poedb.tw/tw/Headhunter')
    expect(log).not.toHaveBeenCalled()
  })

  it('T8 resolveUrl 收到的是原始剪貼簿文字', async () => {
    const resolveUrl = vi.fn(async (_t: string) => 'https://poedb.tw/us/X')
    await openItemOnPoedb('原始文字', mk(resolveUrl).deps)
    expect(resolveUrl).toHaveBeenCalledWith('原始文字')
  })

  it('T8 解析不出物品(null)→ 不開網頁、記一行 [poedb]、回 false', async () => {
    const { open, log, deps } = mk(async () => null)
    expect(await openItemOnPoedb('clip', deps)).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('[poedb]')
  })

  it('T8 resolveUrl 丟例外 → 不往外拋、不開網頁、記一行 [poedb]、回 false', async () => {
    const { open, log, deps } = mk(async () => { throw new Error('parse boom') })
    await expect(openItemOnPoedb('clip', deps)).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('[poedb]')
  })
})

describe('createTimer', () => {
  const clock = () => {
    let t = 1_000_000
    return { now: () => t, advance: (ms: number) => { t += ms } }
  }

  it('T9 暫停期間不計時:跑 5 秒 → 停 3 秒 → 再跑 2 秒 = 7000 ms', () => {
    const c = clock()
    const timer = createTimer(c.now)
    timer.start()
    c.advance(5000)
    timer.stop()
    expect(timer.elapsedMs()).toBe(5000)
    c.advance(3000)
    expect(timer.elapsedMs()).toBe(5000)
    timer.start()
    c.advance(2000)
    expect(timer.elapsedMs()).toBe(7000)
    expect(formatHms(timer.elapsedMs())).toBe('00:00:07')
  })

  it('T9 toggle 在開始與暫停間切換,running 跟著變', () => {
    const c = clock()
    const timer = createTimer(c.now)
    expect(timer.running).toBe(false)
    expect(timer.elapsedMs()).toBe(0)
    timer.toggle()
    expect(timer.running).toBe(true)
    c.advance(1500)
    timer.toggle()
    expect(timer.running).toBe(false)
    expect(timer.elapsedMs()).toBe(1500)
  })

  it('T9 跑著時重複 start 不會重置已累計的時間', () => {
    const c = clock()
    const timer = createTimer(c.now)
    timer.start()
    c.advance(4000)
    timer.start()
    c.advance(1000)
    expect(timer.elapsedMs()).toBe(5000)
  })

  it('T10 跑著時 reset → 歸零後從 0 繼續跑(仍在 running)', () => {
    const c = clock()
    const timer = createTimer(c.now)
    timer.start()
    c.advance(10_000)
    timer.reset()
    expect(timer.running).toBe(true)
    expect(timer.elapsedMs()).toBe(0)
    c.advance(4000)
    expect(timer.elapsedMs()).toBe(4000)
  })

  it('T10 停止時 reset → 歸零且維持停止,之後不會自己長', () => {
    const c = clock()
    const timer = createTimer(c.now)
    timer.start()
    c.advance(3000)
    timer.stop()
    timer.reset()
    expect(timer.running).toBe(false)
    expect(timer.elapsedMs()).toBe(0)
    c.advance(5000)
    expect(timer.elapsedMs()).toBe(0)
  })
})

describe('formatHms', () => {
  it('T9 兩位補零,秒無條件捨去', () => {
    expect(formatHms(0)).toBe('00:00:00')
    expect(formatHms(7_999)).toBe('00:00:07')
    expect(formatHms(59_999)).toBe('00:00:59')
    expect(formatHms(60_000)).toBe('00:01:00')
    expect(formatHms(3_661_000)).toBe('01:01:01')
  })
})

describe('timerVisible', () => {
  it('T11 顯示時機矩陣:active = 跑著或有累計;always 永遠;off 永遠不', () => {
    const cases: Array<['active' | 'always' | 'off', boolean, number, boolean]> = [
      ['active', false, 0, false],
      ['active', true, 0, true],
      ['active', false, 1, true],
      ['active', true, 5000, true],
      ['always', false, 0, true],
      ['always', true, 5000, true],
      ['off', false, 0, false],
      ['off', true, 5000, false]
    ]
    for (const [mode, running, ms, want] of cases) {
      expect(timerVisible(mode, running, ms), `${mode} running=${running} ms=${ms}`).toBe(want)
    }
  })
})

describe('設定往返(T12)', () => {
  it('T12 全新與舊設定檔(沒有這些欄位)→ 預設值,且寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.hotkeyPoedb).toBe('')
      expect(config.hotkeyTimerToggle).toBe('')
      expect(config.hotkeyTimerReset).toBe('')
      expect(config.timerDisplay).toBe('active')
      expect(config.timerPos).toBeNull()
      const out = JSON.parse(serialized)
      expect(out.hotkeyPoedb).toBe('')
      expect(out.timerDisplay).toBe('active')
      expect(out.timerPos).toBeNull()
    }
  })

  it('T12 設過的值讀得回來、寫得出去', () => {
    const raw = JSON.stringify({
      hotkeyPoedb: 'Ctrl + Shift + Q', hotkeyTimerToggle: 'F1', hotkeyTimerReset: 'F2',
      timerDisplay: 'always', timerPos: { x: 0.25, y: 0.75 }
    })
    const { config, serialized } = _roundTripForTest(raw)
    expect(config).toMatchObject({
      hotkeyPoedb: 'Ctrl + Shift + Q', hotkeyTimerToggle: 'F1', hotkeyTimerReset: 'F2',
      timerDisplay: 'always', timerPos: { x: 0.25, y: 0.75 }
    })
    expect(JSON.parse(serialized)).toMatchObject({ hotkeyPoedb: 'Ctrl + Shift + Q', timerDisplay: 'always', timerPos: { x: 0.25, y: 0.75 } })
    // 寫出的檔可以被自己讀回
    expect(_roundTripForTest(serialized).config).toMatchObject({ timerDisplay: 'always', timerPos: { x: 0.25, y: 0.75 } })
  })

  it('T12 壞值 → 回預設(timerDisplay 非三選一、timerPos 不是座標)', () => {
    const { config } = _roundTripForTest('{"timerDisplay":"bogus","timerPos":{"x":"a","y":null}}')
    expect(config.timerDisplay).toBe('active')
    expect(config.timerPos).toBeNull()
  })
})

describe('熱鍵總表與衝突檢查(T13)', () => {
  function fullConfig (game: 'poe1' | 'poe2'): HotkeyConfigLike {
    return {
      hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space', game,
      hotkeyOcrReveal: 'Ctrl + Shift + R', hotkeyOcrRegion: '', hotkeyRuneshapeToggle: '', hotkeyRuneshapeRegion: '',
      revealAutoEnabled: true, runeshapeEnabled: true, hotkeyStashToggle: '', hotkeyStashRegion: '', stashPricesEnabled: true,
      commands: [], stashSearch: [], hotkeyRegexQuick: '', regexBookmarkHotkeys: [],
      hotkeyPoedb: 'Ctrl + Shift + Q', hotkeyTimerToggle: 'F1', hotkeyTimerReset: 'F2'
    } as HotkeyConfigLike
  }

  it('T13 overlay:tools 群組依序列 poedb / timerToggle / timerReset,欄位接對', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      const g = hotkeyTable(fullConfig(game), { overlay: true }).find(x => x.id === 'tools')
      expect(g, game).toBeDefined()
      expect(g!.rows.map(r => r.kind === 'edit' ? [r.id, r.field, r.optional === true] : r.id)).toEqual([
        ['poedb', 'hotkeyPoedb', true],
        ['timerToggle', 'hotkeyTimerToggle', true],
        ['timerReset', 'hotkeyTimerReset', true]
      ])
    }
  })

  it('T13 window 模式:tools 群組只有 poedb', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      const g = hotkeyTable(fullConfig(game), { overlay: false }).find(x => x.id === 'tools')
      expect(g?.rows.map(r => r.id), game).toEqual(['poedb'])
    }
  })

  it('T13 三個欄位都列入選填熱鍵(預設空時顯示灰字「未設定」而非紅字)', () => {
    for (const f of ['hotkeyPoedb', 'hotkeyTimerToggle', 'hotkeyTimerReset']) {
      expect(OPTIONAL_HOTKEY_FIELDS, f).toContain(f)
    }
  })

  it('T13 衝突檢查涵蓋三個新熱鍵,且值經正規化', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      const slots = hotkeySlots(fullConfig(game))
      expect(slots.find(s => s.id === 'poedb')?.hotkey, game).toBe('Ctrl + Shift + Q')
      expect(slots.find(s => s.id === 'timerToggle')?.hotkey, game).toBe('F1')
      expect(slots.find(s => s.id === 'timerReset')?.hotkey, game).toBe('F2')
    }
  })
})

describe('overlay 圖層回報(T14)', () => {
  it('T14 overlayLayers 有 timer 鍵(布林),計時器顯示時 overlay 不會被閒置隱藏', () => {
    expect('timer' in overlayLayers).toBe(true)
    expect(typeof (overlayLayers as Record<string, unknown>).timer).toBe('boolean')
  })
})

describe('字串兩語(T15)', () => {
  const KEYS = [
    'hk.poedb', 'hk.timer_toggle', 'hk.timer_reset', 'hk_group.tools',
    'timer.section', 'timer.display_active', 'timer.display_always', 'timer.display_off',
    'timer.menu_toggle', 'timer.menu_reset'
  ]
  const lookup = (obj: any, key: string) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
  for (const [name, file] of [['繁中', 'cmn-Hant'], ['英文', 'en']] as const) {
    it(`T15 ${name}:十個鍵都有非空字串`, () => {
      const ppz = JSON.parse(read(`renderer/src/i18n/${file}.json`)).ppz
      for (const k of KEYS) {
        const v = lookup(ppz, k)
        expect(typeof v, `${file} ppz.${k}`).toBe('string')
        expect((v as string).trim().length, `${file} ppz.${k}`).toBeGreaterThan(0)
      }
    })
  }
})

describe('App.vue 接線守門(T7)', () => {
  const app = read('renderer/src/web/App.vue')

  it('T7 App.vue 引入 poedb-open', () => {
    expect(app).toMatch(/import[^\n]*\bopenItemOnPoedb\b[^\n]*poedb-open/)
  })

  it('T7 handleItemText:target 為 poedb 時呼叫 openItemOnPoedb 並在開面板前 return', () => {
    const start = app.indexOf('function handleItemText')
    expect(start).toBeGreaterThan(-1)
    const body = app.slice(start, app.indexOf('\n    function hidePanel', start))
    const m = /target === ['"]poedb['"]/.exec(body)
    expect(m, 'handleItemText 要判斷 target === poedb').not.toBeNull()
    const after = body.slice(m!.index)
    const open = after.indexOf('openItemOnPoedb(')
    const ret = after.search(/\breturn\b/)
    const panel = after.indexOf('panelShown.value = true')
    expect(open, '要呼叫 openItemOnPoedb').toBeGreaterThan(-1)
    expect(ret).toBeGreaterThan(open)
    expect(panel, '開面板的程式在 return 之後').toBeGreaterThan(ret)
  })
})
