/**
 * 超寬螢幕黑邊:遊戲畫面比 2.4:1(12:5)寬時 PoE 左右補黑邊,倉庫面板貼著遊戲畫面左緣 → 整體右移黑邊寬
 * (Exile-UI screen-checks.ahk:oGamescreen = (w − h / (5/12)) / 2)。使用者 2026-11-09 截圖:2000×562 視窗、遊戲畫面約 1350 寬。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUBTAB_LABELS, buttonRects, defaultStripRegion, findSubtabButtons, stripRect, stripZone, type TextLine } from '../src/stash/detect'
import { cellRects, parseStashLayouts, stashLeft } from '../src/stash/layout'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LAYOUTS = parseStashLayouts(JSON.parse(fs.readFileSync(path.resolve(HERE, '../../data/poe1/stash/layouts.json'), 'utf8')))

/** 3.30 三顆按鈕文字放在各槽中心、文字中心 y 201/1440(不帶黑邊) */
function buttonLines (h: number): TextLine[] {
  return buttonRects(h).map((r, k) => ({ text: SUBTAB_LABELS.zh[k], x: r.x + r.w / 2 - 15, y: 201 / 1440 * h - 8, w: 30, h: 16 }))
}

const H = 1432
const W = 5120
const X0 = stashLeft(W, H)

describe('黑邊寬 stashLeft', () => {
  it('不超過 2.4:1 時為 0(16:9、21:9、2.4:1)', () => {
    expect(stashLeft(2560, 1440)).toBe(0)
    expect(stashLeft(3440, 1440)).toBe(0)
    expect(stashLeft(3456, 1440)).toBe(0)
    expect(stashLeft(1432, 2012)).toBe(0)
  })
  it('32:9 為 (寬 − 高 × 2.4) / 2', () => {
    expect(stashLeft(5120, 1440)).toBe(832)
    // 使用者截圖(縮小過):黑邊約 325
    expect(Math.abs(stashLeft(2000, 562) - 325)).toBeLessThanOrEqual(2)
  })
})

describe('版面與按鈕列跟著黑邊右移', () => {
  it('cellRects 每格 x 加上 x0、其餘不變', () => {
    const a = cellRects(LAYOUTS, 'general', H, 0)
    const b = cellRects(LAYOUTS, 'general', H, 0, X0)
    expect(b).toEqual(a.map(r => ({ ...r, x: r.x + X0 })))
  })
  it('stripRect / buttonRects 加上 x0', () => {
    expect(stripRect(H, X0)).toEqual({ ...stripRect(H), x: X0 })
    expect(buttonRects(H, 47, X0)).toEqual(buttonRects(H, 47).map(r => ({ ...r, x: r.x + X0 })))
  })
  it('stripZone / defaultStripRegion 自己依 client 寬算黑邊', () => {
    expect(stripZone(W, H)).toEqual({ ...stripZone(2546, H), x: X0 })
    const d = defaultStripRegion(W, H)
    expect(d.x * W).toBeCloseTo(X0, 6)
  })
  it('按鈕文字右移 x0:帶 x0 找得到、不帶找不到', () => {
    const lines = buttonLines(H).map(l => ({ ...l, x: l.x + X0 }))
    expect(findSubtabButtons(lines, H, 'zh').found).toBe(false)
    expect(findSubtabButtons(lines, H, 'zh', X0).found).toBe(true)
  })
})
