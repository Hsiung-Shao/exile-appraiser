// 第 30.8 步:poe.ninja 定期更新只在「最近一次查價後 20 分鐘內」排(interest-refresh.ts)+ Prices.ts 接線。
// 假計時器;不載 Vue / Host。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createInterestRefresh, type RefreshTimers } from '../src/web/background/interest-refresh'

const MIN = 60_000
const INTERVAL = 4 * MIN
const SPAN = 20 * MIN

function fakeTimers () {
  let t = 1_000_000
  let id = 0
  const timers = new Map<number, { next: number, ms: number, fn: () => void }>()
  const api: RefreshTimers = {
    setInterval: (fn, ms) => { timers.set(++id, { next: t + ms, ms, fn }); return id },
    clearInterval: (h) => { timers.delete(h as number) },
    now: () => t
  }
  function advance (ms: number) {
    const end = t + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.next <= end).sort((a, b) => a[1].next - b[1].next)[0]
      if (!due) break
      t = due[1].next
      due[1].next += due[1].ms
      due[1].fn()
    }
    t = end
  }
  return { api, advance, count: () => timers.size, now: () => t }
}

/**
 * `Prices.ts` `load()`(force = false)的「會不會真的上網抓」閘門(抓價中 / 快取讀取的部分與計時器無關,省略):
 * 資料過期(這裡用「距上次抓 ≥ 31 分鐘」代表)且距上次查價 ≤ 20 分鐘。
 */
function loadGate (st: { lastInterest: number, lastFetch: number }, now: number): boolean {
  if (now - st.lastFetch < 31 * MIN) return false
  if (now - st.lastInterest > SPAN) return false
  st.lastFetch = now
  return true
}

describe('createInterestRefresh', () => {
  it('沒人查價:不開計時器(改前常駐每 4 分鐘喚醒一次)', () => {
    const f = fakeTimers()
    let n = 0
    const r = createInterestRefresh({ intervalMs: INTERVAL, spanMs: SPAN, refresh: () => { n++ }, timers: f.api })
    f.advance(120 * MIN)
    expect(r.active).toBe(false)
    expect(f.count()).toBe(0)
    expect(n).toBe(0)
  })

  it('查價後 20 分鐘內每 4 分鐘 refresh(4、8、12、16、20 分鐘),之後關掉計時器', () => {
    const f = fakeTimers()
    const at: number[] = []
    const r = createInterestRefresh({ intervalMs: INTERVAL, spanMs: SPAN, refresh: () => { at.push(f.now()) }, timers: f.api })
    const t0 = f.now()
    r.touch()
    expect(r.active).toBe(true)
    f.advance(60 * MIN)
    expect(at.map(x => (x - t0) / MIN)).toEqual([4, 8, 12, 16, 20])
    expect(r.active).toBe(false)
    expect(f.count()).toBe(0)
  })

  it('期間內再查價:沿用同一個計時器(不重設節奏、不疊加),期限從最後一次查價起算', () => {
    const f = fakeTimers()
    const at: number[] = []
    const r = createInterestRefresh({ intervalMs: INTERVAL, spanMs: SPAN, refresh: () => { at.push(f.now()) }, timers: f.api })
    const t0 = f.now()
    r.touch()
    f.advance(10 * MIN)
    r.touch()
    r.touch()
    expect(f.count()).toBe(1)
    f.advance(60 * MIN)
    // 最後一次查價在 10 分鐘 → refresh 到 28 分鐘(≤ 30),32 分鐘關掉
    expect(at.map(x => (x - t0) / MIN)).toEqual([4, 8, 12, 16, 20, 24, 28])
    expect(r.active).toBe(false)
  })

  it('過期關掉後再查價 → 重新開;stop() 關掉', () => {
    const f = fakeTimers()
    let n = 0
    const r = createInterestRefresh({ intervalMs: INTERVAL, spanMs: SPAN, refresh: () => { n++ }, timers: f.api })
    r.touch()
    f.advance(30 * MIN)
    expect(r.active).toBe(false)
    r.touch()
    expect(r.active).toBe(true)
    f.advance(4 * MIN)
    expect(n).toBe(6)
    r.stop()
    expect(f.count()).toBe(0)
    f.advance(30 * MIN)
    expect(n).toBe(6)
  })

  it('實際上網抓的時間點與改前常駐 interval 相同:20 分鐘閘門外的 interval 本來就不抓', () => {
    // 時間軸:0 分查價(抓)、之後 3 小時內在 50、52、130 分查價;資料 31 分鐘後算過期
    const queries = [0, 50, 52, 130].map(m => m * MIN)
    const run = (mode: 'old' | 'new') => {
      const f = fakeTimers()
      const t0 = f.now()
      const st = { lastInterest: Number.NEGATIVE_INFINITY, lastFetch: Number.NEGATIVE_INFINITY }
      const fetches: number[] = []
      const load = () => { if (loadGate(st, f.now())) fetches.push((f.now() - t0) / MIN) }
      let wakeups = 0
      const r = createInterestRefresh({ intervalMs: INTERVAL, spanMs: SPAN, refresh: () => { wakeups++; load() }, timers: f.api })
      if (mode === 'old') f.api.setInterval(() => { wakeups++; load() }, INTERVAL)
      let cur = 0
      for (const q of queries) {
        f.advance(q - cur)
        cur = q
        st.lastInterest = f.now()
        if (mode === 'new') r.touch(st.lastInterest)
        load()
      }
      f.advance(180 * MIN - cur)
      return { fetches, wakeups }
    }
    const before = run('old')
    const after = run('new')
    expect(after.fetches).toEqual(before.fetches)
    expect(before.fetches).toEqual([0, 50, 130])
    expect(after.wakeups).toBeLessThan(before.wakeups)
    expect(before.wakeups).toBe(45) // 180 分鐘 / 4
    expect(after.wakeups).toBe(15) // 0–20 分:4…20 共 5 次;50 / 52 分查價 → 54…70 共 5 次(74 分已超過 52 + 20);130 分 → 134…150 共 5 次
  })
})

describe('Prices.ts 接線', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/web/background/Prices.ts'), 'utf8')
  it('不再常駐 setInterval;queuePricesFetch 先記查價時間、touch 定期更新,再立即 load()', () => {
    expect(src).not.toMatch(/\bsetInterval\(/)
    expect(src).toMatch(/createInterestRefresh\(\{\s*intervalMs: RETRY_INTERVAL_MS,\s*spanMs: INTEREST_SPAN_MS,/)
    expect(src).toMatch(/function queuePricesFetch \(\) \{\s*lastInterestTime = Date\.now\(\)\s*periodic\.touch\(lastInterestTime\)\s*void load\(\)\s*\}/)
  })
  it('節流常數不變:定期 4 分鐘、更新 31 分鐘、查價興趣 20 分鐘', () => {
    expect(src).toMatch(/const RETRY_INTERVAL_MS = 4 \* 60 \* 1000/)
    expect(src).toMatch(/const UPDATE_INTERVAL_MS = 31 \* 60 \* 1000/)
    expect(src).toMatch(/const INTEREST_SPAN_MS = 20 \* 60 \* 1000/)
  })
  it('PoE2 轉接層沒有自己的計時器', () => {
    for (const f of ['../src/web/background/poe2-price-source.ts', '../../poe2/src/web/background/Prices.ts']) {
      const s = fs.readFileSync(path.resolve(__dirname, f), 'utf8')
      expect(s).not.toMatch(/\bset(Interval|Timeout)\(/)
    }
  })
})
