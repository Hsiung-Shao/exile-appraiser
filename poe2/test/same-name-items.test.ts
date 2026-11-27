import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init, ITEM_BY_TRANSLATED } from "@/assets/data";
import { parseClipboard } from "@/parser";

/**
 * 2026-11-27 同類掃描:同一個繁中名對到好幾個英文物品時,名稱索引的二分搜尋只落到其中一筆,其他的查不到。
 * 改成收齊同名的每一筆,讓後面的步驟(傳奇底材、disc)有得挑。
 * 還分不出來、維持資料順序第一個的:絕望 = Despair(技能)/ Desperation(輔助)(解析器沒保留物品種類那行)、
 * 目眩 = Daze / Dazzle、湧升流 I = Upwelling I / II(GGPK 本身同字)、緊繃十字弓 = Taut / Tense Crossbow(非傳奇,缺底材數值)。
 */
beforeAll(async () => {
  setupTests({ language: "cmn-Hant" });
  await init("cmn-Hant");
});

describe("同名物品查詢收齊每一筆", () => {
  for (const [ns, name, refs] of [
    ["GEM", "絕望", ["Despair", "Desperation"]],
    ["GEM", "目眩", ["Daze", "Dazzle"]],
    ["GEM", "湧升流 I", ["Upwelling I", "Upwelling II"]],
    ["ITEM", "緊繃十字弓", ["Taut Crossbow", "Tense Crossbow"]],
  ] as const) {
    it(`${name} → ${refs.join(" / ")}`, () => {
      expect(ITEM_BY_TRANSLATED(ns, name)?.map((x) => x.refName).sort()).toEqual([...refs].sort());
    });
  }

  it("傳奇十字弓(壁壘猛禽)的底材 緊繃十字弓 只留 Tense Crossbow 那個變體", () => {
    const text = ["物品種類: 十字弓", "稀有度: 傳奇", "壁壘猛禽", "緊繃十字弓", "--------", "物品等級: 80"].join("\r\n") + "\r\n";
    const r = parseClipboard(text);
    if (r.isErr()) throw new Error(String(r.error));
    // infoVariants 只在解析狀態上(parser-fixtures 也這樣讀)
    const variants = (r.value as unknown as { infoVariants: Array<{ unique?: { base: string } }> }).infoVariants;
    expect(variants.map((x) => x.unique?.base)).toEqual(["Tense Crossbow"]);
  });
});
