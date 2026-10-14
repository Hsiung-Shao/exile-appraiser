// 倉庫價值除錯記錄(2026-10-15 使用者要求):標「?」的格子連同原因寫進記錄,判斷是數字判讀還是徽章遮擋。
import { describe, expect, it } from 'vitest'
import { stashUnreadSummary } from '../src/ocr/stash-scan'

const rects = [
  { x: 0, y: 0, w: 10, h: 10, refName: 'Scarab A' },
  { x: 0, y: 0, w: 10, h: 10, refName: 'Scarab B' },
  { x: 0, y: 0, w: 10, h: 10, refName: 'Scarab C' },
  { x: 0, y: 0, w: 10, h: 10, refName: 'Scarab D' }
]

describe('stashUnreadSummary', () => {
  it('全部讀到或空格時回空字串', () => {
    expect(stashUnreadSummary(rects, [3, 0, 12, 1], [{}, {}, {}, {}], new Set())).toBe('')
  })

  it('讀不到的格列出序號、物品、原因、讀到的字與分數', () => {
    const s = stashUnreadSummary(rects, [3, null, 12, null], [
      {},
      { why: { reason: 'low-confidence', raw: '49', confidence: 0.684, margin: 0.12 } },
      {},
      { why: { reason: 'missed-digit', raw: '8', confidence: 0.81, margin: 0.3 } }
    ], new Set())
    expect(s).toContain('#2 Scarab B 分數低(讀到 49,分數 0.68 / 差 0.12)')
    expect(s).toContain('#4 Scarab D 疑似漏讀一位(讀到 8,分數 0.81 / 差 0.30)')
    expect(s).not.toContain('Scarab A')
  })

  it('從沒讀到、正在等徽章收起的格標「被徽章遮住」', () => {
    const s = stashUnreadSummary(rects, [null, 2, 3, 4], [{}, {}, {}, {}], new Set([0]))
    expect(s).toBe('#1 Scarab A 被徽章遮住,等待重讀')
  })
})
