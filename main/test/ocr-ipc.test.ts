// exile-appraiser 效能修正第 7 步:兩個掃描共用擷取(SharedCapture)、WinOcr 暫存檔協定與殘留清理。
// 子程序用假的(不啟動 PowerShell / WinRT);暫存目錄在 os.tmpdir() 下測試自己建、測完刪。
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { SHARED_CAPTURE_TTL_MS, SharedCapture, type ScanCapture, type ScanClock } from '../src/ocr/panel-scan'
import { OCR_TMP_MAX_AGE_MS, OcrError, WinOcr, cleanStaleOcrFiles } from '../src/ocr/WinOcr'

// ---------------- SharedCapture ----------------

function fakeClock () {
  let t = 0
  let id = 0
  const timers = new Map<number, { at: number, fn: () => void }>()
  const clock: ScanClock = {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id },
    clearTimeout: (h) => { timers.delete(h as number) }
  }
  const advance = (ms: number) => {
    t += ms
    for (const [k, v] of [...timers]) if (v.at <= t) { timers.delete(k); v.fn() }
  }
  return { clock, advance, timers }
}

const fakeCap = (n: number): ScanCapture => ({
  size: { w: n, h: n },
  offset: { x: 0, y: 0 },
  client: { w: n, h: n },
  fingerprint: () => ({ w: 1, h: 1, data: new Uint8Array([n & 255]) }),
  recognize: async () => ({ lines: [], ms: 0 })
})

describe('SharedCapture:兩個掃描共用擷取', () => {
  const B = { x: 0, y: 0, width: 2560, height: 1440 }

  it('進行中的擷取一起等(只擷取一次,拿到同一張)', async () => {
    const { clock } = fakeClock()
    let release!: (c: ScanCapture) => void
    const fn = vi.fn(() => new Promise<ScanCapture>(r => { release = r }))
    const sc = new SharedCapture(fn, { clock })
    const a = sc.capture(B)
    const b = sc.capture(B)
    release(fakeCap(1))
    const [ca, cb] = await Promise.all([a, b])
    expect(ca).toBe(cb)
    expect(fn).toHaveBeenCalledTimes(1)
    expect([sc.runs, sc.reuses]).toEqual([1, 1])
  })

  it(`完成後 ${SHARED_CAPTURE_TTL_MS} ms 內同一 bounds 用同一張;過了、或 bounds 不同就重新擷取`, async () => {
    const { clock, advance } = fakeClock()
    let n = 0
    const fn = vi.fn(async () => fakeCap(++n))
    const sc = new SharedCapture(fn, { clock })
    const c1 = await sc.capture(B)
    advance(SHARED_CAPTURE_TTL_MS)
    expect(await sc.capture(B)).toBe(c1)
    expect(fn).toHaveBeenCalledTimes(1)
    const moved = await sc.capture({ ...B, x: 10 })
    expect(moved).not.toBe(c1)
    expect(fn).toHaveBeenCalledTimes(2)
    advance(SHARED_CAPTURE_TTL_MS + 1)
    const c3 = await sc.capture({ ...B, x: 10 })
    expect(c3).not.toBe(moved)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('時間窗過了就放掉影像參考(計時器)', async () => {
    const { clock, advance, timers } = fakeClock()
    const fn = vi.fn(async () => fakeCap(7))
    const sc = new SharedCapture(fn, { clock })
    await sc.capture(B)
    expect(timers.size).toBe(1)
    advance(SHARED_CAPTURE_TTL_MS + 1)
    expect(timers.size).toBe(0)
    expect((sc as unknown as { last: unknown }).last).toBeNull()
    await sc.capture(B)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('擷取失敗不快取:一起等的拿到同一個錯誤,下一次重新擷取', async () => {
    const { clock } = fakeClock()
    let fail = true
    const fn = vi.fn(async () => { if (fail) throw new Error('capture-failed'); return fakeCap(1) })
    const sc = new SharedCapture(fn, { clock })
    const a = sc.capture(B)
    const b = sc.capture(B)
    await expect(a).rejects.toThrow('capture-failed')
    await expect(b).rejects.toThrow('capture-failed')
    fail = false
    await expect(sc.capture(B)).resolves.toBeTruthy()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

// ---------------- WinOcr 暫存檔協定 ----------------

class FakeProc extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  written: string[] = []
  onLine: ((line: string) => void) | null = null
  stdin = new Writable({
    write: (chunk, _enc, cb) => {
      const s = chunk.toString()
      this.written.push(s)
      this.onLine?.(s)
      cb()
    }
  })

  kill = vi.fn(() => { setImmediate(() => this.emit('exit', null)); return true })
  reply (obj: unknown) { this.stdout.write(JSON.stringify(obj) + '\n') }
}

let root = ''
let platformDesc: PropertyDescriptor | undefined
beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ea-ocr-ipc-test-'))
  platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
})
afterAll(() => {
  if (platformDesc) Object.defineProperty(process, 'platform', platformDesc)
  rmSync(root, { recursive: true, force: true })
})

let proc: FakeProc
let dirN = 0
let tmpDir = ''
beforeEach(() => {
  tmpDir = path.join(root, `d${++dirN}`)
  proc = new FakeProc()
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => {
    setImmediate(() => proc.reply({ ready: true, lang: 'zh-Hant-TW', langs: ['zh-Hant-TW'], maxDim: 10000 }))
    return proc
  })
})
afterEach(() => { vi.useRealTimers() })

const LINE = { text: '+ 60 護 甲 值', x: 1, y: 2, w: 3, h: 4 }
const IMG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5])

describe('WinOcr:影像走暫存檔、可不要 words', () => {
  it('recognize(img, { words: false }):stdin 只帶路徑與 words:false,檔案內容 = 影像;回應後檔案刪掉', async () => {
    const ocr = new WinOcr('# script', { tmpDir, log: () => {} })
    let seen: { req: any, bytes: Buffer | null } | null = null
    proc.onLine = (s) => {
      const req = JSON.parse(s)
      seen = { req, bytes: existsSync(req.path) ? readFileSync(req.path) : null }
      proc.reply({ id: req.id, ms: 5, w: 10, h: 10, lines: [LINE] })
    }
    const res = await ocr.recognize(IMG, { words: false })
    expect(res).toEqual({ ms: 5, w: 10, h: 10, lines: [LINE] })
    expect(seen!.req).toEqual({ id: '1', path: expect.any(String), words: false })
    expect(seen!.req.image).toBeUndefined()
    expect(path.dirname(seen!.req.path)).toBe(tmpDir)
    expect(path.basename(seen!.req.path)).toMatch(new RegExp(`^${process.pid}-\\d+-1\\.img$`))
    expect(seen!.bytes?.equals(IMG)).toBe(true)
    expect(existsSync(seen!.req.path)).toBe(false)
    expect(proc.written).toHaveLength(1)
    expect(proc.written[0].endsWith('\n')).toBe(true)
    ocr.close()
  })

  it('預設(不給 words)請求不帶 words 鍵 = 舊協定(腳本照舊輸出 words)', async () => {
    const ocr = new WinOcr('# script', { tmpDir, log: () => {} })
    proc.onLine = (s) => { const req = JSON.parse(s); proc.reply({ id: req.id, ms: 1, w: 1, h: 1, lines: [{ ...LINE, words: [LINE] }] }) }
    const res = await ocr.recognize(IMG)
    expect(Object.keys(JSON.parse(proc.written[0]))).toEqual(['id', 'path'])
    expect(res.lines[0].words).toEqual([LINE])
    ocr.close()
  })

  it('錯誤回應 → ocr-failed,暫存檔一樣刪掉;下一筆照常', async () => {
    const ocr = new WinOcr('# script', { tmpDir, log: () => {} })
    const paths: string[] = []
    let n = 0
    proc.onLine = (s) => {
      const req = JSON.parse(s)
      paths.push(req.path)
      if (++n === 1) proc.reply({ id: req.id, error: 'bad image' })
      else proc.reply({ id: req.id, ms: 1, w: 1, h: 1, lines: [] })
    }
    await expect(ocr.recognize(IMG, { words: false })).rejects.toMatchObject({ kind: 'ocr-failed' })
    await expect(ocr.recognize(IMG, { words: false })).resolves.toMatchObject({ lines: [] })
    expect(paths).toHaveLength(2)
    expect(paths[0]).not.toBe(paths[1])
    for (const p of paths) expect(existsSync(p)).toBe(false)
    expect(readdirSync(tmpDir)).toEqual([])
    ocr.close()
  })

  it('逾時 → timeout、殺行程、暫存檔刪掉', async () => {
    const ocr = new WinOcr('# script', { tmpDir, timeoutMs: 30, log: () => {} })
    let p = ''
    proc.onLine = (s) => { p = JSON.parse(s).path }
    const err = await ocr.recognize(IMG, { words: false }).catch(e => e)
    expect(err).toBeInstanceOf(OcrError)
    expect((err as OcrError).kind).toBe('timeout')
    expect(proc.kill).toHaveBeenCalled()
    expect(p).not.toBe('')
    expect(existsSync(p)).toBe(false)
  })

  it('暫存目錄建不起來 → 退回 stdin base64(只警告一次),結果照常', async () => {
    const asFile = path.join(root, `not-a-dir-${dirN}`)
    writeFileSync(asFile, 'x')
    const logs: string[] = []
    const ocr = new WinOcr('# script', { tmpDir: path.join(asFile, 'sub'), log: (m) => { logs.push(m) } })
    proc.onLine = (s) => { const req = JSON.parse(s); proc.reply({ id: req.id, ms: 1, w: 1, h: 1, lines: [LINE] }) }
    expect((await ocr.recognize(IMG, { words: false })).lines).toEqual([LINE])
    expect((await ocr.recognize(IMG, { words: false })).lines).toEqual([LINE])
    const reqs = proc.written.map(s => JSON.parse(s))
    expect(reqs.map(r => r.path)).toEqual([undefined, undefined])
    expect(reqs.map(r => Buffer.from(r.image, 'base64').equals(IMG))).toEqual([true, true])
    expect(reqs.every(r => r.words === false)).toBe(true)
    expect(logs.filter(l => l.includes('暫存檔寫不進去'))).toHaveLength(1)
    ocr.close()
  })

  it('recognizeFile 直接送使用者給的路徑,不建 / 不刪暫存檔', async () => {
    const own = path.join(root, `own-${dirN}.png`)
    writeFileSync(own, IMG)
    const ocr = new WinOcr('# script', { tmpDir, log: () => {} })
    proc.onLine = (s) => { const req = JSON.parse(s); proc.reply({ id: req.id, ms: 1, w: 1, h: 1, lines: [] }) }
    await ocr.recognizeFile(own)
    expect(JSON.parse(proc.written[0])).toEqual({ id: '1', path: own })
    expect(existsSync(own)).toBe(true)
    expect(existsSync(tmpDir)).toBe(false)
    ocr.close()
  })

  it('第一次寫暫存檔前清掉殘留(已結束行程的檔),別的檔不動', async () => {
    mkdirSync(tmpDir, { recursive: true })
    const dead = path.join(tmpDir, '999999999-1-3.img')
    const other = path.join(tmpDir, 'keep-me.txt')
    writeFileSync(dead, 'x')
    writeFileSync(other, 'x')
    const ocr = new WinOcr('# script', { tmpDir, log: () => {} })
    proc.onLine = (s) => { const req = JSON.parse(s); proc.reply({ id: req.id, ms: 1, w: 1, h: 1, lines: [] }) }
    await ocr.recognize(IMG, { words: false })
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(other)).toBe(true)
    ocr.close()
  })
})

describe('cleanStaleOcrFiles', () => {
  it('pid 不在 → 刪;pid 在但超過 1 小時 → 刪;新的 / 本行程 / 不認得的檔名 → 留', async () => {
    const dir = path.join(root, 'stale')
    mkdirSync(dir, { recursive: true })
    const now = Date.now()
    const f = (name: string, ageMs = 0) => {
      const p = path.join(dir, name)
      writeFileSync(p, 'x')
      const t = (now - ageMs) / 1000
      utimesSync(p, t, t)
      return name
    }
    f('100-1-1.img') // 已結束
    f('200-1-1.img') // 活著、新
    f('200-2-9.img', OCR_TMP_MAX_AGE_MS + 60_000) // 活著、太舊
    f(`${process.pid}-1-1.img`, OCR_TMP_MAX_AGE_MS * 2) // 本行程:不碰
    f('300-1-1.png') // 不認得的副檔名
    f('notes.txt')
    const removed = await cleanStaleOcrFiles(dir, { now, isAlive: (pid) => pid !== 100 })
    expect(removed).toBe(2)
    expect(readdirSync(dir).sort()).toEqual([`${process.pid}-1-1.img`, '200-1-1.img', '300-1-1.png', 'notes.txt'].sort())
  })

  it('目錄不存在 → 0,不丟錯', async () => {
    expect(await cleanStaleOcrFiles(path.join(root, 'nope'))).toBe(0)
  })
})
