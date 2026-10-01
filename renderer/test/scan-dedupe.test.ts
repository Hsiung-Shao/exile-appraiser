// 效能修正第 6 步:renderer 端「與目前畫著的結果相同就不重算」的鍵與閘門(OcrBadges.vue / RuneshapePrices.vue 用)
import { describe, expect, it } from 'vitest'
import { bumpDataGeneration, createScanResultGate, dataGeneration, scanResultKey } from '../src/web/overlay/scan-dedupe'

const ROWS = [
  { text: '1x 崇高石', x: 1010.2, y: 300.4, w: 90, h: 20 },
  { text: '3x 富豪石', x: 1010, y: 355, w: 90.4, h: 20 }
]
const CLIENT = { w: 2000, h: 1000 }

describe('scanResultKey', () => {
  it('列文字 + 四捨五入座標 + client + extra;次像素抖動算同一份', () => {
    const a = scanResultKey(ROWS, CLIENT, 'poe2|0')
    expect(scanResultKey(ROWS.map(r => ({ ...r, x: r.x + 0.2 })), CLIENT, 'poe2|0')).toBe(a)
    expect(scanResultKey(ROWS.map(r => ({ ...r, y: r.y + 1 })), CLIENT, 'poe2|0')).not.toBe(a)
    expect(scanResultKey([{ ...ROWS[0], text: '1x 崇高石石' }, ROWS[1]], CLIENT, 'poe2|0')).not.toBe(a)
    expect(scanResultKey(ROWS, { w: 2560, h: 1440 }, 'poe2|0')).not.toBe(a)
    expect(scanResultKey(ROWS, CLIENT, 'poe2|1')).not.toBe(a)
    expect(scanResultKey(ROWS.slice(0, 1), CLIENT, 'poe2|0')).not.toBe(a)
  })
  it('資料集世代 +1 → 鍵不同(換資料後同一份列要重比)', () => {
    const before = scanResultKey(ROWS, CLIENT, `poe2|${dataGeneration.value}`)
    bumpDataGeneration()
    expect(scanResultKey(ROWS, CLIENT, `poe2|${dataGeneration.value}`)).not.toBe(before)
  })
})

describe('createScanResultGate(元件的處理流程)', () => {
  /** 模擬元件:有列的事件 → 鍵相同且結果還畫著就跳過,否則重新比對(計數)並畫上;清除 → reset */
  function component () {
    const gate = createScanResultGate()
    let showing = false
    let matches = 0
    return {
      onRows (rows: typeof ROWS, extra = 'poe2|0') {
        const key = scanResultKey(rows, CLIENT, extra)
        if (gate.repeat(key, showing)) return
        gate.remember(key)
        matches++
        showing = true
      },
      clear () { gate.reset(); showing = false },
      get matches () { return matches }
    }
  }
  it('同一份列連續到:只比對一次;內容變了再比', () => {
    const c = component()
    c.onRows(ROWS)
    c.onRows(ROWS)
    c.onRows(ROWS.map(r => ({ ...r, x: r.x + 0.2 })))
    expect(c.matches).toBe(1)
    c.onRows([{ ...ROWS[0], text: '2x 崇高石' }, ROWS[1]])
    expect(c.matches).toBe(2)
    c.onRows(ROWS)
    expect(c.matches).toBe(3)
  })
  it('畫面被清掉(empty / Esc / 框選層)後同一份列照常重畫', () => {
    const c = component()
    c.onRows(ROWS)
    c.clear()
    c.onRows(ROWS)
    expect(c.matches).toBe(2)
  })
  it('會影響比對的輸入(profile 提示 / fallback / 遊戲)不同 → 重比', () => {
    const c = component()
    c.onRows(ROWS, '0|Body Armour|poe2|0')
    c.onRows(ROWS, '1|Body Armour|poe2|0')
    c.onRows(ROWS, '1||poe2|0')
    expect(c.matches).toBe(3)
  })
  it('沒畫著(showing 為假)時一律不跳過', () => {
    const gate = createScanResultGate()
    gate.remember('k')
    expect(gate.repeat('k', false)).toBe(false)
    expect(gate.repeat('k', true)).toBe(true)
    gate.reset()
    expect(gate.repeat('k', true)).toBe(false)
  })
})
