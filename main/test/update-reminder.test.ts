// 第 34 步:有新版本時每 10 分鐘提醒(`src/update-reminder.ts`)+ 定期重新檢查(`updater-core.ts` `shouldPeriodicCheck` / `periodicCheck`)。
// 排程用假時鐘(手動推進的計時器佇列),不碰 electron。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { UpdaterInfo } from '@ipc/types'
import {
  HoverPausedCountdown, UPDATE_REMINDER_INTERVAL_MS, UPDATE_REMINDER_RETRY_MS, UPDATE_REMINDER_SIZE, UPDATE_REMINDER_VISIBLE_MS,
  UpdateReminderScheduler, isTransientUpdaterState, normSkippedVersion, pointInBounds, reminderBounds, reminderButtonFromUrl, reminderHtml,
  reminderMessage, reminderTarget, type ReminderTarget
} from '../src/update-reminder'
import { UPDATE_RECHECK_INTERVAL_MS, UpdaterCore, shouldPeriodicCheck, type UpdaterLike } from '../src/updater-core'
import { TOAST_FADE_MS, TOAST_MARGIN } from '../src/startup-toast'
import { reminderDevOptions } from '../src/cli-flags'

const MIN = 60_000
const info = (p: Partial<UpdaterInfo>): UpdaterInfo => ({ state: 'initial', reason: 'unsigned-build', autoUpdate: true, currentVersion: '0.1.2', ...p })

describe('reminderTarget:只有新版才有目標', () => {
  it('downloaded → install;available 安裝版 → download;available portable → releases', () => {
    expect(reminderTarget(info({ state: 'downloaded', version: '0.2.0', releaseNotesUrl: 'u' }))).toEqual({ version: '0.2.0', action: 'install', url: 'u', autoUpdate: true })
    expect(reminderTarget(info({ state: 'available', version: '0.2.0', autoUpdate: false }))?.action).toBe('download')
    expect(reminderTarget(info({ state: 'available', version: '0.2.0', reason: 'not-supported' }))?.action).toBe('releases')
  })
  it('沒有新版 / 下載中 / 檢查中 / 失敗 / 還沒檢查 → null(絕不彈)', () => {
    for (const state of ['initial', 'checking', 'not-available', 'downloading', 'error'] as const) {
      expect(reminderTarget(info({ state, version: '0.2.0' })), state).toBeNull()
    }
    expect(reminderTarget(info({ state: 'available' }))).toBeNull() // 沒有版號
  })
  it('--no-updates 一律 null;版號不比目前新 → null', () => {
    expect(reminderTarget(info({ state: 'downloaded', version: '0.2.0', reason: 'disabled-by-flag' }))).toBeNull()
    expect(reminderTarget(info({ state: 'downloaded', version: '0.1.2' }))).toBeNull()
    expect(reminderTarget(info({ state: 'available', version: '0.1.1' }))).toBeNull()
  })
  it('checking / error 是暫時狀態', () => {
    expect(isTransientUpdaterState('checking')).toBe(true)
    expect(isTransientUpdaterState('error')).toBe(true)
    expect(isTransientUpdaterState('not-available')).toBe(false)
  })
})

/** 假時鐘:setTimeout 進佇列,`advance(ms)` 依時間順序觸發 */
function fakeTimers () {
  let now = 1_000_000
  let seq = 0
  const q = new Map<number, { at: number, fn: () => void }>()
  return {
    timers: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => { const id = ++seq; q.set(id, { at: now + ms, fn }); return id },
      clearTimeout: (h: unknown) => { q.delete(h as number) }
    },
    advance (ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...q.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        q.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = end
    },
    get pending () { return q.size },
    get now () { return now }
  }
}

function setup (opts: { otherToast?: () => boolean, interval?: number } = {}) {
  const clock = fakeTimers()
  const shown: ReminderTarget[] = []
  const persisted: string[] = []
  let hides = 0
  const s = new UpdateReminderScheduler({
    timers: clock.timers,
    canShow: () => !(opts.otherToast?.() ?? false),
    show: (t) => { shown.push(t) },
    hide: () => { hides++ },
    persistSkip: (v) => { persisted.push(v) },
    intervalMs: opts.interval
  })
  s.setConfig({ enabled: true, skippedVersion: null })
  s.setBlocked(false)
  return { s, clock, shown, persisted, hides: () => hides }
}

describe('UpdateReminderScheduler', () => {
  it('沒有新版絕不彈(已是最新 / 只有 checking)', () => {
    const { s, clock, shown } = setup()
    s.setInfo(info({ state: 'checking' }))
    s.setInfo(info({ state: 'not-available' }))
    clock.advance(60 * MIN)
    expect(shown).toEqual([])
    expect(clock.pending).toBe(0)
  })
  it('偵測到新版立刻一次,淡出後每 10 分鐘一次', () => {
    const { s, clock, shown } = setup()
    s.setInfo(info({ state: 'downloaded', version: '0.2.0' }))
    clock.advance(0)
    expect(shown.length).toBe(1)
    expect(s.isVisible).toBe(true)
    clock.advance(30 * MIN) // 畫面上有提醒時不排下一次
    expect(shown.length).toBe(1)
    s.closed('timeout')
    clock.advance(UPDATE_REMINDER_INTERVAL_MS - 1)
    expect(shown.length).toBe(1)
    clock.advance(1)
    expect(shown.length).toBe(2)
    expect(UPDATE_REMINDER_INTERVAL_MS).toBe(10 * MIN)
  })
  it('「稍後」= 關閉,10 分鐘後再提醒', () => {
    const { s, clock, shown } = setup()
    s.setInfo(info({ state: 'available', version: '0.2.0', autoUpdate: false }))
    clock.advance(0)
    s.closed('later')
    expect(s.isVisible).toBe(false)
    expect(s.nextReminderAt).toBe(clock.now + 10 * MIN)
    clock.advance(10 * MIN)
    expect(shown.length).toBe(2)
  })
  it('「略過此版本」:同版號不再提醒、存進設定;新版號照常提醒', () => {
    const { s, clock, shown, persisted } = setup()
    s.setInfo(info({ state: 'downloaded', version: '0.2.0' }))
    clock.advance(0)
    s.skip()
    expect(persisted).toEqual(['0.2.0'])
    clock.advance(5 * 60 * MIN)
    expect(shown.length).toBe(1)
    // 重新檢查又回報同一版(例如 portable 每 2 小時)→ 仍不彈
    s.setInfo(info({ state: 'available', version: '0.2.0', reason: 'not-supported' }))
    clock.advance(60 * MIN)
    expect(shown.length).toBe(1)
    // 更新的版號 → 立刻提醒
    s.setInfo(info({ state: 'available', version: '0.3.0', reason: 'not-supported' }))
    clock.advance(0)
    expect(shown.map(t => t.version)).toEqual(['0.2.0', '0.3.0'])
  })
  it('略過的版號從設定讀回(重新啟動後);renderer 還沒存回來的舊值不會把 main 端的略過蓋掉', () => {
    const { s, clock, shown } = setup()
    s.setConfig({ enabled: true, skippedVersion: '0.2.0' })
    s.setInfo(info({ state: 'downloaded', version: '0.2.0' }))
    clock.advance(60 * MIN)
    expect(shown).toEqual([])
    const b = setup()
    b.s.setInfo(info({ state: 'downloaded', version: '0.4.0' }))
    b.clock.advance(0)
    b.s.skip()
    b.s.setConfig({ enabled: true, skippedVersion: null }) // 舊的 host-config(還沒有略過)
    b.clock.advance(60 * MIN)
    expect(b.shown.length).toBe(1)
  })
  it('安裝後(stop)不再提醒;已是最新 → 停止並收回畫面上的提醒', () => {
    const { s, clock, shown, hides } = setup()
    s.setInfo(info({ state: 'downloaded', version: '0.2.0' }))
    clock.advance(0)
    s.stop()
    expect(hides()).toBe(1)
    clock.advance(60 * MIN)
    expect(shown.length).toBe(1)
    const b = setup()
    b.s.setInfo(info({ state: 'available', version: '0.2.0', reason: 'not-supported' }))
    b.clock.advance(0)
    b.s.setInfo(info({ state: 'not-available' }))
    expect(b.hides()).toBe(1)
    b.clock.advance(60 * MIN)
    expect(b.shown.length).toBe(1)
    expect(b.clock.pending).toBe(0)
  })
  it('設定關閉 → 不彈(畫面上的收回);再打開 → 恢復提醒', () => {
    const { s, clock, shown, hides } = setup()
    s.setConfig({ enabled: false, skippedVersion: null })
    s.setInfo(info({ state: 'downloaded', version: '0.2.0' }))
    clock.advance(60 * MIN)
    expect(shown).toEqual([])
    s.setConfig({ enabled: true, skippedVersion: null })
    clock.advance(0)
    expect(shown.length).toBe(1)
    s.setConfig({ enabled: false, skippedVersion: null })
    expect(hides()).toBe(1)
    expect(s.isVisible).toBe(false)
  })
  it('預覽 / 還沒收到設定(blocked)→ 不彈', () => {
    const clock = fakeTimers()
    const shown: ReminderTarget[] = []
    const s = new UpdateReminderScheduler({ timers: clock.timers, canShow: () => true, show: (t) => { shown.push(t) }, hide: () => {}, persistSkip: () => {} })
    s.setInfo(info({ state: 'downloaded', version: '0.2.0' })) // 預設 blocked
    clock.advance(60 * MIN)
    expect(shown).toEqual([])
    s.setBlocked(false)
    clock.advance(0)
    expect(shown.length).toBe(1)
  })
  it('checking / error 沿用上一個目標(不重設計時、不停止);下載中 → 停止,下載完 → 立刻提醒安裝', () => {
    const { s, clock, shown } = setup()
    s.setInfo(info({ state: 'available', version: '0.2.0', autoUpdate: false }))
    clock.advance(0)
    s.closed('timeout')
    clock.advance(3 * MIN)
    s.setInfo(info({ state: 'checking', version: '0.2.0' }))
    s.setInfo(info({ state: 'error', version: '0.2.0' }))
    clock.advance(7 * MIN)
    expect(shown.length).toBe(2) // 間隔不受暫時狀態影響
    s.closed('action') // 按了「立即更新」→ 開始下載
    s.setInfo(info({ state: 'downloading', version: '0.2.0', autoUpdate: false }))
    clock.advance(30 * MIN)
    expect(shown.length).toBe(2)
    s.setInfo(info({ state: 'downloaded', version: '0.2.0', autoUpdate: false }))
    clock.advance(0)
    expect(shown.map(t => t.action)).toEqual(['download', 'download', 'install'])
  })
  it('畫面上有其他提示 → 延後重試,不互相覆蓋;被其他提示打斷 → 稍後再出現', () => {
    let other = true
    const { s, clock, shown } = setup({ otherToast: () => other })
    s.setInfo(info({ state: 'downloaded', version: '0.2.0' }))
    clock.advance(UPDATE_REMINDER_RETRY_MS * 3)
    expect(shown).toEqual([])
    other = false
    clock.advance(UPDATE_REMINDER_RETRY_MS)
    expect(shown.length).toBe(1)
    s.closed('interrupted')
    other = true
    clock.advance(UPDATE_REMINDER_RETRY_MS)
    expect(shown.length).toBe(1)
    other = false
    clock.advance(UPDATE_REMINDER_RETRY_MS)
    expect(shown.length).toBe(2)
  })
  it('同版號重複回報(定期重新檢查)不重設 10 分鐘計時;版號 / 動作改變才立刻提醒', () => {
    const { s, clock, shown } = setup()
    s.setInfo(info({ state: 'available', version: '0.2.0', reason: 'not-supported' }))
    clock.advance(0)
    s.closed('timeout')
    clock.advance(5 * MIN)
    s.setInfo(info({ state: 'available', version: '0.2.0', reason: 'not-supported' }))
    clock.advance(0)
    expect(shown.length).toBe(1)
    clock.advance(5 * MIN)
    expect(shown.length).toBe(2)
  })
})

describe('淡出計時(滑鼠停在上面時暫停)', () => {
  it('約 8 秒開始淡出,淡出完才關;hover 期間不前進', () => {
    expect(UPDATE_REMINDER_VISIBLE_MS).toBe(8000)
    const c = new HoverPausedCountdown()
    expect(c.advance(5000, false)).toBe(false)
    expect(c.advance(60_000, true)).toBe(false)
    expect(c.elapsedMs).toBe(5000)
    expect(c.advance(3000 + TOAST_FADE_MS - 1, false)).toBe(false)
    expect(c.advance(1, false)).toBe(true)
  })
  it('pointInBounds', () => {
    const b = { x: 100, y: 50, width: 460, height: 112 }
    expect(pointInBounds({ x: 100, y: 50 }, b)).toBe(true)
    expect(pointInBounds({ x: 559, y: 161 }, b)).toBe(true)
    expect(pointInBounds({ x: 560, y: 100 }, b)).toBe(false)
    expect(pointInBounds({ x: 99, y: 100 }, b)).toBe(false)
  })
})

describe('提醒頁:字串、HTML、按鈕、位置', () => {
  const t = (action: ReminderTarget['action'], autoUpdate = true): ReminderTarget => ({ version: '0.2.0', action, url: 'u', autoUpdate })
  it('雙語字串跟 uiLanguage;portable 主按鈕是「前往 Releases」', () => {
    expect(reminderMessage('cmn-Hant', t('install'))).toMatchObject({ title: '流亡鑑價 v0.2.0 已下載,可以更新', primary: '立即更新', later: '稍後', skip: '略過此版本' })
    expect(reminderMessage('cmn-Hant', t('install')).hint).toContain('結束程式時自動套用')
    expect(reminderMessage('cmn-Hant', t('install', false)).hint).not.toContain('結束程式時自動套用')
    expect(reminderMessage('cmn-Hant', t('download')).hint).toContain('設定 › 關於')
    expect(reminderMessage('cmn-Hant', t('releases')).primary).toBe('前往 Releases')
    expect(reminderMessage('en', t('install'))).toMatchObject({ title: 'ExileAppraiser v0.2.0 is ready to install', primary: 'Update now', later: 'Later', skip: 'Skip this version' })
    expect(reminderMessage('en', t('releases')).primary).toBe('Open Releases')
  })
  it('提醒裡的版號 = updater 回報的 version(不是寫死)', () => {
    for (const v of ['0.1.3', '7.8.9']) {
      const target = reminderTarget(info({ state: 'downloaded', version: v }))!
      expect(reminderMessage('cmn-Hant', target).title).toBe(`流亡鑑價 v${v} 已下載,可以更新`)
      expect(reminderMessage('en', target).title).toBe(`ExileAppraiser v${v} is ready to install`)
    }
  })
  it('HTML:無腳本、CSP、三個連結按鈕、hover 暫停動畫、跳脫', () => {
    const html = reminderHtml({ ...reminderMessage('cmn-Hant', t('install')), title: '<b>x</b>' }, null)
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('href="https://ppz-reminder.invalid/now"')
    expect(html).toContain('href="https://ppz-reminder.invalid/later"')
    expect(html).toContain('href="https://ppz-reminder.invalid/skip"')
    expect(html).not.toContain('href="#')
    expect(html).toContain('.toast:hover { animation-play-state: paused; }')
    expect(html).toContain(`toast-out ${TOAST_FADE_MS}ms ease-in ${UPDATE_REMINDER_VISIBLE_MS}ms`)
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(reminderHtml(reminderMessage('en', t('install')), null, { animate: false })).not.toContain('toast-out 450ms ease-in')
  })
  it('按鈕網址解析(只認 .invalid 保留網域的三個網址)', () => {
    expect(reminderButtonFromUrl('https://ppz-reminder.invalid/now')).toBe('now')
    expect(reminderButtonFromUrl('https://ppz-reminder.invalid/later')).toBe('later')
    expect(reminderButtonFromUrl('https://ppz-reminder.invalid/skip')).toBe('skip')
    expect(reminderButtonFromUrl('https://ppz-reminder.invalid/other')).toBeNull()
    expect(reminderButtonFromUrl('https://evil.example/now')).toBeNull()
    expect(reminderButtonFromUrl('data:text/html,x#ppz-now')).toBeNull()
  })
  it('右下角、同邊距', () => {
    expect(reminderBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      x: 1920 - UPDATE_REMINDER_SIZE.width - TOAST_MARGIN, y: 1040 - UPDATE_REMINDER_SIZE.height - TOAST_MARGIN, ...UPDATE_REMINDER_SIZE
    })
  })
  it('normSkippedVersion', () => {
    expect(normSkippedVersion('0.2.0')).toBe('0.2.0')
    expect(normSkippedVersion('1.2.3-beta.1')).toBe('1.2.3-beta.1')
    for (const v of [null, undefined, 1, '', 'abc', '0.2', 'x'.repeat(41), '0.2.0 ; rm']) expect(normSkippedVersion(v), String(v)).toBeNull()
  })
})

describe('定期重新檢查(每 2 小時)', () => {
  const base = { startupChecked: true, reason: 'unsigned-build' as const, isDev: false, forceCheck: false }
  it('間隔 2 小時', () => {
    expect(UPDATE_RECHECK_INTERVAL_MS).toBe(2 * 60 * MIN)
  })
  it('已下載 / 下載中 / 檢查中 / 啟動檢查前 / --no-updates / 開發模式 → 不檢查', () => {
    for (const state of ['downloaded', 'downloading', 'checking'] as const) expect(shouldPeriodicCheck({ ...base, state }), state).toBe(false)
    expect(shouldPeriodicCheck({ ...base, startupChecked: false, state: 'not-available' })).toBe(false)
    expect(shouldPeriodicCheck({ ...base, reason: 'disabled-by-flag', state: 'not-available' })).toBe(false)
    expect(shouldPeriodicCheck({ ...base, isDev: true, state: 'not-available' })).toBe(false)
    expect(shouldPeriodicCheck({ ...base, isDev: true, forceCheck: true, state: 'not-available' })).toBe(true)
  })
  it('已是最新 / 失敗 / 有新版可下載(portable、手動)→ 檢查', () => {
    for (const state of ['not-available', 'error', 'available', 'initial'] as const) expect(shouldPeriodicCheck({ ...base, state }), state).toBe(true)
    expect(shouldPeriodicCheck({ ...base, reason: 'not-supported', state: 'available' })).toBe(true)
  })

  class Fake implements UpdaterLike {
    autoDownload = true
    autoInstallOnAppQuit = true
    checks = 0
    fail = false
    private l: Record<string, Array<(...a: any[]) => void>> = {}
    on (ev: string, fn: (...a: any[]) => void) { (this.l[ev] ??= []).push(fn); return this }
    emit (ev: string, ...a: any[]) { for (const f of this.l[ev] ?? []) f(...a) }
    async checkForUpdates () {
      this.checks++
      this.emit('checking-for-update')
      if (this.fail) { const e = new Error('net::ERR_INTERNET_DISCONNECTED'); this.emit('error', e); throw e }
      this.emit('update-not-available', {})
      return null
    }

    async downloadUpdate () { return [] }
    quitAndInstall () {}
  }
  it('UpdaterCore.periodicCheck:啟動檢查後才檢查;失敗只記 log(狀態 error,下次照樣檢查)', async () => {
    const u = new Fake()
    const logs: string[] = []
    const core = new UpdaterCore({ updater: u, env: { argv: ['exe'], platform: 'win32', version: '0.1.2', isDev: false }, send: () => {}, log: (m) => { logs.push(m) } })
    expect(core.periodicCheck()).toBe(false)
    expect(u.checks).toBe(0)
    core.checkAtStartup()
    await Promise.resolve()
    expect(u.checks).toBe(1)
    u.fail = true
    expect(core.periodicCheck()).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(core.info.state).toBe('error')
    expect(logs.some(l => l.includes('updater-state error (network)'))).toBe(true)
    u.fail = false
    expect(core.periodicCheck()).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(core.info.state).toBe('not-available')
    expect(u.checks).toBe(3)
  })
  it('--no-updates:定期檢查也不做', () => {
    const u = new Fake()
    const core = new UpdaterCore({ updater: u, env: { argv: ['exe', '--no-updates'], platform: 'win32', version: '0.1.2', isDev: false }, send: () => {}, log: () => {} })
    core.checkAtStartup()
    expect(core.periodicCheck()).toBe(false)
    expect(u.checks).toBe(0)
  })
  it('開發模式不執行安裝程式(假更新來源)', () => {
    const calls: unknown[] = []
    const u = new Fake()
    u.quitAndInstall = (...a: unknown[]) => { calls.push(a) }
    const core = new UpdaterCore({ updater: u, env: { argv: ['exe', '--force-update-check'], platform: 'win32', version: '0.1.2', isDev: true }, send: () => {}, log: () => {}, defer: (fn) => { fn() } })
    u.emit('update-downloaded', { version: '0.2.0' })
    core.install()
    expect(calls).toEqual([])
  })
})

describe('開發版驗證參數(正式版忽略)', () => {
  it('reminderDevOptions', () => {
    expect(reminderDevOptions(['electron', '.'], false)).toBeNull()
    expect(reminderDevOptions(['x', '--reminder-interval-ms=30000', '--reminder-auto=later,skip,now', '--toast-display=secondary'], false))
      .toEqual({ intervalMs: 30000, auto: ['later', 'skip'], secondaryDisplay: true })
    expect(reminderDevOptions(['x', '--reminder-interval-ms=10'], false)).toBeNull()
    expect(reminderDevOptions(['x', '--reminder-interval-ms=30000', '--toast-display=secondary'], true)).toBeNull()
  })
})

describe('假更新來源腳本(scripts/make-fake-update-feed.mjs)', () => {
  it('預設版號 = package.json 版本 patch + 1;--version 可覆寫', async () => {
    const { execFileSync } = await import('node:child_process')
    const os = await import('node:os')
    const fs = await import('node:fs')
    const path = await import('node:path')
    const script = fileURLToPath(new URL('../../scripts/make-fake-update-feed.mjs', import.meta.url))
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }
    const [a, b, c] = pkg.version.split('.').map(Number)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-feed-'))
    try {
      execFileSync(process.execPath, [script, '--out', dir], { stdio: 'pipe' })
      expect(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')).toMatch(new RegExp(`^version: ${a}\\.${b}\\.${c + 1}$`, 'm'))
      execFileSync(process.execPath, [script, '--out', dir, '--version', '9.8.7'], { stdio: 'pipe' })
      expect(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')).toMatch(/^version: 9\.8\.7$/m)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('接線守門', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  const main = read('../src/main.ts')
  const preload = read('../src/preload.ts')
  const handlers = read('../src/host-handlers.ts')
  const appUpdater = read('../src/AppUpdater.ts')
  it('AppUpdater 每 2 小時 periodicCheck(不再是 16 小時直接 check)', () => {
    expect(appUpdater).toContain('setInterval(() => { this.periodicCheck() }, UPDATE_RECHECK_INTERVAL_MS)')
    expect(appUpdater).not.toMatch(/16 \* 60 \* 60/)
  })
  it('updater-state 同時交給提醒排程;host-config 帶入開關 / 略過版號;預覽啟動擋住', () => {
    expect(main).toContain('updateReminder?.setInfo(info)')
    expect(main).toContain("reminder.setConfig({ enabled: cfg.updateReminder !== false, skippedVersion: cfg.updateSkippedVersion ?? null })")
    expect(main).toContain("if (ctx.source !== 'preview') reminder.setBlocked(PREVIEW_ON_START)")
  })
  it('一般提示優先:presentToast 先收回更新提醒;提醒只在沒有其他提示時顯示', () => {
    const p = main.indexOf('function presentToast')
    expect(main.indexOf('interruptUpdateReminder?.()', p)).toBeGreaterThan(p)
    expect(main).toContain('canShow: () => !(activeToast && !activeToast.isDestroyed())')
  })
  it('立即更新:已下載 → stop + updater.install();可下載 → 開關於 + download;portable → Releases', () => {
    const i = main.indexOf('const runReminderAction')
    const block = main.slice(i, main.indexOf('const devAuto', i))
    expect(block).toMatch(/reminder\.stop\(\)\s+updater\.install\(\)/)
    expect(block).toContain("openSettings('about')")
    expect(block).toContain('void updater.download()')
    expect(block).toContain('openExternalSafe(t.url')
  })
  it('提醒視窗:可點擊、不搶焦點(showInactive)、按鈕走 will-navigate(不用錨點);結束程式時停止', () => {
    const i = main.indexOf('function showUpdateReminder')
    const block = main.slice(i, main.indexOf('let interruptUpdateReminder', i))
    expect(block).toContain("createToastWindow(bounds, { clickable: true, label: '更新提醒' })")
    expect(block).toContain('t.showInactive()')
    expect(block).toContain("t.webContents.on('will-navigate', (_e, url) => {")
    expect(block).not.toContain('did-navigate-in-page')
    // createToastWindow 一律擋導覽(按鈕網址不會真的開)
    const c = main.indexOf('function createToastWindow')
    expect(main.slice(c, main.indexOf('\n}', c))).toContain("t.webContents.on('will-navigate', (e) => { e.preventDefault() })")
    expect(main).toContain("focusable: false")
    expect(main).toContain("app.on('before-quit', () => { reminder.stop() })")
  })
  it('略過事件:main 送 update-reminder-skip,preload 對應,不進預覽事件', () => {
    expect(main).toContain("send('update-reminder-skip', version)")
    expect(preload).toContain("subscribe<string>('update-reminder-skip', cb)")
    const m = /PREVIEW_EVENTS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(handlers)
    expect(m?.[1]).toBeDefined()
    expect(m?.[1]).not.toContain('update-reminder-skip')
  })
  it('開發版代按只准 later / skip(不會代按立即更新)', () => {
    expect(main).toContain("next === 'later' ? 'later' : 'skip'")
  })
})
