import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { init } from "@/assets/data";
import { __testExports } from "@/web/price-check/trade/pathofexile-trade";
import { loadDisplayZhData, translateDisplayItem, type DisplayZhData } from "@/web/price-check/trade/display-zh";
import { setupTests } from "@specs/vitest.setup";

/**
 * 懸停浮窗第一區塊(nameBlock)的屬性名換成 GGPK 官方繁中:
 * 品質屬性(`<名稱>: {0}`)與 `Stack Size ` 這類「英文原名 + 空白」的屬性行。
 * 介面字串鍵(`item.armour`)與未收錄的屬性維持原樣。
 * 樣本 = 錄製回應裡的身體護甲(fetchResponses2.json `95bcbe83`),只換 properties。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 錄製回應的形狀
type AnyResult = any;

// 交易站 property type 編號(對照 pathofexile-trade.ts 的 TradePropType 列舉順序)
const TYPE_LEVEL = 5; // GemLevel
const TYPE_QUALITY = 6;
const TYPE_ARMOUR = 16; // ArmourReduction(文字會變成 item.armour)
const TYPE_TRIALS = 26;
const TYPE_STACK_SIZE = 32;
const TYPE_AREA_LEVEL = 34;

const CLASS_LINE = { name: "Amulet", values: [], displayMode: 0, type: 109 };

function baseResult(): AnyResult {
  const f = path.resolve(__dirname, "../../../docs/fetchResponses2.json");
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  const list = (Array.isArray(d) ? d : d.result) as AnyResult[];
  return structuredClone(list.find((x) => x.id.startsWith("95bcbe83")));
}

function withProps(props: AnyResult[]): AnyResult {
  const r = baseResult();
  r.item.properties = [CLASS_LINE, ...props];
  return r;
}

function qualityProp(name: string, value = "+20%"): AnyResult {
  return { name, values: [[value, 1]], displayMode: 0, type: TYPE_QUALITY };
}

function zhOf(r: AnyResult) {
  const before = __testExports.parseFetchResult(r)!;
  return { before, after: translateDisplayItem(before, r.item, data).display };
}

/** 翻譯前先以英文原文找出目標行 index,翻譯後取同 index 比對 */
function lineAt(r: AnyResult, beforeText: string) {
  const { before, after } = zhOf(r);
  const idx = before.nameBlock!.findIndex((l) => l.text === beforeText);
  expect(idx, `翻譯前找不到行 ${JSON.stringify(beforeText)}`).toBeGreaterThan(0);
  return { b: before.nameBlock![idx], a: after.nameBlock![idx] };
}

let data: DisplayZhData;
beforeAll(async () => {
  setupTests();
  await init("en");
  data = await loadDisplayZhData();
});

describe("懸停浮窗繁中:屬性名(品質類型、堆疊數量等)", () => {
  it("品質屬性行換成繁中「品質: {0}」,數值與顏色不變", () => {
    const { b, a } = lineAt(withProps([qualityProp("[Quality]")]), "Quality: {0}");
    expect(a.text).toBe("品質: {0}");
    expect(a.value).toBe("+20%");
    expect(a.value).toBe(b.value);
    expect(a.color).toBe(b.color);
  });

  it("催化劑品質類型換成繁中全形括號「品質（能力值詞綴）: {0}」", () => {
    const { b, a } = lineAt(withProps([qualityProp("Quality (Attribute Modifiers)")]), "Quality (Attribute Modifiers): {0}");
    expect(a.text).toBe("品質（能力值詞綴）: {0}");
    expect(a.value).toBe("+20%");
    expect(a.value).toBe(b.value);
    expect(a.color).toBe(b.color);
  });

  it("區域等級、堆疊數量、等級、試煉數量換成繁中,數值不變", () => {
    const r = withProps([
      { name: "Area Level", values: [["83", 0]], displayMode: 0, type: TYPE_AREA_LEVEL },
      { name: "Stack Size", values: [["12/20", 0]], displayMode: 0, type: TYPE_STACK_SIZE },
      { name: "Level", values: [["20", 0]], displayMode: 0, type: TYPE_LEVEL },
      { name: "Number of Trials", values: [["6", 0]], displayMode: 0, type: TYPE_TRIALS },
    ]);
    const expected: Array<[string, string, string]> = [
      ["Area Level ", "區域等級 ", "83"],
      ["Stack Size ", "堆疊數量 ", "12/20"],
      ["Level ", "等級 ", "20"],
      ["Number of Trials ", "試煉數量 ", "6"],
    ];
    for (const [en, zh, value] of expected) {
      const { b, a } = lineAt(r, en);
      expect(a.text).toBe(zh);
      expect(a.value).toBe(value);
      expect(a.value).toBe(b.value);
      expect(a.color).toBe(b.color);
    }
  });

  it("介面鍵屬性(item.armour)與未收錄的屬性名維持原樣", () => {
    const r = withProps([
      { name: "Armour", values: [["100", 0]], displayMode: 0, type: TYPE_ARMOUR },
      { name: "Totally Unknown Property", values: [["5", 0]], displayMode: 0, type: 0 },
    ]);
    const { before, after } = zhOf(r);
    for (const en of ["item.armour", "Totally Unknown Property "]) {
      const idx = before.nameBlock!.findIndex((l) => l.text === en);
      expect(idx, `翻譯前找不到行 ${JSON.stringify(en)}`).toBeGreaterThan(0);
      expect(after.nameBlock![idx]).toEqual(before.nameBlock![idx]);
    }
  });

  it("13 種品質類型都有 GGPK 官方繁中(全形括號)", () => {
    const stringZh = (data as { stringZh?: Map<string, string> }).stringZh;
    const expected: Record<string, string> = {
      "Quality (Life Modifiers)": "品質（生命詞綴）",
      "Quality (Mana Modifiers)": "品質（魔力詞綴）",
      "Quality (Defence Modifiers)": "品質（防禦詞綴）",
      "Quality (Physical Modifiers)": "品質（物理詞綴）",
      "Quality (Fire Modifiers)": "品質（火焰詞綴）",
      "Quality (Cold Modifiers)": "品質（冰冷詞綴）",
      "Quality (Lightning Modifiers)": "品質（閃電詞綴）",
      "Quality (Chaos Modifiers)": "品質（混沌詞綴）",
      "Quality (Attack Modifiers)": "品質（攻擊詞綴）",
      "Quality (Caster Modifiers)": "品質（法術詞綴）",
      "Quality (Speed Modifiers)": "品質（速度詞綴）",
      "Quality (Attribute Modifiers)": "品質（能力值詞綴）",
      "Quality (Minion Modifiers)": "品質（召喚物詞綴）",
    };
    const actual = Object.fromEntries(Object.keys(expected).map((en) => [en, stringZh?.get(en)]));
    expect(actual).toEqual(expected);
  });

  it("item-classes.json 的 strings 每筆 id / en / zh 都乾淨且 id 不重複", () => {
    const f = path.resolve(__dirname, "../../../../../data/poe2/item-classes/item-classes.json");
    const json = JSON.parse(fs.readFileSync(f, "utf8")) as {
      strings?: Array<{ id?: unknown; en?: unknown; zh?: unknown }>;
    };
    const strings = json.strings ?? [];
    expect(strings.length).toBeGreaterThan(0);

    const bad: string[] = [];
    for (const s of strings) {
      for (const k of ["id", "en", "zh"] as const) {
        const v = s[k];
        if (typeof v !== "string" || v.trim() === "") bad.push(`${JSON.stringify(s)} 的 ${k} 不是非空字串`);
      }
      for (const k of ["en", "zh"] as const) {
        const v = s[k];
        if (typeof v === "string" && /[[\]{}]/.test(v)) bad.push(`${String(s.id)} 的 ${k} 含標記字元 ${JSON.stringify(v)}`);
      }
    }
    expect(bad).toEqual([]);

    const ids = strings.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
