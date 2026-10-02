/**
 * exile-appraiser(code review 第 C 批):`createScanLayer`(scan-layer.ts)的元件版 —— 接上 Host IPC、`document.fonts`、
 * ResizeObserver、元件生命週期,並把所有掃描層共有的「會改變畫面大小」來源(全域字級 `fsBase`、介面語言 = i18n 實際的 locale)
 * 與「資料改變要請 main 重送」來源(資料集世代、已載入遊戲)加進去。`OcrBadges.vue` / `RuneshapePrices.vue` 用。
 */
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Host } from '../background/IPC'
import { AppConfig } from '../Config'
import { loadedGame } from '../games/active'
import { dataGeneration } from './scan-dedupe'
import { createScanLayer, type ScanLayer, type ScanLayerDeps, type ScanLayerOptions } from './scan-layer'

export type UseScanLayerOptions<E extends { seq: number }> = Omit<ScanLayerOptions<E>, 'data'> & {
  subscribe: ScanLayerDeps<E>['subscribe']
}

export function useScanLayer<E extends { seq: number }> (opts: UseScanLayerOptions<E>): ScanLayer<E> {
  const config = AppConfig()
  // 介面語言:看 i18n 實際的 locale(`uiLanguage` 改了要等字串檔載完才換)
  const { locale } = useI18n()
  const { subscribe, ...rest } = opts
  const s = createScanLayer<E>({
    ...rest,
    drawn: [...opts.drawn, () => config.fsBase, locale],
    data: [dataGeneration, loadedGame]
  }, {
    subscribe,
    send: r => { Host.scanMask(r) },
    viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
    fonts: typeof document !== 'undefined' ? document.fonts : null,
    ResizeObserver: typeof ResizeObserver !== 'undefined' ? ResizeObserver : null
  })
  onMounted(s.start)
  onUnmounted(s.stop)
  return s
}
