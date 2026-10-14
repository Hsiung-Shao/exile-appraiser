import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import type { ParsedItem } from "@/parser/ParsedItem";
import { ModifierType } from "@/parser/modifiers";
import { createPresets, createTradeRequest } from "../../../../src/index";
import {
  FilterTag,
  type FilterPreset,
  type StatFilter,
} from "@/web/price-check/filters/interfaces";
import {
  applyFracturedToggle,
  canToggleFractured,
  isFracturedOn,
} from "@/web/price-check/filters/fractured-toggle";
import { setupTests } from "../../../vitest.setup";
import { FracturedItem } from "../../../Parser/items";
import { FIXTURES_DIR } from "../../../zhTW/helpers/fixture-harness";

// 查價面板「破裂」切換鈕(T9–T11,PoE2):破裂詞綴改送 fractured stat id,再點換回原本的 id。
const EN_DIR = path.join(FIXTURES_DIR, "en");
const read = (name: string) =>
  fs.readFileSync(path.join(EN_DIR, `${name}.txt`), "utf8");
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
// 弓(未汙染、可再製作):破裂「Adds # to # Physical Damage」→ explicit 列 + 隱藏孿生
const PHYS = "Adds # to # Physical Damage";
const PHYS_EXPLICIT = "explicit.stat_1940865751";
const PHYS_FRACTURED = "fractured.stat_1940865751";
// 頭盔(已汙染):破裂 + 工藝的稀有度詞綴,explicit id 有兩個(count 群組)
const RARITY = "#% increased Rarity of Items found";
// 頭盔改成混沌抗性也是破裂 → 被 pseudo「#% total to Chaos Resistance」吃掉,切換鈕在 pseudo 列
const CHAOS_PSEUDO = "#% total to Chaos Resistance";
const CHAOS_PSEUDO_ID = "pseudo.pseudo_total_chaos_resistance";
const helmet = () => read("helmet-rare-kamasan-tiara-01");
const helmetChaos = () =>
  helmet().replace(
    '{ Suffix Modifier "of Bameth"',
    '{ Fractured Suffix Modifier "of Bameth"',
  );

function parse(text: string): ParsedItem {
  const r = parseClipboard(text.replace(/\r\n/g, "\n"));
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`);
  return r.value;
}
function preset(item: ParsedItem): FilterPreset {
  const { presets, active } = createPresets(item, OPTS);
  // 破裂切換是 pseudo preset 的功能;2026-10-15 起有底材 preset 的武器 / 防具預設是底材,這裡固定取 pseudo
  return (
    presets.find((p) => p.id === "filters.preset_pseudo") ??
    presets.find((p) => p.id === active) ??
    presets[0]
  );
}
const toggles = (item: ParsedItem, p: FilterPreset) =>
  p.stats.filter((f) => canToggleFractured(f, item));
const enabledIds = (request: any): string[] =>
  (request.query.stats as any[]).flatMap((g) =>
    g.disabled
      ? []
      : g.filters.filter((f: any) => !f.disabled).map((f: any) => f.id),
  );

beforeAll(async () => {
  setupTests({ language: "en" });
  await init("en");
});

describe("T9 破裂鈕只在破裂詞綴出現", () => {
  it("破裂物品的破裂詞綴有切換鈕(explicit 列)", () => {
    const item = parse(FracturedItem.rawText);
    expect(item.isFractured).toBe(true);
    const t = toggles(item, preset(item));
    expect(t.map((f) => f.statRef)).toEqual([PHYS]);
    expect(t[0].tradeId).toEqual([PHYS_EXPLICIT]);
    expect(isFracturedOn(t[0])).toBe(false);
  });

  it("破裂詞綴被 pseudo 吃掉時切換鈕在 pseudo 列", () => {
    const item = parse(helmetChaos());
    const t = toggles(item, preset(item));
    expect(t.map((f) => f.statRef).sort()).toEqual(
      [CHAOS_PSEUDO, RARITY].sort(),
    );
    expect(t.find((f) => f.statRef === CHAOS_PSEUDO)!.tradeId).toEqual([
      CHAOS_PSEUDO_ID,
    ]);
  });

  it("非破裂詞綴、混了一般詞綴的合計列與隱藏孿生都沒有切換鈕", () => {
    const item = parse(FracturedItem.rawText);
    const all = preset(item).stats;
    for (const f of all.filter(
      (f) => !(f.statRef === PHYS && f.tag === FilterTag.Explicit),
    )) {
      expect(canToggleFractured(f, item), f.statRef).toBe(false);
    }
    // Physical DPS 的來源含破裂詞綴,但混了其他來源 → 不給
    expect(all.find((f) => f.tradeId[0] === "item.physical_dps")).toBeDefined();
  });

  it("一般物品沒有切換鈕", () => {
    for (const name of [
      "wand-rare-dueling-wand-01",
      "spear-rare-soaring-spear-01",
      "jewel-rare-01",
    ]) {
      const item = parse(read(name));
      expect(item.isFractured, name).toBeFalsy();
      expect(toggles(item, preset(item))).toEqual([]);
    }
  });

  it("stat 沒有 fractured trade id 時沒有切換鈕", () => {
    const item = parse(FracturedItem.rawText);
    const phys = toggles(item, preset(item))[0];
    const src = phys.sources[0];
    const noFracStat = {
      ...src.stat.stat,
      trade: { ids: { [ModifierType.Explicit]: [PHYS_EXPLICIT] } },
    };
    const fake: StatFilter = {
      ...phys,
      sources: [{ ...src, stat: { ...src.stat, stat: noFracStat } }],
    };
    expect(canToggleFractured(fake, item)).toBe(false);
  });
});

describe("T10 點破裂改送破裂 id", () => {
  for (const [label, text, rowRef] of [
    ["弓 explicit 列", () => FracturedItem.rawText, PHYS],
    ["頭盔 explicit 列(兩個 id)", helmet, RARITY],
    ["頭盔 pseudo 列", helmetChaos, CHAOS_PSEUDO],
  ] as const) {
    it(`${label}:切換後送 fractured id,再點換回與原查詢逐字相同`, () => {
      const item = parse(text());
      const p = preset(item);
      const row = toggles(item, p).find((f) => f.statRef === rowRef)!;
      row.disabled = false; // 使用者已勾選這條
      const baseIds = [...row.tradeId];
      const before = JSON.stringify(createTradeRequest(p, item));

      applyFracturedToggle(p.stats, row, true);
      expect(isFracturedOn(row)).toBe(true);
      expect(row.tradeId.every((id) => id.startsWith("fractured."))).toBe(true);
      const on = enabledIds(createTradeRequest(p, item));
      for (const id of row.tradeId) expect(on).toContain(id);
      for (const id of baseIds) expect(on).not.toContain(id);

      applyFracturedToggle(p.stats, row, false);
      expect(isFracturedOn(row)).toBe(false);
      expect(JSON.stringify(createTradeRequest(p, item))).toBe(before);
    });
  }

  it("沒勾選的列按破裂會一併勾選", () => {
    const item = parse(FracturedItem.rawText);
    const p = preset(item);
    const row = toggles(item, p)[0];
    expect(row.disabled).toBe(true);
    applyFracturedToggle(p.stats, row, true);
    expect(row.disabled).toBe(false);
    expect(enabledIds(createTradeRequest(p, item))).toContain(PHYS_FRACTURED);
  });
});

describe("T11 孿生條件不重複", () => {
  it("打開後隱藏孿生取消勾選,fractured id 只送一次", () => {
    const item = parse(FracturedItem.rawText);
    const p = preset(item);
    const row = toggles(item, p)[0];
    const twin = p.stats.find(
      (f) => f.statRef === PHYS && f.tag === FilterTag.Fractured,
    )!;
    expect(twin.hidden).toBe("filters.hide_for_crafting");
    twin.disabled = false; // 使用者從隱藏清單勾了孿生
    applyFracturedToggle(p.stats, row, true);
    expect(twin.disabled).toBe(true);
    expect(
      p.stats.filter(
        (f) => !f.disabled && f.tradeId.includes(PHYS_FRACTURED),
      ),
    ).toEqual([row]);
    expect(
      enabledIds(createTradeRequest(p, item)).filter(
        (id) => id === PHYS_FRACTURED,
      ).length,
    ).toBe(1);
  });
});
