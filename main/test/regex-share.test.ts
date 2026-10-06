// 一鍵從 PobTools 送正則分享碼(main/src/regex-share.ts;介面規格 docs/regex-share-cli.md)。
// 參數解析(兩種寫法、Chromium 重排、缺值、兩個都給)、格式檢查(字元集 / 長度 / BOM)、讀檔(假 fs)、重新啟動剝參數、
// 信箱(依顯示目標交出)、啟動穩定閘門(假時鐘)、上限與 regex/src/share.ts 一致,以及 main.ts / preload / 預覽方法表接線守門。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  REGEX_SHARE_MAX_CODE_CHARS, REGEX_SHARE_MAX_FILE_BYTES, RegexShareInbox, RegexShareStartupGate, findRegexShareArg, hasRegexShareArg,
  regexShareTarget, resolveRegexShareArg, stripRegexShareArgs, validateShareCode, type RegexShareFs
} from '../src/regex-share'
import { HOST_METHOD_CHANNELS } from '../src/preview-server'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const EXE = 'C:\\Program Files\\ExileAppraiser\\ExileAppraiser.exe'
const CODE = 'H4sIAAAAAAAAA-_abc123'

describe('findRegexShareArg', () => {
  it('兩種寫法:--flag=值 / --flag 值', () => {
    expect(findRegexShareArg([EXE, `--regex-share=${CODE}`])).toEqual({ via: 'arg', value: CODE })
    expect(findRegexShareArg([EXE, '--regex-share', CODE])).toEqual({ via: 'arg', value: CODE })
    expect(findRegexShareArg([EXE, '--regex-share-file=C:\\t\\a.txt'])).toEqual({ via: 'file', value: 'C:\\t\\a.txt' })
    expect(findRegexShareArg([EXE, '--regex-share-file', 'a.txt'])).toEqual({ via: 'file', value: 'a.txt' })
  })
  it('Chromium 轉交 second-instance 時開關排前、轉小寫 → 取最後一個一般參數', () => {
    expect(findRegexShareArg([EXE, '--allow-file-access-from-files', '--REGEX-SHARE', '--original-process-start-time=1', CODE])).toEqual({ via: 'arg', value: CODE })
    expect(findRegexShareArg([EXE, '--regex-share', '--x'])).toEqual({ via: 'arg', error: 'missing-value', detail: '--regex-share' })
  })
  it('沒有參數 = null;兩個都給 = 錯誤(不猜);不把 argv[0] 當值', () => {
    expect(findRegexShareArg([EXE, '--window'])).toBeNull()
    expect(findRegexShareArg([EXE, `--regex-share=${CODE}`, '--regex-share-file=a'])?.error).toBe('both-flags')
    expect(findRegexShareArg(['--regex-share'])).toBeNull()
  })
  it('hasRegexShareArg 只看開關名', () => {
    expect(hasRegexShareArg([EXE, '--regex-share=x'])).toBe(true)
    expect(hasRegexShareArg([EXE, '--REGEX-SHARE-FILE', 'a'])).toBe(true)
    expect(hasRegexShareArg([EXE, '--regex-sharex'])).toBe(false)
    expect(hasRegexShareArg(['--regex-share'])).toBe(false)
  })
})

describe('validateShareCode', () => {
  it('base64url 字元集;去 BOM 與前後空白 / 換行', () => {
    expect(validateShareCode(`\uFEFF  ${CODE}\r\n`)).toEqual({ ok: true, code: CODE })
    expect(validateShareCode('abc+/=')).toMatchObject({ ok: false, reason: 'charset' })
    expect(validateShareCode('ab c')).toMatchObject({ ok: false, reason: 'charset' })
    expect(validateShareCode('分享')).toMatchObject({ ok: false, reason: 'charset', detail: expect.stringContaining('U+5206') })
    expect(validateShareCode('   ')).toMatchObject({ ok: false, reason: 'empty' })
  })
  it('長度上限邊界(開發模式 argv 的 app 路徑也會被字元集擋下)', () => {
    expect(validateShareCode('a'.repeat(REGEX_SHARE_MAX_CODE_CHARS)).ok).toBe(true)
    expect(validateShareCode('a'.repeat(REGEX_SHARE_MAX_CODE_CHARS + 1))).toMatchObject({ ok: false, reason: 'too-long' })
    expect(validateShareCode('main/dist/main.js')).toMatchObject({ ok: false, reason: 'charset' })
  })
  it('上限與 regex/src/share.ts SHARE_MAX_CODE_CHARS 相同', () => {
    const share = read('../../regex/src/share.ts')
    expect(share).toContain('export const SHARE_MAX_CODE_CHARS = 4 * 1024 * 1024')
    expect(REGEX_SHARE_MAX_CODE_CHARS).toBe(4 * 1024 * 1024)
    expect(REGEX_SHARE_MAX_FILE_BYTES).toBe(REGEX_SHARE_MAX_CODE_CHARS + 4096)
  })
})

describe('resolveRegexShareArg(讀檔用假 fs;只讀不刪)', () => {
  const fakeFs = (files: Record<string, string | 'dir'>, calls: string[] = []): RegexShareFs => ({
    stat: async (p) => {
      calls.push(`stat ${p}`)
      const f = files[p]
      if (f === undefined) throw Object.assign(new Error('nope'), { code: 'ENOENT' })
      return { size: f === 'dir' ? 0 : Buffer.byteLength(f), isFile: () => f !== 'dir' }
    },
    readFile: async (p) => { calls.push(`read ${p}`); return files[p] as string }
  })
  const cwd = path.resolve('/work')
  it('參數:合格 → code;不合格 → error,不讀任何檔', async () => {
    const calls: string[] = []
    expect(await resolveRegexShareArg({ via: 'arg', value: CODE }, cwd, fakeFs({}, calls))).toEqual({ source: 'pobtools', via: 'arg', code: CODE })
    expect((await resolveRegexShareArg({ via: 'arg', value: 'x y' }, cwd, fakeFs({}, calls))).error?.reason).toBe('charset')
    expect(calls).toEqual([])
  })
  it('檔案:相對路徑以呼叫端工作目錄為準;內容照同一套檢查', async () => {
    const p = path.resolve(cwd, 'share.txt')
    const calls: string[] = []
    expect(await resolveRegexShareArg({ via: 'file', value: 'share.txt' }, cwd, fakeFs({ [p]: `${CODE}\n` }, calls))).toEqual({ source: 'pobtools', via: 'file', code: CODE })
    expect(calls).toEqual([`stat ${p}`, `read ${p}`])
  })
  it('檔案錯誤:不存在 / 不是檔案 / 太大 / 內容不合格', async () => {
    const p = path.resolve(cwd, 'x')
    expect((await resolveRegexShareArg({ via: 'file', value: 'x' }, cwd, fakeFs({}))).error).toMatchObject({ reason: 'file-read', detail: expect.stringContaining('ENOENT') })
    expect((await resolveRegexShareArg({ via: 'file', value: 'x' }, cwd, fakeFs({ [p]: 'dir' }))).error?.reason).toBe('file-read')
    const big: RegexShareFs = { stat: async () => ({ size: REGEX_SHARE_MAX_FILE_BYTES + 1, isFile: () => true }), readFile: vi.fn() }
    expect((await resolveRegexShareArg({ via: 'file', value: 'x' }, cwd, big)).error?.reason).toBe('file-too-large')
    expect(big.readFile).not.toHaveBeenCalled()
    expect((await resolveRegexShareArg({ via: 'file', value: 'x' }, cwd, fakeFs({ [p]: '!!' }))).error?.reason).toBe('charset')
  })
  it('參數本身有錯 → 原樣轉成 error', async () => {
    expect(await resolveRegexShareArg({ via: 'arg', error: 'missing-value', detail: 'd' }, cwd, fakeFs({}))).toEqual({ source: 'pobtools', via: 'arg', error: { reason: 'missing-value', detail: 'd' } })
  })
})

describe('stripRegexShareArgs(重新啟動不帶分享碼參數)', () => {
  it('拿掉兩種寫法與緊接的值,其他參數保留', () => {
    expect(stripRegexShareArgs(['--window', `--regex-share=${CODE}`, '--no-updates'])).toEqual(['--window', '--no-updates'])
    expect(stripRegexShareArgs(['--regex-share', CODE, '--window'])).toEqual(['--window'])
    expect(stripRegexShareArgs(['--REGEX-SHARE-FILE', 'a.txt'])).toEqual([])
    expect(stripRegexShareArgs(['--regex-share', '--window'])).toEqual(['--window'])
  })
  it('main.ts relaunchSelf 用它', () => {
    const main = read('../src/main.ts')
    const fn = main.slice(main.indexOf('function relaunchSelf'), main.indexOf('function relaunchSelf') + 900)
    expect(fn).toContain('stripRegexShareArgs(process.argv.slice(1))')
    expect(fn).toContain('app.relaunch({ args })')
  })
})

describe('顯示目標與信箱', () => {
  it('regexShareTarget:overlay 而遊戲不在 → 瀏覽器設定頁;其他 → Electron 視窗', () => {
    expect(regexShareTarget('overlay', false)).toBe('preview')
    expect(regexShareTarget('overlay', true)).toBe('app')
    expect(regexShareTarget('window', false)).toBe('app')
  })
  const req = { source: 'pobtools' as const, via: 'arg' as const, code: CODE }
  it('app:就緒前先留著、take 交出並標記就緒;之後直接送事件', () => {
    const deliver = vi.fn()
    const box = new RegexShareInbox({ deliver, log: () => {} })
    box.push(req, 'app')
    expect(deliver).not.toHaveBeenCalled()
    expect(box.take('app')).toMatchObject({ id: 1, code: CODE })
    expect(box.take('app')).toBeNull()
    box.push(req, 'app')
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    box.reset()
    box.push(req, 'app')
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(box.take('app')?.id).toBe(3)
  })
  it('preview:不送事件,只交給預覽分頁;目標不同拿不到;新的取代舊的', () => {
    const deliver = vi.fn()
    const box = new RegexShareInbox({ deliver, log: () => {} })
    box.take('app') // Electron renderer 已就緒
    box.push(req, 'preview')
    expect(deliver).not.toHaveBeenCalled()
    expect(box.take('app')).toBeNull()
    box.push({ ...req, code: 'second' }, 'preview')
    expect(box.take('preview')).toMatchObject({ id: 2, code: 'second' })
    expect(box.take('preview')).toBeNull()
  })
  it('啟動穩定閘門:開始追蹤後 grace 內 attach → 立刻放行;沒 attach → grace 後放行;沒追蹤 → maxWait 放行', () => {
    vi.useFakeTimers()
    try {
      const mk = () => new RegexShareStartupGate({ settled: false, graceMs: 2500, maxWaitMs: 15000, setTimeout, clearTimeout: (t) => { clearTimeout(t as ReturnType<typeof setTimeout>) }, log: () => {} })
      const a = mk(); const fa = vi.fn(); a.whenSettled(fa)
      a.trackingStarted(); vi.advanceTimersByTime(1000); expect(fa).not.toHaveBeenCalled()
      a.settle('遊戲 attach'); expect(fa).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(20000); expect(fa).toHaveBeenCalledTimes(1)
      const b = mk(); const fb = vi.fn(); b.whenSettled(fb)
      b.trackingStarted(); vi.advanceTimersByTime(2499); expect(fb).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1); expect(fb).toHaveBeenCalledTimes(1)
      const c = mk(); const fc = vi.fn(); c.whenSettled(fc)
      vi.advanceTimersByTime(14999); expect(fc).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1); expect(fc).toHaveBeenCalledTimes(1)
      const d = new RegexShareStartupGate({ settled: true, setTimeout, clearTimeout: () => {}, log: () => {} })
      const fd = vi.fn(); d.whenSettled(fd); expect(fd).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('接線守門', () => {
  const main = read('../src/main.ts')
  it('second-instance:--quit / --install-update 之後、叫出視窗之前先處理分享碼', () => {
    const fn = main.slice(main.indexOf("app.on('second-instance'"), main.indexOf("app.on('second-instance'") + 900)
    const i = fn.indexOf('handleRegexShareArgv(argv, workingDirectory)')
    expect(i).toBeGreaterThan(fn.indexOf("argv.includes('--install-update')"))
    expect(i).toBeLessThan(fn.indexOf('showApp()'))
  })
  it('首次啟動也處理 argv;等啟動穩定再決定顯示目標;attach / 開始追蹤通知閘門', () => {
    expect(main).toContain('handleRegexShareArgv(process.argv, process.cwd())')
    expect(main).toContain('regexShareGate.whenSettled(() => { routeRegexShare(req) })')
    expect(main).toContain("regexShareGate.settle('遊戲 attach')")
    expect(main.indexOf('regexShareGate.trackingStarted()')).toBeGreaterThan(main.indexOf('overlay.updateOpts(normalizeHotkey(cfg.overlayKey), title, cfg.game)'))
    expect(main).toContain("openPreviewInBrowser('#tab=regex')")
  })
  it('regex-share-take:預覽端可呼叫,依來源只交出同目標;regex-share 事件不進 PREVIEW_EVENTS', () => {
    const entry = main.slice(main.indexOf("'regex-share-take': {"), main.indexOf("'regex-share-take': {") + 500)
    expect(entry).not.toContain('preview: false')
    expect(entry).toContain("ctx.source === 'preview' ? 'preview' : 'app'")
    expect(HOST_METHOD_CHANNELS.regexShareTake).toBe('regex-share-take')
    const handlers = read('../src/host-handlers.ts')
    const m = /PREVIEW_EVENTS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(handlers)
    expect(m?.[1]).not.toContain('regex-share')
  })
  it('preload 對應', () => {
    const preload = read('../src/preload.ts')
    expect(preload).toContain("regexShareTake: () => ipcRenderer.invoke('regex-share-take')")
    expect(preload).toContain("onRegexShare: (cb: (req: RegexShareRequest) => void) => subscribe('regex-share', cb)")
  })
})
