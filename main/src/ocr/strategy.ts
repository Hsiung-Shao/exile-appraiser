/**
 * exile-appraiser(WP-S 兩段式):決定這一次要 OCR 哪一塊、放大幾倍(不碰 Electron,main vitest 可測)。
 *
 * 三條路(docs/reveal-ocr.md「兩段式辨識」):
 * - `cached`:上次成功的面板區(依 client 大小 + 搜尋範圍為鍵,只存在記憶體)直接 ×3;`checkRegion` 過了就用。
 * - `two-pass`:第 1 段整個搜尋範圍 ×1 → `locatePanel` 找詞綴行並外擴 → 第 2 段只把那塊 ×3(≤ 3,受 MaxImageDimension 限制)。
 * - `full`:整個搜尋範圍 ×3(原本的做法)。第 1 段一行都不像詞綴、第 2 段沒框完整、或 main 讀不到 tiers 資料時走這條。
 *   full 的結果若定位得到面板,也把外擴區記進快取(下一次就快)。
 * 倍率只用 ×1 與 ×3:實測 ×1.5 / ×2 會錯字(「閃避」→「因」、「增」→日文「増」),×1 在 2000×1125 全對。
 *
 * WP-S2(`recognizeRegionFirst`):有使用者框選的 `ocrRegion` 時,先以區域為搜尋範圍跑上面三條路;
 * 區域內像詞綴的行 < 2(`checkRegion` 判準)→ 再以整個畫面跑一次(`region-fallback`)。
 */
import { checkRegion, locatePanel, type LocateIndex, type Rect } from '../../../poe2/src/desecration/ocr-locate'
import type { OcrTextLine } from '../../../poe2/src/desecration/ocr-text'
import type { OcrRegion } from '@ipc/types'

export interface PhysRect { x: number, y: number, width: number, height: number }

/** 放大倍率:1080p 得 3×、4K 得 2×(WinRT OcrEngine.MaxImageDimension = 10000,留餘裕用 9000) */
export function ocrScale (w: number, h: number): number {
  return Math.max(1, Math.min(3, Math.floor(9000 / Math.max(w, h, 1))))
}

/**
 * 擷取影像在 client 區裡的位置(`captureGameClient` 的 `client` / `offset`):遊戲視窗部分跑出螢幕時,
 * 影像只有螢幕內那塊,`offset` = 影像左上在 client 內的座標。省略 = 影像就是整個 client。
 */
export interface CaptureFrame {
  client: { w: number, h: number }
  offset: { x: number, y: number }
}

/**
 * exile-appraiser(WP-S2):比例範圍 → 影像像素矩形。比例以 **client 尺寸**換算、再減擷取偏移,最後夾進影像;
 * 視窗完全在螢幕內時(client = 影像、offset 0)與舊版「比例 × 影像大小」結果相同。
 * 沒有範圍、範圍無效、或換算後完全落在影像外 → null(= 整張)。
 */
export function regionSearchRect (img: { w: number, h: number }, region: OcrRegion | null | undefined, frame?: CaptureFrame): PhysRect | null {
  if (!region) return null
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
  const x = clamp(region.x)
  const y = clamp(region.y)
  const w = Math.min(1 - x, clamp(region.w))
  const h = Math.min(1 - y, clamp(region.h))
  if (w <= 0 || h <= 0) return null
  const client = frame?.client ?? img
  const off = frame?.offset ?? { x: 0, y: 0 }
  // client 像素 → 影像像素
  const x0 = Math.max(0, Math.round(x * client.w) - off.x)
  const y0 = Math.max(0, Math.round(y * client.h) - off.y)
  const x1 = Math.min(img.w, Math.round(x * client.w) + Math.max(1, Math.round(w * client.w)) - off.x)
  const y1 = Math.min(img.h, Math.round(y * client.h) + Math.max(1, Math.round(h * client.h)) - off.y)
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** 比例範圍 → 影像像素矩形(夾在影像內;null / 無效 / 落在影像外 = 整張) */
export function regionRect (img: { w: number, h: number }, region: OcrRegion | null | undefined, frame?: CaptureFrame): PhysRect {
  return regionSearchRect(img, region, frame) ?? { x: 0, y: 0, width: img.w, height: img.h }
}

export const toRect = (r: PhysRect): Rect => ({ x: r.x, y: r.y, w: r.width, h: r.height })
export const toPhys = (r: Rect): PhysRect => ({ x: r.x, y: r.y, width: r.w, height: r.h })

/** 對擷取影像的某塊以某倍率 OCR;回傳的行座標已換回**影像像素**(÷ scale + 裁切偏移) */
export type RecognizeRect = (rect: PhysRect, scale: number) => Promise<{ lines: OcrTextLine[], ms: number }>

export type OcrStage = 'cached' | 'two-pass' | 'full'

export interface StageTiming {
  /** cached = 快取區 ×3;locate = 第 1 段 ×1;detail = 第 2 段 ×3;full = 整張 ×3 */
  name: 'cached' | 'locate' | 'detail' | 'full'
  rect: PhysRect
  scale: number
  /** 前處理 + OCR + 傳輸(wall clock) */
  ms: number
  /** OCR 本身(行程內量測) */
  ocrMs: number
  lines: number
  /** 像詞綴的行數 */
  hits?: number
  /** 這段沒被採用的原因 */
  rejected?: string
  /** WP-S2:這段屬於哪一輪搜尋(`region` = 使用者框的區域;`screen` = 整個畫面)。沒設定區域時省略。 */
  scope?: 'region' | 'screen'
}

export interface SmartOcrResult {
  stage: OcrStage
  /** 被採用那一段的行(影像像素) */
  lines: OcrTextLine[]
  /** 被採用那一段的放大倍率 */
  scale: number
  stages: StageTiming[]
  /** 各段 OCR 本身的毫秒數總和 */
  ocrMs: number
}

/** 上次成功的面板區(影像像素);只在記憶體,程式重啟失效 */
export class PanelRegionCache {
  private readonly map = new Map<string, PhysRect>()
  get (key: string): PhysRect | undefined { return this.map.get(key) }
  set (key: string, r: PhysRect): void { this.map.set(key, r) }
  delete (key: string): void { this.map.delete(key) }
  clear (): void { this.map.clear() }
}

/** 快取鍵:client 大小 + 擷取偏移(client 部分在螢幕外時影像座標會平移)+ 搜尋範圍 */
export function cacheKey (client: { w: number, h: number }, offset: { x: number, y: number }, search: PhysRect): string {
  return `${client.w}x${client.h}@${offset.x},${offset.y}|${search.x},${search.y},${search.width},${search.height}`
}

export interface SmartOcrOptions {
  recognize: RecognizeRect
  /** 模板索引;null = 讀不到資料 → 只能走 full */
  index: LocateIndex | null
  cache: PanelRegionCache
  key: string
  /** 搜尋範圍(影像像素;`ocrRegion` 或整張) */
  search: PhysRect
  /** 測試 / selftest 用:強制走 full(不讀也不寫快取) */
  forceFull?: boolean
}

export async function smartRecognize (o: SmartOcrOptions): Promise<SmartOcrResult> {
  const stages: StageTiming[] = []
  const bounds = toRect(o.search)
  const run = async (name: StageTiming['name'], rect: PhysRect, scale: number) => {
    const t = Date.now()
    const res = await o.recognize(rect, scale)
    const st: StageTiming = { name, rect, scale, ms: Date.now() - t, ocrMs: res.ms, lines: res.lines.length }
    stages.push(st)
    return { lines: res.lines, st }
  }
  const done = (stage: OcrStage, lines: OcrTextLine[], scale: number): SmartOcrResult =>
    ({ stage, lines, scale, stages, ocrMs: stages.reduce((s, x) => s + x.ocrMs, 0) })

  const full = async () => {
    const scale = ocrScale(o.search.width, o.search.height)
    const { lines, st } = await run('full', o.search, scale)
    if (o.index && !o.forceFull) {
      // 整張 ×3 找得到面板 → 記下外擴區,下一次直接走 cached
      const loc = locatePanel(lines, o.index, bounds)
      st.hits = loc?.hits.length ?? 0
      if (loc && checkRegion(lines, o.index, loc.crop, bounds).ok) o.cache.set(o.key, toPhys(loc.crop))
    }
    return done('full', lines, scale)
  }

  if (o.forceFull || !o.index) return await full()
  const index = o.index

  // 1) 快取區
  const cached = o.cache.get(o.key)
  if (cached) {
    const scale = ocrScale(cached.width, cached.height)
    const { lines, st } = await run('cached', cached, scale)
    const chk = checkRegion(lines, index, toRect(cached), bounds)
    st.hits = chk.hits
    if (chk.ok) return done('cached', lines, scale)
    st.rejected = chk.reason
    o.cache.delete(o.key)
  }

  // 2) 兩段式
  const first = await run('locate', o.search, 1)
  const loc = locatePanel(first.lines, index, bounds)
  first.st.hits = loc?.hits.length ?? 0
  if (!loc) {
    first.st.rejected = 'no-candidate'
    return await full()
  }
  const crop = toPhys(loc.crop)
  const scale = ocrScale(crop.width, crop.height)
  const second = await run('detail', crop, scale)
  const chk = checkRegion(second.lines, index, loc.crop, bounds)
  second.st.hits = chk.hits
  if (chk.ok) {
    o.cache.set(o.key, crop)
    return done('two-pass', second.lines, scale)
  }
  second.st.rejected = chk.reason
  return await full()
}

// ---- WP-S2:優先用使用者框的區域,失敗退回整個畫面 ----

/** 事件的 `stage`:沒設定區域時 = 內層路徑;有區域時 `region`(區域內找到)或 `region-fallback`(區域內沒找到,改找整個畫面) */
export type RegionStage = OcrStage | 'region' | 'region-fallback'

export interface RegionFirstResult extends Omit<SmartOcrResult, 'stage'> {
  stage: RegionStage
  /** 被採用那一輪實際走的路(cached / two-pass / full) */
  inner: OcrStage
}

export interface RegionFirstOptions extends Omit<SmartOcrOptions, 'search' | 'key'> {
  /** 整個擷取影像(影像像素) */
  screen: PhysRect
  /** 使用者框的區域(影像像素;`regionSearchRect`);null = 沒設定 */
  region: PhysRect | null
  /** 搜尋範圍 → 快取鍵(`cacheKey` 帶 client 大小與擷取偏移) */
  keyFor: (search: PhysRect) => string
}

/** 區域這一輪算不算「找到面板」:與 `checkRegion` 同判準(≥ 2 行像詞綴);讀不到模板索引時無從判斷 → 算找到 */
export function regionFound (r: SmartOcrResult, index: LocateIndex | null, region: PhysRect): { ok: boolean, hits: number } {
  if (!index) return { ok: true, hits: 0 }
  if (r.stage !== 'full') return { ok: true, hits: r.stages[r.stages.length - 1]?.hits ?? 0 }
  // full 一定跑過整個區域:範圍本身就是邊界,「貼邊」不算,只剩「≥ 2 行」
  const bounds = toRect(region)
  const chk = checkRegion(r.lines, index, bounds, bounds)
  return { ok: chk.ok, hits: chk.hits }
}

export async function recognizeRegionFirst (o: RegionFirstOptions): Promise<RegionFirstResult> {
  const base = { recognize: o.recognize, index: o.index, cache: o.cache, forceFull: o.forceFull }
  if (!o.region) {
    const r = await smartRecognize({ ...base, search: o.screen, key: o.keyFor(o.screen) })
    return { ...r, inner: r.stage }
  }
  const a = await smartRecognize({ ...base, search: o.region, key: o.keyFor(o.region) })
  a.stages.forEach(s => { s.scope = 'region' })
  const found = regionFound(a, o.index, o.region)
  if (found.ok) return { ...a, stage: 'region', inner: a.stage }
  const last = a.stages[a.stages.length - 1]
  if (last) last.rejected = last.rejected ?? `region-too-few-hits(${found.hits})`
  const b = await smartRecognize({ ...base, search: o.screen, key: o.keyFor(o.screen) })
  b.stages.forEach(s => { s.scope = 'screen' })
  const stages = [...a.stages, ...b.stages]
  return {
    stage: 'region-fallback',
    inner: b.stage,
    lines: b.lines,
    scale: b.scale,
    stages,
    ocrMs: stages.reduce((s, x) => s + x.ocrMs, 0)
  }
}

/** `ocrRegion` 變了就清掉面板區快取(舊區域算出來的面板位置不再可信);回傳是否清了 */
export class RegionCacheGuard {
  private last: string | undefined
  constructor (private readonly cache: PanelRegionCache) {}
  update (region: OcrRegion | null | undefined): boolean {
    const key = region ? `${region.x},${region.y},${region.w},${region.h}` : 'none'
    const first = this.last === undefined
    const changed = !first && key !== this.last
    this.last = key
    if (changed) this.cache.clear()
    return changed
  }
}
