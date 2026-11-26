/**
 * PoE1 倉庫價格疊層:格子擬合掃描(StashScan)與游標換格(StashCursor)。
 * 2026-11-26 起偵測 = 在搜尋範圍灰階上擬合格位方框(core fit.ts),不再 OCR 子頁按鈕列。
 * 只依規格寫;假時鐘 / 假擷取 / 假 fit·verify(`stash-fit-fakes.ts`,用 target 控制有沒有對上)/ 假游標,不碰 Electron。
 * 版面:data/poe1/stash/layouts.json(3.30)。
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
import { formulaGrid, gridRects, MIN_FIT_SCORE } from '../../core/src/stash/fit'
import { stashLeft } from '../../core/src/stash/layout'
import { parseDigitTemplates, qtyCropRect } from '../../core/src/stash/quantity'
import { LAYOUTS_330 as LAYOUTS, createFitFakes } from './stash-fit-fakes'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const H = 1432
const W = 2546
const GRID = formulaGrid(LAYOUTS, 'general', W, H)
const TEMPLATES = parseDigitTemplates(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe1/stash/digit-templates.json'), 'utf8')))

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

/** `qty` = 帶數字模板(會讀數量,假 pixels 全空白);預設不讀數量(templates 回 null) */
function harness (opts: { qty?: boolean } = {}) {
  const clk = fakeClock()
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 500 }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 100, y: 50, width: W, height: H } }
  const state = {
    hold: false,
    frame: fp(10),
    client: { w: W, h: H },
    captures: 0,
    /** 偵測不該呼叫 OCR:被呼叫就記一次並 throw */
    recognizes: 0,
    /** 擷取偏移(client → 影像);size 省略 = client 大小 */
    offset: { x: 0, y: 0 },
    size: null as { w: number, h: number } | null,
    layouts: LAYOUTS as typeof LAYOUTS | null,
    pixelRects: [] as Array<{ x: number, y: number, width: number, height: number }>,
    /** 擷取影像座標的遮罩(我們自己畫的徽章) */
    maskRects: [] as Array<{ x: number, y: number, w: number, h: number }>,
    qtyPaused: false
  }
  const fits = createFitFakes(LAYOUTS, () => state.offset)
  fits.show('general', W, H)
  const logs: string[] = []
  const events: StashScanEvent[] = []
  const showingCalls: Array<{ showing: boolean, st: { subtab: unknown, grid: unknown, clientH: number } }> = []
  const scan = new StashScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    capture: async (): Promise<ScanCapture> => {
      state.captures++
      const client = { ...state.client }
      return {
        size: state.size ? { ...state.size } : { ...client },
        offset: { ...state.offset },
        client,
        fingerprint: () => state.frame,
        recognize: async () => { state.recognizes++; throw new Error('倉庫偵測不該呼叫 OCR') },
        gray: fits.gray,
        maskRects: state.maskRects.map(m => ({ ...m })),
        ...(opts.qty
          ? {
              pixels: (rect) => {
                state.pixelRects.push({ ...rect })
                return { data: new Uint8Array(rect.width * rect.height * 4), width: rect.width, height: rect.height, channels: 4, x: rect.x, y: rect.y }
              }
            }
          : {})
      }
    },
    send: (e) => { events.push(e) },
    fit: fits.fit,
    verify: fits.verify,
    qty: { layouts: () => state.layouts, templates: () => opts.qty ? TEMPLATES : null },
    holdOnMiss: () => state.hold,
    qtyPaused: () => state.qtyPaused,
    onShowingChange: (showing, st) => { showingCalls.push({ showing, st: { ...st } }) },
    log: (m) => { logs.push(m) }
  })
  /** 換畫面(縮圖不同 → 一定重新比對) */
  let frameV = 10
  const changeFrame = () => { frameV = (frameV + 37) % 250; state.frame = fp(frameV) }
  return { scan, events, showingCalls, cfg, env, state, clk, changeFrame, logs, fits }
}

type Hn = ReturnType<typeof harness>
async function showGeneral (h: Hn) {
  const r = await h.scan.tick()
  expect(r).toMatchObject({ kind: 'fit', found: true, subtab: 'general', sent: 'show' })
  expect(h.scan.showing).toBe(true)
}

describe('S8 說明框遮住格子仍保留', () => {
  it('已顯示後連續 5 次沒對上格子且游標在格上 → held、不送 hide', async () => {
    const h = harness()
    await showGeneral(h)
    h.fits.none()
    h.state.hold = true
    for (let i = 0; i < 5; i++) {
      h.changeFrame()
      const r = await h.scan.tick()
      // 沒看 holdOnMiss、或 held 仍累計次數 → 第 2 次就送 hide
      expect(r, `第 ${i + 1} 次`).toMatchObject({ kind: 'fit', found: false, held: true, sent: null })
    }
    expect(h.events.map(e => e.reason)).toEqual(['show'])
    expect(h.scan.showing).toBe(true)
    // 第一次顯示擬合 1 次;之後每次只驗證快取位置(不過),游標在格上時不重搜(見 R4)
    expect(h.fits.s.fits).toBe(1)
    expect(h.fits.s.verifies).toBe(5)
  })
})

describe('S9 關倉庫後清除', () => {
  it(`游標不在面板內:第 1 次沒對上不送、第 ${STASH_MISS_LIMIT} 次送 hide`, async () => {
    expect(STASH_MISS_LIMIT).toBe(2)
    const h = harness()
    await showGeneral(h)
    expect(h.showingCalls.at(-1)).toEqual({ showing: true, st: { subtab: 'general', grid: GRID, clientH: H } })
    h.fits.none()
    h.state.hold = false
    h.changeFrame()
    // 一次沒對上就清 → 說明框閃一下疊層就消失
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, held: false, sent: null })
    expect(h.events).toHaveLength(1)
    h.changeFrame()
    // 沒累計 / 門檻寫錯 → 不送 hide,疊層殘留
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, sent: 'hide' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    expect(h.events[1].seq).toBeGreaterThan(h.events[0].seq)
    expect(h.scan.showing).toBe(false)
    expect(h.showingCalls.at(-1)?.showing).toBe(false)
  })
  it('沒對上後又對上 → 累計歸零', async () => {
    const h = harness()
    await showGeneral(h)
    h.fits.none()
    h.changeFrame()
    await h.scan.tick()
    h.fits.show('general', W, H)
    h.changeFrame()
    await h.scan.tick()
    h.fits.none()
    h.changeFrame()
    // 對上時沒清累計 → 這次就送 hide
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: null })
    expect(h.events.map(e => e.reason)).toEqual(['show'])
  })
})

describe('S9b 狀態轉換只送一次', () => {
  it('同子頁不重送、換綢帶 / 回一般先收起再送 show、對不上(異能頁)連 2 次 hide、client 大小變了先收起再重送', async () => {
    const h = harness()
    await showGeneral(h)
    const ev0 = h.events[0]
    // 事件內容錯(client / grid)→ renderer 疊層畫錯位置
    expect(ev0).toMatchObject({ reason: 'show', subtab: 'general', grid: GRID, client: { w: W, h: H } })
    expect(typeof ev0.ocrMs).toBe('number')

    h.changeFrame()
    // 每次比對都重送 → renderer 疊層閃爍
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: true, subtab: 'general', sent: null })
    expect(h.events).toHaveLength(1)

    h.fits.show('threads', W, H)
    // 顯示中不重搜:驗證不過 2 次 → 收起,下一個 tick 才擬合出綢帶(2026-11-26 N1)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: null })
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: 'hide' })
    h.changeFrame()
    // 換子頁沒送新子頁的 show → 一般頁的格子價格疊在綢帶頁上
    expect(await h.scan.tick()).toMatchObject({ found: true, subtab: 'threads', sent: 'show' })
    expect(h.showingCalls.at(-1)).toEqual({ showing: true, st: { subtab: 'threads', grid: formulaGrid(LAYOUTS, 'threads', W, H), clientH: H } })

    h.fits.show('general', W, H)
    for (let i = 0; i < 2; i++) { h.changeFrame(); await h.scan.tick() }
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ subtab: 'general', sent: 'show' })
    expect(h.events.at(-1)).toMatchObject({ reason: 'show', subtab: 'general', grid: GRID })
    expect(h.showingCalls.at(-1)).toEqual({ showing: true, st: { subtab: 'general', grid: GRID, clientH: H } })

    h.fits.none()
    h.changeFrame()
    // 異能(沒版面、對不上)一次不收,連 2 次才收;收起事件不帶 grid
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: null })
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: 'hide' })
    expect(h.events.at(-1)).toMatchObject({ reason: 'hide', subtab: null })
    expect(h.events.at(-1)?.grid).toBeUndefined()
    expect(h.scan.showing).toBe(false)

    h.fits.show('general', W, H)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ subtab: 'general', sent: 'show' })
    const n = h.events.length

    h.state.client = { w: W - 200, h: H }
    h.fits.show('general', W - 200, H)
    h.changeFrame()
    // client 大小變了:舊位置一定不對,立刻收起;沒比 client 大小 → 遊戲改視窗大小後疊層仍用舊尺寸
    expect(await h.scan.tick()).toEqual(expect.objectContaining({ kind: 'fit', found: false, sent: 'hide' }))
    expect(h.scan.showing).toBe(false)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ subtab: 'general', sent: 'show' })
    expect(h.events).toHaveLength(n + 2)
    expect(h.events.at(-1)?.client).toEqual({ w: W - 200, h: H })
  })
  it('資料夾內(格子整體下移)→ show 帶下移後的 grid', async () => {
    const h = harness()
    const off = Math.floor(47 / 1440 * H)
    h.fits.show('general', W, H, off)
    // 沒把擬合出的 grid 帶進事件(又退回舊公式)→ 疊層差一列
    expect(await h.scan.tick()).toMatchObject({ found: true, subtab: 'general', sent: 'show' })
    expect(h.events[0].grid).toEqual({ ...GRID, y: GRID.y + off })
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
  it('會清疊層的原因只有 disabled / not-poe1 / not-intl / not-overlay / no-window / user-paused / not-armed', () => {
    // 失焦也清 → 切出遊戲再回來疊層要重新比對才出現(not-armed = 2026-10-15 熱鍵顯示模式未觸發)
    expect([...STASH_CLEARING_BLOCKS].sort()).toEqual(['disabled', 'no-window', 'not-armed', 'not-intl', 'not-overlay', 'not-poe1', 'user-paused'])
  })
  it('顯示中改成停用 → blocked 並送 hide', async () => {
    const h = harness()
    await showGeneral(h)
    h.cfg.enabled = false
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'disabled' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    expect(h.scan.showing).toBe(false)
    expect(h.showingCalls.at(-1)?.showing).toBe(false)
    expect(h.scan.snapshot()).toMatchObject({ block: 'disabled', showing: false })
  })
  it('顯示中遊戲失焦 → blocked 但不送 hide、不擷取', async () => {
    const h = harness()
    await showGeneral(h)
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
    expect(h.state.captures).toBe(0)
    expect(h.fits.s.fits).toBe(0)
  })
})

describe('S9d 畫面沒變不重新比對', () => {
  it('縮圖相同 → unchanged、不 fit 也不 verify;縮圖改變 → 只 verify', async () => {
    const h = harness()
    await showGeneral(h)
    // 沒做差分 → 每 500 ms 都比對一次,CPU 浪費
    expect(await h.scan.tick()).toEqual({ kind: 'unchanged' })
    expect(h.fits.s.fits).toBe(1)
    expect(h.fits.s.verifies).toBe(0)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit' })
    expect(h.fits.s.fits).toBe(1)
    expect(h.fits.s.verifies).toBe(1)
  })
  it('縮圖相同但 client 大小改變 → 仍重新偵測:先收起,下一個 tick 重新擬合', async () => {
    const h = harness()
    await showGeneral(h)
    h.state.client = { w: W - 100, h: H }
    h.fits.show('general', W - 100, H)
    // 差分沒比 client → 換解析度後疊層停在舊尺寸
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, sent: 'hide' })
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: true, sent: 'show' })
    expect(h.fits.s.fits).toBe(2)
    expect(h.events.at(-1)?.client).toEqual({ w: W - 100, h: H })
  })
})

describe('S11 版面沒載入', () => {
  it('layouts 回 null → busy、不擷取也不擬合;載入後恢復', async () => {
    const h = harness()
    h.state.layouts = null
    // 版面沒載入就偵測 → 沒有版面可擬合
    expect(await h.scan.tick()).toEqual({ kind: 'busy' })
    expect(h.state.captures).toBe(0)
    expect(h.fits.s.fits).toBe(0)
    expect(h.events).toHaveLength(0)
    h.state.layouts = LAYOUTS
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', sent: 'show' })
  })
  it('main.ts 的 StashScan 不再接 WinOcr(沒有 ocrBusy / textLang)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'main/src/main.ts'), 'utf8')
    const i = src.indexOf('stashScan = new StashScan({')
    expect(i).toBeGreaterThan(0)
    const block = src.slice(i, src.indexOf('\n  })', i))
    // 倉庫偵測改格子擬合後不用 OCR → 留著會白白與褻瀆 / 符文互相等待
    expect(block).not.toContain('ocrBusy')
    expect(block).not.toContain('textLang')
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
    expect(h.fits.s.fits).toBe(1)
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
  const cells = gridRects(LAYOUTS, 'general', GRID)

  it('同一格內移動只送一次、換格再送、移到格外送 null', async () => {
    expect(STASH_CURSOR_INTERVAL_MS).toBe(80)
    const c = cursorHarness()
    const a = cells[0]
    const b = cells.find(r => r.refName !== a.refName)!
    c.at(a.x + 2, a.y + 2)
    c.cur.setShown({ subtab: 'general', grid: GRID })
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
    c.cur.setShown({ subtab: 'general', grid: GRID })
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
    c.cur.setShown({ subtab: 'general', grid: GRID })
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
    c.cur.setShown({ subtab: 'general', grid: GRID })
    expect(c.cur.polling).toBe(false)
  })
  it('格子位置整體下移(資料夾內):游標判定跟著 grid', async () => {
    const c = cursorHarness()
    const off = Math.floor(47 / 1440 * H)
    const grid = { ...GRID, y: GRID.y + off }
    const a = gridRects(LAYOUTS, 'general', grid)[0]
    c.at(a.x + 2, a.y + a.h - 2)
    c.cur.setShown({ subtab: 'general', grid })
    await c.clk.advance(STASH_CURSOR_INTERVAL_MS * 2)
    // 沒用 grid 的 y(又退回舊公式)→ 對到格外或上一列
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
    cur.setShown({ subtab: 'general', grid: GRID })
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

describe('S9e 沒對上格子後畫面靜止仍收起(B1)', () => {
  it('已顯示、沒對上後縮圖不再改變、游標不在格上 → 第 2 個 tick 送 hide', async () => {
    const h = harness()
    await showGeneral(h)
    h.fits.none()
    h.state.hold = false
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, sent: null })
    // 沒對上時也更新差分基準 → 這裡走 unchanged,疊層永遠收不掉
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, sent: 'hide' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
  })
})

describe('S8b 維持有上限(B2b)', () => {
  it(`連續 held ${STASH_HOLD_LIMIT} 次後照常累計,第 7 次送 hide`, async () => {
    expect(STASH_HOLD_LIMIT).toBe(5)
    const h = harness()
    await showGeneral(h)
    h.fits.none()
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
  it('游標一直停在格上:超過維持上限也不重搜、不改判成綢帶,照常收起', async () => {
    const h = harness()
    await showGeneral(h)
    const fitsBefore = h.fits.fits
    h.state.hold = true
    // 快取的一般頁位置驗證不過(說明框蓋住),而重搜會對上綢帶
    h.fits.show('threads', W, H)
    h.fits.verifyScore = 0
    for (let i = 0; i < STASH_HOLD_LIMIT + 2; i++) {
      h.changeFrame()
      await h.scan.tick()
    }
    expect(h.fits.fits).toBe(fitsBefore)
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    expect(h.events.some(e => e.subtab === 'threads')).toBe(false)
  })
  it('對上格子後 held 次數歸零', async () => {
    const h = harness()
    await showGeneral(h)
    h.state.hold = true
    h.fits.none()
    for (let i = 0; i < STASH_HOLD_LIMIT - 1; i++) {
      h.changeFrame()
      await h.scan.tick()
    }
    h.fits.show('general', W, H)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: true })
    h.fits.none()
    for (let i = 0; i < STASH_HOLD_LIMIT; i++) {
      h.changeFrame()
      // 對上時沒歸零 → 這裡提早不維持
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
  const cells = gridRects(LAYOUTS, 'general', GRID)

  it('格上為真;格子上方的頁籤區 / 格子之間為假(仍在面板內)', () => {
    const c = onCellHarness()
    c.cur.setShown({ subtab: 'general', grid: GRID })
    const a = cells[0]
    c.at(a.x + 2, a.y + 2)
    expect(c.cur.onCell()).toBe(true)
    // 用整個面板判定 → 點別的頁籤時也維持,徽章錯畫在別頁
    expect(a.y).toBeGreaterThan(40)
    c.at(a.x + 5, a.y - 30)
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
    c.cur.setShown({ subtab: 'general', grid: GRID })
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
    // 只寫 hostCfg?.stashPricesEnabled !== false → 啟動空窗 PoE2 使用者也被擷取
    expect(m?.[1]).toContain('hostCfg != null')
  })
})

describe('S9g 沒顯示時沒對上也照常差分(N1)', () => {
  it('沒顯示時連續沒對上、縮圖不變 → 第 2 個 tick 回 unchanged、fit 只呼叫一次', async () => {
    const h = harness()
    h.fits.none()
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, sent: null })
    // 沒對上一律作廢基準 → 平常玩遊戲每 tick 都擬合
    expect(await h.scan.tick()).toEqual({ kind: 'unchanged' })
    expect(h.fits.s.fits).toBe(1)
    expect(h.events).toHaveLength(0)
  })
})

describe('S18 搜尋範圍(格子可能出現的區塊)', () => {
  it('沒框區域 → 搜尋範圍 = 預設(x 從黑邊前一點、y 10%–85% 高、寬 70% 高)', async () => {
    // 預設範圍被改壞 → 沒框過的使用者偵測不到碎片頁
    const h = harness()
    await h.scan.tick()
    expect(h.fits.s.areas[0]).toEqual({ x: 0, y: 143, width: 1003, height: 1074 })
  })
  it('改了區域 → 縮圖相同也重新比對(不走 unchanged)', async () => {
    // 差分基準沒綁區域 → 換區域後沿用舊結果、不重看
    const h = harness()
    await h.scan.tick()
    h.cfg.region = { x: 0, y: 0.1, w: 0.4, h: 0.3 }
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit' })
    expect(h.fits.s.verifies).toBe(1)
    expect(h.fits.s.areas).toHaveLength(2)
  })
  it('擷取偏移不為 0 → 搜尋範圍(預設與自訂)都換成影像座標', async () => {
    const h = harness()
    h.state.offset = { x: 10, y: 20 }
    h.state.size = { w: W - 10, h: H - 20 }
    h.fits.show('general', W, H)
    await h.scan.tick()
    // 忘了減偏移 → 範圍偏 10 / 20 px
    expect(h.fits.s.areas[0]).toEqual({ x: 0, y: 123, width: 993, height: 1074 })
    h.cfg.region = { x: 0.1, y: 0.1, w: 0.2, h: 0.3 }
    await h.scan.tick()
    expect(h.fits.s.areas[1]).toEqual({ x: 193, y: 80, width: 612, height: 516 })
  })
})

describe('S19 使用者暫停熱鍵(T21)', () => {
  it('顯示中暫停 → 立刻送 hide、之後 tick 被擋且不擷取、不排計時器', async () => {
    const h = harness()
    await showGeneral(h)
    h.scan.start(1_000_000)
    // 回傳暫停後的狀態(main 用來顯示通知)
    expect(h.scan.toggleUserPause()).toBe(true)
    expect(h.scan.paused).toBe(true)
    // 沒收掉 → 暫停了徽章還留在畫面上
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    await h.clk.advance(1)
    const caps = h.state.captures
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'user-paused' })
    expect(h.state.captures).toBe(caps)
    // 暫停中仍排保底 tick → 閒置也一直喚醒
    expect(h.clk.pending()).toEqual([])
    expect(h.scan.snapshot().block).toBe('user-paused')
  })
  it('繼續 → 立刻重看並恢復偵測', async () => {
    const h = harness()
    h.scan.start(1_000_000)
    h.scan.toggleUserPause()
    await h.clk.advance(1)
    expect(h.fits.s.fits).toBe(0)
    expect(h.scan.toggleUserPause()).toBe(false)
    await h.clk.advance(1)
    // 繼續後沒 poke → 要等很久才恢復
    expect(h.fits.s.fits).toBe(1)
    expect(h.scan.showing).toBe(true)
    h.scan.stop()
  })
  it('擬合進行中按暫停 → 那一輪不送 show、疊層不留著', async () => {
    const h = harness()
    h.fits.s.duringFit = () => { h.scan.toggleUserPause() }
    await h.scan.tick()
    expect(h.events.map(e => e.reason)).not.toContain('show')
    expect(h.scan.showing).toBe(false)
    expect(h.showingCalls.every(c => !c.showing)).toBe(true)
    expect(h.scan.snapshot().block).toBe('user-paused')
    expect(h.scan.blockCounts['user-paused']).toBe(1)
    expect(h.logs.some(l => l.includes('暫停:user-paused'))).toBe(true)
  })
  it('user-paused 屬於會收掉疊層的擋下原因', () => {
    expect(STASH_CLEARING_BLOCKS.has('user-paused')).toBe(true)
  })
  it('setUserPause 已是同狀態不重送事件', () => {
    const h = harness()
    expect(h.scan.setUserPause(false)).toBe(false)
    expect(h.scan.setUserPause(true)).toBe(true)
    expect(h.scan.setUserPause(true)).toBe(true)
    expect(h.events).toEqual([])
  })
})

describe('S21 只支援國際服(台服完全不掃描)', () => {
  it('台服:不擷取、擋下原因 not-intl、已顯示的疊層收掉、不排計時器', async () => {
    const h = harness()
    await showGeneral(h)
    h.cfg.realm = 'tw'
    const caps = h.state.captures
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'not-intl' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
    // 迴圈跑起來:被擋下後連保底 tick 都不排
    h.scan.start(0)
    await h.clk.advance(60_000)
    expect(h.state.captures).toBe(caps)
    expect(h.clk.pending()).toEqual([])
    expect(h.scan.snapshot().block).toBe('not-intl')
    h.scan.stop()
  })
  it('切回國際服 → poke 後立刻恢復掃描', async () => {
    const h = harness()
    h.cfg.realm = 'tw'
    h.scan.start(0)
    await h.clk.advance(1)
    expect(h.state.captures).toBe(0)
    h.cfg.realm = 'intl'
    h.scan.poke()
    await h.clk.advance(1)
    expect(h.state.captures).toBe(1)
    expect(h.scan.showing).toBe(true)
    h.scan.stop()
  })
  it('not-intl 會收掉疊層;main 把 hostCfg.realm 傳進倉庫掃描、realm 改變算掃描設定變更(會 poke)', async () => {
    expect(STASH_CLEARING_BLOCKS.has('not-intl')).toBe(true)
    const src = fs.readFileSync(path.join(HERE, '../src/main.ts'), 'utf8')
    expect(src).toMatch(/stashScan = new StashScan\(\{\s*config: \(\) => \(\{[^}]*realm: hostCfg\?\.realm/)
    const { scanConfigKey } = await import('../src/scan-config')
    const base = { game: 'poe1' as const, stashPricesEnabled: true }
    expect(scanConfigKey({ ...base, realm: 'intl' })).not.toBe(scanConfigKey({ ...base, realm: 'tw' }))
  })
})

describe('S22 超寬螢幕黑邊(遊戲畫面 2.4:1、左右補黑)', () => {
  const WIDE = 5120
  const X0 = stashLeft(WIDE, H)

  it('格子在黑邊右側:搜尋範圍從黑邊附近開始並涵蓋格子,show 的 grid 在黑邊右側', async () => {
    const h = harness()
    h.state.client = { w: WIDE, h: H }
    h.env.bounds = { x: 0, y: 0, width: WIDE, height: H }
    const t = h.fits.show('general', WIDE, H)
    // 沒套黑邊 → 搜尋範圍在黑邊上、格子不在範圍內
    await showGeneral(h)
    expect(t.grid.x).toBeGreaterThanOrEqual(X0)
    expect(h.events[0].grid).toEqual(t.grid)
    const area = h.fits.s.areas[0]
    expect(area.x).toBeLessThanOrEqual(X0)
    expect(area.x).toBeGreaterThan(X0 - H * 0.1)
    const cells = gridRects(LAYOUTS, 'general', t.grid)
    expect(Math.min(...cells.map(c => c.x))).toBeGreaterThanOrEqual(area.x)
    expect(Math.max(...cells.map(c => c.x + c.w))).toBeLessThanOrEqual(area.x + area.width)
  })

  it('grid 帶黑邊位移:游標判定照 grid(不再另外扣黑邊)', async () => {
    const clk = fakeClock()
    const bounds = { x: 0, y: 0, width: WIDE, height: H }
    const grid = formulaGrid(LAYOUTS, 'general', WIDE, H)
    const cell = gridRects(LAYOUTS, 'general', grid)[0]
    expect(cell.x).toBeGreaterThanOrEqual(X0)
    const sent: Array<{ refName: string | null }> = []
    const cur = new StashCursor({
      clock: clk.clock,
      cursor: () => ({ x: cell.x + 2, y: cell.y + 2 }),
      bounds: () => bounds,
      active: () => true,
      layouts: () => LAYOUTS,
      send: (e) => { sent.push(e) }
    })
    cur.setShown({ subtab: 'general', grid })
    await clk.advance(STASH_CURSOR_INTERVAL_MS * 2)
    expect(sent).toEqual([{ refName: cell.refName }])
    expect(cur.inPanel()).toBe(true)
    cur.stop()
  })
})

describe('S1–S5 格子擬合流程', () => {
  it('S1 顯示後同畫面變化:只呼叫 verify、不重呼叫 fit', async () => {
    const h = harness()
    await showGeneral(h)
    expect(h.fits.s.fits).toBe(1)
    for (let i = 0; i < 3; i++) {
      h.changeFrame()
      // 快取位置還對得上卻重新擬合 → 每個變化都整個重搜,CPU 爆
      expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: true, sent: null })
    }
    expect(h.fits.s.fits).toBe(1)
    expect(h.fits.s.verifies).toBe(3)
    expect(h.events).toHaveLength(1)
  })

  it('S2 verify 不過:顯示中不 fit、連 2 次收起,下一個 tick fit 並送新 grid', async () => {
    const h = harness()
    await showGeneral(h)
    // 倉庫往下移了(例如開 / 關資料夾):快取位置對不上
    const moved = h.fits.show('general', W, H, 47)
    expect(moved.grid.y).not.toBe(GRID.y)
    h.changeFrame()
    // 顯示中重搜 → 帶著我們自己的徽章擬合會整片偏掉(第 2 輪審查 N1)
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, sent: null })
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, sent: 'hide' })
    expect(h.fits.s.fits).toBe(1)
    expect(h.fits.s.verifies).toBe(2)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: true, subtab: 'general', sent: 'show' })
    expect(h.fits.s.fits).toBe(2)
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide', 'show'])
    expect(h.events[2].grid).toEqual(moved.grid)
    expect(h.showingCalls.at(-1)?.st.grid).toEqual(moved.grid)
  })

  it('S2b 門檻邊界:分數 = MIN_FIT_SCORE 沿用快取、略低於算一次沒對上', async () => {
    const h = harness()
    await showGeneral(h)
    h.fits.s.verifyScore = MIN_FIT_SCORE
    h.changeFrame()
    // 門檻用 > 而不是 ≥ → 剛好壓線也重擬合
    expect(await h.scan.tick()).toMatchObject({ found: true, sent: null })
    expect(h.fits.s.fits).toBe(1)
    h.fits.s.verifyScore = MIN_FIT_SCORE - 0.01
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, held: false, sent: null })
    // 顯示中不重搜
    expect(h.fits.s.fits).toBe(1)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: 'hide' })
    expect(h.fits.s.fits).toBe(1)
  })

  it('S3 偵測不呼叫 recognize(OCR)', async () => {
    const h = harness()
    // 假擷取的 recognize 一呼叫就 throw → 呼叫了 tick 會回 error
    const r = await h.scan.tick()
    expect(r).toMatchObject({ kind: 'fit', found: true, sent: 'show' })
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit' })
    h.fits.none()
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false })
    expect(h.state.recognizes).toBe(0)
  })

  it('S4 送出的 grid = fit 的影像 grid + 搜尋範圍左上 + 擷取偏移(帶偏移與黑邊);讀數量用這個 grid 的格框', async () => {
    const WIDE = 5120
    const OFF = { x: 10, y: 20 }
    const h = harness({ qty: true })
    h.state.client = { w: WIDE, h: H }
    h.state.offset = OFF
    h.state.size = { w: WIDE - OFF.x, h: H - OFF.y }
    h.env.bounds = { x: 0, y: 0, width: WIDE, height: H }
    const t = h.fits.show('general', WIDE, H)
    expect(await h.scan.tick()).toMatchObject({ found: true, sent: 'show' })
    const area = h.fits.s.areas[0]
    // 忘了加搜尋範圍左上或擷取偏移 → 格子整體偏移
    expect(h.events[0].grid).toEqual(t.grid)
    // 讀數量:擷取像素區涵蓋「client 格框 − 擷取偏移」的數字裁切區
    const px = h.state.pixelRects[0]
    expect(px).toBeDefined()
    const crops = gridRects(LAYOUTS, 'general', h.events[0].grid!)
      .map(r => qtyCropRect({ x: r.x - OFF.x, y: r.y - OFF.y, w: r.w, h: r.h }, t.grid.H, TEMPLATES.baseClientH))
    expect(px.x).toBe(Math.floor(Math.min(...crops.map(c => c.x))) - 2)
    expect(px.y).toBe(Math.floor(Math.min(...crops.map(c => c.y))) - 2)
    expect(px.y + px.height).toBe(Math.ceil(Math.max(...crops.map(c => c.y + c.h))) + 2)
  })

  it('S5 cfg.region 有值 → 搜尋範圍 = 那塊外擴 10%(cap.gray 收到的 rect)', async () => {
    const h = harness()
    h.cfg.region = { x: 0.1, y: 0.1, w: 0.2, h: 0.3 }
    await h.scan.tick()
    // client 比例 → 像素 {254.6, 143.2, 509.2, 429.6},各邊外擴 10% 後取整
    expect(h.fits.s.areas[0]).toEqual({ x: 203, y: 100, width: 612, height: 516 })
  })
})

describe('code review 回歸', () => {
  it('R4 顯示中 verify 低於門檻且游標在格上 → 不重新 fit,held、不送新 show', async () => {
    const h = harness()
    await showGeneral(h)
    h.fits.s.verifyScore = MIN_FIT_SCORE - 0.01
    h.state.hold = true
    h.changeFrame()
    // 說明框蓋住格子時重搜可能跳到別的子頁 / 錯位置
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, held: true, sent: null })
    expect(h.fits.s.fits).toBe(1)
    expect(h.fits.s.verifies).toBe(1)
    expect(h.events).toHaveLength(1)
    expect(h.scan.showing).toBe(true)
  })

  it('R5 顯示中 client 2560×1440 → 1920×1080:先收起,下一個 tick 重新 fit 的先驗 clientH = 1080', async () => {
    const h = harness()
    h.state.client = { w: 2560, h: 1440 }
    h.env.bounds = { x: 0, y: 0, width: 2560, height: 1440 }
    h.fits.show('general', 2560, 1440)
    await showGeneral(h)
    expect(h.fits.s.priors[0].clientH).toBe(1440)
    h.state.client = { w: 1920, h: 1080 }
    h.env.bounds = { x: 0, y: 0, width: 1920, height: 1080 }
    h.fits.show('general', 1920, 1080)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: false, sent: 'hide' })
    expect(h.fits.s.fits).toBe(1)
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: true, sent: 'show' })
    // 沿用舊 grid.H(1440)當先驗 → 新尺寸的格長落在搜尋範圍外
    expect(h.fits.s.fits).toBe(2)
    expect(h.fits.s.priors[1].clientH).toBe(1080)
  })

  it('R6 位置對不上且游標在格上(說明框蓋住):held、不 fit、不讀數量、不送新 show', async () => {
    const h = harness({ qty: true })
    await showGeneral(h)
    const reads = h.state.pixelRects.length
    expect(reads).toBeGreaterThan(0)
    h.state.qtyPaused = true
    h.state.hold = true
    h.fits.s.target = { subtab: 'general', grid: { ...GRID, x: GRID.x + 3 } }
    h.changeFrame()
    // 顯示中位置小改也不直接重搜;游標在格上時說明框可能蓋住數字,不能讀
    expect(await h.scan.tick()).toMatchObject({ kind: 'fit', found: false, held: true, sent: null })
    expect(h.fits.s.fits).toBe(1)
    expect(h.events).toHaveLength(1)
    expect(h.state.pixelRects).toHaveLength(reads)
  })

  it('R6b 位置小改(x+3)且游標不在格上:收起後重 fit,送新 grid 的 show', async () => {
    const h = harness({ qty: true })
    await showGeneral(h)
    h.fits.s.target = { subtab: 'general', grid: { ...GRID, x: GRID.x + 3 } }
    for (let i = 0; i < 2; i++) { h.changeFrame(); await h.scan.tick() }
    h.changeFrame()
    expect(await h.scan.tick()).toMatchObject({ found: true, subtab: 'general', sent: 'show' })
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide', 'show'])
    expect(h.events[2].grid).toEqual({ ...GRID, x: GRID.x + 3 })
  })

  it('R9 顯示中 verify 不過、游標不在格上:那 2 個 tick 不呼叫 fit(顯示中不重搜)', async () => {
    const h = harness()
    await showGeneral(h)
    h.fits.s.verifyScore = 0
    h.state.hold = false
    for (let i = 0; i < 2; i++) {
      h.changeFrame()
      await h.scan.tick()
      // 顯示中重搜 → 帶著我們的徽章擬合,實測整片偏 17–52 px
      expect(h.fits.s.fits, `第 ${i + 1} 個 tick`).toBe(1)
    }
    expect(h.fits.s.verifies).toBe(2)
    expect(h.events.map(e => e.reason)).toEqual(['show', 'hide'])
  })

  it('R7 cap.maskRects 換成搜尋範圍座標後傳給 fit / verify(img.masks)', async () => {
    const h = harness()
    h.state.maskRects = [{ x: 500, y: 400, w: 40, h: 20 }]
    await h.scan.tick()
    const a = h.fits.s.areas[0]
    expect(a.y).toBeGreaterThan(0)
    // 沒換座標 → 我們自己的徽章邊條在搜尋範圍裡位置錯,擬合被徽章干擾
    const want = { x: 500 - a.x, y: 400 - a.y, w: 40, h: 20 }
    expect(h.fits.s.fitImgs[0].masks).toContainEqual(want)
    h.changeFrame()
    await h.scan.tick()
    expect(h.fits.s.verifyImgs[0].masks).toContainEqual(want)
  })

  it('R8 舊版 region(按鈕列,h < 0.25)→ 搜尋範圍 = 預設範圍,擷取 log 註明舊版', async () => {
    const h = harness()
    h.cfg.region = { x: 0.08, y: 0.083, w: 0.35, h: 0.103 }
    await h.scan.tick()
    // 舊按鈕列框不住格子 → 升級後永遠偵測不到
    expect(h.fits.s.areas[0]).toEqual({ x: 0, y: 143, width: 1003, height: 1074 })
    expect(h.logs.some(l => l.includes('[stash] 擷取:') && l.includes('舊版'))).toBe(true)
  })
})
