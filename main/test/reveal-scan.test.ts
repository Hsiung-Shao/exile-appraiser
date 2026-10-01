// exile-appraiser(2026-10-01):褻瀆(靈魂之井揭露面板)自動持續辨識 = PanelScan + 褻瀆偵測器。
// 真實截圖的 OCR 快照(poe2/test/desecration/fixtures/ocr/*.ocr.json)當成「遊戲畫面」:假擷取依 rect 回傳落在範圍內的行,
// 假時鐘推進排程。不啟動 Electron、不跑 OCR、不送任何按鍵。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RevealScanEvent } from '@ipc/types'
import { buildLocateIndex, type LocateIndex, type LocateTiersLike } from '../../poe2/src/desecration/ocr-locate'
import { LOCATE_INTERVAL_MS, SharedLocateOcr, scanBlock, type Fingerprint, type ScanCapture, type ScanClock, type ScanConfig, type ScanEnv } from '../src/ocr/panel-scan'
import { REVEAL_MIN_HITS, RevealScan, createRevealDetector, modGroupCount } from '../src/ocr/reveal-scan'
import { RuneshapeScan } from '../src/ocr/runeshape-scan'

const ROOT = path.resolve(__dirname, '../..')
const index: LocateIndex = buildLocateIndex(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe2/desecration/tiers.json'), 'utf8')) as LocateTiersLike)

type Line = { text: string, x: number, y: number, w: number, h: number }
/** 一張「遊戲畫面」:`lines` = ×3 的行;`lines1` = 有的話 ×1(自動定位)改回傳它(負樣本快照有整張 ×1) */
type Screen = { w: number, h: number, lines: Line[], lines1?: Line[] }
/** 快照(×3 座標)→ client 座標 */
function snapshot (name: string): Screen {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'poe2/test/desecration/fixtures/ocr', `${name}.ocr.json`), 'utf8')) as {
    srcW: number, srcH: number, scale: number, lines: Line[], locate?: { scale: number, lines: Line[] }
  }
  const conv = (ls: Line[], k: number) => ls.map(l => ({ text: l.text, x: l.x / k, y: l.y / k, w: l.w / k, h: l.h / k }))
  const out: Screen = { w: s.srcW, h: s.srcH, lines: conv(s.lines, s.scale) }
  if (s.locate) out.lines1 = conv(s.locate.lines, s.locate.scale)
  return out
}
const FULL02 = snapshot('well-of-souls-fullscreen-02')
/** 負樣本:使用者回報的全螢幕截圖(沒開揭露面板、背包手套的進階詞綴說明開著;快照有整張 ×3 與 ×1) */
const TOOLTIP = snapshot('tooltip-gloves-advanced-01')
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
function harness (screen: Screen, over: Partial<ScanConfig> = {}, idx: LocateIndex | null = index, load?: () => Promise<LocateIndex | null>) {
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
        const src = scale === 1 && state.screen.lines1 ? state.screen.lines1 : state.screen.lines
        return { lines: src.filter(l => inside(l, rect)).map(l => ({ ...l })), ms: 30 }
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
    // 第 13 步起沒有「區域內沒找到 → 退回整個畫面」的選項(褻瀆與符文都只看區域)
    expect('regionFallback' in det).toBe(false)
    expect(det.activity).toBe('辨識')
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
    expect('fallback' in ev).toBe(false)
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
    expect(h.scan.snapshot()).toMatchObject({ mode: 'manual', panel: 'found' })
  })

  it('第 13 步:區域內沒找到面板 → 連續 2 次後送 empty,之後**不**改找整個畫面(與符文塑形相同;面板在區域外也不出徽章)', async () => {
    const h = harness(FULL02, { region: { x: 0.8, y: 0.8, w: 0.2, h: 0.2 } })
    const r1 = await h.scan.tick()
    expect(r1).toMatchObject({ kind: 'ocr', mode: 'manual', rows: 0, sent: null })
    const r2 = await h.scan.tick()
    expect(r2).toMatchObject({ kind: 'ocr', mode: 'manual', rows: 0, sent: 'empty' })
    expect(h.scan.snapshot()).toMatchObject({ mode: 'manual', panel: 'not-found' })
    expect('fallback' in h.scan.snapshot()).toBe(false)
    // 之後一直只看區域:沒有整張 ×1 定位、沒有送列;區域畫面大幅變化也只是再 OCR 區域
    h.state.version = 3
    for (let i = 0; i < 6; i++) {
      h.clk.set(h.clk.clock.now() + LOCATE_INTERVAL_MS)
      const r = await h.scan.tick()
      expect(r.kind === 'ocr' || r.kind === 'unchanged' || r.kind === 'backoff').toBe(true)
      if ('mode' in r) expect(r.mode).toBe('manual')
    }
    expect(h.state.ocrs.every(o => o.scale === 3 && o.rect.width < FULL02.w)).toBe(true)
    expect(h.events.map(e => e.reason)).toEqual(['empty'])
    expect(h.scan.snapshot().autoRegion).toBeUndefined()
  })

  it('使用者回報的情境:框了區域(左 19%、上 44%、寬 28%、高 25%)、面板沒開、背包手套的進階說明開著 → 只看區域,不出徽章', async () => {
    const h = harness(TOOLTIP, { region: { x: 0.19, y: 0.44, w: 0.28, h: 0.25 } })
    for (let i = 0; i < 6; i++) {
      h.clk.set(h.clk.clock.now() + LOCATE_INTERVAL_MS)
      h.state.version = i // 每次都大幅變化 → 每次都 OCR 區域
      await h.scan.tick()
    }
    expect(h.state.ocrs.every(o => o.scale === 3 && o.rect.x >= Math.floor(0.19 * TOOLTIP.w) - 1)).toBe(true)
    expect(h.events.filter(e => e.reason === 'rows')).toEqual([])
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

  it('區域內沒有面板、畫面小幅在動:手動區域照符文的退避(× 2 遞增),從不整張定位', async () => {
    const h = harness(FULL02, { region: REGION, intervalMs: 500 })
    h.scan.start()
    await h.clk.advance(0)
    for (let i = 1; i <= 40; i++) {
      h.state.noise = i % 2 ? 3 : 0 // 小幅變化(平均差 < 6)
      await h.clk.advance(500)
    }
    h.scan.stop()
    expect(h.state.ocrs.some(o => o.scale === 1)).toBe(false)
    expect(h.events.map(e => e.reason)).toEqual(['empty'])
    // 20 秒內最多每 2.5 秒一次(加前兩次),遠少於 40 次
    expect(h.state.ocrs.length).toBeLessThanOrEqual(2 + Math.ceil(20_000 / 2500) + 1)
    expect(h.scan.sched.idleBackoffSkips).toBeGreaterThan(0)
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

describe('第 13 步:物品浮窗不是揭露面板(負樣本)', () => {
  const det = createRevealDetector(async () => index)
  /** 合成:稀有裝備 5 條詞綴、彼此有空隙(進階說明拿掉標頭後的樣子)—— 舊判定「≥ 2 行像詞綴且 ≥ 2 組」會過 */
  const H = 20
  const RARE5 = ['增 加 40 % 投 射 物 速 度', '攻 擊 附 加 15 至 20 物 理 傷 害', '全 部 投 射 物 技 能 等 級 + 2', '+ 38 % 火 焰 抗 性', '增 加 26 % 暴 擊 傷 害 加 成']
    .map((text, i) => ({ text, x: 1325 - text.length * 5, y: 460 + i * 2.4 * H, w: text.length * 10, h: H }))
  const RARE_SCREEN: Screen = { w: 1920, h: 1080, lines: RARE5 }

  it('classify:真實浮窗(×3 與 ×1)與合成的 5 組稀有裝備都不是面板、不送列,並帶否決原因(log 用)', async () => {
    await det.ready!()
    for (const lines of [TOOLTIP.lines, TOOLTIP.lines1!, RARE5]) {
      const c = det.classify(lines)
      expect(c.found).toBe(false)
      expect(c.rows).toEqual([])
      expect(c.veto).toMatch(/^(group-too-tall|keyword-line|too-many-groups)\(/)
    }
    expect(modGroupCount(RARE5)).toBe(5) // 舊判定只看「≥ 2 組」會當成面板
  })

  it('locate:整張 ×1 / ×3 都不回傳浮窗的裁切框', async () => {
    await det.ready!()
    const bounds = { x: 0, y: 0, w: TOOLTIP.w, h: TOOLTIP.h }
    expect(det.locate(TOOLTIP.lines1!, bounds)).toBeNull()
    expect(det.locate(TOOLTIP.lines, bounds)).toBeNull()
    expect(det.locate(RARE5, bounds)).toBeNull()
  })

  it('PanelScan 沒框區域(假時鐘 60 秒):整張定位一直沒找到 → 不送任何列,定位退避照常', async () => {
    for (const screen of [TOOLTIP, RARE_SCREEN]) {
      const h = harness(screen)
      h.scan.start()
      await h.clk.advance(0)
      for (let i = 0; i < 60; i++) {
        h.state.version = Math.floor(i / 10) // 每 10 秒畫面大幅變一次(滑鼠移過不同物品)
        await h.clk.advance(1000)
      }
      h.scan.stop()
      expect(h.events).toEqual([])
      expect(h.state.ocrs.every(o => o.scale === 1)).toBe(true) // 只有定位,從沒找到可以 ×3 的面板區
      expect(h.scan.snapshot()).toMatchObject({ mode: 'auto', panel: 'not-found' })
      expect(h.scan.snapshot().locateMisses).toBeGreaterThan(0)
    }
  })

  it('浮窗與揭露面板同框(合成:fullscreen-02 的面板 + 右側的 5 組稀有裝備浮窗)→ 面板照常找到,送出的列含面板詞綴', async () => {
    await det.ready!()
    const both = [...FULL02.lines, ...RARE5.map(l => ({ ...l, x: l.x + 300 }))]
    const c = det.classify(both)
    expect(c.found).toBe(true)
    const loc = det.locate(both, { x: 0, y: 0, w: FULL02.w, h: FULL02.h })!
    expect(loc).not.toBeNull()
    expect(loc.crop.x + loc.crop.w).toBeLessThan(1300) // 只框面板,不含浮窗
  })
})
