// GameDetector:前景跳過列舉、否決沿用(10 秒下限一律沿用;之後視窗清單不變沿用到 60 秒)、清單變化重查、detach 失效、連續 2 次才切換。
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ desktopCapturer: { getSources: vi.fn() } }))

import { GameDetector, decideSwitch, namesSignature } from '../src/windowing/GameDetector'
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
