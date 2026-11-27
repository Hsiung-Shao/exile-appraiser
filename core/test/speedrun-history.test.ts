// speedrun 嘗試紀錄(history):每次嘗試一筆、設為 PB、比較對象、設定檔往返、上限、預設名稱。純函式,假時鐘,不碰檔案。
import { describe, expect, it } from 'vitest'
import { normRoute, presetRoute, replaceSplits, type Route } from '../src/speedrun/routes'
import { comparison, createRun, deltaAt } from '../src/speedrun/run'
import {
  addRecord, compatible, deleteRecord, HISTORY_LIMIT, recordLabel, recordTotal, routeShape, setPbFromRecord,
  type RunRecord
} from '../src/speedrun/history'

const clock = () => {
  let t = 1_000_000
  return { now: () => t, advance: (ms: number) => { t += ms } }
}
// n 段的路線(取內建路線前 n 段;history / compare 來自 presetRoute)
const mk = (n: number, extra: Partial<Route> = {}): Route => {
  const base = presetRoute('poe1', 'cmn-Hant')
  return { ...replaceSplits(base, base.splits.slice(0, n)), ...extra }
}
const rec = (route: Route, over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r1',
  name: '',
  at: 1_000_000,
  splitTimes: route.splits.map(() => 1000),
  finished: true,
  partial: false,
  shape: routeShape(route),
  ...over
})

describe('嘗試紀錄', () => {
  it('H1 分段一次就存成一筆紀錄', () => {
    const c = clock()
    const route = mk(3)
    const run = createRun(route, c.now)
    run.start()
    c.advance(5_000)
    run.split()
    expect(route.history).toHaveLength(1)
    const r = route.history[0]
    expect(r.splitTimes).toEqual([5_000, null, null])
    expect(r.finished).toBe(false)
    expect(r.partial).toBe(false)
    expect(r.at).toBe(1_000_000)
    expect(r.shape).toBe(routeShape(route))
    expect(run.attemptId).toBe(r.id)
  })

  it('H2 沒分段就重設不存', () => {
    const c = clock()
    const route = mk(3)
    const run = createRun(route, c.now)
    run.start()
    c.advance(3_000)
    run.reset()
    expect(route.history).toHaveLength(0)
  })

  it('H3 跑完標成完成、總時間正確', () => {
    const c = clock()
    const route = mk(2)
    const run = createRun(route, c.now)
    run.start()
    c.advance(5_000)
    run.split()
    c.advance(7_000)
    run.split()
    expect(route.history).toHaveLength(1)
    const r = route.history[0]
    expect(r.finished).toBe(true)
    expect(r.splitTimes).toEqual([5_000, 12_000])
    expect(recordTotal(r)).toBe(12_000)
  })

  it('H4 撤銷會跟著改紀錄', () => {
    const c = clock()
    const route = mk(2)
    const run = createRun(route, c.now)
    run.start()
    c.advance(5_000)
    run.split()
    c.advance(7_000)
    run.split()
    run.undo()
    expect(route.history).toHaveLength(1)
    const r = route.history[0]
    expect(r.finished).toBe(false)
    expect(r.splitTimes).toEqual([5_000, null])
    expect(recordTotal(r)).toBeNull()
  })

  it('H5 撤銷到 0 段時刪掉那筆', () => {
    const c = clock()
    const route = mk(3)
    const run = createRun(route, c.now)
    run.start()
    c.advance(2_000)
    run.split()
    expect(route.history).toHaveLength(1)
    run.undo()
    expect(route.history).toHaveLength(0)
  })

  it('H6 兩次嘗試是兩筆,id 不同(即使時鐘沒動)', () => {
    const c = clock()
    const route = mk(2)
    const run = createRun(route, c.now)
    run.start()
    run.split()
    const first = run.attemptId
    run.reset()
    run.start()
    run.split()
    expect(route.history).toHaveLength(2)
    expect(route.history[0].id).not.toBe(route.history[1].id)
    expect(run.attemptId).not.toBe(first)
    expect(route.history[1].id).toBe(run.attemptId)
  })

  it('H7 中途開始的紀錄標 partial', () => {
    const c = clock()
    const route = mk(4)
    const run = createRun(route, c.now)
    run.start()
    run.jumpTo(2)
    c.advance(9_000)
    run.split()
    expect(route.history).toHaveLength(1)
    expect(route.history[0].partial).toBe(true)
    expect(route.history[0].splitTimes).toEqual([null, null, 9_000, null])
  })

  it('H8 選紀錄當比較對象,差值改跟它比;比較對象不影響個人最佳', () => {
    const c = clock()
    const route = mk(2, { pb: [8_000, 16_000] })
    // 先跑一次較慢的(總 25000,不會換 PB)
    const a = createRun(route, c.now)
    a.start()
    c.advance(10_000)
    a.split()
    c.advance(15_000)
    a.split()
    expect(route.pb).toEqual([8_000, 16_000])
    expect(route.history).toHaveLength(1)
    a.reset()
    route.compare = route.history[0].id

    // 再跑一次(總 20000:比比較對象快、比 PB 慢)
    const b = createRun(route, c.now)
    b.start()
    c.advance(9_000)
    b.split()
    // 跟比較對象比 9000 - 10000;跟 PB 比會是 +1000
    expect(deltaAt(b, route, 0)).toBe(-1_000)
    c.advance(11_000)
    b.split()
    expect(deltaAt(b, route, 1)).toBe(-5_000)
    // 比較對象不是 PB:20000 > PB 16000 → PB 不換
    expect(route.pb).toEqual([8_000, 16_000])
    expect(route.history).toHaveLength(2)
  })

  it('H9 比較對象分段不同時退回 PB', () => {
    const c = clock()
    const route2 = mk(2, { pb: [8_000, 16_000] })
    const r = rec(route2, { id: 'old', splitTimes: [1_000, 2_000] })
    route2.history = [r]
    route2.compare = 'old'
    const run0 = createRun(route2, c.now)
    run0.start()
    // 對照組:結構相同時比較的是那筆紀錄
    expect(comparison(run0, route2).pb).toEqual([1_000, 2_000])
    run0.reset()

    // 改成 3 段:紀錄與 compare 都還在,但結構不同
    const base3 = mk(3)
    const route3: Route = { ...base3, history: route2.history, compare: route2.compare }
    expect(compatible(r, route3)).toBe(false)
    const run = createRun(route3, c.now)
    run.start()
    expect(comparison(run, route3).pb).toBeNull()
    route3.pb = [1, 2, 3]
    const run2 = createRun(route3, c.now)
    run2.start()
    expect(comparison(run2, route3).pb).toEqual([1, 2, 3])
  })

  it('H10 設為個人最佳:PB 等於該筆時間且是複本', () => {
    const route = mk(2, { pb: [9_000, 20_000] })
    const r = rec(route, { splitTimes: [4_000, 11_000] })
    addRecord(route, r)
    expect(setPbFromRecord(route, r.id)).toBe(true)
    expect(route.pb).toEqual([4_000, 11_000])
    expect(route.pb).not.toBe(r.splitTimes)
    r.splitTimes[0] = 999
    expect(route.pb).toEqual([4_000, 11_000])
  })

  it('H11 未跑完或中途開始的不能設 PB', () => {
    const route = mk(2, { pb: [9_000, 20_000] })
    addRecord(route, rec(route, { id: 'unfinished', finished: false, splitTimes: [4_000, null] }))
    addRecord(route, rec(route, { id: 'partial', partial: true, splitTimes: [null, 11_000] }))
    addRecord(route, rec(route, { id: 'other-shape', shape: routeShape(mk(3)) }))
    for (const id of ['unfinished', 'partial', 'other-shape', 'missing']) {
      expect(setPbFromRecord(route, id), id).toBe(false)
    }
    expect(route.pb).toEqual([9_000, 20_000])
  })

  it('H12 刪除比較對象後回到 PB', () => {
    const route = mk(2)
    addRecord(route, rec(route, { id: 'a' }))
    addRecord(route, rec(route, { id: 'b' }))
    route.compare = 'a'
    // 刪別筆不動 compare
    expect(deleteRecord(route, 'b')).toBe(true)
    expect(route.compare).toBe('a')
    addRecord(route, rec(route, { id: 'b' }))
    expect(route.history).toHaveLength(2)
    expect(deleteRecord(route, 'a')).toBe(true)
    expect(route.compare).toBeNull()
    expect(route.history.map(h => h.id)).toEqual(['b'])
    expect(deleteRecord(route, 'nope')).toBe(false)
  })

  it('H13 設定檔往返與壞值', () => {
    // 舊檔:沒有 history / compare 欄位
    const legacy: Record<string, unknown> = { ...presetRoute('poe1', 'cmn-Hant') }
    delete legacy.history
    delete legacy.compare
    const old = normRoute(legacy, 'poe1', 'cmn-Hant')
    expect(old.history).toEqual([])
    expect(old.compare).toBeNull()

    // 壞筆略過、好筆留下、compare 指向不存在 id → null
    const base = presetRoute('poe1', 'cmn-Hant')
    const n = base.splits.length
    const good = rec(base, { id: 'ok1', name: '弓箭手', splitTimes: base.splits.map((_, i) => (i === 0 ? 1_000 : null)), finished: false })
    const mixed = {
      ...base,
      history: [
        null,
        5,
        { ...good, id: 7 },
        { ...good, id: 'bad-notarray', splitTimes: 'x' },
        { ...good, id: 'bad-negative', splitTimes: [-1, ...Array(n - 1).fill(null)] },
        { ...good, id: 'bad-string', splitTimes: ['a', ...Array(n - 1).fill(null)] },
        good
      ],
      compare: 'ghost'
    }
    const norm = normRoute(mixed, 'poe1', 'cmn-Hant')
    expect(norm.history).toEqual([good])
    expect(norm.compare).toBeNull()

    // compare 指向存在的 id → 保留
    expect(normRoute({ ...mixed, compare: 'ok1' }, 'poe1', 'cmn-Hant').compare).toBe('ok1')

    // JSON 往返後內容相同
    const full: Route = { ...base, history: [good, rec(base, { id: 'ok2', at: 2_000_000, partial: true })], compare: 'ok2' }
    expect(normRoute(JSON.parse(JSON.stringify(full)), 'poe1', 'cmn-Hant')).toEqual(full)
  })

  it('H14 上限 500 筆,保留比較對象', () => {
    expect(HISTORY_LIMIT).toBe(500)
    const route = mk(2)
    for (let i = 0; i < HISTORY_LIMIT; i++) route.history.push(rec(route, { id: `r${i}` }))
    route.compare = 'r0'
    addRecord(route, rec(route, { id: 'new1' }))
    expect(route.history).toHaveLength(HISTORY_LIMIT)
    const ids = route.history.map(h => h.id)
    expect(ids).toContain('r0')
    expect(ids).not.toContain('r1')
    expect(ids[ids.length - 1]).toBe('new1')

    // 沒有比較對象時刪最舊的
    route.compare = null
    addRecord(route, rec(route, { id: 'new2' }))
    expect(route.history).toHaveLength(HISTORY_LIMIT)
    expect(route.history.map(h => h.id)).not.toContain('r0')
  })

  it('H15 預設名稱是日期時間、可改名', () => {
    const route = mk(2)
    const at = new Date(2026, 10, 28, 21, 5).getTime()
    expect(recordLabel(rec(route, { at, name: '' }))).toBe('11-28 21:05')
    expect(recordLabel(rec(route, { at, name: '弓箭手' }))).toBe('弓箭手')
    expect(recordLabel(rec(route, { at, name: '  ' }))).toBe('11-28 21:05')
    // 個位數補 0
    expect(recordLabel(rec(route, { at: new Date(2026, 0, 3, 4, 5).getTime() }))).toBe('01-03 04:05')
  })

  it('H16 分段結構簽章:同結構相同,改段數或 area 不同', () => {
    const a = mk(3)
    expect(routeShape(a)).toBe(routeShape(mk(3)))
    expect(routeShape(a)).not.toBe(routeShape(mk(4)))
    const changed = replaceSplits(a, a.splits.map((s, i) => (i === 1 ? { ...s, area: 'other_area' } : s)))
    expect(routeShape(changed)).not.toBe(routeShape(a))
    // 只改名稱不影響結構
    const renamed = replaceSplits(a, a.splits.map(s => ({ ...s, name: 'x' + s.name })))
    expect(routeShape(renamed)).toBe(routeShape(a))
    expect(compatible(rec(a), renamed)).toBe(true)
    expect(compatible(rec(a), changed)).toBe(false)
  })
})

// 2026-11-28 審查第 1 輪:瀏覽器預覽的設定頁看不到 Electron 那邊正在跑的計時 → 防護要在 core
describe('計時中從別的頁面改紀錄(審查第 1 輪)', () => {
  it('R1 計時中外部設了新 PB,下一次分段不會用開始時的快照蓋回去', () => {
    const c = clock()
    const route = mk(3, { pb: [10_000, 20_000, 30_000] })
    const run = createRun(route, c.now)
    run.start()
    c.advance(50_000); run.split()
    route.pb = [1_000, 2_000, 3_000]
    c.advance(50_000); run.split()
    expect(route.pb).toEqual([1_000, 2_000, 3_000])
  })
  it('R2 計時中外部刪掉這次的紀錄,下一次分段不會加回來', () => {
    const c = clock()
    const route = mk(3)
    const run = createRun(route, c.now)
    run.start()
    c.advance(5_000); run.split()
    deleteRecord(route, route.history[0].id)
    c.advance(5_000); run.split()
    expect(route.history).toHaveLength(0)
  })
  it('R3 調順序(不保留紀錄)後,舊紀錄算分段不同,即使兩段區域相同', () => {
    const route = mk(3)
    route.splits[1].area = null
    route.splits[2].area = null
    const old = rec(route)
    const swapped = replaceSplits(route, [route.splits[0], route.splits[2], route.splits[1]], false)
    expect(compatible(old, swapped)).toBe(false)
    // 只改名(保留紀錄)仍相容
    expect(compatible(old, replaceSplits(route, route.splits.map(s => ({ ...s, name: s.name + '!' }))))).toBe(true)
  })
})
