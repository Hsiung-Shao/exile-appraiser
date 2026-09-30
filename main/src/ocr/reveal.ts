/**
 * exile-appraiser(WP-S):熱鍵 → 擷取遊戲 client 區 → Windows OCR → 廣播 `ocr-reveal-result`。
 * 比對(OCR 行 → 褻瀆詞綴 Tier)在 renderer(tiers 資料與 i18n 都在那裡),main 只送行與座標。
 * 座標一律換回 **client 實體像素**(OCR 座標 ÷ scale + 範圍偏移 + 擷取偏移),renderer 以 `client` 大小換算比例。
 * 辨識走兩段式(`strategy.ts`):快取區 ×3 → 整張 ×1 定位 + 面板區 ×3 → 整張 ×3;main 端只用模板 skeleton「定位」,不推 Tier。
 * WP-S2:有使用者框選的 `ocrRegion` 時先只找區域,區域內沒找到面板再找整個畫面(`stage` = `region` / `region-fallback`)。
 * 不送任何鍵盤 / 滑鼠輸入。
 */
import type { OcrRegion, OcrRevealError, OcrRevealEvent, OcrRevealLine } from '@ipc/types'
import type { LocateIndex } from '../../../poe2/src/desecration/ocr-locate'
import { captureGameClient, rectRecognizer, type PhysRect } from './capture'
// exile-appraiser(WP-S2):區域以 client 比例換算(減擷取偏移),優先用區域、失敗退回整張
import { PanelRegionCache, RegionCacheGuard, cacheKey, recognizeRegionFirst, regionSearchRect } from './strategy'
import { OcrError, type WinOcr } from './WinOcr'

type ResultEvent = Extract<OcrRevealEvent, { phase: 'result' }>

export interface RevealOcrDeps {
  ocr: () => WinOcr
  /** 遊戲 client 區(螢幕實體像素);沒有綁定回 null */
  bounds: () => PhysRect | null
  region: () => OcrRegion | null
  send: (name: string, payload: OcrRevealEvent) => void
  /** 面板定位用的模板索引(`locate-data.ts`);回 null = 只走整張 ×3 */
  locateIndex?: () => Promise<LocateIndex | null>
  log?: (msg: string) => void
}

function errorKind (e: unknown): OcrRevealError {
  if (e instanceof OcrError) {
    if (e.kind === 'lang-missing' || e.kind === 'unsupported-platform' || e.kind === 'timeout') return e.kind
    return 'ocr-failed'
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (msg === 'no-game-window' || msg === 'capture-failed') return msg
  return 'ocr-failed'
}

export class RevealOcr {
  private isBusy = false
  private seq = 0
  private readonly deps: RevealOcrDeps
  /** 上次成功的面板區(記憶體;程式重啟失效) */
  readonly cache = new PanelRegionCache()
  /** WP-S2:`ocrRegion` 改了 → 清快取 */
  private readonly regionGuard = new RegionCacheGuard(this.cache)

  constructor (deps: RevealOcrDeps) {
    this.deps = deps
  }

  /** WP-S2:main 收到新的 host-config 時呼叫;`ocrRegion` 與上次不同就清掉面板區快取 */
  regionChanged (region: OcrRegion | null | undefined): void {
    if (this.regionGuard.update(region)) this.log(`[ocr-reveal] 辨識區域改為 ${region ? JSON.stringify(region) : '整個畫面'},清除面板區快取`)
  }

  private log (m: string) { (this.deps.log ?? console.log)(m) }

  /** WP-R2:揭露面板正在辨識(符文塑形掃描與它共用 WinOcr,忙碌時丟掉那個 tick) */
  get busy (): boolean { return this.isBusy }

  /** 熱鍵觸發。執行中再按一次忽略(renderer 自己處理「再按一次 = 清除」)。 */
  async trigger (): Promise<void> {
    if (this.isBusy) {
      this.log('[ocr-reveal] 上一次還在辨識,略過')
      return
    }
    this.isBusy = true
    const seq = ++this.seq
    this.deps.send('ocr-reveal-result', { phase: 'pending', seq })
    const t0 = Date.now()
    const base: Omit<ResultEvent, 'ok'> = { phase: 'result', seq, lines: [], client: { w: 0, h: 0 }, scale: 1, tookMs: 0, ocrMs: 0 }
    try {
      const bounds = this.deps.bounds()
      if (!bounds) throw new Error('no-game-window')
      const [cap, index] = await Promise.all([
        captureGameClient(bounds),
        this.deps.locateIndex ? this.deps.locateIndex().catch(() => null) : Promise.resolve(null)
      ])
      const size = cap.image.getSize()
      const img = { w: size.width, h: size.height }
      // WP-S2:區域比例以 client 尺寸換算再減擷取偏移(遊戲視窗部分出界時不偏移);落在影像外 = 沒有區域
      const region = regionSearchRect(img, this.deps.region(), cap)
      const tCap = Date.now() - t0
      const res = await recognizeRegionFirst({
        recognize: rectRecognizer(cap.image, this.deps.ocr),
        index,
        cache: this.cache,
        screen: { x: 0, y: 0, width: img.w, height: img.h },
        region,
        keyFor: search => cacheKey(cap.client, cap.offset, search)
      })
      const lines: OcrRevealLine[] = res.lines.map(l => ({
        text: l.text,
        x: l.x + cap.offset.x,
        y: l.y + cap.offset.y,
        w: l.w,
        h: l.h
      }))
      const stages = res.stages.map(s => ({ ...s, rect: { ...s.rect, x: s.rect.x + cap.offset.x, y: s.rect.y + cap.offset.y } }))
      const ev: ResultEvent = {
        ...base,
        ok: true,
        lines,
        client: cap.client,
        scale: res.scale,
        tookMs: Date.now() - t0,
        ocrMs: res.ocrMs,
        stage: res.stage,
        inner: res.inner,
        stages
      }
      const detail = res.stages.map(s => `${s.scope ? `[${s.scope}]` : ''}${s.name}×${s.scale} ${s.rect.width}x${s.rect.height} ${s.ms} ms(OCR ${s.ocrMs})${s.hits != null ? ` 命中 ${s.hits}` : ''}${s.rejected ? ` ✗${s.rejected}` : ''}`).join(' → ')
      this.log(`[ocr-reveal] #${seq} client ${cap.client.w}x${cap.client.h}(擷取 ${size.width}x${size.height})${res.stage}:${detail};${lines.length} 行;擷取 ${tCap} ms、總計 ${ev.tookMs} ms`)
      this.deps.send('ocr-reveal-result', ev)
    } catch (e) {
      const error = errorKind(e)
      const message = e instanceof Error ? e.message : String(e)
      this.log(`[ocr-reveal] #${seq} 失敗:${error}(${message})`)
      this.deps.send('ocr-reveal-result', { ...base, ok: false, error, message, tookMs: Date.now() - t0 })
    } finally {
      this.isBusy = false
    }
  }
}
