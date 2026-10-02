/**
 * exile-appraiser(code review 第 C 批):overlay 掃描徽章層的共用接線(`OcrBadges.vue` / `RuneshapePrices.vue`,經 `useScanLayer.ts`)。
 * 原本兩個元件各自實作同一套:`createScanMaskReporter`、事件 → handleEvent + nextTick(ack)、字型 `loadingdone`、卸載送空遮罩、
 * `createScanResultGate`、`flush: 'post'` 的遮罩 watch、第 B 批的 resend tracker。這裡收成一份,並一次修好:
 * - 事件處理丟例外也一定 ack(`try { handleEvent } finally { nextTick(ack) }`;main 送出 rows 後等 ack 才擷取下一張,不 ack 會等到 1 秒逾時);
 * - ack 前等「畫出來後重排」完成(`beforeAck` 回傳 true = DOM 又改了 → 再等一次 nextTick 才量),ack 帶的一定是重排後的外框;
 * - 遮罩 watch 追外觀(徽章外觀變數、全域字級、介面語言;由呼叫端 `drawn` 傳入)+ 對每個直接子元素掛 ResizeObserver:
 *   任何尺寸變化(字型載入、文字換語言、字級)都在 paint 前重報(內容相同不送)。
 * 不 import Host / AppConfig / 遊戲狀態(測試直接給假的;`renderer/test/scan-layer.test.ts`)。
 */
import { nextTick, shallowRef, watch, type ShallowRef, type WatchSource } from 'vue'
import type { ScanMaskReport } from '@ipc/types'
import { createScanResultGate } from './scan-dedupe'
import { createResendTracker, createScanMaskReporter, reportWithAck, type FontFaceSetLike, type ScanMaskSource } from './scan-mask'

/** ResizeObserver 用到的部分(測試給假的) */
export interface ResizeObserverLike {
  observe: (el: Element) => void
  unobserve: (el: Element) => void
  disconnect: () => void
}
export type ResizeObserverCtor = new (cb: () => void) => ResizeObserverLike

/** `document.fonts` 用到的部分 */
export interface FontEventsLike extends FontFaceSetLike {
  addEventListener?: (type: 'loadingdone', fn: () => void) => void
  removeEventListener?: (type: 'loadingdone', fn: () => void) => void
}

export interface ScanLayerDeps<E> {
  /** 訂閱掃描事件(`Host.onRevealScanResult` 等),回傳取消訂閱 */
  subscribe: (cb: (e: E) => void) => () => void
  send: (r: ScanMaskReport) => void
  viewport: () => { w: number, h: number }
  fonts?: FontEventsLike | null
  /** 沒有(舊環境 / 測試不給)= 不掛 */
  ResizeObserver?: ResizeObserverCtor | null
}

export interface ScanLayerOptions<E extends { seq: number }> {
  source: ScanMaskSource
  /** 處理一個掃描事件(畫 / 清 / 略過);丟例外照樣 ack */
  handleEvent: (e: E) => void
  /** 會改變畫面內容 / 大小的反應式來源(DOM 更新後、paint 前重報遮罩) */
  drawn: WatchSource[]
  /** 資料集世代 / 已載入遊戲:改變時依 resend tracker 請 main 重送 rows */
  data: WatchSource[]
  /** 畫面上是否有用目前資料算的東西(`resend.dataChanged` 用) */
  showing: () => boolean
  /**
   * ack 前呼叫(`fontsWaited` = 剛等完字型載入):等進行中的重排完成;回傳 true = DOM 又改了(再等一次 nextTick 才量)。
   * 褻瀆層用它等 `stackBadges` 重排;符文層不需要。
   */
  beforeAck?: (fontsWaited: boolean) => boolean | void | Promise<boolean | void>
  /** 字型載入完成(`loadingdone`);預設 = 重報遮罩 */
  onFontsLoaded?: () => void
}

export interface ScanLayer<E> {
  /** 綁到層根元素(`ref="layer"`) */
  layer: ShallowRef<HTMLElement | null>
  mask: ReturnType<typeof createScanMaskReporter>
  gate: ReturnType<typeof createScanResultGate>
  resend: ReturnType<typeof createResendTracker>
  /** 量目前畫面並回報(內容相同不送);回傳有沒有送 */
  report: () => boolean
  /** 收到一個掃描事件(subscribe 的回呼;測試直接呼叫) */
  onEvent: (e: E) => void
  /** 訂閱掃描事件 / 字型事件(onMounted) */
  start: () => void
  /** 取消訂閱、送空遮罩、拆 ResizeObserver(onUnmounted) */
  stop: () => void
}

/** 在目前的 effect scope(元件 setup / 測試的 effectScope)裡建立;watch 隨 scope 結束 */
export function createScanLayer<E extends { seq: number }> (opts: ScanLayerOptions<E>, deps: ScanLayerDeps<E>): ScanLayer<E> {
  const layer = shallowRef<HTMLElement | null>(null)
  const mask = createScanMaskReporter(opts.source, deps.send, deps.viewport)
  const gate = createScanResultGate()
  const resend = createResendTracker()
  const report = () => mask.report(layer.value)

  // ---- 每個直接子元素(徽章 / 說明 / 提示)掛 ResizeObserver:尺寸變了(字型載入、換語言、字級)→ paint 前重報 ----
  const ro = deps.ResizeObserver ? new deps.ResizeObserver(() => { report() }) : null
  const observed = new Set<Element>()
  function syncObserved () {
    if (!ro) return
    const now = new Set<Element>(layer.value ? Array.from(layer.value.children) : [])
    for (const el of observed) if (!now.has(el)) { ro.unobserve(el); observed.delete(el) }
    for (const el of now) if (!observed.has(el)) { ro.observe(el); observed.add(el) }
  }

  // ---- 畫面變了(DOM 已更新、還沒 paint)→ 回報外框給 main 遮掉 ----
  watch([layer, ...opts.drawn], () => { report(); syncObserved() }, { flush: 'post' })
  // ---- 資料集世代 / 已載入遊戲改變 → 之前沒畫出的 rows、或畫面上用舊資料算的徽章,請 main 重送一次(第 B 批) ----
  watch(opts.data, () => {
    if (resend.dataChanged(opts.showing())) void nextTick(() => { mask.report(layer.value, undefined, true) })
  })

  function ack (seq: number): Promise<void> {
    return reportWithAck(mask, () => layer.value, seq, deps.fonts, opts.beforeAck, nextTick).finally(syncObserved)
  }
  /** 每個事件處理完(不論畫 / 清 / 略過,處理丟例外也一樣)都在 DOM 更新後回報一次並帶 seq(ack) */
  function onEvent (e: E) {
    try {
      opts.handleEvent(e)
    } finally {
      void nextTick(() => ack(e.seq))
    }
  }

  const onFontsLoaded = () => { (opts.onFontsLoaded ?? report)() }
  let unsub: (() => void) | null = null
  return {
    layer,
    mask,
    gate,
    resend,
    report,
    onEvent,
    start () {
      unsub = deps.subscribe(onEvent)
      deps.fonts?.addEventListener?.('loadingdone', onFontsLoaded)
    },
    stop () {
      unsub?.()
      unsub = null
      deps.fonts?.removeEventListener?.('loadingdone', onFontsLoaded)
      mask.report(null)
      ro?.disconnect()
      observed.clear()
    }
  }
}
