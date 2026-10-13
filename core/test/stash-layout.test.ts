/**
 * 倉庫子頁版面(Exile-UI stash-ninja.ahk 座標表):版面資料、換算、命中判定。
 * oracle = 測試內獨立實作的 Exile-UI 原式(不讀 core/src/stash 實作)。
 * 實測基準:core/test/stash/annotations.json(使用者錄影,client 高 1432)。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STASH_SUBTABS, cellBox, cellGap, cellRects, hitCell, parseStashLayouts,
  type CellRect, type StashLayoutFile, type StashSubtab
} from '../src/stash/layout'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const RAW_LAYOUTS: unknown = JSON.parse(read('data/poe1/stash/layouts.json'))
const ANN = JSON.parse(read('core/test/stash/annotations.json')) as {
  clientH: number
  hover: Array<{ subtab: StashSubtab, x: number, y: number, name: string }>
  slots: Array<{ subtab: StashSubtab, refName: string, cx: number, cy: number }>
}

/** items.ndjson 的 ITEM:refName → name */
function itemNames (lang: 'en' | 'cmn-Hant'): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of read(`data/poe1/${lang}/items.ndjson`).split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line) as { name: string, refName: string, namespace: string }
    if (r.namespace === 'ITEM') m.set(r.refName, r.name)
  }
  return m
}

// ---- oracle:Exile-UI stash-ninja.ahk 原式 ----
function oBox (s: StashSubtab, h: number): number {
  return s === 'scarabs' ? Math.floor(h / 32) : s === 'general' ? Math.floor(h / 24) : Math.floor(h / 20)
}
function oGap (s: StashSubtab, h: number): number {
  return s === 'scarabs' ? Math.floor(h / 160) : s === 'general' ? Math.round(h / 72) : Math.round(h / 80)
}
function oRects (file: StashLayoutFile, s: StashSubtab, h: number, yOffset = 0): CellRect[] {
  const box = oBox(s, h)
  const gap = oGap(s, h)
  let px = 0
  let py = 0
  return file.subtabs[s].map(c => {
    // AHK x 先 Format("{:.10f}") 取 10 位小數再乘(124/1440 → 0.0861111111 × 1080 = 92.99… → 92)
    const x = c.x !== 0 ? Math.floor(Number((c.x / 1440).toFixed(10)) * h) : px + box + gap
    const y = c.y !== 0 ? Math.floor(c.y / 1440 * h) : py
    px = x
    py = y
    return { x, y: y + yOffset, w: box, h: box, refName: c.refName }
  })
}

const layouts = (): StashLayoutFile => parseStashLayouts(RAW_LAYOUTS)

describe('S1 版面資料', () => {
  it('三子頁每格 refName 在英繁 items.ndjson 都有、格數 60/115/8、子頁內不重複', () => {
    const file = layouts()
    expect([...STASH_SUBTABS]).toEqual(['general', 'scarabs', 'allflame'])
    const en = itemNames('en')
    const zh = itemNames('cmn-Hant')
    const counts = { general: 60, scarabs: 115, allflame: 8 }
    for (const s of STASH_SUBTABS) {
      const cells = file.subtabs[s]
      expect(cells.length, s).toBe(counts[s])
      const names = cells.map(c => c.refName)
      expect(new Set(names).size, `${s} 重複 refName`).toBe(names.length)
      const missEn = names.filter(n => !en.has(n))
      const missZh = names.filter(n => !zh.has(n))
      expect(missEn, `${s} en 缺`).toEqual([])
      expect(missZh, `${s} cmn-Hant 缺`).toEqual([])
    }
    expect(file.subtabs.scarabs.some(c => c.refName === 'Abyss Scarab of Descending')).toBe(true)
    expect(zh.get('Abyss Scarab of Descending')).toBe('聖甲蟲：落降深淵')
  })
})

describe('S2 實測格框', () => {
  it('1432 高度下格中心與錄影量到的中心兩軸差 ≤ 6 px', () => {
    const file = layouts()
    expect(ANN.clientH).toBe(1432)
    expect(ANN.slots.length).toBeGreaterThan(0)
    for (const sl of ANN.slots) {
      const r = cellRects(file, sl.subtab, 1432).find(c => c.refName === sl.refName)
      expect(r, sl.refName).toBeDefined()
      expect(Math.abs(r!.x + r!.w / 2 - sl.cx), `${sl.refName} x`).toBeLessThanOrEqual(6)
      expect(Math.abs(r!.y + r!.h / 2 - sl.cy), `${sl.refName} y`).toBeLessThanOrEqual(6)
    }
  })
})

describe('S3 換算與 Exile-UI 規則相同', () => {
  const HS = [1080, 1432, 1440, 2160]

  it('cellBox / cellGap 與原式相同', () => {
    for (const h of HS) {
      for (const s of STASH_SUBTABS) {
        expect(cellBox(s, h), `${s}@${h} box`).toBe(oBox(s, h))
        expect(cellGap(s, h), `${s}@${h} gap`).toBe(oGap(s, h))
      }
    }
  })

  it('四種高度 × 三子頁逐格與 oracle 完全相等', () => {
    const file = layouts()
    for (const h of HS) {
      for (const s of STASH_SUBTABS) {
        expect(cellRects(file, s, h), `${s}@${h}`).toEqual(oRects(file, s, h))
      }
    }
  })

  it('yOffset=47 時每格 y 剛好 +47、x 與大小不變', () => {
    const file = layouts()
    for (const s of STASH_SUBTABS) {
      const base = cellRects(file, s, 1432)
      const off = cellRects(file, s, 1432, 47)
      expect(off.length).toBe(base.length)
      off.forEach((r, i) => {
        expect(r).toEqual({ ...base[i], y: base[i].y + 47 })
      })
      expect(off).toEqual(oRects(file, s, 1432, 47))
    }
  })
})

describe('S4 錄影說明框', () => {
  it('滑鼠位置命中的格子繁中名 = 說明框標題', () => {
    const file = layouts()
    const zh = itemNames('cmn-Hant')
    expect(ANN.hover.length).toBeGreaterThan(0)
    for (const hv of ANN.hover) {
      const hit = hitCell(cellRects(file, hv.subtab, 1432), hv.x, hv.y)
      expect(hit, `${hv.name} 沒命中`).not.toBeNull()
      expect(zh.get(hit!.refName), `(${hv.x},${hv.y})`).toBe(hv.name)
    }
  })
})

describe('S4b hitCell 邊界', () => {
  it('左上角命中、右緣與下緣不命中、兩格間 gap 回 null', () => {
    const rects = cellRects(layouts(), 'general', 1440)
    // 找同一列相鄰兩格(第二格接續第一格)
    const i = rects.findIndex((r, k) => k > 0 && r.y === rects[k - 1].y && r.x > rects[k - 1].x)
    expect(i).toBeGreaterThan(0)
    const a = rects[i - 1]
    const b = rects[i]
    expect(b.x - (a.x + a.w)).toBeGreaterThan(0)
    expect(hitCell(rects, a.x, a.y)).toBe(a)
    expect(hitCell(rects, a.x + a.w - 1, a.y + a.h - 1)).toBe(a)
    expect(hitCell(rects, a.x + a.w, a.y)?.refName ?? null).not.toBe(a.refName)
    expect(hitCell(rects, a.x, a.y + a.h)?.refName ?? null).not.toBe(a.refName)
    const gx = a.x + a.w + Math.floor((b.x - a.x - a.w) / 2)
    expect(rects.some(r => gx >= r.x && gx < r.x + r.w && a.y + 1 >= r.y && a.y + 1 < r.y + r.h)).toBe(false)
    expect(hitCell(rects, gx, a.y + 1)).toBeNull()
    expect(hitCell(rects, -5, -5)).toBeNull()
  })

  it('單格:x+w 與 y+h 邊界不命中', () => {
    const r: CellRect = { x: 10, y: 20, w: 30, h: 30, refName: 'A' }
    expect(hitCell([r], 10, 20)).toBe(r)
    expect(hitCell([r], 39, 49)).toBe(r)
    expect(hitCell([r], 40, 20)).toBeNull()
    expect(hitCell([r], 10, 50)).toBeNull()
    expect(hitCell([], 10, 20)).toBeNull()
  })
})

describe('S4c parseStashLayouts 擋壞格式', () => {
  const good = (): any => ({
    schema: 1,
    base: 1440,
    buttons: { general: { x: 1, y: 1 }, scarabs: { x: 2, y: 0 }, allflame: { x: 3, y: 0 } },
    subtabs: {
      general: [{ x: 10, y: 10, refName: 'A' }, { x: 0, y: 0, refName: 'B' }],
      scarabs: [{ x: 10, y: 10, refName: 'C' }],
      allflame: [{ x: 10, y: 10, refName: 'D' }]
    }
  })

  it('合法最小檔可解析,真實資料也可解析', () => {
    expect(() => parseStashLayouts(good())).not.toThrow()
    expect(() => parseStashLayouts(RAW_LAYOUTS)).not.toThrow()
  })

  it('缺 subtabs 時 throw', () => {
    const f = good(); delete f.subtabs
    expect(() => parseStashLayouts(f)).toThrow()
  })

  it('某子頁不是陣列時 throw', () => {
    const f = good(); f.subtabs.scarabs = { x: 1 }
    expect(() => parseStashLayouts(f)).toThrow()
  })

  it('第一格 x 為 0 時 throw', () => {
    const f = good(); f.subtabs.allflame[0].x = 0
    expect(() => parseStashLayouts(f)).toThrow()
  })

  it('refName 非字串時 throw', () => {
    const f = good(); f.subtabs.general[1].refName = 42
    expect(() => parseStashLayouts(f)).toThrow()
  })

  it('非物件輸入 throw', () => {
    expect(() => parseStashLayouts(null)).toThrow()
    expect(() => parseStashLayouts('x')).toThrow()
  })
})
