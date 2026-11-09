// poedb 熱鍵與計時器熱鍵的註冊條件(`src/shortcut-actions.ts`)與 main 接線守門。不啟動 Electron、不送任何按鍵。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildShortcutActions } from '../src/shortcut-actions'

const base = {
  hotkey: 'D',
  hotkeyHold: 'Ctrl',
  hotkeyLocked: 'Ctrl + Alt + D',
  overlayKey: 'Shift + Space',
  game: 'poe2' as const
}
const find = (a: ReturnType<typeof buildShortcutActions>, type: string) => a.find(x => x.action.type === type)
const hasTimer = (a: ReturnType<typeof buildShortcutActions>) => a.some(x => x.action.type === 'timer-toggle' || x.action.type === 'timer-reset')

describe('poedb 熱鍵', () => {
  it('T5 兩種模式都註冊成帶 target 的複製動作(不聚焦 overlay、不保留修飾鍵)', () => {
    for (const mode of ['overlay', 'window'] as const) {
      const a = buildShortcutActions({ ...base, hotkeyPoedb: 'ctrl+shift+q' } as any, mode)
      const hit = a.find(x => x.shortcut === 'Ctrl + Shift + Q')
      expect(hit, mode).toEqual({ shortcut: 'Ctrl + Shift + Q', keepModKeys: false, action: { type: 'copy-item', focusOverlay: false, target: 'poedb' } })
    }
  })

  it('T5 PoE1 也註冊(poedb 不限遊戲)', () => {
    const a = buildShortcutActions({ ...base, game: 'poe1', hotkeyPoedb: 'Ctrl + Shift + Q' } as any, 'overlay')
    expect((a.find(x => x.shortcut === 'Ctrl + Shift + Q')?.action as any)?.target).toBe('poedb')
  })

  it('T5 空字串或省略 → 不註冊', () => {
    for (const cfg of [{ ...base, hotkeyPoedb: '' }, base]) {
      for (const mode of ['overlay', 'window'] as const) {
        const a = buildShortcutActions(cfg as any, mode)
        expect(a.some(x => (x.action as any).target === 'poedb')).toBe(false)
      }
    }
  })

  it('T5 一般查價熱鍵不帶 target(否則每次查價都被改道去 poedb)', () => {
    const a = buildShortcutActions({ ...base, hotkeyPoedb: 'Ctrl + Shift + Q' } as any, 'overlay')
    const normal = a.filter(y => y.action.type === 'copy-item' && y.shortcut !== 'Ctrl + Shift + Q')
    expect(normal.length).toBeGreaterThan(0)
    for (const x of normal) expect((x.action as any).target).toBeUndefined()
  })
})

describe('計時器熱鍵', () => {
  const cfg = { ...base, hotkeyTimerToggle: 'ctrl+shift+t', hotkeyTimerReset: 'ctrl+shift+y' }

  it('T6 overlay 且顯示不是 off → 註冊開始暫停與歸零(省略 timerDisplay 視為 active)', () => {
    for (const timerDisplay of [undefined, 'active', 'always'] as const) {
      const a = buildShortcutActions({ ...cfg, timerDisplay } as any, 'overlay')
      expect(find(a, 'timer-toggle'), String(timerDisplay)).toMatchObject({ shortcut: 'Ctrl + Shift + T', keepModKeys: false, action: { type: 'timer-toggle' } })
      expect(find(a, 'timer-reset'), String(timerDisplay)).toMatchObject({ shortcut: 'Ctrl + Shift + Y', keepModKeys: false, action: { type: 'timer-reset' } })
    }
  })

  it('T6 window 模式 → 都不註冊', () => {
    expect(hasTimer(buildShortcutActions(cfg as any, 'window'))).toBe(false)
  })

  it('T6 timerDisplay = off → 都不註冊', () => {
    expect(hasTimer(buildShortcutActions({ ...cfg, timerDisplay: 'off' } as any, 'overlay'))).toBe(false)
  })

  it('T6 熱鍵空字串或省略 → 該動作不註冊,另一個不受影響', () => {
    const onlyToggle = buildShortcutActions({ ...cfg, hotkeyTimerReset: '' } as any, 'overlay')
    expect(find(onlyToggle, 'timer-toggle')).toBeDefined()
    expect(find(onlyToggle, 'timer-reset')).toBeUndefined()
    const onlyReset = buildShortcutActions({ ...base, hotkeyTimerReset: 'ctrl+shift+y' } as any, 'overlay')
    expect(find(onlyReset, 'timer-toggle')).toBeUndefined()
    expect(find(onlyReset, 'timer-reset')).toBeDefined()
  })

  it('T6 PoE1 與 PoE2 都註冊(計時器不限遊戲)', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      expect(find(buildShortcutActions({ ...cfg, game } as any, 'overlay'), 'timer-toggle'), game).toBeDefined()
    }
  })
})

describe('main.ts 接線守門', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/main.ts'), 'utf8')

  it('T7 onItem:帶 target 的事件不呼叫 showNear(poedb 物品不開查價面板)', () => {
    const start = src.indexOf('onItem: (e: ItemTextEvent) => {')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, src.indexOf('\n    },', start))
    expect(block).toContain("send('item-text', e)")
    const t = block.search(/\btarget\b/)
    const s = block.indexOf('showNear')
    expect(t, 'onItem 要判斷 target').toBeGreaterThan(-1)
    expect(s).toBeGreaterThan(-1)
    expect(t).toBeLessThan(s)
  })
})
