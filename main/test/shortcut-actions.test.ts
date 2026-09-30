// exile-appraiser(WP-S2):熱鍵動作表(`src/shortcut-actions.ts`)的註冊條件。不啟動 Electron、不送任何按鍵。
import { describe, expect, it } from 'vitest'
import { buildShortcutActions, normalizeHotkey } from '../src/shortcut-actions'

const base = {
  hotkey: 'D',
  hotkeyHold: 'Ctrl',
  hotkeyLocked: 'Ctrl + Alt + D',
  overlayKey: 'Shift + Space',
  game: 'poe2' as const,
  hotkeyOcrReveal: 'Ctrl + Shift + R',
  hotkeyOcrRegion: ''
}
const types = (a: ReturnType<typeof buildShortcutActions>) => a.map(x => `${x.shortcut}=${x.action.type}`)

describe('buildShortcutActions', () => {
  it('預設(框選熱鍵空字串)→ 不註冊 ocr-region', () => {
    expect(types(buildShortcutActions(base, 'overlay'))).toEqual([
      'Ctrl + D=copy-item', 'Ctrl + Alt + D=copy-item', 'Shift + Space=toggle-overlay', 'Ctrl + Shift + R=ocr-reveal'
    ])
  })
  it('設了框選熱鍵 + PoE2 + overlay → 註冊(設定檔寫法正規化)', () => {
    const a = buildShortcutActions({ ...base, hotkeyOcrRegion: 'ctrl+shift+t' }, 'overlay')
    expect(types(a)).toContain('Ctrl + Shift + T=ocr-region')
    expect(a.find(x => x.action.type === 'ocr-region')?.keepModKeys).toBe(false)
  })
  it('PoE1 / window 模式 → 兩個 OCR 熱鍵都不註冊', () => {
    for (const a of [
      buildShortcutActions({ ...base, game: 'poe1', hotkeyOcrRegion: 'Ctrl + Shift + T' }, 'overlay'),
      buildShortcutActions({ ...base, hotkeyOcrRegion: 'Ctrl + Shift + T' }, 'window')
    ]) {
      expect(a.some(x => x.action.type === 'ocr-region' || x.action.type === 'ocr-reveal')).toBe(false)
    }
  })
  it('與其他熱鍵重複 → 先到先得,框選不註冊', () => {
    const a = buildShortcutActions({ ...base, hotkeyOcrRegion: 'Ctrl + Shift + R' }, 'overlay')
    expect(a.filter(x => x.shortcut === 'Ctrl + Shift + R').map(x => x.action.type)).toEqual(['ocr-reveal'])
  })
  // WP-R2:符文塑形自動查價「暫停 / 繼續」
  it('暫停熱鍵:預設空 → 不註冊;要 PoE2 + overlay + runeshapeEnabled 才註冊', () => {
    expect(buildShortcutActions({ ...base, runeshapeEnabled: true, hotkeyRuneshapeToggle: '' }, 'overlay').some(x => x.action.type === 'runeshape-toggle')).toBe(false)
    const on = buildShortcutActions({ ...base, runeshapeEnabled: true, hotkeyRuneshapeToggle: 'ctrl+shift+p' }, 'overlay')
    expect(types(on)).toContain('Ctrl + Shift + P=runeshape-toggle')
    expect(on.find(x => x.action.type === 'runeshape-toggle')?.keepModKeys).toBe(false)
    for (const a of [
      buildShortcutActions({ ...base, runeshapeEnabled: false, hotkeyRuneshapeToggle: 'Ctrl + Shift + P' }, 'overlay'),
      buildShortcutActions({ ...base, game: 'poe1', runeshapeEnabled: true, hotkeyRuneshapeToggle: 'Ctrl + Shift + P' }, 'overlay'),
      buildShortcutActions({ ...base, runeshapeEnabled: true, hotkeyRuneshapeToggle: 'Ctrl + Shift + P' }, 'window')
    ]) {
      expect(a.some(x => x.action.type === 'runeshape-toggle')).toBe(false)
    }
  })
  it('暫停熱鍵與 OCR 熱鍵重複 → 先到先得', () => {
    const a = buildShortcutActions({ ...base, runeshapeEnabled: true, hotkeyRuneshapeToggle: 'Ctrl + Shift + R' }, 'overlay')
    expect(a.filter(x => x.shortcut === 'Ctrl + Shift + R').map(x => x.action.type)).toEqual(['ocr-reveal'])
  })
  // 2026-10-01:ocr-reveal = 暫停 / 繼續褻瀆自動辨識;自動辨識關掉就不註冊(省略 = 開,舊設定檔照舊註冊)
  it('褻瀆自動辨識關閉 → 不註冊 ocr-reveal;省略 / 開 → 註冊', () => {
    expect(buildShortcutActions({ ...base, revealAutoEnabled: false }, 'overlay').some(x => x.action.type === 'ocr-reveal')).toBe(false)
    expect(buildShortcutActions({ ...base, revealAutoEnabled: true }, 'overlay').some(x => x.action.type === 'ocr-reveal')).toBe(true)
    expect(buildShortcutActions(base, 'overlay').some(x => x.action.type === 'ocr-reveal')).toBe(true)
  })
  it('normalizeHotkey', () => {
    expect(normalizeHotkey('ctrl+shift+t')).toBe('Ctrl + Shift + T')
    expect(normalizeHotkey('')).toBe('')
  })
})
