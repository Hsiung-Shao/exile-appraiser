// 地圖詞綴檢查熱鍵的註冊條件(`src/shortcut-actions.ts`)。不啟動 Electron、不送任何按鍵。
import { describe, expect, it } from 'vitest'
import { buildShortcutActions } from '../src/shortcut-actions'

const base = { hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space' }
const mapCheck = (a: ReturnType<typeof buildShortcutActions>) => a.filter(x => (x.action as any).target === 'map-check')

describe('地圖詞綴檢查熱鍵', () => {
  it('PoE1 + overlay:註冊成聚焦 overlay 的複製動作,target 為 map-check', () => {
    const a = buildShortcutActions({ ...base, game: 'poe1', hotkeyMapCheck: 'alt+d' } as any, 'overlay')
    expect(mapCheck(a)).toEqual([{ shortcut: 'Alt + D', keepModKeys: false, action: { type: 'copy-item', focusOverlay: true, target: 'map-check' } }])
  })

  it('PoE2、window 模式、空字串或省略 → 不註冊', () => {
    expect(mapCheck(buildShortcutActions({ ...base, game: 'poe2', hotkeyMapCheck: 'Alt + D' } as any, 'overlay'))).toEqual([])
    expect(mapCheck(buildShortcutActions({ ...base, game: 'poe1', hotkeyMapCheck: 'Alt + D' } as any, 'window'))).toEqual([])
    expect(mapCheck(buildShortcutActions({ ...base, game: 'poe1', hotkeyMapCheck: '' } as any, 'overlay'))).toEqual([])
    expect(mapCheck(buildShortcutActions({ ...base, game: 'poe1' } as any, 'overlay'))).toEqual([])
  })
})
