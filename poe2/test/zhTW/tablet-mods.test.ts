import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import type { ParsedItem } from "@/parser/ParsedItem";
import { createPresets } from "@/web/price-check/filters/create-presets";
import { createTradeRequest } from "@/web/price-check/trade/pathofexile-trade";
import fixture from "./fixtures/tablet-mods.json";

/**
 * 碑牌詞綴全量稽核(八種碑牌共用同一份描述檔)。
 *
 * 為什麼需要它:碑牌的詞綴在客戶端是用 `tablet_stat_descriptions.csd` 印的,與裝備用的
 * `stat_descriptions.csd` 是**不同的句型**(「地圖中的…」、數值 1 的單數句、GGG 譯文裡的
 * 殘字)。資料集只要少一種句型,那一行就靜默進 `unknownModifiers`:面板少一條、查詢少
 * 一個條件,使用者只看得到「查不到」。
 *
 * fixture 由 GGPK 抽出(見 fixture 的 `source`),每種變體合成一行遊戲文字,
 * 組成整件碑牌(八種基底 × 魔法/稀有)走真正的路徑:
 *   parseClipboard → createPresets → 使用者只勾那條詞綴 → createTradeRequest
 * 判準:讀得出來、交易 id 對得上 GGPK/交易站、正負號與變體一致、面板上看得到
 * (不在「隱藏」清單)、勾了之後送出的查詢確實帶著這個交易 id。
 *
 * 產生器 `tools-local/gen-tablet-fixture.mjs`(只留本地)。新賽季要重抽 GGPK 再產生。
 */

interface Case {
  gid: string;
  cond: string;
  printed: "tc" | "en";
  template: string;
  line: string;
  tradeIds: string[];
  sign: 1 | -1 | null;
}

// fixture 太大,TS 對 JSON 匯入推不出陣列元素型別(vue-tsc 會報 implicit any),明確標上
const data = fixture as unknown as {
  cases: Case[];
  combos: Array<{ from: string; cases: number[] }>;
};
const cases = data.cases;

/**
 * 一條詞綴帶多行 stat(例:減少怪物群大小 + 增加換界石 + 額外神殿)。每組跑兩次:
 * 產生器挑的句型,以及把能換成數值 1 單數句(「一個」)的行換掉。
 */
const combos: Array<{ from: string; members: Case[] }> = data.combos.flatMap(
  (combo) => {
    const members = combo.cases.map((i) => cases[i]);
    const singular = members.map(
      (m) => cases.find((c) => c.gid === m.gid && c.cond === "1") ?? m,
    );
    const variants = [{ from: combo.from, members }];
    if (singular.some((m, i) => m !== members[i])) {
      variants.push({ from: `${combo.from}(單數句)`, members: singular });
    }
    return variants;
  },
);

/** 八種碑牌基底,直接讀資料集,之後新增基底會自動納入。 */
const BASES = fs
  .readFileSync(
    // exile-appraiser: 資料在 repo 根 data/poe2(上游是 renderer/public/data)
    path.resolve(__dirname, "../../../data/poe2/cmn-Hant/items.ndjson"),
    "utf8",
  )
  .split(/\r?\n/)
  .filter(Boolean)
  .map(
    (line) =>
      JSON.parse(line) as {
        name: string;
        refName: string;
        craftable?: { category?: string };
      },
  )
  .filter((item) => item.craftable?.category === "TowerAugment")
  .map((item) => ({ name: item.name, refName: item.refName }));

const RARITIES = ["魔法", "稀有"] as const;

function tabletText(base: string, rarity: string, lines: string[]): string {
  return [
    "物品種類: 碑牌",
    `稀有度: ${rarity}`,
    ...(rarity === "稀有" ? ["稽核 之名"] : []),
    base,
    "--------",
    "物品等級: 80",
    "--------",
    '{ 前綴 "稽核的" }',
    ...lines.flatMap((line) => line.split("\n")),
    "--------",
    "可以使用於個人的地圖裝置來增加地圖的詞綴。",
    "",
  ].join("\n");
}

interface Outcome {
  label: string;
  problem?: string;
  defaultChecked?: boolean;
}
const outcomes: Outcome[] = [];

const labelOf = (head: string, c: Case) =>
  `${head} ${c.gid} [${c.cond}] ${c.line}`;

/** 一件碑牌上同一條詞綴的所有行,逐行檢查。 */
function audit(
  members: Case[],
  base: (typeof BASES)[number],
  rarity: string,
  from?: string,
): Outcome[] {
  const head = `${base.name}/${rarity}${from ? ` ${from}` : ""}`;
  const fail = (problem: string) =>
    members.map((c) => ({ label: labelOf(head, c), problem }));

  const parsed = parseClipboard(
    tabletText(
      base.name,
      rarity,
      members.map((m) => m.line),
    ),
  );
  if (parsed.isErr()) return fail(`解析失敗 ${parsed.error}`);
  const item = parsed.value;
  if (item.info.refName !== base.refName) {
    return fail(`基底認成 ${item.info.refName}`);
  }
  if (item.unknownModifiers.length) {
    const texts = item.unknownModifiers.map((m) => m.text).join(" / ");
    return fail(`讀不出來(unknownModifiers:${texts})`);
  }

  const presets = createPresets(item, {
    league: "Standard",
    currency: undefined,
    listingType: undefined,
    collapseListings: "api",
    activateStockFilter: false,
    searchStatRange: 10,
    useEn: true,
    defaultAllSelected: false,
  });
  const active = presets.presets.find((p) => p.id === presets.active)!;
  return members.map((c) => auditStat(c, item, active, labelOf(head, c)));
}

function auditStat(
  c: Case,
  item: ParsedItem,
  active: ReturnType<typeof createPresets>["presets"][number],
  label: string,
): Outcome {
  const stat = item.statsByType.find((s) =>
    (s.stat.trade.ids?.explicit ?? []).some((id) => c.tradeIds.includes(id)),
  );
  if (!stat) {
    const got = item.statsByType
      .map(
        (s) => `${s.stat.ref} ${(s.stat.trade.ids?.explicit ?? []).join("+")}`,
      )
      .join(" ; ");
    return { label, problem: `交易 id 對不上,實際 ${got || "(無)"}` };
  }
  const source = stat.sources[0];
  const value = source?.contributes?.value ?? source?.stat.roll?.value;
  if (c.sign !== null && value !== undefined && Math.sign(value) !== c.sign) {
    return { label, problem: `正負號錯誤,讀成 ${value}` };
  }

  const filter = active.stats.find((f) =>
    f.tradeId.some((id) => c.tradeIds.includes(id)),
  );
  if (!filter) return { label, problem: "查價面板沒有這條篩選" };
  if (filter.hidden != null) {
    return { label, problem: `被放進隱藏清單(${filter.hidden})` };
  }
  const defaultChecked = !filter.disabled;

  // 模擬使用者只勾這一條(FilterModifier.vue 的 toggleFilter),其餘取消
  const before = active.stats.map((f) => f.disabled);
  for (const f of active.stats) f.disabled = f !== filter;
  const body = createTradeRequest(active.filters, active.stats, item);
  active.stats.forEach((f, i) => (f.disabled = before[i]));

  const sent = (body.query.stats ?? [])
    .filter((group) => !group.disabled)
    .flatMap((group) => group.filters ?? [])
    .filter((f) => !f.disabled)
    .map((f) => f.id);
  if (!sent.some((id) => c.tradeIds.includes(id))) {
    return { label, problem: `勾選後查詢沒帶這條,送出 ${sent.join(",")}` };
  }
  return { label, defaultChecked };
}

beforeAll(async () => {
  setupTests({ language: "cmn-Hant", realm: "pc-ggg", leagueId: "Standard" });
  await init("cmn-Hant");
  for (const base of BASES) {
    for (const rarity of RARITIES) {
      for (const c of cases) outcomes.push(...audit([c], base, rarity));
      for (const combo of combos) {
        outcomes.push(...audit(combo.members, base, rarity, combo.from));
      }
    }
  }
}, 300_000);

describe("碑牌詞綴全量稽核", () => {
  it("稽核真的跑過夠多條目", () => {
    // 空轉通過比沒有測試更危險
    const perItem =
      cases.length + combos.reduce((n, combo) => n + combo.members.length, 0);
    expect(BASES.length).toBe(8);
    expect(cases.length).toBeGreaterThan(150);
    expect(combos.length).toBeGreaterThan(0);
    expect(outcomes.length).toBe(perItem * BASES.length * RARITIES.length);
    console.log(
      `碑牌稽核:${BASES.length} 種基底 × ${RARITIES.length} 種稀有度 × ` +
        `${cases.length} 句型 + ${combos.length} 組多行詞綴 = ${outcomes.length} 項`,
    );
  });

  it("每一種句型都讀得出來、交易 id 正確、面板看得到、勾了查詢會帶", () => {
    const failed = outcomes.filter((o) => o.problem);
    expect(failed.map((o) => `${o.label} → ${o.problem}`)).toEqual([]);
  });

  it("碑牌詞綴預設全部勾選", () => {
    // 上游對碑牌的既有行為(create-stat-filters.ts:`filter.disabled = false`)
    const unchecked = outcomes.filter((o) => o.defaultChecked === false);
    expect(unchecked.map((o) => o.label)).toEqual([]);
  });
});
