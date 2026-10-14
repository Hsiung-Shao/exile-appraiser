/**
 * 倉庫價值(2026-10-15):StashScan 讀每格堆疊數量 V7 / V8 / V13 + 徽章蓋住數字時的 peek。
 * 假時鐘不需要(直接呼叫 tick);擷取 = core/test/stash/fixtures/qty 的真實截圖(client 700×1125,倉庫不在資料夾),
 * 按鈕列 OCR 給合成行(按鈕位置照 core `buttonRects`)。不碰 Electron。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { StashScanEvent } from '@ipc/types'
import type { Fingerprint, ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import { MASK_LINGER_MS, ScanMaskStore } from '../src/ocr/scan-mask'
import { STASH_PEEK_TIMEOUT_MS, StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import { SUBTAB_LABELS, buttonRects, type TextLine } from '../../core/src/stash/detect'
import { cellRects, parseStashLayouts, type StashSubtab } from '../../core/src/stash/layout'
import { parseDigitTemplates, qtyCropRect } from '../../core/src/stash/quantity'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIX = path.join(ROOT, 'core/test/stash/fixtures/qty')
const TRUTH = JSON.parse(fs.readFileSync(path.join(FIX, 'truth.json'), 'utf8')) as Record<StashSubtab, number[]> & { files: Record<StashSubtab, string> }
const LAYOUTS = parseStashLayouts(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/layouts.json'), 'utf8')))
const TEMPLATES = parseDigitTemplates(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/digit-templates.json'), 'utf8')))
const BASE_H = 1125

interface Img { data: Uint8Array, width: number, height: number }
const IMAGES: Record<string, Img> = {}
beforeAll(async () => {
  for (const tab of ['general', 'scarabs'] as const) {
    for (const h of [BASE_H, 1440]) {
      let s = sharp(path.join(FIX, TRUTH.files[tab])).removeAlpha()
      if (h !== BASE_H) s = s.resize({ height: h, kernel: 'lanczos3' })
      const { data, info } = await s.raw().toBuffer({ resolveWithObject: true })
      IMAGES[`${tab}@${h}`] = { data: new Uint8Array(data), width: info.width, height: info.height }
    }
  }
})

/** 合成按鈕列 OCR 行(四顆都在、偏移 0) */
function buttonLines (H: number): TextLine[] {
  return buttonRects(H, 0).map((r, k) => ({ text: SUBTAB_LABELS.zh[k], x: r.x + r.w / 2 - 20, y: Math.floor(201 / 1440 * H) - 8, w: 40, h: 16 }))
}
const BRIGHT: Record<StashSubtab, number[]> = { general: [160, 140, 140, 140], scarabs: [140, 160, 140, 140] }
const fp = (v: number): Fingerprint => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(v) })

type R = { x: number, y: number, w: number, h: number }

/**
 * `store` 模式:遮罩走真的 `ScanMaskStore`(含 300 ms 保留期與 ack),renderer 由 `badgesOf(ev)` 模擬(viewport = client → CSS px = client px);
 * `autoAck` = 每個事件立刻回報遮罩(帶 seq)並通知 `maskReported`。
 */
function harness (tab: StashSubtab = 'scarabs', opts: { H?: number, store?: boolean, autoAck?: boolean, badgesOf?: (ev: StashScanEvent) => R[], onEvent?: (ev: StashScanEvent) => void } = {}) {
  const H = opts.H ?? BASE_H
  const base = IMAGES[`${tab}@${H}`]
  const W = base.width
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 1000, readQuantity: true }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: W, height: H } }
  const state = {
    tab,
    img: { ...base, data: Uint8Array.from(base.data) },
    masks: [] as R[],
    cursorOnCell: false,
    pending: false,
    strip: fp(10),
    now: 10_000
  }
  const timers: Array<{ ms: number }> = []
  const clock: ScanClock = {
    now: () => state.now,
    setTimeout: (_fn, ms) => { timers.push({ ms }); return timers.length },
    clearTimeout: () => {}
  }
  const store = opts.store ? new ScanMaskStore() : null
  const events: StashScanEvent[] = []
  /** renderer 回報目前畫面上的徽章(帶 seq = ack) */
  function report (rects: R[], seq?: number) {
    const rep = { source: 'stash' as const, viewport: { w: W, h: H }, rects, ...(seq != null ? { seq } : {}) }
    store!.report(rep, state.now)
    scan.maskReported(rep)
  }
  const scan: StashScan = new StashScan({
    clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => false,
    capture: async (): Promise<ScanCapture> => {
      const img = state.img
      return {
        size: { w: W, h: H },
        offset: { x: 0, y: 0 },
        client: { w: W, h: H },
        fingerprint: () => state.strip,
        recognize: async () => ({ lines: buttonLines(H), ms: 30 }),
        gray: (rect) => {
          const k = buttonRects(H, 0).findIndex(b => Math.abs(b.x - rect.x) <= 1)
          return new Uint8Array(32).fill(k >= 0 ? BRIGHT[state.tab][k] : 0)
        },
        pixels: (rect) => {
          const x = Math.max(0, Math.round(rect.x))
          const y = Math.max(0, Math.round(rect.y))
          const w = Math.min(img.width - x, Math.round(rect.width))
          const h = Math.min(img.height - y, Math.round(rect.height))
          const out = new Uint8Array(w * h * 3)
          for (let j = 0; j < h; j++) out.set(img.data.subarray(((y + j) * img.width + x) * 3, ((y + j) * img.width + x + w) * 3), j * w * 3)
          return { data: out, width: w, height: h, channels: 3, x, y }
        },
        maskRects: store ? store.imageRects({ w: W, h: H }, { x: 0, y: 0 }, { w: W, h: H }, state.now) : state.masks.map(m => ({ ...m }))
      }
    },
    send: (e) => {
      events.push(e)
      if (!store) return
      store.noteSent('stash', e.seq, state.now)
      opts.onEvent?.(e)
      if (opts.autoAck) report(e.reason === 'show' && !e.peek && opts.badgesOf ? opts.badgesOf(e) : [], e.seq)
    },
    textLang: () => 'zh',
    qty: { layouts: () => LAYOUTS, templates: () => TEMPLATES },
    qtyPaused: () => state.cursorOnCell,
    drawPending: () => store ? store.pending(state.now) : state.pending
  })
  const rects = () => cellRects(LAYOUTS, state.tab, H, 0)
  /** 把 from 格的數字區(裁切區)貼到 to 格 */
  function copyDigits (from: number, to: number) {
    const rs = rects()
    const a = qtyCropRect(rs[from], H, TEMPLATES.baseClientH)
    const b = qtyCropRect(rs[to], H, TEMPLATES.baseClientH)
    const { img } = state
    for (let j = 0; j < Math.round(a.h); j++) {
      for (let i = 0; i < Math.round(a.w); i++) {
        const s = ((Math.round(a.y) + j) * img.width + Math.round(a.x) + i) * 3
        const d = ((Math.round(b.y) + j) * img.width + Math.round(b.x) + i) * 3
        img.data[d] = img.data[s]; img.data[d + 1] = img.data[s + 1]; img.data[d + 2] = img.data[s + 2]
      }
    }
  }
  /** 畫面上畫一塊(模擬徽章:白底字塊) */
  function paint (r: R, v = 255) {
    const { img } = state
    for (let y = Math.max(0, r.y); y < Math.min(img.height, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(img.width, r.x + r.w); x++) {
        const d = (y * img.width + x) * 3
        img.data[d] = v; img.data[d + 1] = v; img.data[d + 2] = v
      }
    }
  }
  return { scan, cfg, env, state, events, rects, copyDigits, paint, report, store, timers, H, W }
}

/** 徽章貼格下緣、格寬(StashPrices.vue:translate(-50%, -100%)、寬 = max(格寬, 28));h = 徽章高(CSS px = client px) */
function bottomBadges (rs: R[], h: number, skip?: (i: number) => boolean): R[] {
  return rs.flatMap((r, i) => skip?.(i) ? [] : [{ x: r.x, y: r.y + r.h - h, w: r.w, h }])
}
/** 一行徽章(不顯示名稱):--fs-xs 11 px × line-height 1.25 + 上下 padding 1 px ≈ 16 px;顯示名稱(兩行)≈ 30 px */
const BADGE_1LINE = 16
const BADGE_NAMES = 30

describe('V8 事件帶數量', () => {
  it('第一次顯示的 show 帶 quantities,長度 = 版面格數,絕大多數與人工判讀相同', async () => {
    const h = harness('scarabs')
    await h.scan.tick()
    const ev = h.events.at(-1)!
    expect(ev).toMatchObject({ reason: 'show', subtab: 'scarabs' })
    expect(ev.quantities).toHaveLength(LAYOUTS.subtabs.scarabs.length)
    const ok = ev.quantities!.filter((q, i) => q === TRUTH.scarabs[i]).length
    const wrong = ev.quantities!.filter((q, i) => q != null && q !== TRUTH.scarabs[i]).length
    // 2026-10-15 放寬低分門檻後 109(改前 109)
    expect(ok).toBeGreaterThanOrEqual(103)
    expect(wrong).toBe(0)
    expect(typeof ev.qtyMs).toBe('number')
    expect(h.scan.snapshot().qtyCells).toBe(115)
  })

  it('一般子頁同樣帶 60 格', async () => {
    const h = harness('general')
    await h.scan.tick()
    expect(h.events.at(-1)?.quantities).toHaveLength(60)
  })
})

describe('V7 只在變化時重讀', () => {
  it('同畫面再掃描:不重讀、不送事件', async () => {
    const h = harness()
    await h.scan.tick()
    const n = h.scan.snapshot().qtyCells
    const evs = h.events.length
    for (let i = 0; i < 3; i++) await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n)
    expect(h.events.length).toBe(evs)
  })

  it('改一格的數字:只重讀那一格,送一次同子頁的 show 帶新數量', async () => {
    const h = harness()
    await h.scan.tick()
    const n = h.scan.snapshot().qtyCells!
    expect(TRUTH.scarabs[24]).toBe(100)
    h.copyDigits(24, 0)
    await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n + 1)
    const ev = h.events.at(-1)!
    expect(ev).toMatchObject({ reason: 'show', subtab: 'scarabs' })
    expect(ev.quantities![0]).not.toBe(44)
    expect(ev.quantities!.slice(1)).toEqual(h.events[0].quantities!.slice(1))
  })

  it('游標停在格子上(遊戲說明框可能蓋住)→ 有變化也先不讀,移開後才讀', async () => {
    const h = harness()
    await h.scan.tick()
    const n = h.scan.snapshot().qtyCells!
    h.state.cursorOnCell = true
    h.copyDigits(24, 0)
    await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n)
    h.state.cursorOnCell = false
    await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n + 1)
  })
})

describe('徽章蓋住數字(peek)', () => {
  it('第一次顯示時畫面上還有舊徽章蓋住格子 → 先送 peek,遮罩清掉後讀完再送不帶 peek 的 show', async () => {
    const h = harness()
    const r0 = h.rects()[0]
    h.state.masks = [{ x: r0.x, y: r0.y, w: r0.w, h: r0.h }]
    await h.scan.tick()
    let ev = h.events.at(-1)!
    expect(ev.peek).toBe(true)
    expect(ev.quantities?.[0] ?? null).toBeNull()
    h.state.masks = []
    await h.scan.tick()
    ev = h.events.at(-1)!
    expect(ev.peek).toBeFalsy()
    expect(ev.quantities![0]).toBe(44)
  })

  it('徽章蓋住後,數字有變(露出的部分變了)→ peek;徽章一直在、畫面沒變 → 不 peek、不重讀', async () => {
    const h = harness()
    await h.scan.tick()
    const rs = h.rects()
    // 徽章蓋住每格下半(含數字下緣)
    h.state.masks = rs.map(r => ({ x: r.x, y: r.y + Math.floor(r.h * 0.4), w: r.w, h: Math.ceil(r.h * 0.6) }))
    const n = h.scan.snapshot().qtyCells!
    const evs = h.events.length
    await h.scan.tick()
    await h.scan.tick()
    expect(h.events.length).toBe(evs)
    expect(h.scan.snapshot().qtyCells).toBe(n)
    h.copyDigits(24, 0)
    await h.scan.tick()
    expect(h.events.at(-1)!.peek).toBe(true)
    // renderer 收起徽章並 ack
    h.state.masks = []
    await h.scan.tick()
    const ev = h.events.at(-1)!
    expect(ev.peek).toBeFalsy()
    expect(ev.quantities![0]).not.toBe(44)
  })

  it('renderer 還沒回報遮罩(ack)→ 這個 tick 不擷取', async () => {
    const h = harness()
    h.state.pending = true
    const r = await h.scan.tick()
    expect(r.kind).toBe('mask-wait')
    expect(h.events).toHaveLength(0)
  })
})

/** 遮罩外擴(main `MASK_PAD_CSS_PX`,viewport = client 時 = client px) */
const padded = (rs: R[], p = 3): R[] => rs.map(r => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 }))

describe('code review:遮罩與 peek 時序', () => {
  it('游標離開格子後、倉庫遮罩報告前不讀數量(不把剛畫出的徽章字讀成數量)', async () => {
    const h = harness('scarabs', { store: true, autoAck: true, badgesOf: () => bottomBadges(h.rects(), BADGE_1LINE) })
    await h.scan.tick()
    const q0 = h.events.at(-1)!.quantities!.slice()
    const r0 = h.rects()[0]
    // 游標進格:renderer 只留那一格(放大、畫在格子下方)
    h.state.now += 500
    h.state.cursorOnCell = true
    h.scan.cursorMoved()
    h.report([{ x: r0.x, y: r0.y + r0.h + 4, w: r0.w * 3, h: 20 }])
    h.state.now += 1000
    // 游標離格:renderer 已把全部徽章畫回畫面上,但遮罩報告還沒到
    h.state.cursorOnCell = false
    h.scan.cursorMoved()
    for (const b of bottomBadges(h.rects(), BADGE_1LINE)) h.paint(b)
    const n = h.scan.snapshot().qtyCells!
    const evs = h.events.length
    await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n)
    // 報告到了:徽章都在遮罩內 → 露出的部分沒變,不讀、不送事件
    h.report(bottomBadges(h.rects(), BADGE_1LINE))
    h.state.now += 50
    await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n)
    expect(h.events.length).toBe(evs)
    expect(q0[0]).toBe(44)
  })

  it('游標離格後超過遮罩保留期仍沒有報告 → 恢復讀數量', async () => {
    const h = harness('scarabs', { store: true, autoAck: true })
    await h.scan.tick()
    const n = h.scan.snapshot().qtyCells!
    h.state.now += 500
    h.scan.cursorMoved()
    h.copyDigits(24, 0)
    h.state.now += MASK_LINGER_MS + 1
    await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n + 1)
  })

  it('倉庫遮罩報告只在等 peek 時才排重看,且延後一個遮罩保留期', async () => {
    const h = harness('scarabs', { store: true })
    const r0 = h.rects()[0]
    h.report([{ x: r0.x, y: r0.y, w: r0.w, h: r0.h }])
    h.scan.start(60_000)
    const t0 = h.timers.length
    h.scan.maskReported({ seq: 99 })
    h.scan.maskReported({})
    expect(h.timers.length).toBe(t0)
    await h.scan.tick()
    const ev = h.events.at(-1)!
    expect(ev.peek).toBe(true)
    const t1 = h.timers.length
    h.report([], ev.seq)
    expect(h.timers.length).toBe(t1 + 1)
    expect(h.timers.at(-1)!.ms).toBeGreaterThan(MASK_LINGER_MS)
  })

  it('main:倉庫遮罩報告交給 maskReported(不再每份都 poke)、游標換格通知 cursorMoved', () => {
    const src = fs.readFileSync(path.join(ROOT, 'main/src/main.ts'), 'utf8')
    const handler = src.slice(src.indexOf("'scan-mask': {"), src.indexOf("'reveal-stats'"))
    expect(handler).toContain('stashScan.maskReported(rep)')
    expect(handler).not.toMatch(/stashScan\.poke\(\)/)
    expect(src).toMatch(/send\('stash-cursor', e\)[^\n]*stashScan\.cursorMoved\(\)|stashScan\.cursorMoved\(\)[^\n]*send\('stash-cursor', e\)/)
  })

  it('peek ack 後遮罩保留期內的 tick 不算等待次數,保留期過後用乾淨畫面讀到新數量', async () => {
    const h = harness('scarabs', { store: true, autoAck: true, badgesOf: () => bottomBadges(h.rects(), BADGE_1LINE) })
    await h.scan.tick()
    h.state.now += 1000
    await h.scan.tick()
    expect(h.events.at(-1)!.quantities![0]).toBe(44)
    h.state.now += 1000
    h.copyDigits(24, 0)
    await h.scan.tick()
    expect(h.events.at(-1)!.peek).toBe(true)
    // ack 立刻到(徽章收起)→ 舊徽章外框還在保留期(300 ms)內;間隔很短時連續幾個 tick 都落在保留期內
    for (let i = 0; i < 5; i++) { h.state.now += 50; await h.scan.tick() }
    h.state.now += MASK_LINGER_MS
    await h.scan.tick()
    const ev = h.events.at(-1)!
    expect(ev.peek).toBeFalsy()
    expect(ev.quantities![0]).toBe(100)
  })

  it('peek 一直等不到徽章收起:以時間判斷,超過等待上限才放棄', async () => {
    const h = harness()
    const r0 = h.rects()[0]
    h.state.masks = [{ x: r0.x, y: r0.y, w: r0.w, h: r0.h }]
    await h.scan.tick()
    expect(h.events.at(-1)!.peek).toBe(true)
    for (let i = 0; i < 10; i++) { h.state.now += 100; await h.scan.tick() }
    expect(h.events.at(-1)!.peek).toBe(true)
    h.state.now += STASH_PEEK_TIMEOUT_MS
    await h.scan.tick()
    expect(h.events.at(-1)!.peek).toBeFalsy()
  })

  it('徽章陰影讓數字變暗(約 15%)不算數量變化,不會 peek', async () => {
    const h = harness('scarabs', { store: true, autoAck: true, badgesOf: () => bottomBadges(h.rects(), BADGE_1LINE) })
    await h.scan.tick()
    const evs = h.events.length
    // 徽章畫上後:陰影讓上方的數字變暗
    const { img } = h.state
    for (const r of h.rects()) {
      for (let y = r.y; y < r.y + r.h - BADGE_1LINE; y++) {
        for (let x = r.x - 3; x < r.x + r.w; x++) {
          const d = (y * img.width + x) * 3
          for (let c = 0; c < 3; c++) img.data[d + c] = Math.round(img.data[d + c] * 0.85)
        }
      }
    }
    h.state.now += 1000
    await h.scan.tick()
    h.state.now += 1000
    await h.scan.tick()
    expect(h.events.slice(evs).filter(e => e.peek)).toEqual([])
  })

  it('徽章出現與數字改變在同一個 tick → 仍與乾淨讀數比對,偵測到變化並 peek', async () => {
    const h = harness()
    await h.scan.tick()
    const rs = h.rects()
    h.state.masks = rs.map(r => ({ x: r.x, y: r.y + Math.floor(r.h * 0.4), w: r.w, h: Math.ceil(r.h * 0.6) }))
    h.copyDigits(24, 0)
    await h.scan.tick()
    expect(h.events.at(-1)!.peek).toBe(true)
  })

  it.each([1125, 1440])('一行徽章貼格下緣時一般頁大部分格不算蓋住數字(client 高 %i):數字改了直接重讀、不 peek', async (H) => {
    const h = harness('general', { H })
    await h.scan.tick()
    expect(TRUTH.general[20]).toBe(70)
    h.state.masks = padded(bottomBadges(h.rects(), BADGE_1LINE))
    await h.scan.tick()
    const m0 = h.scan.counters.qtyMasked
    await h.scan.tick()
    const covered = h.scan.counters.qtyMasked - m0
    h.copyDigits(20, 0)
    await h.scan.tick()
    const ev = h.events.at(-1)!
    // 顯示名稱(兩行)時徽章高約 30 px:實際蓋到數字(數字在格子上 55–65%),只記錄數字
    h.state.masks = padded(bottomBadges(h.rects(), BADGE_NAMES))
    await h.scan.tick()
    const m1 = h.scan.counters.qtyMasked
    await h.scan.tick()
    console.log(`[蓋住數字] general @${H}:一行徽章 ${covered}/60 格、顯示名稱 ${h.scan.counters.qtyMasked - m1}/60 格`)
    expect(covered).toBeLessThanOrEqual(6)
    expect(ev.peek).toBeFalsy()
    expect(ev.quantities![0]).toBe(70)
  })
})

/** 標準常態 CDF(Abramowitz–Stegun 7.1.26) */
function phi (z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}
/** 畫徽章的 box-shadow(0 offsetY blur rgba(0,0,0,alpha);只畫在徽章框外)到乾淨畫面上 */
function withShadow (clean: Uint8Array, width: number, height: number, badges: R[], alpha = 0.55, offsetY = 10, blur = 32): Uint8Array {
  const out = Uint8Array.from(clean)
  const sigma = blur / 2
  const keep = new Float32Array(width * height).fill(1)
  for (const b of badges) {
    const y0 = b.y + offsetY
    const y1 = y0 + b.h
    for (let y = Math.max(0, b.y - 3 * sigma); y < Math.min(height, y1 + 3 * sigma); y++) {
      const ay = phi((y + 0.5 - y0) / sigma) - phi((y + 0.5 - y1) / sigma)
      for (let x = Math.max(0, b.x - 3 * sigma); x < Math.min(width, b.x + b.w + 3 * sigma); x++) {
        const ax = phi((x + 0.5 - b.x) / sigma) - phi((x + 0.5 - b.x - b.w) / sigma)
        keep[y * width + x] *= 1 - alpha * ax * ay
      }
    }
  }
  const inside = (x: number, y: number) => badges.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
  for (let i = 0; i < width * height; i++) {
    if (keep[i] === 1) continue
    if (inside(i % width, Math.floor(i / width))) continue
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(clean[i * 3 + c] * keep[i])
  }
  return out
}

describe('code review 第 2 輪', () => {
  it('最右欄的格子讀三位數不會因像素區不含延伸裁切而永遠不確定', async () => {
    const h = harness()
    const rs = h.rects()
    const right = Math.max(...rs.map(r => r.x))
    const idx = rs.findIndex(r => r.x === right)
    expect(TRUTH.scarabs[24]).toBe(100)
    h.copyDigits(24, idx)
    await h.scan.tick()
    expect(h.events.at(-1)!.quantities![idx]).toBe(100)
  })

  // 實際 --shadow-float(0 10px 32px .55)、更濃、以及陡峭到字形比對必定失準的極端陰影(驗「重讀值沒變 → 停止字形比對」的保險)
  it.each([[0.55, 10, 32], [0.9, 10, 32], [0.95, -6, 8]])('徽章陰影(不透明度 %f、往下 %ipx、模糊 %ipx)畫回後不會 peek 循環', async (alpha, offsetY, blur) => {
    const badges = () => bottomBadges(h.rects(), BADGE_1LINE)
    let clean = new Uint8Array(0)
    const h = harness('scarabs', {
      store: true,
      autoAck: true,
      badgesOf: badges,
      // renderer:徽章畫在畫面上 = 陰影;peek / 收起 = 乾淨畫面
      onEvent: (e) => { h.state.img.data = e.reason === 'show' && !e.peek ? withShadow(clean, h.W, h.H, padded(badges(), 0), alpha, offsetY, blur) : Uint8Array.from(clean) }
    })
    clean = Uint8Array.from(h.state.img.data)
    await h.scan.tick()
    const peeks: number[] = []
    for (let i = 0; i < 12; i++) {
      h.state.now += 1000
      const before = h.events.length
      await h.scan.tick()
      peeks.push(h.events.slice(before).filter(e => e.peek).length)
    }
    console.log(`[陰影 ${alpha} ${offsetY} ${blur}] 每個 tick 的 peek:${peeks.join(',')}`)
    expect(peeks.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1)
    expect(peeks.slice(4)).toEqual(Array(8).fill(0))
    // 數量仍與第一次讀到的相同
    expect(h.events.at(-1)!.quantities![0]).toBe(44)
  })

  it('游標換格後即使先收到換格前就在路上的舊報告,也要等滿遮罩保留期才讀', async () => {
    const h = harness('scarabs', { store: true, autoAck: true })
    await h.scan.tick()
    const n = h.scan.snapshot().qtyCells!
    h.state.now += 1000
    h.scan.cursorMoved()
    // 換格前送出、換格後才到的報告(還是舊畫面)
    h.report([])
    h.copyDigits(24, 0)
    h.state.now += 20
    await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n)
    h.state.now += MASK_LINGER_MS
    await h.scan.tick()
    expect(h.scan.snapshot().qtyCells).toBe(n + 1)
  })
})

describe('V13 關閉讀數量', () => {
  it('readQuantity 關:show 不帶 quantities、不讀', async () => {
    const h = harness()
    h.cfg.readQuantity = false
    await h.scan.tick()
    expect(h.events.at(-1)).toMatchObject({ reason: 'show', subtab: 'scarabs' })
    expect(h.events.at(-1)!.quantities).toBeUndefined()
    expect(h.scan.snapshot().qtyCells ?? 0).toBe(0)
  })

  it('顯示中把開關關掉 → 再送一次不帶 quantities 的 show(徽章回單價);再打開 → 重讀', async () => {
    const h = harness()
    await h.scan.tick()
    expect(h.events.at(-1)!.quantities).toBeDefined()
    h.cfg.readQuantity = false
    await h.scan.tick()
    expect(h.events.at(-1)).toMatchObject({ reason: 'show', subtab: 'scarabs' })
    expect(h.events.at(-1)!.quantities).toBeUndefined()
    h.cfg.readQuantity = true
    await h.scan.tick()
    expect(h.events.at(-1)!.quantities).toHaveLength(115)
  })
})
