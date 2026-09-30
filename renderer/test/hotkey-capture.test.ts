// 熱鍵擷取與「按住 Alt 讓路」的純邏輯(renderer/src/web/settings/hotkey-capture.ts)
import { describe, expect, it } from 'vitest'
import { hideOverlayForAlt, isClearKey, keyEventToHotkey, type AltHideState } from '../src/web/settings/hotkey-capture'

const key = (code: string, mods: { ctrl?: boolean, shift?: boolean, alt?: boolean } = {}, k = '') =>
  ({ code, key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt })

describe('keyEventToHotkey', () => {
  it('含 Alt 的組合', () => {
    expect(keyEventToHotkey(key('KeyD', { ctrl: true, alt: true }))).toBe('Ctrl + Alt + D')
    expect(keyEventToHotkey(key('KeyD', { alt: true }))).toBe('Alt + D')
    expect(keyEventToHotkey(key('KeyX', { shift: true, alt: true }))).toBe('Shift + Alt + X')
    expect(keyEventToHotkey(key('Digit3', { ctrl: true, shift: true, alt: true }))).toBe('Ctrl + Shift + Alt + 3')
  })

  it('修飾鍵本身(單按 Alt / Ctrl / Shift)不當成熱鍵', () => {
    for (const code of ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft']) {
      expect(keyEventToHotkey(key(code, { alt: true, ctrl: true, shift: true }))).toBeNull()
    }
    expect(keyEventToHotkey(key('Alt', { alt: true }))).toBeNull()
  })

  it('F12 保留給開發者工具;noModKeys 只收單鍵', () => {
    expect(keyEventToHotkey(key('F12'))).toBeNull()
    expect(keyEventToHotkey(key('F12', { alt: true }))).toBeNull()
    expect(keyEventToHotkey(key('KeyD'), true)).toBe('D')
    expect(keyEventToHotkey(key('KeyD', { alt: true }), true)).toBeNull()
  })

  it('KeyToCode 沒有的鍵 → null', () => {
    expect(keyEventToHotkey(key('IntlRo', { alt: true }))).toBeNull()
    expect(keyEventToHotkey(key('Pause', { ctrl: true }, 'Cancel'))).toBeNull()
  })

  it('清除鍵', () => {
    expect(['Backspace', 'Delete', 'Escape'].every(isClearKey)).toBe(true)
    expect(isClearKey('KeyD')).toBe(false)
  })
})

describe('hideOverlayForAlt', () => {
  const base: AltHideState = { hideRequested: true, settingsVisible: false, regionPickerOpen: false, hotkeyCapturing: false }

  it('沒有 hide 要求就不隱藏', () => {
    expect(hideOverlayForAlt({ ...base, hideRequested: false })).toBe(false)
  })

  it('查價面板 / 徽章(沒有其他 UI 狀態)照舊隱藏', () => {
    expect(hideOverlayForAlt(base)).toBe(true)
  })

  it('設定開著、擷取熱鍵、框選中都不隱藏', () => {
    expect(hideOverlayForAlt({ ...base, settingsVisible: true })).toBe(false)
    expect(hideOverlayForAlt({ ...base, hotkeyCapturing: true })).toBe(false)
    expect(hideOverlayForAlt({ ...base, regionPickerOpen: true })).toBe(false)
  })
})
