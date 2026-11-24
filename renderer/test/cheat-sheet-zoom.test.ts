/**
 * 2026-11-25 速查表:一次匯入多張、釘住後再放大(滾輪以游標為中心、拖曳移動、按鈕)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHEET_ZOOM_MAX, addSheetFiles, sheetPan, sheetZoomAt } from '../src/web/overlay/float-menu-geom'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const BOX = { w: 400, h: 300 }
const FIT = { scale: 1, x: 0, y: 0 }

describe('放大縮放', () => {
  // 失敗代表:放大後游標下的那一點跑掉(使用者要找的格子被推出畫面)
  it('滾輪放大時游標下的點不動', () => {
    const at = { x: 100, y: 50 }
    const v = sheetZoomAt(FIT, 2, at, BOX)
    expect(v.scale).toBe(2)
    expect(((at.x - v.x) / v.scale)).toBeCloseTo(100)
    expect(((at.y - v.y) / v.scale)).toBeCloseTo(50)
  })

  // 失敗代表:縮到比整張圖還小(圖縮成一小塊),或放大沒有上限
  it('倍率夾在 1 到上限之間,回到 1 時位置歸零', () => {
    expect(sheetZoomAt(FIT, 0.5, { x: 10, y: 10 }, BOX)).toEqual(FIT)
    expect(sheetZoomAt({ scale: 6, x: -100, y: -100 }, 10, { x: 0, y: 0 }, BOX).scale).toBe(SHEET_ZOOM_MAX)
    expect(sheetZoomAt({ scale: 2, x: -150, y: -80 }, 0.5, { x: 200, y: 150 }, BOX)).toEqual(FIT)
  })

  // 失敗代表:拖曳能把圖拖出框外露出空白
  it('拖曳移動夾在圖的範圍內', () => {
    const v = { scale: 2, x: -100, y: -100 }
    expect(sheetPan(v, 1000, 1000, BOX)).toEqual({ scale: 2, x: 0, y: 0 })
    expect(sheetPan(v, -1000, -1000, BOX)).toEqual({ scale: 2, x: -400, y: -300 })
    expect(sheetPan(v, 30, -20, BOX)).toEqual({ scale: 2, x: -70, y: -120 })
    // 沒放大時不能拖
    expect(sheetPan(FIT, 50, 50, BOX)).toEqual(FIT)
  })
})

// 審查 2026-11-25:圖片 object-fit: contain,框比圖高時上下有留白;夾的是圖實際畫出的範圍,不是 img 元素
describe('留白(object-fit: contain)', () => {
  const WIDE = { w: 400, h: 300, cw: 400, ch: 100 } // 圖畫成 400×100,上下各留 100
  // 失敗代表:放大後能把圖拖到只剩留白(使用者看到一片黑)
  it('放大後上下不能拖出留白,圖比框小的方向置中', () => {
    const v = sheetZoomAt(FIT, 2, { x: 200, y: 150 }, WIDE) // 圖高 200 < 框高 300 → 垂直置中
    expect(v.y).toBeCloseTo((300 - 100 * 2) / 2 - 100 * 2)
    expect(sheetPan(v, 0, 500, WIDE).y).toBeCloseTo(v.y)
    const v4 = sheetZoomAt(FIT, 4, { x: 200, y: 150 }, WIDE) // 圖高 400 > 框高 300
    expect(sheetPan(v4, 0, 9999, WIDE).y).toBeCloseTo(-100 * 4) // 圖上緣對齊框上緣
    expect(sheetPan(v4, 0, -9999, WIDE).y).toBeCloseTo(300 - 200 * 4) // 圖下緣對齊框下緣
  })
})

describe('一次匯入多張', () => {
  // 失敗代表:選了多張只加進一張,或重複加
  it('全部加進清單、去重,目前顯示最後一張', () => {
    expect(addSheetFiles(['a.png'], ['b.png', 'a.png', 'c.png'])).toEqual({ list: ['a.png', 'b.png', 'c.png'], current: 'c.png' })
  })
  // 失敗代表:清單超過上限,或超過時丟掉的是剛匯入的
  it('超過 20 張時保留最新的', () => {
    const old = Array.from({ length: 19 }, (_, i) => `o${i}.png`)
    const r = addSheetFiles(old, ['n1.png', 'n2.png', 'n3.png'])
    expect(r.list).toHaveLength(20)
    expect(r.list.slice(-3)).toEqual(['n1.png', 'n2.png', 'n3.png'])
    expect(r.current).toBe('n3.png')
  })
  it('沒有選檔 = 不變', () => {
    expect(addSheetFiles(['a.png'], [])).toEqual({ list: ['a.png'], current: null })
  })
})

describe('接線', () => {
  // 失敗代表:對話框仍是單選,或背景圖也變成可多選
  it('速查表對話框可多選,背景圖仍單選', () => {
    const main = read('main/src/main.ts')
    expect(main).toMatch(/'sheet-pick': \{\s+kind: 'invoke',\s+preview: false,\s+fn: \(_ctx, keep: unknown\) => pickImagesInto\(SHEET_DIR\(\), 'sheet', 'Cheat sheet image', [^\n]*, true\)/)
    expect(main).toMatch(/multi \? \['openFile', 'multiSelections'\]/)
    expect(main).toMatch(/'bg-pick'[\s\S]{0,200}pickImagesInto\(BG_DIR\(\), 'bg'[^\n]*\)\)\[0\] \?\? null/)
  })
  it('選單用滾輪 / 拖曳 / 按鈕放大', () => {
    const m = read('renderer/src/web/overlay/FloatMenu.vue')
    expect(m).toContain('@wheel.prevent="onSheetWheel"')
    for (const a of ['sheet-zoom-out', 'sheet-zoom-in', 'sheet-zoom-fit']) expect(m).toContain(`data-action="${a}"`)
    expect(m).toContain('addSheetFiles(config.cheatSheets, ')
  })
  it('字串兩語', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz.menu
      for (const k of ['sheet_zoom_in', 'sheet_zoom_out', 'sheet_zoom_fit']) expect(typeof j[k], `${lang} ${k}`).toBe('string')
    }
  })
})
