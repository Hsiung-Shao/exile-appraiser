// 2026-10-01:聊天指令 / 倉庫搜尋的設定欄位(Config.ts)、熱鍵衝突表(settings/hotkey-conflicts.ts)、Poe Regex「加到倉庫搜尋」
import { describe, expect, it } from 'vitest'
import {
  MAX_TEXT_ENTRIES, _roundTripForTest, addStashSearchEntry, defaultCommands, normCommands, normStashSearch
} from '../src/web/Config'
import { hotkeyIssues, hotkeySlots, type HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'

describe('設定欄位', () => {
  it('預設 = APT 的六條:/hideout F5、/exit F9、其餘沒有熱鍵,全部直接送出', () => {
    expect(defaultCommands()).toEqual([
      { text: '/hideout', hotkey: 'F5', send: true },
      { text: '/exit', hotkey: 'F9', send: true },
      { text: '@last ty', hotkey: '', send: true },
      { text: '/invite @last', hotkey: '', send: true },
      { text: '/tradewith @last', hotkey: '', send: true },
      { text: '/hideout @last', hotkey: '', send: true }
    ])
  })
  it('舊設定檔沒有 → 預設指令、倉庫搜尋空;寫入值讀回相同', () => {
    const a = _roundTripForTest(JSON.stringify({ game: 'poe1' }))
    expect(a.config.commands).toEqual(defaultCommands())
    expect(a.config.stashSearch).toEqual([])
    const saved = {
      commands: [{ text: '/kick @last', hotkey: 'Ctrl + Shift + K', send: false }],
      stashSearch: [{ text: '"rarity: rare"', hotkey: 'F10' }]
    }
    expect(JSON.parse(_roundTripForTest(JSON.stringify(saved)).serialized)).toMatchObject(saved)
    // 使用者刪光指令 = 空陣列(不會被還原成預設)
    expect(_roundTripForTest(JSON.stringify({ commands: [] })).config.commands).toEqual([])
  })
  it('正規化:APT 的 hotkey null → \'\'、send 省略 = true、壞項目丟掉、最多 50 條、文字長度上限', () => {
    expect(normCommands([{ text: '/exit', hotkey: null }, null, 'x', { text: 5, hotkey: 3, send: false }])).toEqual([
      { text: '/exit', hotkey: '', send: true },
      { text: '', hotkey: '', send: false }
    ])
    expect(normCommands('bad')).toEqual(defaultCommands())
    expect(normCommands(Array.from({ length: 80 }, () => ({ text: '/x', hotkey: '' })))).toHaveLength(MAX_TEXT_ENTRIES)
    expect(normCommands([{ text: 'a'.repeat(900) }])[0].text).toHaveLength(500)
    expect(normStashSearch([{ text: 'b'.repeat(400), hotkey: 'F1' }])).toEqual([{ text: 'b'.repeat(250), hotkey: 'F1' }])
    expect(normStashSearch({})).toEqual([])
  })
})

describe('熱鍵衝突表(與 main 註冊規則相同)', () => {
  const cfg: HotkeyConfigLike = {
    hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space', game: 'poe2',
    hotkeyOcrReveal: 'Ctrl + Shift + R', hotkeyOcrRegion: '', hotkeyRuneshapeToggle: '', revealAutoEnabled: true, runeshapeEnabled: false,
    commands: defaultCommands(),
    stashSearch: []
  }
  it('預設沒有問題', () => {
    expect([...hotkeyIssues(hotkeySlots(cfg))]).toEqual([])
  })
  it('遊戲保留鍵(含 PoE2 Ctrl + Alt + C)標 reserved;與查價 / 前面的指令重複標 duplicate(先到先得)', () => {
    const c: HotkeyConfigLike = {
      ...cfg,
      commands: [
        { text: '/hideout', hotkey: 'F5', send: true },
        { text: '/exit', hotkey: 'ctrl+d', send: true },
        { text: '/a', hotkey: 'Ctrl + Alt + C', send: true },
        { text: '/b', hotkey: 'F5', send: true },
        { text: '', hotkey: 'Home', send: true }
      ],
      stashSearch: [{ text: 'x', hotkey: 'Enter' }, { text: 'y', hotkey: 'Ctrl + Shift + R' }]
    }
    const m = hotkeyIssues(hotkeySlots(c))
    expect(m.get('cmd:1')).toEqual({ kind: 'duplicate', key: 'Ctrl + D', with: 'quick' })
    expect(m.get('cmd:2')).toEqual({ kind: 'reserved', key: 'Ctrl + Alt + C' })
    expect(m.get('cmd:3')).toEqual({ kind: 'duplicate', key: 'F5', with: 'cmd:0' })
    expect(m.has('cmd:4')).toBe(false) // 文字空白不註冊,不算
    expect(m.get('stash:0')).toEqual({ kind: 'reserved', key: 'Enter' })
    expect(m.get('stash:1')).toEqual({ kind: 'duplicate', key: 'Ctrl + Shift + R', with: 'ocr' })
  })
  it('符文塑形框選熱鍵也在表內(PoE2;不看是否啟用),與其他熱鍵重複標 duplicate', () => {
    const c: HotkeyConfigLike = { ...cfg, hotkeyOcrRegion: 'Ctrl + Shift + T', hotkeyRuneshapeRegion: 'ctrl+shift+t' }
    const slots = hotkeySlots(c).map(s => s.id)
    expect(slots.slice(0, 6)).toEqual(['quick', 'locked', 'overlay', 'ocr', 'region', 'runeRegion'])
    expect(hotkeyIssues(hotkeySlots(c)).get('runeRegion')).toEqual({ kind: 'duplicate', key: 'Ctrl + Shift + T', with: 'region' })
    expect(hotkeySlots({ ...c, game: 'poe1' }).some(s => s.id === 'runeRegion')).toBe(false)
  })
  it('沒註冊的欄位不參與(褻瀆自動辨識關掉 → 暫停鍵不算;PoE1 沒有 OCR 熱鍵)', () => {
    const c = { ...cfg, stashSearch: [{ text: 'y', hotkey: 'Ctrl + Shift + R' }] }
    expect(hotkeyIssues(hotkeySlots({ ...c, revealAutoEnabled: false })).has('stash:0')).toBe(false)
    expect(hotkeyIssues(hotkeySlots({ ...c, game: 'poe1' })).has('stash:0')).toBe(false)
  })
})

describe('Poe Regex「加到倉庫搜尋」', () => {
  it('新字串 → added;同字串 → duplicate;空白 / 超過 250 字 / 清單滿 → invalid', () => {
    expect(addStashSearchEntry([], '"rare"')).toBe('added')
    expect(addStashSearchEntry([{ text: '"rare"', hotkey: '' }], ' "rare" ')).toBe('duplicate')
    expect(addStashSearchEntry([], '  ')).toBe('invalid')
    expect(addStashSearchEntry([], 'x'.repeat(251))).toBe('invalid')
    expect(addStashSearchEntry(Array.from({ length: MAX_TEXT_ENTRIES }, (_, i) => ({ text: `${i}`, hotkey: '' })), 'new')).toBe('invalid')
  })
})
