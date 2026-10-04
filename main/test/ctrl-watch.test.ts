// 第五輪 30.1:Ctrl 偵測(ctrl-watch.ts)—— 假行程 + 假時鐘,不跑真的 PowerShell、不送任何輸入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CTRL_WATCH_SCRIPT, CtrlWatcher, IDLE_EXIT_MS, MAX_FAILURES, POLL_MS, START_TIMEOUT_MS, parseCtrlLine, type CtrlProc, type CtrlState } from '../src/ctrl-watch'

class FakeProc implements CtrlProc {
  written: string[] = []
  killed = false
  private lines: Array<(l: string) => void> = []
  private exits: Array<(r: string) => void> = []
  write (l: string) { this.written.push(l) }
  kill () { this.killed = true }
  onLine (fn: (l: string) => void) { this.lines.push(fn) }
  onExit (fn: (r: string) => void) { this.exits.push(fn) }
  emit (l: string) { for (const f of this.lines) f(l) }
  exit (r = 'exit 1') { for (const f of this.exits) f(r) }
}

function setup (opts: { platform?: NodeJS.Platform, spawnThrows?: boolean } = {}) {
  const procs: FakeProc[] = []
  const states: CtrlState[] = []
  const w = new CtrlWatcher({
    platform: opts.platform ?? 'win32',
    spawn: () => { if (opts.spawnThrows) throw new Error('ENOENT'); const p = new FakeProc(); procs.push(p); return p },
    log: () => {}
  })
  w.onState(s => { states.push(s) })
  return { w, procs, states, last: () => procs[procs.length - 1] }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('腳本與解析', () => {
  it('parseCtrlLine', () => {
    expect(parseCtrlLine('ready\r')).toBe('ready')
    expect(parseCtrlLine('c1')).toBe('down')
    expect(parseCtrlLine(' c0 ')).toBe('up')
    expect(parseCtrlLine('#< CLIXML')).toBeNull()
  })
  it('腳本只讀按鍵狀態:GetAsyncKeyState(VK_CONTROL),不裝掛鉤、不送輸入;輪詢間隔 ≤ 50 ms(+ 計時器刻度仍 < 100 ms)', () => {
    expect(CTRL_WATCH_SCRIPT).toContain('GetAsyncKeyState(0x11)')
    expect(CTRL_WATCH_SCRIPT).toContain(`[PpzCtrlWatch]::Run(${POLL_MS})`)
    expect(POLL_MS).toBeLessThanOrEqual(50)
    for (const bad of ['SetWindowsHookEx', 'SendInput', 'keybd_event', 'mouse_event', 'SendKeys']) expect(CTRL_WATCH_SCRIPT).not.toContain(bad)
    // stdin 關閉 = 結束(main 結束時不留孤兒行程)
    expect(CTRL_WATCH_SCRIPT).toContain('quit = true')
  })
})

describe('CtrlWatcher', () => {
  it('不需要時不啟動行程;需要時啟動,ready 後送 1,c1 / c0 → down / up', () => {
    const s = setup()
    expect(s.procs.length).toBe(0)
    s.w.setWanted(true)
    expect(s.procs.length).toBe(1)
    expect(s.last().written).toEqual([])
    s.last().emit('ready')
    expect(s.last().written).toEqual(['1'])
    s.last().emit('c0')
    expect(s.w.state).toBe('up')
    s.last().emit('c1')
    expect(s.w.state).toBe('down')
    s.last().emit('c0')
    expect(s.states).toEqual(['down', 'up'])
  })

  it('setWanted(false):狀態立刻回 up、送 0;之後在路上的 c1 不回報;再需要時沿用行程送 1', () => {
    const s = setup()
    s.w.setWanted(true); s.last().emit('ready'); s.last().emit('c1')
    s.w.setWanted(false)
    expect(s.w.state).toBe('up')
    expect(s.last().written).toEqual(['1', '0'])
    s.last().emit('c1')
    expect(s.w.state).toBe('up')
    s.w.setWanted(true)
    expect(s.procs.length).toBe(1)
    expect(s.last().written).toEqual(['1', '0', '1'])
  })

  it('不需要持續 10 分鐘 → 關行程;期間又需要 → 取消關閉', () => {
    const s = setup()
    s.w.setWanted(true); s.last().emit('ready')
    s.w.setWanted(false)
    vi.advanceTimersByTime(IDLE_EXIT_MS - 1)
    s.w.setWanted(true)
    vi.advanceTimersByTime(IDLE_EXIT_MS * 2)
    expect(s.last().killed).toBe(false)
    s.w.setWanted(false)
    vi.advanceTimersByTime(IDLE_EXIT_MS)
    expect(s.last().killed).toBe(true)
    expect(s.w.running).toBe(false)
    // 再需要 → 重新啟動
    s.w.setWanted(true)
    expect(s.procs.length).toBe(2)
  })

  it('行程崩潰 → 需要時重啟;連續 3 次失敗 → unavailable(不再啟動)', () => {
    const s = setup()
    s.w.setWanted(true)
    for (let i = 0; i < MAX_FAILURES - 1; i++) s.last().exit()
    expect(s.procs.length).toBe(MAX_FAILURES)
    expect(s.w.state).toBe('up')
    s.last().exit()
    expect(s.w.state).toBe('unavailable')
    s.w.setWanted(false); s.w.setWanted(true)
    expect(s.procs.length).toBe(MAX_FAILURES)
  })

  it('ready 後成功過 → 失敗次數歸零(偶發崩潰不會累積到放棄)', () => {
    const s = setup()
    s.w.setWanted(true)
    for (let i = 0; i < 10; i++) { s.last().emit('ready'); s.last().exit() }
    expect(s.w.state).toBe('up')
    expect(s.w.running).toBe(true)
  })

  it('啟動逾時(沒有 ready)→ 殺掉並算一次失敗', () => {
    const s = setup()
    s.w.setWanted(true)
    vi.advanceTimersByTime(START_TIMEOUT_MS)
    expect(s.procs[0].killed).toBe(true)
    expect(s.procs.length).toBe(2)
  })

  it('spawn 丟例外(沒有 powershell.exe)→ 3 次後 unavailable;非 Windows 一開始就 unavailable', () => {
    const a = setup({ spawnThrows: true })
    a.w.setWanted(true)
    expect(a.w.state).toBe('unavailable')
    const b = setup({ platform: 'linux' })
    expect(b.w.state).toBe('unavailable')
    b.w.setWanted(true)
    expect(b.procs.length).toBe(0)
  })

  it('dispose:關行程、清計時器', () => {
    const s = setup()
    s.w.setWanted(true); s.last().emit('ready')
    s.w.setWanted(false)
    s.w.dispose()
    expect(s.last().killed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('main.ts 接線', () => {
  it('只在 overlay 建立、交給 StashScroll、結束時 dispose', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
    expect(main).toContain("const ctrlWatch = windowMode === 'overlay' && poeWindow ? new CtrlWatcher() : undefined")
    expect(main).toContain("app.on('will-quit', () => { ctrlWatch?.dispose() })")
    expect(main).toMatch(/new StashScroll\(\{\s*ctrl: ctrlWatch,/)
  })
})
