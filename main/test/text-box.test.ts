// exile-appraiser(2026-10-01):聊天指令 / 倉庫搜尋的按鍵序列(main/src/text-box.ts,移植自 APT text-box.ts)。
// 只注入假的 keyTap 與假的剪貼簿:**不送任何真實鍵盤輸入、不碰系統剪貼簿**。
import { describe, expect, it } from 'vitest'
import { chatKeySequence, stashSearch, stashSearchSequence, typeInChat, type TextBoxDeps, type TextBoxKey } from '../src/text-box'

const fmt = (k: { key: TextBoxKey, mods: TextBoxKey[] }) => [...k.mods, k.key].join('+')
const RESTORE_LAST_CHAT = ['Enter', 'Enter', 'ArrowUp', 'ArrowUp', 'Escape']

/** 假 host:記錄 keyTap 與剪貼簿寫入的先後;restoreShortly 照 HostClipboard 的 120 ms 節流(未還原前再呼叫直接略過) */
function fakeDeps (platform = 'win32') {
  const log: string[] = []
  let restored = true
  const release: Array<() => void> = []
  const deps: TextBoxDeps & { assertGameActive: () => void } = {
    platform,
    tap: (key, mods) => { log.push(`tap ${[...mods, key].join('+')}`) },
    clipboard: {
      restoreShortly: (cb) => {
        if (!restored) { log.push('skipped(throttle)'); return }
        restored = false
        cb({ writeText: (t) => { log.push(`clip ${t}`) } })
        release.push(() => { restored = true; log.push('restored') })
      }
    },
    assertGameActive: () => { log.push('assertGameActive') }
  }
  return { deps, log, tick: () => { release.splice(0).forEach(f => f()) } }
}

describe('chatKeySequence(APT typeInChat 逐步驟)', () => {
  it('一般指令(/ 開頭 = 頻道前綴,不必全選)+ 送出 → 還原上一個頻道', () => {
    const s = chatKeySequence('/hideout', true, 'win32')
    expect(s.clipboard).toBe('/hideout')
    expect(s.keys.map(fmt)).toEqual(['Enter', 'Ctrl+V', ...RESTORE_LAST_CHAT])
  })
  it('不是頻道前綴開頭 → Enter 後 Ctrl+A 全選再貼;不送出 → 只貼上', () => {
    const s = chatKeySequence('hello', false, 'win32')
    expect(s.clipboard).toBe('hello')
    expect(s.keys.map(fmt)).toEqual(['Enter', 'Ctrl+A', 'Ctrl+V'])
    for (const p of ['#', '%', '@', '$', '&', '/']) {
      expect(chatKeySequence(`${p}x`, false, 'win32').keys.map(fmt)).toEqual(['Enter', 'Ctrl+V'])
    }
  })
  it('@last 前綴:去掉「@last 」、Ctrl+Enter(回覆最後私訊的人)', () => {
    const s = chatKeySequence('@last ty', true, 'win32')
    expect(s.clipboard).toBe('ty')
    expect(s.keys.map(fmt)).toEqual(['Ctrl+Enter', 'Ctrl+V', ...RESTORE_LAST_CHAT])
  })
  it('@last 後綴:去掉「@last」、Ctrl+Enter → Home ×2 → Delete(名字接在指令後)', () => {
    const s = chatKeySequence('/invite @last', true, 'win32')
    expect(s.clipboard).toBe('/invite ')
    expect(s.keys.map(fmt)).toEqual(['Ctrl+Enter', 'Home', 'Home', 'Delete', 'Ctrl+V', ...RESTORE_LAST_CHAT])
    expect(chatKeySequence('/tradewith @last', false, 'win32').keys.map(fmt)).toEqual(['Ctrl+Enter', 'Home', 'Home', 'Delete', 'Ctrl+V'])
  })
  it('macOS 用 Meta', () => {
    expect(chatKeySequence('hello', false, 'darwin').keys.map(fmt)).toEqual(['Enter', 'Meta+A', 'Meta+V'])
  })
})

describe('stashSearchSequence', () => {
  it('Ctrl+F → Ctrl+V → Enter', () => {
    const s = stashSearchSequence('"rarity: rare"', 'win32')
    expect(s.clipboard).toBe('"rarity: rare"')
    expect(s.keys.map(fmt)).toEqual(['Ctrl+F', 'Ctrl+V', 'Enter'])
    // Ctrl+F 在 macOS 也是 Ctrl(遊戲的搜尋鍵),貼上用 Meta
    expect(stashSearchSequence('x', 'darwin').keys.map(fmt)).toEqual(['Ctrl+F', 'Meta+V', 'Enter'])
  })
})

describe('typeInChat / stashSearch(假 keyTap + 假剪貼簿)', () => {
  it('先寫剪貼簿再送鍵,全部包在 restoreShortly 裡', () => {
    const { deps, log, tick } = fakeDeps()
    typeInChat('/hideout', true, deps)
    expect(log).toEqual(['clip /hideout', 'tap Enter', 'tap Ctrl+V', 'tap Enter', 'tap Enter', 'tap ArrowUp', 'tap ArrowUp', 'tap Escape'])
    tick()
    expect(log[log.length - 1]).toBe('restored')
  })
  it('120 ms 內連按 → 第二次略過(防遊戲 Too many actions)', () => {
    const { deps, log, tick } = fakeDeps()
    typeInChat('/exit', true, deps)
    const n = log.length
    typeInChat('/exit', true, deps)
    expect(log.slice(n)).toEqual(['skipped(throttle)'])
    tick()
    typeInChat('/exit', false, deps)
    expect(log.slice(-3)).toEqual(['clip /exit', 'tap Enter', 'tap Ctrl+V'])
  })
  it('倉庫搜尋:先把焦點還給遊戲,再寫剪貼簿、Ctrl+F → Ctrl+V → Enter', () => {
    const { deps, log } = fakeDeps()
    stashSearch('"exalted"', deps)
    expect(log).toEqual(['assertGameActive', 'clip "exalted"', 'tap Ctrl+F', 'tap Ctrl+V', 'tap Enter'])
  })
})
