import {
  ITEM_BY_REF,
  ITEM_BY_TRANSLATED,
  TRADE_ITEM_BY_REF,
} from "@/assets/data";
// exile-appraiser: AppConfig().language → hostOptions().language(見 ./host-options.ts)
import { hostOptions } from "./host-options";

export function magicBasetype(name: string) {
  let separator = " ";
  if (hostOptions().language === "cmn-Hant") {
    separator = /[\u4e00-\u9fa5]/.test(name) ? "" : " ";
  }
  const words = name.split(separator);

  // exile-appraiser:每個候選記下它在名稱裡的結束位置,給下面的「位置優先序」用。
  const perm: Array<{ name: string; rank: number }> = words.flatMap(
    (_, start) =>
      Array(words.length - start)
        .fill(undefined)
        .map((_, idx) => ({
          name: words.slice(start, start + idx + 1).join(separator),
          rank: anchorRank(words, start + idx + 1, separator),
        })),
  );

  const result = perm
    .map(({ name, rank }) => {
      // BUG[UPSTREAM]: https://www.pathofexile.com/forum/view-thread/3913283
      const result =
        ITEM_BY_REF("ITEM", name) ?? ITEM_BY_TRANSLATED("ITEM", name);
      // TRADE_ITEM_BY_REF({ name }, true);
      if (result) {
        return {
          name,
          rank,
          found: result && result[0].craftable,
          tradeItem: false,
        };
      }
      const tradeResult = TRADE_ITEM_BY_REF({ name }, true);
      return {
        name,
        rank,
        found: tradeResult && tradeResult[0].craftable,
        tradeItem: true,
      };
    })
    .filter((res) => res.found)
    .sort(
      (a, b) =>
        // exile-appraiser:位置優先序先比,再照上游(非交易站資料優先、越長越優先)
        (b.rank - a.rank) * 1_000_000 +
        b.name.length -
        a.name.length +
        (b.tradeItem ? 0 : 100_000) -
        (a.tradeItem ? 0 : 100_000),
    );

  return result.length ? result[0].name : undefined;
}

/**
 * exile-appraiser:候選在魔法物品名稱裡的位置優先序(越大越優先;同級才比長度)。
 *
 * 上游只比長度,同長時取先出現的,於是詞綴名裡含另一個物品名時會把它當成底材:
 * 繁中「昇華的幻像異界之譫妄碑牌」→「幻像異界」(後綴 `of the Simulacrum` 裡的碎片名,
 * 與「譫妄碑牌」同為 4 字、先出現)。魔法物品名的組成:
 * - 繁中 `{前綴}{後綴}{底材}`(無分隔)→ 底材必定在**名稱結尾**:結尾的候選 = 1,其餘 0。
 * - 英文 `{前綴} {底材} {後綴}`,後綴以 `of` 開頭 → 底材緊接在 `of` 之前(= 2);
 *   沒有後綴時底材在結尾(= 1);其餘(整段落在前綴裡或 `of …` 片語裡)0。
 *   魔法可出的底材名本身都不含 ` of `(`scripts/scan-magic-name-collisions.mjs` 有檢查)。
 * 沒有任何高優先的候選時,結果與上游相同。
 */
function anchorRank(words: string[], end: number, separator: string): number {
  if (separator === "") return end === words.length ? 1 : 0;
  if (words[end] === "of") return 2;
  return end === words.length ? 1 : 0;
}
