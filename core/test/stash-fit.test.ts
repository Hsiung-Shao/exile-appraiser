/**
 * 倉庫碎片頁格位擬合(core/src/stash/fit.ts)F1–F9。
 * 只依規格寫:格位方框每格都畫(數量 0 也畫),函式搜尋格長與位移,讓版面表預測的格子落在方框上。
 * 真值格框由舊公式算出,與實際格位可能差 2–5 px → 比對容差一律 ≤ 5 px。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp, { type Color, type Sharp } from 'sharp'
import { fitStashGrid, minFitScore, scoreGrid, type GrayImage } from '../src/stash/fit'
import { defaultStashRegion, isLegacyStashRegion, stashSearchClientRect } from '../src/stash/detect'
import { cellRects, parseStashLayouts, type CellRect, type StashLayoutFile } from '../src/stash/layout'
import { layout329 } from './stash/layout-329'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIX = path.join(ROOT, 'core/test/stash/fixtures')
const TOL = 5
const T = 60_000

type Box = { x: number, y: number, w: number, h: number }
const LAYOUT_330: StashLayoutFile = parseStashLayouts(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/layouts.json'), 'utf8')))
const LAYOUT_329 = layout329()

const NATIVE = JSON.parse(fs.readFileSync(path.join(FIX, 'qty-native/truth.json'), 'utf8')) as {
  sets: Array<{ tab: string, file: string, cells: Array<{ rect: Box, truth: number }> }>
}
const SET_330 = NATIVE.sets.find(s => s.tab === 'general330')!
const TRUTH_330: Box[] = SET_330.cells.map(c => c.rect)
const FILE_330 = path.join(FIX, 'qty-native', SET_330.file)
const FILE_1125 = path.join(FIX, 'qty/general-1125.png')
const FILE_NEG = path.join(FIX, 'ocr/neg-grid-1432.png')

async function toGray (s: Sharp): Promise<GrayImage> {
  const { data, info } = await s.removeAlpha().greyscale().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true })
  if (info.channels !== 1) throw new Error(`灰階轉換失敗:channels = ${info.channels}`)
  return { gray: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height }
}

function median (g: GrayImage): number {
  const hist = new Array<number>(256).fill(0)
  for (const v of g.gray) hist[v]++
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= g.gray.length / 2) return v
  }
  return 0
}

const bg = (v: number): Color => ({ r: v, g: v, b: v, alpha: 1 })

/** 與真值逐格比對 x / y / w / h,回傳超出容差的格(空陣列 = 全過) */
function badCells (actual: readonly Box[], expected: readonly Box[], skip: ReadonlySet<number> = new Set()): string[] {
  const bad: string[] = []
  if (actual.length !== expected.length) return [`格數 ${actual.length} ≠ ${expected.length}`]
  expected.forEach((e, i) => {
    if (skip.has(i)) return
    const a = actual[i]
    const d = Math.max(Math.abs(a.x - e.x), Math.abs(a.y - e.y), Math.abs(a.w - e.w), Math.abs(a.h - e.h))
    if (d > TOL) bad.push(`#${i} 差 ${d.toFixed(1)}(得 ${a.x},${a.y},${a.w},${a.h};要 ${e.x},${e.y},${e.w},${e.h})`)
  })
  return bad
}

const move = (b: Box, dx: number, dy: number, k = 1): Box => ({ x: b.x * k + dx, y: b.y * k + dy, w: b.w * k, h: b.h * k })
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

describe('倉庫碎片頁格位擬合', () => {
  it('F1 3.29 一般頁 1125 高:擬合成 general,格框與真值差 ≤ 5 px', async () => {
    const img = await toGray(sharp(FILE_1125))
    const r = fitStashGrid(img, LAYOUT_329, { clientH: 1125 })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(r!.score).toBeCloseTo(r!.scores.general, 10)
    expect(r!.rects.map(c => c.refName)).toEqual(LAYOUT_329.subtabs.general.map(c => c.refName))
    expect(badCells(r!.rects, cellRects(LAYOUT_329, 'general', 1125, 0, 0))).toEqual([])
  }, T)

  it('F2 3.30 一般頁原生擷取:擬合成 general,52 格與 truth.json 差 ≤ 5 px', async () => {
    const img = await toGray(sharp(FILE_330))
    const r = fitStashGrid(img, LAYOUT_330, { clientH: 1440 })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(r!.rects).toHaveLength(52)
    expect(r!.rects.map(c => c.refName)).toEqual(LAYOUT_330.subtabs.general.map(c => c.refName))
    // 選中的子頁 = 對上格數(分數 × 格數)較多者:綢帶只有 10 格,比例可能比一般高(主對話裁定,原斷言比的是比例)
    expect(r!.score).toBeGreaterThan(0)
    expect(r!.score).toBeLessThanOrEqual(1)
    expect(r!.scores.general * LAYOUT_330.subtabs.general.length).toBeGreaterThan(r!.scores.threads * LAYOUT_330.subtabs.threads.length)
    expect(badCells(r!.rects, TRUTH_330)).toEqual([])
  }, T)

  it.each([0.75, 1.111])('F3 整張等比縮 %s 倍、clientH 同比例:格框 = 真值 × 比例', async (k) => {
    const meta = await sharp(FILE_330).metadata()
    const img = await toGray(sharp(FILE_330).resize({ width: Math.round(meta.width! * k), height: Math.round(meta.height! * k), kernel: 'lanczos3' }))
    const r = fitStashGrid(img, LAYOUT_330, { clientH: Math.round(1440 * k) })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(badCells(r!.rects, TRUTH_330.map(b => move(b, 0, 0, k)))).toEqual([])
    // 擬合出的格長要跟著縮放(60 px × k)
    expect(Math.abs(r!.box - 60 * k)).toBeLessThanOrEqual(TOL)
  }, T)

  it('F3 縮 0.8 倍但 clientH 仍傳 1440:不靠高度公式,仍擬合到實際格位', async () => {
    const k = 0.8
    const meta = await sharp(FILE_330).metadata()
    const img = await toGray(sharp(FILE_330).resize({ width: Math.round(meta.width! * k), height: Math.round(meta.height! * k), kernel: 'lanczos3' }))
    const r = fitStashGrid(img, LAYOUT_330, { clientH: 1440 })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(badCells(r!.rects, TRUTH_330.map(b => move(b, 0, 0, k)))).toEqual([])
  }, T)

  it('F4 左右各補 200 px 黑邊:格框 x 平移 +200', async () => {
    const img = await toGray(sharp(FILE_330).extend({ left: 200, right: 200, background: bg(0) }))
    const r = fitStashGrid(img, LAYOUT_330, { clientH: 1440 })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(badCells(r!.rects, TRUTH_330.map(b => move(b, 200, 0)))).toEqual([])
  }, T)

  it('F4 整張水平平移 80 px(左側補背景色):格框 x 平移 +80', async () => {
    const m = median(await toGray(sharp(FILE_330)))
    const img = await toGray(sharp(FILE_330).extend({ left: 80, background: bg(m) }))
    const r = fitStashGrid(img, LAYOUT_330, { clientH: 1440 })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(badCells(r!.rects, TRUTH_330.map(b => move(b, 80, 0)))).toEqual([])
  }, T)

  it('F5 上方補 47 px(資料夾偏移):格框 y 平移 +47', async () => {
    const m = median(await toGray(sharp(FILE_330)))
    const img = await toGray(sharp(FILE_330).extend({ top: 47, background: bg(m) }))
    const r = fitStashGrid(img, LAYOUT_330, { clientH: 1440 })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(badCells(r!.rects, TRUTH_330.map(b => move(b, 0, 47)))).toEqual([])
  }, T)

  it('F6 非碎片頁的格子畫面(負樣本):回 null', async () => {
    const img = await toGray(sharp(FILE_NEG))
    expect(fitStashGrid(img, LAYOUT_330, { clientH: 1432 })).toBeNull()
  }, T)

  it('F7 右上約三成格子被深色塊蓋住:未被蓋住的格子仍差 ≤ 5 px', async () => {
    const meta = await sharp(FILE_330).metadata()
    const W = meta.width!
    const H = meta.height!
    const cover: Box = { x: Math.round(W * 0.5), y: 0, w: W - Math.round(W * 0.5), h: Math.round(H * 0.5) }
    const covered = new Set<number>()
    TRUTH_330.forEach((b, i) => { if (overlaps(b, cover)) covered.add(i) })
    // 前置檢查:蓋住的比例確實約三成,否則這例測不到「被遮」
    expect(covered.size / TRUTH_330.length).toBeGreaterThan(0.2)
    expect(covered.size / TRUTH_330.length).toBeLessThan(0.4)

    const base = await sharp(FILE_330).removeAlpha().png().toBuffer()
    const patch = await sharp({ create: { width: cover.w, height: cover.h, channels: 3, background: bg(20) } }).png().toBuffer()
    const img = await toGray(sharp(base).composite([{ input: patch, left: cover.x, top: cover.y }]))

    const r = fitStashGrid(img, LAYOUT_330, { clientH: 1440 })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(badCells(r!.rects, TRUTH_330, covered)).toEqual([])
  }, T)

  it('F8 整張塗成單一背景色:回 null', async () => {
    const src = await toGray(sharp(FILE_330))
    const flat: GrayImage = { gray: new Uint8Array(src.w * src.h).fill(median(src)), w: src.w, h: src.h }
    expect(fitStashGrid(flat, LAYOUT_330, { clientH: 1440 })).toBeNull()
  }, T)

  it('F9 search 只框住第一格左上角 ±30 px:結果與不帶 search 相同', async () => {
    const img = await toGray(sharp(FILE_330))
    const full = fitStashGrid(img, LAYOUT_330, { clientH: 1440 })
    expect(full).not.toBeNull()
    const f = TRUTH_330[0]
    const x = Math.max(0, f.x - 30)
    const y = Math.max(0, f.y - 30)
    const search = { x, y, w: f.x + 30 - x, h: f.y + 30 - y }
    const r = fitStashGrid(img, LAYOUT_330, { clientH: 1440, search })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe(full!.subtab)
    expect(badCells(r!.rects, TRUTH_330)).toEqual([])
    // 兩次結果互相也要幾乎一致(搜尋範圍只是縮小,最佳解仍在範圍內)
    expect(badCells(r!.rects as CellRect[], full!.rects)).toEqual([])
  }, T)
})

// ── code review 回歸 ─────────────────────────────────────────────

/** 固定種子 PRNG(mulberry32),測試可重現 */
function prng (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fillRect (g: GrayImage, b: Box, v: number): void {
  const x0 = Math.max(0, Math.round(b.x))
  const y0 = Math.max(0, Math.round(b.y))
  const x1 = Math.min(g.w, Math.round(b.x + b.w))
  const y1 = Math.min(g.h, Math.round(b.y + b.h))
  for (let y = y0; y < y1; y++) g.gray.fill(v, y * g.w + x0, y * g.w + Math.max(x0, x1))
}

describe('code review 回歸', () => {
  it('R0 3.29 聖甲蟲頁(另一種格位畫面)用執行期參數不判成倉庫', async () => {
    // 交叉審查 3:這張真實擷取在 e2dbb20 被判成綢帶(0.5)
    const img = await toGray(sharp(path.join(FIX, 'qty-native/scarabs-1440.png')))
    expect(fitStashGrid(img, LAYOUT_330, { clientH: 1440, sizeRange: 0.08, quickReject: true })).toBeNull()
  }, T)
  it('R1 隨機暗色方塊紋理(36 張)不判成倉庫:全部回 null', () => {
    const rnd = prng(20261126)
    const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
    const hits: string[] = []
    for (let n = 0; n < 36; n++) {
      const img: GrayImage = { gray: new Uint8Array(760 * 810), w: 760, h: 810 }
      img.gray.fill(int(40, 60))
      const count = int(40, 120)
      for (let i = 0; i < count; i++) {
        const s = int(30, 70)
        const x = int(-s / 2, 760 - s / 2)
        const y = int(-s / 2, 810 - s / 2)
        const t = int(1, 2)
        fillRect(img, { x: x - t, y: y - t, w: s + 2 * t, h: s + 2 * t }, int(50, 70)) // 亮外框
        fillRect(img, { x, y, w: s, h: s }, int(5, 20)) // 暗方塊
      }
      const r = fitStashGrid(img, LAYOUT_330, { clientH: 1080, sizeRange: 0.08, quickReject: true })
      if (r) hits.push(`#${n} → ${r.subtab} score ${r.score.toFixed(2)}`)
    }
    expect(hits).toEqual([])
  }, T)

  it('R2 自己的徽章(深底 + 亮橫線)蓋在格位邊緣:帶 masks 仍擬合成 general,未被裁的格子差 ≤ 5 px', async () => {
    const masks = (SET_330 as unknown as { masks: Box[] }).masks
    const base = await toGray(sharp(FILE_330))
    // 只取有交集於影像的遮罩;價值卡(y=799)在影像外,不畫也不傳
    const inImg = masks.filter(m => m.x + m.w > 0 && m.y < base.h && m.x < base.w && m.y + m.h > 0)
    expect(inImg.length).toBeGreaterThanOrEqual(50)
    const gray = new Uint8Array(base.gray)
    const img: GrayImage = { gray, w: base.w, h: base.h, masks: inImg }
    for (const m of inImg) {
      fillRect(img, m, 15) // 徽章深底
      fillRect(img, { x: m.x, y: m.y + Math.floor(m.h / 2) - 1, w: m.w, h: 2 }, 230) // 亮橫線(文字)
    }
    const r = fitStashGrid(img, LAYOUT_330, { clientH: 1440, sizeRange: 0.08, quickReject: true })
    expect(r).not.toBeNull()
    expect(r!.subtab).toBe('general')
    expect(r!.rects).toHaveLength(52)
    // 最後一列(y = 662,高 60)被影像下緣裁掉,不比對(同 F2 的疑義)
    const clipped = new Set<number>()
    TRUTH_330.forEach((b, i) => { if (b.y + b.h > img.h) clipped.add(i) })
    expect(badCells(r!.rects, TRUTH_330, clipped)).toEqual([])
    expect(scoreGrid(img, LAYOUT_330, 'general', r!.grid)).toBeGreaterThanOrEqual(minFitScore(LAYOUT_330, 'general'))
  }, T)

  it('R3 舊版按鈕列區域當成沒框過;高度夠的區域不算舊版', () => {
    const client = { w: 2560, h: 1440 }
    const legacy = { x: 0.08, y: 0.083, w: 0.35, h: 0.103 }
    expect(isLegacyStashRegion(legacy)).toBe(true)
    expect(stashSearchClientRect(client, legacy)).toEqual(stashSearchClientRect(client))
    expect(stashSearchClientRect(client, legacy)).toEqual(stashSearchClientRect(client, null))
    const real = { x: 0.02, y: 0.1, w: 0.4, h: 0.5 }
    expect(isLegacyStashRegion(real)).toBe(false)
    expect(isLegacyStashRegion(null)).toBe(false)
    // 真正框過的區域要被採用(結果不同於預設),證明不是一律回預設
    expect(stashSearchClientRect(client, real)).not.toEqual(stashSearchClientRect(client))
    // 預設區域換算比例後再當區域傳入不會被當成舊版
    expect(isLegacyStashRegion(defaultStashRegion(client.w, client.h))).toBe(false)
  })
})
