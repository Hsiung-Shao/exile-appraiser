// 常駐記錄(main/src/app-log.ts,第 28 步):環形緩衝、批次節流與訂閱、console 攔截、檔案輪替 / 舊檔清除(假 fs / 假時鐘)、
// 以及 IPC 登錄表守門(log-get / log-subscribe / log-open-folder 的登錄、preload、預覽端對應)。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AppLog, LogBatcher, LogFileWriter, LogRing, LOG_MAX_LINE_CHARS, captureConsole, clampLogText, consoleMethodForLevel,
  dateStamp, formatLogEntry, logFileName, parseLogFileDay, type LogAppender, type LogEntry, type LogFs, type Timers
} from '../src/app-log'
import { formatLogLine } from '../../renderer/src/web/settings/log-view'
import { HOST_EVENT_METHODS, HOST_METHOD_CHANNELS, PREVIEW_NOOP_SYNC, bootScript } from '../src/preview-server'

const DAY = 86_400_000
/** 本機時區的指定時間(避免時區差讓日期檔名飄) */
const at = (y: number, mo: number, d: number, h = 12, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime()

class FakeTimers implements Timers {
  private next = 1
  readonly pending = new Map<number, { fn: () => void, ms: number }>()
  set (fn: () => void, ms: number) { const id = this.next++; this.pending.set(id, { fn, ms }); return id }
  clear (h: unknown) { this.pending.delete(h as number) }
  /** 全部到期的都跑一遍 */
  fire () { const all = [...this.pending.entries()]; this.pending.clear(); for (const [, t] of all) t.fn() }
}

class FakeFs implements LogFs {
  files = new Map<string, { data: string, mtimeMs: number }>()
  dirs = new Set<string>()
  ops: string[] = []
  failWrites = 0
  now = () => 0
  async mkdir (dir: string) { this.dirs.add(dir) }
  async readdir (dir: string) {
    return [...this.files.keys()].filter(f => path.dirname(f) === dir).map(f => path.basename(f))
  }

  async stat (file: string) {
    const f = this.files.get(file)
    return f ? { size: Buffer.byteLength(f.data), mtimeMs: f.mtimeMs } : null
  }

  async unlink (file: string) {
    if (!this.files.delete(file)) throw new Error('ENOENT')
    this.ops.push(`unlink ${path.basename(file)}`)
  }

  async rename (from: string, to: string) {
    const f = this.files.get(from)
    if (!f) throw new Error('ENOENT')
    this.files.delete(from)
    this.files.set(to, f)
    this.ops.push(`rename ${path.basename(from)} -> ${path.basename(to)}`)
  }

  async openAppend (file: string): Promise<LogAppender> {
    if (!this.files.has(file)) this.files.set(file, { data: '', mtimeMs: this.now() })
    this.ops.push(`open ${path.basename(file)}`)
    return {
      write: async (data) => {
        await Promise.resolve()
        if (this.failWrites > 0) { this.failWrites--; throw new Error('EIO') }
        const f = this.files.get(file)
        if (!f) throw new Error('ENOENT')
        f.data += data
        f.mtimeMs = this.now()
      },
      close: async () => { this.ops.push(`close ${path.basename(file)}`) }
    }
  }
}

const DIR = path.join('C:', 'ud', 'logs')

describe('LogRing', () => {
  it('超過上限丟最舊的、順序舊 → 新、seq 連續遞增', () => {
    const r = new LogRing(5)
    for (let i = 1; i <= 8; i++) r.push(i * 10, 'info', `line ${i}`)
    const snap = r.snapshot()
    expect(snap.map(e => e.text)).toEqual(['line 4', 'line 5', 'line 6', 'line 7', 'line 8'])
    expect(snap.map(e => e.seq)).toEqual([4, 5, 6, 7, 8])
    expect(r.lastSeq).toBe(8)
    expect(r.size).toBe(5)
  })

  it('預設容量 3000', () => {
    const r = new LogRing()
    for (let i = 0; i < 3500; i++) r.push(i, 'info', String(i))
    expect(r.size).toBe(3000)
    expect(r.snapshot()[0].text).toBe('500')
    expect(r.snapshot()[2999].text).toBe('3499')
  })

  it('since(seq):只回較新的;太舊(已被擠掉)= 回目前全部;太新 = 空', () => {
    const r = new LogRing(5)
    for (let i = 1; i <= 8; i++) r.push(i, 'info', `l${i}`)
    expect(r.since(6).map(e => e.seq)).toEqual([7, 8])
    expect(r.since(2).map(e => e.seq)).toEqual([4, 5, 6, 7, 8])
    expect(r.since(8)).toEqual([])
    expect(r.since(99)).toEqual([])
    expect(new LogRing(3).since(0)).toEqual([])
  })

  it('snapshot 回傳複本(改了不影響緩衝)', () => {
    const r = new LogRing(3)
    r.push(1, 'info', 'a')
    r.snapshot().pop()
    expect(r.size).toBe(1)
  })
})

describe('LogBatcher(批次節流 + 訂閱開關)', () => {
  const mk = () => {
    const timers = new FakeTimers()
    const out: LogEntry[][] = []
    const b = new LogBatcher(es => out.push(es), 200, timers)
    const e = (seq: number): LogEntry => ({ seq, ts: seq, level: 'info', text: `l${seq}` })
    return { timers, out, b, e }
  }

  it('沒有訂閱:add 不累積、不開計時器、不送', () => {
    const { timers, out, b, e } = mk()
    b.add(e(1)); b.add(e(2))
    expect(timers.pending.size).toBe(0)
    timers.fire()
    expect(out).toEqual([])
  })

  it('訂閱後第一筆起算 200 ms,同一批只開一個計時器、整批送出', () => {
    const { timers, out, b, e } = mk()
    b.setSubscribed(true)
    b.add(e(1)); b.add(e(2)); b.add(e(3))
    expect(timers.pending.size).toBe(1)
    expect([...timers.pending.values()][0].ms).toBe(200)
    expect(out).toEqual([])
    timers.fire()
    expect(out).toHaveLength(1)
    expect(out[0].map(x => x.seq)).toEqual([1, 2, 3])
    // 下一批重新計時
    b.add(e(4))
    expect(timers.pending.size).toBe(1)
    timers.fire()
    expect(out.map(o => o.map(x => x.seq))).toEqual([[1, 2, 3], [4]])
  })

  it('取消訂閱:丟掉尚未送出的並取消計時器;再訂閱不補送舊的', () => {
    const { timers, out, b, e } = mk()
    b.setSubscribed(true)
    b.add(e(1))
    b.setSubscribed(false)
    expect(timers.pending.size).toBe(0)
    timers.fire()
    b.setSubscribed(true)
    timers.fire()
    expect(out).toEqual([])
    b.add(e(2))
    timers.fire()
    expect(out.map(o => o.map(x => x.seq))).toEqual([[2]])
  })

  it('待送超過上限:只留最新的', () => {
    const timers = new FakeTimers()
    const out: LogEntry[][] = []
    const b = new LogBatcher(es => out.push(es), 200, timers, 3)
    b.setSubscribed(true)
    for (let i = 1; i <= 7; i++) b.add({ seq: i, ts: i, level: 'info', text: '' })
    timers.fire()
    expect(out[0].map(x => x.seq)).toEqual([5, 6, 7])
  })

  it('emit 丟例外(視窗已關)不影響後續', () => {
    const timers = new FakeTimers()
    let n = 0
    const b = new LogBatcher(() => { n++; throw new Error('destroyed') }, 200, timers)
    b.setSubscribed(true)
    b.add({ seq: 1, ts: 1, level: 'info', text: '' })
    expect(() => timers.fire()).not.toThrow()
    b.add({ seq: 2, ts: 2, level: 'info', text: '' })
    timers.fire()
    expect(n).toBe(2)
  })
})

describe('captureConsole', () => {
  it('log / warn / error 各記成 info / warn / error,原輸出照舊,format 多參數', () => {
    const calls: string[] = []
    const target = {
      log: (...a: unknown[]) => { calls.push('log:' + a.join(' ')) },
      warn: (...a: unknown[]) => { calls.push('warn:' + a.join(' ')) },
      error: (...a: unknown[]) => { calls.push('error:' + a.join(' ')) }
    }
    const log = new AppLog({ now: () => 5 })
    const restore = captureConsole(target, log, (...a) => a.join('|'))
    target.log('a', 1)
    target.warn('b')
    target.error('c', 'd')
    expect(calls).toEqual(['log:a 1', 'warn:b', 'error:c d'])
    expect(log.snapshot().entries.map(e => [e.level, e.text])).toEqual([['info', 'a|1'], ['warn', 'b'], ['error', 'c|d']])
    restore()
    target.log('after')
    expect(log.snapshot().entries).toHaveLength(3)
  })

  it('記錄端丟例外絕不影響呼叫端', () => {
    const target = { log: () => {}, warn: () => {}, error: () => {} }
    const log = new AppLog()
    captureConsole(target, log, () => { throw new Error('fmt') })
    expect(() => target.log('x')).not.toThrow()
  })
})

describe('consoleMethodForLevel / 格式', () => {
  it('Electron console-message 等級(字串 / 舊版數字)對應', () => {
    expect(consoleMethodForLevel('error')).toBe('error')
    expect(consoleMethodForLevel(3)).toBe('error')
    expect(consoleMethodForLevel('warning')).toBe('warn')
    expect(consoleMethodForLevel(2)).toBe('warn')
    expect(consoleMethodForLevel('info')).toBe('log')
    expect(consoleMethodForLevel(1)).toBe('log')
    expect(consoleMethodForLevel('debug')).toBe('log')
    expect(consoleMethodForLevel(undefined)).toBe('log')
  })

  it('formatLogEntry:日期 時間 [等級] 內容;多行續行縮排 4 格;與 renderer 複製格式逐字相同', () => {
    const e = { ts: at(2026, 10, 3, 9, 5, 7, 42), level: 'warn' as const, text: 'a\nb\r\nc' }
    expect(formatLogEntry(e)).toBe('2026-10-03 09:05:07.042 [WARN] a\n    b\n    c')
    expect(formatLogLine(e)).toBe(formatLogEntry(e))
    expect(formatLogLine({ ts: 1, level: 'error', text: 'x' })).toBe(formatLogEntry({ ts: 1, level: 'error', text: 'x' }))
  })

  it('clampLogText:過長截斷並註明原長', () => {
    expect(clampLogText('abc')).toBe('abc')
    const long = 'x'.repeat(LOG_MAX_LINE_CHARS + 50)
    const out = clampLogText(long)
    expect(out.startsWith('x'.repeat(LOG_MAX_LINE_CHARS))).toBe(true)
    expect(out).toContain(String(long.length))
  })

  it('檔名與日期解析:只認 exile-appraiser-YYYY-MM-DD.log(.1)', () => {
    const t = at(2026, 10, 3)
    expect(logFileName(t)).toBe('exile-appraiser-2026-10-03.log')
    expect(parseLogFileDay('exile-appraiser-2026-10-03.log')).toBe(at(2026, 10, 3, 0))
    expect(parseLogFileDay('exile-appraiser-2026-10-03.log.1')).toBe(at(2026, 10, 3, 0))
    for (const bad of ['config.json', 'exile-appraiser-2026-10-03.log.2', 'exile-appraiser-2026-10-03.txt', 'x-exile-appraiser-2026-10-03.log', 'exile-appraiser-latest.log']) {
      expect(parseLogFileDay(bad)).toBeNull()
    }
  })
})

describe('LogFileWriter(假 fs / 假時鐘)', () => {
  const mk = (over: { maxBytes?: number, keepDays?: number } = {}) => {
    const ffs = new FakeFs()
    const clock = { t: at(2026, 10, 3, 12) }
    ffs.now = () => clock.t
    const errors: unknown[] = []
    const w = new LogFileWriter({ dir: DIR, fs: ffs, now: () => clock.t, onError: e => errors.push(e), ...over })
    const file = (name: string) => ffs.files.get(path.join(DIR, name))
    return { ffs, clock, errors, w, file }
  }

  it('write 只排隊(同步回傳、不阻塞);idle 後依序寫進當日檔', async () => {
    const { w, file, ffs } = mk()
    const r = w.write('第一行')
    expect(r).toBeUndefined()
    w.write('第二行')
    expect(ffs.files.size).toBe(0) // 還沒真的寫(非同步)
    await w.idle()
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('第一行\n第二行\n')
    w.write('第三行')
    await w.idle()
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('第一行\n第二行\n第三行\n')
    // 同一個 handle 一直用(只開一次)
    expect(ffs.ops.filter(o => o.startsWith('open'))).toEqual(['open exile-appraiser-2026-10-03.log'])
  })

  it('已有的當日檔:接著附加(重新啟動同一天)', async () => {
    const { w, file, ffs, clock } = mk()
    ffs.files.set(path.join(DIR, 'exile-appraiser-2026-10-03.log'), { data: 'old\n', mtimeMs: clock.t })
    w.write('new')
    await w.idle()
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('old\nnew\n')
  })

  it('單檔超過上限 → 目前檔改名 .1(覆蓋舊的 .1)、新檔從頭寫', async () => {
    const { w, file, ffs } = mk({ maxBytes: 30 })
    w.write('a'.repeat(19)) // 20 bytes
    await w.idle()
    w.write('b'.repeat(19)) // 20 + 20 > 30 → 輪替
    await w.idle()
    expect(file('exile-appraiser-2026-10-03.log.1')?.data).toBe('a'.repeat(19) + '\n')
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('b'.repeat(19) + '\n')
    w.write('c'.repeat(19))
    await w.idle()
    // 第二次輪替:舊的 .1(a)被覆蓋成 b
    expect(file('exile-appraiser-2026-10-03.log.1')?.data).toBe('b'.repeat(19) + '\n')
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('c'.repeat(19) + '\n')
    expect(ffs.ops).toContain('rename exile-appraiser-2026-10-03.log -> exile-appraiser-2026-10-03.log.1')
  })

  it('排隊中的多行合併成一次寫入;單次寫入比上限大也照寫(不卡死)', async () => {
    const { w, file } = mk({ maxBytes: 10 })
    w.write('x'.repeat(50))
    await w.idle()
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('x'.repeat(50) + '\n')
  })

  it('跨日:換新檔(舊檔關閉保留)', async () => {
    const { w, file, clock, ffs } = mk()
    w.write('day1')
    await w.idle()
    clock.t = at(2026, 10, 4, 0, 0, 1)
    w.write('day2')
    await w.idle()
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('day1\n')
    expect(file('exile-appraiser-2026-10-04.log')?.data).toBe('day2\n')
    expect(ffs.ops).toContain('close exile-appraiser-2026-10-03.log')
  })

  it('purgeOld:刪 7 天前的 .log / .log.1,保留新的與不相干的檔', async () => {
    const { w, ffs, clock } = mk()
    const put = (name: string, ageDays: number) => ffs.files.set(path.join(DIR, name), { data: 'x', mtimeMs: clock.t - ageDays * DAY })
    put('exile-appraiser-2026-09-20.log', 13)
    put('exile-appraiser-2026-09-20.log.1', 13)
    put('exile-appraiser-2026-09-26.log', 7.5)
    put('exile-appraiser-2026-09-27.log', 6.5)
    put('exile-appraiser-2026-10-03.log', 0)
    put('config.json', 100)
    put('notes.log', 100)
    const removed = await w.purgeOld()
    expect(removed.sort()).toEqual(['exile-appraiser-2026-09-20.log', 'exile-appraiser-2026-09-20.log.1', 'exile-appraiser-2026-09-26.log'])
    expect([...ffs.files.keys()].map(f => path.basename(f)).sort()).toEqual([
      'config.json', 'exile-appraiser-2026-09-27.log', 'exile-appraiser-2026-10-03.log', 'notes.log'
    ])
  })

  it('purgeOld:目錄不存在 / 讀取失敗不丟例外(只回報一次)', async () => {
    const ffs = new FakeFs()
    ffs.readdir = async () => { throw new Error('EACCES') }
    const errors: unknown[] = []
    const w = new LogFileWriter({ dir: DIR, fs: ffs, now: () => 1, onError: e => errors.push(e) })
    expect(await w.purgeOld()).toEqual([])
    expect(await w.purgeOld()).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('寫入失敗:只回報第一次、丟掉那一塊、之後的行仍會寫', async () => {
    const { w, file, ffs, errors } = mk()
    ffs.failWrites = 1
    w.write('lost')
    await w.idle()
    expect(errors).toHaveLength(1)
    w.write('kept')
    await w.idle()
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('kept\n')
    ffs.failWrites = 1
    w.write('lost2')
    await w.idle()
    expect(errors).toHaveLength(1) // 不重複回報
  })

  it('close 後不再寫', async () => {
    const { w, file } = mk()
    w.write('a')
    await w.close()
    w.write('b')
    await w.idle()
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('a\n')
  })

  it('第 29 步:close() 呼叫後同一輪又有 write(結束時記 log)→ 不會在寫完後讀到 null 的 cur', async () => {
    const { w, file, errors } = mk()
    w.write('a')
    await w.idle()
    const closing = w.close()
    w.write('late') // 在 close 開始後(同步)進來:丟掉,不能炸
    await closing
    await w.idle()
    expect(errors).toHaveLength(0)
    expect(file('exile-appraiser-2026-10-03.log')?.data).toBe('a\n')
    // drain 進行中才 close:等 drain 結束(期間排進來的也一起寫完)再關
    const m2 = mk()
    m2.w.write('x')
    const c2 = m2.w.close()
    m2.w.write('y')
    await c2
    await m2.w.idle()
    expect(m2.errors).toHaveLength(0)
    expect(m2.file('exile-appraiser-2026-10-03.log')?.data).toBe('x\ny\n')
  })
})

describe('AppLog(整合)', () => {
  it('add:進緩衝、訂閱中才批次 emit、接上檔案後寫檔;attachFile 補寫已在緩衝裡的行', async () => {
    const timers = new FakeTimers()
    const emitted: LogEntry[][] = []
    const clock = { t: at(2026, 10, 3, 8) }
    const log = new AppLog({ now: () => clock.t, emit: es => emitted.push(es), timers })
    log.add('info', 'early') // 檔案還沒接上、沒有訂閱
    expect(timers.pending.size).toBe(0)

    const ffs = new FakeFs()
    ffs.now = () => clock.t
    const w = new LogFileWriter({ dir: DIR, fs: ffs, now: () => clock.t })
    log.attachFile(w)
    log.setSubscribed(true)
    log.add('error', 'boom')
    timers.fire()
    expect(emitted.map(b => b.map(e => e.text))).toEqual([['boom']])
    await w.idle()
    expect(ffs.files.get(path.join(DIR, logFileName(clock.t)))?.data).toBe(
      '2026-10-03 08:00:00.000 [INFO] early\n2026-10-03 08:00:00.000 [ERROR] boom\n'
    )
    expect(dateStamp(clock.t)).toBe('2026-10-03')
  })

  it('snapshot(sinceSeq) 與 lastSeq;onLine 收到格式化的一行', () => {
    const log = new AppLog({ now: () => at(2026, 10, 3, 1) })
    const lines: string[] = []
    log.onLine(l => lines.push(l))
    log.add('info', 'a'); log.add('warn', 'b'); log.add('info', 'c')
    expect(log.snapshot().lastSeq).toBe(3)
    expect(log.snapshot(1).entries.map(e => e.text)).toEqual(['b', 'c'])
    expect(log.snapshot(3).entries).toEqual([])
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatch(/\[WARN\] b$/)
  })

  it('單行過長在進緩衝前就截斷', () => {
    const log = new AppLog()
    log.add('info', 'y'.repeat(LOG_MAX_LINE_CHARS * 2))
    expect(log.snapshot().entries[0].text.length).toBeLessThan(LOG_MAX_LINE_CHARS + 100)
  })
})

// ---- IPC 登錄表守門(main.ts 不能在 Node 測試裡載入,改驗原始碼的登錄 / preload / 預覽端對應) ----
describe('IPC 登錄表守門:記錄', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8')
  const main = read('main.ts')
  const preload = read('preload.ts')

  /** 取登錄表裡某個 channel 的條目文字(到下一個頂層 channel 為止) */
  const entry = (ch: string) => {
    const i = main.indexOf(`'${ch}':`)
    expect(i, `main.ts 沒有登錄 ${ch}`).toBeGreaterThan(0)
    const rest = main.slice(i + 1)
    const next = rest.search(/\n    '[a-z-]+':/)
    return main.slice(i, i + 1 + (next < 0 ? rest.length : next))
  }

  it('log-get:invoke、預覽可讀(沒有 preview: false)', () => {
    const e = entry('log-get')
    expect(e).toContain("kind: 'invoke'")
    expect(e).not.toContain('preview: false')
  })

  it('log-subscribe:send(預覽端 no-op)', () => {
    expect(entry('log-subscribe')).toContain("kind: 'send'")
    expect((PREVIEW_NOOP_SYNC as readonly string[])).toContain('logSubscribe')
  })

  it('log-open-folder:invoke + preview: false;不在預覽方法表', () => {
    const e = entry('log-open-folder')
    expect(e).toContain("kind: 'invoke'")
    expect(e).toContain('preview: false')
    expect(Object.values(HOST_METHOD_CHANNELS)).not.toContain('log-open-folder')
    expect(Object.keys(HOST_METHOD_CHANNELS)).not.toContain('openLogFolder')
  })

  it('預覽端方法 / 事件對應:getLog → log-get;onLogLines → log-lines(但 log-lines 不在 PREVIEW_EVENTS,預覽端輪詢)', () => {
    expect(HOST_METHOD_CHANNELS.getLog).toBe('log-get')
    expect(HOST_EVENT_METHODS.onLogLines).toBe('log-lines')
    const hostHandlers = read('host-handlers.ts')
    const m = /PREVIEW_EVENTS[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(hostHandlers)
    expect(m).not.toBeNull()
    expect(m![1]).not.toContain('log-lines')
  })

  it('preload 對應 IPC channel;預覽 boot script 帶得出 log 分頁與方法', () => {
    expect(preload).toContain("ipcRenderer.invoke('log-get'")
    expect(preload).toContain("ipcRenderer.send('log-subscribe'")
    expect(preload).toContain("subscribe('log-lines'")
    expect(preload).toContain("ipcRenderer.invoke('log-open-folder')")
    const s = bootScript({ prefix: '/t/' + 'a'.repeat(32) + '/', version: '1.0.0' })
    expect(s).toContain("'log'")
    expect(s).toContain('"getLog"')
    expect(s).toContain('"logSubscribe"')
    expect(s).not.toContain('"openLogFolder"')
  })

  it('main:只在 app-log 攔一次 console;renderer 轉印走 console 等級方法;視窗重載重置訂閱', () => {
    expect(main.match(/captureConsole\(/g)).toHaveLength(1)
    expect(main).toContain('consoleMethodForLevel')
    expect(main).toContain("'did-start-loading'")
    expect(main).toContain('appLog.attachFile')
  })
})
