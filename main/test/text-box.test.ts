// exile-appraiser(2026-10-01):聊天指令 / 倉庫搜尋的按鍵序列(main/src/text-box.ts,移植自 APT text-box.ts)。
// 只注入假的 keyTap 與假的剪貼簿:**不送任何真實鍵盤輸入、不碰系統剪貼簿**。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 避免載入真的 electron 套件(K 系列用真的 HostClipboard)
vi.mock('electron', () => ({ clipboard: { readText: () => '', writeText: () => {} } }))

import { HostClipboard, type ClipboardIO } from '../src/HostClipboard'
import { chatKeySequence, stashSearch, stashSearchSequence, typeInChat, type TextBoxDeps, type TextBoxKey } from '../src/text-box'

const fmt = (k: { key: TextBoxKey, mods: TextBoxKey[] }) => [...k.mods, k.key].join('+')
const RESTORE_LAST_CHAT = ['Enter', 'Enter', 'ArrowUp', 'ArrowUp', 'Escape']

/** 假 host:記錄 keyTap 與剪貼簿寫入的先後;restoreShortly 照 HostClipboard 的 120 ms 節流(未還原前再呼叫直接略過;cb 丟例外立刻解鎖) */
function fakeDeps (platform = 'win32') {
  const log: string[] = []
  let restored = true
  const release: Array<() => void> = []
  const deps: TextBoxDeps & { assertGameActive: () => void } = {
    platform,
    tap: (key, mods) => { log.push(`tap ${[...mods, key].join('+')}`) },
    clipboard: {
      restoreShortly: async (cb) => {
        if (!restored) { log.push('skipped(throttle)'); return }
        restored = false
        try {
          await cb({ writeText: async (t) => { log.push(`clip ${t}`) } })
        } catch (e) {
          restored = true
          throw e
        }
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
  it('先寫剪貼簿再送鍵,全部包在 restoreShortly 裡', async () => {
    const { deps, log, tick } = fakeDeps()
    await typeInChat('/hideout', true, deps)
    expect(log).toEqual(['clip /hideout', 'tap Enter', 'tap Ctrl+V', 'tap Enter', 'tap Enter', 'tap ArrowUp', 'tap ArrowUp', 'tap Escape'])
    tick()
    expect(log[log.length - 1]).toBe('restored')
  })
  it('120 ms 內連按 → 第二次略過(防遊戲 Too many actions)', async () => {
    const { deps, log, tick } = fakeDeps()
    await typeInChat('/exit', true, deps)
    const n = log.length
    await typeInChat('/exit', true, deps)
    expect(log.slice(n)).toEqual(['skipped(throttle)'])
    tick()
    await typeInChat('/exit', false, deps)
    expect(log.slice(-3)).toEqual(['clip /exit', 'tap Enter', 'tap Ctrl+V'])
  })
  it('K2 倉庫搜尋順序不變:assertGameActive → clip → Ctrl+F → Ctrl+V → Enter', async () => {
    const { deps, log } = fakeDeps()
    await stashSearch('"exalted"', deps)
    expect(log).toEqual(['assertGameActive', 'clip "exalted"', 'tap Ctrl+F', 'tap Ctrl+V', 'tap Enter'])
  })
})

/** 真的 HostClipboard + 假 io(假計時器):驗證「寫完剪貼簿才送鍵」與節流鎖 */
function realDeps (o: { write?: (t: string, n: number) => void | Promise<void>, assertGameActive?: () => void } = {}) {
  const taps: string[] = []
  const writes: string[] = []
  const io: ClipboardIO = {
    readText: () => 'saved',
    writeText: (t) => { const n = writes.length; writes.push(t); return o.write?.(t, n) }
  }
  const hc = new HostClipboard(io)
  hc.updateOptions(false)
  const deps: TextBoxDeps & { assertGameActive?: () => void } = {
    platform: 'win32',
    tap: (key, mods) => { taps.push([...mods, key].join('+')) },
    clipboard: hc,
    assertGameActive: o.assertGameActive
  }
  return { deps, taps, writes }
}

/** 推進假計時器,回傳 promise 的目前狀態(ok: null = 仍 pending);不 await 未完成的 promise,也不讓 reject 變成未處理 */
async function settle (fn: () => Promise<unknown> | void, ms = 1000) {
  const state: { ok: boolean | null, e?: Error } = { ok: null }
  try {
    Promise.resolve(fn()).then(() => { state.ok = true }, (e: Error) => { state.ok = false; state.e = e })
  } catch (e) {
    state.ok = false
    state.e = e as Error
  }
  await vi.advanceTimersByTimeAsync(ms)
  return state
}

describe('typeInChat / stashSearch(真 HostClipboard + 假 io)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('K1 寫入未完成前不送任何鍵,完成後依序送出完整序列', async () => {
    const { deps, taps, writes } = realDeps({
      write: () => new Promise<void>((resolve) => { setTimeout(resolve, 50) })
    })
    const p = typeInChat('/hideout', true, deps)
    await vi.advanceTimersByTimeAsync(49)
    expect(writes).toEqual(['/hideout'])
    // 漏 await 會在寫入前就送 Ctrl+V,貼到舊內容
    expect(taps).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(taps).toEqual(['Enter', 'Ctrl+V', 'Enter', 'Enter', 'ArrowUp', 'ArrowUp', 'Escape'])
    await vi.advanceTimersByTimeAsync(500)
    await p
  })

  it('K3 同一 tick 連呼叫兩次只執行一組(第二次略過)', async () => {
    const { deps, taps, writes } = realDeps()
    const a = typeInChat('/exit', false, deps)
    const b = typeInChat('/exit', false, deps)
    const r = await settle(() => Promise.all([a, b]))
    expect(r.ok).toBe(true)
    // 節流旗標若在 await 之後才設,兩組按鍵會交錯
    expect(writes).toEqual(['/exit'])
    expect(taps).toEqual(['Enter', 'Ctrl+V'])
  })

  it('K4 寫入失敗:不送任何鍵、錯誤傳回呼叫端、節流立即解鎖', async () => {
    const { deps, taps, writes } = realDeps({
      write: (_t, n) => (n === 0 ? Promise.reject(new Error('write failed')) : undefined)
    })
    const r1 = await settle(() => typeInChat('/exit', false, deps))
    expect(r1.ok).toBe(false)
    expect(r1.e?.message).toBe('write failed')
    // 失敗仍送鍵會把 Ctrl+V 送進遊戲
    expect(taps).toEqual([])
    // 節流永久鎖死會讓第二次被略過
    const r2 = await settle(() => typeInChat('/exit', false, deps))
    expect(r2.ok).toBe(true)
    expect(writes).toEqual(['/exit', '/exit'])
    expect(taps).toEqual(['Enter', 'Ctrl+V'])
  })

  it('K5 callback 丟例外也解鎖,之後的呼叫仍會執行', async () => {
    let n = 0
    const { deps, taps, writes } = realDeps({
      assertGameActive: () => { if (n++ === 0) throw new Error('game inactive') }
    })
    const r1 = await settle(() => stashSearch('"x"', deps))
    expect(r1.ok).toBe(false)
    expect(r1.e?.message).toBe('game inactive')
    expect(writes).toEqual([])
    expect(taps).toEqual([])
    // 舊版 isRestored 永久 false:之後的呼叫會被當成節流略過
    const r2 = await settle(() => stashSearch('"x"', deps))
    expect(r2.ok).toBe(true)
    expect(writes).toEqual(['"x"'])
    expect(taps).toEqual(['Ctrl+F', 'Ctrl+V', 'Enter'])
  })
})
