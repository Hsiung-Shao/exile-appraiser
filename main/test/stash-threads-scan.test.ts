/**
 * 3.30 倉庫價格疊層:按鈕列掃描判出「綢帶」子頁 → `stash-scan-result` 的 show 帶 subtab 'threads'。
 * 只依規格寫(不讀 stash-scan.ts 實作);假時鐘 / 假擷取 / 假 OCR,不碰 Electron。
 * 按鈕文字用 1432 高的合成 OCR 行(座標以獨立公式算:槽 k 的 x = floor((202 + 166k)/1440·h)、寬 floor(152/1440·h);文字中心 y = 201/1440·h)。
 */
import { describe, expect, it } from 'vitest'
import type { StashScanEvent } from '@ipc/types'
import type { Fingerprint, ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import { StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import type { TextLine } from '../../core/src/stash/detect'

const H = 1432
const W = 2546

function fakeClock () {
  let t = 0
  const clock: ScanClock = {
    now: () => t,
    setTimeout: () => 1,
    clearTimeout: () => {}
  }
  return clock
}

const fp = (v: number): Fingerprint => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(v) })

/** 獨立公式:第 k 顆按鈕的左緣與寬 */
const slotX = (k: number): number => Math.floor((202 + 166 * k) / 1440 * H)
const slotW = Math.floor(152 / 1440 * H)
function btnLine (text: string, k: number): TextLine {
  const w = 60
  const th = 20
  return { text, x: slotX(k) + slotW / 2 - w / 2, y: Math.floor(201 / 1440 * H) - th / 2, w, h: th }
}
const L_GENERAL = btnLine('一般', 0)
const L_THREADS = btnLine('綢帶', 1)
const L_ELDRITCH = btnLine('異能', 2)

/** 每顆按鈕文字的 p99:[一般, 綢帶, 異能];目前子頁較亮 */
const BRIGHT = {
  general: [160, 141, 142],
  threads: [141, 160, 142],
  eldritch: [141, 142, 160]
} as const

function harness (lines: TextLine[]) {
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 500 }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 100, y: 50, width: W, height: H } }
  const state = {
    frame: fp(10),
    lines,
    bright: [...BRIGHT.general] as number[],
    grays: [] as number[]
  }
  const events: StashScanEvent[] = []
  const scan = new StashScan({
    clock: fakeClock(),
    config: () => cfg,
    env: () => env,
    ocrBusy: () => false,
    capture: async (): Promise<ScanCapture> => ({
      size: { w: W, h: H },
      offset: { x: 0, y: 0 },
      client: { w: W, h: H },
      fingerprint: () => state.frame,
      recognize: async () => ({ lines: state.lines.map(l => ({ ...l })), ms: 7 }),
      gray: (rect) => {
        // 取樣矩形的 x 落在哪一顆按鈕(±1 px)→ 該顆的 p99
        const k = [0, 1, 2].find(i => Math.abs(slotX(i) - rect.x) <= 1)
        state.grays.push(k ?? -1)
        return new Uint8Array(32).fill(k === undefined ? 0 : state.bright[k])
      }
    }),
    send: (e) => { events.push(e) },
    textLang: () => 'zh'
  })
  let v = 10
  const changeFrame = () => { v = (v + 37) % 250; state.frame = fp(v) }
  return { scan, events, state, changeFrame }
}

describe('T9 掃描判出綢帶頁後送綢帶格子', () => {
  it('三顆按鈕都讀到、綢帶槽較亮 → show 的 subtab 為 threads', async () => {
    const h = harness([L_GENERAL, L_THREADS, L_ELDRITCH])
    h.state.bright = [...BRIGHT.threads]
    const r = await h.scan.tick()
    // 還在比「一般」那顆 → 綢帶頁被當成沒有版面(不畫)或誤當一般
    expect(r).toMatchObject({ kind: 'ocr', found: true, subtab: 'threads', sent: 'show' })
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ reason: 'show', subtab: 'threads', yOffset: 0, client: { w: W, h: H } })
    expect(h.scan.showing).toBe(true)
  })
  it('目前子頁(綢帶)的文字被 OCR 漏讀、只讀到一般 + 異能 → 仍用綢帶槽亮度判成 threads', async () => {
    const h = harness([L_GENERAL, L_ELDRITCH])
    h.state.bright = [...BRIGHT.threads]
    const r = await h.scan.tick()
    // 只取「有文字的槽」比亮度 → 漏讀的綢帶槽沒被取樣,判不出來
    expect(r).toMatchObject({ found: true, subtab: 'threads', sent: 'show' })
    expect(h.state.grays).toContain(1)
    expect(h.events[0].subtab).toBe('threads')
  })
  it('一般 → 綢帶 → 一般 各送一次 show,異能送 hide', async () => {
    const h = harness([L_GENERAL, L_THREADS, L_ELDRITCH])
    expect(await h.scan.tick()).toMatchObject({ subtab: 'general', sent: 'show' })

    h.state.bright = [...BRIGHT.threads]
    h.changeFrame()
    // 同一次顯示中換子頁沒重送 → renderer 仍畫一般頁的格子
    expect(await h.scan.tick()).toMatchObject({ subtab: 'threads', sent: 'show' })
    expect(h.events.map(e => [e.reason, e.subtab])).toEqual([['show', 'general'], ['show', 'threads']])

    h.changeFrame()
    // 同子頁不重送
    expect(await h.scan.tick()).toMatchObject({ subtab: 'threads', sent: null })
    expect(h.events).toHaveLength(2)

    h.state.bright = [...BRIGHT.eldritch]
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: true, subtab: null, sent: 'hide' })
    expect(h.events.at(-1)).toMatchObject({ reason: 'hide', subtab: null })
  })
})
