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
import type { Fingerprint, ScanCapture, ScanEnv } from '../src/ocr/panel-scan'
import { StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import { SUBTAB_LABELS, buttonRects, type TextLine } from '../../core/src/stash/detect'
import { cellRects, parseStashLayouts, type StashSubtab } from '../../core/src/stash/layout'
import { parseDigitTemplates, qtyCropRect } from '../../core/src/stash/quantity'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIX = path.join(ROOT, 'core/test/stash/fixtures/qty')
const TRUTH = JSON.parse(fs.readFileSync(path.join(FIX, 'truth.json'), 'utf8')) as Record<StashSubtab, number[]> & { files: Record<StashSubtab, string> }
const LAYOUTS = parseStashLayouts(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/layouts.json'), 'utf8')))
const TEMPLATES = parseDigitTemplates(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/digit-templates.json'), 'utf8')))
const H = 1125
const W = 700

interface Img { data: Uint8Array, width: number, height: number }
const IMAGES: Partial<Record<StashSubtab, Img>> = {}
beforeAll(async () => {
  for (const tab of ['general', 'scarabs'] as const) {
    const { data, info } = await sharp(path.join(FIX, TRUTH.files[tab])).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    IMAGES[tab] = { data: new Uint8Array(data), width: info.width, height: info.height }
  }
})

/** 合成按鈕列 OCR 行(四顆都在、偏移 0) */
function buttonLines (): TextLine[] {
  return buttonRects(H, 0).map((r, k) => ({ text: SUBTAB_LABELS.zh[k], x: r.x + r.w / 2 - 20, y: Math.floor(201 / 1440 * H) - 8, w: 40, h: 16 }))
}
const BRIGHT: Record<StashSubtab, number[]> = { general: [160, 140, 140, 140], scarabs: [140, 160, 140, 140] }
const fp = (v: number): Fingerprint => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(v) })

function harness (tab: StashSubtab = 'scarabs') {
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 1000, readQuantity: true }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: W, height: H } }
  const state = {
    tab,
    img: { ...IMAGES[tab]!, data: Uint8Array.from(IMAGES[tab]!.data) },
    masks: [] as Array<{ x: number, y: number, w: number, h: number }>,
    cursorOnCell: false,
    pending: false,
    strip: fp(10)
  }
  const events: StashScanEvent[] = []
  const scan = new StashScan({
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
        recognize: async () => ({ lines: buttonLines(), ms: 30 }),
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
        maskRects: state.masks.map(m => ({ ...m }))
      }
    },
    send: (e) => { events.push(e) },
    textLang: () => 'zh',
    qty: { layouts: () => LAYOUTS, templates: () => TEMPLATES },
    qtyPaused: () => state.cursorOnCell,
    drawPending: () => state.pending
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
  return { scan, cfg, env, state, events, rects, copyDigits }
}

describe('V8 事件帶數量', () => {
  it('第一次顯示的 show 帶 quantities,長度 = 版面格數,絕大多數與人工判讀相同', async () => {
    const h = harness('scarabs')
    await h.scan.tick()
    const ev = h.events.at(-1)!
    expect(ev).toMatchObject({ reason: 'show', subtab: 'scarabs' })
    expect(ev.quantities).toHaveLength(LAYOUTS.subtabs.scarabs.length)
    const ok = ev.quantities!.filter((q, i) => q === TRUTH.scarabs[i]).length
    const wrong = ev.quantities!.filter((q, i) => q != null && q !== TRUTH.scarabs[i]).length
    expect(ok).toBeGreaterThanOrEqual(108)
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
