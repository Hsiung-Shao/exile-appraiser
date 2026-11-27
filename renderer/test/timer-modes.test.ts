// 計時器三種模式(speedrun / 碼表 / 倒數):熱鍵分派、Client.txt 開關、設定往返與壞值、原始碼守門。假時鐘,不開視窗、不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { presetRoute } from '../../core/src/speedrun/routes'
import { _roundTripForTest, AppConfig, hostConfigOf } from '../src/web/Config'
import * as timer from '../src/web/overlay/timer-state'

const { appRun, timerAction, timerArea } = timer
const simpleTimer = (timer as any).simpleTimer as {
  phase: string, durationMs: number | null, reset: () => void
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

describe('非 speedrun 模式的熱鍵分派', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const c = AppConfig() as any
    c.game = 'poe1'
    c.timerDisplay = 'active'
    c.timerMode = 'stopwatch'
    c.timerCountdownSec = 300
    c.speedrun.poe1 = { ...presetRoute('poe1', 'cmn-Hant'), autoSplit: true, autoStart: true }
    for (let i = 0; i < 5; i++) await nextTick()
    appRun.value.reset()
    simpleTimer.reset()
  })
  afterEach(() => {
    ;(AppConfig() as any).timerMode = 'speedrun'
    appRun.value.reset()
    simpleTimer.reset()
    vi.useRealTimers()
  })

  it('T9 碼表 toggle:idle → running → paused → running,且不動 speedrun 的 run', () => {
    timerAction('toggle')
    expect(simpleTimer.phase).toBe('running')
    expect(simpleTimer.durationMs).toBeNull()
    timerAction('toggle')
    expect(simpleTimer.phase).toBe('paused')
    timerAction('toggle')
    expect(simpleTimer.phase).toBe('running')
    expect(appRun.value.phase).toBe('idle')
  })

  it('T9 undo / skip 在碼表模式沒有作用', () => {
    timerAction('toggle')
    timerAction('undo')
    timerAction('skip')
    expect(simpleTimer.phase).toBe('running')
    expect(appRun.value.phase).toBe('idle')
    expect(appRun.value.index).toBe(0)
  })

  it('T9 pause 熱鍵:running ⇄ paused;reset 歸零回 idle', () => {
    timerAction('toggle')
    timerAction('pause')
    expect(simpleTimer.phase).toBe('paused')
    timerAction('pause')
    expect(simpleTimer.phase).toBe('running')
    timerAction('reset')
    expect(simpleTimer.phase).toBe('idle')
    expect(appRun.value.phase).toBe('idle')
  })

  it('T9 倒數模式 toggle 開始 → durationMs = timerCountdownSec × 1000', () => {
    const c = AppConfig() as any
    c.timerMode = 'countdown'
    c.timerCountdownSec = 120
    timerAction('toggle')
    expect(simpleTimer.phase).toBe('running')
    expect(simpleTimer.durationMs).toBe(120_000)
    expect(appRun.value.phase).toBe('idle')
  })

  it('T9 非 speedrun 時進入區域不會讓 speedrun run 自動開始', () => {
    timerArea(presetRoute('poe1', 'cmn-Hant').startArea as string)
    expect(appRun.value.phase).toBe('idle')
  })
})

describe('非 speedrun 不讀 Client.txt', () => {
  it('T10 碼表 / 倒數 → speedrunAutoLog false;切回 speedrun → true', () => {
    const c = AppConfig() as any
    c.game = 'poe1'
    c.speedrun.poe1 = { ...presetRoute('poe1', 'cmn-Hant'), autoSplit: true }
    try {
      c.timerMode = 'stopwatch'
      expect(hostConfigOf(c, []).speedrunAutoLog).toBe(false)
      c.timerMode = 'countdown'
      expect(hostConfigOf(c, []).speedrunAutoLog).toBe(false)
      c.timerMode = 'speedrun'
      expect(hostConfigOf(c, []).speedrunAutoLog).toBe(true)
    } finally {
      c.timerMode = 'speedrun'
    }
  })
})

describe('計時器設定往返與壞值', () => {
  const rt = (obj: unknown) => _roundTripForTest(JSON.stringify(obj)) as { config: any, serialized: string }

  it('T11 舊檔沒有這些欄位 → 預設值', () => {
    const { config } = rt({})
    expect(config.timerMode).toBe('speedrun')
    expect(config.timerCountdownSec).toBe(300)
    expect(config.timerAlertMin).toBe(0)
    expect(config.timerSound).toEqual({ file: '', volume: 0.7 })
  })

  it('T11 壞值:模式不認得 → speedrun、秒數 -5 → 1、音量 3 → 1', () => {
    const { config } = rt({ timerMode: 'x', timerCountdownSec: -5, timerSound: { file: '', volume: 3 } })
    expect(config.timerMode).toBe('speedrun')
    expect(config.timerCountdownSec).toBe(1)
    expect(config.timerSound.volume).toBe(1)
  })

  it('T11 壞值:非數字秒數 → 300、超大秒數 → 86400、提醒分鐘夾 0–600、音量負值 → 0', () => {
    expect(rt({ timerCountdownSec: 'abc' }).config.timerCountdownSec).toBe(300)
    expect(rt({ timerCountdownSec: 9_999_999 }).config.timerCountdownSec).toBe(86_400)
    expect(rt({ timerAlertMin: -3 }).config.timerAlertMin).toBe(0)
    expect(rt({ timerAlertMin: 99_999 }).config.timerAlertMin).toBe(600)
    expect(rt({ timerSound: { file: '', volume: -1 } }).config.timerSound.volume).toBe(0)
  })

  it('T11 正常值往返不變(載入與寫出都保留)', () => {
    const input = { timerMode: 'countdown', timerCountdownSec: 120, timerAlertMin: 5, timerSound: { file: 'a.mp3', volume: 0.5 } }
    const { config, serialized } = rt(input)
    expect(config.timerMode).toBe('countdown')
    expect(config.timerCountdownSec).toBe(120)
    expect(config.timerAlertMin).toBe(5)
    expect(config.timerSound).toEqual({ file: 'a.mp3', volume: 0.5 })
    const out = JSON.parse(serialized)
    expect(out.timerMode).toBe('countdown')
    expect(out.timerCountdownSec).toBe(120)
    expect(out.timerAlertMin).toBe(5)
    expect(out.timerSound).toEqual({ file: 'a.mp3', volume: 0.5 })
  })
})

describe('T13 原始碼守門', () => {
  it('T13 main.ts 的 sound-pick handler 存在且同一物件內 preview: false', () => {
    const src = read('main/src/main.ts')
    const start = src.indexOf("'sound-pick'")
    expect(start).toBeGreaterThan(-1)
    const rest = src.slice(start + 12)
    const next = rest.search(/\n {4}'[\w-]+': /)
    const body = next < 0 ? rest : rest.slice(0, next)
    expect(body).toMatch(/preview:\s*false/)
  })

  it('T13 Timer.vue 有 data-setting="timer-mode"', () => {
    expect(read('renderer/src/web/settings/tabs/Timer.vue')).toContain('data-setting="timer-mode"')
  })

  it('T13 兩語 i18n 的 ppz.timer 都有模式與音效鍵', () => {
    for (const f of ['cmn-Hant', 'en']) {
      const t = JSON.parse(read(`renderer/src/i18n/${f}.json`)).ppz.timer
      for (const k of ['mode_speedrun', 'mode_stopwatch', 'mode_countdown', 'sound_test', 'sound_pick']) {
        expect(typeof t[k], `${f} ${k}`).toBe('string')
        expect(t[k].length, `${f} ${k}`).toBeGreaterThan(0)
      }
    }
  })
})
