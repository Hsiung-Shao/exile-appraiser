// 2026-11-23 設定 › 啟動與更新「啟動遊戲時自動開啟」:純邏輯(main/src/game-autolaunch.ts)+ main.ts 接線守門
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GAME_PROCESS_NAMES, STARTUP_LINK_NAME, WATCHER_INTERVAL_SEC, WATCHER_MUTEX,
  applyGameAutoLaunch, launchTarget, launcherScript, watcherPaths, watcherScript,
  type GameAutoLaunchDeps
} from '../src/game-autolaunch'

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')

const USER_DATA = 'C:\\Users\\u\\AppData\\Roaming\\exile-appraiser'
const STARTUP = 'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup'
const EXEC = 'C:\\Users\\u\\AppData\\Local\\Programs\\ExileAppraiser\\ExileAppraiser.exe'
const PORTABLE = 'D:\\工具\\ExileAppraiser-0.3.16-portable.exe'
const TMP_EXEC = 'C:\\Users\\u\\AppData\\Local\\Temp\\3x9f\\ExileAppraiser.exe'

/** 假檔案系統:記錄每個寫入 / 刪除 / 捷徑 / 啟動 */
function fakeDeps (over: Partial<GameAutoLaunchDeps> = {}, files = new Map<string, Buffer>()) {
  const log: string[] = []
  const shortcuts: Array<{ path: string, operation: string, options: Record<string, string> }> = []
  const spawned: Array<{ exe: string, args: string[] }> = []
  const deps: GameAutoLaunchDeps = {
    isPackaged: true,
    env: {},
    execPath: EXEC,
    userDataDir: USER_DATA,
    startupDir: STARTUP,
    systemRoot: 'C:\\Windows',
    exists: p => files.has(p),
    readFile: p => files.get(p) ?? null,
    writeFile: (p, d) => { files.set(p, d); log.push(`write ${p}`) },
    mkdir: () => {},
    remove: p => { files.delete(p); log.push(`remove ${p}`) },
    writeShortcut: (p, operation, options) => { shortcuts.push({ path: p, operation, options }); files.set(p, Buffer.from('lnk')); return true },
    spawnDetached: (exe, args) => { spawned.push({ exe, args }) },
    ...over
  }
  return { deps, files, log, shortcuts, spawned }
}

describe('launchTarget', () => {
  it('安裝版 → 目前 exe;可攜版 → 可攜 exe 本體(不是暫存解壓的)', () => {
    expect(launchTarget({}, EXEC)).toBe(EXEC)
    expect(launchTarget({ PORTABLE_EXECUTABLE_FILE: '' }, EXEC)).toBe(EXEC)
    expect(launchTarget({ PORTABLE_EXECUTABLE_FILE: PORTABLE }, TMP_EXEC)).toBe(PORTABLE)
  })
})

describe('watcherScript', () => {
  const s = watcherScript({ appExe: "C:\\it's\\ExileAppraiser.exe", appProcessNames: ['ExileAppraiser'], linkPath: 'C:\\x\\a.lnk' })
  it('路徑用單引號字串,內含單引號寫兩次', () => {
    expect(s).toContain("$AppPath   = 'C:\\it''s\\ExileAppraiser.exe'")
  })
  it('PoE1 / PoE2 Steam 與獨立版行程名都在清單裡', () => {
    for (const n of ['PathOfExileSteam', 'PathOfExile', 'PathOfExile_x64', 'PathOfExile_x64Steam']) expect(GAME_PROCESS_NAMES).toContain(n)
    for (const n of GAME_PROCESS_NAMES) expect(s).toContain(`'${n}'`)
  })
  it('只在遊戲「沒開 → 開」那一刻、本程式沒在跑才啟動(遊戲中關掉不會再開)', () => {
    expect(s).toContain('if ($gameRunning -and -not $gameWasRunning)')
    expect(s).toMatch(/\$appRunning = \[bool\]\(Get-Process -Name \$AppNames[\s\S]*if \(-not \$appRunning/)
    expect(s).toContain(`Start-Sleep -Seconds ${WATCHER_INTERVAL_SEC}`)
  })
  it('捷徑被刪(設定關閉)或腳本被改寫 → 監看自己結束;一次只一個(mutex)', () => {
    expect(s).toMatch(/while \(\(Test-Path -LiteralPath \$LinkPath\) -and \(Test-Path -LiteralPath \$PSCommandPath\) -and .*LastWriteTimeUtc -eq \$stamp\)/)
    expect(s).toContain(`'${WATCHER_MUTEX}'`)
    expect(s).toContain('$mutex.WaitOne(15000)')
  })
  it('launcher 只有 ASCII、隱藏視窗執行腳本', () => {
    const v = launcherScript()
    expect(/^[\x00-\x7f]*$/.test(v)).toBe(true)
    expect(v).toContain('-WindowStyle Hidden -File')
    expect(v).toMatch(/, 0, False/)
  })
})

describe('applyGameAutoLaunch', () => {
  const p = watcherPaths(USER_DATA, STARTUP)

  it('開:寫腳本(UTF-8 BOM)+ launcher + 啟動資料夾捷徑指向 wscript,並立刻啟動監看', () => {
    const { deps, files, shortcuts, spawned } = fakeDeps()
    const r = applyGameAutoLaunch(true, deps)
    expect(r).toEqual({ ok: true, action: 'installed', link: path.win32.join(STARTUP, STARTUP_LINK_NAME) })
    const script = files.get(p.script)!
    expect([...script.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(script.toString('utf8')).toContain(`$AppPath   = '${EXEC}'`)
    expect(files.has(p.launcher)).toBe(true)
    expect(shortcuts).toHaveLength(1)
    expect(shortcuts[0]).toMatchObject({ path: p.link, operation: 'create', options: { target: 'C:\\Windows\\System32\\wscript.exe', args: `"${p.launcher}"`, cwd: p.dir } })
    expect(spawned).toEqual([{ exe: 'C:\\Windows\\System32\\wscript.exe', args: [p.launcher] }])
  })

  it('再開一次:內容沒變不重寫腳本(不會讓跑著的監看重啟),捷徑 replace', () => {
    const { deps, files } = fakeDeps()
    applyGameAutoLaunch(true, deps)
    const second = fakeDeps({}, files)
    applyGameAutoLaunch(true, second.deps)
    expect(second.log.filter(l => l.startsWith('write'))).toEqual([])
    expect(second.shortcuts[0].operation).toBe('replace')
  })

  it('可攜版:啟動可攜 exe 本體;「已在跑」同時認內外兩個行程名', () => {
    const { deps, files } = fakeDeps({ env: { PORTABLE_EXECUTABLE_FILE: PORTABLE }, execPath: TMP_EXEC })
    applyGameAutoLaunch(true, deps)
    const s = files.get(p.script)!.toString('utf8')
    expect(s).toContain(`$AppPath   = '${PORTABLE}'`)
    expect(s).toContain("$AppNames  = @('ExileAppraiser', 'ExileAppraiser-0.3.16-portable')")
  })

  it('開發模式不安裝(execPath 是 electron.exe)', () => {
    const { deps, files, spawned } = fakeDeps({ isPackaged: false })
    expect(applyGameAutoLaunch(true, deps)).toEqual({ ok: false, reason: 'dev' })
    expect(files.size).toBe(0)
    expect(spawned).toEqual([])
  })

  it('關:刪捷徑與兩個檔;本來就沒有 → none、不動檔案', () => {
    const { deps, files } = fakeDeps()
    applyGameAutoLaunch(true, deps)
    const off = fakeDeps({}, files)
    expect(applyGameAutoLaunch(false, off.deps)).toEqual({ ok: true, action: 'removed' })
    expect(files.size).toBe(0)
    const again = fakeDeps({}, files)
    expect(applyGameAutoLaunch(false, again.deps)).toEqual({ ok: true, action: 'none' })
    expect(again.log).toEqual([])
  })

  it('建立捷徑失敗 / 寫檔丟例外 → failed,不啟動監看', () => {
    const a = fakeDeps({ writeShortcut: () => false })
    expect(applyGameAutoLaunch(true, a.deps)).toEqual({ ok: false, reason: 'failed' })
    expect(a.spawned).toEqual([])
    const b = fakeDeps({ writeFile: () => { throw new Error('EACCES') } })
    expect(applyGameAutoLaunch(true, b.deps)).toEqual({ ok: false, reason: 'failed' })
    expect(b.spawned).toEqual([])
  })
})

describe('main.ts 接線', () => {
  const main = read('../src/main.ts')
  it('host-config 依 autoLaunchWithGame 套用,只在值變了才動檔案', () => {
    expect(main).toContain('syncGameAutoLaunch(cfg.autoLaunchWithGame === true)')
    expect(main).toMatch(/if \(enabled === lastAutoLaunch\) return\s+lastAutoLaunch = enabled/)
  })
})
