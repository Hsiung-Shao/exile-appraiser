// 熱鍵衝突訊息「與「X」重複」的 X:每個熱鍵欄位都要有顯示名稱(不能露出內部 id,如 poedb / timerToggle / map-check)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SLOT_LABEL, hotkeySlots, type HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const i18n = (lang: string) => JSON.parse(fs.readFileSync(path.join(root, `renderer/src/i18n/${lang}.json`), 'utf8'))
const keyOf = (j: any, k: string) => k.split('.').reduce((o: any, p) => o?.[p], j)

const full = (game: 'poe1' | 'poe2'): HotkeyConfigLike => ({
  hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space', game,
  hotkeyOcrReveal: 'F1', hotkeyOcrRegion: 'F2', hotkeyRuneshapeToggle: 'F3', hotkeyRuneshapeRegion: 'F4',
  revealAutoEnabled: true, runeshapeEnabled: true, hotkeyStashToggle: 'F5', hotkeyStashRegion: 'F6', stashPricesEnabled: true,
  commands: [{ text: '/hideout', hotkey: 'F7' }], stashSearch: [{ text: 'x', hotkey: 'F8' }], hotkeyRegexQuick: 'F9',
  regexBookmarkHotkeys: [{ index: 0, name: 'b', game, hotkey: 'F10' }],
  hotkeyPoedb: 'F11', hotkeyWiki: 'F12', hotkeyMapCheck: 'Alt + 1', timerDisplay: 'active',
  hotkeyTimerToggle: 'Alt + 2', hotkeyTimerReset: 'Alt + 3', hotkeyTimerPause: 'Alt + 4', hotkeyTimerUndo: 'Alt + 5', hotkeyTimerSkip: 'Alt + 6'
} as HotkeyConfigLike)

describe('熱鍵衝突對象的顯示名稱', () => {
  it('兩代所有固定欄位都有名稱,且兩語字串都存在', () => {
    const ids = new Set([...hotkeySlots(full('poe1')), ...hotkeySlots(full('poe2'))].map(s => s.id).filter(id => !/^(cmd|stash|rxbm):/.test(id)))
    for (const id of ['poedb', 'wiki', 'map-check', 'stashToggle', 'stashRegion', 'timerToggle', 'timerReset', 'timerPause', 'timerUndo', 'timerSkip']) expect(ids.has(id), id).toBe(true)
    const zh = i18n('cmn-Hant')
    const en = i18n('en')
    for (const id of ids) {
      expect(SLOT_LABEL[id], id).toBeTruthy()
      expect(keyOf(zh, SLOT_LABEL[id]), `cmn-Hant ${SLOT_LABEL[id]}`).toBeTruthy()
      expect(keyOf(en, SLOT_LABEL[id]), `en ${SLOT_LABEL[id]}`).toBeTruthy()
    }
  })
})
