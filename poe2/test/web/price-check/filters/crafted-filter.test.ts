import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import { ModifierType } from "@/parser/modifiers";
import { createPresets, createTradeRequest } from "../../../../src/index";
import { setupTests } from "../../../vitest.setup";
import { FIXTURES_DIR } from "../../../zhTW/helpers/fixture-harness";

// 查價面板「排除工藝詞綴」(PoE2):稀有 / 魔法、可工藝類別、本身沒有工藝詞綴時才有 filters.craftedMods(預設 disabled = 不排除)
const CRAFTED_ID = "pseudo.pseudo_number_of_crafted_mods";

function opts(realm: "intl" | "tw" = "intl") {
  return {
    league: "Standard",
    realm,
    clientLanguage: "en" as const,
    searchStatRange: 10,
    currency: null,
    collapseListings: "api" as const,
    activateStockFilter: false,
    merchantOnly: false,
  };
}

const fixture = (name: string) =>
  fs
    .readFileSync(path.join(FIXTURES_DIR, "en", `${name}.txt`), "utf8")
    .split(String.fromCharCode(13))
    .join("");

const BOOTS_RARE = `Item Class: Boots
Rarity: Rare
Grim Trek
Luxurious Slippers
--------
Energy Shield: 120
--------
Requires: Level 70, 58 Int
--------
Item Level: 80
--------
{ Prefix Modifier "Cheetah's" (Tier: 2) — Speed }
30% increased Movement Speed
{ Suffix Modifier "of the Typhoon" (Tier: 3) — Elemental, Lightning, Resistance }
+35(31-35)% to Lightning Resistance
`;

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

const BOOTS_NORMAL = `Item Class: Boots
Rarity: Normal
Luxurious Slippers
--------
Energy Shield: 120
--------
Requires: Level 70, 58 Int
--------
Item Level: 80
`;

function parse(text: string) {
  const parsed = parseClipboard(text);
  if (parsed.isErr()) throw new Error(String(parsed.error));
  return parsed.value;
}

function build(text: string, realm: "intl" | "tw" = "intl") {
  const item = parse(text);
  const { presets, active } = createPresets(item, opts(realm));
  const preset = presets.find((p) => p.id === active)!;
  return { item, preset, filters: preset.filters as any };
}

function andFilters(query: any): any[] {
  const and = (query.stats as any[]).find((g) => g.type === "and");
  return and ? and.filters : [];
}
const allStatIds = (query: any): string[] =>
  (query.stats as any[]).flatMap((g) => g.filters.map((f: any) => f.id));

beforeAll(async () => {
  setupTests({ language: "en" });
  await init("en");
});

describe("PoE2 排除工藝詞綴篩選", () => {
  it("C5 無工藝稀有靴子提供排除切換且預設不排除", () => {
    expect(build(BOOTS_RARE).filters.craftedMods).toEqual({ disabled: true });
  });

  it("C5 魔法戒指也提供切換且預設不排除", () => {
    expect(build(RING_MAGIC).filters.craftedMods).toEqual({ disabled: true });
  });

  it("C2 預設不排除時查詢不含工藝數量條件", () => {
    const { item, preset } = build(BOOTS_RARE);
    const query = createTradeRequest(preset, item).query;
    expect(allStatIds(query)).not.toContain(CRAFTED_ID);
  });

  it("C8 稀有靴子切成排除後查詢加上工藝數量上限 0", () => {
    const { item, preset, filters } = build(BOOTS_RARE);
    expect(filters.craftedMods).toBeDefined();
    filters.craftedMods.disabled = false;
    const query = createTradeRequest(preset, item).query;
    expect(andFilters(query)).toContainEqual(
      expect.objectContaining({ id: CRAFTED_ID, value: { max: 0 } }),
    );
    expect(allStatIds(query).filter((id) => id === CRAFTED_ID)).toHaveLength(1);
  });

  it("C4 物品本身有工藝詞綴時不提供切換", () => {
    // boots-rare-luxurious-slippers-01 帶 Crafted Prefix Modifier;先確認 parser 認出工藝詞綴,避免假綠
    const text = fixture("boots-rare-luxurious-slippers-01");
    expect(parse(text).newMods.some((m) => m.info.type === ModifierType.Crafted)).toBe(true);
    expect(build(text).filters.craftedMods).toBeUndefined();
  });

  it("C6 普通靴子不提供切換", () => {
    expect(build(BOOTS_NORMAL).filters.craftedMods).toBeUndefined();
  });

  it("C6 傳奇戒指不提供切換", () => {
    expect(build(fixture("ring-unique-cracklecreep-01")).filters.craftedMods).toBeUndefined();
  });

  it("C6 通貨不提供切換", () => {
    expect(build(fixture("currency-01")).filters.craftedMods).toBeUndefined();
  });

  it("C7 稀有換界石不提供切換", () => {
    expect(build(fixture("waystone-rare-01")).filters.craftedMods).toBeUndefined();
  });

  it("C7 魔法碑牌不提供切換", () => {
    expect(build(fixture("tablet-delirium-magic-01")).filters.craftedMods).toBeUndefined();
  });

  it("C9 台服切成排除後查詢帶相同工藝數量 id", () => {
    const { item, preset, filters } = build(BOOTS_RARE, "tw");
    expect(filters.craftedMods).toEqual({ disabled: true });
    filters.craftedMods.disabled = false;
    const query = createTradeRequest(preset, item).query;
    expect(andFilters(query)).toContainEqual(
      expect.objectContaining({ id: CRAFTED_ID, value: { max: 0 } }),
    );
  });
});
