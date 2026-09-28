/**
 * exile-appraiser(WP-R):一般複製褻瀆詞綴的 Tier 推定。
 *
 * 主要驗證:拿 zhTW 回歸網裡三件「進階複製、含已褻瀆詞綴且遊戲自帶階層」的真實物品,程式化轉成一般複製格式
 * (去掉 `{…}` 標頭、去掉數值後的 `(lo-hi)`、褻瀆行尾補 ` (desecrated)`),推定 Tier 必須等於遊戲給的 Tier。
 * 轉換規則寫死繁中標頭用字(已褻瀆 / 已破裂 / 附魔 / 固有),只給這三件 cmn-Hant 樣本用。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import { ModifierType } from "@/parser/modifiers";
import type { ParsedItem } from "@/parser/ParsedItem";
import type { ParsedModifier } from "@/parser/advanced-mod-desc";
import { desecrationData } from "@/desecration";

const FIXTURES = path.resolve(__dirname, "../zhTW/fixtures/cmn-Hant");
const ADVANCED_SAMPLES = [
  "boots-rare-luxurious-slippers-01",
  "helmet-rare-kamasan-tiara-01",
  "wand-rare-dueling-wand-01",
];

/** 進階複製 → 一般複製(見檔頭) */
export function toPlainFormat(text: string): string {
  const out: string[] = [];
  let suffix = "";
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("{") && line.endsWith("}")) {
      suffix = line.includes("已褻瀆")
        ? " (desecrated)"
        : line.includes("已破裂")
          ? " (fractured)"
          : line.includes("附魔")
            ? " (enchant)"
            : line.includes("固有")
              ? " (implicit)"
              : "";
      continue;
    }
    if (line === "--------") suffix = "";
    const stripped = line.replace(/(\d+(?:\.\d+)?)\([^)]*\)/g, "$1");
    out.push(suffix && stripped ? stripped + suffix : stripped);
  }
  return out.join("\n");
}

function parse(text: string): ParsedItem {
  const r = parseClipboard(text);
  if (r.isErr()) throw new Error(r.error);
  return r.value;
}

const desecrated = (item: ParsedItem) =>
  item.newMods.filter((m) => m.info.type === ModifierType.Desecrated);
const key = (m: ParsedModifier) => m.stats.map((s) => s.stat.ref).join(" + ");

beforeAll(async () => {
  setupTests({ language: "cmn-Hant" });
  await init("cmn-Hant");
}, 180_000);

describe("資料載入", () => {
  it("init() 經 DataSource 載入 tiers.json 與 base_profiles.json", () => {
    const data = desecrationData();
    expect(data?.tiers.entries.length).toBe(1713);
    expect(data?.baseProfiles.profiles["Luxurious Slippers"]).toMatch(/^p\d{3}$/);
  });
});

describe("進階複製 → 一般複製:推定 Tier = 遊戲給的 Tier", () => {
  for (const name of ADVANCED_SAMPLES) {
    it(name, () => {
      const text = fs.readFileSync(path.join(FIXTURES, `${name}.txt`), "utf8");
      const advanced = parse(text);
      const truth = desecrated(advanced);
      expect(truth.length).toBeGreaterThan(0);
      for (const m of truth) {
        // 進階複製:遊戲自帶 Tier,推定不得動它
        expect(m.info.tier, key(m)).toBeTypeOf("number");
        expect(m.info.tierInferred, key(m)).toBeUndefined();
      }

      const plainText = toPlainFormat(text);
      expect(plainText).not.toMatch(/\{/);
      expect(plainText).toMatch(/ \(desecrated\)$/m);
      const plain = parse(plainText);
      const got = desecrated(plain);
      expect(got.map(key).sort()).toEqual(truth.map(key).sort());
      for (const m of truth) {
        const p = got.find((g) => key(g) === key(m))!;
        expect(
          { tier: p.info.tier, inferred: p.info.tierInferred, candidates: p.info.tierCandidates },
          `${name}: ${key(m)}`,
        ).toEqual({ tier: m.info.tier, inferred: true, candidates: undefined });
        expect(p.info.ranges?.length).toBe(m.stats.length);
        // 遊戲顯示的範圍(進階格式 roll.min/max)必須落在推定範圍內
        m.stats.forEach((s, i) => {
          const r = p.info.ranges![i];
          expect(r, key(m)).not.toBeNull();
          expect(Math.abs(s.roll!.min)).toBeGreaterThanOrEqual(r![0] - 1e-6);
          expect(Math.abs(s.roll!.max)).toBeLessThanOrEqual(r![1] + 1e-6);
        });
      }
      // 一般複製解析出來的詞綴數 = 進階複製的(parsePlainModifiers 沒漏段)
      expect(plain.unknownModifiers).toEqual([]);
    });
  }
});

describe("推定規則", () => {
  const header = (base: string, cls = "單手錘") =>
    [
      `物品種類: ${cls}`,
      "稀有度: 稀有",
      "測試 之物",
      base,
      "--------",
      "物品等級: 82",
      "--------",
    ].join("\n");

  it("混合詞綴拆成兩行(一般複製):組回同一條 entry、兩行同 Tier 與 pool", () => {
    const item = parse(
      header("戰鎬") +
        "\n增加130%物理傷害 (desecrated)\n減少15%攻擊速度 (desecrated)\n",
    );
    const mods = desecrated(item);
    expect(mods).toHaveLength(2);
    for (const m of mods) {
      expect(m.info.tierInferred).toBe(true);
      expect(m.info.tier).toBe(1);
      expect(m.info.pool).toBe("desecration_exclusive");
      expect(m.info.inferredCandidates?.[0].gods).toEqual(["kurgal"]);
    }
  });

  it("數值落在範圍外 → 不推定(不硬給)", () => {
    const item = parse(header("奢華便鞋", "鞋子") + "\n+99%閃電和混沌抗性 (desecrated)\n");
    const [m] = desecrated(item);
    expect(m.info.tier).toBeUndefined();
    expect(m.info.tierInferred).toBeUndefined();
  });

  it("底材查不到時以類別推:該類別所有 profile 的 Tier 一致才給單一 Tier", () => {
    const text = fs.readFileSync(
      path.join(FIXTURES, "boots-rare-luxurious-slippers-01.txt"),
      "utf8",
    );
    const item = parse(toPlainFormat(text));
    const m = desecrated(item)[0];
    expect(m.info.profileExact).toBe(true);
    const data = desecrationData()!;
    const saved = data.baseProfiles.profiles["Luxurious Slippers"];
    delete data.baseProfiles.profiles["Luxurious Slippers"];
    try {
      const again = desecrated(parse(toPlainFormat(text)))[0];
      expect(again.info.profileExact).toBe(false);
      expect(again.info.tier ?? again.info.tierCandidates).toBeDefined();
    } finally {
      data.baseProfiles.profiles["Luxurious Slippers"] = saved;
    }
  });
});
