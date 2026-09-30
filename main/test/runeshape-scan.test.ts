// exile-appraiser(WP-R2):符文塑形自動查價掃描迴圈。假時鐘 + 假擷取,不啟動 Electron、不送任何按鍵。
import { describe, expect, it } from 'vitest'
import type { RuneshapeScanEvent } from '@ipc/types'
import {
  AUTO_MISS_LIMIT, AUTO_REFRESH_MS, CLEARING_BLOCKS, LOCATE_INTERVAL_MS, RuneshapeScan, bgraToGray, clampScanInterval, frameDiff, isChanged, isRowText, scanBlock,
  type Fingerprint, type ScanCapture, type ScanClock, type ScanConfig, type ScanEnv
} from '../src/ocr/runeshape-scan'

/** 手動推進的假時鐘:`advance(ms)` 依序觸發到期的計時器 */
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
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0])
      t = next[1].at
      next[1].fn()
      // 讓 tick 的 promise 鏈跑完(擷取 / OCR 都是立即 resolve 的假實作)
      for (let i = 0; i < 50; i++) await Promise.resolve()
    }
    t = end
  }
  return { clock, advance, pending: () => [...timers.values()].map(v => v.at - t) }
}

const fp = (v: number, n = 64 * 40): Fingerprint => ({ w: 64, h: 40, data: new Uint8Array(n).fill(v) })

interface Harness {
  scan: RuneshapeScan
  events: RuneshapeScanEvent[]
  cfg: ScanConfig
  env: ScanEnv
  state: {
    busy: boolean
    frame: Fingerprint
    /** 區域 OCR(非全畫面 ×1)回的行 */
    lines: Line[]
    /** 全畫面 ×1(自動定位 / 直書重試的 ×1)回的行;undefined = 同 lines */
    locateLines?: Line[]
    /** 區域 ×3 回直書結果(模擬 WinRT 把面板當成直書) */
    verticalAt3?: boolean
    client: { w: number, h: number }
    captures: number
    ocrs: number
    ocrRects: Array<{ rect: { x: number, y: number, width: number, height: number }, scale: number }>
  }
  clk: ReturnType<typeof fakeClock>
}
type Line = { text: string, x: number, y: number, w: number, h: number }

/** 影像 1900×1000(client 2000×1000,左邊 100 px 在螢幕外)上一塊右對齊的面板:3 列面板列,右緣 1100 */
const PANEL_LINES: Line[] = [
  { text: '1x 崇高石', x: 1010, y: 300, w: 90, h: 20 },
  { text: '3x 富豪石', x: 1010, y: 355, w: 90, h: 20 },
  { text: '維里西姆堆', x: 1000, y: 410, w: 100, h: 20 },
  { text: '技能：排斥', x: 1010, y: 465, w: 90, h: 20 }
]
const VERTICAL_LINES: Line[] = [
  { text: '文 斥 星 片 軍', x: 1080, y: 300, w: 20, h: 300 },
  { text: '等 技 等 等 等', x: 1010, y: 300, w: 20, h: 280 }
]

function harness (over: Partial<ScanConfig> = {}): Harness {
  const clk = fakeClock()
  const cfg: ScanConfig = { enabled: true, game: 'poe2', region: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, intervalMs: 1000, ...over }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 100, y: 50, width: 2000, height: 1000 } }
  const state: Harness['state'] = {
    busy: false,
    frame: fp(10),
    lines: [{ text: '1x 崇高 石', x: 1010, y: 300, w: 80, h: 20 }, { text: '12', x: 1100, y: 300, w: 20, h: 20 }],
    client: { w: 2000, h: 1000 },
    captures: 0,
    ocrs: 0,
    ocrRects: []
  }
  const events: RuneshapeScanEvent[] = []
  const scan = new RuneshapeScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => state.busy,
    capture: async (): Promise<ScanCapture> => {
      state.captures++
      // 遊戲視窗左邊 100 px 在螢幕外:影像從 client x=100 開始
      return {
        size: { w: state.client.w - 100, h: state.client.h },
        offset: { x: 100, y: 0 },
        client: { ...state.client },
        fingerprint: () => state.frame,
        recognize: async (rect, scale) => {
          state.ocrs++
          state.ocrRects.push({ rect, scale })
          const src = scale === 1 && state.locateLines ? state.locateLines : scale > 1 && state.verticalAt3 && rect.width >= 400 ? VERTICAL_LINES : state.lines
          return { lines: src.map(l => ({ ...l })), ms: 42 }
        }
      }
    },
    send: (e) => { events.push(e) },
    log: () => {}
  })
  return { scan, events, cfg, env, state, clk }
}

describe('變化偵測(純函式)', () => {
  it('bgraToGray:BGRA → 灰階', () => {
    const g = bgraToGray(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255]), 3, 1)
    expect([...g.data]).toEqual([0, 255, 28])
  })
  it('frameDiff:平均差與變動比例;大小不同 → null(= 有變化)', () => {
    const a = fp(10)
    const b = fp(10)
    b.data[0] = 200 // 1 個像素大變
    const d = frameDiff(a, b)!
    expect(d.mean).toBeCloseTo(190 / 2560, 6)
    expect(d.changedRatio).toBeCloseTo(1 / 2560, 6)
    expect(frameDiff(a, { w: 32, h: 20, data: new Uint8Array(640) })).toBeNull()
    expect(isChanged(null)).toBe(true)
  })
  it('門檻:雜訊(每像素 ±3)不算變化;約 0.4% 像素大變或平均差 ≥ 2 算變化', () => {
    const a = fp(100)
    const noise = fp(100)
    for (let i = 0; i < noise.data.length; i++) noise.data[i] = 100 + ((i % 7) - 3)
    expect(isChanged(frameDiff(a, noise))).toBe(false)
    const few = fp(100)
    for (let i = 0; i < 9; i++) few.data[i * 50] = 180 // 9 / 2560 = 0.35%
    expect(isChanged(frameDiff(a, few))).toBe(false)
    for (let i = 9; i < 11; i++) few.data[i * 50] = 180 // 11 / 2560 = 0.43%
    expect(isChanged(frameDiff(a, few))).toBe(true)
    const dim = fp(102)
    expect(isChanged(frameDiff(a, dim))).toBe(true) // 整體變亮 2 → 平均差 2
    expect(isChanged(frameDiff(a, dim), { mean: 3, ratio: 0.004 })).toBe(false)
  })
  it('isRowText:只收含 CJK 的行', () => {
    expect(isRowText('崇高石 x3')).toBe(true)
    expect(isRowText('x 12')).toBe(false)
    expect(isRowText('')).toBe(false)
  })
  it('clampScanInterval:100–3000(下限 2026-10-01 由 500 放寬),預設 1000', () => {
    expect(clampScanInterval(50)).toBe(100)
    expect(clampScanInterval(100)).toBe(100)
    expect(clampScanInterval(250)).toBe(250)
    expect(clampScanInterval(9000)).toBe(3000)
    expect(clampScanInterval(1234.4)).toBe(1234)
    expect(clampScanInterval('x')).toBe(1000)
    expect(clampScanInterval(Number.NaN)).toBe(1000)
  })
})

describe('啟用 / 暫停條件 scanBlock', () => {
  const cfg: ScanConfig = { enabled: true, game: 'poe2', region: { x: 0, y: 0, w: 1, h: 1 }, intervalMs: 1000 }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: 10, height: 10 } }
  const ui = { panel: false, settings: false, picker: false }
  it('依序檢查:停用 → 不是 PoE2 → 不是 overlay → 沒區域 → 沒視窗 → 使用者暫停 → 失焦 → UI 開著', () => {
    expect(scanBlock(cfg, env, ui, false)).toBeNull()
    expect(scanBlock({ ...cfg, enabled: false, game: 'poe1' }, env, ui, false)).toBe('disabled')
    expect(scanBlock({ ...cfg, game: 'poe1' }, env, ui, false)).toBe('not-poe2')
    expect(scanBlock(cfg, { ...env, overlay: false }, ui, false)).toBe('not-overlay')
    expect(scanBlock({ ...cfg, region: null }, env, ui, false)).toBeNull() // 沒框區域 = 自動定位,不是阻擋條件
    expect(scanBlock(cfg, { ...env, bounds: null }, ui, false)).toBe('no-window')
    expect(scanBlock(cfg, { ...env, bounds: { x: 0, y: 0, width: 0, height: 10 } }, ui, false)).toBe('no-window')
    expect(scanBlock(cfg, { ...env, gameActive: false }, ui, true)).toBe('user-paused')
    expect(scanBlock(cfg, { ...env, gameActive: false }, ui, false)).toBe('game-inactive')
    expect(scanBlock(cfg, env, { ...ui, panel: true }, false)).toBe('ui-open')
    expect(scanBlock(cfg, env, { ...ui, settings: true }, false)).toBe('ui-open')
    expect(scanBlock(cfg, env, { ...ui, picker: true }, false)).toBe('ui-open')
  })
  it('失焦與 UI 開著只是暫停(不清徽章);其他會清', () => {
    expect(CLEARING_BLOCKS.has('game-inactive')).toBe(false)
    expect(CLEARING_BLOCKS.has('ui-open')).toBe(false)
    expect(CLEARING_BLOCKS.has('disabled')).toBe(true)
    expect(CLEARING_BLOCKS.has('no-window')).toBe(true)
  })
})

describe('RuneshapeScan 迴圈(假時鐘)', () => {
  it('啟用:start 立刻跑一次,之後每 intervalMs 一次;OCR 結果換成 client 座標、只留 CJK 行', async () => {
    const h = harness()
    h.scan.start()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    expect(h.state.ocrs).toBe(1)
    expect(h.events).toHaveLength(1)
    const ev = h.events[0]
    expect(ev.reason).toBe('rows')
    expect(ev.client).toEqual({ w: 2000, h: 1000 })
    expect(ev.rows).toEqual([{ text: '1x 崇高 石', x: 1110, y: 300, w: 80, h: 20 }]) // + 擷取偏移 100
    expect(ev.timings).toMatchObject({ ocrMs: 42 })
    // 區域 client 比例 → 影像像素(減擷取偏移 100);500×500 → ×3
    expect(h.state.ocrRects[0]).toEqual({ rect: { x: 900, y: 250, width: 500, height: 500 }, scale: 3 })
    expect(h.clk.pending()).toEqual([1000])
    await h.clk.advance(999)
    expect(h.state.captures).toBe(1)
    await h.clk.advance(1)
    expect(h.state.captures).toBe(2)
    h.cfg.intervalMs = 2500
    await h.clk.advance(1000) // 這一輪結束後才用新間隔排下一次
    expect(h.state.captures).toBe(3)
    expect(h.clk.pending()).toEqual([2500])
    h.scan.stop()
    expect(h.clk.pending()).toEqual([])
  })

  it('變化偵測:畫面沒變 → 不 OCR、不送事件;變了才 OCR', async () => {
    const h = harness()
    expect((await h.scan.tick()).kind).toBe('ocr')
    const r2 = await h.scan.tick()
    expect(r2.kind).toBe('unchanged')
    expect(h.state.ocrs).toBe(1)
    expect(h.events).toHaveLength(1)
    h.state.frame = fp(60)
    const r3 = await h.scan.tick()
    expect(r3.kind).toBe('ocr')
    expect(r3.kind === 'ocr' && r3.timings.diff).toEqual({ mean: 50, changedRatio: 1 })
    expect(h.state.ocrs).toBe(2)
    expect(h.scan.snapshot()).toMatchObject({ active: false, ticks: 3, ocrRuns: 2, skippedUnchanged: 1 }) // 沒 start → active false
  })

  it('區域改了(快取鍵不同)→ 不拿舊基準比,直接 OCR', async () => {
    const h = harness()
    await h.scan.tick()
    h.cfg.region = { x: 0.5, y: 0.3, w: 0.25, h: 0.5 }
    expect((await h.scan.tick()).kind).toBe('ocr')
  })

  it('忙碌:揭露面板 OCR 在跑 → 丟掉這個 tick(不擷取、不排隊)', async () => {
    const h = harness()
    h.state.busy = true
    expect((await h.scan.tick()).kind).toBe('busy')
    expect(h.state.captures).toBe(0)
    h.state.busy = false
    expect((await h.scan.tick()).kind).toBe('ocr')
    expect(h.scan.snapshot().skippedBusy).toBe(1)
  })

  it('忙碌:擷取完才變忙 → 不 OCR、不設基準(下次畫面沒變也會 OCR)', async () => {
    const h = harness()
    const scan = h.scan as unknown as { deps: { capture: () => Promise<ScanCapture> } }
    const orig = scan.deps.capture
    scan.deps.capture = async () => { const c = await orig(); h.state.busy = true; return c }
    expect((await h.scan.tick()).kind).toBe('busy')
    expect(h.state.ocrs).toBe(0)
    scan.deps.capture = orig
    h.state.busy = false
    expect((await h.scan.tick()).kind).toBe('ocr')
  })

  it('重疊:上一個 tick 還在 OCR → 新 tick 直接回 overlap', async () => {
    const h = harness()
    let release!: () => void
    const scan = h.scan as unknown as { deps: { capture: () => Promise<ScanCapture> } }
    const orig = scan.deps.capture
    scan.deps.capture = () => new Promise(resolve => { release = () => { void orig().then(resolve) } })
    const first = h.scan.tick()
    expect((await h.scan.tick()).kind).toBe('overlap')
    expect(h.scan.busy).toBe(true)
    release()
    expect((await first).kind).toBe('ocr')
    expect(h.scan.busy).toBe(false)
  })

  it('連續 2 次沒有列 → 送空結果;第 1 次沒列不設基準(畫面沒變也再 OCR 一次確認)', async () => {
    const h = harness()
    await h.scan.tick()
    expect(h.events.map(e => e.reason)).toEqual(['rows'])
    h.state.lines = [{ text: '123', x: 0, y: 0, w: 5, h: 5 }]
    h.state.frame = fp(90)
    const a = await h.scan.tick()
    expect(a).toMatchObject({ kind: 'ocr', rows: 0, sent: null })
    const b = await h.scan.tick() // 畫面同一張,但第 1 次沒列 → 仍然 OCR
    expect(b).toMatchObject({ kind: 'ocr', rows: 0, sent: 'empty' })
    expect(h.events.map(e => e.reason)).toEqual(['rows', 'empty'])
    expect(h.events[1].rows).toEqual([])
    // 之後畫面沒變 → 不再 OCR、不再送
    expect((await h.scan.tick()).kind).toBe('unchanged')
    expect(h.events).toHaveLength(2)
    expect(h.state.ocrs).toBe(3)
  })

  it('暫停:遊戲失焦 / UI 開著 → 不擷取、不送事件(徽章留著);恢復後重新 OCR(基準已清)', async () => {
    const h = harness()
    h.scan.start()
    await h.clk.advance(0)
    expect(h.events).toHaveLength(1)
    h.env.gameActive = false
    await h.clk.advance(1000)
    h.env.gameActive = true
    h.scan.setUiState({ panel: true, settings: false, picker: false })
    await h.clk.advance(0) // setUiState → poke → 立刻判斷
    await h.clk.advance(1000)
    expect(h.state.captures).toBe(1)
    expect(h.events).toHaveLength(1)
    expect(h.scan.snapshot()).toMatchObject({ active: false, reason: 'ui-open' })
    h.scan.setUiState({ panel: false, settings: false, picker: false })
    await h.clk.advance(0)
    expect(h.state.captures).toBe(2)
    expect(h.state.ocrs).toBe(2) // 畫面沒變,但暫停清了基準
    expect(h.scan.snapshot()).toMatchObject({ active: true })
    h.scan.stop()
  })

  it('停用 / 沒區域 → 送一次 inactive 清徽章;沒顯示過就不送', async () => {
    const h = harness()
    await h.scan.tick()
    h.cfg.enabled = false
    await h.scan.tick()
    await h.scan.tick()
    expect(h.events.map(e => e.reason)).toEqual(['rows', 'inactive'])
    const h3 = harness({ game: 'poe1' })
    expect(await h3.scan.tick()).toEqual({ kind: 'blocked', block: 'not-poe2' })
    expect(h3.state.captures).toBe(0)
  })

  it('區域整塊落在擷取影像外 → region-outside(不 OCR)', async () => {
    const h = harness({ region: { x: 0, y: 0, w: 0.04, h: 0.1 } }) // client x 0–80,影像從 client 100 開始
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'region-outside' })
    expect(h.state.ocrs).toBe(0)
  })

  it('暫停熱鍵:toggleUserPause 送 user-paused(清徽章)→ 不掃描;再按送 user-resumed、恢復掃描', async () => {
    const h = harness()
    await h.scan.tick()
    expect(h.scan.toggleUserPause()).toBe(true)
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'user-paused' })
    expect(h.scan.toggleUserPause()).toBe(false)
    expect((await h.scan.tick()).kind).toBe('ocr')
    expect(h.events.map(e => e.reason)).toEqual(['rows', 'user-paused', 'user-resumed', 'rows'])
  })

  it('OCR 失敗:記錄 lastError、不送事件、下一次重試', async () => {
    const h = harness()
    const scan = h.scan as unknown as { deps: { capture: () => Promise<ScanCapture> } }
    const orig = scan.deps.capture
    scan.deps.capture = async () => ({ ...(await orig()), recognize: async () => { throw Object.assign(new Error('缺語言包'), { kind: 'lang-missing' }) } })
    expect(await h.scan.tick()).toEqual({ kind: 'error', message: 'lang-missing 缺語言包' })
    expect(h.scan.snapshot().lastError).toBe('lang-missing 缺語言包')
    expect(h.events).toEqual([])
    scan.deps.capture = orig
    expect((await h.scan.tick()).kind).toBe('ocr')
  })

  it('統計:最近 20 次平均耗時', async () => {
    const h = harness()
    await h.scan.tick()
    const st = h.scan.snapshot()
    expect(st.avgCaptureMs).toBe(0) // 假時鐘不前進
    expect(st.avgOcrMs).toBe(0)
    expect(st.last).toMatchObject({ captureMs: 0, diffMs: 0, ocrWallMs: 0, ocrMs: 42, totalMs: 0, mode: 'manual' })
  })

  it('有中文字但沒有任何面板格式的列(地上物品標籤等)→ 當成沒有列', async () => {
    const h = harness()
    h.state.lines = [{ text: '富豪石', x: 1010, y: 300, w: 60, h: 20 }, { text: '崇高石', x: 1010, y: 340, w: 60, h: 20 }]
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', rows: 0, panelRows: 0 })
    expect(h.scan.snapshot().panel).toBe('not-found')
  })
})

describe('手動區域(runeshapeRegion 有值)', () => {
  it('區域內沒找到面板 → 設定頁狀態 not-found;不改掃全畫面(只 OCR 區域)', async () => {
    const h = harness()
    h.state.lines = []
    for (let i = 0; i < 8; i++) { h.state.frame = fp(i * 20); await h.scan.tick() }
    expect(h.state.ocrRects.every(r => r.rect.width === 500 && r.scale === 3)).toBe(true)
    expect(h.scan.snapshot()).toMatchObject({ mode: 'manual', panel: 'not-found', locates: 0 })
    expect(h.scan.snapshot().autoRegion).toBeUndefined()
    h.state.lines = PANEL_LINES
    h.state.frame = fp(200)
    await h.scan.tick()
    expect(h.scan.snapshot().panel).toBe('found')
  })

  it('WinRT 把區域當直書 → 同區域 ×1 找面板列 → 只裁面板列 ×3 重辨識', async () => {
    const h = harness()
    h.state.lines = PANEL_LINES
    h.state.verticalAt3 = true
    const r = await h.scan.tick()
    expect(r).toMatchObject({ kind: 'ocr', rows: 4, panelRows: 3, timings: { retry: 'vertical', mode: 'manual' } })
    // 區域 (900,250 500x500);×1 找到的面板框夾進區域 → (900,250 212x290)
    expect(h.state.ocrRects.map(x => [x.rect.x, x.rect.y, x.rect.width, x.rect.height, x.scale])).toEqual([
      [900, 250, 500, 500, 3], [900, 250, 500, 500, 1], [900, 250, 212, 290, 3]
    ])
    expect(h.events[0].rows.map(x => x.text)).toEqual(PANEL_LINES.map(l => l.text))
    // 之後同一區域有變化 → 直接 OCR 記住的那塊(不再先 ×3 整個區域)
    h.state.frame = fp(90)
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', rows: 4, timings: { retry: 'vertical' } })
    expect(h.state.ocrRects.slice(3).map(x => [x.rect.width, x.scale])).toEqual([[212, 3]])
    // 那塊找不到面板列 → 回到整個區域(這次沒有直書)
    h.state.verticalAt3 = false
    h.state.lines = []
    h.state.frame = fp(150)
    await h.scan.tick()
    expect(h.state.ocrRects.slice(4).map(x => [x.rect.width, x.scale])).toEqual([[212, 3], [500, 3]])
  })
})

describe('自動定位(沒框 runeshapeRegion)', () => {
  /** 定位用:全畫面 ×1 看到面板列 + 別處雜訊;快取區 ×3 看到同樣的面板列 */
  function autoHarness () {
    const h = harness({ region: null })
    h.state.lines = PANEL_LINES
    h.state.locateLines = [...PANEL_LINES, { text: '對話框的中文字', x: 50, y: 900, w: 200, h: 20 }]
    return h
  }

  it('第一次:全畫面 ×1 定位 → 外擴框存快取 → 同一個 tick 對框 ×3 並送出列', async () => {
    const h = autoHarness()
    const r = await h.scan.tick()
    expect(r).toMatchObject({ kind: 'ocr', mode: 'auto', rows: 4, sent: 'rows' })
    expect(r.kind === 'ocr' && r.timings.locateMs).toBe(0)
    // 面板列(有前綴的 3 列)外框 (1010,300)-(1100,485),行高 20、列距中位數 110 → 左 120、右 12、上下 55
    expect(h.state.ocrRects).toEqual([
      { rect: { x: 0, y: 0, width: 1900, height: 1000 }, scale: 1 },
      { rect: { x: 890, y: 245, width: 222, height: 295 }, scale: 3 }
    ])
    expect(h.events[0].rows.map(x => x.text)).toEqual(PANEL_LINES.map(l => l.text)) // 沒前綴的「維里西姆堆」也在框內
    expect(h.events[0].rows[0]).toMatchObject({ text: '1x 崇高石', x: 1110 }) // + 擷取偏移 100
    const st = h.scan.snapshot()
    expect(st).toMatchObject({ mode: 'auto', panel: 'found', locates: 1, locateMisses: 0 })
    // client 比例:(890 + 100) / 2000
    expect(st.autoRegion).toEqual({ x: 0.495, y: 0.245, w: 0.111, h: 0.295 })
  })

  it('之後照常每 interval 只掃快取區(畫面沒變不 OCR、不再全畫面定位)', async () => {
    const h = autoHarness()
    h.scan.start()
    await h.clk.advance(0)
    await h.clk.advance(1000)
    await h.clk.advance(1000)
    expect(h.state.captures).toBe(3)
    expect(h.state.ocrs).toBe(2) // 定位 + 第一次區域;之後兩次畫面沒變
    h.state.frame = fp(99)
    await h.clk.advance(1000)
    expect(h.state.ocrRects.slice(2)).toEqual([{ rect: { x: 890, y: 245, width: 222, height: 295 }, scale: 3 }])
    expect(h.scan.snapshot().locates).toBe(1)
    h.scan.stop()
  })

  it(`定位沒找到 → 之後 ${LOCATE_INTERVAL_MS / 1000} 秒內的 tick 不擷取(locate-wait),到時間才再定位`, async () => {
    const h = autoHarness()
    h.state.locateLines = [{ text: '1x 富豪石', x: 100, y: 100, w: 80, h: 20 }] // 只有 1 列
    h.scan.start()
    await h.clk.advance(0)
    expect(h.state.captures).toBe(1)
    expect(h.scan.snapshot()).toMatchObject({ locates: 1, locateMisses: 1, panel: 'not-found' })
    await h.clk.advance(1000)
    await h.clk.advance(1000)
    expect(h.state.captures).toBe(1)
    await h.clk.advance(1000) // t = 3000
    expect(h.state.captures).toBe(2)
    expect(h.scan.snapshot().locates).toBe(2)
    expect(h.events).toEqual([])
    h.scan.stop()
  })

  it(`快取失效:面板關掉後快取區連續 ${AUTO_MISS_LIMIT} 次沒有面板列 → 清快取、回到低頻全畫面定位`, async () => {
    const h = autoHarness()
    await h.scan.tick()
    expect(h.scan.autoRegion).not.toBeNull()
    h.state.lines = []
    h.state.locateLines = []
    h.state.frame = fp(50) // 面板關了:區域變了 → OCR
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', rows: 0, sent: null }) // 1
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', rows: 0, sent: 'empty' }) // 2(第 1 次沒列不設基準)
    expect((await h.scan.tick()).kind).toBe('unchanged') // 3
    expect((await h.scan.tick()).kind).toBe('unchanged') // 4
    expect(h.scan.autoRegion).not.toBeNull()
    expect((await h.scan.tick()).kind).toBe('unchanged') // 5 → 清快取
    expect(h.scan.autoRegion).toBeNull()
    expect(h.events.map(e => e.reason)).toEqual(['rows', 'empty'])
    // 距上次定位(t=0)不到 3 秒 → 不擷取
    const caps = h.state.captures
    expect((await h.scan.tick()).kind).toBe('locate-wait')
    expect(h.state.captures).toBe(caps)
    await h.clk.advance(LOCATE_INTERVAL_MS)
    expect((await h.scan.tick()).kind).toBe('locate-miss')
    // 面板又開了 → 下一次定位找到
    h.state.lines = PANEL_LINES
    h.state.locateLines = PANEL_LINES
    await h.clk.advance(LOCATE_INTERVAL_MS)
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', rows: 4, sent: 'rows' })
    expect(h.scan.snapshot().locates).toBe(3)
  })

  it('面板還在(每次都有面板列)→ 找不到的次數歸零,不清快取', async () => {
    const h = autoHarness()
    await h.scan.tick()
    for (let i = 0; i < AUTO_MISS_LIMIT * 2; i++) {
      h.state.lines = i % 3 === 2 ? PANEL_LINES : []
      h.state.frame = fp((i % 2) * 100 + 20) // 每次都有變化 → 每次都 OCR
      await h.scan.tick()
    }
    expect(h.scan.autoRegion).not.toBeNull()
  })

  it('遊戲畫面大小變了 → 快取作廢、立刻重新定位', async () => {
    const h = autoHarness()
    await h.scan.tick()
    h.state.client = { w: 2560, h: 1440 }
    await h.clk.advance(LOCATE_INTERVAL_MS)
    const r = await h.scan.tick()
    expect(r).toMatchObject({ kind: 'ocr', mode: 'auto', sent: 'rows' })
    expect(h.state.ocrRects[2]).toEqual({ rect: { x: 0, y: 0, width: 2460, height: 1440 }, scale: 1 })
    const st = h.scan.snapshot()
    expect(st.locates).toBe(2)
    expect(st.autoRegion!.x).toBeCloseTo(990 / 2560, 4)
  })

  it(`快取區有變化且距上次定位 ≥ ${AUTO_REFRESH_MS / 1000} 秒 → 順便重新定位;畫面沒變就不定位`, async () => {
    const h = autoHarness()
    await h.scan.tick()
    await h.clk.advance(AUTO_REFRESH_MS)
    expect((await h.scan.tick()).kind).toBe('unchanged')
    expect(h.scan.snapshot().locates).toBe(1)
    // 面板變高:多了一列 → 重新定位後框變大
    h.state.locateLines = [...PANEL_LINES, { text: '2x 崇高石', x: 1010, y: 520, w: 90, h: 20 }]
    h.state.frame = fp(77)
    const r = await h.scan.tick()
    // 4 列、列距中位數 55 → 上下各 27.5
    expect(r.kind === 'ocr' && r.rect).toEqual({ x: 890, y: 272, width: 222, height: 296 })
    expect(h.scan.snapshot().locates).toBe(2)
  })

  it('從手動區域改成未框選 → 狀態回 unknown,改走自動定位', async () => {
    const h = autoHarness()
    h.cfg.region = { x: 0.5, y: 0.25, w: 0.25, h: 0.5 }
    await h.scan.tick()
    expect(h.scan.snapshot()).toMatchObject({ mode: 'manual', panel: 'found', locates: 0 })
    h.cfg.region = null
    expect(h.scan.snapshot()).toMatchObject({ mode: 'auto', panel: 'unknown' })
    await h.scan.tick()
    expect(h.scan.snapshot()).toMatchObject({ mode: 'auto', panel: 'found', locates: 1 })
  })
})
