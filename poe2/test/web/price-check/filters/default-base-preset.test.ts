import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import { createPresets, createTradeRequest } from "../../../../src/index";
import { setupTests } from "../../../vitest.setup";

// 2026-10-15 使用者裁定(與 EE2 不同):有「底材」preset 的物品預設切到它(查該底材,不查類別);與 PoE1 一致
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

describe("PoE2 有底材 preset 時預設查底材", () => {
  it("稀有奢華便鞋物等 80 預設底材 preset、查 type", () => {
    const r = build(BOOTS(80));
    expect(r.presets.map((p) => p.id)).toEqual([
      "filters.preset_pseudo",
      "filters.preset_base_item",
    ]);
    expect(r.active).toBe("filters.preset_base_item");
    expect(r.query.type).toBe("Luxurious Slippers");
  });

  it("魔法藍玉戒指物等 80 預設底材 preset、查 type", () => {
    const r = build(RING_MAGIC);
    expect(r.active).toBe("filters.preset_base_item");
    expect(r.query.type).toBe("Sapphire Ring");
  });

  it("物等過低的稀有便鞋沒有底材 preset、維持查類別", () => {
    const r = build(BOOTS(40));
    expect(r.presets.map((p) => p.id)).toEqual(["filters.preset_pseudo"]);
    expect(r.active).toBe("filters.preset_pseudo");
    expect(r.query.type).toBeUndefined();
  });

  it("已汙染(成品)的高物等便鞋維持查類別", () => {
    const r = build(BOOTS(80, "--------\nCorrupted\n"));
    expect(r.presets.map((p) => p.id)).toEqual(["filters.preset_pseudo"]);
    expect(r.active).toBe("filters.preset_pseudo");
    expect(r.query.type).toBeUndefined();
  });
});
