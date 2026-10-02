/**
 * 常駐記錄(第 28 步,「設定 › 記錄」):不依賴 `--ppz-log-file`,main 的 console 與 renderer 轉印行都進這裡。
 *
 * - `LogRing`:最近 N 行(預設 3000)環形緩衝,每行一個遞增 `seq`;`since(seq)` 給「只拿新的」。
 * - `LogBatcher`:即時追加的批次節流(預設 200 ms)。**只有訂閱中才累積 / 送出**(設定視窗打開「記錄」分頁才訂閱),
 *   平常每一行都不會過 IPC。
 * - `LogFileWriter`:`<logDir>/exile-appraiser-<YYYY-MM-DD>.log`,**非同步** write stream(一次只有一個寫入在進行,
 *   其餘排隊合併;不在 main thread 同步寫);單檔超過上限換成 `.1`(只留一份);啟動時刪超過 7 天的檔(只動符合檔名規則的)。
 *   fs / 時鐘 / 計時器全部可注入(測試用假的)。
 * - `AppLog`:把三者接起來;`captureConsole` 攔 console.log / warn / error(只攔一次,`--ppz-log-file` 的附加寫檔也掛在這裡)。
 *
 * 隱私:只存本機(userData/logs),不自動上傳;使用者要回報時自己在記錄分頁複製。
 */
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { LogEntry, LogLevel, LogSnapshot } from '@ipc/types'
export type { LogEntry, LogLevel, LogSnapshot }

export const LOG_RING_CAPACITY = 3000
export const LOG_BATCH_MS = 200
export const LOG_FILE_MAX_BYTES = 20 * 1024 * 1024
export const LOG_KEEP_DAYS = 7
/** 單行上限:超過截斷(堆疊很長的錯誤不撐爆緩衝 / 檔案) */
export const LOG_MAX_LINE_CHARS = 8000

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 本機時區 `YYYY-MM-DD` */
export function dateStamp (ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本機時區 `HH:MM:SS.mmm` */
export function timeStamp (ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** 單行上限截斷 */
export function clampLogText (text: string): string {
  return text.length > LOG_MAX_LINE_CHARS ? `${text.slice(0, LOG_MAX_LINE_CHARS)}…(截斷,原長 ${text.length} 字元)` : text
}

/** 一筆記錄 → 檔案 / 複製用的文字:`YYYY-MM-DD HH:MM:SS.mmm [LEVEL] text`;多行的續行縮排 4 格(一筆記錄 = 一個時間戳開頭的區塊) */
export function formatLogEntry (e: Pick<LogEntry, 'ts' | 'level' | 'text'>): string {
  return `${dateStamp(e.ts)} ${timeStamp(e.ts)} [${e.level.toUpperCase()}] ${e.text.replace(/\r?\n/g, '\n    ')}`
}

export const logFileName = (ms: number) => `exile-appraiser-${dateStamp(ms)}.log`
const LOG_FILE_RE = /^exile-appraiser-(\d{4})-(\d{2})-(\d{2})\.log(\.1)?$/

/** 檔名 → 該日 00:00(本機)的 ms;不符合規則(不是我們的檔)回 null */
export function parseLogFileDay (name: string): number | null {
  const m = LOG_FILE_RE.exec(name)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

// ---------------------------------------------------------------------------------------------------------------------

export class LogRing {
  private buf: LogEntry[] = []
  private seq = 0
  constructor (readonly capacity = LOG_RING_CAPACITY) {}

  push (ts: number, level: LogLevel, text: string): LogEntry {
    const e: LogEntry = { seq: ++this.seq, ts, level, text }
    this.buf.push(e)
    // 一次只多一筆;超過上限就丟最舊的(容量 3000,splice 成本可忽略)
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity)
    return e
  }

  /** 目前緩衝內容(舊 → 新);回傳複本 */
  snapshot (): LogEntry[] { return this.buf.slice() }

  /** seq 大於 `seq` 的記錄(舊 → 新) */
  since (seq: number): LogEntry[] {
    // 緩衝內 seq 連續遞增 → 直接算起點
    if (!this.buf.length) return []
    const first = this.buf[0].seq
    const from = Math.max(0, seq + 1 - first)
    return from >= this.buf.length ? [] : this.buf.slice(from)
  }

  get lastSeq (): number { return this.seq }
  get size (): number { return this.buf.length }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Timers {
  set: (fn: () => void, ms: number) => unknown
  clear: (h: unknown) => void
}
const REAL_TIMERS: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as NodeJS.Timeout) }

/**
 * 即時追加的批次節流:訂閱中第一筆起算 `intervalMs`,時間到把累積的整批 `emit` 出去。
 * 沒有訂閱 → `add` 直接丟掉(不累積、不開計時器);取消訂閱 → 丟掉尚未送出的。
 * 待送上限 = `maxPending`(暴量時只留最新的,renderer 以 seq 自己補洞 / 重抓快照)。
 */
export class LogBatcher {
  private on = false
  private pending: LogEntry[] = []
  private timer: unknown = null
  constructor (
    private readonly emit: (entries: LogEntry[]) => void,
    private readonly intervalMs = LOG_BATCH_MS,
    private readonly timers: Timers = REAL_TIMERS,
    private readonly maxPending = LOG_RING_CAPACITY
  ) {}

  get subscribed (): boolean { return this.on }

  setSubscribed (on: boolean): void {
    if (on === this.on) return
    this.on = on
    if (!on) {
      this.pending = []
      if (this.timer != null) { this.timers.clear(this.timer); this.timer = null }
    }
  }

  add (e: LogEntry): void {
    if (!this.on) return
    this.pending.push(e)
    if (this.pending.length > this.maxPending) this.pending.splice(0, this.pending.length - this.maxPending)
    if (this.timer == null) this.timer = this.timers.set(() => { this.timer = null; this.flush() }, this.intervalMs)
  }

  flush (): void {
    if (this.timer != null) { this.timers.clear(this.timer); this.timer = null }
    if (!this.on || !this.pending.length) return
    const out = this.pending
    this.pending = []
    try { this.emit(out) } catch { /* 視窗已關閉 */ }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface LogAppender {
  /** 寫入一塊文字,寫完(或失敗)才 resolve */
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}
export interface LogFs {
  mkdir: (dir: string) => Promise<void>
  readdir: (dir: string) => Promise<string[]>
  /** 檔案不存在回 null */
  stat: (file: string) => Promise<{ size: number, mtimeMs: number } | null>
  unlink: (file: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  openAppend: (file: string) => Promise<LogAppender>
}

export const nodeLogFs: LogFs = {
  mkdir: async (dir) => { await fs.mkdir(dir, { recursive: true }) },
  readdir: async (dir) => await fs.readdir(dir),
  stat: async (file) => {
    try { const s = await fs.stat(file); return { size: s.size, mtimeMs: s.mtimeMs } } catch { return null }
  },
  unlink: async (file) => { await fs.unlink(file) },
  rename: async (from, to) => { await fs.rename(from, to) },
  openAppend: async (file) => {
    const stream = fsSync.createWriteStream(file, { flags: 'a', encoding: 'utf8' })
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', reject)
    })
    // 開檔後的錯誤交給每次 write 的 callback;這裡只防「未處理的 error 事件」讓行程當掉
    let lastError: Error | null = null
    stream.on('error', (e) => { lastError = e })
    return {
      write: (data) => new Promise<void>((resolve, reject) => {
        if (lastError) { reject(lastError); return }
        stream.write(data, (err) => { if (err) reject(err); else resolve() })
      }),
      close: () => new Promise<void>((resolve) => { stream.end(() => resolve()) })
    }
  }
}

export interface LogFileWriterOptions {
  dir: string
  fs?: LogFs
  now?: () => number
  maxBytes?: number
  keepDays?: number
  /** 檔案層錯誤(只回報第一次,避免洗版;絕不能再寫進 console 攔截鏈) */
  onError?: (e: unknown) => void
}

/**
 * 非同步寫檔:`write(text)` 只排進佇列;同時間只有一個 drain 在跑,把排隊的合併成一塊寫。
 * 日期換了 → 換新檔;寫入會讓檔案超過上限 → 目前檔改名 `.1`(覆蓋舊的 `.1`)再開新檔。
 */
export class LogFileWriter {
  private readonly fs: LogFs
  private readonly now: () => number
  private readonly maxBytes: number
  private readonly keepMs: number
  private queue: string[] = []
  private draining: Promise<void> | null = null
  private cur: { file: string, day: string, size: number, h: LogAppender } | null = null
  private reported = false
  private closed = false

  constructor (private readonly o: LogFileWriterOptions) {
    this.fs = o.fs ?? nodeLogFs
    this.now = o.now ?? Date.now
    this.maxBytes = o.maxBytes ?? LOG_FILE_MAX_BYTES
    this.keepMs = (o.keepDays ?? LOG_KEEP_DAYS) * 86_400_000
  }

  /** 啟動時呼叫:刪 `keepDays` 天前的記錄檔(只刪符合 `exile-appraiser-<日期>.log[.1]` 的檔,依檔案修改時間)。回傳刪掉的檔名。 */
  async purgeOld (): Promise<string[]> {
    const removed: string[] = []
    try {
      await this.fs.mkdir(this.o.dir)
      const cutoff = this.now() - this.keepMs
      for (const name of await this.fs.readdir(this.o.dir)) {
        if (parseLogFileDay(name) == null) continue
        const file = path.join(this.o.dir, name)
        const st = await this.fs.stat(file)
        if (st && st.mtimeMs < cutoff) {
          try { await this.fs.unlink(file); removed.push(name) } catch { /* 被占用 / 已刪 */ }
        }
      }
    } catch (e) { this.report(e) }
    return removed
  }

  write (text: string): void {
    if (this.closed) return
    this.queue.push(text)
    if (!this.draining) this.draining = this.drain().finally(() => { this.draining = null })
  }

  /** 等目前排隊的寫完(測試 / 結束前) */
  async idle (): Promise<void> {
    while (this.draining) await this.draining
  }

  async close (): Promise<void> {
    await this.idle()
    this.closed = true
    const c = this.cur
    this.cur = null
    if (c) { try { await c.h.close() } catch { /* ignore */ } }
  }

  private report (e: unknown): void {
    if (this.reported) return
    this.reported = true
    try { this.o.onError?.(e) } catch { /* ignore */ }
  }

  private async drain (): Promise<void> {
    while (this.queue.length) {
      const chunk = this.queue.join('\n') + '\n'
      this.queue = []
      try {
        await this.writeChunk(chunk)
      } catch (e) {
        this.report(e)
        // 寫失敗:關掉目前的 handle(下一塊重開);這一塊丟掉,不無限重試
        const c = this.cur
        this.cur = null
        if (c) { try { await c.h.close() } catch { /* ignore */ } }
      }
    }
  }

  private async writeChunk (chunk: string): Promise<void> {
    const t = this.now()
    const day = dateStamp(t)
    const bytes = Buffer.byteLength(chunk, 'utf8')
    if (this.cur && this.cur.day !== day) {
      const old = this.cur
      this.cur = null
      await old.h.close()
    }
    if (!this.cur) {
      await this.fs.mkdir(this.o.dir)
      const file = path.join(this.o.dir, logFileName(t))
      const st = await this.fs.stat(file)
      this.cur = { file, day, size: st?.size ?? 0, h: await this.fs.openAppend(file) }
    }
    if (this.cur.size > 0 && this.cur.size + bytes > this.maxBytes) {
      const { file, h } = this.cur
      this.cur = null
      await h.close()
      const rolled = file + '.1'
      try { await this.fs.unlink(rolled) } catch { /* 沒有舊的 */ }
      await this.fs.rename(file, rolled)
      this.cur = { file, day, size: 0, h: await this.fs.openAppend(file) }
    }
    await this.cur.h.write(chunk)
    this.cur.size += bytes
  }
}

// ---------------------------------------------------------------------------------------------------------------------


export interface AppLogOptions {
  capacity?: number
  now?: () => number
  /** 即時追加(批次);只在有訂閱時才會被呼叫 */
  emit?: (entries: LogEntry[]) => void
  batchMs?: number
  timers?: Timers
}

export class AppLog {
  readonly ring: LogRing
  private readonly batcher: LogBatcher
  private readonly now: () => number
  private file: LogFileWriter | null = null
  private extra: Array<(line: string, e: LogEntry) => void> = []

  constructor (o: AppLogOptions = {}) {
    this.ring = new LogRing(o.capacity)
    this.now = o.now ?? Date.now
    this.batcher = new LogBatcher(o.emit ?? (() => {}), o.batchMs, o.timers)
  }

  /** 記一行(console 攔截、renderer 轉印都走這裡) */
  add (level: LogLevel, text: string): LogEntry {
    const e = this.ring.push(this.now(), level, clampLogText(text))
    this.batcher.add(e)
    if (this.file) this.file.write(formatLogEntry(e))
    if (this.extra.length) {
      const line = formatLogEntry(e)
      for (const fn of this.extra) { try { fn(line, e) } catch { /* ignore */ } }
    }
    return e
  }

  /** 接上檔案寫入:先把目前緩衝裡的內容補寫進去(啟動初期、檔案目錄還沒定案前的行) */
  attachFile (w: LogFileWriter): void {
    this.file = w
    for (const e of this.ring.snapshot()) w.write(formatLogEntry(e))
  }

  /** 額外附加的同步訂閱(`--ppz-log-file` 用;收到已格式化的一行) */
  onLine (fn: (line: string, e: LogEntry) => void): void { this.extra.push(fn) }

  snapshot (sinceSeq?: number): LogSnapshot {
    return { entries: typeof sinceSeq === 'number' && sinceSeq > 0 ? this.ring.since(sinceSeq) : this.ring.snapshot(), lastSeq: this.ring.lastSeq }
  }

  setSubscribed (on: boolean): void { this.batcher.setSubscribed(on) }
  get subscribed (): boolean { return this.batcher.subscribed }
}

/**
 * 攔 console.log / warn / error(原本的輸出照舊):每次呼叫記進 `AppLog`。回傳還原函式(測試用)。
 * `fmt` = `util.format`。**只能裝一次**(main.ts 啟動最前面)。
 */
export function captureConsole (
  target: Pick<Console, 'log' | 'warn' | 'error'>,
  log: AppLog,
  fmt: (...args: unknown[]) => string
): () => void {
  const levels = { log: 'info', warn: 'warn', error: 'error' } as const
  const saved = { log: target.log, warn: target.warn, error: target.error }
  for (const k of ['log', 'warn', 'error'] as const) {
    const orig = saved[k].bind(target)
    target[k] = (...args: unknown[]) => {
      orig(...args)
      try { log.add(levels[k], fmt(...args)) } catch { /* 記錄失敗絕不影響呼叫端 */ }
    }
  }
  return () => { target.log = saved.log; target.warn = saved.warn; target.error = saved.error }
}

/** Electron `console-message` 的等級(新版字串、舊版數字 0 verbose / 1 info / 2 warning / 3 error)→ console 方法 */
export function consoleMethodForLevel (level: unknown): 'log' | 'warn' | 'error' {
  if (level === 'error' || level === 3) return 'error'
  if (level === 'warning' || level === 2) return 'warn'
  return 'log'
}
