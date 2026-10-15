/**
 * 設定 › 自動辨識:三張辨識卡片(褻瀆 / 符文塑形 / 倉庫價格)共用 OcrScanSection.vue 的差異表(純資料 + 純函式;
 * `renderer/test/stash-prices.test.ts` S20 測)。2026-10-14 使用者要求三張卡片同一個樣板:
 * 倉庫價格(PoE1)原本是獨立的 StashPricesSection.vue,差異(統計來源 / 輪詢、區域按鈕「還原預設」、沒框過顯示「預設按鈕列」)改由這裡帶入。
 * data-setting / data-action 名稱沿用各卡片改版前的(驗證腳本與文件照舊可用)。
 * 相對路徑匯入(renderer vitest 不載別名)。
 */
import type { StashStats } from '../../../../ipc/types'

export type ScanCardKind = 'reveal' | 'runeshape' | 'stash'

export interface ScanSpec {
  /** 卡片只在這一代顯示 / 讀統計 */
  game: 'poe1' | 'poe2'
  enabled: 'revealAutoEnabled' | 'runeshapeEnabled' | 'stashPricesEnabled'
  interval: 'revealIntervalMs' | 'runeshapeIntervalMs' | 'stashPricesIntervalMs'
  region: 'ocrRegion' | 'runeshapeRegion' | 'stashRegion'
  /** 暫停 / 繼續熱鍵(在「熱鍵」總表編輯;這裡只給狀態文字用) */
  pauseHotkey: 'hotkeyOcrReveal' | 'hotkeyRuneshapeToggle' | 'hotkeyStashToggle'
  /** 統計來源(main `reveal-stats` / `runeshape-stats` / `stash-stats`) */
  stats: ScanCardKind
  /** 掛載期間每隔多久重讀統計(ms;省略 = 只在開啟 / 改設定 / 按重新整理時讀) */
  pollMs?: number
  /** `help`:標題旁「?」的長說明(沒有 = 不顯示);`clear`:區域的清除鈕文字 */
  i18n: { section: string, hint: string, help?: string, enabled: string, region: string, regionUnset: string, regionHint: string, clear: string }
  ds: Record<'section' | 'enabled' | 'status' | 'stats' | 'interval' | 'intervalWarn' | 'regionStatus' | 'pick' | 'clear' | 'pickNa' | 'regionHint' | 'timing', string>
}

export const SCAN_SPECS: Readonly<Record<ScanCardKind, ScanSpec>> = {
  reveal: {
    game: 'poe2',
    enabled: 'revealAutoEnabled',
    interval: 'revealIntervalMs',
    region: 'ocrRegion',
    pauseHotkey: 'hotkeyOcrReveal',
    stats: 'reveal',
    i18n: {
      section: 'ppz.ocr.section',
      hint: 'ppz.ocr.hint',
      enabled: 'ppz.ocr.auto_enabled',
      region: 'ppz.ocr.region.title',
      regionUnset: 'ppz.ocr.region.status_unset',
      regionHint: 'ppz.ocr.region.hint',
      clear: 'ppz.ocr.region.clear'
    },
    ds: {
      section: 'ocr-section',
      enabled: 'reveal-auto-enabled',
      status: 'reveal-scan-status',
      stats: 'reveal-stats',
      interval: 'reveal-interval',
      intervalWarn: 'reveal-interval-warn',
      regionStatus: 'ocr-region-status',
      pick: 'ocr-region-pick',
      clear: 'ocr-region-clear',
      pickNa: 'ocr-region-pick-unavailable',
      regionHint: 'ocr-region-hint',
      timing: 'reveal-timing'
    }
  },
  runeshape: {
    game: 'poe2',
    enabled: 'runeshapeEnabled',
    interval: 'runeshapeIntervalMs',
    region: 'runeshapeRegion',
    pauseHotkey: 'hotkeyRuneshapeToggle',
    stats: 'runeshape',
    i18n: {
      section: 'ppz.runeshape.section',
      hint: 'ppz.runeshape.hint',
      help: 'ppz.runeshape.display_hint',
      enabled: 'ppz.runeshape.enabled',
      region: 'ppz.runeshape.region',
      regionUnset: 'ppz.runeshape.region_unset',
      regionHint: 'ppz.runeshape.region_hint',
      clear: 'ppz.ocr.region.clear'
    },
    ds: {
      section: 'runeshape-section',
      enabled: 'runeshape-enabled',
      status: 'runeshape-panel-status',
      stats: 'runeshape-stats',
      interval: 'runeshape-interval',
      intervalWarn: 'runeshape-interval-warn',
      regionStatus: 'runeshape-region-status',
      pick: 'runeshape-region-pick',
      clear: 'runeshape-region-clear',
      pickNa: 'runeshape-region-pick-unavailable',
      regionHint: 'runeshape-region-hint',
      timing: 'runeshape-timing'
    }
  },
  // PoE1 倉庫價格疊層(碎片頁):OCR 區域沒框過 = 預設按鈕列(不是「未設定」),清除 = 還原預設;狀態每 2 秒讀一次
  stash: {
    game: 'poe1',
    enabled: 'stashPricesEnabled',
    interval: 'stashPricesIntervalMs',
    region: 'stashRegion',
    pauseHotkey: 'hotkeyStashToggle',
    stats: 'stash',
    pollMs: 2000,
    i18n: {
      section: 'ppz.stash.section',
      hint: 'ppz.stash.hint',
      help: 'ppz.stash.help',
      enabled: 'ppz.stash.enabled',
      region: 'ppz.stash.region',
      regionUnset: 'ppz.stash.region_default',
      regionHint: 'ppz.stash.region_hint',
      clear: 'ppz.stash.region_reset'
    },
    ds: {
      section: 'stash-prices',
      enabled: 'stash-prices-enabled',
      status: 'stash-status',
      stats: 'stash-stats',
      interval: 'stash-interval',
      intervalWarn: 'stash-interval-warn',
      regionStatus: 'stash-region-status',
      pick: 'stash-region-pick',
      clear: 'stash-region-reset',
      pickNa: 'stash-region-pick-unavailable',
      regionHint: 'stash-region-hint',
      timing: 'stash-timing'
    }
  }
}

export interface ScanCardStatus { code: string, tone: 'ok' | 'warn' | 'dim', text: string }

/** 倉庫價格狀態列(main `stash-stats`);沒有統計 → null(呼叫端顯示「檢查中」) */
export function stashScanStatus (
  s: StashStats | undefined,
  t: (key: string, args?: Record<string, unknown>) => string,
  hotkey: string
): ScanCardStatus | null {
  if (!s) return null
  if (s.block === 'user-paused') return { code: 'paused', tone: 'warn', text: t('ppz.ocr.scan_status_paused', { hotkey: hotkey || '—' }) }
  // 2026-10-15:台服 main 完全不掃描
  if (s.block === 'not-intl') return { code: 'not-intl', tone: 'warn', text: t('ppz.stash.status_not_intl') }
  if (s.showing && s.subtab) return { code: 'showing', tone: 'ok', text: t('ppz.stash.status_showing', { subtab: t(`ppz.stash.subtab_${s.subtab}`) }) }
  // 2026-10-15:熱鍵顯示模式還沒按熱鍵 / overlay 擷取全黑(獨占全螢幕)
  if (s.block === 'not-armed') return { code: 'not-armed', tone: 'dim', text: t('ppz.stash.status_not_armed', { hotkey: hotkey || '—' }) }
  if (s.block === 'capture-black') return { code: 'capture-black', tone: 'warn', text: t('ppz.stash.status_capture_black') }
  if (s.block === 'game-inactive' || s.block === 'no-window') return { code: s.block, tone: 'dim', text: t('ppz.stash.status_game_inactive') }
  if (s.block === 'ui-open') return { code: 'ui-open', tone: 'dim', text: t('ppz.stash.status_ui_open') }
  return { code: 'idle', tone: 'dim', text: t('ppz.stash.status_idle') }
}

/** 倉庫價格最近耗時文字 */
export function stashTimingText (s: StashStats | undefined, t: (key: string, args?: Record<string, unknown>) => string): string {
  if (!s || s.lastOcrMs == null) return t('ppz.runeshape.timing_none')
  return t('ppz.stash.timing', { ms: s.lastOcrMs, count: s.ocrCount })
}
