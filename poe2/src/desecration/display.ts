/**
 * exile-appraiser(WP-R):推定 Tier 的顯示字串(FilterModifierTiers.vue 徽章、SourceInfo.vue 詞綴說明共用)。
 * i18n 鍵在 renderer/src/i18n/{cmn-Hant,en}.json 的 `ppz.desecration.*`。
 */
import type { ModifierInfo } from "@/parser/advanced-mod-desc";
import type { DesecrationCandidate } from "./types";

export type Translate = (key: string, args?: unknown) => string;

const POOL_KEY: Record<string, string> = {
  normal: "ppz.desecration.pool_normal",
  desecration_exclusive: "ppz.desecration.pool_exclusive",
  desecration_exclusive_jewel: "ppz.desecration.pool_exclusive_jewel",
};

/** 詞綴池名:三神專屬顯示神名(烏拉曼 / 阿瑪納姆 / 庫爾加),其餘顯示「一般」/「深淵珠寶專屬」 */
export function poolLabel(
  c: Pick<DesecrationCandidate, "pool" | "gods">,
  t: Translate,
): string {
  if (c.gods?.length) {
    return c.gods.map((g) => t(`ppz.desecration.god_${g}`)).join("/");
  }
  return t(POOL_KEY[c.pool] ?? POOL_KEY.normal);
}

/** `13–17`;單值 `15`;未知 `?`;多個 stat 以 ` / ` 分隔 */
export function rangeLabel(ranges: Array<[number, number] | null>): string {
  return ranges
    .map((r) => (r ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`) : "?"))
    .join(" / ");
}

/** `T2/T3` 這種標籤(不含「推定」字樣) */
export function inferredTierLabel(info: ModifierInfo, t: Translate): string {
  const tiers = info.tierCandidates ?? (info.tier ? [info.tier] : []);
  return tiers.map((x) => t("filters.tier", [x])).join("/");
}

/** 徽章 tooltip:標題 + 每個候選一行(Tier、詞綴池、範圍)+ 以類別推 profile 時的註記 */
export function inferredTierTitle(info: ModifierInfo, t: Translate): string {
  const lines = [t("ppz.desecration.inferred_title")];
  for (const c of info.inferredCandidates ?? []) {
    lines.push(
      t("ppz.desecration.candidate", {
        tier: t("filters.tier", [c.tier]),
        pool: poolLabel(c, t),
        range: rangeLabel(c.ranges),
      }),
    );
  }
  if (info.profileExact === false) {
    lines.push(t("ppz.desecration.profile_guessed"));
  }
  return lines.join("\n");
}
