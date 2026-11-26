/**
 * 3.30 倉庫碎片頁改版:「一般」52 格、新增「綢帶」10 格(子頁按鈕的 OCR 偵測 2026-11-26 已改成格子擬合,按鈕測試移除)。
 * 只依規格寫(不讀 layout.ts 實作);座標與公式在測試內獨立算(1440 基準)。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cellRects, parseStashLayouts } from '../src/stash/layout'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

interface RawCell { x: number, y: number, refName: string }
interface RawLayouts { buttons: Record<string, { x: number, y: number }>, subtabs: Record<string, RawCell[]> }
const RAW = JSON.parse(read('data/poe1/stash/layouts.json')) as RawLayouts

const THREAD_NAMES = [
  'Ultimatum Thread', 'Ritual Thread', 'Legion Thread', 'Incursion Thread', 'Expedition Thread',
  'Breach Thread', 'Blight Thread', 'Betrayal Thread', 'Bestiary Thread', 'Abyss Thread'
]

describe('T1 3.30 一般頁版面資料', () => {
  it('一般頁 52 格且 (154,676) 是黑帆船、舊的獻祭 / 悲痛不在', () => {
    const general = RAW.subtabs.general
    // 沒換成 3.30 版面(還是 3.29 的格數 / 順序)→ 格子價格全錯位
    expect(general).toHaveLength(52)
    expect(general[0]).toEqual({ x: 288, y: 266, refName: "Veritania's Crest" })
    const names = general.map(c => c.refName)
    for (const gone of [
      'Sacrifice at Dusk', 'Sacrifice at Midnight', 'Sacrifice at Dawn', 'Sacrifice at Noon',
      'Mortal Grief', 'Mortal Rage', 'Mortal Hope', 'Mortal Ignorance', 'Divine Vessel'
    ]) {
      // 3.30 移除的碎片還留在版面 → 徽章疊在別的物品上
      expect(names, gone).not.toContain(gone)
    }
    expect(general.find(c => c.x === 154 && c.y === 676)?.refName).toBe('The Black Barya')
  })
  it('按鈕座標:一般 (202,186)、綢帶 (368,186)', () => {
    expect(RAW.buttons.general).toEqual({ x: 202, y: 186 })
    expect(RAW.buttons.threads).toEqual({ x: 368, y: 186 })
  })
})

describe('T2 綢帶頁 10 格位置與物品', () => {
  it('10 格、順序與接續規則換算正確(1440 基準,box 72 / gap 20)', () => {
    // 先用原始資料斷言,避免版面還沒有 threads 時拋的不是斷言錯誤
    expect(RAW.subtabs.threads).toHaveLength(10)
    const rects = cellRects(parseStashLayouts(RAW), 'threads', 1440)
    expect(rects).toHaveLength(10)
    expect(rects.map(r => r.refName)).toEqual(THREAD_NAMES)
    // x 照 Exile-UI AHK「先取 10 位小數再乘」:226 → 225.99… → 225、500 → 499(既有 stash-layout 測試鎖同一規則)
    expect(rects[0]).toMatchObject({ x: 225, y: 512, w: 72, h: 72 })
    // x = 前一格 + box + gap(72 + 20)
    expect(rects[1].x).toBe(225 + 72 + 20)
    // Incursion / Bestiary 是 x:500 y:接續;Breach 起換到 y:620
    const want: Array<[number, number]> = [
      [225, 512], [317, 512], [409, 512], [499, 512], [591, 512],
      [225, 620], [317, 620], [409, 620], [499, 620], [591, 620]
    ]
    expect(rects.map(r => [r.x, r.y])).toEqual(want)
    expect(rects[5].refName).toBe('Breach Thread')
    expect(rects[5].y).toBe(Math.floor(620 / 1440 * 1440))
  })
  it('換算到 1080 高:box = floor(h/20)、gap = round(h/72)', () => {
    expect(RAW.subtabs.threads).toHaveLength(10)
    const h = 1080
    const rects = cellRects(parseStashLayouts(RAW), 'threads', h)
    const box = Math.floor(h / 20)
    const gap = Math.round(h / 72)
    expect(rects[0]).toMatchObject({ x: Math.floor(226 / 1440 * h), y: Math.floor(512 / 1440 * h), w: box, h: box })
    expect(rects[1].x).toBe(rects[0].x + box + gap)
  })
  it('一般頁格子邊長仍是 floor(h/24)', () => {
    const rects = cellRects(parseStashLayouts(RAW), 'general', 1440)
    expect(rects[0]).toMatchObject({ x: 288, y: 266, w: 60, h: 60 })
  })
})

describe('T3 版面名稱都對得到 refName', () => {
  it('一般 + 綢帶每個 refName 在 en/items.ndjson 有 ITEM 列', () => {
    const items = new Set<string>()
    for (const l of read('data/poe1/en/items.ndjson').split('\n')) {
      if (!l.trim()) continue
      const r = JSON.parse(l) as { refName: string, namespace: string }
      if (r.namespace === 'ITEM') items.add(r.refName)
    }
    expect(RAW.subtabs.threads?.length).toBe(10)
    const missing = [...(RAW.subtabs.general ?? []), ...(RAW.subtabs.threads ?? [])].map(c => c.refName).filter(n => !items.has(n))
    // 名稱對不上 → renderer 查不到價格(徽章「無價」)
    expect(missing).toEqual([])
  })
})

// ---- 合成 OCR 行(1440 高;獨立公式) ----
