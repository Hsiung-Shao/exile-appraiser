/**
 * exile-appraiser:PoE2 靈魂之井三選一揭露面板(褻瀆詞綴)的**自動持續辨識**(2026-10-01 取代「按熱鍵辨識一次」的 `RevealOcr`)。
 * 排程 / 暫停 / 變化偵測 / 自動定位快取沿用 `panel-scan.ts`(與符文塑形同一套骨架),這裡只注入褻瀆的偵測器:
 * - 定位 / 判定:`poe2/src/desecration/ocr-locate.ts` 的模板索引(`LocateIndex`,由 `data/poe2/desecration/tiers.json` 建;
 *   `locate-data.ts` 第一次用到才讀)——`locatePanel` 找「像詞綴」的行並外擴、`findPanelHits` ≥ 2 行像詞綴且分成 ≥ 2 組
 *   (選項之間有空隙;物品浮窗的連續詞綴不算)才算有面板。2026-10-01 第 13 步:每一簇再過 `panel-veto.ts` 的否決規則
 *   (浮窗的詞綴標頭 / 屬性行 / 組數 > 3 / 一組 > 3 行),被否決的簇不算(使用者回報背包物品的進階詞綴說明被當成面板)。
 * - 送出的行 = 該區域 OCR 的**全部行**(renderer 的 `matchRevealLines` 需要對不上的行來補「中間選項沒認出」的組)。
 * - 有 `ocrRegion` 時**只看區域**(與符文塑形相同):區域內沒找到面板 → 送空結果、設定頁顯示「區域內沒找到面板」,不改找整個畫面
 *   (第 13 步移除「退回自動定位」:面板沒開時改找整個畫面會把背包物品浮窗當成面板);沒框區域才自動定位整個畫面。
 * - **查價面板開著不暫停**(看褻瀆時常同時開著查價);設定 / 框選層開著、遊戲失焦時暫停。
 * 與符文塑形共用同一個 WinOcr(對方忙碌就丟掉這個 tick;兩者同時開著時 main 把第一個 tick 錯開半個間隔)。
 * 事件 `reveal-scan-result`(不進 `PREVIEW_EVENTS`);不送任何鍵盤 / 滑鼠輸入、不上傳。
 */
import type { RevealScanEvent } from '@ipc/types'
import { findPanelHits, locatePanel, type LocateIndex, type PanelHitsDiag } from '../../../poe2/src/desecration/ocr-locate'
import { GROUP_GAP_RATIO, type OcrTextLine } from '../../../poe2/src/desecration/ocr-text'
import { PanelScan, type PanelDetector, type PanelScanDeps } from './panel-scan'

/** 至少這麼多行「像詞綴」才算有面板(與兩段式辨識的 `checkRegion` 同判準) */
export const REVEAL_MIN_HITS = 2
/** 而且要分成至少這麼多組(選項之間的空隙 > GROUP_GAP_RATIO × 行高) */
export const REVEAL_MIN_GROUPS = 2

/**
 * 像詞綴的行依 y 分組:相鄰中心距 > `GROUP_GAP_RATIO`(1.9)× 中位行高就是下一組(與 renderer `matchReveal` 分組同一個門檻)。
 * 持續掃描才需要:揭露面板的選項之間有明顯空隙(樣本組間 ≥ 2.31 × 行高),物品浮窗的詞綴是連續的行(約 1.5 ×)——
 * 只看「≥ 2 行像詞綴」會把游標指著的背包物品當成面板(無頭驗證時發現)。
 */
export function modGroupCount (hits: OcrTextLine[]): number {
  if (!hits.length) return 0
  const hs = hits.map(l => l.h).sort((a, b) => a - b)
  const lineH = hs[Math.floor(hs.length / 2)] || 1
  const ys = hits.map(l => l.y + l.h / 2).sort((a, b) => a - b)
  let groups = 1
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > GROUP_GAP_RATIO * lineH) groups++
  return groups
}

/** `index()` 回傳目前的模板索引(還沒讀 / 讀不到 = null);`load()` 觸發讀取(只讀一次) */
export function createRevealDetector (load: () => Promise<LocateIndex | null>): PanelDetector {
  let index: LocateIndex | null = null
  return {
    tag: '[reveal-scan]',
    ready: async () => {
      if (!index) index = await load().catch(() => null)
      return index != null
    },
    locate: (lines, bounds) => {
      if (!index) return null
      const loc = locatePanel(lines, index, bounds)
      return loc ? { crop: loc.crop, count: loc.hits.length } : null
    },
    classify: (lines) => {
      const diag: PanelHitsDiag = { vetoes: [] }
      const panel = index ? findPanelHits(lines, index, diag) : null
      const hits = panel?.hits.length ?? 0
      const found = hits >= REVEAL_MIN_HITS && modGroupCount(panel!.hits) >= REVEAL_MIN_GROUPS
      const out: { found: boolean, hits: number, rows: typeof lines, veto?: string } = { found, hits, rows: found ? lines : [] }
      const v = diag.vetoes[0]
      if (!found && v) out.veto = `${v.kind}(${v.detail.replace(/\s+/g, '')})`
      return out
    },
    activity: '辨識',
    pauseOnPricePanel: false
  }
}

export interface RevealScanDeps extends Omit<PanelScanDeps, 'send'> {
  send: (ev: RevealScanEvent) => void
  /** 模板索引(`locate-data.ts` 的 `loadLocateIndex`) */
  locateIndex: () => Promise<LocateIndex | null>
}

export class RevealScan extends PanelScan {
  constructor (deps: RevealScanDeps) {
    super(deps, createRevealDetector(deps.locateIndex))
  }
}
