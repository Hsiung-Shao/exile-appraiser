/**
 * 超寬螢幕黑邊:遊戲畫面比 2.4:1(12:5)寬時 PoE 左右補黑邊,倉庫面板貼著遊戲畫面左緣 → 整體右移黑邊寬
 * (Exile-UI screen-checks.ahk:oGamescreen = (w − h / (5/12)) / 2)。使用者 2026-11-09 截圖:2000×562 視窗、遊戲畫面約 1350 寬。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultStashRegion, stashSearchClientRect } from '../src/stash/detect'
import { cellRects, parseStashLayouts, stashLeft } from '../src/stash/layout'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LAYOUTS = parseStashLayouts(JSON.parse(fs.readFileSync(path.resolve(HERE, '../../data/poe1/stash/layouts.json'), 'utf8')))

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

describe('版面與搜尋範圍跟著黑邊右移', () => {
  it('cellRects 每格 x 加上 x0、其餘不變', () => {
    const a = cellRects(LAYOUTS, 'general', H, 0)
    const b = cellRects(LAYOUTS, 'general', H, 0, X0)
    expect(b).toEqual(a.map(r => ({ ...r, x: r.x + X0 })))
  })
  it('預設搜尋範圍從「黑邊 − 5% 高」起、涵蓋整個格子區(含資料夾下移 47)', () => {
    const s = stashSearchClientRect({ w: W, h: H })
    expect(s.x).toBe(Math.floor(X0 - H * 0.05))
    for (const yOff of [0, Math.floor(47 / 1440 * H)]) {
      for (const r of cellRects(LAYOUTS, 'general', H, yOff, X0)) {
        expect(r.x >= s.x && r.y >= s.y && r.x + r.w <= s.x + s.w && r.y + r.h <= s.y + s.h, `${r.refName} ${yOff}`).toBe(true)
      }
    }
  })
  it('defaultStashRegion = 預設搜尋範圍的 client 比例', () => {
    const s = stashSearchClientRect({ w: W, h: H })
    const d = defaultStashRegion(W, H)
    expect([d.x * W, d.y * H, d.w * W, d.h * H].map(v => Math.round(v))).toEqual([s.x, s.y, s.w, s.h])
  })
  it('使用者框的區域外擴 10%、夾在畫面內', () => {
    expect(stashSearchClientRect({ w: 1000, h: 1000 }, { x: 0.1, y: 0.2, w: 0.5, h: 0.5 })).toEqual({ x: 50, y: 150, w: 600, h: 600 })
    expect(stashSearchClientRect({ w: 1000, h: 1000 }, { x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1000, h: 1000 })
  })
})
