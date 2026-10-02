/**
 * exile-appraiser(2026-10-02 第 22 步):褻瀆 / 符文塑形辨識用哪個 Windows OCR 語言包 —— 預設跟著設定的「客戶端語言」(`language`)。
 * 第 25 步:新增獨立的「辨識語言」設定 `ocrLang`(`follow` / `cmn-Hant` / `en`;`follow` = 跟隨客戶端語言,舊設定檔 = follow);
 * 介面語言 / 客戶端語言(查價解析)/ 辨識語言三者獨立,**有效辨識語言**由 `effectiveOcrLang` 決定。
 * 辨識只做 PoE2;PoE2 客戶端語言 `en` → `en-US`(英文客戶端),其他(`cmn-Hant`)→ `zh-Hant-TW`(改版前固定的那個)。
 * 台服只有繁中客戶端(renderer `isSupportedCombination` 擋掉台服 + 英文),所以台服一律 `zh-Hant-TW`,不受影響。
 * 純函式、不 import electron(main vitest 直接測)。
 */
import type { HostConfigForMain } from '@ipc/types'
import { ocrTextLangOf, type OcrTextLang } from '../../../poe2/src/desecration/ocr-text'

export type OcrLangTag = 'zh-Hant-TW' | 'en-US'

/** 改版前固定的語言包(沒有設定時 / 舊 renderer) */
export const DEFAULT_OCR_LANG: OcrLangTag = 'zh-Hant-TW'

/** 有效辨識語言(第 25 步):手動指定優先,`follow` / 缺欄位 / 非法值 → 客戶端語言(`en` → `en`,其他 → `cmn-Hant`) */
export function effectiveOcrLang (cfg: Pick<HostConfigForMain, 'language' | 'ocrLang'> | null | undefined): 'cmn-Hant' | 'en' {
  const o = cfg?.ocrLang
  if (o === 'en' || o === 'cmn-Hant') return o
  return cfg?.language === 'en' ? 'en' : 'cmn-Hant'
}

/** 設定 → OCR 語言包 */
export function ocrLangFor (cfg: Pick<HostConfigForMain, 'language' | 'ocrLang'> | null | undefined): OcrLangTag {
  return effectiveOcrLang(cfg) === 'en' ? 'en-US' : DEFAULT_OCR_LANG
}

/** OCR 語言包 → 比對用的文字語言(`poe2/src/desecration/ocr-text.ts`) */
export function textLangFor (tag: string): OcrTextLang {
  return ocrTextLangOf(tag)
}

/**
 * `--ocr-selftest` / `--runeshape-selftest` 用哪個語言包:`--ocr-lang=<tag>` 優先;沒給就看檔名
 * (含 `-en-` / `-en.` = 英文客戶端截圖,與 `scripts/ocr-fixture.mjs` 同規則),其他 = 繁中。
 */
export function selftestOcrLang (file: string, argv: readonly string[]): string {
  const flag = argv.find(a => a.startsWith('--ocr-lang='))?.slice('--ocr-lang='.length)
  if (flag) return flag
  const base = file.split(/[\\/]/).pop() ?? file
  return /-en[-.]/i.test(base) ? 'en-US' : DEFAULT_OCR_LANG
}
