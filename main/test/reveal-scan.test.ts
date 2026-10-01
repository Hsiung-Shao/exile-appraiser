// exile-appraiser(2026-10-01):褻瀆(靈魂之井揭露面板)自動持續辨識 = PanelScan + 褻瀆偵測器。
// 真實截圖的 OCR 快照(poe2/test/desecration/fixtures/ocr/*.ocr.json)當成「遊戲畫面」:假擷取依 rect 回傳落在範圍內的行,
// 假時鐘推進排程。不啟動 Electron、不跑 OCR、不送任何按鍵。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RevealScanEvent } from '@ipc/types'
import { buildLocateIndex, type LocateIndex, type LocateTiersLike } from '../../poe2/src/desecration/ocr-locate'
import { FALLBACK_RECHECK_MS, LOCATE_INTERVAL_MS, SharedLocateOcr, scanBlock, type Fingerprint, type ScanCapture, type ScanClock, type ScanConfig, type ScanEnv } from '../src/ocr/panel-scan'
import { REVEAL_MIN_HITS, RevealScan, createRevealDetector, modGroupCount } from '../src/ocr/reveal-scan'
import { RuneshapeScan } from '../src/ocr/runeshape-scan'

const ROOT = path.resolve(__dirname, '../..')
const index: LocateIndex = buildLocateIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe2/desecration/tiers.json'), 'utf8')) as LocateTiersLike)

type Line = { text: string, x: number, y: number, w: number, h: number }
/** 快照(×3 座標)→ client 座標 */
function snapshot (name: string): { w: number, h: number, lines: Line[] } {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'poe2/test/desecration/fixtures/ocr', `${name}.ocr.json`), 'utf8')) as {
    srcW: number, srcH: number, scale: number, lines: Line[]
  }
  return {
    w: s.srcW,
    h: s.srcH,
    lines: s.lines.map(l => ({ text: l.text, x: l.x / s.scale, y: l.y / s.scale, w: l.w / s.scale, h: l.h / s.scale }))
  }
}
const FULL02 = snapshot('well-of-souls-fullscreen-02')
const FULL03 = snapshot('well-of-souls-fullscreen-03')
const CROP01 = snapshot('well-of-souls-body-armour-01')
const MODS02 = ['增加71%護甲值和閃避', '+60護甲值', '+59閃避值', '+16最大生命']
const norm = (s: string) => s.replace(/\s+/g, '')
const inside = (l: Line, r: { x: number, y: number, width: number, height: number }) =>
  l.x >= r.x && l.y >= r.y && l.x + l.w <= r.x + r.width && l.y + l.h <= r.y + r.height

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
  }
  return { clock, advance, set: (v: number) => { t = v } }
}

/** 畫面 = 某張快照;`version` 改了 = 那一塊的縮圖變了(每版差 40 = 大幅變化);`noise` = 小幅變化(遊戲畫面在動,平均差 < 6) */
function harness (screen: { w: number, h: number, lines: Line[] }, over: Partial<ScanConfig> = {}, idx: LocateIndex | null = index, load?: () => Promise<LocateIndex | null>) {
  const clk = fakeClock()
  const cfg: ScanConfig = { enabled: true, game: 'poe2', region: null, intervalMs: 1000, ...over }
  const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: screen.w, height: screen.h } }
  const state = { screen, version: 0, noise: 0, busy: false, ocrs: [] as Array<{ rect: { x: number, y: number, width: number, height: number }, scale: number }> }
  const events: RevealScanEvent[] = []
  const logs: string[] = []
  const scan = new RevealScan({
    clock: clk.clock,
    config: () => cfg,
    env: () => env,
    ocrBusy: () => state.busy,
    locateIndex: load ?? (async () => idx),
    capture: async (): Promise<ScanCapture> => ({
      size: { w: state.screen.w, h: state.screen.h },
      offset: { x: 0, y: 0 },
      client: { w: state.screen.w, h: state.screen.h },
      fingerprint: (): Fingerprint => ({ w: 64, h: 40, data: new Uint8Array(64 * 40).fill(state.version * 40 + state.noise) }),
      recognize: async (rect, scale) => {
        state.ocrs.push({ rect, scale })
        return { lines: state.screen.lines.filter(l => inside(l, rect)).map(l => ({ ...l })), ms: 30 }
      }
    }),
    send: (e) => { events.push(e) },
    log: (m) => { logs.push(m) }
  })
  return { scan, cfg, env, state, events, logs, clk }
}

describe('褻瀆偵測器(真實截圖快照)', () => {
  const det = createRevealDetector(async () => index)
  it('資料就緒;讀不到模板索引 → 不就緒', async () => {
    expect(await det.ready!()).toBe(true)
    expect(await createRevealDetector(async () => null).ready!()).toBe(false)
    expect(await createRevealDetector(async () => { throw new Error('x') }).ready!()).toBe(false)
  })
  it('fullscreen-02:整張 ×1 定位 → 裁切框包住 4 行詞綴、不含右側背包', async () => {
    await det.ready!()
    const loc = det.locate(FULL02.lines, { x: 0, y: 0, w: FULL02.w, h: FULL02.h })!
    expect(loc).not.toBeNull()
    expect(loc.count).toBeGreaterThanOrEqual(REVEAL_MIN_HITS)
    const crop = { x: loc.crop.x, y: loc.crop.y, width: loc.crop.w, height: loc.crop.h }
    const texts = FULL02.lines.filter(l => inside(l, crop)).map(l => norm(l.text))
    for (const m of MODS02) expect(texts).toContain(m)
    expect(loc.crop.x + loc.crop.w).toBeLessThan(1300)
  })
  it('classify:面板 ≥ 2 行像詞綴才算;送出的是全部行(給 renderer 補中間沒認出的組)', async () => {
    await det.ready!()
    for (const s of [FULL02, FULL03, CROP01]) {
      const c = det.classify(s.lines)
      expect(c.found).toBe(true)
      expect(c.hits).toBeGreaterThanOrEqual(REVEAL_MIN_HITS)
      expect(c.rows).toHaveLength(s.lines.length)
    }
    // 只有 1 行像詞綴(例如別的 UI)→ 不算面板、不送
    const one = FULL02.lines.filter(l => norm(l.text) === '+16最大生命')
    expect(det.classify(one)).toEqual({ found: false, hits: 1, rows: [] })
    expect(det.classify([{ text: '深 井', x: 0, y: 0, w: 10, h: 10 }]).found).toBe(false)
  })
  it('連續的詞綴行(同一個選項 / 物品浮窗)不算面板:要分成 ≥ 2 組(選項之間有空隙)', async () => {
    await det.ready!()
    // fullscreen-02 的第二個選項本身就是連續兩行 → 單獨拿出來 = 像物品浮窗
    const tooltip = FULL02.lines.filter(l => ['+60護甲值', '+59閃避值'].includes(norm(l.text)))
    expect(tooltip).toHaveLength(2)
    expect(modGroupCount(tooltip)).toBe(1)
    expect(det.classify(tooltip)).toEqual({ found: false, hits: 2, rows: [] })
    // 三個選項 = 3 組
    const mods = FULL02.lines.filter(l => MODS02.includes(norm(l.text)))
    expect(modGroupCount(mods)).toBe(3)
  })
  it('設定:查價面板開著不暫停(褻瀆常與查價同時看);設定 / 框選層開著暫停', () => {
    expect(det.pauseOnPricePanel).toBe(false)
    expect(det.regionFallback).toBe(true)
    const cfg: ScanConfig = { enabled: true, game: 'poe2', region: null, intervalMs: 1000 }
    const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: 10, height: 10 } }
    const ui = { panel: false, settings: false, picker: false }
    expect(scanBlock(cfg, env, { ...ui, panel: true }, false, false)).toBeNull()
    expect(scanBlock(cfg, env, { ...ui, settings: true }, false, false)).toBe('ui-open')
    expect(scanBlock(cfg, env, { ...ui, picker: true }, false, false)).toBe('ui-open')
    // 符文塑形(預設參數)查價面板開著照舊暫停
    expect(scanBlock(cfg, env, { ...ui, panel: true }, false)).toBe('ui-open')
  })
})

describe('RevealScan 自動持續辨識(假時鐘 + 快照畫面)', () => {
  it('沒框區域:第一次整張 ×1 定位 → 定位框 ×3 → 送出列;畫面沒變不再 OCR;面板關了 2 次後送 empty', async () => {
    const h = harness(FULL02)
    h.scan.start()
    await h.clk.advance(0)
    expect(h.state.ocrs.map(o => o.scale)).toEqual([1, 3])
    expect(h.state.ocrs[0].rect).toEqual({ x: 0, y: 0, width: FULL02.w, height: FULL02.h })
    expect(h.events).toHaveLength(1)
    const ev = h.events[0]
    expect(ev.reason).toBe('rows')
    expect(ev.fallback).toBeUndefined()
    expect(ev.client).toEqual({ w: FULL02.w, h: FULL02.h })
    const texts = ev.rows.map(r => norm(r.text))
    for (const m of MODS02) expect(texts).toContain(m)
    // 下一個 tick:畫面沒變 → 不 OCR、不送事件(徽章持續顯示,沒有逾時)
    await h.clk.advance(1000)
    expect(h.state.ocrs).toHaveLength(2)
    expect(h.events).toHaveLength(1)
    await h.clk.advance(60_000)
    expect(h.events).toHaveLength(1)
    // 面板關了(畫面換成沒有詞綴的行、縮圖變了)→ 第 1 次不送,第 2 次送 empty
    h.state.screen = { ...FULL02, lines: [{ text: '深 井', x: 500, y: 500, w: 20, h: 10 }] }
    h.state.version = 1
    await h.clk.advance(1000)
    expect(h.events).toHaveLength(1)
    await h.clk.advance(1000)
    expect(h.events.map(e => e.reason)).toEqual(['rows', 'empty'])
    h.scan.stop()
  })

  it('面板又打開:徽章跟著新結果更新(fullscreen-02 → fullscreen-03)', async () => {
    const h = harness(FULL02)
    await h.scan.tick()
    expect(h.events).toHaveLength(1)
    h.state.screen = FULL03
    h.state.version = 2
    await h.scan.tick()
    // 同一個快取區看到新面板(03 的面板位置不同時,快取區可能對不上 → 會回到整張定位)
    let guard = 0
    while (h.events.length < 2 && guard++ < 12) {
      h.clk.set(h.clk.clock.now() + LOCATE_INTERVAL_MS)
      await h.scan.tick()
    }
    const last = h.events[h.events.length - 1]
    expect(last.reason).toBe('rows')
    expect(last.rows.map(r => norm(r.text))).toContain('+11點力量與敏捷')
  })

  it('查價面板開著照常辨識;設定開著暫停(不清徽章)', async () => {
    const h = harness(FULL02)
    h.scan.setUiState({ panel: true, settings: false, picker: false })
    expect((await h.scan.tick()).kind).toBe('ocr')
    expect(h.events).toHaveLength(1)
    h.scan.setUiState({ panel: true, settings: true, picker: false })
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'ui-open' })
    expect(h.events).toHaveLength(1) // 暫停不送清除
  })

  it('讀不到模板索引 → no-data 停止(清掉畫面上的徽章)', async () => {
    const h = harness(FULL02, {}, null)
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'no-data' })
    expect(h.state.ocrs).toHaveLength(0)
    expect(h.scan.snapshot().reason).toBe('stopped') // 沒 start
  })

  it('與符文塑形共用 WinOcr:對方忙碌 → 丟掉這個 tick', async () => {
    const h = harness(FULL02)
    h.state.busy = true
    expect(await h.scan.tick()).toEqual({ kind: 'busy' })
    expect(h.state.ocrs).toHaveLength(0)
    h.state.busy = false
    expect((await h.scan.tick()).kind).toBe('ocr')
  })

  it('暫停熱鍵:送 user-paused 清徽章;繼續後重新辨識', async () => {
    const h = harness(FULL02)
    await h.scan.tick()
    expect(h.scan.toggleUserPause()).toBe(true)
    expect(h.events.map(e => e.reason)).toEqual(['rows', 'user-paused'])
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'user-paused' })
    expect(h.scan.snapshot().reason).toBe('stopped')
    h.scan.toggleUserPause()
    expect((await h.scan.tick()).kind).toBe('ocr')
    expect(h.events.map(e => e.reason)).toEqual(['rows', 'user-paused', 'user-resumed', 'rows'])
  })

  it('有框區域:區域內有面板 → 只看區域 ×3(不整張定位)', async () => {
    // fullscreen-02 面板大約在 x 405–904、y 489–791
    const h = harness(FULL02, { region: { x: 0.15, y: 0.4, w: 0.35, h: 0.35 } })
    const r = await h.scan.tick()
    expect(r.kind).toBe('ocr')
    expect(h.state.ocrs.map(o => o.scale)).toEqual([3])
    expect(h.events[0].reason).toBe('rows')
    expect(h.events[0].fallback).toBeUndefined()
  })

  it('區域內沒找到面板 → 連續 2 次後退回自動定位(事件帶 fallback);區域畫面變了才回到區域', async () => {
    const h = harness(FULL02, { region: { x: 0.8, y: 0.8, w: 0.2, h: 0.2 } })
    const r1 = await h.scan.tick()
    expect(r1).toMatchObject({ kind: 'ocr', mode: 'manual', rows: 0, sent: null })
    const r2 = await h.scan.tick()
    expect(r2).toMatchObject({ kind: 'ocr', mode: 'manual', rows: 0, sent: 'empty' })
    expect(h.scan.fallingBack).toBe(true)
    expect(h.scan.snapshot()).toMatchObject({ mode: 'manual', fallback: true })
    // 退回:整張 ×1 定位 → 定位框 ×3 → 送出列,帶 fallback
    const r3 = await h.scan.tick()
    expect(r3).toMatchObject({ kind: 'ocr', mode: 'auto', sent: 'rows' })
    const ev = h.events[h.events.length - 1]
    expect(ev.reason).toBe('rows')
    expect(ev.fallback).toBe(true)
    // 區域畫面沒變 → 維持退回;畫面沒變 → 不 OCR
    const n = h.state.ocrs.length
    expect(await h.scan.tick()).toMatchObject({ kind: 'unchanged', mode: 'auto' })
    expect(h.state.ocrs).toHaveLength(n)
    // 區域畫面變了 → 回到手動區域
    h.state.version = 3
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', mode: 'manual' })
    expect(h.scan.fallingBack).toBe(false)
  })

  it('rescan():丟掉差分基準,下一個 tick 一定重新 OCR(框選確認後)', async () => {
    const h = harness(FULL02)
    await h.scan.tick()
    expect(await h.scan.tick()).toMatchObject({ kind: 'unchanged' })
    h.scan.rescan()
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', sent: 'rows' })
  })

  it('停用 / 不是 PoE2 → 停止並清掉徽章', async () => {
    const h = harness(FULL02)
    await h.scan.tick()
    h.cfg.enabled = false
    expect(await h.scan.tick()).toEqual({ kind: 'blocked', block: 'disabled' })
    expect(h.events.map(e => e.reason)).toEqual(['rows', 'inactive'])
  })
})

describe('排程(效能修正第 6 步)', () => {
  const REGION = { x: 0.8, y: 0.8, w: 0.2, h: 0.2 }

  it('退回自動定位中:區域畫面只是小幅在動 → 不回區域,自動定位跑得到(原本一動就回區域、永遠輪不到定位)', async () => {
    const h = harness(FULL02, { region: REGION })
    await h.scan.tick()
    await h.scan.tick()
    expect(h.scan.fallingBack).toBe(true)
    h.state.noise = 3
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', mode: 'auto', sent: 'rows' })
    expect(h.events[h.events.length - 1].fallback).toBe(true)
    expect(h.scan.fallingBack).toBe(true)
    // 已找到面板:區域小幅變化仍不回(結果相同 → 不重送)
    h.state.noise = 5
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', mode: 'auto', deduped: true })
    expect(h.scan.fallingBack).toBe(true)
    // 大幅變化 → 立刻回到區域
    h.state.version = 3
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', mode: 'manual' })
    expect(h.scan.fallingBack).toBe(false)
  })

  it(`退回中一直沒找到面板 → 距上次區域 OCR ≥ ${FALLBACK_RECHECK_MS / 1000} 秒,下一次擷取時回區域再看`, async () => {
    const h = harness({ ...FULL02, lines: [{ text: '深 井', x: 1700, y: 1000, w: 20, h: 10 }] }, { region: REGION })
    await h.scan.tick()
    await h.scan.tick() // t = 0
    expect(h.scan.fallingBack).toBe(true)
    h.state.noise = 3
    await h.clk.advance(1000)
    expect(await h.scan.tick()).toMatchObject({ kind: 'locate-miss' }) // 區域小變化不回;整張定位沒找到
    await h.clk.advance(1000)
    expect(await h.scan.tick()).toEqual({ kind: 'locate-wait' }) // 沒快取:距上次定位 < 3 秒不擷取(與原本相同)
    await h.clk.advance(2000)
    expect(await h.scan.tick()).toMatchObject({ kind: 'ocr', mode: 'manual' })
    expect(h.scan.fallingBack).toBe(false)
  })

  it('褻瀆與符文同時沒框區域:整個 client ×1 定位 OCR 共用一次;符文用共用結果與自己 OCR 的結果相同', async () => {
    const clk = fakeClock()
    const shared = new SharedLocateOcr()
    const ocrs: Array<{ full: boolean, scale: number }> = []
    let v = 0
    const cfg: ScanConfig = { enabled: true, game: 'poe2', region: null, intervalMs: 1000 }
    const env: ScanEnv = { overlay: true, gameActive: true, bounds: { x: 0, y: 0, width: FULL02.w, height: FULL02.h } }
    const capture = async (): Promise<ScanCapture> => ({
      size: { w: FULL02.w, h: FULL02.h },
      offset: { x: 0, y: 0 },
      client: { w: FULL02.w, h: FULL02.h },
      fingerprint: (): Fingerprint => ({ w: 64, h: 40, data: new Uint8Array(64 * 40).fill(v) }),
      recognize: async (rect, scale) => {
        ocrs.push({ full: rect.width === FULL02.w && rect.height === FULL02.h, scale })
        return { lines: FULL02.lines.filter(l => inside(l, rect)).map(l => ({ ...l })), ms: 30 }
      }
    })
    const common = { clock: clk.clock, config: () => cfg, env: () => env, ocrBusy: () => false, capture, log: () => {} }
    const reveal = new RevealScan({ ...common, locateOcr: shared, locateIndex: async () => index, send: () => {} })
    const rune = new RuneshapeScan({ ...common, locateOcr: shared, send: () => {} })
    const solo = new RuneshapeScan({ ...common, send: () => {} })
    const fullOcrs = () => ocrs.filter(o => o.full && o.scale === 1).length
    expect(await reveal.tick()).toMatchObject({ kind: 'ocr', mode: 'auto', sent: 'rows' })
    clk.set(500) // 符文錯開半個間隔
    const r = await rune.tick()
    expect(fullOcrs()).toBe(1)
    expect([shared.runs, shared.reuses]).toEqual([1, 1])
    expect(rune.sched.locateShared).toBe(1)
    // 對照:不共用、自己 OCR 的符文掃描 → 結果完全相同
    const s = await solo.tick()
    expect(fullOcrs()).toBe(2)
    expect(r).toEqual(s)
    const pick = (x: ReturnType<RuneshapeScan['snapshot']>) => ({ locates: x.locates, locateMisses: x.locateMisses, panel: x.panel, autoRegion: x.autoRegion })
    expect(pick(rune.snapshot())).toEqual(pick(solo.snapshot()))
    // 超過 1 秒 → 各自重新 OCR
    clk.set(4000)
    v = 3
    expect((await rune.tick()).kind).toBe(r.kind)
    expect(fullOcrs()).toBe(3)
    expect(shared.runs).toBe(2)
  })

  it('tick 不重入:第一次讀 tiers.json 期間 poke() / 直接呼叫都不會再開一個 tick', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let loads = 0
    const h = harness(FULL02, {}, index, async () => { loads++; await gate; return index })
    h.scan.start()
    await h.clk.advance(0)
    expect(h.scan.tickInProgress).toBe(true)
    expect(h.scan.busy).toBe(false) // 還沒擷取:不擋另一個掃描用 WinOcr
    h.scan.poke()
    await h.clk.advance(0)
    expect(await h.scan.tick()).toEqual({ kind: 'overlap' })
    expect(loads).toBe(1)
    release()
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(h.scan.tickInProgress).toBe(false)
    expect(h.state.ocrs.map(o => o.scale)).toEqual([1, 3])
    expect(h.events).toHaveLength(1)
    h.scan.stop()
  })
})
