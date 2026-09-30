// 自動更新純邏輯(`src/updater-core.ts`):狀態轉移、`autoUpdate` 開關、portable / --no-updates。
// 假 updater 模仿 electron-updater 6.8 BaseUpdater 的兩個行為:
// ① checkForUpdates 在 autoDownload 時接著下載;② 下載完成「發 update-downloaded 之後」同步 addQuitHandler,
//    只有當下 autoInstallOnAppQuit === true 才註冊;結束時(exit code 0)再讀一次旗標決定要不要 install(true, false)。
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { UpdaterInfo } from '@ipc/types'
import { UpdaterCore, classifyError, resolveReason, updaterFlags, type UpdaterLike } from '../src/updater-core'

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = true
  quitHandlerAdded = false
  latest: string | null = '3.29.91'
  failDownload = false
  checks = 0
  downloads = 0
  installs: Array<{ silent: boolean, runAfter: boolean, via: 'quitAndInstall' | 'quit' }> = []

  async checkForUpdates () {
    this.checks++
    this.emit('checking-for-update')
    if (!this.latest) { this.emit('update-not-available', {}); return { isUpdateAvailable: false } }
    this.emit('update-available', { version: this.latest })
    return { isUpdateAvailable: true, downloadPromise: this.autoDownload ? this.downloadUpdate() : null }
  }

  async downloadUpdate () {
    this.downloads++
    await Promise.resolve()
    if (this.failDownload) {
      const e = new Error('sha512 checksum mismatch')
      this.emit('error', e)
      throw e
    }
    this.emit('update-downloaded', { version: this.latest, downloadedFile: 'C:/cache/pending/ExileAppraiser-Setup.exe' })
    if (!this.quitHandlerAdded && this.autoInstallOnAppQuit) this.quitHandlerAdded = true
    return ['C:/cache/pending/ExileAppraiser-Setup.exe']
  }

  quitAndInstall (isSilent = false, isForceRunAfter = false) {
    this.installs.push({ silent: isSilent, runAfter: isForceRunAfter, via: 'quitAndInstall' })
  }

  /** 模擬 app 'quit'(exit code)。 */
  quit (exitCode = 0) {
    if (this.quitHandlerAdded && this.autoInstallOnAppQuit && exitCode === 0 && this.installs.length === 0) {
      this.installs.push({ silent: true, runAfter: false, via: 'quit' })
    }
  }
}

function setup (opts: { argv?: string[], portableDir?: string, platform?: string, isDev?: boolean } = {}) {
  const updater = new FakeUpdater()
  const sent: UpdaterInfo[] = []
  const deferred: Array<() => void> = []
  const core = new UpdaterCore({
    updater,
    env: { argv: opts.argv ?? ['exe'], portableDir: opts.portableDir, platform: opts.platform ?? 'win32', version: '3.29.90', isDev: opts.isDev ?? false },
    send: (i) => { sent.push(i) },
    log: () => {},
    defer: (fn) => { deferred.push(fn) }
  })
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
    while (deferred.length) deferred.shift()!()
  }
  return { updater, core, sent, flush, states: () => sent.map(s => s.state) }
}

describe('resolveReason / updaterFlags', () => {
  it('安裝版 / portable / 非 Windows / --no-updates', () => {
    expect(resolveReason({ argv: [], platform: 'win32' })).toBe('unsigned-build')
    expect(resolveReason({ argv: [], platform: 'win32', portableDir: 'D:/x' })).toBe('not-supported')
    expect(resolveReason({ argv: [], platform: 'linux' })).toBe('not-supported')
    expect(resolveReason({ argv: ['--no-updates'], platform: 'win32', portableDir: 'D:/x' })).toBe('disabled-by-flag')
  })
  it('旗標:下載完成前 autoInstallOnAppQuit 恆 true(安裝版),之後 = autoUpdate;portable 全關', () => {
    expect(updaterFlags('unsigned-build', true, false)).toEqual({ autoDownload: true, autoInstallOnAppQuit: true })
    expect(updaterFlags('unsigned-build', false, false)).toEqual({ autoDownload: false, autoInstallOnAppQuit: true })
    expect(updaterFlags('unsigned-build', true, true)).toEqual({ autoDownload: true, autoInstallOnAppQuit: true })
    expect(updaterFlags('unsigned-build', false, true)).toEqual({ autoDownload: false, autoInstallOnAppQuit: false })
    expect(updaterFlags('not-supported', true, false)).toEqual({ autoDownload: false, autoInstallOnAppQuit: false })
    expect(updaterFlags('disabled-by-flag', true, true)).toEqual({ autoDownload: false, autoInstallOnAppQuit: false })
  })
})

describe('classifyError', () => {
  it('404 與「repo 已建、沒有 Release」都算 not-found;網路錯誤 network;只留第一行', () => {
    expect(classifyError(new Error('HttpError: 404 \nheaders…')).errorKind).toBe('not-found')
    // 2026-09-30 本機實測 3.29.0 對真的 GitHub repo 的回應
    expect(classifyError(new Error('Error: No published versions on GitHub'))).toEqual({ error: 'Error: No published versions on GitHub', errorKind: 'not-found' })
    expect(classifyError(new Error('net::ERR_CONNECTION_REFUSED\nmore')).errorKind).toBe('network')
    expect(classifyError('weird').errorKind).toBe('other')
  })
})

describe('autoUpdate 開(預設)', () => {
  it('檢查 → 自動下載 → downloaded → 正常結束時靜默安裝(不重新啟動)', async () => {
    const { updater, core, flush, states } = setup()
    expect(updater.autoDownload).toBe(true)
    core.checkAtStartup()
    await flush()
    expect(states()).toEqual(['checking', 'downloading', 'downloaded'])
    expect(core.info).toMatchObject({ state: 'downloaded', version: '3.29.91', autoUpdate: true, reason: 'unsigned-build' })
    expect(updater.downloads).toBe(1)
    expect(updater.quitHandlerAdded).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    updater.quit(0)
    expect(updater.installs).toEqual([{ silent: true, runAfter: false, via: 'quit' }])
  })
  it('exit code ≠ 0 不安裝', async () => {
    const { updater, core, flush } = setup()
    core.checkAtStartup()
    await flush()
    updater.quit(1)
    expect(updater.installs).toEqual([])
  })
  it('「立即重啟並更新」= quitAndInstall(true, true)', async () => {
    const { updater, core, flush } = setup()
    await core.check()
    await flush()
    core.install()
    expect(updater.installs).toEqual([{ silent: true, runAfter: true, via: 'quitAndInstall' }])
  })
  it('下載完成後不再重新檢查;沒有新版 → not-available', async () => {
    const a = setup()
    await a.core.check(); await a.flush()
    await a.core.check(); await a.flush()
    expect(a.updater.checks).toBe(1)
    const b = setup()
    b.updater.latest = null
    await b.core.check(); await b.flush()
    expect(b.states()).toEqual(['checking', 'not-available'])
    expect(b.updater.downloads).toBe(0)
  })
  it('自動下載失敗 → error(不 unhandled rejection),之後可再檢查重試', async () => {
    const { updater, core, flush, states } = setup()
    updater.failDownload = true
    await core.check(); await flush()
    expect(states()).toEqual(['checking', 'downloading', 'error'])
    expect(core.info.error).toBe('sha512 checksum mismatch')
    updater.failDownload = false
    await core.check(); await flush()
    expect(core.info.state).toBe('downloaded')
  })
  it('下載完成後關掉 autoUpdate → 結束時不安裝;再打開 → 又會安裝', async () => {
    const { updater, core, flush } = setup()
    await core.check(); await flush()
    core.setAutoUpdate(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(core.info.autoUpdate).toBe(false)
    updater.quit(0)
    expect(updater.installs).toEqual([])
    core.setAutoUpdate(true)
    updater.quit(0)
    expect(updater.installs).toEqual([{ silent: true, runAfter: false, via: 'quit' }])
  })
})

describe('autoUpdate 關(手動流程)', () => {
  it('available 停住;按下載 → downloaded;結束不安裝;按安裝 = quitAndInstall(false)', async () => {
    const { updater, core, flush, states } = setup()
    core.setAutoUpdate(false)
    expect(updater.autoDownload).toBe(false)
    await core.check(); await flush()
    expect(core.info.state).toBe('available')
    expect(updater.downloads).toBe(0)
    await core.download(); await flush()
    expect(states().slice(-2)).toEqual(['downloading', 'downloaded'])
    // quit handler 有註冊(下載完成當下旗標為 true),但之後旗標 = autoUpdate = false
    expect(updater.quitHandlerAdded).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    updater.quit(0)
    expect(updater.installs).toEqual([])
    core.install()
    expect(updater.installs).toEqual([{ silent: false, runAfter: false, via: 'quitAndInstall' }])
  })
  it('available 時打開 autoUpdate → 立刻開始下載', async () => {
    const { updater, core, flush } = setup()
    core.setAutoUpdate(false)
    await core.check(); await flush()
    core.setAutoUpdate(true)
    await flush()
    expect(updater.downloads).toBe(1)
    expect(core.info.state).toBe('downloaded')
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })
  it('同值 setAutoUpdate 不重送狀態', () => {
    const { core, sent } = setup()
    core.setAutoUpdate(true)
    expect(sent).toEqual([])
  })
})

describe('portable / --no-updates / 開發模式', () => {
  it('portable:只檢查不下載,download() 無作用,結束不安裝', async () => {
    const { updater, core, flush } = setup({ portableDir: 'D:/portable' })
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    await core.check(); await flush()
    expect(core.info).toMatchObject({ state: 'available', reason: 'not-supported' })
    await core.download(); await flush()
    expect(updater.downloads).toBe(0)
    core.setAutoUpdate(false); core.setAutoUpdate(true)
    expect(updater.autoDownload).toBe(false)
    expect(updater.downloads).toBe(0)
  })
  it('--no-updates:不檢查', async () => {
    const { updater, core } = setup({ argv: ['exe', '--no-updates'] })
    await core.check()
    expect(updater.checks).toBe(0)
    expect(core.info.reason).toBe('disabled-by-flag')
  })
  it('開發模式沒有 --force-update-check 不檢查;有就檢查', async () => {
    const a = setup({ isDev: true })
    await a.core.check()
    expect(a.updater.checks).toBe(0)
    const b = setup({ isDev: true, argv: ['exe', '--force-update-check'] })
    await b.core.check(); await b.flush()
    expect(b.updater.checks).toBe(1)
    // 假 feed 的假 exe:可以下載,但結束時絕不執行
    expect(b.core.info.state).toBe('downloaded')
    expect(b.updater.autoInstallOnAppQuit).toBe(false)
    b.updater.quit(0)
    expect(b.updater.installs).toEqual([])
  })
})
