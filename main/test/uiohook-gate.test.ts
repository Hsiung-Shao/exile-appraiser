// 效能修正第 5 步:uiohook 掛鉤引用計數(uiohook-gate.ts)與 WidgetAreaTracker 的 acquire / release。
// 全部用假的 uiohook-napi / electron,不裝真的掛鉤、不送任何輸入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hook = vi.hoisted(() => {
  const listeners = new Map<string, Set<(e: any) => void>>()
  return {
    listeners,
    start: vi.fn(),
    stop: vi.fn(),
    addListener: vi.fn((ev: string, fn: (e: any) => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set())
      listeners.get(ev)!.add(fn)
    }),
    removeListener: vi.fn((ev: string, fn: (e: any) => void) => { listeners.get(ev)?.delete(fn) }),
    emit (ev: string, e: any) { for (const fn of [...(listeners.get(ev) ?? [])]) fn(e) },
    count (ev: string) { return listeners.get(ev)?.size ?? 0 }
  }
})
vi.mock('uiohook-napi', () => ({ uIOhook: hook, UiohookKey: {} }))
vi.mock('electron', () => ({
  screen: {
    dipToScreenPoint: (p: any) => p,
    dipToScreenRect: (_w: any, r: any) => r
  }
}))

import { DEFAULT_MAX_START_FAILURES, DEFAULT_STOP_DELAY_MS, UiohookGate, describeStartError } from '../src/uiohook-gate'
import { WidgetAreaTracker } from '../src/windowing/WidgetAreaTracker'

const quiet = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  hook.start.mockReset(); hook.stop.mockReset()
  hook.listeners.clear()
})
afterEach(() => { vi.useRealTimers() })

describe('UiohookGate', () => {
  it('建立後不 start(window 模式沒有任何 acquire → 掛鉤從不開)', () => {
    const g = new UiohookGate(hook, { log: quiet })
    vi.advanceTimersByTime(60_000)
    expect(hook.start).not.toHaveBeenCalled()
    expect(g.isRunning).toBe(false)
  })

  it('0 → 1 start 一次,多個持有者不重複 start;歸零後延遲才 stop', () => {
    const g = new UiohookGate(hook, { log: quiet })
    g.acquire(); g.acquire()
    expect(hook.start).toHaveBeenCalledTimes(1)
    expect(g.holders).toBe(2)
    g.release()
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS * 2)
    expect(hook.stop).not.toHaveBeenCalled()
    g.release()
    expect(g.holders).toBe(0)
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS - 1)
    expect(hook.stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hook.stop).toHaveBeenCalledTimes(1)
    expect(g.isRunning).toBe(false)
  })

  it('延遲期間再 acquire:取消 stop、不重新 start(面板開關抖動)', () => {
    const g = new UiohookGate(hook, { log: quiet })
    for (let i = 0; i < 20; i++) {
      g.acquire()
      g.release()
      vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS / 2)
    }
    expect(hook.start).toHaveBeenCalledTimes(1)
    expect(hook.stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS)
    expect(hook.stop).toHaveBeenCalledTimes(1)
    g.acquire()
    expect(hook.start).toHaveBeenCalledTimes(2)
  })

  it('多餘的 release 不會讓計數變負', () => {
    const g = new UiohookGate(hook, { log: quiet })
    g.release(); g.release()
    expect(g.holders).toBe(0)
    g.acquire()
    expect(g.holders).toBe(1)
    expect(hook.start).toHaveBeenCalledTimes(1)
  })

  it('stopDelayMs 0 = 立即 stop', () => {
    const g = new UiohookGate(hook, { stopDelayMs: 0, log: quiet })
    g.acquire(); g.release()
    expect(hook.stop).toHaveBeenCalledTimes(1)
  })

  it('start 失敗:記錄錯誤、不算在跑,下次 acquire 再試', () => {
    const log = vi.fn()
    const g = new UiohookGate(hook, { log })
    hook.start.mockImplementationOnce(() => { throw new Error('UIOHOOK_FAILURE') })
    g.acquire()
    expect(g.isRunning).toBe(false)
    expect(log).toHaveBeenCalledWith(`[uiohook] start 失敗(第 1/${DEFAULT_MAX_START_FAILURES} 次):UIOHOOK_FAILURE`)
    g.release(); vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS)
    expect(hook.stop).not.toHaveBeenCalled()
    g.acquire()
    expect(g.isRunning).toBe(true)
  })

  it('2026-10-03 實機回歸:連續失敗達上限後不再 start、每次失敗只記一行(不帶 stack 物件);成功一次歸零', () => {
    const log = vi.fn()
    const err = Object.assign(new Error('Failed to register low level windows hook.'), { code: 'UIOHOOK_ERROR_SET_WINDOWS_HOOK_EX' })
    hook.start.mockImplementation(() => { throw err })
    const g = new UiohookGate(hook, { log, stopDelayMs: 0 })
    for (let i = 0; i < 10; i++) { g.acquire(); g.release() }
    expect(hook.start).toHaveBeenCalledTimes(DEFAULT_MAX_START_FAILURES)
    expect(g.gaveUp).toBe(true)
    expect(g.isRunning).toBe(false)
    expect(hook.stop).not.toHaveBeenCalled()
    // 每次呼叫 log 都只有一個字串參數;失敗行含錯誤碼與已知原因;放棄只記一次
    for (const call of log.mock.calls) expect(call).toHaveLength(1)
    const lines = log.mock.calls.map(c => c[0] as string)
    expect(lines.filter(l => l.startsWith('[uiohook] start 失敗'))).toHaveLength(DEFAULT_MAX_START_FAILURES)
    expect(lines[0]).toContain('UIOHOOK_ERROR_SET_WINDOWS_HOOK_EX: Failed to register low level windows hook.')
    expect(lines[0]).toContain('路徑過長')
    expect(lines.filter(l => l.includes('停止重試'))).toHaveLength(1)
    // 計數照常(release 不會變負、持有者正確)
    g.acquire()
    expect(g.holders).toBe(1)

    // 失敗後成功一次 → 計數歸零,之後再失敗又有完整的重試額度
    hook.start.mockReset()
    const g2 = new UiohookGate(hook, { log: quiet, stopDelayMs: 0, maxStartFailures: 2 })
    hook.start.mockImplementationOnce(() => { throw err })
    g2.acquire(); g2.release()
    g2.acquire()
    expect(g2.isRunning).toBe(true)
    g2.release()
    hook.start.mockImplementationOnce(() => { throw err })
    g2.acquire(); g2.release()
    expect(g2.gaveUp).toBe(false)
    g2.acquire()
    expect(hook.start).toHaveBeenCalledTimes(4)
    expect(g2.isRunning).toBe(true)
  })

  it('describeStartError:沒有 code / 非 Error 也能轉成一行', () => {
    expect(describeStartError(new Error('x'))).toBe('x')
    expect(describeStartError('boom')).toBe('boom')
    expect(describeStartError(Object.assign(new Error('m'), { code: 'UIOHOOK_FAILURE' }))).toBe('UIOHOOK_FAILURE: m')
  })

  it('shutdown:計數非 0 也強制 stop、之後 acquire 不再 start', () => {
    const g = new UiohookGate(hook, { log: quiet })
    g.acquire(); g.acquire()
    g.shutdown()
    expect(hook.stop).toHaveBeenCalledTimes(1)
    expect(g.holders).toBe(0)
    expect(g.isRunning).toBe(false)
    g.acquire()
    g.release(); g.release()
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS * 2)
    expect(hook.start).toHaveBeenCalledTimes(1)
    expect(hook.stop).toHaveBeenCalledTimes(1)
  })

  it('shutdown 沒 start 過也照樣呼叫 stop(同原本 will-quit 無條件 stop),stop 丟例外不外洩', () => {
    const g = new UiohookGate(hook, { log: quiet })
    hook.stop.mockImplementationOnce(() => { throw new Error('x') })
    expect(() => { g.shutdown() }).not.toThrow()
    expect(hook.stop).toHaveBeenCalledTimes(1)
  })

  it('延遲 stop 排定後 shutdown:計時器取消,不會再 stop 第二次', () => {
    const g = new UiohookGate(hook, { log: quiet })
    g.acquire(); g.release()
    g.shutdown()
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS * 2)
    expect(hook.stop).toHaveBeenCalledTimes(1)
  })
})

describe('WidgetAreaTracker × UiohookGate', () => {
  const opts = (holdKey = 'Ctrl'): any => ({
    holdKey,
    closeThreshold: 10,
    dpr: 1,
    from: { x: 100, y: 100 },
    area: { x: 0, y: 0, width: 50, height: 50 }
  })
  const make = () => {
    const send = vi.fn()
    const overlay = { isInteractable: false, assertOverlayActive: vi.fn(), assertGameActive: vi.fn() }
    const gate = new UiohookGate(hook, { log: quiet })
    const tracker = new WidgetAreaTracker(send as any, overlay as any, gate)
    return { send, overlay, gate, tracker }
  }

  it('track 開掛鉤並加監聽;重複 track 不洩漏(持有者恆為 1、監聽各 1)', () => {
    const { gate, tracker } = make()
    tracker.track(opts())
    expect(hook.start).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 5; i++) tracker.track(opts())
    expect(gate.holders).toBe(1)
    expect(hook.count('mousemove')).toBe(1)
    expect(hook.count('mousedown')).toBe(1)
    expect(hook.start).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS * 2)
    expect(hook.stop).not.toHaveBeenCalled()
  })

  it('removeListeners 多次只 release 一次;歸零延遲後 stop', () => {
    const { gate, tracker } = make()
    tracker.track(opts())
    tracker.removeListeners(); tracker.removeListeners(); tracker.removeListeners()
    expect(gate.holders).toBe(0)
    expect(hook.count('mousemove')).toBe(0)
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS)
    expect(hook.stop).toHaveBeenCalledTimes(1)
  })

  it('沒 track 過就 removeListeners(熱鍵路徑)不影響計數、不 start', () => {
    const { gate, tracker } = make()
    tracker.removeListeners()
    expect(gate.holders).toBe(0)
    expect(hook.start).not.toHaveBeenCalled()
  })

  it('游標離開超過門檻 → hide-exclusive-widget 並釋放掛鉤(行為同原本)', () => {
    const { send, gate, tracker } = make()
    tracker.track(opts())
    hook.emit('mousemove', { x: 105, y: 100, ctrlKey: false, altKey: false })
    expect(send).not.toHaveBeenCalled()
    hook.emit('mousemove', { x: 200, y: 100, ctrlKey: false, altKey: false })
    expect(send).toHaveBeenCalledWith('hide-exclusive-widget')
    expect(gate.holders).toBe(0)
    expect(hook.count('mousemove')).toBe(0)
  })

  it('按住 holdKey(Ctrl)移出門檻不關閉、掛鉤繼續持有', () => {
    const { send, gate, tracker } = make()
    tracker.track(opts('Ctrl'))
    hook.emit('mousemove', { x: 300, y: 300, ctrlKey: true, altKey: false })
    expect(send).not.toHaveBeenCalled()
    expect(gate.holders).toBe(1)
  })

  it('在面板內按下滑鼠 → 取得焦點並釋放掛鉤', () => {
    const { overlay, gate, tracker } = make()
    tracker.track(opts())
    hook.emit('mousedown', { x: 10, y: 10 })
    expect(overlay.assertOverlayActive).toHaveBeenCalled()
    expect(gate.holders).toBe(0)
  })

  it('可互動時移出面板 → 還焦點給遊戲並釋放掛鉤', () => {
    const { overlay, gate, tracker } = make()
    overlay.isInteractable = true
    tracker.track(opts())
    hook.emit('mousemove', { x: 10, y: 10, ctrlKey: false, altKey: false })
    expect(overlay.assertOverlayActive).toHaveBeenCalledTimes(1)
    expect(gate.holders).toBe(1)
    hook.emit('mousemove', { x: 300, y: 300, ctrlKey: false, altKey: false })
    expect(overlay.assertGameActive).toHaveBeenCalledTimes(1)
    expect(gate.holders).toBe(0)
  })

  it('離開後在延遲內再 track:沿用同一個掛鉤,不 stop / 不重新 start', () => {
    const { gate, tracker } = make()
    tracker.track(opts())
    tracker.removeListeners()
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS - 100)
    tracker.track(opts())
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS * 2)
    expect(hook.start).toHaveBeenCalledTimes(1)
    expect(hook.stop).not.toHaveBeenCalled()
    expect(gate.holders).toBe(1)
  })
})
