/**
 * 2026-11-10 speedrun 計時器元件真掛載:跑到第 3 段時分段列、差值顏色、金段、主計時顏色。
 * 時間用假 Date.now;不連網、不送輸入。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { initConfig, AppConfig } from '../src/web/Config'
import { appRun, timerAction } from '../src/web/overlay/timer-state'
import TimerWidget from '../src/web/overlay/TimerWidget.vue'
import { presetRoute } from '../../core/src/speedrun/routes'
import { mount, text, findAll, byAttr } from './mini-dom'

const ROOT = path.resolve(__dirname, '../..')
const i18n = () => {
  const load = (lang: string) => JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
  return createI18n({ legacy: false, locale: 'cmn-Hant', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: load('en'), 'cmn-Hant': load('cmn-Hant') } })
}
const settle = async () => { for (let i = 0; i < 5; i++) await nextTick() }

let now = 1_000_000
beforeAll(async () => { await initConfig() })
afterEach(() => { vi.restoreAllMocks(); timerAction('reset') })

describe('speedrun 計時器元件', () => {
  it('跑到第 3 段:已完成段顯示累計與差值(快綠 / 慢紅 / 金段金)、目前段亮起、主計時落後變紅', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const c = AppConfig()
    c.game = 'poe1'
    c.timerDisplay = 'active'
    c.speedrunRows = 5
    const route = presetRoute('poe1', 'cmn-Hant')
    // PB:每段 60 秒;金段:第 1 段 50 秒(這次 55 秒不是金段)、第 2 段 70 秒(這次 65 秒 = 新金段)
    route.pb = route.splits.map((_, i) => (i + 1) * 60_000)
    route.golds = route.splits.map((_, i) => i === 0 ? 50_000 : i === 1 ? 70_000 : 60_000)
    c.speedrun.poe1 = route
    await settle()

    timerAction('toggle') // 開始
    now += 55_000; timerAction('toggle') // 第 1 段 55 秒:比 PB 快 5 秒
    now += 65_000; timerAction('toggle') // 第 2 段 65 秒:累計 120 秒 = PB,段時間是新金段
    now += 70_000 // 第 3 段已跑 70 秒,累計 190 秒 > PB 180 秒
    expect(appRun.value.index).toBe(2)

    const Root = defineComponent({ setup: () => () => h(TimerWidget, { interactive: false }) })
    const { container, app } = mount(Root, [i18n()])
    await settle()
    const rows = findAll(container, byAttr('data-split'))
    expect(rows.length).toBe(5)
    const row = (i: number) => rows.find(r => r.attrs['data-split'] === i)!
    expect(text(row(0))).toContain('−5.0')
    expect(text(row(0))).toContain('0:55.00')
    // 第 2 段:累計與 PB 相同(差值 +0.0),但段時間是新金段 → 金色
    const delta2 = findAll(row(1), n => String(n.attrs.class ?? '').includes('tm-delta'))[0]
    expect(String(delta2.attrs.class)).toContain('gold')
    // 目前段(第 3 段)亮起,即時差值 +10.0 紅色
    expect(String(row(2).attrs.class)).toContain('cur')
    expect(text(row(2))).toContain('+10.0')
    // 主計時 3:10.00 落後 → bad
    const main = findAll(container, byAttr('data-timer', 'main'))[0]
    expect(text(main)).toBe('3:10.00')
    expect(String(main.attrs.class)).toContain('bad')
    app.unmount()
  })
})

describe('審查修正(2026-11-10)', () => {
  it('顯示幾段 = 1:那一列是目前這段(不是下一段)', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const c = AppConfig()
    c.game = 'poe1'
    c.timerDisplay = 'active'
    c.speedrunRows = 1
    c.speedrun.poe1 = presetRoute('poe1', 'cmn-Hant')
    await settle()
    timerAction('toggle')
    now += 10_000; timerAction('toggle')
    now += 10_000; timerAction('toggle')
    now += 5_000
    expect(appRun.value.index).toBe(2)
    const Root = defineComponent({ setup: () => () => h(TimerWidget, { interactive: false }) })
    const { container, app } = mount(Root, [i18n()])
    await settle()
    const rows = findAll(container, byAttr('data-split'))
    expect(rows.map(r => r.attrs['data-split'])).toEqual([2])
    expect(String(rows[0].attrs.class)).toContain('cur')
    app.unmount()
    c.speedrunRows = 5
  })
})

describe('審查修正第 2 輪(2026-11-10):run 不綁路線物件', () => {
  it('設定被重新套用(整個 speedrun 換成內容相同的新物件)→ 進行中的計時照跑、紀錄寫進新的路線物件', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const c = AppConfig()
    c.game = 'poe1'
    c.speedrun.poe1 = presetRoute('poe1', 'cmn-Hant')
    await settle()
    timerAction('toggle')
    now += 30_000; timerAction('toggle')
    const before = appRun.value
    expect(before.index).toBe(1)
    // 模擬瀏覽器預覽存檔 → applyLoaded 換掉整個 speedrun(也包含改名這種內容不同的情況)
    const clone = JSON.parse(JSON.stringify(c.speedrun))
    clone.poe1.splits[0].name = '改名'
    c.speedrun = clone
    await settle()
    expect(appRun.value).toBe(before)
    expect(appRun.value.phase).toBe('running')
    expect(appRun.value.index).toBe(1)
    now += 20_000; timerAction('toggle')
    expect(c.speedrun.poe1.golds[1]).toBe(20_000)
  })

  it('分段數改了 → 進行中的計時重設(對不上新清單)', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const c = AppConfig()
    c.game = 'poe1'
    timerAction('toggle')
    now += 10_000
    expect(appRun.value.phase).toBe('running')
    c.speedrun.poe1 = { ...c.speedrun.poe1, splits: c.speedrun.poe1.splits.slice(0, 3), golds: [null, null, null], pb: null }
    await settle()
    expect(appRun.value.phase).toBe('idle')
  })
})

describe('審查修正第 3 輪(2026-11-10):作廢的紀錄不被快照寫回', () => {
  it('進行中改了某段的觸發區域(段數不變)→ 重設,下一次分段不把舊紀錄寫回', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const c = AppConfig()
    c.game = 'poe1'
    const r = presetRoute('poe1', 'cmn-Hant')
    r.pb = r.splits.map((_, i) => (i + 1) * 10_000)
    r.golds = r.splits.map(() => 10_000)
    c.speedrun.poe1 = r
    await settle()
    timerAction('toggle')
    now += 10_000; timerAction('toggle')
    const next = c.speedrun.poe1.splits.map(s => ({ ...s }))
    next[1].area = null
    c.speedrun.poe1 = { ...c.speedrun.poe1, splits: next, pb: null, golds: next.map(() => null) }
    await settle()
    expect(appRun.value.phase).toBe('idle')
    timerAction('toggle')
    now += 5_000; timerAction('toggle')
    expect(c.speedrun.poe1.pb).toBeNull()
    expect(c.speedrun.poe1.golds.slice(1).every(g => g == null)).toBe(true)
  })

  it('另一端清除紀錄(紀錄變全空)→ 重設;下一次分段不寫回舊紀錄', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const c = AppConfig()
    c.game = 'poe1'
    const r = presetRoute('poe1', 'cmn-Hant')
    r.golds = r.splits.map(() => 10_000)
    c.speedrun.poe1 = r
    await settle()
    timerAction('toggle')
    now += 20_000; timerAction('toggle')
    c.speedrun.poe1 = { ...c.speedrun.poe1, pb: null, golds: c.speedrun.poe1.splits.map(() => null) }
    await settle()
    expect(appRun.value.phase).toBe('idle')
  })
})
