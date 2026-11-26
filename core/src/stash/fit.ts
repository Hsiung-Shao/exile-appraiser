// PoE1 倉庫碎片頁「格子擬合」(2026-11-26,取代按鈕列 OCR):碎片頁每個格位都畫成固定的深色方框(數量 0 也畫),
// 把版面表(layouts.json)當錨點,在擷取畫面上搜尋格長與位移,讓預測的格子落在方框上;分數最高且過門檻的子頁 = 目前子頁。
// 不靠 client 高度公式定位 → 不受畫面比例、UI 縮放、黑邊、資料夾偏移影響;不讀文字 → 不受介面語言、說明框蓋住按鈕列影響。
// 零依賴:main(esbuild)以相對路徑 import。
import { cellBox, cellRects, stashLeft, STASH_SUBTABS, type CellRect, type StashLayoutFile, type StashSubtab } from './layout'

export interface GrayImage {
  gray: Uint8Array
  w: number
  h: number
  /** 我們自己畫在畫面上的東西(徽章 / 價值卡;影像座標):碰到的邊條當成看不到(擷取截得到 overlay,徽章會把格位邊緣蓋亮) */
  masks?: ReadonlyArray<{ x: number, y: number, w: number, h: number }>
}
export interface FitPrior {
  /** 遊戲 client 高度;先驗格長 = cellBox(subtab, clientH),搜尋 ±25% */
  clientH: number
  /**
   * 格長搜尋範圍(先驗的 ±比例;省略 = `SIZE_RANGE` 0.25)。PoE1 介面只隨 client 高度縮放,實際格長幾乎等於先驗;
   * main 常駐掃描用小範圍(每 3 秒在一般遊戲畫面上也會跑一次,寬範圍在 4K 要半秒以上)。
   */
  sizeRange?: number
  /** 先只用先驗格長粗搜一次,明顯不像就不往下搜(main 常駐掃描用) */
  quickReject?: boolean
  /** 選填:第一格左上角的搜尋範圍(影像座標);省略 = 整張影像 */
  search?: { x: number, y: number, w: number, h: number }
}
export interface FitResult {
  subtab: StashSubtab
  /** 影像座標,順序同 layouts.subtabs[subtab] */
  rects: CellRect[]
  /** 格位過門檻比例 − 鄰位過門檻比例(-1–1) */
  score: number
  scores: Record<StashSubtab, number>
  box: number
  /** 擬合出的格子位置(影像座標,已校正成公式格框慣例);`gridRects` 還原成格框、`scoreGrid` 驗證 */
  grid: StashGrid
}

/**
 * 格子位置:版面表照虛擬 client 高度 `H` 換算(`cellRects`),整片平移到第一格左上 = (x, y)。
 * 座標系由使用者決定(擬合時 = 影像,main 送出前換成 client 實體像素)。
 */
export interface StashGrid { H: number, x: number, y: number }

export function gridRects (file: StashLayoutFile, subtab: StashSubtab, g: StashGrid): CellRect[] {
  return rectsAt(file, subtab, g.H, g.x, g.y)
}

/** 舊公式(client 高度 + 超寬黑邊 + 資料夾偏移)對應的格子位置:擬合前的先驗、以及沒有擬合結果時的退路 */
export function formulaGrid (file: StashLayoutFile, subtab: StashSubtab, clientW: number, clientH: number, yOffset = 0): StashGrid {
  const c = cellRects(file, subtab, clientH, yOffset, stashLeft(clientW, clientH))[0]
  return { H: clientH, x: c.x, y: c.y }
}

/** 已知位置驗證一次(快取命中時用,便宜):回傳同 `FitResult.score` 的分數 */
export function scoreGrid (img: GrayImage, file: StashLayoutFile, subtab: StashSubtab, g: StashGrid): number {
  const L = relLayout(file, subtab, g.H)
  return evalAt(ctxOf(img, true), L, g.x + Math.round(L.box * FORMULA_DX), g.y).score
}

/** 格位「內側比外側暗」至少這麼多灰階才算對上 */
export const SLOT_CONTRAST = 12
/** 格位內側(深藍底)平均灰階上限 */
export const SLOT_INNER_MAX = 30
/** 過門檻格數比例至少這麼多才算這一頁(說明框蓋住一部分格子仍要過) */
export const MIN_FIT_SCORE = 0.4
/**
 * 至少要「淨對上」這麼多格(分數 × 格數):綢帶只有 10 格,0.4 = 4 格在一般遊戲畫面 / 聖甲蟲頁這類格子畫面上很容易碰巧對上
 * (code review 量到隨機暗色方塊紋理 8/36 誤判);綢帶因此要 ≥ 0.8,一般(52 格)仍是 0.4
 */
export const MIN_FIT_CELLS = 8

/** 這份版面算對上的最低分數 */
export function minFitScore (file: StashLayoutFile, subtab: StashSubtab): number {
  return Math.max(MIN_FIT_SCORE, MIN_FIT_CELLS / file.subtabs[subtab].length)
}
/** 擬合格框 → 公式格框的水平校正(格長比例) */
export const FORMULA_DX = 0.045
/** 預檢門檻 = MIN_FIT_SCORE × 這個比例(粗搜位置誤差最多格長 1/16,分數會比細修後低) */
const QUICK_REJECT_RATIO = 0.6
const SIZE_RANGE = 0.25
const SIZE_STEP = 0.03
const COARSE_CELLS = 14
const TOP_K = 6

/** 積分影像(多一列一行;Float64 避免 4K 溢位) */
// 積分影像緩衝重用(4K 搜尋範圍一張約 20 MB;每次擷取都配置會讓 GC 很忙)。main 單執行緒、擬合同步跑完,不會同時用到兩份
let intBuf: Float64Array | null = null
let maskBuf: Float64Array | null = null

export function integral (img: GrayImage, reuse = false): Float64Array {
  const W = img.w + 1
  const n = W * (img.h + 1)
  let s: Float64Array
  if (reuse) {
    if (!intBuf || intBuf.length < n) intBuf = new Float64Array(n)
    s = intBuf
    s.fill(0, 0, W)
  } else {
    s = new Float64Array(n)
  }
  for (let y = 0; y < img.h; y++) {
    let row = 0
    s[(y + 1) * W] = 0
    for (let x = 0; x < img.w; x++) {
      row += img.gray[y * img.w + x]
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + row
    }
  }
  return s
}

/** `m` = 遮罩的積分(被遮像素數);沒有遮罩 = undefined */
interface Ctx { s: Float64Array, W: number, w: number, h: number, m?: Float64Array }

/** 這條邊條碰到遮罩 */
function masked (c: Ctx, x0: number, y0: number, x1: number, y1: number): boolean {
  const m = c.m
  if (!m) return false
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(c.w, x1); y1 = Math.min(c.h, y1)
  if (x1 <= x0 || y1 <= y0) return false
  const W = c.W
  return m[y1 * W + x1] - m[y0 * W + x1] - m[y1 * W + x0] + m[y0 * W + x0] > 0
}

function mean (c: Ctx, x0: number, y0: number, x1: number, y1: number): number {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(c.w, x1); y1 = Math.min(c.h, y1)
  if (x1 <= x0 || y1 <= y0) return NaN
  const { s, W } = c
  return (s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0]) / ((x1 - x0) * (y1 - y0))
}

/**
 * 一格的對比:方框內側比外側暗多少(格位內部是深藍,灰階約 5–15;外框之外的格間底色約 35–50)。
 * 看三個邊各取一段,取**最小**的那邊(錯位時通常只有一兩邊剛好落在別的格位上):
 * 上緣的右 2/3、右緣的上 2/3、左緣中段。避開左上角的堆疊數量白字與下緣中間我們自己畫的價格徽章。
 * 外側條跳過格位外框(約格長 1/10),落在格間底色上(格間距約格長 1/3)。
 */
export function slotContrast (c: Ctx, x: number, y: number, b: number): number {
  return slotAt(c, geoOf(b), x, y)
}

/** 一個格長的三段邊條相對位置(每次擬合只算一次,熱迴圈不配置物件) */
interface Geo { b: number, a: number, t: number, o0: number, o1: number, xm: number, ym: number, yl0: number, yl1: number }
function geoOf (b: number): Geo {
  const o0 = Math.max(2, Math.round(b / 9))
  return {
    b,
    a: Math.max(1, Math.round(b / 30)),
    t: Math.max(3, Math.round(b / 8)),
    o0,
    o1: Math.max(o0 + 2, Math.round(b / 5)),
    xm: Math.round(b * 0.35),
    ym: Math.round(b * 0.65),
    yl0: Math.round(b * 0.45),
    yl1: Math.round(b * 0.68)
  }
}

function slotAt (c: Ctx, g: Geo, x: number, y: number): number {
  const { b, a, t, o0, o1 } = g
  let d = Infinity
  let n = 0
  // 影像外(擷取被裁)的邊不算;內側太亮(圖示蓋到邊)的邊也不算,但至少要兩邊可看
  // 遮罩蓋到的邊(我們自己的徽章)也不算
  let i = mean(c, x + g.xm, y + a, x + b - a, y + t)
  let o = mean(c, x + g.xm, y - o1, x + b - a, y - o0)
  if (i === i && o === o && i <= SLOT_INNER_MAX && !masked(c, x + g.xm, y - o1, x + b - a, y + t)) { n++; d = Math.min(d, o - i) }
  i = mean(c, x + b - t, y + a, x + b - a, y + g.ym)
  o = mean(c, x + b + o0, y + a, x + b + o1, y + g.ym)
  if (i === i && o === o && i <= SLOT_INNER_MAX && !masked(c, x + b - t, y + a, x + b + o1, y + g.ym)) { n++; d = Math.min(d, o - i) }
  i = mean(c, x + a, y + g.yl0, x + t, y + g.yl1)
  o = mean(c, x - o1, y + g.yl0, x - o0, y + g.yl1)
  if (i === i && o === o && i <= SLOT_INNER_MAX && !masked(c, x - o1, y + g.yl0, x + t, y + g.yl1)) { n++; d = Math.min(d, o - i) }
  return n >= 2 ? d : 0
}

interface Rel { rel: Array<[number, number]>, nb: Array<[number, number]>, box: number, names: string[], geo: Geo }

/**
 * 某個縮放的版面:各格相對第一格的位移,與「鄰位」(每格上下左右隔一格的位置,不與任何格重疊)。
 * 鄰位在真的這一頁上應該是面板底色、不是格位:綢帶頁只有 10 格,不扣鄰位的話任何整齊的格子(背包、一般頁)都對得上。
 */
function relLayout (file: StashLayoutFile, subtab: StashSubtab, H: number): Rel {
  // H = 虛擬 client 高度(擬合參數,可帶小數);換算全照 layout.ts
  const r = cellRects(file, subtab, H)
  const box = cellBox(subtab, H)
  const rel = r.map(c => [c.x - r[0].x, c.y - r[0].y] as [number, number])
  const pitch = box + Math.round(H / 72)
  const nb: Array<[number, number]> = []
  const clash = (x: number, y: number) => rel.some(([cx, cy]) => Math.abs(cx - x) < box && Math.abs(cy - y) < box) ||
    nb.some(([cx, cy]) => Math.abs(cx - x) < box && Math.abs(cy - y) < box)
  for (const [x, y] of rel) {
    for (const [dx, dy] of [[pitch, 0], [-pitch, 0], [0, pitch], [0, -pitch]]) {
      if (!clash(x + dx, y + dy)) nb.push([x + dx, y + dy])
    }
  }
  return { rel, nb, box, names: r.map(c => c.refName), geo: geoOf(box) }
}

/** 對比夾在 [0, 3 × 門檻] 的總和與過門檻數 */
function sumAt (c: Ctx, pts: ReadonlyArray<[number, number]>, g: Geo, x: number, y: number, idx?: readonly number[]): { pass: number, sum: number, n: number } {
  let pass = 0
  let sum = 0
  const n = idx ? idx.length : pts.length
  for (let k = 0; k < n; k++) {
    const p = pts[idx ? idx[k] : k]
    const d = slotAt(c, g, x + p[0], y + p[1])
    if (d >= SLOT_CONTRAST) pass++
    sum += d <= 0 ? 0 : d >= SLOT_CONTRAST * 3 ? SLOT_CONTRAST * 3 : d
  }
  return { pass, sum, n }
}

/** 目標值 = 格位平均對比 − 鄰位平均對比;score = 格位過門檻比例 − 鄰位過門檻比例 */
function evalAt (c: Ctx, L: Rel, x: number, y: number, idx?: readonly number[], nbIdx?: readonly number[]): { score: number, v: number } {
  const a = sumAt(c, L.rel, L.geo, x, y, idx)
  const n = sumAt(c, L.nb, L.geo, x, y, nbIdx)
  const nn = Math.max(1, n.n)
  return { score: a.pass / a.n - n.pass / nn, v: a.sum / a.n - n.sum / nn }
}

/** 版面外框寬高(相對第一格左上) */
function extent (L: Rel, b: number): [number, number] {
  let w = 0
  let h = 0
  for (const [x, y] of L.rel) { w = Math.max(w, x + b); h = Math.max(h, y + b) }
  return [w, h]
}

/** 整個版面要在影像內(容許超出半格:擷取被裁到最後一列) */
function inside (c: Ctx, x: number, y: number, w: number, h: number, b: number): boolean {
  return x >= -b / 2 && y >= -b / 2 && x + w <= c.w + b / 2 && y + h <= c.h + b / 2
}

interface Cand { score: number, H: number, b: number, x: number, y: number, v: number }

/** 粗搜:一個格長、位置每格長 1/8、只看部分格子;好的候選放進 top(依目標值排序,最多 TOP_K) */
function coarse (c: Ctx, file: StashLayoutFile, subtab: StashSubtab, H: number, area: { x: number, y: number, w: number, h: number }, top: Cand[]): void {
  const L = relLayout(file, subtab, H)
  const b = L.box
  if (b < 8) return
  const step = Math.max(2, Math.round(b / 8))
  const pick = (n: number) => Array.from({ length: Math.min(COARSE_CELLS, n) }, (_, i) => Math.floor(i * n / Math.min(COARSE_CELLS, n)))
  const idx = pick(L.rel.length)
  const nbIdx = pick(L.nb.length)
  const [bw, bh] = extent(L, b)
  for (let y = area.y; y <= area.y + area.h; y += step) {
    for (let x = area.x; x <= area.x + area.w; x += step) {
      if (!inside(c, x, y, bw, bh, b)) continue
      const e = evalAt(c, L, x, y, idx, nbIdx)
      if (top.length < TOP_K || e.v > top[top.length - 1].v) {
        top.push({ score: e.score, H, b, x, y, v: e.v })
        top.sort((p, q) => q.v - p.v)
        if (top.length > TOP_K) top.pop()
      }
    }
  }
}

function fitOne (c: Ctx, file: StashLayoutFile, subtab: StashSubtab, prior: FitPrior): { score: number, H: number, x: number, y: number } | null {
  const area = prior.search ?? { x: 0, y: 0, w: c.w, h: c.h }
  const top: Cand[] = []
  // 預檢:只用先驗格長粗搜一次;取樣格的分數都遠低於門檻 → 畫面上沒有這份版面(倉庫沒開時每次擷取都會跑,先擋掉)
  if (prior.quickReject) {
    coarse(c, file, subtab, prior.clientH, area, top)
    if (!top.length || Math.max(...top.map(t => t.score)) < MIN_FIT_SCORE * QUICK_REJECT_RATIO) return null
    top.length = 0
  }
  const range = prior.sizeRange ?? SIZE_RANGE
  const n = Math.max(1, Math.round(range / SIZE_STEP))
  for (let i = -n; i <= n; i++) coarse(c, file, subtab, prior.clientH * (1 + i * range / n), area, top)
  // 細修分兩段(4K 時整格逐像素搜要近一秒):A 位置每 s2 px、縮放 ±1.6%(每 0.4%)→ B 最好的幾個附近逐像素、縮放 ±0.2%
  const scan = (H: number, cx: number, cy: number, r: number, st: number, out: Array<{ score: number, v: number, H: number, x: number, y: number }>, keep: number) => {
    const L = relLayout(file, subtab, H)
    const b = L.box
    const [bw, bh] = extent(L, b)
    for (let y = cy - r; y <= cy + r; y += st) {
      for (let x = cx - r; x <= cx + r; x += st) {
        if (!inside(c, x, y, bw, bh, b)) continue
        const e = evalAt(c, L, x, y)
        if (out.length < keep || e.v > out[out.length - 1].v) {
          out.push({ score: e.score, v: e.v, H, x, y })
          out.sort((p, q) => q.v - p.v)
          if (out.length > keep) out.pop()
        }
      }
    }
  }
  const stageA: Array<{ score: number, v: number, H: number, x: number, y: number }> = []
  for (const t of top) {
    const step = Math.max(2, Math.round(t.b / 8))
    const s2 = Math.max(1, Math.round(step / 3))
    // 縮放細修到 0.4%:版面寬約 12 格,整數格長的誤差在最遠那格會累積到 5 px 以上
    for (let k = -4; k <= 4; k++) scan(t.H * (1 + k * 0.004), t.x, t.y, step, s2, stageA, 3)
  }
  const stageB: Array<{ score: number, v: number, H: number, x: number, y: number }> = []
  for (const a of stageA) {
    const s2 = Math.max(1, Math.round(Math.max(2, Math.round(relLayout(file, subtab, a.H).box / 8)) / 3))
    for (const k of [-0.002, 0, 0.002]) scan(a.H * (1 + k), a.x, a.y, s2, 1, stageB, 1)
  }
  const best = stageB[0] ?? stageA[0] ?? null
  return best && { score: best.score, H: best.H, x: best.x, y: best.y }
}

function ctxOf (img: GrayImage, reuse = false): Ctx {
  const c: Ctx = { s: integral(img, reuse), W: img.w + 1, w: img.w, h: img.h }
  if (img.masks?.length) {
    const W = img.w + 1
    const n = W * (img.h + 1)
    const m = reuse ? (maskBuf && maskBuf.length >= n ? maskBuf : (maskBuf = new Float64Array(n))) : new Float64Array(n)
    m.fill(0, 0, n)
    // 先在 (y+1, x+1) 標記被遮像素,再原地累加成積分
    for (const r of img.masks) {
      const x0 = Math.max(0, Math.floor(r.x)); const y0 = Math.max(0, Math.floor(r.y))
      const x1 = Math.min(img.w, Math.ceil(r.x + r.w)); const y1 = Math.min(img.h, Math.ceil(r.y + r.h))
      for (let y = y0; y < y1; y++) m.fill(1, (y + 1) * W + x0 + 1, (y + 1) * W + x1 + 1)
    }
    for (let y = 1; y <= img.h; y++) {
      let row = 0
      for (let x = 1; x < W; x++) {
        row += m[y * W + x]
        m[y * W + x] = m[(y - 1) * W + x] + row
      }
    }
    c.m = m
  }
  return c
}

export function rectsAt (file: StashLayoutFile, subtab: StashSubtab, H: number, x: number, y: number): CellRect[] {
  const { rel, box, names } = relLayout(file, subtab, H)
  return rel.map(([dx, dy], i) => ({ x: x + dx, y: y + dy, w: box, h: box, refName: names[i] }))
}

export function fitStashGrid (img: GrayImage, layouts: StashLayoutFile, prior: FitPrior): FitResult | null {
  const c = ctxOf(img, true)
  const res = STASH_SUBTABS.map(st => ({ st, f: fitOne(c, layouts, st, prior), n: layouts.subtabs[st].length }))
  const scores = Object.fromEntries(res.map(r => [r.st, r.f?.score ?? 0])) as Record<StashSubtab, number>
  // 過門檻的版面裡取「對上的格數」最多的:綢帶只有 10 格,一般頁上也找得到一塊像它的格子,但一般版面能多解釋好幾十格
  const ok = res.filter(r => r.f && r.f.score >= minFitScore(layouts, r.st)).sort((p, q) => q.f!.score * q.n - p.f!.score * p.n)
  const win = ok[0]
  if (!win?.f) return null
  // 對齊 Exile-UI 公式格框的慣例(數字模板裁切區、徽章位置都以它為準):擬合到的格位框比公式框偏右約格長 4.5%
  // (fixture 量到:格長 45 / 47 / 59 → +2.2 / +2.5 / +2.8 px)
  const box = relLayout(layouts, win.st, win.f.H).box
  const grid: StashGrid = { H: win.f.H, x: win.f.x - Math.round(box * FORMULA_DX), y: win.f.y }
  return { subtab: win.st, rects: gridRects(layouts, win.st, grid), score: win.f.score, scores, box, grid }
}
