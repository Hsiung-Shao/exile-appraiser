/**
 * PoE1 倉庫價格疊層:按鈕列掃描(StashScan)與游標換格(StashCursor)。
 * 只依規格寫(不讀 main/src/ocr/stash-scan.ts、main/src/stash-cursor.ts 實作);假時鐘 / 假擷取 / 假 OCR / 假游標,不碰 Electron。
 * 輸入:core/test/stash/fixtures/ocr 的真實 OCR 快照(client 高 1432)、data/poe1/stash/layouts.json。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StashScanEvent, RuneshapeUiState } from '@ipc/types'
import type { Fingerprint, ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import {
  STASH_CLEARING_BLOCKS, STASH_HOLD_LIMIT, STASH_MISS_LIMIT, StashScan, stashBlock, type StashScanConfig
} from '../src/ocr/stash-scan'
import { STASH_CURSOR_INTERVAL_MS, StashCursor, stashPanelContains } from '../src/stash-cursor'
import { buttonRects, stripRect, stripZone, type TextLine } from '../../core/src/stash/detect'
import { cellRects, parseStashLayouts, type StashLayoutFile } from '../../core/src/stash/layout'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const FIX_DIR = path.join(ROOT, 'core/test/stash/fixtures/ocr')
const H = 1432
const W = 2546

interface FixtureEntry { file: string, clientH: number, cropX: number, cropY: number }
const INDEX = JSON.parse(fs.readFileSync(path.join(FIX_DIR, 'index.json'), 'utf8')) as { fixtures: FixtureEntry[] }

/** OCR 快照 → client 座標的行(測試的 offset = 0,影像像素 = client) */
function clientLines (name: string): TextLine[] {
  const f = INDEX.fixtures.find(x => x.file === name)
  if (!f) throw new Error(`找不到 fixture ${name}`)
  const snap = JSON.parse(fs.readFileSync(path.join(FIX_DIR, name.replace(/\.png$/, '.ocr.json')), 'utf8')) as { scale: number, lines: TextLine[] }
  const s = snap.scale
  return snap.lines.map(l => ({ text: l.text, x: l.x / s + f.cropX, y: l.y / s + f.cropY, w: l.w / s, h: l.h / s }))
}
const SCARAB_LINES = clientLines('strip-scarabs-1432.png')
const TOOLTIP_LINES = clientLines('strip-tooltip-1432.png')

const LAYOUTS: StashLayoutFile = parseStashLayouts(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/layouts.json'), 'utf8')))

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
      for (let i = 0; i < 50; i++) await Promise.resolve()
    }
    t = end
    for (let i = 0; i < 50; i++) await Promise.resolve()
  }
  return { clock, advance, pending: () => [...timers.values()].map(v => v.at - t) }
}

const fp = (v: number): Fingerprint => ({ w: 64, h: 12, data: new Uint8Array(64 * 12).fill(v) })

/** 亮度:第 k 顆按鈕的 p99;[一般, 聖甲蟲, 不滅之火, 異能] */
const BRIGHT = {
  general: [160, 140, 140, 140],
  scarabs: [140, 160, 140, 140],
  allflame: [140, 140, 160, 140],
  eldritch: [140, 140, 140, 160]
} as const

function harness () {
  const clk = fakeClock()
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 500 }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 100, y: 50, width: W, height: H } }
  const state = {
    busy: false,
    hold: false,
    frame: fp(10),
    lines: SCARAB_LINES as TextLine[],
    bright: [...BRIGHT.scarabs] as number[],
    client: { w: W, h: H },
    captures: 0,
    ocrs: 0,
    grays: 0,
    ocrRects: [] as Array<{ x: number, y: number, width: number, height: number }>,
    /** 擷取偏移(client → 影像);size 省略 = client 大小 */
    offset: { x: 0, y: 0 },
    size: null as { w: number, h: number } | null
  }
  const logs: string[] = []
  const events: StashScanEvent[] = []
  const showingCalls: Array<{ showing: boolean, st: { subtab: unknown, yOffset: number, clientH: number } }> = []
  const scan = new StashScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => state.busy,
    capture: async (): Promise<ScanCapture> => {
      state.captures++
      const client = { ...state.client }
      return {
        size: state.size ? { ...state.size } : { ...client },
        offset: { ...state.offset },
        client,
        fingerprint: () => state.frame,
        recognize: async (rect) => {
          state.ocrs++
          state.ocrRects.push({ ...rect })
          return { lines: state.lines.map(l => ({ ...l })), ms: 42 }
        },
        gray: (rect) => {
          state.grays++
          // 依 x 對到第幾顆按鈕(yOffset 只影響 y)
          const k = buttonRects(client.h, 0).findIndex(b => Math.abs(b.x - rect.x) <= 1)
          return new Uint8Array(32).fill(k >= 0 ? state.bright[k] : 0)
        }
      }
    },
    send: (e) => { events.push(e) },
    textLang: () => 'zh',
    holdOnMiss: () => state.hold,
    onShowingChange: (showing, st) => { showingCalls.push({ showing, st: { ...st } }) },
    log: (m) => { logs.push(m) }
  })
  /** 換畫面(縮圖不同 → 一定重 OCR) */
  let frameV = 10
  const changeFrame = () => { frameV = (frameV + 37) % 250; state.frame = fp(frameV) }
  return { scan, events, showingCalls, cfg, env, state, clk, changeFrame, logs }
}

type Hn = ReturnType<typeof harness>
async function showScarabs (h: Hn) {
  const r = await h.scan.tick()
  expect(r).toMatchObject({ kind: 'ocr', found: true, subtab: 'scarabs', sent: 'show' })
  expect(h.scan.showing).toBe(true)
}

describe('S8 說明框遮住按鈕仍保留', () => {
  it('已顯示後連續 5 次沒找到按鈕且游標在面板內 → held、不送 hide', async () => {
    const h = harness()
    await showScarabs(h)
    h.state.lines = TOOLTIP_LINES
    h.state.hold = true
    for (let i = 0; i < 5; i++) {
      h.changeFrame()
      const r = await h.scan.tick()
      // 沒看 holdOnMiss、或 held 仍累計次數 → 第 2 次就送 hide
      expect(r, `第 ${i + 1} 次`).toMatchObject({ kind: 'ocr', found: false, held: true, sent: null })
    }
    expect(h.events.map(e => e.reason)).toEqual(['show'])
    expect(h.scan.showing).toBe(true)
    expect(h.state.ocrs).toBe(6)
  })
})

describe('S9 關倉庫後清除', () => {
  it(`游標不在面板內:第 1 次沒找到不送、第 ${STASH_MISS_LIMIT} 次送 hide`, async () => {
    expect(STASH_MISS_LIMIT).toBe(2)
    const h = harness()
    await showScarabs(h)
    expect(h.showingCalls.at(-1)).toEqual({ showing: true, st: { subtab: 'scarabs', yOffset: 0, clientH: H } })
    h.state.lines = TOOLTIP_LINES
    h.state.hold = false
    h.changeFrame()
    // 一次沒找到就清 → 說明框閃一下疊層就消失
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', found: false, held: false, sent: null })
    expect(h.events).toHaveLength(1)
    h.changeFrame()
    // 沒累計 / 門檻寫錯 → 不送 hide,疊層殘留
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', found: false, sent: 'hide' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    expect(h.events[1].seq).toBeGreaterThan(h.events[0].seq)
    expect(h.scan.showing).toBe(false)
    expect(h.showingCalls.at(-1)?.showing).toBe(false)
  })
  it('沒找到後又找到 → 累計歸零', async () => {
    const h = harness()
    await showScarabs(h)
    h.state.lines = TOOLTIP_LINES
    h.changeFrame()
    await h.scan.tick()
    h.state.lines = SCARAB_LINES
    h.changeFrame()
    await h.scan.tick()
    h.state.lines = TOOLTIP_LINES
    h.changeFrame()
    // 找到時沒清累計 → 這次就送 hide
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: null })
    expect(h.events.map(e => e.reason)).toEqual(['show'])
  })
})

describe('S9b 狀態轉換只送一次', () => {
  it('同子頁不重送、換子頁送 show、異能送 hide、client 大小變了重送', async () => {
    const h = harness()
    await showScarabs(h)
    const ev0 = h.events[0]
    // 事件內容錯(client / yOffset / ocrMs)→ renderer 疊層畫錯位置
    expect(ev0).toMatchObject({ reason: 'show', subtab: 'scarabs', yOffset: 0, client: { w: W, h: H }, ocrMs: 42 })

    h.changeFrame()
    // 每次 OCR 都重送 → renderer 疊層閃爍
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', found: true, subtab: 'scarabs', sent: null })
    expect(h.events).toHaveLength(1)

    h.state.bright = [...BRIGHT.general]
    h.changeFrame()
    // 只比 showing 不比子頁 → 換頁不更新
    expect(await h.scan.tick()).toMatchObject({ subtab: 'general', sent: 'show' })
    expect(h.events.at(-1)).toMatchObject({ reason: 'show', subtab: 'general' })
    expect(h.showingCalls.at(-1)).toEqual({ showing: true, st: { subtab: 'general', yOffset: 0, clientH: H } })

    h.state.bright = [...BRIGHT.eldritch]
    h.changeFrame()
    // 異能(沒版面)仍顯示舊子頁 → 格子價格錯誤
    expect(await h.scan.tick()).toMatchObject({ found: true, subtab: null, sent: 'hide' })
    expect(h.events.at(-1)?.reason).toBe('hide')
    expect(h.scan.showing).toBe(false)

    h.state.bright = [...BRIGHT.scarabs]
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ subtab: 'scarabs', sent: 'show' })
    const n = h.events.length

    h.state.client = { w: W - 200, h: H }
    h.changeFrame()
    // 沒比 client 大小 → 遊戲改視窗大小後疊層仍用舊尺寸
    expect(await h.scan.tick()).toMatchObject({ subtab: 'scarabs', sent: 'show' })
    expect(h.events).toHaveLength(n + 1)
    expect(h.events.at(-1)?.client).toEqual({ w: W - 200, h: H })
  })
  it('資料夾內(按鈕下移 folderOffset)→ show 帶 yOffset', async () => {
    const h = harness()
    const off = Math.floor(47 / 1440 * H)
    h.state.lines = SCARAB_LINES.map(l => ({ ...l, y: l.y + off }))
    // 沒把 yOffset 帶進事件 / 亮度取樣沒加偏移(這裡亮度依 x 對,所以只驗事件)→ 疊層差一列
    expect(await h.scan.tick()).toMatchObject({ found: true, subtab: 'scarabs', sent: 'show' })
    expect(h.events[0].yOffset).toBe(off)
  })
})

describe('S9c 擋下條件與收起', () => {
  const ui0: RuneshapeUiState = { panel: false, settings: false, picker: false }
  const okCfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 500 }
  const okEnv: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: W, height: H } }

  it('stashBlock 依序檢查各條件', () => {
    // 順序錯 → 停用時卻報別的原因、不清疊層
    expect(stashBlock({ ...okCfg, enabled: false, game: 'poe2' }, { ...okEnv, overlay: false }, ui0)).toBe('disabled')
    expect(stashBlock({ ...okCfg, game: 'poe2' }, { ...okEnv, overlay: false }, ui0)).toBe('not-poe1')
    expect(stashBlock(okCfg, { ...okEnv, overlay: false, bounds: null }, ui0)).toBe('not-overlay')
    expect(stashBlock(okCfg, { ...okEnv, bounds: null, gameActive: false }, ui0)).toBe('no-window')
    expect(stashBlock(okCfg, { ...okEnv, bounds: { x: 0, y: 0, width: 0, height: 0 }, gameActive: false }, ui0)).toBe('no-window')
    expect(stashBlock(okCfg, { ...okEnv, gameActive: false }, { ...ui0, panel: true })).toBe('game-inactive')
    expect(stashBlock(okCfg, okEnv, { ...ui0, panel: true })).toBe('ui-open')
    expect(stashBlock(okCfg, okEnv, { ...ui0, settings: true })).toBe('ui-open')
    expect(stashBlock(okCfg, okEnv, { ...ui0, picker: true })).toBe('ui-open')
    expect(stashBlock(okCfg, okEnv, ui0)).toBeNull()
  })
  it('會清疊層的原因只有 disabled / not-poe1 / not-overlay / no-window', () => {
    // 失焦也清 → 切出遊戲再回來疊層要重新 OCR 才出現
    expect([...STASH_CLEARING_BLOCKS].sort()).toEqual(['disabled', 'no-window', 'not-overlay', 'not-poe1'])
  })
  it('顯示中改成停用 → blocked 並送 hide', async () => {
    const h = harness()
    await showScarabs(h)
    h.cfg.enabled = false
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'disabled' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    expect(h.scan.showing).toBe(false)
    expect(h.showingCalls.at(-1)?.showing).toBe(false)
    expect(h.scan.snapshot()).toMatchObject({ block: 'disabled', showing: false })
  })
  it('顯示中遊戲失焦 → blocked 但不送 hide、不擷取', async () => {
    const h = harness()
    await showScarabs(h)
    const caps = h.state.captures
    h.env.gameActive = false
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'game-inactive' })
    expect(h.events).toHaveLength(1)
    expect(h.scan.showing).toBe(true)
    expect(h.state.captures).toBe(caps)
  })
  it('setUiState 的設定視窗開著 → ui-open', async () => {
    const h = harness()
    h.scan.setUiState({ panel: false, settings: true, picker: false })
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'ui-open' })
    expect(h.state.ocrs).toBe(0)
  })
})

describe('S9d 畫面沒變不 OCR', () => {
  it('縮圖相同 → unchanged、只 OCR 一次;縮圖改變 → 再 OCR', async () => {
    const h = harness()
    await showScarabs(h)
    // 沒做差分 → 每 500 ms 跑一次 OCR,CPU 浪費
    expect(await h.scan.tick()).toEqual({ kind: 'unchanged' })
    expect(h.state.ocrs).toBe(1)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr' })
    expect(h.state.ocrs).toBe(2)
  })
  it('縮圖相同但 client 大小改變 → 仍重新 OCR', async () => {
    const h = harness()
    await showScarabs(h)
    h.state.client = { w: W - 100, h: H }
    // 差分沒比 client → 換解析度後疊層停在舊尺寸
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr' })
    expect(h.state.ocrs).toBe(2)
  })
})

describe('S11 共用 OCR 互斥', () => {
  it('ocrBusy 為真 → busy、不呼叫 recognize', async () => {
    const h = harness()
    h.state.busy = true
    // 不檢查互斥 → 與褻瀆 / 符文同時用同一個 WinOcr 行程
    expect(await h.scan.tick()).toEqual({ kind: 'busy' })
    expect(h.state.ocrs).toBe(0)
    expect(h.events).toHaveLength(0)
    h.state.busy = false
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', sent: 'show' })
  })
  it('main.ts 三個掃描的 ocrBusy 互相包含', () => {
    const src = fs.readFileSync(path.join(ROOT, 'main/src/main.ts'), 'utf8')
    const busyOf = (ctor: string): string => {
      const m = new RegExp(`new ${ctor}\\(\\{[\\s\\S]*?ocrBusy:\\s*([^\\n]*)`).exec(src)
      if (!m) throw new Error(`main.ts 找不到 ${ctor} 的 ocrBusy`)
      return m[1]
    }
    // 漏接一邊 → 倉庫掃描與另兩個同時 OCR
    expect(busyOf('RevealScan')).toContain('stashScan.busy')
    expect(busyOf('RuneshapeScan')).toContain('stashScan.busy')
    expect(busyOf('StashScan')).toContain('revealScan.busy')
    expect(busyOf('StashScan')).toContain('runeshapeScan.busy')
  })
})

describe('S11b 停用後不再排程', () => {
  it('停用 → 第一個 tick 後沒有計時器;poke 重看;失焦 → 10 秒保底;正常 → intervalMs', async () => {
    const h = harness()
    h.cfg.enabled = false
    h.scan.start(100)
    await h.clk.advance(100)
    expect(h.scan.snapshot().block).toBe('disabled')
    // 停用仍排下一個 tick → 閒置也一直喚醒
    expect(h.clk.pending()).toEqual([])

    h.cfg.enabled = true
    h.env.gameActive = false
    h.scan.poke()
    await h.clk.advance(1)
    // poke 沒觸發重看 → 啟用後要等很久
    expect(h.scan.snapshot().block).toBe('game-inactive')
    const p = h.clk.pending()
    expect(p).toHaveLength(1)
    expect(p[0]).toBeGreaterThan(9000)
    expect(p[0]).toBeLessThanOrEqual(10_000)

    h.env.gameActive = true
    h.scan.poke()
    await h.clk.advance(1)
    expect(h.state.ocrs).toBe(1)
    expect(h.scan.snapshot().block).toBeNull()
    const q = h.clk.pending()
    expect(q).toHaveLength(1)
    expect(q[0]).toBeGreaterThan(400)
    expect(q[0]).toBeLessThanOrEqual(500)
    h.scan.stop()
    expect(h.clk.pending()).toEqual([])
  })
  it('不是 PoE1 → 同樣不排下一個 tick', async () => {
    const h = harness()
    h.cfg.game = 'poe2'
    h.scan.start(0)
    await h.clk.advance(1)
    expect(h.scan.snapshot().block).toBe('not-poe1')
    expect(h.clk.pending()).toEqual([])
  })
})

describe('S12 游標換格才送事件', () => {
  function cursorHarness () {
    const clk = fakeClock()
    const st = { cursor: { x: 0, y: 0 }, active: true }
    const bounds = { x: 100, y: 50, width: W, height: H }
    const sent: Array<{ refName: string | null }> = []
    const cur = new StashCursor({
      clock: clk.clock,
      cursor: () => st.cursor,
      bounds: () => bounds,
      active: () => st.active,
      layouts: () => LAYOUTS,
      send: (e) => { sent.push(e) }
    })
    const at = (cx: number, cy: number) => { st.cursor = { x: bounds.x + cx, y: bounds.y + cy } }
    return { clk, st, cur, sent, at, bounds }
  }
  const cells = cellRects(LAYOUTS, 'scarabs', H, 0)

  it('同一格內移動只送一次、換格再送、移到格外送 null', async () => {
    expect(STASH_CURSOR_INTERVAL_MS).toBe(80)
    const c = cursorHarness()
    const a = cells[0]
    const b = cells.find(r => r.refName !== a.refName)!
    c.at(a.x + 2, a.y + 2)
    c.cur.setShown({ subtab: 'scarabs', yOffset: 0, clientH: H })
    expect(c.cur.polling).toBe(true)
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 2)
    // 沒減 bounds 左上 / 版面換算錯 → refName 錯
    expect(c.sent).toEqual([{ refName: a.refName }])
    c.at(a.x + a.w - 2, a.y + a.h - 2)
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 3)
    // 每次輪詢都送 → renderer 一直重畫
    expect(c.sent).toHaveLength(1)
    c.at(b.x + 1, b.y + 1)
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 2)
    expect(c.sent.at(-1)).toEqual({ refName: b.refName })
    expect(c.sent).toHaveLength(2)
    c.at(5, 5)
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 2)
    expect(c.sent.at(-1)).toEqual({ refName: null })
    expect(c.sent).toHaveLength(3)
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 3)
    expect(c.sent).toHaveLength(3)
    c.cur.stop()
  })
  it('遊戲失焦 refresh() → 停止輪詢並送一次 null', async () => {
    const c = cursorHarness()
    const a = cells[0]
    c.at(a.x + 2, a.y + 2)
    c.cur.setShown({ subtab: 'scarabs', yOffset: 0, clientH: H })
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 2)
    expect(c.sent).toEqual([{ refName: a.refName }])
    c.st.active = false
    c.cur.refresh()
    // 失焦仍輪詢 → 切到別的程式還一直讀游標
    expect(c.cur.polling).toBe(false)
    expect(c.sent.at(-1)).toEqual({ refName: null })
    const n = c.sent.length
    c.cur.refresh()
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 3)
    // 上次已是 null 仍重送 → 多餘事件
    expect(c.sent).toHaveLength(n)
    expect(c.clk.pending()).toEqual([])
  })
  it('setShown(null) 後不再輪詢', async () => {
    const c = cursorHarness()
    const a = cells[0]
    c.cur.setShown({ subtab: 'scarabs', yOffset: 0, clientH: H })
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 2)
    c.cur.setShown(null)
    expect(c.cur.polling).toBe(false)
    const n = c.sent.length
    c.at(a.x + 2, a.y + 2)
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 5)
    expect(c.sent).toHaveLength(n)
    expect(c.clk.pending()).toEqual([])
  })
  it('遊戲不在前景時 setShown 不開始輪詢', () => {
    const c = cursorHarness()
    c.st.active = false
    c.cur.setShown({ subtab: 'scarabs', yOffset: 0, clientH: H })
    expect(c.cur.polling).toBe(false)
  })
  it('資料夾偏移:格子跟著 yOffset 下移', async () => {
    const c = cursorHarness()
    const off = Math.floor(47 / 1440 * H)
    const shifted = cellRects(LAYOUTS, 'scarabs', H, off)
    const a = shifted[0]
    c.at(a.x + 2, a.y + a.h - 2)
    c.cur.setShown({ subtab: 'scarabs', yOffset: off, clientH: H })
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 2)
    // 忘了加 yOffset → 對到格外或上一列
    expect(c.sent).toEqual([{ refName: a.refName }])
    c.cur.stop()
  })
})

describe('S12b 面板範圍判定', () => {
  it('stashPanelContains 邊界(右界 / 下界不算)', () => {
    // 邊界用 ≤ 或沒 floor → 失敗
    expect(stashPanelContains(1440, 887, 0)).toBe(true)
    expect(stashPanelContains(1440, 888, 0)).toBe(false)
    expect(stashPanelContains(1440, 0, 1039)).toBe(true)
    expect(stashPanelContains(1440, 0, 1040)).toBe(false)
    expect(stashPanelContains(1440, -1, 10)).toBe(false)
    expect(stashPanelContains(1440, 10, -1)).toBe(false)
    const xl = Math.floor(H * 37 / 60)
    const yl = Math.floor(1040 / 1440 * H)
    expect(stashPanelContains(H, xl - 1, yl - 1)).toBe(true)
    expect(stashPanelContains(H, xl, 0)).toBe(false)
    expect(stashPanelContains(H, 0, yl)).toBe(false)
  })
  it('inPanel 以 bounds 左上換算成 client 座標', () => {
    const st = { cursor: { x: 0, y: 0 } }
    const bounds = { x: 100, y: 50, width: W, height: H }
    const cur = new StashCursor({
      clock: fakeClock().clock,
      cursor: () => st.cursor,
      bounds: () => bounds,
      active: () => true,
      layouts: () => LAYOUTS,
      send: () => {}
    })
    cur.setShown({ subtab: 'scarabs', yOffset: 0, clientH: H })
    const xl = Math.floor(H * 37 / 60)
    // 沒減 bounds 左上 → 偏 100 / 50 px
    st.cursor = { x: 100 + xl - 1, y: 50 + 10 }
    expect(cur.inPanel()).toBe(true)
    st.cursor = { x: 100 + xl, y: 50 + 10 }
    expect(cur.inPanel()).toBe(false)
    st.cursor = { x: 99, y: 60 }
    expect(cur.inPanel()).toBe(false)
    st.cursor = { x: 110, y: 49 }
    expect(cur.inPanel()).toBe(false)
    cur.stop()
  })
})

describe('S9e 沒找到按鈕後畫面靜止仍收起(B1)', () => {
  it('已顯示、沒找到按鈕後縮圖不再改變、游標不在格上 → 第 2 個 tick 送 hide', async () => {
    const h = harness()
    await showScarabs(h)
    h.state.lines = TOOLTIP_LINES
    h.state.hold = false
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', found: false, sent: null })
    // 沒找到時也更新差分基準 → 這裡走 unchanged,疊層永遠收不掉
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', found: false, sent: 'hide' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
  })
})

describe('S8b 維持有上限(B2b)', () => {
  it(`連續 held ${STASH_HOLD_LIMIT} 次後照常累計,第 7 次送 hide`, async () => {
    expect(STASH_HOLD_LIMIT).toBe(5)
    const h = harness()
    await showScarabs(h)
    h.state.lines = TOOLTIP_LINES
    h.state.hold = true
    for (let i = 0; i < STASH_HOLD_LIMIT; i++) {
      h.changeFrame()
      expect(await h.scan.tick(), `第 ${i + 1} 次`).toMatchObject({ found: false, held: true, sent: null })
    }
    h.changeFrame()
    // 沒有上限 → 游標停在格上按 Esc 關倉庫時疊層卡住
    expect(await h.scan.tick()).toMatchObject({ found: false, held: false, sent: null })
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, held: false, sent: 'hide' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
  })
  it('找到按鈕後 held 次數歸零', async () => {
    const h = harness()
    await showScarabs(h)
    h.state.hold = true
    for (let i = 0; i < STASH_HOLD_LIMIT - 1; i++) {
      h.state.lines = TOOLTIP_LINES
      h.changeFrame()
      await h.scan.tick()
    }
    h.state.lines = SCARAB_LINES
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: true })
    h.state.lines = TOOLTIP_LINES
    for (let i = 0; i < STASH_HOLD_LIMIT; i++) {
      h.changeFrame()
      // 找到時沒歸零 → 這裡提早不維持
      expect(await h.scan.tick(), `第 ${i + 1} 次`).toMatchObject({ found: false, held: true, sent: null })
    }
  })
})

describe('S12c 游標在格上判定(B2a)', () => {
  function onCellHarness () {
    const st = { cursor: { x: 0, y: 0 } }
    const bounds = { x: 100, y: 50, width: W, height: H }
    const cur = new StashCursor({
      clock: fakeClock().clock,
      cursor: () => st.cursor,
      bounds: () => bounds,
      active: () => true,
      layouts: () => LAYOUTS,
      send: () => {}
    })
    const at = (cx: number, cy: number) => { st.cursor = { x: bounds.x + cx, y: bounds.y + cy } }
    return { cur, at }
  }
  const cells = cellRects(LAYOUTS, 'scarabs', H, 0)

  it('格上為真;頁籤列 / 格子之間為假(仍在面板內)', () => {
    const c = onCellHarness()
    c.cur.setShown({ subtab: 'scarabs', yOffset: 0, clientH: H })
    const a = cells[0]
    c.at(a.x + 2, a.y + 2)
    expect(c.cur.onCell()).toBe(true)
    // 用整個面板判定 → 點別的頁籤時也維持,徽章錯畫在別頁
    const tab = buttonRects(H, 0)[1]
    c.at(tab.x + 5, tab.y + 5)
    expect(c.cur.inPanel()).toBe(true)
    expect(c.cur.onCell()).toBe(false)
    const b = cells.find(r => r.y === a.y && r.x > a.x + a.w)!
    const gx = Math.floor((a.x + a.w + b.x) / 2)
    expect(b.x - (a.x + a.w)).toBeGreaterThan(1)
    c.at(gx, a.y + 2)
    expect(c.cur.inPanel()).toBe(true)
    expect(c.cur.onCell()).toBe(false)
    c.cur.stop()
  })
  it('疊層沒顯示 → 假', () => {
    const c = onCellHarness()
    const a = cells[0]
    c.at(a.x + 2, a.y + 2)
    expect(c.cur.onCell()).toBe(false)
    c.cur.setShown({ subtab: 'scarabs', yOffset: 0, clientH: H })
    expect(c.cur.onCell()).toBe(true)
    c.cur.setShown(null)
    expect(c.cur.onCell()).toBe(false)
  })
  it('main.ts 的 holdOnMiss 用 onCell', () => {
    const src = fs.readFileSync(path.join(ROOT, 'main/src/main.ts'), 'utf8')
    const m = /new StashScan\(\{[\s\S]*?holdOnMiss:\s*([^\n]*)/.exec(src)
    expect(m?.[1]).toContain('stashCursor.onCell()')
  })
})

describe('S9f host-config 未到不掃描(I2)', () => {
  it('main.ts 的 StashScan enabled 要求 hostCfg 已到', () => {
    const src = fs.readFileSync(path.join(ROOT, 'main/src/main.ts'), 'utf8')
    const m = /new StashScan\(\{[\s\S]*?enabled:\s*([^\n]*)/.exec(src)
    // 只寫 hostCfg?.stashPricesEnabled !== false → 啟動空窗 PoE2 使用者也被擷取 + OCR
    expect(m?.[1]).toContain('hostCfg != null')
  })
})

describe('S9g 沒顯示時沒找到也照常差分(N1)', () => {
  it('沒顯示時連續沒找到、縮圖不變 → 第 2 個 tick 回 unchanged、recognize 只呼叫一次', async () => {
    const h = harness()
    h.state.lines = TOOLTIP_LINES
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', found: false, sent: null })
    // 沒找到一律作廢基準 → 平常玩遊戲每 tick 都 OCR ×3
    expect(await h.scan.tick()).toEqual({ kind: 'unchanged' })
    expect(h.state.ocrs).toBe(1)
    expect(h.events).toHaveLength(0)
  })
})

describe('S18 使用者框選的倉庫 OCR 區域', () => {
  it('沒框區域 → OCR 預設按鈕列(stripRect)', async () => {
    // 預設路徑被改壞 → 沒框過的使用者偵測不到碎片頁
    const h = harness()
    await h.scan.tick()
    const s = stripRect(H)
    expect(h.state.ocrRects[0]).toEqual({ x: s.x, y: s.y, width: s.w, height: s.h })
  })
  it('框了區域 → OCR 使用者的區域(client 比例換成像素)', async () => {
    // 忽略 cfg.region → 使用者框了也沒用
    const h = harness()
    h.cfg.region = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 }
    await h.scan.tick()
    expect(h.state.ocrRects[0]).toEqual({ x: Math.round(0.1 * W), y: Math.round(0.1 * H), width: Math.round(0.2 * W), height: Math.round(0.05 * H) })
  })
  it('改了區域 → 縮圖相同也重新 OCR', async () => {
    // 差分基準沒綁區域 → 換區域後沿用舊結果、不重看
    const h = harness()
    await h.scan.tick()
    h.cfg.region = { x: 0, y: 0.1, w: 0.4, h: 0.1 }
    await h.scan.tick()
    expect(h.state.ocrs).toBe(2)
  })
})

describe('S18b 自訂區域夾在按鈕可能出現的範圍內(R1)', () => {
  const zone = stripZone(W, H)
  const asPhys = (r: { x: number, y: number, w: number, h: number }) => ({ x: r.x, y: r.y, width: r.w, height: r.h })
  it('全畫面區域 → OCR 矩形 = stripZone,且只記一次 log', async () => {
    const h = harness()
    h.cfg.region = { x: 0, y: 0, w: 1, h: 1 }
    await h.scan.tick()
    // 沒上限 → 整張畫面 ×3 OCR
    expect(h.state.ocrRects[0]).toEqual(asPhys(zone))
    h.changeFrame()
    await h.scan.tick()
    expect(h.state.ocrRects[1]).toEqual(asPhys(zone))
    expect(h.logs.filter(m => m.includes('自訂 OCR 區域超出按鈕列範圍'))).toHaveLength(1)
  })
  it('部分超出 → 取交集', async () => {
    const h = harness()
    h.cfg.region = { x: 0.1, y: 0.1, w: 0.5, h: 0.05 }
    await h.scan.tick()
    const x = Math.round(0.1 * W)
    const y = Math.round(0.1 * H)
    // 只夾一邊 / 沒夾 → 寬度超出倉庫面板
    expect(h.state.ocrRects[0]).toEqual({ x, y, width: zone.x + zone.w - x, height: Math.round(0.05 * H) })
  })
  it('完全在範圍外 → 改用預設 stripRect', async () => {
    const h = harness()
    h.cfg.region = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }
    await h.scan.tick()
    // 交集為空仍 OCR 使用者區域 → 永遠找不到按鈕
    expect(h.state.ocrRects[0]).toEqual(asPhys(stripRect(H)))
  })
  it('擷取偏移不為 0 → 自訂區域與預設都減掉偏移', async () => {
    const h = harness()
    h.state.offset = { x: 10, y: 20 }
    h.state.size = { w: W - 10, h: H - 20 }
    h.cfg.region = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 }
    await h.scan.tick()
    // 交集後忘了換成影像座標 → 偏 10 / 20 px
    expect(h.state.ocrRects[0]).toEqual({ x: Math.round(0.1 * W) - 10, y: Math.round(0.1 * H) - 20, width: Math.round(0.2 * W), height: Math.round(0.05 * H) })
    h.cfg.region = null
    await h.scan.tick()
    const s = stripRect(H)
    expect(h.state.ocrRects[1]).toEqual({ x: 0, y: s.y - 20, width: s.w - 10, height: s.h })
  })
})
