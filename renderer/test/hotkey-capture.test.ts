// 熱鍵擷取的純邏輯(renderer/src/web/settings/hotkey-capture.ts)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as capture from '../src/web/settings/hotkey-capture'
import { isClearKey, keyEventToHotkey } from '../src/web/settings/hotkey-capture'

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

// 2026-10-01 使用者裁定拿掉「按住 Alt 隱藏 overlay」:不留開關,renderer 與 main 都不能再有這條路
describe('按住 Alt 不再隱藏 overlay', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('hotkey-capture 不再匯出 Alt 讓路判斷', () => {
    expect('hideOverlayForAlt' in capture).toBe(false)
    expect('hotkeyCaptureActive' in capture).toBe(false)
  })

  it('App.vue 不訂閱 visibility、根元素不設 visibility: hidden', () => {
    const app = read('../src/web/App.vue')
    expect(app).not.toMatch(/onVisibility|hideUI|visibility:\s*hide/)
  })

  it('main 不再建立 OverlayVisibility、preload / 預覽不再有 visibility 事件', () => {
    expect(read('../../main/src/main.ts')).not.toMatch(/new OverlayVisibility|from '\.\/windowing\/OverlayVisibility'/)
    expect(read('../../main/src/preload.ts')).not.toMatch(/'visibility'/)
    expect(read('../../main/src/preview-server.ts')).not.toMatch(/onVisibility/)
  })
})
