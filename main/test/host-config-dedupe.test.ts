// host-config 去重:Shortcuts.updateActions 動作清單沒變就不重註冊;掃描排程欄位沒變就不 poke。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const reg = vi.hoisted(() => ({ register: vi.fn(() => true), unregisterAll: vi.fn() }))
vi.mock('electron', () => ({
  globalShortcut: reg,
  screen: {},
  clipboard: {},
  app: {}
}))
vi.mock('uiohook-napi', () => ({ uIOhook: {}, UiohookKey: {} }))

import { Shortcuts } from '../src/Shortcuts'
import { scanConfigKey } from '../src/scan-config'
import { buildShortcutActions, sameShortcutActions } from '../src/shortcut-actions'

const cfg: any = {
  hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space', game: 'poe1',
  hotkeyOcrReveal: 'Ctrl + Shift + R', hotkeyOcrRegion: '', restoreClipboard: true,
  commands: [{ hotkey: 'F5', text: '/hideout', send: true }], stashSearch: []
}

describe('Shortcuts.updateActions 去重', () => {
  beforeEach(() => { reg.register.mockClear(); reg.unregisterAll.mockClear() })
  const make = () => new Shortcuts({ mode: 'window', onItem: () => {} })

  it('相同設定第二次不重註冊', () => {
    const s = make()
    expect(s.updateActions(cfg)).toEqual({ ok: true })
    const n = reg.register.mock.calls.length
    expect(n).toBeGreaterThan(0)
    expect(s.updateActions({ ...cfg })).toEqual({ ok: true })
    expect(reg.register.mock.calls.length).toBe(n)
    expect(reg.unregisterAll).not.toHaveBeenCalled()
  })
  it('與熱鍵無關的欄位(restoreClipboard)改了也不重註冊', () => {
    const s = make()
    s.updateActions(cfg)
    const n = reg.register.mock.calls.length
    s.updateActions({ ...cfg, restoreClipboard: false })
    expect(reg.register.mock.calls.length).toBe(n)
  })
  it('熱鍵 / 聊天指令內容變更 → 立即重註冊', () => {
    const s = make()
    s.updateActions(cfg)
    const n = reg.register.mock.calls.length
    s.updateActions({ ...cfg, hotkey: 'E' })
    expect(reg.unregisterAll).toHaveBeenCalledTimes(1)
    expect(reg.register.mock.calls.length).toBe(n + n)
  })
  it('overlay:聊天指令內容變更 → 重註冊;遊戲不在前景不註冊(去重不改變此邏輯)', () => {
    const handlers: Array<(a: boolean) => void> = []
    const poeWindow: any = { isActive: false, on: (_e: string, h: (a: boolean) => void) => { handlers.push(h) } }
    const s = new Shortcuts({ mode: 'overlay', poeWindow, onItem: () => {} })
    expect(s.updateActions(cfg)).toEqual({ ok: true })
    s.updateActions({ ...cfg, hotkey: 'E' })
    expect(reg.register).not.toHaveBeenCalled() // 不在前景 → 一律不註冊
    poeWindow.isActive = true
    s.updateActions(cfg) // 前景(狀態與「該註冊」不一致)→ 註冊
    const n = reg.register.mock.calls.length
    expect(n).toBeGreaterThan(0)
    s.updateActions({ ...cfg })
    expect(reg.register.mock.calls.length).toBe(n)
    s.updateActions({ ...cfg, commands: [{ hotkey: 'F5', text: '/hideout 2', send: true }] })
    expect(reg.unregisterAll).toHaveBeenCalledTimes(1)
    expect(reg.register.mock.calls.length).toBeGreaterThan(n)
  })
  it('註冊失敗不去重:動作清單沒變也照常 unregister → register 重試;重試成功後恢復去重', () => {
    reg.register.mockReturnValueOnce(false)
    const s = make()
    const r1 = s.updateActions(cfg)
    expect(r1.ok).toBe(false)
    const n = reg.register.mock.calls.length
    const unreg = reg.unregisterAll.mock.calls.length
    // 對方已放開熱鍵 → 這次全部成功
    const r2 = s.updateActions({ ...cfg })
    expect(r2).toEqual({ ok: true })
    expect(reg.unregisterAll.mock.calls.length).toBe(unreg + 1)
    expect(reg.register.mock.calls.length).toBe(n + n)
    // 成功之後相同清單 → 去重(不再註冊)
    s.updateActions({ ...cfg })
    expect(reg.register.mock.calls.length).toBe(n + n)
  })
  it('註冊持續失敗 → 每次都重試並回傳失敗結果', () => {
    reg.register.mockReturnValue(false)
    try {
      const s = make()
      expect(s.updateActions(cfg).ok).toBe(false)
      const n = reg.register.mock.calls.length
      expect(s.updateActions({ ...cfg }).ok).toBe(false)
      expect(reg.register.mock.calls.length).toBe(n + n)
    } finally {
      reg.register.mockReturnValue(true)
    }
  })
})

describe('sameShortcutActions / scanConfigKey', () => {
  it('動作清單比較', () => {
    const a = buildShortcutActions(cfg, 'window')
    expect(sameShortcutActions(a, buildShortcutActions({ ...cfg }, 'window'))).toBe(true)
    expect(sameShortcutActions(a, buildShortcutActions({ ...cfg, hotkey: 'E' }, 'window'))).toBe(false)
  })
  const scan: any = { game: 'poe2', revealAutoEnabled: true, revealIntervalMs: 500, ocrRegion: { x: 1, y: 2, w: 3, h: 4 }, runeshapeEnabled: false, runeshapeRegion: null, runeshapeIntervalMs: 500 }
  it('掃描欄位沒變 → 同 key;其他欄位不影響', () => {
    expect(scanConfigKey({ ...scan, hotkey: 'Z', commands: [] })).toBe(scanConfigKey(scan))
    expect(scanConfigKey({ ...scan, ocrRegion: { ...scan.ocrRegion } })).toBe(scanConfigKey(scan))
  })
  it('開關 / 間隔 / 區域 / 遊戲變更 → key 不同', () => {
    for (const patch of [
      { revealAutoEnabled: false }, { revealIntervalMs: 800 }, { ocrRegion: null }, { ocrRegion: { x: 9, y: 2, w: 3, h: 4 } },
      { runeshapeEnabled: true }, { runeshapeRegion: { x: 1, y: 1, w: 1, h: 1 } }, { runeshapeIntervalMs: 900 }, { game: 'poe1' }
    ]) expect(scanConfigKey({ ...scan, ...patch })).not.toBe(scanConfigKey(scan))
  })
})
