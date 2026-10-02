/**
 * exile-appraiser(效能修正第 18 步):擷取後、OCR / 差分之前**遮掉我們自己畫在遊戲上的東西**(褻瀆徽章、符文徽章、「?」說明、符文提示)。
 * 不 import electron(main vitest 與 `scripts/ocr-mask-check.mjs` 直接用;只用可抹除的 TS 語法,Node 型別剝除吃得下)。
 *
 * 根因:overlay 原生 `screenshot()`(BitBlt 桌面)與舊的 `desktopCapturer` 都會截到 overlay 視窗。徽章畫在每組右側
 * (左緣 = 組右緣 + 14 px、與該組同高),WinRT 把徽章文字與同一列的詞綴併成一行 → 那組對不上 → 只剩 2 組;再下一輪
 * 只剩 1 行像詞綴 → 判定沒有面板 → 清徽章 → 回到乾淨畫面 → 又是 3 組……約 3 秒一循環(使用者錄影 + log #32–#40)。
 *
 * 流程(docs/reveal-ocr.md「遮掉自己畫的東西」):
 * 1. renderer 每次排版完成 / 變動(DOM 已更新、還沒 paint)送 `scan-mask`:該層目前可見元素的外框(CSS px,相對 overlay 視窗)
 *    + `innerWidth / innerHeight` + 這次處理到的掃描事件 `seq`(ack)。清除時送空陣列。
 * 2. main(`ScanMaskStore`)保存最新一份;擷取時依當次 client 大小換算成 client 實體像素(× client.w / innerWidth,
 *    與 renderer 收結果時的 `innerWidth / client.w` 相反)、外擴 `MASK_PAD_CSS_PX`、再減擷取偏移成影像像素。
 * 3. OCR 前把落在裁切塊內的矩形填成外緣一圈像素的中位色(`fillMaskRects`);差分縮圖把遮罩蓋到的縮圖像素標成「不比」
 *    (`fingerprintIgnore`;前後兩張任一張標了就不比)→ 徽章出現 / 消失本身不算畫面變化。
 * 4. 競態:renderer 在 paint **之前**就送遮罩(IPC 依序送達,比 paint + DWM 合成早);main 另外在送出 `rows` 後、
 *    renderer ack 之前不擷取(`pending`,最多等 `MASK_ACK_TIMEOUT_MS`),ack 到了立刻補一個 tick。
 *    從 DOM 移除的矩形再遮 `MASK_LINGER_MS`(畫面上可能還有一兩幀)。
 */

import type { ScanMaskReport } from '@ipc/types'

export type { ScanMaskReport }

/** 矩形(client / 影像 / CSS 像素,依呼叫端而定) */
export interface MaskRect { x: number, y: number, w: number, h: number }

export type ScanMaskSource = ScanMaskReport['source']

/**
 * 外擴(CSS px):徽章 `box-shadow` 的 1px 外框環 + 第 11 步外框(8 方向 1px text-shadow,在徽章框內)+ 量測取整。
 * 不能大:徽章左緣距該組最右的字只有 14 px(`BADGE_GAP_PX`),外擴太多會蓋到面板自己的字。柔和陰影(blur 32px)不遮 ——
 * 只讓背景變暗,fixture 實驗 OCR 不受影響。
 */
export const MASK_PAD_CSS_PX = 3
/** 從 DOM 移除的矩形再遮這麼久(畫面上可能還有一兩幀) */
export const MASK_LINGER_MS = 300
/** 送出 `rows` 後等 renderer 回報遮罩(ack)最多這麼久;逾時照常擷取(renderer 沒在聽 / 卡住) */
export const MASK_ACK_TIMEOUT_MS = 1000

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** IPC 進來的資料整理成合法的報告(壞的矩形丟掉;整份不合法回 null) */
export function sanitizeMaskReport (r: unknown): ScanMaskReport | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (o.source !== 'reveal' && o.source !== 'rune') return null
  const vp = o.viewport as Record<string, unknown> | undefined
  if (!vp || !finite(vp.w) || !finite(vp.h) || vp.w <= 0 || vp.h <= 0) return null
  const rects: MaskRect[] = []
  if (Array.isArray(o.rects)) {
    for (const x of o.rects.slice(0, 200)) {
      const q = x as Record<string, unknown> | null
      if (q && finite(q.x) && finite(q.y) && finite(q.w) && finite(q.h) && q.w > 0 && q.h > 0) rects.push({ x: q.x, y: q.y, w: q.w, h: q.h })
    }
  }
  const out: ScanMaskReport = { source: o.source, viewport: { w: vp.w, h: vp.h }, rects }
  if (finite(o.seq)) out.seq = o.seq
  if (o.resend === true) out.resend = true
  return out
}

const sameRects = (a: MaskRect[], b: MaskRect[]) =>
  a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h)

interface CssSet { viewport: { w: number, h: number }, rects: MaskRect[] }

/**
 * main 端保存 renderer 回報的遮罩(每個來源一份 + 剛被取代、還在保留期的)與 ack 狀態。
 * main 建一個;擷取函式(`SharedCapture` 的 fn)呼叫 `imageRects`,兩個掃描的 tick 經 `drawPending` 呼叫 `pending`。
 */
export class ScanMaskStore {
  readonly lingerMs: number
  readonly ackTimeoutMs: number
  readonly padCssPx: number
  private readonly current = new Map<ScanMaskSource, CssSet>()
  private lingering: Array<CssSet & { until: number }> = []
  private readonly sent = new Map<ScanMaskSource, { seq: number, at: number }>()
  private readonly acked = new Map<ScanMaskSource, number>()
  /** 測試 / log:收到幾份報告 */
  reports = 0

  constructor (opts: { lingerMs?: number, ackTimeoutMs?: number, padCssPx?: number } = {}) {
    this.lingerMs = opts.lingerMs ?? MASK_LINGER_MS
    this.ackTimeoutMs = opts.ackTimeoutMs ?? MASK_ACK_TIMEOUT_MS
    this.padCssPx = opts.padCssPx ?? MASK_PAD_CSS_PX
  }

  /** renderer 回報(`scan-mask`)。被取代的那份若不同 → 進保留期 */
  report (r: ScanMaskReport, now: number): void {
    this.reports++
    // code review 第 B 批:過期的保留項在這裡也清(否則掃描暫停 / 不擷取時,一直回報會讓 `lingering` 無限累積)
    this.lingering = this.lingering.filter(l => l.until > now)
    const prev = this.current.get(r.source)
    const next: CssSet = { viewport: { w: r.viewport.w, h: r.viewport.h }, rects: r.rects.map(x => ({ x: x.x, y: x.y, w: x.w, h: x.h })) }
    const same = prev != null && sameRects(prev.rects, next.rects) && prev.viewport.w === next.viewport.w && prev.viewport.h === next.viewport.h
    if (prev && prev.rects.length && !same) this.lingering.push({ viewport: prev.viewport, rects: prev.rects, until: now + this.lingerMs })
    this.current.set(r.source, next)
    if (r.seq != null) this.acked.set(r.source, Math.max(this.acked.get(r.source) ?? 0, r.seq))
  }

  /** main 送出會讓 renderer 重畫的掃描事件(`rows`)→ 之後的擷取要等 renderer ack(或逾時) */
  noteSent (source: ScanMaskSource, seq: number, now: number): void {
    this.sent.set(source, { seq, at: now })
  }

  /** 測試:保留期中的份數 */
  get lingeringCount (): number { return this.lingering.length }

  /** 有送出的 `rows` 還沒被 renderer ack、且未逾時 → 先別擷取(畫面上可能已有還沒遮到的新徽章) */
  pending (now: number): boolean {
    for (const [src, s] of this.sent) {
      if ((this.acked.get(src) ?? 0) < s.seq && now - s.at < this.ackTimeoutMs) return true
    }
    return false
  }

  /** 目前要遮的矩形(client 實體像素,已外擴、外取整);`client` = 這次擷取的遊戲 client 大小 */
  clientRects (client: { w: number, h: number }, now: number): MaskRect[] {
    this.lingering = this.lingering.filter(l => l.until > now)
    const out: MaskRect[] = []
    if (!(client.w > 0 && client.h > 0)) return out
    const add = (s: CssSet) => {
      const sx = client.w / s.viewport.w
      const sy = client.h / s.viewport.h
      const p = this.padCssPx
      for (const r of s.rects) {
        const x0 = Math.floor((r.x - p) * sx)
        const y0 = Math.floor((r.y - p) * sy)
        const x1 = Math.ceil((r.x + r.w + p) * sx)
        const y1 = Math.ceil((r.y + r.h + p) * sy)
        if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      }
    }
    for (const s of this.current.values()) add(s)
    for (const s of this.lingering) add(s)
    return out
  }

  /** 擷取影像像素座標(client − 擷取偏移),夾在影像內;沒有交集的丟掉 */
  imageRects (client: { w: number, h: number }, offset: { x: number, y: number }, size: { w: number, h: number }, now: number): MaskRect[] {
    return clipRects(this.clientRects(client, now).map(r => ({ x: r.x - offset.x, y: r.y - offset.y, w: r.w, h: r.h })), size.w, size.h)
  }
}

/** 夾在 `w × h` 內並取整(往外取到整數像素);沒有交集的丟掉 */
export function clipRects (rects: MaskRect[], w: number, h: number): MaskRect[] {
  const out: MaskRect[] = []
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x))
    const y0 = Math.max(0, Math.floor(r.y))
    const x1 = Math.min(w, Math.ceil(r.x + r.w))
    const y1 = Math.min(h, Math.ceil(r.y + r.h))
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }
  return out
}

/**
 * 填色方式:
 * - `feather`(runtime 用):外緣中位色實心填滿,靠邊 `MASK_FEATHER_PX` 像素從外圈原像素漸變到填色(不留硬邊)。
 * - `ring-median`:只填外緣中位色(邊緣是硬邊)。
 * - `dark`:固定暗色 `MASK_DARK`。
 * 2026-10-02 `scripts/ocr-mask-check.mjs` 實驗(5 張 fixture × dpr 1 / 1.5 × 自動定位框 / 手動框 = 20 個情境,真 WinOcr):
 * 比對結果與無徽章原圖相同 feather 20 / ring-median 19 / dark 20、行文字逐字相同 17 / 18 / 16
 * (對照:原圖掃描區平移 1 px,比對 20、逐字只有 8 —— 逐字差異在 WinRT 本身的雜字範圍內);ring-median 有一列尾巴多了「ㄗ」被判成面板外。
 * Coons 曲面內插(四邊往內插)試過,逐字 12 / 20,不採用。
 */
export type MaskFill = 'feather' | 'ring-median' | 'dark'
/** `dark` 的填色(三個色版同值);也是取不到外緣像素時的後援 */
export const MASK_DARK = 16
/** 外緣取樣:矩形外第 1–`MASK_RING_PX` 圈 */
export const MASK_RING_PX = 2
/** `feather` 靠邊漸變的寬度(影像像素) */
export const MASK_FEATHER_PX = 4

/**
 * 把 4 通道影像(`px`,BGRA / RGBA 都可:只逐通道處理前 3 個,alpha 不動)裡的 `rects`(影像像素)遮掉,原地修改。
 * 填色 = 每個矩形外第 1–2 圈、不落在任何遮罩內的像素逐通道取中位數(接近周圍背景,不在面板暗底上留亮塊);
 * 全部先取樣再填,相鄰 / 重疊的徽章不會吃到彼此的填色。回傳填了幾個像素。
 */
export function fillMaskRects (px: Uint8Array, width: number, height: number, rects: MaskRect[], fill: MaskFill = 'feather'): number {
  const rs = clipRects(rects, width, height)
  if (!rs.length) return 0
  const inAny = (x: number, y: number) => rs.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  const colors = rs.map(r => fill === 'dark' ? [MASK_DARK, MASK_DARK, MASK_DARK] : ringMedian(px, width, height, r, inAny))
  // feather:填之前先記下每個矩形外第 1 圈的原像素
  const borders = fill === 'feather' ? rs.map(r => outerBorder(px, width, height, r, inAny)) : []
  let filled = 0
  rs.forEach((r, i) => {
    const c = colors[i]
    for (let y = r.y; y < r.y + r.h; y++) {
      let o = (y * width + r.x) * 4
      for (let x = 0; x < r.w; x++, o += 4) {
        px[o] = c[0]
        px[o + 1] = c[1]
        px[o + 2] = c[2]
      }
    }
    filled += r.w * r.h
  })
  if (fill === 'feather') rs.forEach((r, i) => { featherEdges(px, width, r, colors[i], borders[i]) })
  return filled
}

/** 外第 1–`MASK_RING_PX` 圈(影像內、不在任何遮罩內)逐通道中位數;一個都取不到 → `MASK_DARK` */
function ringMedian (px: Uint8Array, width: number, height: number, r: MaskRect, inAny: (x: number, y: number) => boolean): number[] {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  let n = 0
  const sample = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height || inAny(x, y)) return
    const o = (y * width + x) * 4
    hist[0][px[o]]++
    hist[1][px[o + 1]]++
    hist[2][px[o + 2]]++
    n++
  }
  for (let d = 1; d <= MASK_RING_PX; d++) {
    const x0 = r.x - d
    const x1 = r.x + r.w - 1 + d
    const y0 = r.y - d
    const y1 = r.y + r.h - 1 + d
    for (let x = x0; x <= x1; x++) { sample(x, y0); sample(x, y1) }
    for (let y = y0 + 1; y < y1; y++) { sample(x0, y); sample(x1, y) }
  }
  if (!n) return [MASK_DARK, MASK_DARK, MASK_DARK]
  return hist.map(hc => {
    let acc = 0
    for (let v = 0; v < 256; v++) { acc += hc[v]; if (acc * 2 >= n) return v }
    return 255
  })
}

type Px = number[] | null
interface Border { L: Px[], R: Px[], T: Px[], B: Px[] }

/** 矩形外第 1 圈的原像素(影像外 / 別的遮罩內 = null) */
function outerBorder (px: Uint8Array, width: number, height: number, r: MaskRect, inAny: (x: number, y: number) => boolean): Border {
  const at = (x: number, y: number): Px => {
    if (x < 0 || y < 0 || x >= width || y >= height || inAny(x, y)) return null
    const o = (y * width + x) * 4
    return [px[o], px[o + 1], px[o + 2]]
  }
  const b: Border = { L: [], R: [], T: [], B: [] }
  for (let j = 0; j < r.h; j++) { b.L.push(at(r.x - 1, r.y + j)); b.R.push(at(r.x + r.w, r.y + j)) }
  for (let i = 0; i < r.w; i++) { b.T.push(at(r.x + i, r.y - 1)); b.B.push(at(r.x + i, r.y + r.h)) }
  return b
}

/** 靠邊 `MASK_FEATHER_PX` 像素內:從最近一邊的外圈原像素線性漸變到填色(該邊取不到外圈像素就維持填色) */
function featherEdges (px: Uint8Array, width: number, r: MaskRect, c: number[], b: Border) {
  const F = MASK_FEATHER_PX
  for (let j = 0; j < r.h; j++) {
    const band = j < F || j >= r.h - F
    for (let i = 0; i < r.w; i++) {
      if (!band && i === F && r.w - F > F) i = r.w - F
      let d = F
      let src: Px = null
      if (i < d && b.L[j]) { d = i; src = b.L[j] }
      if (r.w - 1 - i < d && b.R[j]) { d = r.w - 1 - i; src = b.R[j] }
      if (j < d && b.T[i]) { d = j; src = b.T[i] }
      if (r.h - 1 - j < d && b.B[i]) { d = r.h - 1 - j; src = b.B[i] }
      if (!src) continue
      const a = (d + 1) / (F + 1)
      const o = ((r.y + j) * width + r.x + i) * 4
      px[o] = Math.round(src[0] * (1 - a) + c[0] * a)
      px[o + 1] = Math.round(src[1] * (1 - a) + c[1] * a)
      px[o + 2] = Math.round(src[2] * (1 - a) + c[2] * a)
    }
  }
}

/**
 * 差分縮圖(影像的 `crop` 這塊縮成 `fw × fh`)中被遮罩蓋到的像素(1 = 不比);再往外擴 1 個縮圖像素(縮放濾鏡會把邊緣混進鄰格)。
 * 沒有交集回 undefined(縮圖照舊全比,與沒遮罩時完全相同)。
 */
export function fingerprintIgnore (rects: MaskRect[], crop: { x: number, y: number, width: number, height: number }, fw: number, fh: number): Uint8Array | undefined {
  if (!rects.length || fw <= 0 || fh <= 0 || crop.width <= 0 || crop.height <= 0) return undefined
  const sx = fw / crop.width
  const sy = fh / crop.height
  let ign: Uint8Array | undefined
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor((r.x - crop.x) * sx) - 1)
    const y0 = Math.max(0, Math.floor((r.y - crop.y) * sy) - 1)
    const x1 = Math.min(fw, Math.ceil((r.x + r.w - crop.x) * sx) + 1)
    const y1 = Math.min(fh, Math.ceil((r.y + r.h - crop.y) * sy) + 1)
    if (x1 <= x0 || y1 <= y0) continue
    ign ??= new Uint8Array(fw * fh)
    for (let y = y0; y < y1; y++) ign.fill(1, y * fw + x0, y * fw + x1)
  }
  return ign
}
