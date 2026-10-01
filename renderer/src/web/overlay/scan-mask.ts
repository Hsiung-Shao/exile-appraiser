/**
 * exile-appraiser(效能修正第 18 步):回報 overlay 上畫在遊戲上方的東西給 main 遮掉(`OcrBadges.vue` / `RuneshapePrices.vue` 用;
 * `renderer/test/scan-mask.test.ts` 測)。
 * main 的擷取(overlay 原生 `screenshot()` / desktopCapturer)會截到 overlay 自己:褻瀆徽章畫在每組右側、與詞綴同高,
 * WinRT 把徽章文字併進同一行 → 那組對不上 → 只剩 2 組 → 再下一輪判定沒有面板 → 清徽章 → 3 組……(約 3 秒一循環)。
 * 每層在 DOM 更新後、paint 之前(`flush: 'post'` watcher / `nextTick`)量自己的直接子元素(徽章、「?」說明、提示)送 `scan-mask`;
 * 處理完一個掃描事件一律帶它的 `seq`(ack;main 送出 rows 後等 ack 才擷取下一張)。內容與上次相同且沒有新的 ack → 不送。
 * 座標 = CSS px(相對 overlay 視窗)+ `innerWidth / innerHeight`;main 依當次擷取的 client 大小換算(renderer 收結果時 `innerWidth / client.w` 的反向),
 * 不必等收到第一個事件才知道 client 大小(提示可能比結果先出現)。
 */
import type { ScanMaskReport } from '@ipc/types'

export type ScanMaskSource = ScanMaskReport['source']
export type MaskBox = ScanMaskReport['rects'][number]

/** `getBoundingClientRect` 的子集(測試給假的) */
export interface MeasurableElement {
  getBoundingClientRect: () => { left: number, top: number, width: number, height: number }
}

/** 元素外框(CSS px,保留兩位小數);寬或高為 0(沒畫出來)的略過 */
export function elementBoxes (els: Iterable<MeasurableElement>): MaskBox[] {
  const out: MaskBox[] = []
  const r2 = (v: number) => Math.round(v * 100) / 100
  for (const el of els) {
    const b = el.getBoundingClientRect()
    if (!(b.width > 0 && b.height > 0)) continue
    out.push({ x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) })
  }
  return out
}

export interface ScanMaskReporter {
  /**
   * 量 `layer` 的直接子元素並回報(`layer` 為 null = 這層沒畫東西 → 空陣列)。`seq` = 這次處理完的掃描事件(ack)。
   * 與上次送出的內容相同且沒有新的 seq → 不送;回傳有沒有送。
   */
  report: (layer: { children: Iterable<MeasurableElement> } | null | undefined, seq?: number) => boolean
  /** 重置(下一次一定送;元件卸載時先送空陣列再呼叫) */
  reset: () => void
}

export function createScanMaskReporter (
  source: ScanMaskSource,
  send: (r: ScanMaskReport) => void,
  viewport: () => { w: number, h: number }
): ScanMaskReporter {
  let lastKey: string | null = null
  let lastSeq: number | undefined
  return {
    report (layer, seq) {
      const rects = layer ? elementBoxes(layer.children) : []
      const vp = viewport()
      if (!(vp.w > 0 && vp.h > 0)) return false
      const key = `${vp.w}x${vp.h}|${rects.map(r => `${r.x},${r.y},${r.w},${r.h}`).join(';')}`
      const newAck = seq != null && seq !== lastSeq
      if (key === lastKey && !newAck) return false
      lastKey = key
      const r: ScanMaskReport = { source, viewport: { w: vp.w, h: vp.h }, rects }
      if (seq != null) { r.seq = seq; lastSeq = seq }
      send(r)
      return true
    },
    reset () {
      lastKey = null
      lastSeq = undefined
    }
  }
}

/** `document.fonts` 用到的部分(測試給假的) */
export interface FontFaceSetLike { status: string, ready: Promise<unknown> }

/**
 * 處理完一個掃描事件後(DOM 已更新)回報並 ack。量外框會強制排版 → 第一次用到的字型這時才開始載入(`fonts.status` 變 `loading`),
 * 載入完寬高會變(離屏實測徽章寬約 +21 px)。所以:先送外框(不 ack)→ 有字型在載入 → 等載完、`beforeAck`(褻瀆重排)後再量一次才 ack;
 * main 在 ack 之前不擷取(最多等 1 秒),就不會截到「字型換了、遮罩還是舊寬度」的那一幀。
 */
export async function reportWithAck (
  reporter: ScanMaskReporter,
  layer: () => { children: Iterable<MeasurableElement> } | null | undefined,
  seq: number,
  fonts?: FontFaceSetLike | null,
  beforeAck?: () => Promise<void> | void
): Promise<void> {
  reporter.report(layer())
  if (fonts && fonts.status === 'loading') {
    await fonts.ready
    await beforeAck?.()
  }
  reporter.report(layer(), seq)
}
