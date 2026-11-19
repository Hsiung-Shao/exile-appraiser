// 計時器切窗暫停(timerFocus)與 PoE1 舊城鎮分段清單的設定遷移。假時鐘,不開視窗、不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { presetRoute, type Route } from '../../core/src/speedrun/routes'
import { _roundTripForTest, AppConfig } from '../src/web/Config'
import * as timer from '../src/web/overlay/timer-state'

const { appRun, timerAction, timerArea } = timer
const timerFocus = (focused: boolean) => (timer as any).timerFocus(focused) as void

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NEW_POE1 = ['1_2_1', '1_3_1', '1_4_1', '1_5_1', '2_6_town', '2_7_town', '2_8_1', '2_9_1', '2_10_town', '2_11_endgame_town']
const OLD_POE1 = ['1_2_town', '1_3_town', '1_4_town', '1_5_town', '2_6_town', '2_7_town', '2_8_town', '2_9_town', '2_10_town', '2_11_endgame_town']
const areasOf = (r: Route) => r.splits.map(s => s.area)

describe('timerFocus 切窗暫停', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const c = AppConfig()
    c.game = 'poe1'
    c.timerDisplay = 'active'
    c.speedrun.poe1 = { ...presetRoute('poe1', 'cmn-Hant'), autoSplit: true }
    for (let i = 0; i < 5; i++) await nextTick()
    appRun.value.reset()
  })
  afterEach(() => {
    appRun.value.reset()
    vi.useRealTimers()
  })

  it('T9 計時中失焦 → 暫停', () => {
    appRun.value.start()
    vi.advanceTimersByTime(1000)
    timerFocus(false)
    expect(appRun.value.phase).toBe('paused')
  })

  it('T10 失焦 5 秒後回來 → 繼續計時,累計不含離開的 5 秒', () => {
    appRun.value.start()
    vi.advanceTimersByTime(2000)
    timerFocus(false)
    vi.advanceTimersByTime(5000)
    timerFocus(true)
    expect(appRun.value.phase).toBe('running')
    vi.advanceTimersByTime(1000)
    expect(appRun.value.elapsed()).toBe(3000)
  })

  it('main 送 away(從自己的面板切到別的視窗)→ 暫停,回到遊戲自動繼續(審查 2026-11-20)', () => {
    appRun.value.start()
    vi.advanceTimersByTime(1000)
    timerAction('away' as any)
    expect(appRun.value.phase).toBe('paused')
    timerFocus(true)
    expect(appRun.value.phase).toBe('running')
  })

  it('T11 手動暫停後失焦再回來 → 仍是暫停(不替使用者繼續)', () => {
    appRun.value.start()
    vi.advanceTimersByTime(1000)
    timerAction('pause')
    expect(appRun.value.phase).toBe('paused')
    timerFocus(false)
    timerFocus(true)
    expect(appRun.value.phase).toBe('paused')
  })

  it('切窗暫停期間手動繼續,之後回來不出錯、維持計時中', () => {
    appRun.value.start()
    vi.advanceTimersByTime(1000)
    timerFocus(false)
    timerAction('pause')
    expect(appRun.value.phase).toBe('running')
    expect(() => timerFocus(true)).not.toThrow()
    expect(appRun.value.phase).toBe('running')
  })

  it('切窗暫停期間重設,回來後維持 idle(不會自己開始)', () => {
    appRun.value.start()
    vi.advanceTimersByTime(1000)
    timerFocus(false)
    timerAction('reset')
    timerFocus(true)
    expect(appRun.value.phase).toBe('idle')
  })

  it('沒在跑時失焦 / 回來都沒有作用(仍 idle)', () => {
    timerFocus(false)
    expect(appRun.value.phase).toBe('idle')
    timerFocus(true)
    expect(appRun.value.phase).toBe('idle')
  })

  it('T13 切窗暫停中進入目標區域 → 分段(index 0 → 1),段時間 = 暫停當下累計,仍是暫停,回來後繼續', () => {
    appRun.value.start()
    vi.advanceTimersByTime(2000)
    timerFocus(false)
    vi.advanceTimersByTime(3000)
    timerArea('1_2_1')
    expect(appRun.value.index).toBe(1)
    expect(appRun.value.splitTimes[0]).toBe(2000)
    expect(appRun.value.phase).toBe('paused')
    timerFocus(true)
    expect(appRun.value.phase).toBe('running')
  })

  it('T12 App.vue 以「自己的 overlay 面板拿焦點不算切窗」的條件呼叫 timerFocus', () => {
    const src = fs.readFileSync(path.join(root, 'renderer/src/web/App.vue'), 'utf8')
    expect(src).toContain('timerFocus(state.game || state.overlay)')
  })
})

describe('PoE1 舊城鎮分段清單的設定遷移', () => {
  const rt = (obj: unknown) => _roundTripForTest(JSON.stringify(obj)) as any
  const oldRoute = (): Route => ({
    ...presetRoute('poe1', 'cmn-Hant'),
    splits: presetRoute('poe1', 'cmn-Hant').splits.map((s, i) => ({ ...s, area: OLD_POE1[i] })),
    pb: OLD_POE1.map((_, i) => (i + 1) * 1000),
    golds: OLD_POE1.map(() => 1000),
    attempts: 5
  })

  it('T7 configVersion 2 + 舊內建清單 → 區域換新、紀錄清空、場次保留,存檔版本為 3', () => {
    const { config, serialized } = rt({ configVersion: 2, speedrun: { poe1: oldRoute() } })
    const r = config.speedrun.poe1 as Route
    expect(areasOf(r)).toEqual(NEW_POE1)
    expect(r.pb).toBeNull()
    expect(r.golds).toEqual(Array(10).fill(null))
    expect(r.attempts).toBe(5)
    expect(JSON.parse(serialized).configVersion).toBe(3)
  })

  it('T8 configVersion 2 + 某段區域被使用者改過 → 區域與紀錄原樣', () => {
    const custom = oldRoute()
    custom.splits[0] = { ...custom.splits[0], area: '1_1_town' }
    const r = rt({ configVersion: 2, speedrun: { poe1: custom } }).config.speedrun.poe1 as Route
    expect(areasOf(r)).toEqual(['1_1_town', ...OLD_POE1.slice(1)])
    expect(r.pb).toEqual(custom.pb)
    expect(r.golds).toEqual(custom.golds)
  })

  it('configVersion 3 + 舊城鎮清單(使用者自己選回)→ 不轉換、紀錄保留', () => {
    const mine = oldRoute()
    const r = rt({ configVersion: 3, speedrun: { poe1: mine } }).config.speedrun.poe1 as Route
    expect(areasOf(r)).toEqual(OLD_POE1)
    expect(r.pb).toEqual(mine.pb)
    expect(r.golds).toEqual(mine.golds)
  })

  it('poe2 路線在遷移時不被動到(區域與紀錄原樣)', () => {
    const base = presetRoute('poe2', 'cmn-Hant')
    const poe2: Route = { ...base, pb: base.splits.map((_, i) => (i + 1) * 1000), golds: base.splits.map(() => 500), attempts: 3 }
    const r = rt({ configVersion: 2, speedrun: { poe1: oldRoute(), poe2 } }).config.speedrun.poe2 as Route
    expect(areasOf(r)).toEqual(areasOf(base))
    expect(r.pb).toEqual(poe2.pb)
    expect(r.golds).toEqual(poe2.golds)
    expect(r.attempts).toBe(3)
  })
})
