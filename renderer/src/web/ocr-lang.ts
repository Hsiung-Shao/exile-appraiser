// exile-appraiser(2026-10-02 第 22 步):英文客戶端 OCR 的 renderer 端小工具(純函式,renderer/test/ocr-lang.test.ts)。
import type { OcrAvailability } from '@ipc/types'

/**
 * 設定頁:缺的語言包是不是英文 —— main 回報想用的語言包(`OcrAvailability.lang`,`en-US` / `zh-Hant-TW`)優先;
 * 舊 main 沒回報 → 依目前的客戶端語言(main 也是依它選語言包,`main/src/ocr/ocr-lang.ts`)。
 */
export function ocrWantsEnglish (a: OcrAvailability | null | undefined, language: string): boolean {
  if (a && !a.ok && a.lang) return /^en(?:-|$)/i.test(a.lang)
  return language === 'en'
}

const CJK_RE = /[㐀-鿿]/

/**
 * 徽章上顯示的 OCR 原文(對不上的列 / 行):繁中刪掉 WinRT 插在字間的空白(改版前的寫法,`增 加 25 %` → `增加25%`);
 * 沒有 CJK 的(英文客戶端)只把連續空白縮成一個,保留字界(`UNIQUE  RING` → `UNIQUE RING`)。
 */
export function displayOcrText (text: string): string {
  return CJK_RE.test(text) ? text.replace(/\s+/g, '') : text.replace(/\s+/g, ' ').trim()
}
