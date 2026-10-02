/**
 * exile-appraiser(WP-R2):PoE2 符文塑形面板自動查價的掃描迴圈(不 import electron;main vitest 以假時鐘 / 假擷取測)。
 *
 * 2026-10-01 起排程 / 暫停條件 / 變化偵測 / 自動定位快取都在泛化的 `panel-scan.ts`(`PanelScan`),這裡只注入符文塑形的偵測器:
 * - 自動定位:`locateRunePanel`(≥ 2 列面板格式的列、右緣對齊)。
 * - 有沒有面板:至少 1 列 `isPanelRow`;送出的列 = 含 CJK 的行(名稱比對與查價在 renderer)。
 * - 直書重試:`looksVertical`(WinRT 把區域當成直書 → ×1 找面板列 → 只裁面板列 ×3)。
 * - 手動區域(`runeshapeRegion`)內沒找到面板**不**改掃全畫面(設定頁顯示「區域內沒找到面板」)。
 * - 查價面板 / 設定 / 框選層開著 → 暫停(限流額度讓給一般查價)。
 * 事件 `runeshape-scan-result`;不送任何鍵盤 / 滑鼠輸入。行為與泛化前相同(`main/test/runeshape-scan.test.ts`)。
 * 第 22 步:英文客戶端 —— `createRuneshapeDetector(textLang)`:列格式 / 面板定位 / 直書判定 / 送出的列都依目前的 OCR 文字語言
 * (英文 = 含兩個連續拉丁字母的行);`RUNESHAPE_DETECTOR` = 繁中(改版前的偵測器)。
 */
import type { RuneshapeScanEvent } from '@ipc/types'
import type { OcrTextLang } from '../../../poe2/src/desecration/ocr-text'
import { isPanelRow, locateRunePanel, looksVertical } from '../../../poe2/src/runeshape/row-format'
import { PanelScan, isRowText, type PanelDetector, type PanelScanDeps } from './panel-scan'

export {
  AUTO_MISS_LIMIT, AUTO_REFRESH_MS, CLEARING_BLOCKS, DEFAULT_DIFF_THRESHOLDS, DEFAULT_SCAN_INTERVAL_MS, FINGERPRINT_WIDTH, LOCATE_INTERVAL_MS, PIXEL_DELTA,
  autoKey, bgraToGray, clampScanInterval, frameDiff, isChanged, isRowText, scanBlock
} from './panel-scan'
export type { DiffThresholds, Fingerprint, ScanBlock, ScanCapture, ScanClock, ScanConfig, ScanEnv, TickResult } from './panel-scan'

/** 符文塑形面板的偵測器(繁中;改版前的 `RUNESHAPE_DETECTOR`) */
export const RUNESHAPE_DETECTOR: PanelDetector = {
  tag: '[runeshape]',
  locate: (lines, bounds) => {
    const loc = locateRunePanel(lines, bounds)
    return loc ? { crop: loc.crop, count: loc.rows.length } : null
  },
  classify: (lines) => {
    const cjk = lines.filter(l => isRowText(l.text))
    const hits = cjk.filter(l => isPanelRow(l.text)).length
    // 沒有任何面板格式的列 → 不是面板(地上物品標籤、其他 UI 的中文字),當成沒有列
    return { found: hits > 0, hits, rows: hits > 0 ? cjk : [] }
  },
  verticalRetry: looksVertical,
  activity: '查價',
  pauseOnPricePanel: true
}

/** 英文版偵測器(第 22 步):同一套規則,列格式 / 文字判定換英文 */
const RUNESHAPE_DETECTOR_EN: PanelDetector = {
  ...RUNESHAPE_DETECTOR,
  locate: (lines, bounds) => {
    const loc = locateRunePanel(lines, bounds, 'en')
    return loc ? { crop: loc.crop, count: loc.rows.length } : null
  },
  classify: (lines) => {
    const text = lines.filter(l => isRowText(l.text, 'en'))
    const hits = text.filter(l => isPanelRow(l.text, 'en')).length
    return { found: hits > 0, hits, rows: hits > 0 ? text : [] }
  },
  verticalRetry: (lines) => looksVertical(lines, 'en')
}

/** 依目前 OCR 文字語言切換的偵測器(每次呼叫看 `textLang()`) */
export function createRuneshapeDetector (textLang: () => OcrTextLang = () => 'zh'): PanelDetector {
  const pick = () => (textLang() === 'en' ? RUNESHAPE_DETECTOR_EN : RUNESHAPE_DETECTOR)
  return {
    ...RUNESHAPE_DETECTOR,
    locate: (lines, bounds) => pick().locate(lines, bounds),
    classify: (lines) => pick().classify(lines),
    verticalRetry: (lines) => pick().verticalRetry!(lines)
  }
}

export interface RuneshapeScanDeps extends Omit<PanelScanDeps, 'send'> {
  send: (ev: RuneshapeScanEvent) => void
  /** 第 22 步:目前的 OCR 文字語言(客戶端語言);省略 = 繁中 */
  textLang?: () => OcrTextLang
}

export class RuneshapeScan extends PanelScan {
  constructor (deps: RuneshapeScanDeps) {
    super(deps, deps.textLang ? createRuneshapeDetector(deps.textLang) : RUNESHAPE_DETECTOR)
  }
}
