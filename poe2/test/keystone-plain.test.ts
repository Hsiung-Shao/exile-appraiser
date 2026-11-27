import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init } from "@/assets/data";
import { tryParseTranslation } from "@/parser/stat-translations";
import { ModifierType } from "@/parser/modifiers";

/**
 * 2026-11-27 同類掃描:隨機基石詞綴 `#(Ancestral Bond-Zealot's Oath)` 的寫法是「基石名」+ 進階寫法「基石名(範圍)」,
 * 索引把一般句也收進去,跟獨立的基石詞綴(Blood Magic 等)同字 → 6 個基石被解析成隨機基石那條、送錯 id,中英查詢不同。
 * 一般句只在沒被別條詞綴佔用時才進索引(與 PoE1 相同);隨機基石的進階寫法仍要認得。
 */
beforeAll(async () => {
  setupTests({ language: "en" });
  await init("en");
});

const parse = (line: string) =>
  tryParseTranslation({ string: line, unscalable: false }, ModifierType.Explicit, undefined)?.stat.ref;

describe("基石名一般句解析成獨立基石詞綴", () => {
  for (const name of ["Blood Magic", "Giant's Blood", "Iron Reflexes", "Glancing Blows", "Pain Attunement", "Eldritch Battery", "Vaal Pact"]) {
    it(`${name} → 自己那條`, () => {
      expect(parse(name)).toBe(name);
    });
  }
  it("進階寫法帶範圍 → 隨機基石那條", () => {
    expect(parse("Blood Magic(Ancestral Bond-Zealot's Oath)")).toBe("#(Ancestral Bond-Zealot's Oath)");
  });
});
