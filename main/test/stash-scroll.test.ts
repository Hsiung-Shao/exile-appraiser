// 第 15 步:倉庫頁籤捲動(stash-scroll.ts)—— 純函式判斷 + uiohook gate 計數。
// 全部用假的 game / gate hook / tap,不裝真的掛鉤、不送任何輸入。
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isStashArea, stashScrollKey, stashScrollShouldHold, stashSidebarWidth, StashScroll, type StashBounds, type StashCtrlSource, type WheelLike } from '../src/stash-scroll'
import type { CtrlState } from '../src/ctrl-watch'
import { DEFAULT_STOP_DELAY_MS, UiohookGate } from '../src/uiohook-gate'

const B1080: StashBounds = { x: 0, y: 0, width: 1920, height: 1080 }
// 第二螢幕、21:9、client 原點不在 0
const BWIDE: StashBounds = { x: 2560, y: 100, width: 3440, height: 1440 }
const wheel = (x: number, y: number, rotation: number, ctrlKey = true): WheelLike => ({ x, y, rotation, ctrlKey })
const on = { enabled: true, gameActive: true, bounds: B1080 }

describe('isStashArea(APT 比例)', () => {
  it('側欄寬 = 高度 × 370/600', () => {
    expect(stashSidebarWidth(600)).toBe(370)
    expect(stashSidebarWidth(1080)).toBe(666)
    expect(stashSidebarWidth(1440)).toBe(888)
  })
  it('1080p:x ≤ 666 且 154/1600 < y/h < 1192/1600 才算倉庫格子區', () => {
    expect(isStashArea({ x: 300, y: 400 }, B1080)).toBe(true)
    expect(isStashArea({ x: 666, y: 400 }, B1080)).toBe(true) // 邊界含
    expect(isStashArea({ x: 667, y: 400 }, B1080)).toBe(false)
    expect(isStashArea({ x: 300, y: 103 }, B1080)).toBe(false) // 頁籤列(1080 × 154/1600 ≈ 103.95)
    expect(isStashArea({ x: 300, y: 104 }, B1080)).toBe(true)
    expect(isStashArea({ x: 300, y: 804 }, B1080)).toBe(true) // 1080 × 1192/1600 = 804.6
    expect(isStashArea({ x: 300, y: 805 }, B1080)).toBe(false)
  })
  it('client 原點偏移(多螢幕)', () => {
    expect(isStashArea({ x: 2560 + 800, y: 100 + 500 }, BWIDE)).toBe(true)
    expect(isStashArea({ x: 2560 + 889, y: 100 + 500 }, BWIDE)).toBe(false)
    expect(isStashArea({ x: 2560 + 800, y: 100 + 100 }, BWIDE)).toBe(false)
    // 遊戲左邊的螢幕(x 小於 client)照 APT 也算「側欄內」;y 範圍仍要符合
    expect(isStashArea({ x: 100, y: 600 }, BWIDE)).toBe(true)
  })
  it('沒有 bounds / 大小為 0 → false(照 APT 會送鍵,但此時遊戲不在前景)', () => {
    expect(isStashArea({ x: 1, y: 1 }, null)).toBe(false)
    expect(isStashArea({ x: 1, y: 1 }, undefined)).toBe(false)
    expect(isStashArea({ x: 0, y: 0 }, { x: 0, y: 0, width: 0, height: 0 })).toBe(false)
  })
})

describe('stashScrollKey', () => {
  it('倉庫格子區外:往下 → ArrowRight、往上 → ArrowLeft、0 → null', () => {
    expect(stashScrollKey(wheel(1200, 500, 1), on)).toBe('ArrowRight')
    expect(stashScrollKey(wheel(1200, 500, 3), on)).toBe('ArrowRight')
    expect(stashScrollKey(wheel(1200, 500, -1), on)).toBe('ArrowLeft')
    expect(stashScrollKey(wheel(1200, 500, 0), on)).toBeNull()
    // 倉庫頁籤列(側欄內但 y 在格子區上方)也送
    expect(stashScrollKey(wheel(300, 50, -1), on)).toBe('ArrowLeft')
  })
  it('倉庫格子區內 → null(交給遊戲)', () => {
    expect(stashScrollKey(wheel(300, 400, 1), on)).toBeNull()
    expect(stashScrollKey(wheel(300, 400, -1), on)).toBeNull()
  })
  it('沒按 Ctrl / 遊戲不在前景 / 功能關閉 → null', () => {
    expect(stashScrollKey(wheel(1200, 500, 1, false), on)).toBeNull()
    expect(stashScrollKey(wheel(1200, 500, 1), { ...on, gameActive: false })).toBeNull()
    expect(stashScrollKey(wheel(1200, 500, 1), { ...on, enabled: false })).toBeNull()
  })
  it('PoE1 / PoE2 用同一組比例(EE2 上游與 APT 相同),結果與遊戲無關', () => {
    // PoE2 常見 1440p:側欄 888
    const s = { ...on, bounds: { x: 0, y: 0, width: 2560, height: 1440 } }
    expect(stashScrollKey(wheel(800, 700, 1), s)).toBeNull()
    expect(stashScrollKey(wheel(900, 700, 1), s)).toBe('ArrowRight')
  })
})

class FakeGame extends EventEmitter {
  private _active = false
  bounds: StashBounds | undefined = B1080
  get isActive () { return this._active }
  set isActive (v: boolean) { if (v !== this._active) { this._active = v; this.emit('active-change', v) } }
}

describe('StashScroll × UiohookGate', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const setup = (opts: { active?: boolean } = {}) => {
    const hook = { start: vi.fn(), stop: vi.fn() }
    const gate = new UiohookGate(hook, { log: () => {} })
    const game = new FakeGame()
    if (opts.active) game.isActive = true
    const wheelFns: Array<(e: WheelLike) => void> = []
    const attachFns: Array<() => void> = []
    const detachFns: Array<() => void> = []
    const tap = vi.fn()
    const ss = new StashScroll({
      game,
      gate,
      onWheel: (fn) => { wheelFns.push(fn) },
      onAttach: (fn) => { attachFns.push(fn) },
      onDetach: (fn) => { detachFns.push(fn) },
      tap,
      log: () => {}
    })
    const emitWheel = (e: WheelLike) => { for (const fn of wheelFns) fn(e) }
    return { hook, gate, game, ss, tap, emitWheel, attach: () => attachFns.forEach(f => f()), detach: () => detachFns.forEach(f => f()) }
  }

  it('建構時不持有(開關在第一次 host-config 才設);只註冊一次 wheel 監聽', () => {
    const { gate, hook, ss } = setup({ active: true })
    expect(ss.holding).toBe(false)
    expect(gate.holders).toBe(0)
    expect(hook.start).not.toHaveBeenCalled()
  })

  it('啟動時遊戲已在前景:host-config 開 → 立刻 acquire / start', () => {
    const { gate, hook, ss } = setup({ active: true })
    ss.setEnabled(true)
    expect(gate.holders).toBe(1)
    expect(hook.start).toHaveBeenCalledTimes(1)
    ss.setEnabled(true) // 重複設定不重複 acquire
    expect(gate.holders).toBe(1)
  })

  it('功能開著:前景期間持有、失焦 release;前景抖動在 5 秒內不 stop / 不重 start', () => {
    const { gate, hook, game, ss } = setup()
    ss.setEnabled(true)
    expect(gate.holders).toBe(0)
    game.isActive = true
    expect(gate.holders).toBe(1)
    expect(hook.start).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 5; i++) {
      game.isActive = false
      expect(gate.holders).toBe(0)
      vi.advanceTimersByTime(1000)
      game.isActive = true
      expect(gate.holders).toBe(1)
    }
    expect(hook.start).toHaveBeenCalledTimes(1)
    expect(hook.stop).not.toHaveBeenCalled()
    game.isActive = false
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS)
    expect(hook.stop).toHaveBeenCalledTimes(1)
    expect(gate.isRunning).toBe(false)
  })

  it('功能關閉:完全維持第 5 步行為(前景切換不 acquire,只有面板追蹤才開)', () => {
    const { gate, hook, game, ss } = setup()
    ss.setEnabled(false)
    game.isActive = true
    game.isActive = false
    game.isActive = true
    expect(gate.holders).toBe(0)
    expect(hook.start).not.toHaveBeenCalled()
    // 查價面板追蹤(WidgetAreaTracker 的 acquire / release)
    gate.acquire()
    expect(hook.start).toHaveBeenCalledTimes(1)
    gate.release()
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS)
    expect(hook.stop).toHaveBeenCalledTimes(1)
  })

  it('開關 × 前景 × 面板追蹤交錯:計數不洩漏、不為負', () => {
    const { gate, hook, game, ss } = setup()
    ss.setEnabled(true)
    game.isActive = true // 倉庫捲動持有
    gate.acquire() // 面板開(快速查價,遊戲仍在前景)
    expect(gate.holders).toBe(2)
    game.isActive = false // 鎖定查價:overlay 取得焦點 → 遊戲失焦
    expect(gate.holders).toBe(1)
    ss.setEnabled(false) // 關閉時本來就沒持有 → 不動
    expect(gate.holders).toBe(1)
    game.isActive = true
    expect(gate.holders).toBe(1)
    ss.setEnabled(true)
    expect(gate.holders).toBe(2)
    ss.setEnabled(false) // 前景中關閉 → release
    expect(gate.holders).toBe(1)
    gate.release() // 面板關
    expect(gate.holders).toBe(0)
    ss.setEnabled(false); game.isActive = false; gate.release() // 多餘的 release 不會變負
    expect(gate.holders).toBe(0)
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS)
    expect(hook.start).toHaveBeenCalledTimes(1)
    expect(hook.stop).toHaveBeenCalledTimes(1)
    expect(gate.isRunning).toBe(false)
  })

  it('遊戲視窗 detach(沒有 blur)→ release;再 attach 且仍前景 → 重新持有', () => {
    const { gate, game, ss, attach, detach } = setup()
    ss.setEnabled(true)
    game.isActive = true
    expect(gate.holders).toBe(1)
    detach()
    expect(gate.holders).toBe(0)
    expect(ss.holding).toBe(false)
    game.isActive = false; game.isActive = true // detach 期間前景變化不持有
    expect(gate.holders).toBe(0)
    attach()
    expect(gate.holders).toBe(1)
  })

  it('dispose(結束 / 重新啟動)→ release,之後不再 acquire;gate.shutdown 仍強制停', () => {
    const { gate, hook, game, ss } = setup({ active: true })
    ss.setEnabled(true)
    expect(gate.holders).toBe(1)
    ss.dispose()
    expect(gate.holders).toBe(0)
    game.isActive = false; game.isActive = true; ss.setEnabled(false); ss.setEnabled(true)
    expect(gate.holders).toBe(0)
    gate.shutdown()
    expect(hook.stop).toHaveBeenCalled()
    expect(gate.isRunning).toBe(false)
  })

  it('shutdown 後(重新啟動中)前景切換不會再 start', () => {
    const { gate, hook, game, ss } = setup()
    ss.setEnabled(true)
    gate.shutdown()
    game.isActive = true
    expect(hook.start).not.toHaveBeenCalled()
    game.isActive = false
    expect(gate.holders).toBe(0)
  })

  it('wheel:只在開著、前景、格子區外送鍵;overlay 取得焦點(遊戲非 active)不送', () => {
    const { game, ss, tap, emitWheel, detach } = setup()
    emitWheel(wheel(1200, 500, 1)) // 還沒開
    ss.setEnabled(true)
    emitWheel(wheel(1200, 500, 1)) // 遊戲不在前景(查價面板 / 設定拿走焦點時就是這樣)
    expect(tap).not.toHaveBeenCalled()
    game.isActive = true
    emitWheel(wheel(1200, 500, 1))
    emitWheel(wheel(1200, 500, -2))
    emitWheel(wheel(300, 400, 1)) // 格子區內
    emitWheel(wheel(1200, 500, 1, false)) // 沒按 Ctrl
    expect(tap.mock.calls).toEqual([['ArrowRight'], ['ArrowLeft']])
    ss.setEnabled(false)
    emitWheel(wheel(1200, 500, 1))
    ss.setEnabled(true)
    detach()
    emitWheel(wheel(1200, 500, 1))
    expect(tap).toHaveBeenCalledTimes(2)
  })
})

// ---- 第五輪 30.1:只在「遊戲前景 + 按住 Ctrl」才持有掛鉤 ----
class FakeCtrl implements StashCtrlSource {
  state: CtrlState = 'up'
  wanted = false
  wantedLog: boolean[] = []
  private fns: Array<(s: CtrlState) => void> = []
  setWanted (on: boolean) { if (on !== this.wanted) { this.wanted = on; this.wantedLog.push(on); if (!on) this.set('up') } }
  onState (fn: (s: CtrlState) => void) { this.fns.push(fn) }
  set (s: CtrlState) { if (s === this.state) return; if (this.state === 'unavailable') return; this.state = s; for (const f of this.fns) f(s) }
  press () { if (this.wanted) this.set('down') }
  releaseKey () { if (this.wanted) this.set('up') }
}

describe('stashScrollShouldHold(第五輪 30.1)', () => {
  const base = { disposed: false, enabled: true, detached: false, gameActive: true }
  it('沒有 Ctrl 來源 = 改版前(前景就持有);有來源 → 只有 down 才持有;unavailable → 退回改版前', () => {
    expect(stashScrollShouldHold(base)).toBe(true)
    expect(stashScrollShouldHold({ ...base, ctrl: 'up' })).toBe(false)
    expect(stashScrollShouldHold({ ...base, ctrl: 'down' })).toBe(true)
    expect(stashScrollShouldHold({ ...base, ctrl: 'unavailable' })).toBe(true)
  })
  it('關閉 / 不在前景 / detach / dispose → 不論 Ctrl 都不持有', () => {
    for (const ctrl of [undefined, 'up', 'down', 'unavailable'] as const) {
      expect(stashScrollShouldHold({ ...base, ctrl, enabled: false })).toBe(false)
      expect(stashScrollShouldHold({ ...base, ctrl, gameActive: false })).toBe(false)
      expect(stashScrollShouldHold({ ...base, ctrl, detached: true })).toBe(false)
      expect(stashScrollShouldHold({ ...base, ctrl, disposed: true })).toBe(false)
    }
  })
})

describe('StashScroll × Ctrl 來源 × UiohookGate(第五輪 30.1)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const setup = () => {
    const hook = { start: vi.fn(), stop: vi.fn() }
    const gate = new UiohookGate(hook, { log: () => {} })
    const game = new FakeGame()
    const ctrl = new FakeCtrl()
    const wheelFns: Array<(e: WheelLike) => void> = []
    const detachFns: Array<() => void> = []
    const attachFns: Array<() => void> = []
    const tap = vi.fn()
    const ss = new StashScroll({
      game, gate, ctrl, tap, log: () => {},
      onWheel: (fn) => { wheelFns.push(fn) },
      onAttach: (fn) => { attachFns.push(fn) },
      onDetach: (fn) => { detachFns.push(fn) }
    })
    return {
      hook, gate, game, ctrl, ss, tap,
      emitWheel: (e: WheelLike) => { for (const fn of wheelFns) fn(e) },
      detach: () => detachFns.forEach(f => f()),
      attach: () => attachFns.forEach(f => f())
    }
  }

  it('前景但沒按 Ctrl:不持有掛鉤(只請來源輪詢);按下 → 同步 acquire / start;放開 → release,5 秒後 stop', () => {
    const { gate, hook, game, ctrl, ss } = setup()
    ss.setEnabled(true)
    game.isActive = true
    expect(ctrl.wanted).toBe(true)
    expect(gate.holders).toBe(0)
    expect(hook.start).not.toHaveBeenCalled()
    ctrl.press()
    expect(gate.holders).toBe(1)
    expect(hook.start).toHaveBeenCalledTimes(1)
    ctrl.releaseKey()
    expect(gate.holders).toBe(0)
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS)
    expect(hook.stop).toHaveBeenCalledTimes(1)
  })

  it('連續 Ctrl + 滾輪(5 秒內反覆按放)不反覆 start / stop;計數不洩漏', () => {
    const { gate, hook, game, ctrl, ss } = setup()
    ss.setEnabled(true)
    game.isActive = true
    for (let i = 0; i < 50; i++) { ctrl.press(); vi.advanceTimersByTime(300); ctrl.releaseKey(); vi.advanceTimersByTime(700) }
    expect(hook.start).toHaveBeenCalledTimes(1)
    expect(hook.stop).not.toHaveBeenCalled()
    expect(gate.holders).toBe(0)
    vi.advanceTimersByTime(DEFAULT_STOP_DELAY_MS)
    expect(hook.stop).toHaveBeenCalledTimes(1)
  })

  it('按著 Ctrl 時失焦 / detach / 關閉 / dispose → release 且停止輪詢', () => {
    const { gate, game, ctrl, ss, detach, attach } = setup()
    ss.setEnabled(true)
    game.isActive = true; ctrl.press()
    expect(gate.holders).toBe(1)
    game.isActive = false
    expect(gate.holders).toBe(0)
    expect(ctrl.wanted).toBe(false)
    game.isActive = true; ctrl.press()
    detach()
    expect(gate.holders).toBe(0)
    expect(ctrl.wanted).toBe(false)
    attach(); ctrl.press()
    expect(gate.holders).toBe(1)
    ss.setEnabled(false)
    expect(gate.holders).toBe(0)
    expect(ctrl.wanted).toBe(false)
    ss.setEnabled(true); ctrl.press()
    ss.dispose()
    expect(gate.holders).toBe(0)
    expect(ctrl.wanted).toBe(false)
  })

  it('功能關閉 / 遊戲不在前景:不輪詢 Ctrl(輪詢器停著)', () => {
    const { ctrl, game, ss } = setup()
    ss.setEnabled(false)
    game.isActive = true
    expect(ctrl.wantedLog).toEqual([])
    ss.setEnabled(true)
    game.isActive = false
    expect(ctrl.wantedLog).toEqual([true, false])
  })

  it('Ctrl 來源 unavailable(沒有 PowerShell 等)→ 退回改版前:前景期間一直持有', () => {
    const { gate, game, ctrl, ss } = setup()
    ss.setEnabled(true)
    ctrl.state = 'unavailable'
    ;(ctrl as any).fns.forEach((f: any) => f('unavailable'))
    game.isActive = true
    expect(gate.holders).toBe(1)
    game.isActive = false
    expect(gate.holders).toBe(0)
  })

  it('與查價面板追蹤(WidgetAreaTracker)交錯:計數各自獨立、不為負', () => {
    const { gate, hook, game, ctrl, ss } = setup()
    ss.setEnabled(true)
    game.isActive = true
    gate.acquire() // 快速查價面板追蹤
    ctrl.press()
    expect(gate.holders).toBe(2)
    gate.release()
    expect(gate.holders).toBe(1)
    ctrl.releaseKey()
    expect(gate.holders).toBe(0)
    ctrl.releaseKey(); game.isActive = false; ss.setEnabled(false)
    expect(gate.holders).toBe(0)
    expect(hook.start).toHaveBeenCalledTimes(1)
  })

  it('第 33 步 quietCtrl:自己送 Ctrl 組合鍵期間不因 Ctrl 變化 acquire / release;結束後照實際狀態', () => {
    const { gate, hook, game, ctrl, ss } = setup()
    ss.setEnabled(true)
    game.isActive = true
    ss.quietCtrl(true)
    ctrl.press() // 我們自己送的 Ctrl+F
    expect(gate.holders).toBe(0)
    expect(hook.start).not.toHaveBeenCalled()
    ctrl.releaseKey()
    ss.quietCtrl(false)
    expect(gate.holders).toBe(0)
    expect(hook.start).not.toHaveBeenCalled()
    // 使用者本來就按著 Ctrl(書籤熱鍵含 Ctrl):持有狀態凍結,不因送鍵中間的放開而 release
    ctrl.press()
    expect(gate.holders).toBe(1)
    ss.quietCtrl(true)
    ctrl.releaseKey()
    expect(gate.holders).toBe(1)
    ss.quietCtrl(false)
    expect(gate.holders).toBe(0)
    // quiet 中失焦仍照常 release
    ctrl.press(); ss.quietCtrl(true)
    expect(gate.holders).toBe(1)
    game.isActive = false
    expect(gate.holders).toBe(0)
    ss.quietCtrl(false)
  })

  it('stashScrollShouldHold quiet:沿用 held;沒有 Ctrl 來源 / unavailable 不受影響', () => {
    const b = { disposed: false, enabled: true, detached: false, gameActive: true }
    expect(stashScrollShouldHold({ ...b, ctrl: 'down', quiet: true, held: false })).toBe(false)
    expect(stashScrollShouldHold({ ...b, ctrl: 'up', quiet: true, held: true })).toBe(true)
    expect(stashScrollShouldHold({ ...b, quiet: true, held: false })).toBe(true)
    expect(stashScrollShouldHold({ ...b, ctrl: 'unavailable', quiet: true, held: false })).toBe(true)
    expect(stashScrollShouldHold({ ...b, ctrl: 'down', quiet: true, held: true, gameActive: false })).toBe(false)
  })

  it('wheel:按住 Ctrl 掛鉤開著時照舊送鍵(判斷不變)', () => {
    const { game, ctrl, ss, tap, emitWheel } = setup()
    ss.setEnabled(true)
    game.isActive = true
    ctrl.press()
    emitWheel(wheel(1200, 500, 1))
    emitWheel(wheel(300, 400, 1))
    expect(tap.mock.calls).toEqual([['ArrowRight']])
  })
})
