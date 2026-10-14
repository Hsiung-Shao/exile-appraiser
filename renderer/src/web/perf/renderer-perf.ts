/**
 * B8(2026-10-14):renderer 端的效能指標,隨 main 的效能診斷(第 29 步,`main/src/perf/perf-monitor.ts`)一起開關。
 *
 * 開著時(main 回 `perf-get` enabled 或廣播 `perf-state` enabled)每個取樣間隔送一次 IPC `perf-renderer`:
 * - longtask(`PerformanceObserver('longtask')`)次數 / 總時間 / 最長;
 * - rAF 幀間隔 p95 / 最長 —— 只在視窗顯示且 overlay 上有東西(window 模式 = 視窗顯示)時跑 rAF;沒內容就停,取樣時再看要不要重新開始;
 * - 查價延遲:收到物品文字 → 第一個交易站請求送出(≈ 解析完成;App.vue 解析後才發查詢)→ 第一筆交易站結果(`/fetch/` 或 `/exchange/` 回應);
 * - 背景圖預先處理:來源圖載入、每次重畫的繪製 / 編碼 / 解碼耗時、快取換上(adopt)次數(BgLayerImage.vue 經 `perfHooks.bg`)。
 *
 * **關著零成本**:不建 observer、不排 rAF / 計時器、不訂閱物品文字;`perfHooks.trade` / `perfHooks.bg` 是 null(呼叫端只做一個 `?.`)。
 * 預覽端(`Host.canPerf` false)整個不啟動。DOM / 計時器都由呼叫端注入(測試 `renderer/test/perf-renderer.test.ts`)。
 */
import type { PerfRendererReport, PerfState, PerfStateEvent } from '@ipc/types'

export type BgPerfEvent =
  | { kind: 'load', ms: number }
  | { kind: 'redraw', drawMs: number, encodeMs: number, decodeMs: number }
  | { kind: 'adopt' }

/** 有收集器在跑時才不是 null;呼叫端一律 `perfHooks.x?.(…)` */
export const perfHooks: {
  trade: ((phase: 'request' | 'response', url: string) => void) | null
  bg: ((e: BgPerfEvent) => void) | null
} = { trade: null, bg: null }

interface ObserverLike { observe: (o: { type: string, buffered?: boolean }) => void, disconnect: () => void }
type ObserverCtor = (new (cb: (list: { getEntries: () => Array<{ duration: number }> }) => void) => ObserverLike) & { supportedEntryTypes?: readonly string[] }

export interface PerfEnv {
  /** 沒有 / 不支援 longtask → 不量 longtask */
  PerformanceObserver?: ObserverCtor
  raf: (cb: (ts: number) => void) => number
  caf: (h: number) => void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (h: unknown) => void
  now: () => number
  /** 現在要不要量幀間隔(視窗顯示且 overlay 上有東西) */
  framesWanted: () => boolean
  onItemText: (cb: () => void) => () => void
  send: (r: PerfRendererReport) => void
}

/** 一次查價等多久還沒有第一筆結果就放棄(避免查價失敗時下一次查價的請求被算到上一次) */
export const QUERY_TIMEOUT_MS = 60_000
/** 每段時間最多記幾個幀間隔(5 秒 × 60 fps ≈ 300) */
const FRAME_CAP = 2000

const r1 = (n: number) => Math.round(n * 10) / 10
const TRADE_RE = /\/api\/trade2?\/(search|exchange|fetch)\//
const RESULT_RE = /\/api\/trade2?\/(exchange|fetch)\//

function p95Of (v: number[]): number {
  if (v.length === 0) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]
}

const emptyBg = (): PerfRendererReport['bg'] => ({ redraws: 0, adopts: 0, loads: 0, loadMs: [], drawMs: [], encodeMs: [], decodeMs: [] })

export class RendererPerfCollector {
  private on = false
  private observer: ObserverLike | null = null
  private interval: unknown = null
  private rafId: number | null = null
  private lastFrame: number | null = null
  private unsubItem: (() => void) | null = null
  private windowStart = 0
  private lt = { n: 0, totalMs: 0, maxMs: 0 }
  private frames: number[] = []
  private query: PerfRendererReport['query'] = { parseMs: [], firstMs: [] }
  private bg = emptyBg()
  /** 目前這次查價:收到物品文字的時間、是否已記解析 / 第一筆結果 */
  private pending: { t0: number, parsed: boolean } | null = null

  constructor (private readonly env: PerfEnv) {}

  get running (): boolean { return this.on }

  start (sampleMs: number): void {
    if (this.on) return
    this.on = true
    this.resetWindow()
    const PO = this.env.PerformanceObserver
    if (PO && (PO.supportedEntryTypes == null || PO.supportedEntryTypes.includes('longtask'))) {
      try {
        const o = new PO((list) => {
          for (const e of list.getEntries()) {
            this.lt.n++
            this.lt.totalMs += e.duration
            if (e.duration > this.lt.maxMs) this.lt.maxMs = e.duration
          }
        })
        o.observe({ type: 'longtask' })
        this.observer = o
      } catch { this.observer = null }
    }
    this.unsubItem = this.env.onItemText(() => { this.pending = { t0: this.env.now(), parsed: false } })
    perfHooks.trade = (phase, url) => { this.onTrade(phase, url) }
    perfHooks.bg = (e) => { this.onBg(e) }
    this.interval = this.env.setInterval(() => { this.flush() }, Math.max(1000, sampleMs))
    this.maybeStartFrames()
  }

  stop (): void {
    if (!this.on) return
    this.on = false
    this.observer?.disconnect()
    this.observer = null
    if (this.interval != null) this.env.clearInterval(this.interval)
    this.interval = null
    if (this.rafId != null) this.env.caf(this.rafId)
    this.rafId = null
    this.lastFrame = null
    this.unsubItem?.()
    this.unsubItem = null
    perfHooks.trade = null
    perfHooks.bg = null
    this.pending = null
  }

  /** 送出這段時間的指標並歸零(計時器呼叫;測試直接呼叫) */
  flush (): void {
    if (!this.on) return
    const now = this.env.now()
    const r: PerfRendererReport = {
      windowMs: Math.max(0, now - this.windowStart),
      longTask: { n: this.lt.n, totalMs: r1(this.lt.totalMs), maxMs: r1(this.lt.maxMs) },
      frames: { n: this.frames.length, p95: r1(p95Of(this.frames)), max: r1(this.frames.length ? Math.max(...this.frames) : 0) },
      query: this.query,
      bg: this.bg
    }
    this.resetWindow()
    try { this.env.send(r) } catch { /* main 不在(關閉中)就算了 */ }
    this.maybeStartFrames()
  }

  private resetWindow (): void {
    this.windowStart = this.env.now()
    this.lt = { n: 0, totalMs: 0, maxMs: 0 }
    this.frames = []
    this.query = { parseMs: [], firstMs: [] }
    this.bg = emptyBg()
  }

  private maybeStartFrames (): void {
    if (!this.on || this.rafId != null || !this.env.framesWanted()) return
    this.lastFrame = null
    this.rafId = this.env.raf(this.onFrame)
  }

  private readonly onFrame = (ts: number): void => {
    this.rafId = null
    if (!this.on) return
    if (!this.env.framesWanted()) { this.lastFrame = null; return }
    if (this.lastFrame != null && this.frames.length < FRAME_CAP) this.frames.push(ts - this.lastFrame)
    this.lastFrame = ts
    this.rafId = this.env.raf(this.onFrame)
  }

  private onTrade (phase: 'request' | 'response', url: string): void {
    const p = this.pending
    if (!p || !TRADE_RE.test(url)) return
    const dt = this.env.now() - p.t0
    if (dt > QUERY_TIMEOUT_MS) { this.pending = null; return }
    if (phase === 'request' && !p.parsed) {
      p.parsed = true
      this.query.parseMs.push(r1(dt))
    } else if (phase === 'response' && RESULT_RE.test(url)) {
      this.query.firstMs.push(r1(dt))
      this.pending = null // 同一次查價只記第一筆結果
    }
  }

  private onBg (e: BgPerfEvent): void {
    if (e.kind === 'load') { this.bg.loads++; this.bg.loadMs.push(r1(e.ms)) } else if (e.kind === 'adopt') { this.bg.adopts++ } else {
      this.bg.redraws++
      this.bg.drawMs.push(r1(e.drawMs))
      this.bg.encodeMs.push(r1(e.encodeMs))
      this.bg.decodeMs.push(r1(e.decodeMs))
    }
  }
}

export interface PerfHostLike {
  canPerf: boolean
  perfGet: () => Promise<PerfState | null>
  onPerfState: (cb: (e: PerfStateEvent) => void) => () => void
}

/**
 * renderer 啟動時呼叫一次:問 main 現在開著沒有(`perf-get`),之後跟著 `perf-state` 開關。
 * 預覽端 / 純瀏覽器(`canPerf` false)→ null,什麼都不做。
 */
export function initRendererPerf (host: PerfHostLike, env: PerfEnv): RendererPerfCollector | null {
  if (!host.canPerf) return null
  const c = new RendererPerfCollector(env)
  const apply = (on: boolean, sampleMs: number) => { if (on) c.start(sampleMs); else c.stop() }
  host.onPerfState((e) => { apply(e?.enabled === true, e?.sampleMs ?? 5000) })
  void host.perfGet().then((s) => { if (s) apply(s.enabled, s.sampleMs) }).catch(() => {})
  return c
}
