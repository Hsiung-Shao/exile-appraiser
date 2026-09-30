// exile-appraiser(WP-S2):熱鍵動作表(`src/shortcut-actions.ts`)的註冊條件。不啟動 Electron、不送任何按鍵。
import { describe, expect, it } from 'vitest'
import { GAME_RESERVED_HOTKEYS } from '@ipc/reserved-hotkeys'
import { buildShortcutActions, normalizeHotkey, reservedShortcuts } from '../src/shortcut-actions'

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
  // 2026-10-01(移植 APT):聊天指令 / 倉庫搜尋
  describe('聊天指令與倉庫搜尋', () => {
    const commands = [
      { text: '/hideout', hotkey: 'F5', send: true },
      { text: '/exit', hotkey: 'F9', send: true },
      { text: '@last ty', hotkey: '', send: true },
      { text: '  ', hotkey: 'F6', send: true },
      { text: '/invite @last', hotkey: 'F7', send: false }
    ]
    const stashSearch = [{ text: '"rarity: rare"', hotkey: 'ctrl+shift+1' }, { text: '', hotkey: 'F8' }]
    it('兩個遊戲都註冊(overlay);熱鍵正規化、空熱鍵 / 空白文字不註冊、send 帶過去', () => {
      for (const game of ['poe1', 'poe2'] as const) {
        const a = buildShortcutActions({ ...base, game, commands, stashSearch }, 'overlay')
        expect(a.filter(x => x.action.type === 'paste-in-chat').map(x => `${x.shortcut}=${JSON.stringify(x.action)}`)).toEqual([
          'F5={"type":"paste-in-chat","text":"/hideout","send":true}',
          'F9={"type":"paste-in-chat","text":"/exit","send":true}',
          'F7={"type":"paste-in-chat","text":"/invite @last","send":false}'
        ])
        expect(a.filter(x => x.action.type === 'stash-search').map(x => `${x.shortcut}=${JSON.stringify(x.action)}`)).toEqual([
          'Ctrl + Shift + 1={"type":"stash-search","text":"\\"rarity: rare\\""}'
        ])
        expect(a.filter(x => x.action.type === 'paste-in-chat' || x.action.type === 'stash-search').every(x => !x.keepModKeys)).toBe(true)
      }
    })
    it('window 模式不註冊(熱鍵不限遊戲前景,會打進別的程式)', () => {
      const a = buildShortcutActions({ ...base, commands, stashSearch }, 'window')
      expect(a.some(x => x.action.type === 'paste-in-chat' || x.action.type === 'stash-search')).toBe(false)
    })
    it('遊戲保留鍵(APT 清單 + PoE2 的 Ctrl + Alt + C)不註冊,任何動作都一樣', () => {
      expect(GAME_RESERVED_HOTKEYS).toEqual(expect.arrayContaining(['Ctrl + C', 'Ctrl + V', 'Ctrl + A', 'Ctrl + F', 'Ctrl + Enter', 'Home', 'Delete', 'Enter', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Ctrl + Alt + C']))
      const cmds = GAME_RESERVED_HOTKEYS.map((k, i) => ({ text: `/c${i}`, hotkey: k, send: true }))
      const a = buildShortcutActions({ ...base, commands: cmds, stashSearch: [{ text: 'x', hotkey: 'ctrl + alt + c' }] }, 'overlay')
      expect(a.some(x => GAME_RESERVED_HOTKEYS.includes(x.shortcut))).toBe(false)
      expect(buildShortcutActions({ ...base, hotkeyLocked: 'Ctrl + Alt + C' }, 'overlay').some(x => x.shortcut === 'Ctrl + Alt + C')).toBe(false)
      expect(reservedShortcuts({ ...base, commands: [{ text: '/x', hotkey: 'Home', send: true }], stashSearch: [{ text: 'y', hotkey: 'Ctrl+Alt+C' }] }))
        .toEqual(['Home', 'Ctrl + Alt + C'])
    })
    it('與查價 / OCR 熱鍵重複 → 先到先得,指令不註冊', () => {
      const a = buildShortcutActions({ ...base, commands: [{ text: '/hideout', hotkey: 'Ctrl + D', send: true }, { text: '/exit', hotkey: 'Ctrl + Shift + R', send: true }] }, 'overlay')
      expect(a.filter(x => x.shortcut === 'Ctrl + D').map(x => x.action.type)).toEqual(['copy-item'])
      expect(a.filter(x => x.shortcut === 'Ctrl + Shift + R').map(x => x.action.type)).toEqual(['ocr-reveal'])
    })
    it('最多 50 條(第 51 條以後不註冊)', () => {
      const mods = ['Alt', 'Ctrl + Alt', 'Shift + Alt', 'Ctrl + Shift + Alt']
      const many = Array.from({ length: 80 }, (_, i) => ({ text: `/c${i}`, hotkey: `${mods[Math.floor(i / 26)]} + ${String.fromCharCode(65 + (i % 26))}`, send: true }))
      const texts = buildShortcutActions({ ...base, commands: many }, 'overlay')
        .flatMap(x => x.action.type === 'paste-in-chat' ? [Number(x.action.text.slice(2))] : [])
      expect(texts.length).toBeGreaterThan(40)
      expect(Math.max(...texts)).toBeLessThan(50)
    })
  })
  it('normalizeHotkey', () => {
    expect(normalizeHotkey('ctrl+shift+t')).toBe('Ctrl + Shift + T')
    expect(normalizeHotkey('')).toBe('')
  })
})
