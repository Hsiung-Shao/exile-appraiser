/**
 * exile-appraiser(WP-R):PoE2 褻瀆詞綴 Tier 推定的對外入口。
 * 資料由 `@/assets/data` 的 `init()` 經 DataSource 載入一次(`desecration/{tiers,base_profiles}.json`),
 * 切換語系(`loadForLang`)不重載 —— 資料本身是語言無關的(對接鍵是 stat hash 與英文 refName)。
 */
import { DESECRATION_TIERS, BASE_PROFILES } from "@/assets/data";
import type { ParsedItem } from "@/parser/ParsedItem";
import { inferDesecratedTiersWith, type DesecrationData } from "./infer";

export * from "./types";
export * from "./display";
// WP-S:靈魂之井揭露面板 OCR 比對
export * from "./ocr-match";
export {
  inferDesecratedTiersWith,
  matchStats,
  resolveProfiles,
  type DesecrationData,
} from "./infer";

let cached: { key: unknown; data: DesecrationData } | undefined;

/** 目前載入的資料;沒載到(舊安裝缺檔、測試環境)回 undefined → 不推定 */
export function desecrationData(): DesecrationData | undefined {
  if (!DESECRATION_TIERS || !BASE_PROFILES) return undefined;
  if (cached?.key !== DESECRATION_TIERS) {
    cached = {
      key: DESECRATION_TIERS,
      data: { tiers: DESECRATION_TIERS, baseProfiles: BASE_PROFILES },
    };
  }
  return cached.data;
}

/** Parser 的 `{ virtual }` 掛點:就地補上一般複製褻瀆詞綴的推定 Tier */
export function inferDesecratedTiers(item: ParsedItem): void {
  const data = desecrationData();
  if (data) inferDesecratedTiersWith(item, data);
}
