/**
 * exile-appraiser(WP-S):renderer 用的揭露面板 OCR 入口(經 `@poe2-entry`)。
 * 資料用 `desecrationData()`(PoE2 `init()` 載入的 tiers / base_profiles);沒載到回 undefined。
 * 第 22 步:OCR 文字語言跟著目前載入的客戶端語言(`LOADED_DATA.lang`:`en` → 英文模板;其他 → 繁中)——
 * main 的 OCR 語言包也由同一個設定(`language`)決定(`main/src/ocr/ocr-lang.ts`)。
 * 第 27 步:查價時資料集可能暫時換成另一語言的物品 → 這裡取客戶端語言那一套(`PRIMARY_DATA`),不跟著查價換。
 */
import { LOADED_DATA, PRIMARY_DATA } from "@/assets/data";
import { desecrationData } from "./index";
import { matchReveal, type OcrTextLang, type OcrTextLine, type RevealMatchOptions, type RevealMatchResult } from "./ocr-match";

/** 目前客戶端語言對應的 OCR 文字語言(資料載入中 = 繁中) */
export function loadedOcrTextLang(): OcrTextLang {
  return (PRIMARY_DATA ? PRIMARY_DATA.lang : LOADED_DATA?.lang) === "en" ? "en" : "zh";
}

export { poolLabel, rangeLabel } from "./display";

export function matchRevealLines(
  lines: OcrTextLine[],
  opts: RevealMatchOptions = {},
): RevealMatchResult | undefined {
  const data = desecrationData();
  if (!data) return undefined;
  return matchReveal(lines, data, opts.lang ? opts : { ...opts, lang: loadedOcrTextLang() });
}
