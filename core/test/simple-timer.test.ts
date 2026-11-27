// 簡易計時器(碼表 / 倒數)與提醒點判斷。自訂時鐘,純函式。
import { describe, expect, it } from 'vitest'
import { alertCrossed, createSimpleTimer } from '../src/timer/simple'

const clock = () => {
  let t = 5_000_000
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('碼表', () => {
  it('T6 開始 → 暫停不累計 → 繼續 → 重設歸零回 idle', () => {
    const c = clock()
    const tm = createSimpleTimer(c.now)
    expect(tm.phase).toBe('idle')
    tm.start(null)
    expect(tm.phase).toBe('running')
    expect(tm.durationMs).toBeNull()
    expect(tm.remaining()).toBeNull()
    c.advance(3_000)
    expect(tm.elapsed()).toBe(3_000)
    tm.pause()
    expect(tm.phase).toBe('paused')
    c.advance(5_000)
    expect(tm.elapsed()).toBe(3_000)
    tm.resume()
    c.advance(2_000)
    expect(tm.elapsed()).toBe(5_000)
    tm.reset()
    expect(tm.phase).toBe('idle')
    expect(tm.elapsed()).toBe(0)
  })

  it('T6 碼表 check() 永遠 false(不會自己結束)', () => {
    const c = clock()
    const tm = createSimpleTimer(c.now)
    tm.start(null)
    c.advance(10_000_000)
    expect(tm.check()).toBe(false)
    expect(tm.phase).toBe('running')
  })
})

describe('倒數', () => {
  it('T7 歸零:check() 只在轉換那次回 true,之後 finished、剩 0、elapsed 停在 duration', () => {
    const c = clock()
    const tm = createSimpleTimer(c.now)
    tm.start(5_000)
    c.advance(4_000)
    expect(tm.check()).toBe(false)
    expect(tm.remaining()).toBe(1_000)
    c.advance(2_000)
    expect(tm.check()).toBe(true)
    expect(tm.check()).toBe(false)
    expect(tm.remaining()).toBe(0)
    expect(tm.phase).toBe('finished')
    expect(tm.elapsed()).toBe(5_000)
    c.advance(60_000)
    expect(tm.elapsed()).toBe(5_000)
  })

  it('T7 finished 後可重新 start,從 0 開始', () => {
    const c = clock()
    const tm = createSimpleTimer(c.now)
    tm.start(1_000)
    c.advance(2_000)
    tm.check()
    tm.start(3_000)
    expect(tm.phase).toBe('running')
    expect(tm.elapsed()).toBe(0)
    expect(tm.remaining()).toBe(3_000)
  })

  it('T7 暫停中不倒數', () => {
    const c = clock()
    const tm = createSimpleTimer(c.now)
    tm.start(10_000)
    c.advance(2_000)
    tm.pause()
    c.advance(60_000)
    expect(tm.check()).toBe(false)
    expect(tm.remaining()).toBe(8_000)
  })
})

describe('alertCrossed', () => {
  it('T8 跨過提醒點才響一次;沒跨過 false;interval 0 永遠 false', () => {
    expect(alertCrossed(59_000, 61_000, 60_000)).toBe(true)
    expect(alertCrossed(61_000, 62_000, 60_000)).toBe(false)
    expect(alertCrossed(0, 59_999, 60_000)).toBe(false)
    expect(alertCrossed(0, 200_000, 0)).toBe(false)
    expect(alertCrossed(59_000, 61_000, -1)).toBe(false)
  })
})
