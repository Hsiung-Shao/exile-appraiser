// exile-appraiser 效能修正第 18 步:遮掉我們自己畫在遊戲上的徽章(scan-mask.ts)+ 掃描迴圈的 ack 等待(panel-scan.ts drawPending)。
// ① 純函式:IPC 資料整理、CSS → client → 影像座標換算與外擴、保留期、ack / 逾時、填色、差分「不比」格。
// ② 假時鐘 + 假世界(真實截圖 fullscreen-02 的 OCR 快照當遊戲畫面;renderer 收到 rows 就在每組右側畫徽章;
//    假 OCR 會把「畫面上、沒被遮掉」的徽章文字併進最近的那一行 = WinRT 實際行為,見使用者 log #32–#40):
//    不遮 → 重現「3 組 → 清除 → 3 組 → …」循環(實機 log 另有中間掉成 2 組的一步,取決於 WinRT 怎麼併行);遮罩 + ack → 一直 3 組、不清除、徽章出現本身不再觸發 OCR;
//    renderer → main 的 IPC 比 paint 慢(競態)時,沒有 ack 等待會截到沒遮的徽章,有等待就不會。
// 不啟動 Electron、不跑 OCR、不送任何輸入。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RevealScanEvent } from '@ipc/types'
import { buildLocateIndex, lineLooksLikeMod, type LocateIndex, type LocateTiersLike } from '../../poe2/src/desecration/ocr-locate'
import { GROUP_GAP_RATIO } from '../../poe2/src/desecration/ocr-text'
import { frameDiff, isChanged, isLargeChange, tileMaxDiff, type Fingerprint, type ScanCapture, type ScanClock } from '../src/ocr/panel-scan'
import { RevealScan } from '../src/ocr/reveal-scan'
import {
  MASK_ACK_TIMEOUT_MS, MASK_FEATHER_PX, MASK_LINGER_MS, MASK_PAD_CSS_PX, ScanMaskStore, clipRects, fillMaskRects, fingerprintIgnore, sanitizeMaskReport,
  type MaskRect
} from '../src/ocr/scan-mask'

const ROOT = path.resolve(__dirname, '../..')

// ---------------- ① 純函式 ----------------

describe('sanitizeMaskReport:IPC 進來的資料', () => {
  it('合法的照收;壞矩形丟掉;來源 / 視窗大小不合法整份不收', () => {
    expect(sanitizeMaskReport({ source: 'reveal', seq: 3, viewport: { w: 1600, h: 900 }, rects: [{ x: 1, y: 2, w: 3, h: 4 }, { x: 0, y: 0, w: 0, h: 5 }, { x: 'a' }, null] }))
      .toEqual({ source: 'reveal', seq: 3, viewport: { w: 1600, h: 900 }, rects: [{ x: 1, y: 2, w: 3, h: 4 }] })
    expect(sanitizeMaskReport({ source: 'rune', viewport: { w: 10, h: 10 } })).toEqual({ source: 'rune', viewport: { w: 10, h: 10 }, rects: [] })
    expect(sanitizeMaskReport({ source: 'x', viewport: { w: 10, h: 10 }, rects: [] })).toBeNull()
    expect(sanitizeMaskReport({ source: 'reveal', viewport: { w: 0, h: 10 }, rects: [] })).toBeNull()
    expect(sanitizeMaskReport(null)).toBeNull()
  })
})

describe('ScanMaskStore:座標換算、保留期、ack', () => {
  it('CSS → client(× client.w / innerWidth,dpr 1.5)外擴 3 CSS px、外取整;再減擷取偏移、夾在影像內', () => {
    const st = new ScanMaskStore()
    st.report({ source: 'reveal', viewport: { w: 1600, h: 900 }, rects: [{ x: 100, y: 50, w: 200, h: 20 }] }, 0)
    const p = MASK_PAD_CSS_PX
    const x0 = Math.floor((100 - p) * 1.5)
    const y0 = Math.floor((50 - p) * 1.5)
    expect(st.clientRects({ w: 2400, h: 1350 }, 0)).toEqual([{ x: x0, y: y0, w: Math.ceil((300 + p) * 1.5) - x0, h: Math.ceil((70 + p) * 1.5) - y0 }])
    // 影像左上在 client (200, 0)(遊戲視窗部分在螢幕外):x 平移、左邊被裁
    expect(st.imageRects({ w: 2400, h: 1350 }, { x: 200, y: 0 }, { w: 2200, h: 1350 }, 0)).toEqual([{ x: 0, y: y0, w: Math.ceil((300 + p) * 1.5) - 200, h: Math.ceil((70 + p) * 1.5) - y0 }])
    // client 大小與 overlay 視窗不同步(改大小中):照這次擷取的 client 換算
    expect(st.clientRects({ w: 1600, h: 900 }, 0)[0]).toEqual({ x: 97, y: 47, w: 206, h: 26 })
  })

  it('被取代的矩形再遮 300 ms(DOM 已移除、畫面上可能還有一兩幀);兩個來源各一份', () => {
    const st = new ScanMaskStore()
    const vp = { w: 100, h: 100 }
    st.report({ source: 'reveal', viewport: vp, rects: [{ x: 10, y: 10, w: 10, h: 10 }] }, 0)
    st.report({ source: 'rune', viewport: vp, rects: [{ x: 50, y: 50, w: 10, h: 10 }] }, 0)
    st.report({ source: 'reveal', viewport: vp, rects: [] }, 1000)
    expect(st.clientRects({ w: 100, h: 100 }, 1000)).toHaveLength(2)
    expect(st.clientRects({ w: 100, h: 100 }, 1000 + MASK_LINGER_MS - 1)).toHaveLength(2)
    expect(st.clientRects({ w: 100, h: 100 }, 1000 + MASK_LINGER_MS)).toEqual([{ x: 47, y: 47, w: 16, h: 16 }])
    // 同一份重送不進保留期(不會累積)
    st.report({ source: 'rune', viewport: vp, rects: [{ x: 50, y: 50, w: 10, h: 10 }] }, 2000)
    expect(st.clientRects({ w: 100, h: 100 }, 2000)).toHaveLength(1)
  })

  it('送出 rows 後 pending,直到 renderer ack 同一個 seq(或更新的);逾時自動放行;另一個來源的 ack 不算', () => {
    const st = new ScanMaskStore()
    const vp = { w: 100, h: 100 }
    expect(st.pending(0)).toBe(false)
    st.noteSent('reveal', 5, 0)
    expect(st.pending(10)).toBe(true)
    st.report({ source: 'rune', seq: 9, viewport: vp, rects: [] }, 20)
    expect(st.pending(20)).toBe(true)
    st.report({ source: 'reveal', seq: 4, viewport: vp, rects: [] }, 30)
    expect(st.pending(30)).toBe(true)
    // 沒帶 seq 的報告(純外觀變動)不算 ack
    st.report({ source: 'reveal', viewport: vp, rects: [] }, 35)
    expect(st.pending(35)).toBe(true)
    st.report({ source: 'reveal', seq: 5, viewport: vp, rects: [] }, 40)
    expect(st.pending(40)).toBe(false)
    st.noteSent('reveal', 6, 100)
    expect(st.pending(100 + MASK_ACK_TIMEOUT_MS - 1)).toBe(true)
    expect(st.pending(100 + MASK_ACK_TIMEOUT_MS)).toBe(false)
  })
})

/** w × h 的 4 通道影像,每個像素 = f(x, y) */
function image (w: number, h: number, f: (x: number, y: number) => [number, number, number]): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; const c = f(x, y); px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255 }
  return px
}
const pix = (px: Uint8Array, w: number, x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4))

describe('fillMaskRects:填色', () => {
  // 暗底(20, 22, 30),中間一塊亮色「徽章」(x 20–59, y 10–19)
  const W = 80
  const H = 30
  const inBadge = (x: number, y: number) => x >= 20 && x < 60 && y >= 10 && y < 20
  const src = () => image(W, H, (x, y) => inBadge(x, y) ? [236, 230, 216] : [20, 22, 30])

  it('矩形內填成外緣中位色(= 背景)、alpha 不動、矩形外一個像素都不動', () => {
    const px = src()
    const before = px.slice()
    const n = fillMaskRects(px, W, H, [{ x: 18, y: 8, w: 44, h: 14 }], 'ring-median')
    expect(n).toBe(44 * 14)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = x >= 18 && x < 62 && y >= 8 && y < 22
        if (inside) expect(pix(px, W, x, y)).toEqual([20, 22, 30, 255])
        else expect(pix(px, W, x, y)).toEqual(pix(before, W, x, y))
      }
    }
  })

  it('feather(runtime 預設):靠邊 4 px 從外圈原像素漸變到填色,中間 = 中位色;背景有紋理時邊緣不是硬邊', () => {
    // 背景左右兩半顏色不同(左 10、右 40):中位色取其一,靠邊的格子往各自的外圈原色漸變
    const px = image(W, H, (x, y) => inBadge(x, y) ? [236, 230, 216] : x < 40 ? [10, 10, 10] : [40, 40, 40])
    fillMaskRects(px, W, H, [{ x: 18, y: 8, w: 44, h: 14 }])
    const mid = pix(px, W, 40, 15)[0]
    expect([10, 40]).toContain(mid)
    // 左緣第一格:1/5 填色 + 4/5 外圈原色(10)
    expect(pix(px, W, 18, 15)[0]).toBe(Math.round(10 * (1 - 1 / (MASK_FEATHER_PX + 1)) + mid / (MASK_FEATHER_PX + 1)))
    // 右緣第一格:往右邊外圈原色(40)漸變
    expect(pix(px, W, 61, 15)[0]).toBe(Math.round(40 * (1 - 1 / (MASK_FEATHER_PX + 1)) + mid / (MASK_FEATHER_PX + 1)))
    // 徽章的亮色一點都不剩
    for (let y = 10; y < 20; y++) for (let x = 20; x < 60; x++) expect(pix(px, W, x, y)[0]).toBeLessThanOrEqual(40)
  })

  it('相鄰 / 重疊的兩塊:外緣取樣不吃對方的徽章像素;dark = 固定暗色;影像外的部分夾掉;沒有矩形 = 不動', () => {
    const px = image(W, H, (x, y) => (y >= 5 && y < 14) || (y >= 16 && y < 25) ? [250, 250, 250] : [20, 20, 20])
    fillMaskRects(px, W, H, [{ x: 10, y: 4, w: 30, h: 11 }, { x: 10, y: 15, w: 30, h: 11 }], 'ring-median')
    expect(pix(px, W, 20, 9)).toEqual([20, 20, 20, 255])
    expect(pix(px, W, 20, 20)).toEqual([20, 20, 20, 255])
    const d = src()
    fillMaskRects(d, W, H, [{ x: 70, y: -5, w: 50, h: 10 }], 'dark')
    expect(pix(d, W, 75, 0)).toEqual([16, 16, 16, 255])
    expect(pix(d, W, 69, 0)).toEqual([20, 22, 30, 255])
    const e = src()
    expect(fillMaskRects(e, W, H, [])).toBe(0)
    expect(e).toEqual(src())
    expect(clipRects([{ x: -3.5, y: 2.2, w: 5, h: 1 }, { x: 100, y: 0, w: 5, h: 5 }], W, H)).toEqual([{ x: 0, y: 2, w: 2, h: 2 }])
  })
})

describe('差分:遮罩蓋到的縮圖格子不比', () => {
  const fp = (fill: (i: number) => number, ignore?: Uint8Array): Fingerprint => {
    const data = new Uint8Array(64 * 40)
    for (let i = 0; i < data.length; i++) data[i] = fill(i)
    return ignore ? { w: 64, h: 40, data, ignore } : { w: 64, h: 40, data }
  }
  // 影像 640×400 → 縮圖 64×40(1:10);徽章 (300,100) 200×30
  const badge: MaskRect = { x: 300, y: 100, w: 200, h: 30 }
  const crop = { x: 0, y: 0, width: 640, height: 400 }
  const inBadgeCell = (i: number) => { const x = i % 64; const y = Math.floor(i / 64); return x >= 30 && x < 50 && y >= 10 && y < 13 }

  it('fingerprintIgnore:蓋到的格子再外擴 1 格;沒有交集 = undefined', () => {
    const ign = fingerprintIgnore([badge], crop, 64, 40)!
    expect(ign[11 * 64 + 40]).toBe(1)
    expect(ign[9 * 64 + 29]).toBe(1)
    expect(ign[13 * 64 + 50]).toBe(1)
    expect(ign[8 * 64 + 40]).toBe(0)
    expect(ign[11 * 64 + 51]).toBe(0)
    expect(fingerprintIgnore([{ x: 700, y: 0, w: 10, h: 10 }], crop, 64, 40)).toBeUndefined()
    expect(fingerprintIgnore([], crop, 64, 40)).toBeUndefined()
  })

  it('徽章出現(新的一張有 ignore)/ 消失(舊的一張有 ignore)都不算變化;沒遮罩時算(原行為)', () => {
    const clean = fp(() => 40)
    const ign = fingerprintIgnore([badge], crop, 64, 40)
    const withBadge = fp(i => inBadgeCell(i) ? 220 : 40)
    // 沒遮罩:徽章一出現就是「有變化」而且是大幅變化(會立刻 OCR)
    expect(isChanged(frameDiff(clean, withBadge))).toBe(true)
    expect(isLargeChange(clean, withBadge)).toBe(true)
    // 有遮罩
    const masked = fp(i => inBadgeCell(i) ? 220 : 40, ign)
    expect(isChanged(frameDiff(clean, masked))).toBe(false)
    expect(isLargeChange(clean, masked)).toBe(false)
    expect(isChanged(frameDiff(masked, clean))).toBe(false)
    // 遮罩外真的有變化照樣抓得到
    const panel = fp(i => inBadgeCell(i) ? 220 : (i % 64 < 20 ? 120 : 40), ign)
    expect(isLargeChange(clean, panel)).toBe(true)
    // 沒有 ignore 時結果與之前的算法完全相同(逐值)
    const a = fp(i => (i * 7) % 256)
    const b = fp(i => (i * 13) % 256)
    let sum = 0
    let ch = 0
    for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); sum += d; if (d >= 16) ch++ }
    expect(frameDiff(a, b)).toEqual({ mean: sum / a.data.length, changedRatio: ch / a.data.length })
    // 整塊被蓋住 = 沒變化(不是 NaN)
    expect(frameDiff(fp(() => 0, new Uint8Array(64 * 40).fill(1)), fp(() => 255))).toEqual({ mean: 0, changedRatio: 0 })
    expect(tileMaxDiff(fp(() => 0, new Uint8Array(64 * 40).fill(1)), fp(() => 255))).toEqual({ mean: 0, changedRatio: 0 })
  })
})

// ---------------- ② 假時鐘 + 假世界 ----------------

const index: LocateIndex = buildLocateIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe2/desecration/tiers.json'), 'utf8')) as LocateTiersLike)
type Line = { text: string, x: number, y: number, w: number, h: number }
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'poe2/test/desecration/fixtures/ocr/well-of-souls-fullscreen-02.ocr.json'), 'utf8')) as { srcW: number, srcH: number, scale: number, lines: Line[] }
const SCREEN = { w: snap.srcW, h: snap.srcH, lines: snap.lines.map(l => ({ text: l.text, x: l.x / snap.scale, y: l.y / snap.scale, w: l.w / snap.scale, h: l.h / snap.scale })) }
/** 使用者框的區域(client 比例):面板 + 右邊徽章的位置(log 的 1258×907 區域同樣包住徽章) */
const REGION = { x: 0.2, y: 0.4, w: 0.5, h: 0.4 }
const DPR = 1.25

function fakeClock () {
  let t = 0
  let id = 0
  const timers = new Map<number, { at: number, fn: () => void }>()
  const clock: ScanClock = {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id },
    clearTimeout: (h) => { timers.delete(h as number) }
  }
  async function advance (ms: number) {
    const end = t + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next) break
      timers.delete(next[0])
      t = next[1].at
      next[1].fn()
      for (let i = 0; i < 50; i++) await Promise.resolve()
    }
    t = end
  }
  return { clock, advance }
}

/** renderer 的分組(簡化 matchReveal):像詞綴的行依 y 分組,相鄰中心距 > 1.9 × 行高 = 下一組 */
function groupsOf (rows: Line[]): Line[][] {
  const hits = rows.filter(l => lineLooksLikeMod(l.text, index)).sort((a, b) => a.y - b.y)
  const out: Line[][] = []
  for (const l of hits) {
    const g = out[out.length - 1]
    const prev = g?.[g.length - 1]
    if (prev && (l.y + l.h / 2) - (prev.y + prev.h / 2) <= GROUP_GAP_RATIO * l.h) g.push(l)
    else out.push([l])
  }
  return out
}

interface WorldOpts {
  /** 遮罩(renderer 回報 + main 擷取後填掉 / 差分不比) */
  mask: boolean
  /** main 送出 rows 後等 renderer ack 才擷取 */
  ackWait: boolean
  /** main → renderer、renderer → main 的 IPC 延遲(ms);paint 在 renderer 收到後 16 ms */
  ipcMs?: number
  intervalMs?: number
}

function world (o: WorldOpts) {
  const clk = fakeClock()
  const ipc = o.ipcMs ?? 2
  const store = new ScanMaskStore()
  /** 畫面上看得到的徽章(client px) */
  let visible: Array<MaskRect & { text: string }> = []
  /** renderer 目前畫著幾組(每次重畫記一筆:時間、組數;清除 = 0) */
  const drawn: Array<{ t: number, groups: number }> = []
  const events: RevealScanEvent[] = []
  let maskedCaptures = 0
  let dirtyCaptures = 0
  // rendererGets 會參考 scan,但 scan 的建構參數又要用到 rendererGets → 先宣告、建構後才賦值(只賦值一次,不能用 const)
  // eslint-disable-next-line prefer-const
  let scan: RevealScan

  const rendererGets = (ev: RevealScanEvent) => {
    let badges: Array<MaskRect & { text: string }> = []
    if (ev.reason === 'rows') {
      const gs = groupsOf(ev.rows)
      // 不是面板(湊不成 ≥ 2 組)→ renderer 清徽章
      if (gs.length >= 2) {
        const right = Math.max(...gs.flat().map(l => l.x + l.w))
        badges = gs.map((g, i) => {
          const top = Math.min(...g.map(l => l.y))
          const bottom = Math.max(...g.map(l => l.y + l.h))
          return { x: right + 14 * DPR, y: (top + bottom) / 2 - 15, w: 230, h: 30, text: `T${i + 1}? · 一般 · 10–20` }
        })
      }
    }
    drawn.push({ t: clk.clock.now(), groups: badges.length })
    // 先送遮罩(DOM 更新後、paint 前),paint 在 16 ms 後;遮罩經 IPC 到 main 要 ipc ms
    if (o.mask) {
      const rep = { source: 'reveal' as const, seq: ev.seq, viewport: { w: SCREEN.w / DPR, h: SCREEN.h / DPR }, rects: badges.map(b => ({ x: b.x / DPR, y: b.y / DPR, w: b.w / DPR, h: b.h / DPR })) }
      clk.clock.setTimeout(() => { store.report(rep, clk.clock.now()); scan.drawSettled() }, ipc)
    }
    clk.clock.setTimeout(() => { visible = badges }, 16)
  }

  scan = new RevealScan({
    clock: clk.clock,
    config: () => ({ enabled: true, game: 'poe2', region: REGION, intervalMs: o.intervalMs ?? 1000 }),
    env: () => ({ overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: SCREEN.w, height: SCREEN.h } }),
    ocrBusy: () => false,
    locateIndex: async () => index,
    drawPending: o.ackWait ? () => store.pending(clk.clock.now()) : undefined,
    capture: async (): Promise<ScanCapture> => {
      const now = clk.clock.now()
      const mask = o.mask ? store.imageRects({ w: SCREEN.w, h: SCREEN.h }, { x: 0, y: 0 }, { w: SCREEN.w, h: SCREEN.h }, now) : []
      const covered = (b: MaskRect) => mask.some(m => b.x >= m.x && b.y >= m.y && b.x + b.w <= m.x + m.w && b.y + b.h <= m.y + m.h)
      // 這一張擷取裡「沒被遮掉」的徽章(擷取當下的畫面)
      const shown = visible.filter(b => !covered(b))
      if (visible.length) { if (shown.length) dirtyCaptures++; else maskedCaptures++ }
      return {
        size: { w: SCREEN.w, h: SCREEN.h },
        offset: { x: 0, y: 0 },
        client: { w: SCREEN.w, h: SCREEN.h },
        masked: mask.length,
        fingerprint: (rect) => {
          const fw = 64
          const fh = Math.max(1, Math.round(rect.height * fw / rect.width))
          const data = new Uint8Array(fw * fh).fill(40)
          for (const b of shown) {
            for (let y = 0; y < fh; y++) {
              for (let x = 0; x < fw; x++) {
                const sx = rect.x + (x + 0.5) * rect.width / fw
                const sy = rect.y + (y + 0.5) * rect.height / fh
                if (sx >= b.x && sx < b.x + b.w && sy >= b.y && sy < b.y + b.h) data[y * fw + x] = 220
              }
            }
          }
          const ign = mask.length ? fingerprintIgnore(mask, rect, fw, fh) : undefined
          return ign ? { w: fw, h: fh, data, ignore: ign } : { w: fw, h: fh, data }
        },
        recognize: async (rect) => {
          const inR = (l: MaskRect) => l.x >= rect.x && l.y >= rect.y && l.x + l.w <= rect.x + rect.width && l.y + l.h <= rect.y + rect.height
          const lines = SCREEN.lines.filter(inR).map(l => ({ ...l }))
          // WinRT:徽章文字併進同一高度最近的那一行(log #33:「此武器的攻擊穿透…」那行黏上 `T1? · 阿姆那姆 · 15–25`)
          for (const b of shown.filter(inR)) {
            const cy = b.y + b.h / 2
            const near = lines.filter(l => Math.abs(l.y + l.h / 2 - cy) <= b.h).sort((p, q) => Math.abs(p.y + p.h / 2 - cy) - Math.abs(q.y + q.h / 2 - cy))[0]
            if (near) { near.text += ` ${b.text}`; near.w = b.x + b.w - near.x } else lines.push({ text: b.text, x: b.x, y: b.y, w: b.w, h: b.h })
          }
          return { lines, ms: 30 }
        }
      }
    },
    send: (ev) => {
      events.push(ev)
      if (ev.reason === 'rows') store.noteSent('reveal', ev.seq, clk.clock.now())
      clk.clock.setTimeout(() => { rendererGets(ev) }, ipc)
    },
    log: () => {}
  })
  return { scan, clk, store, drawn, events, stats: () => ({ maskedCaptures, dirtyCaptures }) }
}

describe('掃描迴圈 × 自己的徽章(假時鐘)', () => {
  it('對照:不遮 → 重現「3 組 → 清除 → 3 組 → …」循環(測試抓得到問題)', async () => {
    const w = world({ mask: false, ackWait: false })
    w.scan.start(0)
    await w.clk.advance(20_000)
    w.scan.stop()
    const seq = w.drawn.map(d => d.groups)
    expect(seq[0]).toBe(3)
    expect(seq.filter(g => g === 3).length).toBeGreaterThanOrEqual(2)
    expect(seq.filter(g => g === 0).length).toBeGreaterThanOrEqual(2)
    expect(w.events.some(e => e.reason === 'empty')).toBe(true)
    expect(w.stats().dirtyCaptures).toBeGreaterThan(0)
  })

  it('遮罩 + ack:畫出 3 組之後一直是 3 組、不清除;徽章出現 / 存在本身不再觸發 OCR', async () => {
    const w = world({ mask: true, ackWait: true })
    w.scan.start(0)
    await w.clk.advance(20_000)
    w.scan.stop()
    expect(w.drawn.map(d => d.groups)).toEqual(w.drawn.map(() => 3))
    expect(w.drawn.length).toBeGreaterThanOrEqual(1)
    expect(w.events.every(e => e.reason === 'rows' && e.rows.length > 0)).toBe(true)
    expect(w.stats().dirtyCaptures).toBe(0)
    expect(w.stats().maskedCaptures).toBeGreaterThan(10)
    // 第一次 OCR 送出 3 組;之後畫面(遮罩外)沒變 → 不再 OCR(徽章出現不算變化)
    expect(w.scan.stats.ocrRuns).toBe(1)
    expect(w.scan.stats.skippedUnchanged).toBeGreaterThan(10)
  })

  it('競態:renderer → main 的 IPC 比 paint 慢(400 ms,掃描間隔 100 ms)— 只遮不等會截到沒遮的新徽章;有 ack 等待就不會', async () => {
    const noWait = world({ mask: true, ackWait: false, ipcMs: 400, intervalMs: 100 })
    noWait.scan.start(0)
    await noWait.clk.advance(10_000)
    noWait.scan.stop()
    expect(noWait.stats().dirtyCaptures).toBeGreaterThan(0)
    expect(noWait.drawn.map(d => d.groups).some(g => g < 3)).toBe(true)

    const wait = world({ mask: true, ackWait: true, ipcMs: 400, intervalMs: 100 })
    wait.scan.start(0)
    await wait.clk.advance(10_000)
    wait.scan.stop()
    expect(wait.stats().dirtyCaptures).toBe(0)
    expect(wait.drawn.map(d => d.groups)).toEqual(wait.drawn.map(() => 3))
    expect(wait.scan.sched.maskWaits).toBeGreaterThan(0)
  })

  it('renderer 沒回應(例如 overlay 重新載入):等滿 1 秒逾時後照常掃描,不會卡死', async () => {
    const w = world({ mask: true, ackWait: true })
    // 攔掉 renderer:事件送出但沒有任何回報
    const st = w.store
    st.noteSent('reveal', 999, 0)
    w.scan.start(0)
    await w.clk.advance(500)
    expect(w.scan.stats.ocrRuns).toBe(0)
    await w.clk.advance(1500)
    expect(w.scan.stats.ocrRuns).toBeGreaterThan(0)
    w.scan.stop()
  })
})
