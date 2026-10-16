import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import type { ParsedItem } from "@/parser/ParsedItem";
import { createPresets, createTradeRequest } from "../../../../src/index";
import {
  FilterTag,
  type FilterPreset,
  type StatFilter,
} from "@/web/price-check/filters/interfaces";
import { setupTests } from "../../../vitest.setup";

// 查價面板「一般 / 工藝」二選一(PoE2):工藝來源的詞綴列可改送 crafted stat id,切回一般送回 explicit id。
// 新模組 crafted-toggle 用動態 import:還沒實作時呈現為斷言失敗,不讓整檔載入失敗。
const MOD_PATH = "@/web/price-check/filters/crafted-toggle";
async function loadToggle(): Promise<any> {
  try {
    return await import(/* @vite-ignore */ MOD_PATH);
  } catch {
    return null;
  }
}
async function toggleMod(): Promise<any> {
  const m = await loadToggle();
  expect(m?.canToggleCrafted, "crafted-toggle 模組尚未提供 canToggleCrafted").toBeTypeOf("function");
  expect(m?.selectCraftedMode, "crafted-toggle 模組尚未提供 selectCraftedMode").toBeTypeOf("function");
  return m;
}

const OPTS = {
  league: "Standard",
  realm: "intl" as const,
  clientLanguage: "cmn-Hant" as const,
  searchStatRange: 10,
  currency: null,
  collapseListings: "api" as const,
  activateStockFilter: false,
  merchantOnly: false,
};

// 使用者實際物品(繁中進階格式):第四條是工藝詞綴
const JEWEL = `物品種類: 珠寶
稀有度: 稀有
海怪 裂毀者
藍寶石
--------
物品等級: 80
--------
{ 前綴 "專注的"(階層：1) — 能量護盾 }
增加36(30-50)%來自已裝備法器的能量護盾
{ 前綴 "麻木的"(階層：1) — 傷害,元素,冰冷 }
傷害穿透5(5-10)%冰冷抗性
{ 後綴 "強力之"(階層：1) — 傷害,暴擊 }
增加14(10-20)%暴擊傷害加成
{ 已工藝 後綴 "奪位之"(階層：1) — 傷害,法術,暴擊 }
增加20(10-20)%法術暴擊傷害加成
--------
放置到一個天賦樹的珠寶插槽中以產生效果。右鍵點擊以移出插槽。
--------
備註: ~b/o 28 chaos
`;
const JEWEL_CORRUPTED = JEWEL.replace(
  "--------\n備註:",
  "--------\n已汙染\n--------\n備註:",
);
// 另加一條工藝火焰抗性:只被偽屬性「總元素抗性」合計吃掉(可見的 pseudo 列,來源全是工藝)
const JEWEL_CRAFTED_RES = JEWEL.replace(
  "增加20(10-20)%法術暴擊傷害加成\n",
  '增加20(10-20)%法術暴擊傷害加成\n{ 已工藝 後綴 "火焰之"(階層：1) — 元素,火焰,抗性 }\n+20(10-20)%火焰抗性\n',
);

const SPELL_CRIT = "#% increased Critical Spell Damage Bonus";
const EXPLICIT_ID = "explicit.stat_274716455";
const CRAFTED_ID = "crafted.stat_274716455";

function parse(text: string): ParsedItem {
  const r = parseClipboard(text);
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`);
  return r.value;
}
function build(text: string) {
  const item = parse(text);
  const { presets, active } = createPresets(item, OPTS);
  const preset: FilterPreset = presets.find((p) => p.id === active) ?? presets[0];
  const stats = preset.stats as StatFilter[];
  const visible = stats.filter((f) => f.hidden == null);
  const spellCrit = visible.find(
    (f) => f.statRef === SPELL_CRIT && f.tag === FilterTag.Explicit,
  )!;
  return { item, preset, stats, visible, spellCrit };
}
const sentFilters = (item: ParsedItem, preset: FilterPreset): any[] =>
  (createTradeRequest(preset, item).query.stats as any[]).flatMap(
    (g) => g.filters,
  );

beforeAll(async () => {
  setupTests({ language: "cmn-Hant" });
  await init("cmn-Hant");
});

describe("PoE2 一般 / 工藝二選一", () => {
  it("前提:工藝詞綴併成可見 explicit 列並有隱藏的 crafted 孿生", () => {
    const { stats, spellCrit } = build(JEWEL);
    expect(spellCrit?.tradeId).toEqual([EXPLICIT_ID]);
    const twin = stats.find((f) => f.tag === FilterTag.Crafted && f.statRef === SPELL_CRIT);
    expect(twin?.tradeId).toEqual([CRAFTED_ID]);
    expect(twin?.hidden).toBe("filters.hide_for_crafting");
  });

  it("K1 工藝來源的法術暴擊列可切換", async () => {
    const m = await toggleMod();
    expect(m.canToggleCrafted(build(JEWEL).spellCrit)).toBe(true);
  });

  it("K2 隨機詞綴的三條可見列不可切換", async () => {
    const m = await toggleMod();
    const { visible, spellCrit } = build(JEWEL);
    const others = visible.filter((f) => f !== spellCrit && f.tag === FilterTag.Explicit);
    expect(others).toHaveLength(3);
    for (const f of others) expect(m.canToggleCrafted(f)).toBe(false);
  });

  it("K3 預設為一般,查詢送 explicit id 且 crafted id 若出現必為未勾選", async () => {
    const m = await toggleMod();
    const { item, preset, spellCrit } = build(JEWEL);
    expect(m.craftedMode(spellCrit)).toBe("normal");
    const sent = sentFilters(item, preset);
    expect(sent.map((f) => f.id)).toContain(EXPLICIT_ID);
    for (const f of sent.filter((f) => f.id === CRAFTED_ID)) expect(f.disabled).toBe(true);
  });

  it("K4 選工藝後該列改送 crafted id 並勾選,孿生取消勾選", async () => {
    const m = await toggleMod();
    const { item, preset, stats, spellCrit } = build(JEWEL);
    const twin = stats.find((f) => f !== spellCrit && f.tag === FilterTag.Crafted && f.statRef === SPELL_CRIT)!;
    twin.disabled = false;
    m.selectCraftedMode(stats, spellCrit, "crafted");
    expect(spellCrit.tradeId).toEqual([CRAFTED_ID]);
    expect(spellCrit.disabled).toBe(false);
    expect(twin.disabled).toBe(true);
    expect(m.craftedMode(spellCrit)).toBe("crafted");
    const enabled = sentFilters(item, preset).filter((f) => f.id === CRAFTED_ID && !f.disabled);
    expect(enabled).toHaveLength(1);
  });

  it("K5 選工藝後切回一般送回 explicit id", async () => {
    const m = await toggleMod();
    const { item, preset, stats, spellCrit } = build(JEWEL);
    m.selectCraftedMode(stats, spellCrit, "crafted");
    m.selectCraftedMode(stats, spellCrit, "normal");
    expect(spellCrit.tradeId).toEqual([EXPLICIT_ID]);
    expect(m.craftedMode(spellCrit)).toBe("normal");
    // 2026-10-16 一般會另加 not 群組排除工藝版本(K10),這裡只看 not 以外的群組
    const positive = (createTradeRequest(preset, item).query.stats as any[])
      .filter((g) => g.type !== "not")
      .flatMap((g) => g.filters);
    expect(positive.filter((f) => f.id === CRAFTED_ID && !f.disabled)).toHaveLength(0);
  });

  it("K6 已汙染物品沒有孿生,可見列仍可切換並改送 crafted id", async () => {
    const m = await toggleMod();
    const { stats, spellCrit } = build(JEWEL_CORRUPTED);
    expect(stats.some((f) => f.tag === FilterTag.Crafted)).toBe(false);
    expect(m.canToggleCrafted(spellCrit)).toBe(true);
    m.selectCraftedMode(stats, spellCrit, "crafted");
    expect(spellCrit.tradeId).toEqual([CRAFTED_ID]);
    expect(spellCrit.disabled).toBe(false);
  });

  it("K7 來源全是工藝的偽屬性合計列不給工藝切換", async () => {
    const m = await toggleMod();
    const { visible } = build(JEWEL_CRAFTED_RES);
    const pseudo = visible.find((f) => f.tag === FilterTag.Pseudo && f.statRef === "#% total Elemental Resistance");
    expect(pseudo, "工藝火焰抗性應被可見的總元素抗性 pseudo 列吃掉").toBeDefined();
    expect(pseudo!.sources.every((s) => s.modifier.info.type === "crafted")).toBe(true);
    expect(m.canToggleCrafted(pseudo)).toBe(false);
  });
});

// 使用者實機回報(PoE2 交易站 explicit id 也命中工藝):一般模式勾選時要以 not 群組排除這條的工藝版本
const statGroups = (item: ParsedItem, preset: FilterPreset): any[] =>
  createTradeRequest(preset, item).query.stats as any[];
const notGroups = (groups: any[]) => groups.filter((g) => g.type === "not");
const notCraftedGroups = (groups: any[]) =>
  notGroups(groups).filter((g) => (g.filters as any[]).some((f) => f.id === CRAFTED_ID));

describe("PoE2 一般模式排除工藝版本", () => {
  it("K10 一般且勾選時以 not 群組排除這條的工藝版本", async () => {
    const m = await toggleMod();
    const { item, preset, spellCrit } = build(JEWEL);
    expect(m.craftedMode(spellCrit)).toBe("normal");
    spellCrit.disabled = false;
    const groups = statGroups(item, preset);
    const and = groups.find((g) => g.type === "and");
    expect(and.filters).toContainEqual(expect.objectContaining({ id: EXPLICIT_ID }));
    expect(and.filters.find((f: any) => f.id === EXPLICIT_ID).disabled).not.toBe(true);
    const nots = notCraftedGroups(groups);
    expect(nots).toHaveLength(1);
    expect(nots[0].disabled).not.toBe(true);
    expect(nots[0].filters).toEqual([expect.objectContaining({ id: CRAFTED_ID })]);
    expect(nots[0].filters[0].disabled).not.toBe(true);
  });

  it("K11 一般但未勾選時不加 not 群組", async () => {
    const m = await toggleMod();
    const { item, preset, spellCrit } = build(JEWEL);
    expect(m.craftedMode(spellCrit)).toBe("normal");
    expect(spellCrit.disabled).toBe(true);
    const groups = statGroups(item, preset);
    expect(notCraftedGroups(groups)).toHaveLength(0);
    const enabledCrafted = groups
      .filter((g) => !g.disabled)
      .flatMap((g) => g.filters)
      .filter((f: any) => f.id === CRAFTED_ID && !f.disabled);
    expect(enabledCrafted).toHaveLength(0);
  });

  it("K12 選工藝時不加排除工藝的 not 群組", async () => {
    const m = await toggleMod();
    const { item, preset, stats, spellCrit } = build(JEWEL);
    m.selectCraftedMode(stats, spellCrit, "crafted");
    expect(spellCrit.disabled).toBe(false);
    expect(notCraftedGroups(statGroups(item, preset))).toHaveLength(0);
  });

  it("K13 隨機詞綴列勾選時不產生任何 not 群組", async () => {
    await toggleMod();
    const { item, preset, visible, spellCrit } = build(JEWEL);
    const others = visible.filter((f) => f !== spellCrit && f.tag === FilterTag.Explicit);
    expect(others).toHaveLength(3);
    for (const f of others) f.disabled = false;
    expect(spellCrit.disabled).toBe(true);
    expect(notGroups(statGroups(item, preset))).toHaveLength(0);
  });
});
