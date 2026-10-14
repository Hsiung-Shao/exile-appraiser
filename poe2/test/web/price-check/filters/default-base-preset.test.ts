import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import { createPresets, createTradeRequest } from "../../../../src/index";
import { setupTests } from "../../../vitest.setup";
import * as fs from "node:fs";
import * as path from "node:path";
import { FIXTURES_DIR } from "../../../zhTW/helpers/fixture-harness";

// 2026-10-15 使用者裁定(與 EE2 不同,與 PoE1 一致):魔法 / 稀有的武器 / 防具 / 飾品 / 箭袋預設仍是 pseudo preset,但搜尋改查該底材 type(不查類別),不看物等
const OPTS = {
  league: "Standard",
  realm: "intl" as const,
  clientLanguage: "en" as const,
  searchStatRange: 10,
  currency: null,
  collapseListings: "api" as const,
  activateStockFilter: false,
  merchantOnly: false,
};

const BOOTS = (ilvl: number, extra = "") => `Item Class: Boots
Rarity: Rare
Grim Trek
Luxurious Slippers
--------
Energy Shield: 120
--------
Requires: Level 70, 58 Int
--------
Item Level: ${ilvl}
--------
{ Prefix Modifier "Cheetah's" (Tier: 2) — Speed }
30% increased Movement Speed
{ Suffix Modifier "of the Typhoon" (Tier: 3) — Elemental, Lightning, Resistance }
+35(31-35)% to Lightning Resistance
${extra}`;

const RING_MAGIC = `Item Class: Rings
Rarity: Magic
Sapphire Ring of the Typhoon
--------
Requires: Level 60
--------
Item Level: 80
--------
{ Implicit Modifier — Elemental, Cold, Resistance }
+25(20-30)% to Cold Resistance (implicit)
--------
{ Suffix Modifier "of the Typhoon" (Tier: 3) — Elemental, Lightning, Resistance }
+35(31-35)% to Lightning Resistance
`;

function build(text: string) {
  const item = parseClipboard(text)._unsafeUnwrap();
  const { presets, active } = createPresets(item, OPTS);
  const preset = presets.find((p) => p.id === active)!;
  const query = createTradeRequest(preset, item).query;
  return { presets, active, query };
}

beforeAll(async () => {
  setupTests({ language: "en" });
  await init("en");
});

const JEWEL_RARE = fs
  .readFileSync(path.join(FIXTURES_DIR, "en", "jewel-rare-01.txt"), "utf8")
  .split(String.fromCharCode(13))
  .join("");
const category = (q: any) => q.filters.type_filters?.filters.category?.option;

describe("PoE2 魔法 / 稀有底材預設查該底材(preset 不變)", () => {
  it("稀有奢華便鞋物等 80 預設 pseudo、查 type 不查類別", () => {
    const r = build(BOOTS(80));
    expect(r.presets.map((p) => p.id)).toEqual([
      "filters.preset_pseudo",
      "filters.preset_base_item",
    ]);
    expect(r.active).toBe("filters.preset_pseudo");
    expect(r.query.type).toBe("Luxurious Slippers");
    expect(category(r.query)).toBeUndefined();
  });

  it("魔法藍玉戒指預設 pseudo、查 type 不查類別", () => {
    const r = build(RING_MAGIC);
    expect(r.active).toBe("filters.preset_pseudo");
    expect(r.query.type).toBe("Sapphire Ring");
    expect(category(r.query)).toBeUndefined();
  });

  it("物等過低的稀有便鞋同樣查 type(不看物等)", () => {
    const r = build(BOOTS(40));
    expect(r.presets.map((p) => p.id)).toEqual(["filters.preset_pseudo"]);
    expect(r.query.type).toBe("Luxurious Slippers");
    expect(category(r.query)).toBeUndefined();
  });

  it("已汙染(成品)便鞋維持 pseudo、同樣查 type", () => {
    const r = build(BOOTS(80, "--------\nCorrupted\n"));
    expect(r.presets.map((p) => p.id)).toEqual(["filters.preset_pseudo"]);
    expect(r.query.type).toBe("Luxurious Slippers");
  });

  it("稀有珠寶不動、維持查類別", () => {
    const r = build(JEWEL_RARE);
    expect(r.query.type).toBeUndefined();
    expect(category(r.query)).toBeDefined();
  });
});
