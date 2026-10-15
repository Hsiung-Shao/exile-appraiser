// PoE1 倉庫碎片頁:讀每格左上角的堆疊數量(數字模板比對;不用 WinOCR —— 2026-10-14 可行性研究:WinOCR 拼圖法 57–77%,
// 模板比對留一驗證 一般 98.3% / 聖甲蟲 93.9%)。
// 零依賴、只用可抹除 TS 語法:main(esbuild)以相對路徑 import;`scripts/build-stash-digit-templates.mjs` 以 Node 型別剝除直接 import。
//
// 流程(以模板的基準 client 高為準,其他解析度先把裁切區縮放到基準尺寸):
//   裁切 x = 格 x − 3、寬 = 格寬 × 0.85;y = 格 y、高 = 格高 × 0.65(數字在左上角)
//   → 白色程度 max(0, min(R,G,B) − (max − min) − 100)(數字是白字;彩色圖示 / 暗底 → 0)
//   → 11×15 模板 NCC 滑動比對(積分影像算視窗平均 / 變異;模板已零平均、單位長度)→ ≥ 0.5 的候選、NMS
//   → 以最強者為錨,同列(±1 px)間距 7–12 px 往左右串接,最多 3 位
//   → 門檻:每位 ≥ 0.6、與次佳數字差 ≥ 0.05、低分(< 0.70)時次佳差須 ≥ 0.15、開頭非 0、不是單獨的「0」、
//     末位右側一格寬內 < 4 個純白像素(否則可能漏讀一位;檢查區超出裁切區時改看往右延伸的裁切區,影像外 = 不確定)。
// 寧缺勿錯:任何一項不過 → qty null(畫面顯示「?」、不計入總價);沒有任何候選 = 空格;裁切區超出影像 = 不確定。

export interface QtyRect { x: number, y: number, w: number, h: number }

/** 擷取影像(列優先,每像素 `channels` 個位元組;RGB / RGBA / BGRA 皆可 —— 白色程度只看最大 / 最小通道,與通道順序無關) */
export interface QtyImage {
  data: ArrayLike<number>
  width: number
  height: number
  channels: number
}

export const QTY_TEMPLATE_W = 11
export const QTY_TEMPLATE_H = 15
const TN = QTY_TEMPLATE_W * QTY_TEMPLATE_H

/** `data/poe1/stash/digit-templates.json`(`scripts/build-stash-digit-templates.mjs` 產生,不手改) */
export interface DigitTemplates {
  schema: 1
  w: number
  h: number
  /** 模板取自哪個 client 高的截圖(其他解析度把裁切區縮放到這個高度的尺寸再比對) */
  baseClientH: number
  /** 每個數字用了幾個樣本 */
  counts: number[]
  /** 索引 = 數字;每個 w × h 個值(零平均、單位長度);沒有樣本 = null */
  digits: Array<number[] | null>
  sources?: Array<{ file: string, sha256: string }>
}

export type QtyReason = 'ok' | 'empty' | 'low-confidence' | 'missed-digit' | 'too-many' | 'leading-zero' | 'masked' | 'zero' | 'outside'

export interface QtyResult {
  /** 讀到的數量;空格 / 不確定 = null */
  qty: number | null
  /** 串接各位數的最低 NCC 分數(沒有候選 = 0) */
  confidence: number
  /** 各位數「最佳 − 次佳數字」分數差的最小值 */
  margin: number
  reason: QtyReason
  /** 串接出的數字字串(不確定時也有,診斷用) */
  raw?: string
  /** 數字帶(影像像素;串接數字的列 ± 2、左緣到末位右側再一位,夾在裁切區內):徽章蓋到這裡才算「蓋住數字」。沒有候選 = 省略 */
  band?: QtyRect
}

/** 參數(基準 client 高的像素) */
export const QTY_PARAMS = {
  cropDx: -3,
  cropW: 0.85,
  cropH: 0.65,
  whiteBase: 100,
  candidate: 0.5,
  nms: 6,
  rowDy: 1,
  advMin: 7,
  advMax: 12,
  maxDigits: 3,
  minScore: 0.6,
  minMargin: 0.05,
  /** 低分讀值(最低位分數 < lowScore)要求次佳差 ≥ lowScoreMargin(2026-10-15 使用者選「放寬一點」:擋留一 19→10 @0.693/0.123;σ 1.0 11→14 @0.718/0.226 不擋) */
  lowScore: 0.7,
  lowScoreMargin: 0.15,
  /** 漏讀檢查 ① 超出裁切區時,往右延伸的裁切區多取幾個基準像素(4 位數堆疊的第 4 位落在裁切區外) */
  extW: 8,
  /** 漏讀檢查:末位右側區域的純白像素(最暗通道 ≥ 230、色差 ≤ 40)達這個數 → 不確定 */
  residWhite: 230,
  residSat: 40,
  residCount: 4,
  /** 視窗白色程度總和低於這個值不比對(約 4 個純白像素;最細的「1」約 3000)—— 省時間,只略過不可能是數字的視窗 */
  minInk: 600,
  /** 漏讀檢查 ②:鄰位筆畫量 / 自己筆畫量達這個值 → 不確定 */
  neighborMass: 1.3,
  /** 訓練:數字連通元件(最暗通道 ≥ 170、色差 ≤ 50) */
  trainWhite: 170,
  trainSat: 50,
  /**
   * 描邊過濾(`outlineGate`):白色像素 3×3 內最亮通道的最小值 < 90(數字的黑色描邊)照舊,90–180 線性減弱,≥ 180 不算筆畫。
   * 2026-10-15 以舊截圖 + 原生擷取 + 糊化 σ 0.6 / 1.0 + 放大 1440 掃參數(只用舊截圖訓練):比對 3×3 + RGB 5×5、90 / 90 = 錯 1 → 0、不確定 46 → 42、留一 0 錯;
   * RGB 也用 3×3 → 留一多錯 1 格;硬門檻 / 暗度 60–70 / 不用 `ink` 算筆畫量都會多出高信心錯。原生擷取加進訓練沒有好處(只當驗證)
   */
  outlineRadius: 1,
  /** RGB(漏讀檢查 ① 的純白像素、訓練的連通元件)用的半徑:較粗筆畫的中心 3×3 碰不到描邊,用 1 會把真的漏讀位數也濾掉 */
  outlineRgbRadius: 2,
  outlineDark: 90,
  outlineSoft: 90
} as const

/** 「高信心」:錯的讀數不得同時達到(測試守門) */
export const QTY_HIGH_CONFIDENCE = 0.8

/** 縮放到基準尺寸後的裁切區:RGB(3 通道,浮點)+ 白色程度 + 每像素是否被遮罩 */
export interface QtyCrop {
  w: number
  h: number
  rgb: Float32Array
  white: Float32Array
  masked: Uint8Array | null
  /** 描邊過濾前的白色程度(漏讀檢查 ② 的筆畫量用;比對用 `white`) */
  ink: Float32Array
  /** 基準像素 → 影像像素 */
  x0: number
  y0: number
  k: number
}

/** 格子(影像像素)→ 數字裁切區(影像像素,可能是小數) */
export function qtyCropRect (cell: QtyRect, clientH: number, baseClientH: number, extraBase = 0): { x: number, y: number, w: number, h: number, k: number, bw: number, bh: number } {
  const k = clientH / baseClientH
  const w = Math.round(cell.w * QTY_PARAMS.cropW)
  const h = Math.round(cell.h * QTY_PARAMS.cropH)
  const bw = Math.max(1, Math.round(w / k)) + extraBase
  const bh = Math.max(1, Math.round(h / k))
  return { x: cell.x + QTY_PARAMS.cropDx * k, y: cell.y, w: bw * k, h: bh * k, k, bw, bh }
}

function overlaps (a: QtyRect, b: QtyRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * 影像某塊縮放到基準尺寸(面積平均;k = 1 且整數起點時逐像素相同)。影像外 = 黑。
 * `mask`(影像像素)蓋到的基準像素白色程度歸 0、漏讀檢查也不算(我們自己畫在遊戲上的徽章)。
 */
export function qtyCrop (img: QtyImage, cell: QtyRect, clientH: number, baseClientH: number, mask?: readonly QtyRect[], extraBase = 0): QtyCrop {
  const c = qtyCropRect(cell, clientH, baseClientH, extraBase)
  const { bw, bh, k } = c
  const rgb = new Float32Array(bw * bh * 3)
  const ch = img.channels
  const data = img.data
  const exact = k === 1 && Number.isInteger(c.x) && Number.isInteger(c.y)
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const o = (j * bw + i) * 3
      if (exact) {
        const X = c.x + i
        const Y = c.y + j
        if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) continue
        const p = (Y * img.width + X) * ch
        rgb[o] = data[p]; rgb[o + 1] = data[p + 1]; rgb[o + 2] = data[p + 2]
        continue
      }
      const sx0 = c.x + i * k
      const sx1 = sx0 + k
      const sy0 = c.y + j * k
      const sy1 = sy0 + k
      let r = 0
      let g = 0
      let b = 0
      for (let Y = Math.floor(sy0); Y < sy1; Y++) {
        const wy = Math.min(Y + 1, sy1) - Math.max(Y, sy0)
        if (wy <= 0 || Y < 0 || Y >= img.height) continue
        for (let X = Math.floor(sx0); X < sx1; X++) {
          const wx = Math.min(X + 1, sx1) - Math.max(X, sx0)
          if (wx <= 0 || X < 0 || X >= img.width) continue
          const wgt = wx * wy
          const p = (Y * img.width + X) * ch
          r += data[p] * wgt; g += data[p + 1] * wgt; b += data[p + 2] * wgt
        }
      }
      const area = k * k
      rgb[o] = r / area; rgb[o + 1] = g / area; rgb[o + 2] = b / area
    }
  }
  let masked: Uint8Array | null = null
  if (mask?.length) {
    for (const m of mask) {
      if (!overlaps(m, { x: c.x, y: c.y, w: c.w, h: c.h })) continue
      const i0 = Math.max(0, Math.floor((m.x - c.x) / k))
      const i1 = Math.min(bw, Math.ceil((m.x + m.w - c.x) / k))
      const j0 = Math.max(0, Math.floor((m.y - c.y) / k))
      const j1 = Math.min(bh, Math.ceil((m.y + m.h - c.y) / k))
      if (i1 <= i0 || j1 <= j0) continue
      masked ??= new Uint8Array(bw * bh)
      for (let j = j0; j < j1; j++) masked.fill(1, j * bw + i0, j * bw + i1)
    }
  }
  const white = new Float32Array(bw * bh)
  for (let i = 0; i < bw * bh; i++) {
    if (masked?.[i]) continue
    white[i] = whiteness(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
  }
  const ink = white.slice()
  outlineGate(bw, bh, rgb, white, masked)
  return { w: bw, h: bh, rgb, white, ink, masked, x0: c.x, y0: c.y, k }
}

/**
 * 描邊過濾(2026-10-15,使用者原生擷取):遊戲的堆疊數字是「白字 + 黑色描邊」,聖甲蟲等圖示的白色 / 銀色區塊旁邊沒有接近黑的像素。
 * 白色像素周圍(基準像素)最亮通道的最小值 m:m < `outlineDark` 照舊;之後線性減弱,m ≥ `outlineDark + outlineSoft` 歸 0。
 * 白色程度(比對)用 3×3;RGB(漏讀檢查 ① 的純白像素、訓練的連通元件)用 5×5(`outlineRgbRadius`)同一條減弱曲線 —— 粗筆畫中心離描邊 2 像素。
 * 漸進而不是硬門檻:畫面模糊 / 放大後描邊變淺,硬門檻會把數字筆畫切斷 → 高信心讀錯(實驗:σ 0.6 糊化 29 格錯)。
 * 被遮罩的像素(我們的徽章)當成暗 = 可能是描邊,不削弱旁邊的筆畫(2026-10-15 H3;V1–V19 數字不變)。
 * 裁切區外不補邊(已評估:四周多取 `outlineRgbRadius` 算完裁回 → V18、V19 各多 1 格不確定,不採用,見 docs/stash-prices.md)。
 */
function outlineGate (w: number, h: number, rgb: Float32Array, white: Float32Array, masked: Uint8Array | null): void {
  const P = QTY_PARAMS
  const mx = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) mx[i] = masked?.[i] ? 0 : Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
  const mnW = minFilter(mx, w, h, P.outlineRadius)
  const mnC = minFilter(mx, w, h, P.outlineRgbRadius)
  const fac = (m: number): number => Math.max(0, Math.min(1, (P.outlineDark + P.outlineSoft - m) / P.outlineSoft))
  for (let i = 0; i < w * h; i++) {
    if (white[i] === 0) continue
    const fw = fac(mnW[i])
    if (fw < 1) white[i] *= fw
    const fc = fac(mnC[i])
    if (fc < 1) { rgb[i * 3] *= fc; rgb[i * 3 + 1] *= fc; rgb[i * 3 + 2] *= fc }
  }
}

/** 方形最小值濾波(半徑 r,可分離:先橫向再縱向;框外略過) */
function minFilter (v: Float32Array, w: number, h: number, r: number): Float32Array {
  const row = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity
      for (let X = Math.max(0, x - r); X <= Math.min(w - 1, x + r); X++) m = Math.min(m, v[y * w + X])
      row[y * w + x] = m
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity
      for (let Y = Math.max(0, y - r); Y <= Math.min(h - 1, y + r); Y++) m = Math.min(m, row[Y * w + x])
      out[y * w + x] = m
    }
  }
  return out
}

export function whiteness (r: number, g: number, b: number): number {
  const mn = Math.min(r, g, b)
  const mx = Math.max(r, g, b)
  return Math.max(0, mn - (mx - mn) - QTY_PARAMS.whiteBase)
}

interface Cand { x: number, y: number, d: number, sc: number, second: number }

const PAD_X = 3
const PAD_Y = 2

/** 比對用模板:沒有樣本的數字跳過;值交錯排列(像素 i 的第 t 個模板 = `v[i * n + t]`),一個視窗像素讀一次、算完全部模板 */
interface TemplatePack { n: number, digits: number[], v: Float64Array }

function packTemplates (t: DigitTemplates): TemplatePack {
  const digits: number[] = []
  t.digits.forEach((v, d) => { if (v && v.length === TN) digits.push(d) })
  const n = digits.length
  const v = new Float64Array(TN * n)
  digits.forEach((d, j) => { const src = t.digits[d]!; for (let i = 0; i < TN; i++) v[i * n + j] = src[i] })
  return { n, digits, v }
}

const templateCache = new WeakMap<DigitTemplates, TemplatePack>()
function templatesOf (t: DigitTemplates): TemplatePack {
  let l = templateCache.get(t)
  if (!l) { l = packTemplates(t); templateCache.set(t, l) }
  return l
}

/** 候選:每個視窗(左上 px ∈ [−3, w − 11 + 3]、py ∈ [−2, h − 15 + 2],框外補 0)對每個模板的 NCC */
/** 模板視窗(左上 x, y)中間筆畫帶(x + 3 ~ x + 8、y + 2 ~ y + 13)的白色程度總和(描邊過濾前的 `ink`:漏讀檢查不受描邊過濾影響) */
function strokeMass (crop: QtyCrop, x0: number, y0: number): number {
  let s = 0
  for (let y = Math.max(0, y0 + 2); y < Math.min(crop.h, y0 + QTY_TEMPLATE_H - 2); y++) {
    for (let x = Math.max(0, x0 + 3); x < Math.min(crop.w, x0 + 8); x++) s += crop.ink[y * crop.w + x]
  }
  return s
}

function candidates (crop: QtyCrop, tpl: TemplatePack): Cand[] {
  if (!tpl.n) return []
  const PW = crop.w + PAD_X * 2
  const PH = crop.h + PAD_Y * 2
  const P = new Float64Array(PW * PH)
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) P[(y + PAD_Y) * PW + x + PAD_X] = crop.white[y * crop.w + x]
  }
  // 積分影像(多一列一欄)
  const IW = PW + 1
  const S = new Float64Array(IW * (PH + 1))
  const S2 = new Float64Array(IW * (PH + 1))
  for (let y = 0; y < PH; y++) {
    let rs = 0
    let rs2 = 0
    for (let x = 0; x < PW; x++) {
      const v = P[y * PW + x]
      rs += v; rs2 += v * v
      S[(y + 1) * IW + x + 1] = S[y * IW + x + 1] + rs
      S2[(y + 1) * IW + x + 1] = S2[y * IW + x + 1] + rs2
    }
  }
  const W = QTY_TEMPLATE_W
  const H = QTY_TEMPLATE_H
  const out: Cand[] = []
  const n = tpl.n
  const tv = tpl.v
  const acc = new Float64Array(n)
  for (let py = 0; py + H <= PH; py++) {
    for (let px = 0; px + W <= PW; px++) {
      const a = py * IW + px
      const b = py * IW + px + W
      const c = (py + H) * IW + px
      const d = (py + H) * IW + px + W
      const sum = S[d] - S[b] - S[c] + S[a]
      if (sum < QTY_PARAMS.minInk) continue
      const sum2 = S2[d] - S2[b] - S2[c] + S2[a]
      const varSum = sum2 - sum * sum / TN
      if (!(varSum > 1e-6)) continue
      const inv = 1 / Math.sqrt(varSum)
      acc.fill(0)
      // 白色程度大多是 0(暗底 / 彩色圖示)→ 只算非 0 像素
      for (let ty = 0; ty < H; ty++) {
        const row = (py + ty) * PW + px
        for (let tx = 0; tx < W; tx++) {
          const v = P[row + tx]
          if (v === 0) continue
          const base = (ty * W + tx) * n
          for (let t = 0; t < n; t++) acc[t] += v * tv[base + t]
        }
      }
      let best = -2
      let bd = -1
      let second = -2
      for (let t = 0; t < n; t++) {
        const sc = acc[t] * inv
        if (sc > best) { second = best; best = sc; bd = tpl.digits[t] } else if (sc > second) second = sc
      }
      if (best >= QTY_PARAMS.candidate) out.push({ x: px - PAD_X, y: py - PAD_Y, d: bd, sc: best, second })
    }
  }
  return out
}

/**
 * 一格的數量(基準尺寸裁切區已備妥)。`ext` = 同一原點、往右多取 `QTY_PARAMS.extW` 基準像素的裁切區(只在漏讀檢查 ① 超出裁切區時才呼叫;
 * 省略 / 回 null(影像外)→ 不確定)
 */
export function decodeQtyCrop (crop: QtyCrop, templates: DigitTemplates, ext?: () => QtyCrop | null): QtyResult & { chain?: Array<{ x: number, y: number, d: number }>, neighbor?: number, bandBase?: { x: number, y: number, w: number, h: number } } {
  const P = QTY_PARAMS
  const cands = candidates(crop, templatesOf(templates))
  cands.sort((a, b) => b.sc - a.sc)
  const kept: Cand[] = []
  for (const c of cands) {
    if (kept.some(k => Math.abs(k.x - c.x) < P.nms && Math.abs(k.y - c.y) < P.nms)) continue
    kept.push(c)
  }
  if (!kept.length) {
    // 遮罩蓋到裁切區又找不到數字:可能是數字被我們的徽章蓋住 → 不當成空格
    return { qty: null, confidence: 0, margin: 0, reason: crop.masked ? 'masked' : 'empty' }
  }
  const anchor = kept[0]
  const chain: Cand[] = [anchor]
  for (const dir of [-1, 1]) {
    let cur = anchor
    for (;;) {
      let nx: Cand | null = null
      for (const k of kept) {
        if (chain.includes(k)) continue
        const adv = dir * (k.x - cur.x)
        if (Math.abs(k.y - cur.y) > P.rowDy || adv < P.advMin || adv > P.advMax) continue
        if (!nx || k.sc > nx.sc) nx = k
      }
      if (!nx) break
      chain.push(nx)
      cur = nx
    }
  }
  chain.sort((a, b) => a.x - b.x)
  const raw = chain.map(c => c.d).join('')
  let confidence = Infinity
  let margin = Infinity
  for (const c of chain) {
    confidence = Math.min(confidence, c.sc)
    margin = Math.min(margin, c.sc - c.second)
  }
  confidence = round3(confidence)
  margin = round3(margin)
  const first = chain[0]
  const last = chain[chain.length - 1]
  // 漏讀檢查 ①(研究原式):末位之後一格寬內的純白像素(最暗通道 ≥ 230、色差 ≤ 40)≥ 4。
  // 檢查區超出裁切區(三位數已頂到裁切區右緣;4 位數的第 4 位在外面)→ 改看往右延伸的裁切區;拿不到(影像外)→ 不確定
  const residX1 = last.x + QTY_TEMPLATE_W + 4
  let rc: QtyCrop | null = crop
  if (residX1 > crop.w) {
    const e = ext?.() ?? null
    rc = e && e.w >= residX1 && e.h === crop.h ? e : null
  }
  let resid = 0
  if (rc) for (let y = Math.max(0, last.y + 2); y < Math.min(rc.h, last.y + QTY_TEMPLATE_H - 2); y++) {
    for (let x = Math.max(0, last.x + P.advMin + 2); x < Math.min(rc.w, residX1); x++) {
      const i = y * rc.w + x
      if (rc.masked?.[i]) continue
      const r = rc.rgb[i * 3]
      const g = rc.rgb[i * 3 + 1]
      const b = rc.rgb[i * 3 + 2]
      const mn = Math.min(r, g, b)
      const mx = Math.max(r, g, b)
      if (mn >= P.residWhite && mx - mn <= P.residSat) resid++
    }
  }
  // 漏讀檢查 ②:首位之前 / 末位之後一個字距的位置(同列 ±1)筆畫帶的白色程度總量 ≥ 串接數字中最少者 × 1.3
  // (畫面縮放 / 模糊後筆畫不再純白、第二位掉到候選門檻下 → ① 抓不到「87 只讀到 8」;同一條件在乾淨截圖只多擋 1 格)
  let ownMass = Infinity
  for (const c of chain) ownMass = Math.min(ownMass, strokeMass(crop, c.x, c.y))
  let nbMass = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let adv = P.advMin + 1; adv < P.advMax; adv++) {
      nbMass = Math.max(nbMass, strokeMass(crop, last.x + adv, last.y + dy), strokeMass(crop, first.x - adv, first.y + dy))
    }
  }
  const neighbor = ownMass > 0 ? round3(nbMass / ownMass) : 0
  // 三位數:末位之後還有一位(4 位數堆疊;縮放 / 模糊後 ① 抓不到)→ 在延伸裁切區看同一個筆畫量條件(只看右側;隔壁格的數字在延伸區外)
  let fourth = false
  if (rc && chain.length >= P.maxDigits && ownMass > 0) {
    let m = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let adv = P.advMin + 1; adv < P.advMax; adv++) m = Math.max(m, strokeMass(rc, last.x + adv, last.y + dy))
    }
    fourth = m / ownMass >= P.neighborMass
  }
  const chainOut = chain.map(c => ({ x: c.x, y: c.y, d: c.d }))
  // 數字帶(基準像素,夾在裁切區內):數字列 ± 2、左緣到末位右側再一位
  const by0 = Math.max(0, Math.min(...chain.map(c => c.y)) - 2)
  const by1 = Math.min(crop.h, Math.max(...chain.map(c => c.y)) + QTY_TEMPLATE_H + 2)
  const bx1 = Math.min(crop.w, last.x + QTY_TEMPLATE_W + P.advMax)
  const bandBase = { x: 0, y: by0, w: Math.max(1, bx1), h: Math.max(1, by1 - by0) }
  const base = { confidence, margin, raw, chain: chainOut, neighbor, bandBase }
  // 遮罩蓋到數字列(左緣到末位右側一格寬)→ 不確定(數字可能被我們的徽章蓋掉一部分);延伸區(4 位數的第 4 位)同樣要沒被蓋
  for (const m of [crop, rc !== crop ? rc : null]) {
    if (!m?.masked) continue
    const x1 = Math.min(m.w, last.x + QTY_TEMPLATE_W + P.advMax)
    for (let y = by0; y < by1; y++) {
      for (let x = 0; x < x1; x++) {
        if (m.masked[y * m.w + x]) return { qty: null, reason: 'masked', ...base }
      }
    }
  }
  if (chain.length > P.maxDigits) return { qty: null, reason: 'too-many', ...base }
  if (raw.length > 1 && raw[0] === '0') return { qty: null, reason: 'leading-zero', ...base }
  if (confidence < P.minScore || margin < P.minMargin) return { qty: null, reason: 'low-confidence', ...base }
  if (confidence < P.lowScore && margin < P.lowScoreMargin) return { qty: null, reason: 'low-confidence', ...base }
  if (!rc || fourth || resid >= P.residCount || (chain.length < P.maxDigits && neighbor >= P.neighborMass)) return { qty: null, reason: 'missed-digit', ...base }
  // 堆疊數不可能是 0:單獨的「0」是誤讀(不當成空格)
  if (raw === '0') return { qty: null, reason: 'zero', ...base }
  return { qty: Number(raw), reason: 'ok', ...base }
}

function round3 (v: number): number {
  return Math.round(v * 1000) / 1000
}

export interface QtyReadOptions {
  /** 遊戲 client 高(實體像素) */
  clientH: number
  /** 我們畫在遊戲上的東西(影像像素);蓋到數字的格回 `masked` */
  mask?: readonly QtyRect[]
}

function insideImage (img: QtyImage, r: { x: number, y: number, w: number, h: number }): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= img.width && r.y + r.h <= img.height
}

/** 讀一格的堆疊數量。`cell` = 影像像素的格子矩形(client 座標減擷取偏移)。裁切區超出影像 → null(`outside`,不當成空格) */
export function readCellQuantity (img: QtyImage, cell: QtyRect, templates: DigitTemplates, opts: QtyReadOptions): QtyResult {
  const rect = qtyCropRect(cell, opts.clientH, templates.baseClientH)
  if (!insideImage(img, rect)) return { qty: null, confidence: 0, margin: 0, reason: 'outside' }
  const crop = qtyCrop(img, cell, opts.clientH, templates.baseClientH, opts.mask)
  const ext = (): QtyCrop | null => {
    const er = qtyCropRect(cell, opts.clientH, templates.baseClientH, QTY_PARAMS.extW)
    return insideImage(img, er) ? qtyCrop(img, cell, opts.clientH, templates.baseClientH, opts.mask, QTY_PARAMS.extW) : null
  }
  const r = decodeQtyCrop(crop, templates, ext)
  const out: QtyResult = { qty: r.qty, confidence: r.confidence, margin: r.margin, reason: r.reason }
  if (r.raw != null) out.raw = r.raw
  if (r.bandBase) {
    const b = r.bandBase
    out.band = { x: crop.x0 + b.x * crop.k, y: crop.y0 + b.y * crop.k, w: b.w * crop.k, h: b.h * crop.k }
  }
  return out
}

/**
 * 變化偵測用的便宜簽章:裁切區(原解析度、不縮放)分 4 條直帶的白色程度總和(遮罩蓋到的像素不算)。
 * 數字改變 → 至少一條直帶差很多;畫面靜止 → 完全相同。
 */
export function qtyCellSignature (img: QtyImage, cell: QtyRect, clientH: number, baseClientH: number, mask?: readonly QtyRect[]): number[] {
  return qtyMapSignature(qtyWhiteMap(img, cell, clientH, baseClientH), mask)
}

/**
 * 裁切區(原解析度、不縮放,夾在影像內)的白色程度圖:變化偵測用(與 `qtyMapSignature` / `qtyShapeChanged` 搭配;
 * 存一份「上次乾淨讀數時」的圖,被遮時比露出的部分)。`v` = 白色程度;`g` = 減 `whiteBase` 前的值 min − (max − min)(可為負,變暗時等比例縮小)
 */
export interface QtyWhiteMap { x: number, y: number, w: number, h: number, v: Float32Array, g: Float32Array }

export function qtyWhiteMap (img: QtyImage, cell: QtyRect, clientH: number, baseClientH: number): QtyWhiteMap {
  const c = qtyCropRect(cell, clientH, baseClientH)
  const x0 = Math.max(0, Math.round(c.x))
  const y0 = Math.max(0, Math.round(c.y))
  const x1 = Math.min(img.width, Math.round(c.x + c.w))
  const y1 = Math.min(img.height, Math.round(c.y + c.h))
  const w = Math.max(0, x1 - x0)
  const h = Math.max(0, y1 - y0)
  const v = new Float32Array(w * h)
  const g = new Float32Array(w * h)
  const ch = img.channels
  const data = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y0 + y) * img.width + x0 + x) * ch
      const r = data[p]
      const gg = data[p + 1]
      const b = data[p + 2]
      const mn = Math.min(r, gg, b)
      const raw = mn - (Math.max(r, gg, b) - mn)
      g[y * w + x] = raw
      v[y * w + x] = Math.max(0, raw - QTY_PARAMS.whiteBase)
    }
  }
  return { x: x0, y: y0, w, h, v, g }
}

/** 白色程度圖分 4 條直帶的總和(`mask` 蓋到的像素不算)。同一組遮罩下比兩張圖 = 「露出的部分有沒有變」 */
export function qtyMapSignature (map: QtyWhiteMap, mask?: readonly QtyRect[]): number[] {
  const sig = [0, 0, 0, 0]
  if (!map.w || !map.h) return sig
  const span = map.w / 4
  const ms = mask?.filter(m => overlaps(m, map)) ?? []
  for (let y = 0; y < map.h; y++) {
    const Y = map.y + y
    for (let x = 0; x < map.w; x++) {
      const v = map.v[y * map.w + x]
      if (v <= 0) continue
      const X = map.x + x
      if (ms.length && ms.some(m => X >= m.x && X < m.x + m.w && Y >= m.y && Y < m.y + m.h)) continue
      sig[Math.min(3, Math.floor(x / span))] += v
    }
  }
  return sig
}

/** 字形相似度(`qtyShapeChanged` 的 NCC)低於這個值 = 變了。徽章陰影(上方漸層變暗 2–15%)≈ 1.000;換成別的數字的格 ≤ 0.85 */
export const QTY_SHAPE_MIN_NCC = 0.97

/**
 * 兩張圖露出部分(`mask` 蓋到的不算)的字形是否不同:`g` 的正規化互相關(NCC)< `QTY_SHAPE_MIN_NCC`。
 * 不受亮度整體縮放影響 → 拿「沒有徽章時」的乾淨圖與「多了徽章(陰影讓數字變暗)」的畫面比,只有字形變了才算變。
 * 兩張圖位置 / 大小不同 → 視為變了。
 */
export function qtyShapeChanged (a: QtyWhiteMap, b: QtyWhiteMap, mask?: readonly QtyRect[]): boolean {
  if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) return true
  const ms = mask?.filter(m => overlaps(m, a)) ?? []
  let n = 0
  let sa = 0
  let sb = 0
  let saa = 0
  let sbb = 0
  let sab = 0
  for (let y = 0; y < a.h; y++) {
    const Y = a.y + y
    for (let x = 0; x < a.w; x++) {
      const X = a.x + x
      if (ms.length && ms.some(m => X >= m.x && X < m.x + m.w && Y >= m.y && Y < m.y + m.h)) continue
      const u = a.g[y * a.w + x]
      const v = b.g[y * a.w + x]
      n++; sa += u; sb += v; saa += u * u; sbb += v * v; sab += u * v
    }
  }
  if (n < 2) return false
  const va = saa - sa * sa / n
  const vb = sbb - sb * sb / n
  // 露出部分是平的(沒有字形):兩張都平才算沒變
  if (!(va > 1e-6) || !(vb > 1e-6)) return (va > 1e-6) !== (vb > 1e-6)
  return (sab - sa * sb / n) / Math.sqrt(va * vb) < QTY_SHAPE_MIN_NCC
}

/** 簽章差:任一直帶差超過這個值 = 變了(約 2 個純白像素) */
export const QTY_SIGNATURE_TOLERANCE = 250

export function qtySignatureChanged (a: readonly number[] | undefined, b: readonly number[]): boolean {
  if (!a || a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > QTY_SIGNATURE_TOLERANCE) return true
  return false
}

// ---------------- 訓練(scripts/build-stash-digit-templates.mjs、測試的留一驗證) ----------------

interface Comp { x0: number, y0: number, x1: number, y1: number }

/** 數字連通元件(4 連通;最暗通道 ≥ 170、色差 ≤ 50) */
function digitComponents (crop: QtyCrop): Comp[] {
  const { w, h, rgb } = crop
  const m = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3]
    const g = rgb[i * 3 + 1]
    const b = rgb[i * 3 + 2]
    const mn = Math.min(r, g, b)
    const mx = Math.max(r, g, b)
    m[i] = mn >= QTY_PARAMS.trainWhite && mx - mn <= QTY_PARAMS.trainSat ? 1 : 0
  }
  const lab = new Int32Array(w * h).fill(-1)
  const out: Comp[] = []
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i] >= 0) continue
    const st = [i]
    lab[i] = out.length
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1
    while (st.length) {
      const k = st.pop()!
      const x = k % w
      const y = (k - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const kk = ny * w + nx
        if (m[kk] && lab[kk] < 0) { lab[kk] = out.length; st.push(kk) }
      }
    }
    out.push({ x0, y0, x1, y1 })
  }
  return out
}

function normalize (a: ArrayLike<number>): Float64Array {
  let mean = 0
  for (let i = 0; i < a.length; i++) mean += a[i]
  mean /= a.length
  const o = new Float64Array(a.length)
  let s = 0
  for (let i = 0; i < a.length; i++) { o[i] = a[i] - mean; s += o[i] * o[i] }
  s = Math.sqrt(s) || 1
  for (let i = 0; i < o.length; i++) o[i] /= s
  return o
}

/**
 * 一格的訓練樣本:數字連通元件數 = 真值位數才採用(否則回 [];例如兩位數黏在一起),每位以元件中心對齊取 11×15 白色程度、正規化。
 */
export function digitSamples (crop: QtyCrop, truth: number): Array<{ d: number, v: Float64Array }> {
  const str = String(truth)
  let cs = digitComponents(crop).filter(c => {
    const ch = c.y1 - c.y0 + 1
    const cw = c.x1 - c.x0 + 1
    return ch >= 10 && ch <= 15 && cw >= 2 && cw <= 10 && c.y0 <= crop.h * 0.5
  })
  if (!cs.length) return []
  const top = Math.min(...cs.map(c => c.y0))
  cs = cs.filter(c => c.y0 <= top + 3).sort((a, b) => a.x0 - b.x0)
  if (cs.length !== str.length) return []
  return cs.map((c, i) => {
    const px = Math.round((c.x0 + c.x1) / 2 - (QTY_TEMPLATE_W - 1) / 2)
    const py = Math.round((c.y0 + c.y1) / 2 - (QTY_TEMPLATE_H - 1) / 2)
    const patch = new Float64Array(TN)
    for (let y = 0; y < QTY_TEMPLATE_H; y++) {
      for (let x = 0; x < QTY_TEMPLATE_W; x++) {
        const X = px + x
        const Y = py + y
        patch[y * QTY_TEMPLATE_W + x] = X >= 0 && Y >= 0 && X < crop.w && Y < crop.h ? crop.white[Y * crop.w + X] : 0
      }
    }
    return { d: Number(str[i]), v: normalize(patch) }
  })
}

/** 樣本平均後正規化;值四捨五入到 5 位小數(輸出可逐位元組重現) */
export function buildDigitTemplates (samples: Iterable<{ d: number, v: ArrayLike<number> }>, baseClientH: number): DigitTemplates {
  const acc = Array.from({ length: 10 }, () => ({ sum: new Float64Array(TN), n: 0 }))
  for (const s of samples) {
    const a = acc[s.d]
    for (let i = 0; i < TN; i++) a.sum[i] += s.v[i]
    a.n++
  }
  return {
    schema: 1,
    w: QTY_TEMPLATE_W,
    h: QTY_TEMPLATE_H,
    baseClientH,
    counts: acc.map(a => a.n),
    digits: acc.map(a => a.n ? Array.from(normalize(a.sum), v => Math.round(v * 1e5) / 1e5) : null)
  }
}

export function parseDigitTemplates (json: unknown): DigitTemplates {
  const o = json as Partial<DigitTemplates> | null
  if (!o || typeof o !== 'object' || o.schema !== 1) throw new Error('digit templates:schema 不符')
  if (o.w !== QTY_TEMPLATE_W || o.h !== QTY_TEMPLATE_H) throw new Error('digit templates:模板大小不符')
  if (typeof o.baseClientH !== 'number' || !(o.baseClientH > 0)) throw new Error('digit templates:缺 baseClientH')
  if (!Array.isArray(o.digits) || o.digits.length !== 10) throw new Error('digit templates:digits 必須 10 個')
  for (const d of o.digits) {
    if (d != null && (!Array.isArray(d) || d.length !== TN || d.some(v => typeof v !== 'number'))) throw new Error('digit templates:模板格式不符')
  }
  return o as DigitTemplates
}
