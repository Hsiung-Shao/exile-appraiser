// 設定 › 一般「建立桌面捷徑」:純邏輯(main/src/desktop-shortcut.ts)+ IPC / preload / 安裝檔設定接線守門
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOST_METHOD_CHANNELS, bootScript } from '../src/preview-server'

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')

// 動態載入:模組不存在時只有 S1–S7 紅(import 紅),S8–S9 仍各自驗斷言
const MOD_PATH = '../src/desktop-shortcut'
type Mod = typeof import('../src/desktop-shortcut')
const load = async (): Promise<Mod> => await import(/* @vite-ignore */ MOD_PATH) as Mod

const DESKTOP = 'C:\\Users\\u\\Desktop'
const EXEC = 'C:\\Program Files\\ExileAppraiser\\ExileAppraiser.exe'
const PORTABLE = 'D:\\tools\\ExileAppraiser-0.3.10-portable.exe'
const TMP_EXEC = 'C:\\Users\\u\\AppData\\Local\\Temp\\3x9f\\ExileAppraiser.exe'

type WriteCall = { path: string, operation: string, options: Record<string, string> }
function makeDeps (m: Mod, over: Record<string, unknown> = {}) {
  const calls: WriteCall[] = []
  const deps = {
    isPackaged: true,
    env: {} as Record<string, string | undefined>,
    execPath: EXEC,
    desktopDir: DESKTOP,
    exists: () => false,
    write: (p: string, operation: 'create' | 'replace', options: WriteCall['options']) => { calls.push({ path: p, operation, options }); return true },
    ...over,
  } as Parameters<Mod['createDesktopShortcut']>[0]
  return { deps, calls, m }
}

describe('shortcutTarget', () => {
  it('S1 安裝版(沒有 PORTABLE_EXECUTABLE_FILE)捷徑指向目前的 exe', async () => {
    const m = await load()
    expect(m.shortcutTarget({}, EXEC)).toBe(EXEC)
    // 空字串也視為沒有可攜版環境
    expect(m.shortcutTarget({ PORTABLE_EXECUTABLE_FILE: '' }, EXEC)).toBe(EXEC)
  })
  it('S2 可攜版捷徑指向可攜 exe 本體,不是暫存解壓目錄的 exe', async () => {
    const m = await load()
    const t = m.shortcutTarget({ PORTABLE_EXECUTABLE_FILE: PORTABLE }, TMP_EXEC)
    expect(t).toBe(PORTABLE)
    expect(t).not.toBe(TMP_EXEC)
  })
})

describe('createDesktopShortcut', () => {
  it('S3 捷徑放在桌面、檔名固定,回傳同一路徑', async () => {
    const m = await load()
    const { deps, calls } = makeDeps(m)
    const r = m.createDesktopShortcut(deps)
    expect(calls).toHaveLength(1)
    // 以 path.win32 組合期望值:不依賴執行測試的平台
    const expected = path.win32.join(DESKTOP, m.DESKTOP_SHORTCUT_NAME)
    expect(m.DESKTOP_SHORTCUT_NAME).toBe('ExileAppraiser.lnk')
    expect(calls[0].path).toBe(expected)
    expect(r).toEqual({ ok: true, path: calls[0].path })
  })

  it('S4 已有同名捷徑 → replace;沒有 → create(且用 exists 查的是同一個路徑)', async () => {
    const m = await load()
    const asked: string[] = []
    const mk = (has: boolean) => makeDeps(m, { exists: (p: string) => { asked.push(p); return has } })
    const a = mk(true)
    m.createDesktopShortcut(a.deps)
    expect(a.calls[0].operation).toBe('replace')
    const b = mk(false)
    m.createDesktopShortcut(b.deps)
    expect(b.calls[0].operation).toBe('create')
    expect(asked.every((p) => p === a.calls[0].path)).toBe(true)
    expect(asked.length).toBeGreaterThan(0)
  })

  it('S5 安裝版:捷徑帶目標 exe、所在資料夾、AppUserModelID、非空描述', async () => {
    const m = await load()
    const { deps, calls } = makeDeps(m)
    m.createDesktopShortcut(deps)
    const o = calls[0].options
    expect(o.target).toBe(EXEC)
    expect(o.cwd).toBe(path.win32.dirname(EXEC))
    expect(o.appUserModelId).toBe(m.APP_USER_MODEL_ID)
    expect(m.APP_USER_MODEL_ID).toBe('com.hsiungshao.exile-appraiser')
    expect(o.description.trim().length).toBeGreaterThan(0)
  })

  it('S5 可攜版:target / cwd 都跟著可攜 exe,不是暫存目錄', async () => {
    const m = await load()
    const { deps, calls } = makeDeps(m, { env: { PORTABLE_EXECUTABLE_FILE: PORTABLE }, execPath: TMP_EXEC })
    m.createDesktopShortcut(deps)
    const o = calls[0].options
    expect(o.target).toBe(PORTABLE)
    expect(o.cwd).toBe(path.win32.dirname(PORTABLE))
    expect(o.appUserModelId).toBe(m.APP_USER_MODEL_ID)
  })

  it('S6 開發模式(未打包)回 dev,且不寫任何檔', async () => {
    const m = await load()
    const { deps, calls } = makeDeps(m, { isPackaged: false })
    expect(m.createDesktopShortcut(deps)).toEqual({ ok: false, reason: 'dev' })
    expect(calls).toHaveLength(0)
  })

  it('S7 write 回 false → failed', async () => {
    const m = await load()
    const { deps } = makeDeps(m, { write: () => false })
    expect(m.createDesktopShortcut(deps)).toEqual({ ok: false, reason: 'failed' })
  })

  it('S7 write 丟例外 → failed,不往外丟', async () => {
    const m = await load()
    const { deps } = makeDeps(m, { write: () => { throw new Error('EPERM') } })
    expect(() => m.createDesktopShortcut(deps)).not.toThrow()
    expect(m.createDesktopShortcut(deps)).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('S8 IPC 接線', () => {
  const main = read('../src/main.ts')
  it('desktop-shortcut-create:登錄表是 invoke + preview: false', () => {
    const m = /'desktop-shortcut-create':\s*\{[\s\S]*?\n    \},/.exec(main)?.[0] ?? ''
    expect(m).not.toBe('')
    expect(m).toContain("kind: 'invoke'")
    expect(m).toContain('preview: false')
  })
  it('不在預覽方法表、預覽 boot script 沒有這個方法', () => {
    expect(Object.values(HOST_METHOD_CHANNELS)).not.toContain('desktop-shortcut-create')
    expect(bootScript({ prefix: '/t/' + 'a'.repeat(32) + '/', version: '1.0.0' })).not.toContain('"createDesktopShortcut"')
  })
  it('preload 有對應的 invoke', () => {
    expect(read('../src/preload.ts')).toMatch(/createDesktopShortcut:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('desktop-shortcut-create'\)/)
  })
})

describe('S9 安裝檔設定', () => {
  it('nsis 區塊每次安裝都建立桌面與開始功能表捷徑', () => {
    const yml = read('../electron-builder.yml')
    const nsis = /^nsis:\s*\n((?:[ \t]+.*\n|[ \t]*\n)*)/m.exec(yml)?.[1] ?? ''
    expect(nsis).not.toBe('')
    expect(nsis).toMatch(/^\s+createDesktopShortcut:\s*always\s*$/m)
    expect(nsis).toMatch(/^\s+createStartMenuShortcut:\s*true\s*$/m)
  })
})
