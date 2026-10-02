// exile-appraiser 效能修正第 18 步:renderer 回報畫在遊戲上的東西(overlay/scan-mask.ts)。
// 量直接子元素的外框(CSS px)+ 視窗大小;同一份不重送,但每個掃描事件的 ack(seq)一定送。
import { describe, expect, it } from 'vitest'
import type { ScanMaskReport } from '@ipc/types'
import { createResendTracker, createScanMaskReporter, elementBoxes, reportWithAck, type MeasurableElement } from '../src/web/overlay/scan-mask'

const el = (left: number, top: number, width: number, height: number): MeasurableElement => ({ getBoundingClientRect: () => ({ left, top, width, height }) })
const layer = (...children: MeasurableElement[]) => ({ children })

describe('elementBoxes', () => {
  it('外框取兩位小數;沒畫出來(寬或高 0)的略過', () => {
    expect(elementBoxes([el(10.123, 20.456, 100.5, 18), el(0, 0, 0, 10), el(5, 5, 10, 0)])).toEqual([{ x: 10.12, y: 20.46, w: 100.5, h: 18 }])
  })
})

describe('createResendTracker(code review 第 B 批)', () => {
  it('沒處理的 rows(資料未載好)→ 資料載好時要 resend 一次;之後不再送', () => {
    const t = createResendTracker()
    expect(t.dataChanged(false)).toBe(false)
    t.missed()
    t.missed()
    expect(t.pending).toBe(true)
    expect(t.dataChanged(false)).toBe(true)
    expect(t.dataChanged(false)).toBe(false)
  })
  it('畫面上有徽章(舊資料算的)時資料世代改變 → resend', () => {
    const t = createResendTracker()
    expect(t.dataChanged(true)).toBe(true)
  })
})

describe('createScanMaskReporter', () => {
  function setup () {
    const sent: ScanMaskReport[] = []
    const vp = { w: 1600, h: 900 }
    const r = createScanMaskReporter('reveal', x => { sent.push(x) }, () => vp)
    return { sent, vp, r }
  }

  it('送外框 + 視窗大小;內容相同不重送;內容變了 / 視窗大小變了照送', () => {
    const { sent, vp, r } = setup()
    expect(r.report(layer(el(800, 100, 200, 30), el(800, 140, 200, 30)))).toBe(true)
    expect(sent[0]).toEqual({ source: 'reveal', viewport: { w: 1600, h: 900 }, rects: [{ x: 800, y: 100, w: 200, h: 30 }, { x: 800, y: 140, w: 200, h: 30 }] })
    expect(r.report(layer(el(800, 100, 200, 30), el(800, 140, 200, 30)))).toBe(false)
    expect(r.report(layer(el(800, 100, 200, 30)))).toBe(true)
    vp.w = 1280
    expect(r.report(layer(el(800, 100, 200, 30)))).toBe(true)
    expect(sent).toHaveLength(3)
  })

  it('每個掃描事件的 seq(ack)一定送,即使外框沒變;同一個 seq 不重送', () => {
    const { sent, r } = setup()
    r.report(layer(el(1, 1, 1, 1)))
    expect(r.report(layer(el(1, 1, 1, 1)), 7)).toBe(true)
    expect(sent[1].seq).toBe(7)
    expect(r.report(layer(el(1, 1, 1, 1)), 7)).toBe(false)
    expect(r.report(layer(el(1, 1, 1, 1)), 8)).toBe(true)
  })

  it('這層沒畫東西(null)= 空陣列;清掉後同一份再出現照送;reset 後一定送', () => {
    const { sent, r } = setup()
    r.report(layer(el(1, 1, 5, 5)))
    expect(r.report(null)).toBe(true)
    expect(sent[1].rects).toEqual([])
    expect(r.report(null)).toBe(false)
    expect(r.report(layer(el(1, 1, 5, 5)))).toBe(true)
    r.reset()
    expect(r.report(layer(el(1, 1, 5, 5)))).toBe(true)
  })

  it('code review 第 B 批:resend 一定送(內容 / seq 都沒變也送)並帶 resend: true;一般回報不帶', () => {
    const { sent, r } = setup()
    r.report(layer(el(1, 1, 5, 5)), 3)
    expect(sent[0].resend).toBeUndefined()
    expect(r.report(layer(el(1, 1, 5, 5)), 3)).toBe(false)
    expect(r.report(layer(el(1, 1, 5, 5)), undefined, true)).toBe(true)
    expect(sent[1]).toEqual({ source: 'reveal', viewport: { w: 1600, h: 900 }, rects: [{ x: 1, y: 1, w: 5, h: 5 }], resend: true })
    expect(r.report(layer(el(1, 1, 5, 5)))).toBe(false)
  })

  it('視窗大小不合法(0)不送', () => {
    const sent: ScanMaskReport[] = []
    const r = createScanMaskReporter('rune', x => { sent.push(x) }, () => ({ w: 0, h: 0 }))
    expect(r.report(layer(el(1, 1, 5, 5)), 3)).toBe(false)
    expect(sent).toHaveLength(0)
  })
})

describe('reportWithAck:字型還在載入時,等載完重量才 ack', () => {
  it('沒有字型在載入:先送外框、再送同一份帶 seq', async () => {
    const sent: ScanMaskReport[] = []
    const r = createScanMaskReporter('reveal', x => { sent.push(x) }, () => ({ w: 100, h: 100 }))
    await reportWithAck(r, () => layer(el(1, 1, 10, 5)), 4, { status: 'loaded', ready: Promise.resolve() })
    expect(sent.map(x => [x.seq, x.rects[0].w])).toEqual([[undefined, 10], [4, 10]])
  })

  it('量的時候觸發字型載入:ack 那份是字型載完(+ beforeAck 重排)後的新外框', async () => {
    const sent: ScanMaskReport[] = []
    const r = createScanMaskReporter('reveal', x => { sent.push(x) }, () => ({ w: 100, h: 100 }))
    let width = 10
    let done!: () => void
    const fonts = { status: 'loading', ready: new Promise<void>(res => { done = res }) }
    const order: string[] = []
    const p = reportWithAck(r, () => layer(el(1, 1, width, 5)), 9, fonts, () => { order.push('restack') })
    await Promise.resolve()
    expect(sent.map(x => x.seq)).toEqual([undefined])
    width = 31
    fonts.status = 'loaded'
    done()
    await p
    expect(order).toEqual(['restack'])
    expect(sent.map(x => [x.seq, x.rects[0].w])).toEqual([[undefined, 10], [9, 31]])
  })
})
