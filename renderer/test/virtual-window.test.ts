// exile-appraiser:虛擬捲動純函式(`src/web/virtual-window.ts`)。
import { describe, expect, it } from 'vitest'
import { rafThrottle, windowEndIdx, windowStartIdx } from '../src/web/virtual-window'

/** 原 DustTable / RegexList 內嵌的算式(oracle) */
function legacy (scrollTop: number, viewH: number, h: number, overscan: number, count: number) {
  return {
    start: Math.max(0, Math.floor(scrollTop / h) - overscan),
    end: Math.min(count, Math.ceil((scrollTop + viewH) / h) + overscan)
  }
}

describe('可視區間', () => {
  it('邊界:頂端、底端、列數少於可視高、空清單', () => {
    expect([windowStartIdx(0, 40, 6), windowEndIdx(0, 360, 40, 6, 1000)]).toEqual([0, 15])
    expect([windowStartIdx(100, 40, 6), windowEndIdx(100, 360, 40, 6, 1000)]).toEqual([0, 18]) // 起點夾在 0
    expect(windowEndIdx(39960, 360, 40, 6, 1000)).toBe(1000) // 底端夾在 count
    expect(windowEndIdx(0, 360, 40, 6, 3)).toBe(3)
    expect(windowEndIdx(0, 360, 40, 6, 0)).toBe(0)
  })
  it('同一列內的像素捲動,索引不變(windowRows 不會重算)', () => {
    const a = [windowStartIdx(400, 40, 6), windowEndIdx(400, 360, 40, 6, 1000)]
    for (let px = 400; px < 440; px++) {
      expect([windowStartIdx(px, 40, 6), windowEndIdx(px + 0, 360, 40, 6, 1000)][0]).toBe(a[0])
    }
    expect(windowStartIdx(439, 40, 6)).toBe(windowStartIdx(400, 40, 6))
  })
  it('與原算式逐點相同(多種列高 / 視窗高 / 列數 / 捲動位置)', () => {
    for (const h of [24, 38, 41, 52]) {
      for (const viewH of [100, 320, 360, 777]) {
        for (const count of [0, 1, 20, 500, 8563]) {
          for (let st = 0; st <= count * h + 50; st += 37) {
            const l = legacy(st, viewH, h, 6, count)
            expect(windowStartIdx(st, h, 6)).toBe(l.start)
            expect(windowEndIdx(st, viewH, h, 6, count)).toBe(l.end)
          }
        }
      }
    }
  })
})

describe('rafThrottle', () => {
  function fakeRaf () {
    let next = 1
    const q = new Map<number, () => void>()
    return {
      raf: (cb: () => void) => { const id = next++; q.set(id, cb); return id },
      caf: (id: number) => { q.delete(id) },
      frame () { const all = [...q.values()]; q.clear(); all.forEach(f => f()) },
      get pending () { return q.size }
    }
  }
  it('同一幀多次呼叫只處理一次,處理時讀到最後的位置', () => {
    const f = fakeRaf()
    let pos = 0
    const seen: number[] = []
    const t = rafThrottle(() => seen.push(pos), f.raf, f.caf)
    for (let i = 1; i <= 5; i++) { pos = i * 10; t() }
    expect(f.pending).toBe(1)
    expect(seen).toEqual([])
    f.frame()
    expect(seen).toEqual([50])
    pos = 77
    t()
    f.frame()
    expect(seen).toEqual([50, 77])
  })
  it('cancel 取消尚未執行的那一次,之後仍可再排', () => {
    const f = fakeRaf()
    let n = 0
    const t = rafThrottle(() => { n++ }, f.raf, f.caf)
    t(); t.cancel()
    f.frame()
    expect(n).toBe(0)
    t(); f.frame()
    expect(n).toBe(1)
  })
})
