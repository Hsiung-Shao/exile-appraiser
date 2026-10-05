import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init } from "@/assets/data";
import { magicBasetype } from "@/parser/magic-name";

/**
 * exile-appraiser:魔法物品名「詞綴名 × 底材名」碰撞的回歸網。
 *
 * fixture 由 `node scripts/scan-magic-name-collisions.mjs --from ../Pob2/pob-zh-engine` 產生
 * (GGPK Mods 表全部詞綴名 × 魔法可出的底材,只留「名稱裡有一個不是底材、長度 ≥ 底材的物品名」的組合)。
 * 每一組照遊戲的組句方式拼出名稱,餵給真正的 magicBasetype,必須還原出底材。
 * 起因:繁中「昇華的幻像異界之譫妄碑牌」被解析成「幻像異界」(見 magic-name.ts 的 anchorRank)。
 */

interface Fixture {
  languages: Record<
    "cmn-Hant" | "en",
    {
      total: number;
      baseSets: string[][];
      cases: Array<{
        affix: string;
        form: "any" | "prefix" | "suffix";
        baseSet: number;
      }>;
    }
  >;
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "fixtures/magic-name-collisions.json"),
    "utf8",
  ),
) as Fixture;

/**
 * 名稱本身有歧義、只看名稱無法分辨的組合:詞綴名 + 底材恰好拼成另一個物品名
 * (例:前綴「三相」+ 底材「戒指」=「三相戒指」本身就是底材 Prismatic Ring)。
 * 值 = 目前會解析成的名稱。這裡的組合被修好(或資料變了)時測試會紅,提醒從清單移除。
 */
const KNOWN_AMBIGUOUS: Record<"cmn-Hant" | "en", Record<string, string>> = {
  "cmn-Hant": {
    三相戒指: "三相戒指", // 三相 + 戒指 = 三相戒指(Prismatic Ring)
    符文短劍: "符文短劍", // 符文 + 短劍 = 符文短劍(Runic Shortsword)
    包含一個裂痕戒指: "裂痕戒指", // …裂痕 + 戒指,結尾 = 裂痕戒指(Breach Ring)
    碧藍裂痕戒指: "裂痕戒指",
    岩卜符文短劍: "符文短劍", // …符文 + 短劍,結尾 = 符文短劍
    風暴喚者符文短劍: "符文短劍",
  },
  en: {
    "Prismatic Ring": "Prismatic Ring",
    "Mnemonic Ring": "Mnemonic Ring",
    "Sapphire Ring": "Sapphire Ring",
    "Breach Ring": "Breach Ring",
    "Runic Shortsword": "Runic Shortsword",
    "Contains a Breach Ring": "Breach Ring", // …Breach + Ring = Breach Ring
    "Essence of the Breach Ring": "Breach Ring",
    "Ring of Fire Ruby": "Ring", // 怪物詞綴名 Ring of Fire 被 `of` 規則當成前綴組句;名稱含 `of` 時 Ring 排第一
  },
};

function compose(
  lang: "cmn-Hant" | "en",
  form: "any" | "prefix" | "suffix",
  affix: string,
  base: string,
) {
  if (lang === "cmn-Hant") return `${affix}${base}`;
  return form === "suffix" ? `${base} ${affix}` : `${affix} ${base}`;
}

describe.each(["cmn-Hant", "en"] as const)("魔法物品名碰撞(%s)", (lang) => {
  beforeAll(async () => {
    setupTests({ language: lang });
    await init(lang);
  });

  it("fixture 的每一組都還原出底材(已知歧義除外)", () => {
    const data = fixture.languages[lang];
    const known = KNOWN_AMBIGUOUS[lang];
    const failures: string[] = [];
    const knownSeen: Record<string, string> = {};
    let count = 0;
    for (const c of data.cases) {
      for (const base of data.baseSets[c.baseSet]) {
        count++;
        const name = compose(lang, c.form, c.affix, base);
        const got = magicBasetype(name);
        if (name in known) {
          knownSeen[name] = String(got);
          continue;
        }
        if (got !== base) failures.push(`${name} → ${String(got)}(應為 ${base})`);
      }
    }
    expect(count).toBe(data.total);
    expect(failures).toEqual([]);
    expect(knownSeen).toEqual(known);
  });
});

describe("回報的實例:昇華的幻像異界之譫妄碑牌", () => {
  it("cmn-Hant:底材是譫妄碑牌,不是後綴裡的幻像異界", async () => {
    setupTests({ language: "cmn-Hant" });
    await init("cmn-Hant");
    expect(magicBasetype("昇華的幻像異界之譫妄碑牌")).toBe("譫妄碑牌");
    expect(magicBasetype("幻像異界之譫妄碑牌")).toBe("譫妄碑牌");
  });
  it("en:Elevated Delirium Tablet of the Simulacrum", async () => {
    setupTests({ language: "en" });
    await init("en");
    expect(magicBasetype("Elevated Delirium Tablet of the Simulacrum")).toBe(
      "Delirium Tablet",
    );
  });
});
