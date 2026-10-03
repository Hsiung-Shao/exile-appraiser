// GameDetector:前景跳過列舉、否決沿用(10 秒下限一律沿用;之後視窗清單不變沿用到 60 秒)、清單變化重查、detach 失效、連續 2 次才切換。
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ desktopCapturer: { getSources: vi.fn() } }))

import {
  ABSENT_BACKOFF_MAX_MS, GameDetector, INTERVAL_MS, REQUIRED_HITS, absentDelayMs, anyGamePresent, decideSwitch, namesSignature
} from '../src/windowing/GameDetector'
import type { GameId } from '@ipc/types'

const TITLES = { poe1: 'Path of Exile', poe2: 'Path of Exile 2' }

function setup (init: { names: string[], extra?: string[] | null, fg?: boolean, current?: GameId }) {
  const st = { names: init.names, extra: init.extra ?? null, fg: init.fg ?? false, t: 1_000_000 }
  const listWindowNames = vi.fn(async () => st.names)
  const processTitles = vi.fn(async () => st.extra)
  const onSwitch = vi.fn()
  const d = new GameDetector({
    currentGame: () => init.current ?? 'poe1',
    windowTitleBy: () => TITLES,
    onSwitch,
    isCurrentGameForeground: () => st.fg,
    listWindowNames,
    processTitles,
    now: () => st.t
  })
  return { st, d, listWindowNames, processTitles, onSwitch }
}

describe('decideSwitch', () => {
  it('目前不在、另一款在才切', () => {
    expect(decideSwitch(['Path of Exile 2'], 'poe1', TITLES)).toBe('poe2')
    expect(decideSwitch(['Path of Exile', 'Path of Exile 2'], 'poe1', TITLES)).toBeNull()
    expect(decideSwitch([], 'poe1', TITLES)).toBeNull()
  })
})

describe('GameDetector 切換條件', () => {
  it('連續 2 次才切換', async () => {
    const { d, onSwitch } = setup({ names: ['Path of Exile 2'] })
    await d.tick()
    expect(onSwitch).not.toHaveBeenCalled()
    await d.tick()
    expect(onSwitch).toHaveBeenCalledWith('poe2')
  })

  it('中間一次條件不成立 → 計數重來', async () => {
    const { d, st, onSwitch } = setup({ names: ['Path of Exile 2'] })
    await d.tick()
    st.names = ['Path of Exile', 'Path of Exile 2']
    await d.tick()
    st.names = ['Path of Exile 2']
    await d.tick()
    expect(onSwitch).not.toHaveBeenCalled()
    await d.tick()
    expect(onSwitch).toHaveBeenCalledTimes(1)
  })
})

describe('前景跳過', () => {
  it('目前遊戲在前景:不列舉、不 spawn、不切換', async () => {
    const { d, listWindowNames, processTitles, onSwitch } = setup({ names: ['Path of Exile 2'], fg: true })
    for (let i = 0; i < 5; i++) await d.tick()
    expect(listWindowNames).not.toHaveBeenCalled()
    expect(processTitles).not.toHaveBeenCalled()
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it('跳過時重置連續計數(維持「連續 2 次」語意)', async () => {
    const { d, st, onSwitch } = setup({ names: ['Path of Exile 2'] })
    await d.tick() // 1/2
    st.fg = true
    await d.tick() // 前景 → 重置
    st.fg = false
    await d.tick() // 重新 1/2
    expect(onSwitch).not.toHaveBeenCalled()
    await d.tick()
    expect(onSwitch).toHaveBeenCalledWith('poe2')
  })

  it('連續跳過 15 次後強制列舉一次(防 focus 狀態殘留)', async () => {
    const { d, listWindowNames } = setup({ names: ['Path of Exile 2'], fg: true })
    for (let i = 0; i < 15; i++) await d.tick()
    expect(listWindowNames).not.toHaveBeenCalled()
    await d.tick()
    expect(listWindowNames).toHaveBeenCalledTimes(1)
  })
})

describe('否決沿用', () => {
  const names = ['Path of Exile 2', 'Chrome']
  const minimized = ['Path of Exile']

  it('清單不變:60 秒內只 spawn 一次,期滿再查', async () => {
    const { d, st, processTitles, onSwitch } = setup({ names, extra: minimized })
    await d.tick()
    expect(processTitles).toHaveBeenCalledTimes(1)
    st.t += 30_000
    await d.tick()
    st.t += 25_000 // 55 秒
    await d.tick()
    expect(processTitles).toHaveBeenCalledTimes(1)
    st.t += 6_000 // 61 秒
    await d.tick()
    expect(processTitles).toHaveBeenCalledTimes(2)
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it('清單順序不同但集合相同仍沿用', async () => {
    const { d, st, processTitles } = setup({ names, extra: minimized })
    await d.tick()
    st.names = [...names].reverse()
    st.t += 2_000
    await d.tick()
    expect(processTitles).toHaveBeenCalledTimes(1)
    expect(namesSignature(names)).toBe(namesSignature([...names].reverse()))
  })

  it('10 秒下限:期間清單一直變也沿用(不 spawn);滿 10 秒且清單變了才重查,PoE1 真的消失則照常切換', async () => {
    const { d, st, processTitles, onSwitch } = setup({ names, extra: minimized })
    await d.tick()
    for (let i = 1; i <= 4; i++) {
      st.names = ['Path of Exile 2', 'Chrome', `Notepad ${i}`] // 無關視窗標題每 2 秒在變
      st.t += 2_000
      await d.tick()
    }
    expect(processTitles).toHaveBeenCalledTimes(1) // 8 秒內一律沿用
    st.extra = []
    st.names = ['Path of Exile 2', 'Chrome', 'Notepad 5']
    st.t += 2_000 // 10 秒,清單與否決當時不同
    await d.tick() // 重查 → 1/2
    expect(processTitles).toHaveBeenCalledTimes(2)
    st.t += 2_000
    await d.tick() // 否決已清 → 查 → 2/2
    expect(onSwitch).toHaveBeenCalledWith('poe2')
  })

  it('滿 10 秒後清單仍與否決當時相同 → 沿用到 60 秒', async () => {
    const { d, st, processTitles } = setup({ names, extra: minimized })
    await d.tick()
    st.t += 12_000
    await d.tick()
    st.t += 40_000 // 52 秒
    await d.tick()
    expect(processTitles).toHaveBeenCalledTimes(1)
  })

  it('遊戲 detach(invalidateVeto)→ 否決立即失效,下一 tick 重查,視窗已關則照常切換', async () => {
    const { d, st, processTitles, onSwitch } = setup({ names, extra: minimized })
    await d.tick()
    expect(processTitles).toHaveBeenCalledTimes(1)
    st.extra = [] // 最小化的 PoE1 被關掉
    d.invalidateVeto()
    st.t += 2_000 // 仍在 10 秒下限內
    await d.tick()
    expect(processTitles).toHaveBeenCalledTimes(2)
    st.t += 2_000
    await d.tick()
    expect(onSwitch).toHaveBeenCalledWith('poe2')
  })

  it('PowerShell 失敗(null)不記否決,下一 tick 仍會重試', async () => {
    const { d, processTitles } = setup({ names, extra: null })
    await d.tick()
    await d.tick()
    expect(processTitles).toHaveBeenCalledTimes(2)
  })
})

// ---- 第 30.3 步:兩款都不在時列舉退避 2 → 5 → 10 秒;nudge 立刻查並重設 ----

/** 手動推進的假時鐘(計時器 + now 同一條時間軸) */
function timed (init: { names: string[], extra?: string[] | null, fg?: boolean }) {
  let t = 0
  let id = 0
  const timers = new Map<number, { at: number, fn: () => void }>()
  const st = { names: init.names, extra: init.extra ?? null, fg: init.fg ?? false }
  const enumAt: number[] = []
  const onSwitch = vi.fn()
  const d = new GameDetector({
    currentGame: () => 'poe1',
    windowTitleBy: () => TITLES,
    onSwitch,
    isCurrentGameForeground: () => st.fg,
    listWindowNames: async () => { enumAt.push(t); return st.names },
    processTitles: async () => st.extra,
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id },
    clearTimeout: (h) => { timers.delete(h as number) }
  })
  async function advance (ms: number) {
    const end = t + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0])
      t = next[1].at
      next[1].fn()
      for (let i = 0; i < 20; i++) await Promise.resolve()
    }
    t = end
  }
  return { d, st, enumAt, onSwitch, advance, pending: () => [...timers.values()].map(v => v.at - t), now: () => t }
}

describe('列舉退避(遊戲沒開)', () => {
  it('absentDelayMs:0 → 2 秒;連續 1 / 2 / 3+ 次 → 2 / 5 / 10 秒(上限 10)', () => {
    expect(absentDelayMs(0)).toBe(INTERVAL_MS)
    expect([1, 2, 3, 4, 50].map(absentDelayMs)).toEqual([2000, 5000, 10_000, 10_000, 10_000])
    expect(ABSENT_BACKOFF_MAX_MS).toBe(10_000)
    expect(anyGamePresent(['Chrome', 'Path of Exile 2'], TITLES)).toBe(true)
    expect(anyGamePresent(['Chrome', 'Path of Exile 3'], TITLES)).toBe(false)
    expect(anyGamePresent([''], { poe1: '', poe2: '' })).toBe(false)
  })

  it('兩款都不在:列舉時間點 2, 4, 9, 19, 29… 秒;60 秒內 8 次(改前每 2 秒 30 次)', async () => {
    const { d, enumAt, advance, pending } = timed({ names: ['Chrome'] })
    d.start()
    await advance(60_000)
    expect(enumAt).toEqual([2000, 4000, 9000, 19_000, 29_000, 39_000, 49_000, 59_000])
    expect(enumAt.filter(x => x <= 60_000)).toHaveLength(8)
    expect(pending()).toHaveLength(1)
    d.stop()
    expect(pending()).toEqual([])
  })

  it('有遊戲視窗(在背景)→ 照舊每 2 秒', async () => {
    const { d, enumAt, advance } = timed({ names: ['Path of Exile', 'Chrome'] })
    d.start()
    await advance(10_000)
    expect(enumAt).toEqual([2000, 4000, 6000, 8000, 10_000])
    d.stop()
  })

  it('退避中另一款啟動:最壞 10 秒內第 1 次命中,再 2 秒確認(連續 2 次條件不變)→ 切換', async () => {
    const { d, st, enumAt, onSwitch, advance, now } = timed({ names: ['Chrome'], extra: [] })
    d.start()
    await advance(20_000) // 已退避到 10 秒
    expect(d.backoff.nextMs).toBe(10_000)
    const launchedAt = now() + 1 // 剛錯過列舉
    st.names = ['Chrome', 'Path of Exile 2']
    await advance(30_000)
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch).toHaveBeenCalledWith('poe2')
    const hits = enumAt.filter(x => x >= launchedAt)
    expect(hits).toHaveLength(REQUIRED_HITS)
    expect(hits[0] - launchedAt).toBeLessThanOrEqual(ABSENT_BACKOFF_MAX_MS)
    expect(hits[1] - hits[0]).toBe(INTERVAL_MS)
    d.stop()
  })

  it('nudge():退避中立刻查一次並重設退避(之後 2 → 5 → 10 重來)', async () => {
    const { d, enumAt, advance } = timed({ names: ['Chrome'] })
    d.start()
    await advance(25_000) // 2, 4, 9, 19
    expect(enumAt).toEqual([2000, 4000, 9000, 19_000])
    d.nudge()
    await advance(0)
    expect(enumAt.at(-1)).toBe(25_000)
    await advance(10_000)
    expect(enumAt.slice(-3)).toEqual([25_000, 27_000, 32_000])
    d.stop()
  })

  it('nudge() 立刻偵測到另一款:命中後回到每 2 秒確認', async () => {
    const { d, st, onSwitch, advance, now } = timed({ names: ['Chrome'], extra: [] })
    d.start()
    await advance(30_000)
    st.names = ['Path of Exile 2']
    const t0 = now()
    d.nudge()
    await advance(0)
    await advance(INTERVAL_MS)
    expect(onSwitch).toHaveBeenCalledWith('poe2')
    expect(now() - t0).toBe(INTERVAL_MS)
    d.stop()
  })

  it('nudge():沒在退避(有遊戲)/ 沒啟動 → 不額外列舉', async () => {
    const { d, enumAt, advance } = timed({ names: ['Path of Exile'] })
    d.nudge()
    await advance(5_000)
    expect(enumAt).toEqual([])
    d.start()
    await advance(2_000)
    d.nudge()
    d.nudge()
    await advance(0)
    expect(enumAt).toEqual([7000]) // 啟動前推進了 5 秒 → 第一次在 5 + 2 秒
    d.stop()
  })

  it('前景跳過也重設退避;stop / start 重設;計時器不洩漏', async () => {
    const { d, st, enumAt, advance, pending } = timed({ names: ['Chrome'] })
    d.start()
    await advance(20_000)
    expect(d.backoff.streak).toBeGreaterThanOrEqual(3)
    st.fg = true
    await advance(10_000)
    expect(d.backoff.streak).toBe(0)
    st.fg = false
    const n = enumAt.length
    await advance(2_000)
    expect(enumAt.length).toBe(n + 1)
    for (let i = 0; i < 10; i++) { d.nudge(); await advance(100) }
    expect(pending()).toHaveLength(1)
    d.stop()
    d.nudge()
    expect(pending()).toEqual([])
    expect(d.running).toBe(false)
    d.start()
    expect(d.backoff.streak).toBe(0)
    expect(pending()).toEqual([INTERVAL_MS])
    d.stop()
  })
})
