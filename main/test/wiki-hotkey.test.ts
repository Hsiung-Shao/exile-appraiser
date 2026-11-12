// wiki 熱鍵的註冊條件(`src/shortcut-actions.ts`)。不啟動 Electron、不送任何按鍵。
import { describe, expect, it } from 'vitest'
import { buildShortcutActions } from '../src/shortcut-actions'

const base = {
  hotkey: 'D',
  hotkeyHold: 'Ctrl',
  hotkeyLocked: 'Ctrl + Alt + D',
  overlayKey: 'Shift + Space',
  game: 'poe2' as const
}
const targetOf = (x: { action: unknown }) => (x.action as any).target

describe('wiki 熱鍵', () => {
  it('W5 兩種模式、兩代遊戲都註冊成帶 target 的複製動作(不聚焦 overlay、不保留修飾鍵)', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      for (const mode of ['overlay', 'window'] as const) {
        const a = buildShortcutActions({ ...base, game, hotkeyWiki: 'ctrl+shift+w' } as any, mode)
        const hit = a.find(x => x.shortcut === 'Ctrl + Shift + W')
        expect(hit, `${game} ${mode}`).toEqual({ shortcut: 'Ctrl + Shift + W', keepModKeys: false, action: { type: 'copy-item', focusOverlay: false, target: 'wiki' } })
      }
    }
  })

  it('W5 空字串或省略 → 沒有 target 為 wiki 的動作', () => {
    for (const cfg of [{ ...base, hotkeyWiki: '' }, base]) {
      for (const mode of ['overlay', 'window'] as const) {
        const a = buildShortcutActions(cfg as any, mode)
        expect(a.some(x => targetOf(x) === 'wiki')).toBe(false)
      }
    }
  })

  it('W6 poedb 與 wiki 同時設定 → 各自註冊,一般查價熱鍵不帶 target', () => {
    const a = buildShortcutActions({ ...base, hotkeyPoedb: 'Ctrl + Shift + Q', hotkeyWiki: 'Ctrl + Shift + W' } as any, 'overlay')
    const poedb = a.filter(x => targetOf(x) === 'poedb')
    const wiki = a.filter(x => targetOf(x) === 'wiki')
    expect(poedb.map(x => x.shortcut)).toEqual(['Ctrl + Shift + Q'])
    expect(wiki.map(x => x.shortcut)).toEqual(['Ctrl + Shift + W'])
    const normal = a.filter(x => x.action.type === 'copy-item' && targetOf(x) === undefined)
    expect(normal.length).toBeGreaterThan(0)
  })
})
