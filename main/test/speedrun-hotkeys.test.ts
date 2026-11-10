// 競速計時新增的三個熱鍵(暫停 / 撤銷 / 跳過)的註冊條件(`src/shortcut-actions.ts`)。不啟動 Electron、不送按鍵。
import { describe, expect, it } from 'vitest'
import { buildShortcutActions } from '../src/shortcut-actions'

const base = {
  hotkey: 'D',
  hotkeyHold: 'Ctrl',
  hotkeyLocked: 'Ctrl + Alt + D',
  overlayKey: 'Shift + Space',
  game: 'poe2' as const
}
const cfg = { ...base, hotkeyTimerPause: 'ctrl+shift+p', hotkeyTimerUndo: 'ctrl+shift+u', hotkeyTimerSkip: 'ctrl+shift+k' }
const TYPES = ['timer-pause', 'timer-undo', 'timer-skip']
type Actions = ReturnType<typeof buildShortcutActions>
const find = (a: Actions, type: string) => a.find(x => x.action.type === type)
const hasAny = (a: Actions) => a.some(x => TYPES.includes(x.action.type))

describe('競速計時熱鍵', () => {
  it('S16 overlay 且顯示不是 off → 三個都註冊(省略 timerDisplay 視為 active)', () => {
    for (const timerDisplay of [undefined, 'active', 'always'] as const) {
      const a = buildShortcutActions({ ...cfg, timerDisplay } as any, 'overlay')
      expect(find(a, 'timer-pause'), String(timerDisplay)).toMatchObject({ shortcut: 'Ctrl + Shift + P', keepModKeys: false, action: { type: 'timer-pause' } })
      expect(find(a, 'timer-undo'), String(timerDisplay)).toMatchObject({ shortcut: 'Ctrl + Shift + U', keepModKeys: false, action: { type: 'timer-undo' } })
      expect(find(a, 'timer-skip'), String(timerDisplay)).toMatchObject({ shortcut: 'Ctrl + Shift + K', keepModKeys: false, action: { type: 'timer-skip' } })
    }
  })

  it('S16 window 模式 → 都不註冊', () => {
    expect(hasAny(buildShortcutActions(cfg as any, 'window'))).toBe(false)
  })

  it('S16 timerDisplay = off → 都不註冊', () => {
    expect(hasAny(buildShortcutActions({ ...cfg, timerDisplay: 'off' } as any, 'overlay'))).toBe(false)
  })

  it('S16 空字串或省略 → 只有該動作不註冊,其他兩個不受影響', () => {
    const noPause = buildShortcutActions({ ...cfg, hotkeyTimerPause: '' } as any, 'overlay')
    expect(find(noPause, 'timer-pause')).toBeUndefined()
    expect(find(noPause, 'timer-undo')).toBeDefined()
    expect(find(noPause, 'timer-skip')).toBeDefined()

    const onlySkip = buildShortcutActions({ ...base, hotkeyTimerSkip: 'ctrl+shift+k' } as any, 'overlay')
    expect(find(onlySkip, 'timer-pause')).toBeUndefined()
    expect(find(onlySkip, 'timer-undo')).toBeUndefined()
    expect(find(onlySkip, 'timer-skip')).toBeDefined()
  })

  it('S16 完全沒設定三個欄位 → 不註冊任何一個', () => {
    expect(hasAny(buildShortcutActions(base as any, 'overlay'))).toBe(false)
  })

  it('S16 PoE1 與 PoE2 都註冊(不限遊戲)', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      const a = buildShortcutActions({ ...cfg, game } as any, 'overlay')
      for (const t of TYPES) expect(find(a, t), `${game} ${t}`).toBeDefined()
    }
  })

  it('S16 新熱鍵不影響既有開始暫停 / 歸零熱鍵的註冊', () => {
    const a = buildShortcutActions({ ...cfg, hotkeyTimerToggle: 'ctrl+shift+t', hotkeyTimerReset: 'ctrl+shift+y' } as any, 'overlay')
    expect(find(a, 'timer-toggle')).toBeDefined()
    expect(find(a, 'timer-reset')).toBeDefined()
    expect(find(a, 'timer-pause')).toBeDefined()
  })
})
