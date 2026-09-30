/**
 * exile-appraiser(WP-S):renderer 用的揭露面板 OCR 入口(經 `@poe2-entry`)。
 * 資料用 `desecrationData()`(PoE2 `init()` 載入的 tiers / base_profiles);沒載到回 undefined。
 */
import { desecrationData } from "./index";
import { matchReveal, type OcrTextLine, type RevealMatchOptions, type RevealMatchResult } from "./ocr-match";

export { poolLabel, rangeLabel } from "./display";

export function matchRevealLines(
  lines: OcrTextLine[],
  opts: RevealMatchOptions = {},
): RevealMatchResult | undefined {
  const data = desecrationData();
  if (!data) return undefined;
  return matchReveal(lines, data, opts);
}
