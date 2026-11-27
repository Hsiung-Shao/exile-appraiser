// speedrun 中途開始:autoAction 跳段分段、jumpTo、partial 不寫個人最佳。假時鐘,純函式。
import { describe, expect, it } from 'vitest'
import { autoAction } from '../src/speedrun/autosplit'
import { presetRoute, type Route } from '../src/speedrun/routes'
import { createRun } from '../src/speedrun/run'

const clock = () => {
  let t = 1_000_000
  return { now: () => t, advance: (ms: number) => { t += ms } }
}
const poe1 = (): Route => ({ ...presetRoute('poe1', 'cmn-Hant'), autoSplit: true })
const mk = (n: number, pb: Route['pb']): Route => ({
  splits: Array.from({ length: n }, (_, i) => ({ name: `S${i}`, area: `a${i}` })),
  startArea: 'start_area', history: [], compare: null,
  pb,
  golds: Array(n).fill(null),
  attempts: 0,
  autoStart: true,
  autoSplit: true
})

describe('中途開始跳段(autoAction / jumpTo)', () => {
  it('T1 中途開始進第 3 章第一張圖 → 跳到那段分段', () => {
    const c = clock()
    const route = poe1()
    const run = createRun(route, c.now)
    run.start()
    expect(run.index).toBe(0)
    expect(autoAction(run, route, '1_4_1')).toEqual({ split: 2 })
    c.advance(5_000)
    run.jumpTo(2)
    run.split()
    expect(run.index).toBe(3)
    expect(run.splitTimes[0]).toBeNull()
    expect(run.splitTimes[1]).toBeNull()
    expect(run.splitTimes[2]).toBe(5_000)
    expect(run.partial).toBe(true)
  })

  it('T1 jumpTo 超出範圍 / 不往後跳 → 不動、partial 仍 false', () => {
    const run = createRun(poe1(), clock().now)
    run.start()
    run.jumpTo(0)
    run.jumpTo(99)
    expect(run.index).toBe(0)
    expect(run.partial).toBe(false)
  })

  it('T2 分過一段後回舊城鎮(第 0 段區域)→ 不觸發', () => {
    const c = clock()
    const route = poe1()
    const run = createRun(route, c.now)
    run.start()
    c.advance(1_000)
    run.split()
    expect(autoAction(run, route, '1_2_1')).toBeNull()
  })

  it('T3 分過一段後只認目前這段:第 5 段區域 null,第 1 段區域 → split 1', () => {
    const c = clock()
    const route = poe1()
    const run = createRun(route, c.now)
    run.start()
    c.advance(1_000)
    run.split()
    expect(autoAction(run, route, route.splits[5].area as string)).toBeNull()
    expect(autoAction(run, route, route.splits[1].area as string)).toEqual({ split: 1 })
  })
})

describe('中途開始(partial)不寫個人最佳', () => {
  const OLD_PB = [10_000, 20_000, 30_000, 40_000]
  const cases: Array<[string, () => Route['pb']]> = [['原本無 PB', () => null], ['原本有 PB', () => [...OLD_PB]]]
  for (const [label, pbOf] of cases) {
    it(`T4 ${label}:跳段後跑完 → route.pb 不變;跳段後第一段非金段、下一段起寫金段`, () => {
      const c = clock()
      const before = pbOf()
      const route = mk(4, before === null ? null : [...before])
      const run = createRun(route, c.now)
      run.start()
      c.advance(1_000)
      run.jumpTo(1)
      c.advance(5_000)
      run.split() // 累計 6000,前一段 null → 不算金段
      c.advance(3_000)
      run.split() // 段時間 3000
      c.advance(2_000)
      run.split() // 段時間 2000
      expect(run.phase).toBe('finished')
      expect(route.pb).toEqual(before)
      expect(route.golds).toEqual([null, null, 3_000, 2_000])
    })
  }

  it('T5 重設後旗標清掉,從頭依序跑完會寫入個人最佳', () => {
    const c = clock()
    const route = mk(4, [...OLD_PB])
    const run = createRun(route, c.now)
    run.start()
    run.jumpTo(1)
    for (let i = 1; i < 4; i++) { c.advance(1_000); run.split() }
    expect(run.partial).toBe(true)
    expect(route.pb).toEqual(OLD_PB)
    run.reset()
    expect(run.partial).toBe(false)
    run.start()
    expect(run.partial).toBe(false)
    for (let i = 0; i < 4; i++) { c.advance(1_000); run.split() }
    expect(run.partial).toBe(false)
    expect(route.pb).toEqual([1_000, 2_000, 3_000, 4_000])
  })
})

describe('審查修正:撤銷回到跳段之前', () => {
  it('T14 撤銷到跳段起點 → partial 清掉,照常跑完會寫個人最佳', () => {
    const c = clock()
    const route = mk(3, null)
    const run = createRun(route, c.now)
    run.start()
    run.jumpTo(2)
    c.advance(1000)
    run.split()
    expect(run.phase).toBe('finished')
    run.undo()
    expect(run.partial).toBe(true)
    run.undo()
    run.undo()
    expect(run.index).toBe(0)
    expect(run.partial).toBe(false)
    for (let i = 0; i < 3; i++) { c.advance(1000); run.split() }
    expect(route.pb).not.toBeNull()
  })
})

describe('審查修正第 2 輪:連跳兩次', () => {
  it('T15 撤銷後再跳一次,撤銷回第二次起點不清 partial、跑完不寫個人最佳', () => {
    const c = clock()
    const route = mk(5, null)
    const run = createRun(route, c.now)
    run.start()
    run.jumpTo(2)
    c.advance(1000)
    run.split()
    run.undo()
    run.jumpTo(3)
    c.advance(1000)
    run.split()
    run.undo()
    run.undo()
    expect(run.index).toBe(2)
    expect(run.partial).toBe(true)
    for (let i = 2; i < 5; i++) { c.advance(1000); run.split() }
    expect(route.pb).toBeNull()
  })
})
