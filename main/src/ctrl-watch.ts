/**
 * 第五輪 30.1:不靠全域掛鉤偵測 Ctrl 有沒有按著(倉庫頁籤捲動只在「遊戲前景 + 按住 Ctrl」時才持有 uiohook 掛鉤)。
 *
 * 為什麼是常駐 PowerShell + 內嵌 C#(`Add-Type`)輪詢 `GetAsyncKeyState`(調查見 docs/perf/changes-round5.md 30.1):
 * - uiohook-napi(libuiohook)`start()` 一律同時裝 `WH_KEYBOARD_LL` + `WH_MOUSE_LL`,沒有只掛鍵盤的選項(要改得自編原生碼);
 * - electron-overlay-window 原生只匯出 start / activateOverlay / focusTarget / screenshot,沒有按鍵狀態;
 * - Electron `globalShortcut`(RegisterHotKey)不能註冊單獨的修飾鍵;`before-input-event` 只有 overlay 有焦點時才收得到;
 * - 專案沒有 koffi / ffi 之類的 FFI 套件,新增就是新的原生依賴 —— PowerShell 5.1 是 Windows 內建,本專案已用它跑 OCR / 列字體 / 偵測行程。
 * 輪詢在 C# 的迴圈裡做(每 `POLL_MS` 一次 `GetAsyncKeyState(VK_CONTROL)`),只有狀態改變才印一行;
 * main 不需要時送 `0` 讓迴圈停在 WaitHandle 上(不輪詢),需要時送 `1`。stdin 關閉(main 結束)= 行程自己結束。
 * 代價:一個常駐 powershell.exe(工作集約 80 MB;啟動含 C# 編譯約 0.9 秒),閒置(不需要)`IDLE_EXIT_MS` 後關掉。
 *
 * 失敗(沒有 powershell.exe(例如 Wine)、Add-Type 被擋、啟動逾時、反覆崩潰)→ `unavailable`:
 * 呼叫端退回改版前行為(遊戲前景期間一直持有掛鉤),功能不會因此失效。
 *
 * 協定:stdout 一行 `ready` / `c1`(按著)/ `c0`(放開);stdin 一行 `1`(開始輪詢,馬上回報目前狀態)/ `0`(停止輪詢)。
 * 狀態機與解析是純邏輯,行程以 `spawn` 注入(測試 `main/test/ctrl-watch.test.ts` 用假行程 + 假時鐘,不跑真的 PowerShell)。
 */
import { spawn } from 'node:child_process'

/**
 * 輪詢間隔。按下 Ctrl 到回報的最壞延遲 ≈ 50 ms + Windows 計時器刻度(15.6 ms)+ 管線,< 100 ms。
 * 2026-10-04 本機實測(輪詢中 30 秒 GetProcessTimes):30 ms ≈ 2.6 ms CPU / 秒、50 ms ≈ 1.0 ms CPU / 秒(約 0.1 % 單核),停止輪詢時 0;工作集約 80 MB。
 */
export const POLL_MS = 50
/** 等 `ready` 的上限(PowerShell 啟動 + Add-Type 編譯) */
export const START_TIMEOUT_MS = 15_000
/** 不需要輪詢持續多久就關掉行程(釋放記憶體;下次需要再啟動) */
export const IDLE_EXIT_MS = 10 * 60_000
/** 啟動失敗 / 崩潰幾次後放棄(本次執行改為 unavailable) */
export const MAX_FAILURES = 3

/** C# 輪詢器(`Add-Type` 編譯;只用 user32 GetAsyncKeyState,不裝任何掛鉤、不送輸入) */
export const CTRL_WATCH_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'using System.Threading;',
  'public static class PpzCtrlWatch {',
  '  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);',
  '  static volatile bool on = false;',
  '  static volatile bool quit = false;',
  '  static readonly AutoResetEvent wake = new AutoResetEvent(false);',
  '  public static void Run(int ms) {',
  '    var reader = new Thread(() => {',
  '      string l;',
  '      while ((l = Console.In.ReadLine()) != null) { l = l.Trim(); if (l == "1") on = true; else if (l == "0") on = false; wake.Set(); }',
  '      quit = true; wake.Set();',
  '    });',
  '    reader.IsBackground = true; reader.Start();',
  '    Console.Out.WriteLine("ready"); Console.Out.Flush();',
  '    int last = -1;',
  '    while (!quit) {',
  '      if (!on) { last = -1; wake.WaitOne(); continue; }',
  '      int down = (GetAsyncKeyState(0x11) & 0x8000) != 0 ? 1 : 0;',
  '      if (down != last) { last = down; Console.Out.WriteLine(down == 1 ? "c1" : "c0"); Console.Out.Flush(); }',
  '      wake.WaitOne(ms);',
  '    }',
  '  }',
  '}',
  "'@",
  `[PpzCtrlWatch]::Run(${POLL_MS})`
].join('\n')

/** stdout 一行 → 事件(其他內容忽略) */
export function parseCtrlLine (line: string): 'ready' | 'down' | 'up' | null {
  const s = line.trim()
  if (s === 'ready') return 'ready'
  if (s === 'c1') return 'down'
  if (s === 'c0') return 'up'
  return null
}

/** 對外狀態:`up` 也包含「還在啟動 / 沒在輪詢」;`unavailable` = 本次執行用不了(呼叫端退回舊行為) */
export type CtrlState = 'down' | 'up' | 'unavailable'

export interface CtrlProc {
  write: (line: string) => void
  kill: () => void
  /** stdout 逐行 */
  onLine: (fn: (line: string) => void) => void
  /** 行程結束(含啟動失敗) */
  onExit: (fn: (reason: string) => void) => void
}

export interface CtrlWatcherDeps {
  spawn?: () => CtrlProc
  platform?: NodeJS.Platform
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
  log?: (msg: string) => void
}

/** 實際的 PowerShell 行程(`-EncodedCommand`,stdin 留給控制指令) */
export function spawnCtrlProc (): CtrlProc {
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(CTRL_WATCH_SCRIPT, 'utf16le').toString('base64')], { windowsHide: true })
  let buf = ''
  const lineFns: Array<(l: string) => void> = []
  const exitFns: Array<(r: string) => void> = []
  let exited = false
  let err = ''
  const exit = (r: string) => { if (exited) return; exited = true; for (const f of exitFns) f(r) }
  proc.stdout.setEncoding('ascii')
  proc.stdout.on('data', (d: string) => {
    buf += d
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      for (const f of lineFns) f(line)
    }
  })
  proc.stderr.on('data', (d: Buffer) => { if (err.length < 400) err += d.toString() })
  proc.stdin.on('error', () => {})
  proc.on('error', (e) => { exit(`spawn: ${e.message}`) })
  proc.on('close', (code) => { exit(`exit ${String(code)}${err ? `: ${err.trim().slice(0, 200)}` : ''}`) })
  return {
    write: (line) => { try { proc.stdin.write(line + '\n') } catch {} },
    kill: () => { try { proc.stdin.end() } catch {}; try { proc.kill() } catch {} },
    onLine: (fn) => { lineFns.push(fn) },
    onExit: (fn) => { exitFns.push(fn) }
  }
}

/**
 * Ctrl 狀態來源。`setWanted(true)` = 現在需要知道(遊戲前景 + 功能開著):沒有行程就啟動、送 `1`;
 * `setWanted(false)` → 送 `0`、狀態回 `up`、`IDLE_EXIT_MS` 後關行程。
 */
export class CtrlWatcher {
  private proc: CtrlProc | null = null
  private ready = false
  private wanted = false
  private failures = 0
  private _state: CtrlState = 'up'
  private startTimer: unknown = null
  private idleTimer: unknown = null
  private readonly listeners: Array<(s: CtrlState) => void> = []
  private readonly spawnFn: () => CtrlProc
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (t: unknown) => void
  private readonly log: (msg: string) => void

  constructor (deps: CtrlWatcherDeps = {}) {
    this.spawnFn = deps.spawn ?? spawnCtrlProc
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((t) => { clearTimeout(t as ReturnType<typeof setTimeout>) })
    this.log = deps.log ?? ((m) => { console.log(m) })
    if ((deps.platform ?? process.platform) !== 'win32') this.fail('不是 Windows')
  }

  get state (): CtrlState { return this._state }
  get running (): boolean { return this.proc != null }

  onState (fn: (s: CtrlState) => void): void { this.listeners.push(fn) }

  setWanted (on: boolean): void {
    if (this._state === 'unavailable') return
    if (this.wanted === on) return
    this.wanted = on
    if (on) {
      this.cancel('idle')
      if (!this.proc) this.start()
      else if (this.ready) this.proc.write('1')
    } else {
      this.setState('up')
      if (this.proc && this.ready) this.proc.write('0')
      this.cancel('idle')
      this.idleTimer = this.setTimer(() => { this.idleTimer = null; this.stop('閒置') }, IDLE_EXIT_MS)
    }
  }

  dispose (): void {
    this.wanted = false
    this.cancel('idle')
    this.stop('dispose')
  }

  private start (): void {
    let p: CtrlProc
    try {
      p = this.spawnFn()
    } catch (e) {
      this.onProcFailed(`spawn: ${(e as Error).message}`)
      return
    }
    this.proc = p
    this.ready = false
    p.onLine((line) => {
      if (this.proc !== p) return
      const ev = parseCtrlLine(line)
      if (ev === 'ready') {
        this.ready = true
        this.cancel('start')
        this.failures = 0
        this.log('[ctrl-watch] 輪詢器就緒')
        if (this.wanted) p.write('1')
      } else if (ev === 'down' || ev === 'up') {
        // 不需要時(送 0 之前已在路上的行)不回報
        if (this.wanted) this.setState(ev)
      }
    })
    p.onExit((reason) => {
      if (this.proc !== p) return
      this.proc = null
      this.ready = false
      this.cancel('start')
      this.onProcFailed(reason)
    })
    this.startTimer = this.setTimer(() => {
      this.startTimer = null
      if (this.proc !== p || this.ready) return
      this.proc = null
      p.kill()
      this.onProcFailed(`啟動逾時 ${START_TIMEOUT_MS} ms`)
    }, START_TIMEOUT_MS)
  }

  private onProcFailed (reason: string): void {
    this.failures++
    this.setState('up')
    if (this.failures >= MAX_FAILURES) { this.fail(reason); return }
    this.log(`[ctrl-watch] 輪詢器結束(${reason}),第 ${this.failures} 次`)
    if (this.wanted) this.start()
  }

  private fail (reason: string): void {
    this.log(`[ctrl-watch] 無法偵測 Ctrl(${reason}),倉庫頁籤捲動改為遊戲前景期間一直持有掛鉤(改版前行為)`)
    this.cancel('start'); this.cancel('idle')
    if (this.proc) { const p = this.proc; this.proc = null; p.kill() }
    this.setState('unavailable')
  }

  private stop (reason: string): void {
    this.cancel('start')
    if (!this.proc) return
    const p = this.proc
    this.proc = null
    this.ready = false
    p.kill()
    this.log(`[ctrl-watch] 關閉輪詢器(${reason})`)
  }

  private cancel (which: 'start' | 'idle'): void {
    const t = which === 'start' ? this.startTimer : this.idleTimer
    if (t == null) return
    this.clearTimer(t)
    if (which === 'start') this.startTimer = null
    else this.idleTimer = null
  }

  private setState (s: CtrlState): void {
    if (this._state === s) return
    this._state = s
    for (const f of this.listeners) f(s)
  }
}
