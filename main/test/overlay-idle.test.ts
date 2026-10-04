// 第五輪 30.4:overlay 視窗閒置隱藏(windowing/overlay-idle.ts)。假視窗 + 假時鐘,不開 Electron。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverlayContentState } from '@ipc/types'
import {
  OVERLAY_IDLE_HIDE_DELAY_MS, OverlayIdleHider, describeOverlayContent, overlayContentWanted, overlayWanted, sanitizeOverlayContent
} from '../src/windowing/overlay-idle'

const NONE: OverlayContentState = { panel: false, settings: false, picker: false, reveal: false, rune: false }
const withC = (k: keyof OverlayContentState): OverlayContentState => ({ ...NONE, [k]: true })
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** 假的 overlay 視窗 + 模仿 electron-overlay-window:遊戲 focus 時若不可見就 showInactive、blur 時 hide;'show' 事件回呼 hider */
function setup () {
  const ev: string[] = []
  let visible = false
  let gameFocused = false
  // eslint-disable-next-line prefer-const
  let hider: OverlayIdleHider
  const win = {
    isVisible: () => visible,
    hide: () => { if (visible) { visible = false; ev.push('hide') } },
    showInactive: () => { if (!visible) { visible = true; ev.push('show'); hider.onWindowShown() } }
  }
  hider = new OverlayIdleHider({ win, gameFocused: () => gameFocused })
  const lib = {
    /** 遊戲取得前景(套件先 showInactive,再交給我們) */
    focus () { gameFocused = true; if (!visible) win.showInactive(); hider.onGameFocus() },
    /** 遊戲失焦(套件 hide;overlay 取得焦點時不藏) */
    blur (overlayFocused = false) { gameFocused = false; if (!overlayFocused) win.hide(); hider.onGameBlur() }
  }
  return { hider, lib, ev, get visible () { return visible } }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('純函式', () => {
  it('overlayContentWanted:還沒回報 = 要顯示;任一來源 = 要顯示;全部 false = 不要', () => {
    expect(overlayContentWanted(null)).toBe(true)
    expect(overlayContentWanted(NONE)).toBe(false)
    for (const k of ['panel', 'settings', 'picker', 'reveal', 'rune'] as const) expect(overlayContentWanted(withC(k))).toBe(true)
  })
  it('overlayWanted:overlay 有焦點一律要顯示', () => {
    expect(overlayWanted(NONE, true)).toBe(true)
    expect(overlayWanted(NONE, false)).toBe(false)
    expect(overlayWanted(withC('reveal'), false)).toBe(true)
  })
  it('sanitize / describe', () => {
    expect(sanitizeOverlayContent(null)).toBeNull()
    expect(sanitizeOverlayContent('x')).toBeNull()
    expect(sanitizeOverlayContent({ panel: 1, rune: true, extra: true })).toEqual({ ...NONE, rune: true })
    expect(describeOverlayContent(null)).toBe('unknown')
    expect(describeOverlayContent(NONE)).toBe('none')
    expect(describeOverlayContent({ ...NONE, panel: true, reveal: true })).toBe('panel+reveal')
  })
})

describe('OverlayIdleHider', () => {
  it('遊戲前景、沒有東西要畫 → 500 ms 後 hide;之前不藏', () => {
    const s = setup()
    s.hider.setContent(NONE)
    s.lib.focus()
    expect(s.visible).toBe(true)
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS - 1)
    expect(s.visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(s.visible).toBe(false)
    expect(s.hider.hiddenByIdle).toBe(true)
    expect(s.ev).toEqual(['show', 'hide'])
  })

  it('renderer 還沒回報(啟動 / 重新載入)= 不藏', () => {
    const s = setup()
    s.lib.focus()
    vi.advanceTimersByTime(10_000)
    expect(s.visible).toBe(true)
    s.hider.setContent(NONE)
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.visible).toBe(false)
    // 重新載入:回報作廢 → 立刻顯示
    s.hider.setContent(null)
    expect(s.visible).toBe(true)
  })

  it.each(['panel', 'settings', 'picker', 'reveal', 'rune'] as const)('藏著時 %s 出現 → 立刻 showInactive;消失 → 500 ms 後再藏', (k) => {
    const s = setup()
    s.hider.setContent(NONE)
    s.lib.focus()
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.visible).toBe(false)
    s.hider.setContent(withC(k))
    expect(s.visible).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(s.visible).toBe(true)
    s.hider.setContent(NONE)
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.visible).toBe(false)
    expect(s.ev).toEqual(['show', 'hide', 'show', 'hide'])
  })

  it('快速切換不閃爍:消失後 500 ms 內又出現 → 不 hide / show', () => {
    const s = setup()
    s.hider.setContent(withC('panel'))
    s.lib.focus()
    const base = s.ev.length
    for (let i = 0; i < 20; i++) {
      s.hider.setContent(NONE)
      vi.advanceTimersByTime(200)
      s.hider.setContent(i % 2 ? withC('reveal') : withC('panel'))
      vi.advanceTimersByTime(200)
    }
    expect(s.ev.length).toBe(base)
    expect(s.visible).toBe(true)
    expect(s.hider.hidePending).toBe(false)
  })

  it('來源交接(面板關、徽章同時出現)不藏', () => {
    const s = setup()
    s.hider.setContent(withC('panel'))
    s.lib.focus()
    s.hider.setContent({ ...NONE, reveal: true })
    vi.advanceTimersByTime(10_000)
    expect(s.visible).toBe(true)
    expect(s.hider.counts.hides).toBe(0)
  })

  it('overlay 取得焦點(overlayKey / 鎖定查價 / 托盤設定)→ 在 focus() 之前同步顯示;交還後沒有內容才藏', () => {
    const s = setup()
    s.hider.setContent(NONE)
    s.lib.focus()
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.visible).toBe(false)
    s.hider.setInteractable(true)
    expect(s.visible).toBe(true) // 同步
    s.lib.blur(true) // activateOverlay → 遊戲失焦,套件不藏(焦點在 overlay)
    vi.advanceTimersByTime(60_000)
    expect(s.visible).toBe(true)
    // 交還焦點:assertGameActive 先清旗標,遊戲 focus 事件晚一點到(視窗本來就顯示著 → 套件不 show)
    s.hider.setInteractable(false)
    vi.advanceTimersByTime(60_000)
    expect(s.visible).toBe(true) // 遊戲還沒回前景:不藏
    s.lib.focus()
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.visible).toBe(false)
  })

  it('遊戲失焦 / detach → 交還給套件:取消計時器、之後內容出現也不由我們顯示', () => {
    const s = setup()
    s.hider.setContent(NONE)
    s.lib.focus()
    vi.advanceTimersByTime(200)
    s.lib.blur()
    expect(s.hider.hidePending).toBe(false)
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.hider.counts.hides).toBe(0)
    // 藏著(套件藏的)時內容出現 → 不越權顯示
    s.hider.setContent(withC('reveal'))
    expect(s.visible).toBe(false)
    // 遊戲回前景 → 套件顯示,有內容 → 保持
    s.lib.focus()
    vi.advanceTimersByTime(10_000)
    expect(s.visible).toBe(true)
  })

  it('我們藏著時遊戲失焦再回來:套件 focus 顯示 → 沒內容 → 500 ms 後再藏', () => {
    const s = setup()
    s.hider.setContent(NONE)
    s.lib.focus()
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.hider.hiddenByIdle).toBe(true)
    s.lib.blur()
    expect(s.hider.hiddenByIdle).toBe(false)
    s.lib.focus()
    expect(s.visible).toBe(true)
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.visible).toBe(false)
  })

  it('wake(熱鍵查價):藏著才顯示;讀不到物品(沒有回報)→ 500 ms 後再藏;讀到 → 面板回報後保持', () => {
    const s = setup()
    s.hider.setContent(NONE)
    s.lib.focus()
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    s.hider.wake('熱鍵查價')
    expect(s.visible).toBe(true)
    vi.advanceTimersByTime(OVERLAY_IDLE_HIDE_DELAY_MS)
    expect(s.visible).toBe(false)
    s.hider.wake('熱鍵查價')
    vi.advanceTimersByTime(150)
    s.hider.setContent(withC('panel'))
    vi.advanceTimersByTime(60_000)
    expect(s.visible).toBe(true)
    // 已顯示時 wake 不做事
    const n = s.ev.length
    s.hider.wake('熱鍵查價')
    expect(s.ev.length).toBe(n)
  })

  it('任何時候最多一個計時器;dispose 後不再藏', () => {
    const s = setup()
    s.hider.setContent(NONE)
    s.lib.focus()
    s.hider.setContent(NONE)
    s.hider.setContent(NONE)
    expect(vi.getTimerCount()).toBe(1)
    s.hider.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(s.visible).toBe(true)
  })
})

describe('接線守門', () => {
  it('main.ts:IPC overlay-content 不開放預覽、OverlayWindow 可互動變化同步通知、熱鍵查價前 wake、視窗 show 事件', () => {
    const main = read('../src/main.ts')
    expect(main).toMatch(/'overlay-content': \{\s*kind: 'send',\s*preview: false/)
    expect(main).toContain('overlay.onInteractableChange = (v) => { idle.setInteractable(v) }')
    expect(main).toContain("w.on('show', () => { idle.onWindowShown() })")
    expect(main).toContain("beforeItemCopy: () => { overlayIdle?.wake('熱鍵查價') }")
    // 重新顯示照 electron-overlay-window 的做法(不搶焦點 + screen-saver 層級)
    expect(main).toMatch(/w\.showInactive\(\); w\.setAlwaysOnTop\(true, 'screen-saver'\)/)
    const shortcuts = read('../src/Shortcuts.ts')
    expect(shortcuts.indexOf('this.opts.beforeItemCopy?.()')).toBeGreaterThan(-1)
    expect(shortcuts.indexOf('this.opts.beforeItemCopy?.()')).toBeLessThan(shortcuts.indexOf('this.clipboard.readItemText()'))
  })

  it('OverlayWindow:assertOverlayActive 先設可互動(→ 顯示)再 activateOverlay', () => {
    const src = read('../src/windowing/OverlayWindow.ts')
    const fn = src.slice(src.indexOf('assertOverlayActive = () =>'), src.indexOf('assertGameActive = () =>'))
    expect(fn.indexOf('this.isInteractable = true')).toBeGreaterThan(-1)
    expect(fn.indexOf('this.isInteractable = true')).toBeLessThan(fn.indexOf('OverlayController.activateOverlay()'))
    expect(src).toContain('this.onInteractableChange?.(v)')
  })

  it('preload / 預覽 no-op', () => {
    expect(read('../src/preload.ts')).toContain("overlayContent: (s: OverlayContentState) => { ipcRenderer.send('overlay-content', s) }")
    expect(read('../src/preview-server.ts')).toMatch(/PREVIEW_NOOP_SYNC = \[[^\]]*'overlayContent'/)
  })
})
