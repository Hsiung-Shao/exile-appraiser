/**
 * 倉庫價值除錯:「存下倉庫擷取畫面」(設定 › 記錄按鈕 → IPC `stash-dump` → StashScan 下一次顯示中的擷取存檔)。
 * 假時鐘 / 假擷取 / 假寫檔,不碰 Electron;版面與數字模板用 repo 的真資料。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StashScanEvent } from '@ipc/types'
import type { Fingerprint, ScanCapture, ScanClock, ScanEnv } from '../src/ocr/panel-scan'
import { STASH_DUMP_TIMEOUT_MS, STASH_DUMP_WAIT_UI_MS, StashScan, type StashScanConfig } from '../src/ocr/stash-scan'
import { isStashCaptureFile, saveStashDump, stashCaptureBaseName, type StashDumpData } from '../src/ocr/stash-dump'
import { LogFileWriter, parseLogFileDay, type LogFs } from '../src/app-log'
import { SUBTAB_LABELS, buttonRects, type TextLine } from '../../core/src/stash/detect'
import { cellRects, parseStashLayouts, type StashSubtab } from '../../core/src/stash/layout'
import { parseDigitTemplates } from '../../core/src/stash/quantity'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const LAYOUTS = parseStashLayouts(JSON.parse(read('data/poe1/stash/layouts.json')))
const TEMPLATES = parseDigitTemplates(JSON.parse(read('data/poe1/stash/digit-templates.json')))
const H = 1125
const W = 2000
const OFF = { x: 7, y: 3 }

function buttonLines (): TextLine[] {
  return buttonRects(H, 0).map((r, k) => ({ text: SUBTAB_LABELS.zh[k], x: r.x + r.w / 2 - 20, y: Math.floor(201 / 1440 * H) - 8, w: 40, h: 16 }))
}
const BRIGHT: Record<StashSubtab, number[]> = { general: [160, 140, 140, 140], scarabs: [140, 160, 140, 140] }
const FP: Fingerprint = { w: 64, h: 12, data: new Uint8Array(64 * 12).fill(10) }

function harness (opts: { save?: boolean, cfg?: Partial<StashScanConfig> } = {}) {
  const cfg: StashScanConfig = { enabled: true, game: 'poe1', intervalMs: 1000, readQuantity: true, ...opts.cfg }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: W, height: H } }
  const state = { now: 50_000, cursorOnCell: false, masks: [] as Array<{ x: number, y: number, w: number, h: number }>, ocrFound: true, fp: FP }
  const timers: Array<{ fn: () => void, ms: number, at: number, done: boolean }> = []
  const clock: ScanClock = {
    now: () => state.now,
    setTimeout: (fn, ms) => { timers.push({ fn, ms, at: state.now + ms, done: false }); return timers.length },
    clearTimeout: (h) => { const t = timers[(h as number) - 1]; if (t) t.done = true }
  }
  /** 時間往前推,到期的計時器執行 */
  function advance (ms: number) {
    state.now += ms
    for (const t of timers) if (!t.done && t.at <= state.now) { t.done = true; t.fn() }
  }
  const saved: StashDumpData[] = []
  const logs: string[] = []
  const events: StashScanEvent[] = []
  const scan = new StashScan({
    clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => false,
    capture: async (): Promise<ScanCapture> => ({
      size: { w: W - OFF.x, h: H - OFF.y },
      offset: OFF,
      client: { w: W, h: H },
      fingerprint: () => state.fp,
      recognize: async () => ({ lines: state.ocrFound ? buttonLines().map(l => ({ ...l, x: l.x - OFF.x, y: l.y - OFF.y })) : [], ms: 20 }),
      gray: (rect) => {
        const k = buttonRects(H, 0).findIndex(b => Math.abs(b.x - OFF.x - rect.x) <= 1)
        return new Uint8Array(32).fill(k >= 0 ? BRIGHT.scarabs[k] : 0)
      },
      pixels: (rect) => {
        const x = Math.max(0, Math.round(rect.x))
        const y = Math.max(0, Math.round(rect.y))
        const w = Math.round(rect.width)
        const h = Math.round(rect.height)
        return { data: new Uint8Array(w * h * 4).fill(3), width: w, height: h, channels: 4, x, y }
      },
      maskRects: state.masks.map(m => ({ ...m }))
    }),
    send: (e) => { events.push(e) },
    textLang: () => 'zh',
    log: (m) => { logs.push(m) },
    qty: { layouts: () => LAYOUTS, templates: () => TEMPLATES },
    qtyPaused: () => state.cursorOnCell,
    ...(opts.save === false
      ? {}
      : { saveDump: async (d: StashDumpData) => { saved.push(d); return `C:\\u\\logs\\${stashCaptureBaseName(d.ts, d.subtab)}.png` } })
  })
  return { scan, cfg, env, state, timers, advance, saved, logs, events }
}

/** 先讓疊層顯示(蟲甲子頁) */
async function showing (h: ReturnType<typeof harness>) {
  await h.scan.tick()
  expect(h.scan.showing).toBe(true)
}

describe('檔名與清理', () => {
  it('檔名依本機時間 stash-capture-YYYYMMDD-HHmmss-子頁', () => {
    const ms = new Date(2026, 9, 5, 7, 8, 9).getTime()
    expect(stashCaptureBaseName(ms, 'scarabs')).toBe('stash-capture-20261005-070809-scarabs')
  })

  it('isStashCaptureFile 只認 png / json 的擷取檔', () => {
    expect(isStashCaptureFile('stash-capture-20261005-070809-scarabs.png')).toBe(true)
    expect(isStashCaptureFile('stash-capture-20261005-070809-general.json')).toBe(true)
    expect(isStashCaptureFile('exile-appraiser-2026-10-05.log')).toBe(false)
    expect(isStashCaptureFile('stash-capture-x.png')).toBe(false)
    expect(isStashCaptureFile('stash-capture-20261005-070809-scarabs.txt')).toBe(false)
  })

  it('記錄檔預設清理不會動擷取檔(檔名規則不符)', () => {
    expect(parseLogFileDay('stash-capture-20261005-070809-scarabs.png')).toBeNull()
  })

  it('以 isStashCaptureFile 清理:只刪超過 7 天的擷取檔', async () => {
    const now = new Date(2026, 9, 15).getTime()
    const files: Record<string, number> = {
      'stash-capture-20261001-000000-scarabs.png': now - 8 * 86_400_000,
      'stash-capture-20261001-000000-scarabs.json': now - 8 * 86_400_000,
      'stash-capture-20261014-000000-general.png': now - 86_400_000,
      'exile-appraiser-2026-10-01.log': now - 8 * 86_400_000
    }
    const removed: string[] = []
    const fake: LogFs = {
      mkdir: async () => {},
      readdir: async () => Object.keys(files),
      stat: async (f) => ({ size: 1, mtimeMs: files[path.basename(f)] }),
      unlink: async (f) => { removed.push(path.basename(f)) },
      rename: async () => {},
      openAppend: async () => ({ write: async () => {}, close: async () => {} })
    }
    await new LogFileWriter({ dir: 'X', fs: fake, now: () => now, isOwnFile: isStashCaptureFile }).purgeOld()
    expect(removed.sort()).toEqual(['stash-capture-20261001-000000-scarabs.json', 'stash-capture-20261001-000000-scarabs.png'])
  })
})

describe('saveStashDump 寫檔', () => {
  it('寫 png(編碼器拿到原始像素)+ 同名 json(含版本與 metadata),回傳 png 路徑', async () => {
    const writes: Record<string, Uint8Array | string> = {}
    const encoded: Array<{ width: number, height: number, channels: number, len: number }> = []
    const d: StashDumpData = {
      ts: new Date(2026, 9, 15, 12, 34, 56).getTime(),
      subtab: 'general',
      yOffset: 0,
      client: { w: 2560, h: 1440 },
      offset: { x: 0, y: 0 },
      origin: { x: 10, y: 20 },
      baseClientH: 1125,
      image: { data: new Uint8Array(2 * 3 * 4), width: 2, height: 3, channels: 4 },
      masks: [{ x: 1, y: 1, w: 1, h: 1 }],
      cells: [{ i: 0, refName: 'Fragment', rect: { x: 0, y: 0, w: 2, h: 3 }, crop: { x: 0, y: 0, w: 1, h: 1 }, value: null, pending: false, why: { reason: 'low-confidence', raw: '19', confidence: 0.7, margin: 0.05 } }]
    }
    const file = await saveStashDump(d, {
      dir: 'D:/logs',
      version: '0.1.2',
      encodePng: (img) => { encoded.push({ width: img.width, height: img.height, channels: img.channels, len: img.data.length }); return new Uint8Array([137, 80]) },
      io: { mkdir: async () => {}, writeFile: async (f, data) => { writes[path.basename(f)] = data } }
    })
    expect(path.basename(file)).toBe('stash-capture-20261015-123456-general.png')
    expect(encoded).toEqual([{ width: 2, height: 3, channels: 4, len: 24 }])
    expect(writes['stash-capture-20261015-123456-general.png']).toEqual(new Uint8Array([137, 80]))
    const meta = JSON.parse(writes['stash-capture-20261015-123456-general.json'] as string)
    expect(meta).toMatchObject({
      version: '0.1.2', subtab: 'general', yOffset: 0, client: { w: 2560, h: 1440 }, offset: { x: 0, y: 0 },
      origin: { x: 10, y: 20 }, image: { width: 2, height: 3 }, baseClientH: 1125, masks: [{ x: 1, y: 1, w: 1, h: 1 }]
    })
    expect(meta.cells[0]).toMatchObject({ refName: 'Fragment', value: null, why: { reason: 'low-confidence', raw: '19' } })
    expect(meta.image.data).toBeUndefined()
  })
})

describe('StashScan.requestDump', () => {
  it('疊層沒顯示:立刻回 not-showing,不存檔', async () => {
    const h = harness()
    await expect(h.scan.requestDump()).resolves.toEqual({ ok: false, reason: 'not-showing' })
    expect(h.saved).toHaveLength(0)
  })

  it('停用 / 不是 PoE1 / 台服:立刻回對應原因', async () => {
    for (const [patch, reason] of [[{ enabled: false }, 'disabled'], [{ game: 'poe2' }, 'not-poe1'], [{ realm: 'tw' }, 'not-intl']] as const) {
      const h = harness({ cfg: patch as Partial<StashScanConfig> })
      await expect(h.scan.requestDump()).resolves.toEqual({ ok: false, reason })
    }
  })

  it('沒有存檔函式:回 unsupported', async () => {
    const h = harness({ save: false })
    await showing(h)
    await expect(h.scan.requestDump()).resolves.toEqual({ ok: false, reason: 'unsupported' })
  })

  it('顯示中:下一次 tick 存檔一次,metadata 正確並寫記錄', async () => {
    const h = harness()
    await showing(h)
    const p = h.scan.requestDump()
    expect(h.saved).toHaveLength(0)
    await h.scan.tick()
    const res = await p
    expect(h.saved).toHaveLength(1)
    const d = h.saved[0]
    expect(d).toMatchObject({ subtab: 'scarabs', yOffset: 0, client: { w: W, h: H }, offset: OFF, baseClientH: TEMPLATES.baseClientH })
    const rects = cellRects(LAYOUTS, 'scarabs', H, 0)
    expect(d.cells).toHaveLength(rects.length)
    // 格子矩形 = 像素區座標(client − 擷取偏移 − 像素區原點)
    expect(d.cells[0].rect).toEqual({ x: rects[0].x - OFF.x - d.origin.x, y: rects[0].y - OFF.y - d.origin.y, w: rects[0].w, h: rects[0].h })
    expect(d.cells[0].refName).toBe(rects[0].refName)
    expect(d.image.width * d.image.height * d.image.channels).toBe(d.image.data.length)
    // 影像右界含延伸裁切:涵蓋最右格的右緣
    expect(d.image.width).toBeGreaterThan(Math.max(...d.cells.map(c => c.crop.x + c.crop.w)))
    expect(res).toEqual({ ok: true, file: expect.stringMatching(/stash-capture-\d{8}-\d{6}-scarabs\.png$/) })
    expect(h.logs.some(l => /^\[stash\] 已存擷取畫面 stash-capture-\d{8}-\d{6}-scarabs\.png$/.test(l))).toBe(true)
    await h.scan.tick()
    expect(h.saved).toHaveLength(1)
  })

  it('遮罩矩形換成像素區座標', async () => {
    const h = harness()
    await showing(h)
    h.state.masks = [{ x: 500, y: 400, w: 30, h: 12 }]
    const p = h.scan.requestDump()
    await h.scan.tick()
    await p
    const d = h.saved[0]
    expect(d.masks).toEqual([{ x: 500 - d.origin.x, y: 400 - d.origin.y, w: 30, h: 12 }])
  })

  it('同時按兩次:共用同一個請求,只存一次', async () => {
    const h = harness()
    await showing(h)
    const a = h.scan.requestDump()
    const b = h.scan.requestDump()
    await h.scan.tick()
    expect(await a).toEqual(await b)
    expect(h.saved).toHaveLength(1)
  })

  it('等不到擷取:逾時回 timeout,之後的 tick 不再存檔', async () => {
    const h = harness()
    await showing(h)
    const p = h.scan.requestDump()
    expect(h.timers.at(-1)!.ms).toBe(STASH_DUMP_TIMEOUT_MS)
    h.advance(STASH_DUMP_TIMEOUT_MS)
    await expect(p).resolves.toEqual({ ok: false, reason: 'timeout' })
    await h.scan.tick()
    expect(h.saved).toHaveLength(0)
  })

  it('設定視窗開著(暫停):等較久,關閉設定後的 tick 存檔', async () => {
    const h = harness()
    await showing(h)
    h.scan.setUiState({ panel: false, settings: true, picker: false })
    const p = h.scan.requestDump()
    expect(h.timers.at(-1)!.ms).toBe(STASH_DUMP_WAIT_UI_MS)
    await h.scan.tick()
    expect(h.saved).toHaveLength(0)
    h.scan.setUiState({ panel: false, settings: false, picker: false })
    await h.scan.tick()
    await expect(p).resolves.toMatchObject({ ok: true })
    expect(h.saved).toHaveLength(1)
  })

  it('游標停在格上的 tick 不存,下一個乾淨的 tick 才存', async () => {
    const h = harness()
    await showing(h)
    const p = h.scan.requestDump()
    h.state.cursorOnCell = true
    await h.scan.tick()
    expect(h.saved).toHaveLength(0)
    h.state.cursorOnCell = false
    await h.scan.tick()
    await expect(p).resolves.toMatchObject({ ok: true })
  })

  it('等待中疊層收起:回 not-showing', async () => {
    const h = harness()
    await showing(h)
    const p = h.scan.requestDump()
    // 關掉倉庫:按鈕列畫面變了、OCR 找不到按鈕;游標在格上 → 這幾個 tick 不讀數量(不會先存檔)
    h.state.ocrFound = false
    h.state.cursorOnCell = true
    h.state.fp = { ...FP, data: new Uint8Array(FP.data.length).fill(200) }
    for (let i = 0; i < 4 && h.scan.showing; i++) await h.scan.tick()
    expect(h.scan.showing).toBe(false)
    await expect(p).resolves.toEqual({ ok: false, reason: 'not-showing' })
  })

  it('寫檔失敗:回 write-failed 帶訊息', async () => {
    const h = harness()
    await showing(h)
    ;(h.scan as unknown as { deps: { saveDump: () => Promise<string> } }).deps.saveDump = async () => { throw new Error('EACCES') }
    const p = h.scan.requestDump()
    await h.scan.tick()
    await expect(p).resolves.toEqual({ ok: false, reason: 'write-failed', message: 'EACCES' })
  })
})

describe('IPC 守門', () => {
  const main = read('main/src/main.ts')
  const entry = (ch: string) => {
    const i = main.indexOf(`'${ch}':`)
    expect(i, `main.ts 沒有登錄 ${ch}`).toBeGreaterThan(0)
    const rest = main.slice(i + 1)
    const next = rest.search(/\n    '[a-z-]+':/)
    return main.slice(i, i + 1 + (next < 0 ? rest.length : next))
  }

  it('stash-dump:invoke + preview: false,呼叫 requestDump', () => {
    const e = entry('stash-dump')
    expect(e).toContain("kind: 'invoke'")
    expect(e).toContain('preview: false')
    expect(e).toContain('stashScan.requestDump()')
  })

  it('不在預覽事件 / 預覽方法表;preload 與 HostApi 對應', async () => {
    const m = /PREVIEW_EVENTS[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(read('main/src/host-handlers.ts'))
    expect(m).not.toBeNull()
    expect(m![1]).not.toContain('stash')
    const { HOST_METHOD_CHANNELS } = await import('../src/preview-server')
    expect(Object.values(HOST_METHOD_CHANNELS)).not.toContain('stash-dump')
    expect(read('main/src/preload.ts')).toContain("stashDump: () => ipcRenderer.invoke('stash-dump')")
    expect(read('ipc/types.ts')).toMatch(/stashDump\?: \(\) => Promise<StashDumpResult>/)
  })

  it('main 啟動時清理 7 天前的擷取檔、存檔接 LOG_DIR', () => {
    expect(main).toMatch(/isOwnFile: isStashCaptureFile/)
    expect(main).toMatch(/saveDump: \(d\) => saveStashDump\(d, \{ dir: LOG_DIR\(\)/)
  })
})
