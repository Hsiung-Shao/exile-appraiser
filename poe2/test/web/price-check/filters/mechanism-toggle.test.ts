import { beforeAll, describe, expect, it } from "vitest";
import { init, STAT_BY_REF } from "@/assets/data";
import { parseClipboard } from "@/parser";
import type { ParsedItem } from "@/parser/ParsedItem";
import { ModifierType } from "@/parser/modifiers";
import { createPresets, createTradeRequest } from "../../../../src/index";
import {
  FilterTag,
  type FilterPreset,
  type StatFilter,
} from "@/web/price-check/filters/interfaces";
import { setupTests } from "../../../vitest.setup";

// 查價面板「詞綴全部列出 + 統一機制選擇」(PoE2,計畫 rustling-shimmying-charm M1–M4、M6–M10、M15–M17)。
// 2026-10-16 契約變更:「一般」只排除這列來源本身的機制(破裂 / 工藝 / 褻瀆),符文永不排除、一般隨機列不排除。
// 取代 crafted-toggle.test.ts(K4 → M8 工藝、K10–K12 → M9)。
// 新模組 mechanism-toggle 用動態 import:還沒實作時呈現為斷言失敗,不讓整檔載入失敗。
const MOD_PATH = "@/web/price-check/filters/mechanism-toggle";
async function mech(): Promise<any> {
  let m: any = null;
  try {
    m = await import(/* @vite-ignore */ MOD_PATH);
  } catch {
    m = null;
  }
  for (const fn of ["mechanismOptions", "mechanismMode", "selectMechanism"])
    expect(m?.[fn], `mechanism-toggle 模組尚未提供 ${fn}`).toBeTypeOf("function");
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

// 使用者物品(2026-10-16 回報):防禦詞綴被併進護甲 / 閃避、抗性與生命被偽屬性吃掉、工藝火焰抗性只剩孿生、符文詞綴被藏
const CHEST = `物品種類: 胸甲
稀有度: 稀有
末日的 真實之衛
惡徒護甲
--------
品質: +9% (augmented)
護甲值: 558 (augmented)
閃避值: 511 (augmented)
--------
需求: 等級 65, 67 力量, 67 敏捷
--------
插槽: S S
--------
物品等級: 82
--------
增加36%護甲值、閃避和能量護盾 (rune)
--------
{ 固定詞綴 — 生命 }
+72(60-80)最大生命
--------
{ 前綴 "運動員的"(階層：5) — 生命 }
+139(120-149)最大生命
{ 前綴 "淑女的"(階層：8) }
+31(30-33)精魂
{ 前綴 "老兵的"(階層：4) — 護甲,閃避 }
+17(17-23)護甲值
+17(15-21)閃避值
增加24(21-26)%護甲值和閃避
{ 後綴 "北極熊之"(階層：3) — 元素,冰冷,抗性 }
+34(31-35)%冰冷抗性
{ 後綴 "電之"(階層：2) — 元素,閃電,抗性 }
+40(36-40)%閃電抗性
{ 已工藝 後綴 "火山之"(階層：3) — 元素,火焰,抗性 }
+34(31-35)%火焰抗性
`;

// 上一輪的使用者珠寶:第四條是工藝詞綴(可見 explicit 列 + 隱藏 crafted 孿生)
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

// 胸甲改造:冰冷抗性改褻瀆、閃電抗性改破裂(+ 破裂之物),三種機制來源各一列
const CHEST_MIXED =
  CHEST.replace('{ 後綴 "北極熊之"', '{ 已褻瀆 後綴 "北極熊之"').replace(
    '{ 後綴 "電之"',
    '{ 已破裂 後綴 "電之"',
  ) + "--------\n破裂之物\n";

// 魔法鞋:移動速度 + 閃電抗性 + 閃電抗性符文(魔法物品 base_item preset 預設全勾)
const BOOTS_MAGIC = `物品種類: 鞋子
稀有度: 魔法
獵豹的 奢華便鞋 颱風之
--------
能量護盾: 120
--------
需求: 等級 70, 58 智慧
--------
插槽: S
--------
物品等級: 80
--------
+18%閃電抗性 (rune)
--------
{ 前綴 "獵豹的"(階層：2) — 速度 }
增加30%移動速度
{ 後綴 "颱風之"(階層：3) — 元素,閃電,抗性 }
+35(31-35)%閃電抗性
`;

const LIFE = "# to maximum Life";
const COLD = "#% to Cold Resistance";
const LIGHTNING = "#% to Lightning Resistance";
const FIRE = "#% to Fire Resistance";
const SPIRIT = "# to Spirit";
const ARMOUR = "# to Armour";
const EVASION = "# to Evasion Rating";
const AR_EV = "#% increased Armour and Evasion";
const RUNE_STAT = "#% increased Armour, Evasion and Energy Shield";
const SPELL_CRIT = "#% increased Critical Spell Damage Bonus";
const ids = (mech: string, n: string) => `${mech}.stat_${n}`;
const N = {
  life: "3299347043",
  cold: "4220027924",
  lightning: "1671376347",
  fire: "3372524247",
  spellCrit: "274716455",
};

function parse(text: string): ParsedItem {
  const r = parseClipboard(text);
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`);
  return r.value;
}
function build(text: string) {
  const item = parse(text);
  const { presets, active } = createPresets(item, OPTS);
  const preset: FilterPreset =
    presets.find((p) => p.id === active) ?? presets[0];
  const stats = preset.stats as StatFilter[];
  return { item, preset, stats };
}
/** 某詞綴來源類型的列(不含 pseudo / property / 機制孿生);visible = 只找可見列 */
function row(
  stats: StatFilter[],
  ref: string,
  srcType: ModifierType = ModifierType.Explicit,
  visible = false,
): StatFilter | undefined {
  return stats.find(
    (f) =>
      f.statRef === ref &&
      f.tag !== FilterTag.Pseudo &&
      f.tag !== FilterTag.Property &&
      f.hidden !== "filters.hide_for_crafting" &&
      (!visible || f.hidden == null) &&
      f.sources.length > 0 &&
      f.sources.every((s) => s.modifier.info.type === srcType),
  );
}
/** 機制孿生:tag crafted、hide_for_crafting 的隱藏列 */
const twinOf = (stats: StatFilter[], ref: string, self: StatFilter) =>
  stats.find(
    (f) =>
      f !== self &&
      f.statRef === ref &&
      f.tag === FilterTag.Crafted &&
      f.hidden === "filters.hide_for_crafting",
  );

const queryGroups = (item: ParsedItem, preset: FilterPreset): any[] =>
  createTradeRequest(preset, item).query.stats as any[];
const sentIds = (groups: any[]): string[] =>
  groups.flatMap((g) => g.filters.map((f: any) => f.id));
const enabledIds = (groups: any[]): string[] =>
  groups
    .filter((g) => !g.disabled && g.type !== "not")
    .flatMap((g) =>
      g.filters.filter((f: any) => !f.disabled).map((f: any) => f.id),
    );
const notGroups = (groups: any[]) => groups.filter((g) => g.type === "not");
const notIds = (groups: any[]): string[] =>
  notGroups(groups).flatMap((g) => g.filters.map((f: any) => f.id));

beforeAll(async () => {
  setupTests({ language: "cmn-Hant" });
  await init("cmn-Hant");
});

describe("A 詞綴全部列出(PoE2 胸甲)", () => {
  it("M1 被偽屬性吃掉的生命、冰冷、閃電抗性各有可見未勾選的列並標 fromAggregate", () => {
    const { stats } = build(CHEST);
    for (const ref of [LIFE, COLD, LIGHTNING]) {
      const f = row(stats, ref, ModifierType.Explicit, true);
      expect(f, `${ref} 應有自己的可見列`).toBeDefined();
      expect(f!.disabled).toBe(true);
      expect((f as any).fromAggregate).toBe(true);
    }
  });

  it("M1 工藝火焰抗性有可見未勾選的列,孿生仍隱藏", () => {
    const { stats } = build(CHEST);
    const fire = row(stats, FIRE, ModifierType.Crafted, true);
    expect(fire, "工藝火焰抗性應有自己的可見列").toBeDefined();
    expect(fire!.disabled).toBe(true);
    for (const f of stats.filter(
      (f) => f !== fire && f.statRef === FIRE && f.tag === FilterTag.Crafted,
    ))
      expect(f.hidden).toBe("filters.hide_for_crafting");
  });

  it("M2 被護甲 / 閃避合計用掉的三個防禦詞綴可見且未勾選", () => {
    const { stats } = build(CHEST);
    for (const ref of [ARMOUR, EVASION, AR_EV]) {
      const f = row(stats, ref);
      expect(f, `${ref} 應有列`).toBeDefined();
      expect(f!.hidden, `${ref} 不應再以 hide_used_in_prop 隱藏`).toBeUndefined();
      expect(f!.disabled).toBe(true);
    }
  });

  it("M3 符文詞綴可見且未勾選", () => {
    const { stats } = build(CHEST);
    const f = row(stats, RUNE_STAT, ModifierType.Augment);
    expect(f).toBeDefined();
    expect(f!.hidden).toBeUndefined();
    expect(f!.disabled).toBe(true);
  });

  it("M4 預設查詢不送新列出的詞綴、偽屬性勾選照舊、沒有 not 群組", () => {
    const { item, preset, stats } = build(CHEST);
    const fresh = stats.filter((f) => (f as any).fromAggregate === true);
    expect(fresh.length, "應有 fromAggregate 新列").toBeGreaterThanOrEqual(3);
    const groups = queryGroups(item, preset);
    const sent = sentIds(groups);
    for (const n of [N.life, N.cold, N.lightning, N.fire])
      expect(sent).not.toContain(ids("explicit", n));
    const others = new Set(
      stats
        .filter((f) => (f as any).fromAggregate !== true)
        .flatMap((f) => f.tradeId),
    );
    for (const f of fresh)
      for (const id of f.tradeId)
        if (!others.has(id)) expect(sent).not.toContain(id);
    expect(enabledIds(groups)).toEqual(
      expect.arrayContaining([
        "pseudo.pseudo_total_elemental_resistance",
        "pseudo.pseudo_total_life",
      ]),
    );
    expect(notGroups(groups)).toHaveLength(0);
  });
});

describe("B 機制選項(PoE2)", () => {
  it("M6 精魂列依資料列出一般 / 破裂 / 工藝 / 褻瀆 / 增幅", async () => {
    const m = await mech();
    const { stats } = build(CHEST);
    expect(
      m.mechanismOptions(row(stats, SPIRIT, ModifierType.Explicit, true)),
    ).toEqual(["normal", "fractured", "crafted", "desecrated", "rune"]);
  });

  it("M6 生命與抗性列有全部五個選項", async () => {
    const m = await mech();
    const { stats } = build(CHEST);
    for (const ref of [LIFE, COLD, LIGHTNING]) {
      const f = row(stats, ref);
      expect(f, `${ref} 應有列`).toBeDefined();
      expect(m.mechanismOptions(f)).toEqual([
        "normal",
        "fractured",
        "crafted",
        "desecrated",
        "rune",
      ]);
    }
  });

  it("M6 沒有工藝 id 的護甲 / 閃避不列工藝,沒有增幅 id 的護甲閃避% 不列增幅", async () => {
    const m = await mech();
    const { stats } = build(CHEST);
    expect(m.mechanismOptions(row(stats, ARMOUR))).toEqual([
      "normal",
      "fractured",
      "desecrated",
      "rune",
    ]);
    expect(m.mechanismOptions(row(stats, EVASION))).toEqual([
      "normal",
      "fractured",
      "desecrated",
      "rune",
    ]);
    expect(m.mechanismOptions(row(stats, AR_EV))).toEqual([
      "normal",
      "fractured",
      "crafted",
      "desecrated",
    ]);
  });

  it("M6 珠寶法術暴擊列有一般 / 破裂 / 工藝 / 褻瀆", async () => {
    const m = await mech();
    const { stats } = build(JEWEL);
    expect(
      m.mechanismOptions(row(stats, SPELL_CRIT, ModifierType.Crafted, true)),
    ).toEqual(["normal", "fractured", "crafted", "desecrated"]);
  });

  it("M6 pseudo 列與只有 explicit id 的 stat 不給選項", async () => {
    const m = await mech();
    const { stats } = build(CHEST);
    const pseudo = stats.find(
      (f) => f.tag === FilterTag.Pseudo && f.hidden == null,
    )!;
    expect(m.mechanismOptions(pseudo)).toEqual([]);
    // 手造:把精魂列的 stat 換成只有 explicit id 的「# Strength Requirement」
    const base = row(stats, SPIRIT)!;
    const onlyRef = "# Strength Requirement";
    const only = STAT_BY_REF(onlyRef)!;
    expect(Object.keys(only.trade.ids)).toEqual(["explicit"]);
    const fake = {
      ...base,
      statRef: onlyRef,
      tradeId: [...only.trade.ids.explicit!],
      sources: base.sources.map((s) => ({
        ...s,
        stat: { ...s.stat, stat: only },
      })),
    } as StatFilter;
    expect(m.mechanismOptions(fake)).toEqual([]);
  });

  it("M7 有附魔 / 固定 id 的生命、抗性、精魂不列 enchant / implicit", async () => {
    const m = await mech();
    const { stats } = build(CHEST);
    for (const ref of [LIFE, COLD, SPIRIT]) {
      const f = row(stats, ref);
      expect(f, `${ref} 應有列`).toBeDefined();
      const opts = m.mechanismOptions(f) as string[];
      expect(opts.length).toBeGreaterThan(0);
      expect(opts).not.toContain("enchant");
      expect(opts).not.toContain("implicit");
    }
  });

  it("M6 預設模式:隨機詞綴列為一般", async () => {
    const m = await mech();
    const { stats } = build(CHEST);
    expect(m.mechanismMode(row(stats, SPIRIT))).toBe("normal");
    expect(m.mechanismMode(row(stats, LIFE))).toBe("normal");
  });
});

describe("M8 選機制改送對應 id(PoE2)", () => {
  it("M8 生命選褻瀆:改送 desecrated id 並勾選", async () => {
    const m = await mech();
    const { item, preset, stats } = build(CHEST);
    const life = row(stats, LIFE);
    expect(life, "生命應有列").toBeDefined();
    m.selectMechanism(stats, life, "desecrated");
    expect(life!.tradeId).toEqual([ids("desecrated", N.life)]);
    expect(life!.disabled).toBe(false);
    expect(m.mechanismMode(life)).toBe("desecrated");
    expect(enabledIds(queryGroups(item, preset))).toContain(
      ids("desecrated", N.life),
    );
  });

  it("M8 冰冷抗性選增幅、閃電抗性選破裂:各送對應 id", async () => {
    const m = await mech();
    const { item, preset, stats } = build(CHEST);
    const cold = row(stats, COLD);
    const lightning = row(stats, LIGHTNING);
    expect(cold, "冰冷抗性應有列").toBeDefined();
    expect(lightning, "閃電抗性應有列").toBeDefined();
    m.selectMechanism(stats, cold, "rune");
    m.selectMechanism(stats, lightning, "fractured");
    expect(cold!.tradeId).toEqual([ids("rune", N.cold)]);
    expect(lightning!.tradeId).toEqual([ids("fractured", N.lightning)]);
    const en = enabledIds(queryGroups(item, preset));
    expect(en).toContain(ids("rune", N.cold));
    expect(en).toContain(ids("fractured", N.lightning));
  });

  it("M8 工藝火焰抗性選工藝:改送 crafted id、孿生取消勾選,crafted id 只啟用一條", async () => {
    const m = await mech();
    const { item, preset, stats } = build(CHEST);
    const fire = row(stats, FIRE, ModifierType.Crafted, true);
    expect(fire, "工藝火焰抗性應有可見列").toBeDefined();
    const twin = twinOf(stats, FIRE, fire!);
    if (twin) twin.disabled = false;
    m.selectMechanism(stats, fire, "crafted");
    expect(fire!.tradeId).toEqual([ids("crafted", N.fire)]);
    expect(fire!.disabled).toBe(false);
    if (twin) expect(twin.disabled).toBe(true);
    expect(
      enabledIds(queryGroups(item, preset)).filter(
        (id) => id === ids("crafted", N.fire),
      ),
    ).toHaveLength(1);
  });

  it("M8 珠寶法術暴擊選工藝:改送 crafted id、孿生取消勾選(原 K4)", async () => {
    const m = await mech();
    const { stats } = build(JEWEL);
    const f = row(stats, SPELL_CRIT, ModifierType.Crafted, true)!;
    const twin = twinOf(stats, SPELL_CRIT, f)!;
    expect(twin).toBeDefined();
    twin.disabled = false;
    m.selectMechanism(stats, f, "crafted");
    expect(f.tradeId).toEqual([ids("crafted", N.spellCrit)]);
    expect(f.disabled).toBe(false);
    expect(twin.disabled).toBe(true);
  });

  it("M8 選褻瀆後選回一般:送回 explicit id、勾選狀態不動", async () => {
    const m = await mech();
    const { stats } = build(JEWEL);
    const f = row(stats, SPELL_CRIT, ModifierType.Crafted, true)!;
    m.selectMechanism(stats, f, "desecrated");
    expect(f.tradeId).toEqual([ids("desecrated", N.spellCrit)]);
    expect(f.disabled).toBe(false);
    m.selectMechanism(stats, f, "normal");
    expect(f.tradeId).toEqual([ids("explicit", N.spellCrit)]);
    expect(f.disabled).toBe(false);
    expect(m.mechanismMode(f)).toBe("normal");
  });
});

describe("M9 / M10 / M15 / M16 一般模式只排除來源本身的機制(PoE2)", () => {
  it("M9 胸甲勾選一般的工藝火焰抗性:not 群組恰好只含工藝 id", async () => {
    const m = await mech();
    const { item, preset, stats } = build(CHEST);
    const fire = row(stats, FIRE, ModifierType.Crafted, true);
    expect(fire, "工藝火焰抗性應有可見列").toBeDefined();
    m.selectMechanism(stats, fire, "normal");
    fire!.disabled = false;
    const groups = queryGroups(item, preset);
    expect(enabledIds(groups)).toContain(ids("explicit", N.fire));
    const nots = notGroups(groups);
    expect(nots).toHaveLength(1);
    expect(nots[0].disabled).not.toBe(true);
    expect(notIds(groups)).toEqual([ids("crafted", N.fire)]);
  });

  it("M9 珠寶勾選一般的工藝法術暴擊:not 群組恰好只含工藝 id(原 K10)", async () => {
    await mech();
    const { item, preset, stats } = build(JEWEL);
    const f = row(stats, SPELL_CRIT, ModifierType.Crafted, true)!;
    f.disabled = false;
    const groups = queryGroups(item, preset);
    expect(enabledIds(groups)).toContain(ids("explicit", N.spellCrit));
    expect(notGroups(groups)).toHaveLength(1);
    expect(notIds(groups)).toEqual([ids("crafted", N.spellCrit)]);
  });

  it("M9 預設沒有勾選隨機詞綴時不加 not 群組(原 K11)", async () => {
    await mech();
    const { item, preset, stats } = build(JEWEL);
    expect(row(stats, SPELL_CRIT, ModifierType.Crafted, true)!.disabled).toBe(true);
    expect(notGroups(queryGroups(item, preset))).toHaveLength(0);
  });

  it("M9 選工藝時不加 not 群組(原 K12)", async () => {
    const m = await mech();
    const { item, preset, stats } = build(JEWEL);
    m.selectMechanism(
      stats,
      row(stats, SPELL_CRIT, ModifierType.Crafted, true)!,
      "crafted",
    );
    expect(notGroups(queryGroups(item, preset))).toHaveLength(0);
  });

  it("M9 孿生已直接送出 crafted id 時一般列不再產生 not 群組", async () => {
    const m = await mech();
    const { item, preset, stats } = build(JEWEL);
    const f = row(stats, SPELL_CRIT, ModifierType.Crafted, true)!;
    const twin = twinOf(stats, SPELL_CRIT, f)!;
    m.selectMechanism(stats, f, "normal");
    f.disabled = false;
    twin.disabled = false;
    const groups = queryGroups(item, preset);
    expect(enabledIds(groups)).toContain(ids("crafted", N.spellCrit));
    expect(notIds(groups)).not.toContain(ids("crafted", N.spellCrit));
    expect(notGroups(groups)).toHaveLength(0);
  });

  it("M10 工藝、褻瀆、破裂三種來源各一列勾選一般:合併成一個 not 群組、各只含自己的機制 id", async () => {
    const m = await mech();
    const { item, preset, stats } = build(CHEST_MIXED);
    const fire = row(stats, FIRE, ModifierType.Crafted, true);
    const cold = row(stats, COLD, ModifierType.Desecrated, true);
    const lightning = row(stats, LIGHTNING, ModifierType.Fractured, true);
    expect(fire, "工藝火焰抗性應有可見列").toBeDefined();
    expect(cold, "褻瀆冰冷抗性應有可見列").toBeDefined();
    expect(lightning, "破裂閃電抗性應有可見列").toBeDefined();
    for (const f of [fire!, cold!, lightning!]) {
      m.selectMechanism(stats, f, "normal");
      f.disabled = false;
    }
    const groups = queryGroups(item, preset);
    expect(notGroups(groups)).toHaveLength(1);
    expect(notIds(groups).sort()).toEqual(
      [
        ids("crafted", N.fire),
        ids("desecrated", N.cold),
        ids("fractured", N.lightning),
      ].sort(),
    );
  });

  it("M15 胸甲勾選一般隨機的生命與冰冷抗性:不加任何 not 群組", async () => {
    await mech();
    const { item, preset, stats } = build(CHEST);
    for (const ref of [LIFE, COLD]) {
      const f = row(stats, ref, ModifierType.Explicit, true);
      expect(f, `${ref} 應有可見列`).toBeDefined();
      f!.disabled = false;
    }
    const groups = queryGroups(item, preset);
    expect(enabledIds(groups)).toEqual(
      expect.arrayContaining([ids("explicit", N.life), ids("explicit", N.cold)]),
    );
    expect(notGroups(groups)).toHaveLength(0);
  });

  it("M15 珠寶三條一般隨機詞綴勾選:不加任何 not 群組", async () => {
    await mech();
    const { item, preset, stats } = build(JEWEL);
    const rows = stats.filter(
      (f) =>
        f.hidden == null &&
        f.tag !== FilterTag.Pseudo &&
        f.sources.every((s) => s.modifier.info.type === ModifierType.Explicit),
    );
    expect(rows).toHaveLength(3);
    for (const f of rows) f.disabled = false;
    expect(notGroups(queryGroups(item, preset))).toHaveLength(0);
  });

  it("M16 符文列切回一般並勾選:不排除任何 rune id", async () => {
    const m = await mech();
    const { item, preset, stats } = build(CHEST);
    const rune = row(stats, RUNE_STAT, ModifierType.Augment);
    expect(rune).toBeDefined();
    m.selectMechanism(stats, rune, "normal");
    rune!.disabled = false;
    const groups = queryGroups(item, preset);
    expect(notIds(groups).filter((id) => id.startsWith("rune."))).toEqual([]);
    expect(notGroups(groups)).toHaveLength(0);
  });

  it("M16 所有可見詞綴列都勾選一般:not 群組不含任何 rune id", async () => {
    const m = await mech();
    const { item, preset, stats } = build(CHEST_MIXED);
    for (const f of stats.filter(
      (f) => f.hidden == null && f.tag !== FilterTag.Pseudo && f.tag !== FilterTag.Property,
    )) {
      m.selectMechanism(stats, f, "normal");
      f.disabled = false;
    }
    const nIds = notIds(queryGroups(item, preset));
    expect(nIds.length).toBeGreaterThan(0);
    expect(nIds.filter((id) => id.startsWith("rune."))).toEqual([]);
  });
});

describe("M17 base_item preset 預設查詢", () => {
  it("M17 魔法鞋(移動速度 + 閃電抗性 + 閃電抗性符文)各 preset 預設查詢都沒有 not 群組", () => {
    const item = parse(BOOTS_MAGIC);
    const { presets } = createPresets(item, OPTS);
    expect(presets.map((p) => p.id)).toContain("filters.preset_base_item");
    for (const p of presets) {
      expect(notGroups(queryGroups(item, p)), `${p.id} 不應有 not 群組`).toHaveLength(0);
    }
  });
});
