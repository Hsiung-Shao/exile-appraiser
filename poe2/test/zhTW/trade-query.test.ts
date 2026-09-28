import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import { createPresets } from "@/web/price-check/filters/create-presets";
import { createTradeRequest } from "@/web/price-check/trade/pathofexile-trade";
import { apiToSatisfySearch } from "@/web/price-check/trade/common";
import { listFixtures } from "./helpers/fixture-harness";

/**
 * 查詢組裝層的回歸網:把繁中 fixture 解析後,走與 CheckedItem.vue 完全相同的路徑
 * (createPresets → 取 active preset → createTradeRequest)組出送給交易 API 的 body。
 *
 * 不打網路。`DUMP_TRADE_QUERY=<目錄>` 時把每件的 body 寫成 JSON,供離線診斷用
 * (例如拿去對 /api/trade2/search 發一次,看 GGG 回什麼)。
 *
 * 參數對齊使用者實機設定(2026-09-13):language cmn-Hant、realm pc-ggg(→ useEn=true,
 * 送英文 refName)、league "Runes of Aldur"、searchStatRange 10、defaultAllSelected=false、
 * collapseListings=api、activateStockFilter=false。
 */

const LEAGUE = "Runes of Aldur";
const DUMP_DIR = process.env.DUMP_TRADE_QUERY;

interface Built {
  name: string;
  api: "trade" | "bulk";
  presetId: string;
  body: ReturnType<typeof createTradeRequest>;
  enabledStats: string[];
  /** 面板上每一條可勾的 stat filter(含 hidden),供斷言用 */
  filters: Array<{
    statRef: string;
    tradeId: string[];
    hidden?: string;
    disabled: boolean;
    value?: number;
  }>;
}

const built = new Map<string, Built>();

beforeAll(async () => {
  setupTests({ language: "cmn-Hant", realm: "pc-ggg", leagueId: LEAGUE });
  await init("cmn-Hant");

  for (const fixture of await listFixtures("cmn-Hant")) {
    const parsed = parseClipboard(fixture.text);
    if (parsed.isErr()) continue;
    const item = parsed.value;

    const presets = createPresets(item, {
      league: LEAGUE,
      currency: undefined,
      listingType: undefined,
      collapseListings: "api",
      activateStockFilter: false,
      searchStatRange: 10,
      useEn: true,
      defaultAllSelected: false,
    });
    const active = presets.presets.find((p) => p.id === presets.active)!;
    const api = apiToSatisfySearch(item, active.stats, active.filters);
    if (api === "bulk") {
      active.filters.trade.listingType = "online";
    }
    const body = createTradeRequest(active.filters, active.stats, item);
    const enabledStats = active.stats
      .filter((s) => !s.disabled)
      .map((s) => `${s.tradeId.join("+")} ${JSON.stringify(s.roll ?? null)}`);

    built.set(fixture.name, {
      name: fixture.name,
      api,
      presetId: presets.active,
      body,
      enabledStats,
      filters: active.stats.map((s) => ({
        statRef: s.statRef,
        tradeId: s.tradeId,
        hidden: s.hidden,
        disabled: s.disabled,
        value: s.roll?.value,
      })),
    });

    if (DUMP_DIR) {
      fs.mkdirSync(DUMP_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(DUMP_DIR, `query-${fixture.name}.json`),
        JSON.stringify(
          { api, presetId: presets.active, enabledStats, body },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    }
  }
}, 180_000);

describe("trade query for cmn-Hant fixtures (realm pc-ggg)", () => {
  it("every fixture builds a request through the trade API", () => {
    expect(built.size).toBeGreaterThan(0);
    for (const b of built.values()) {
      expect(b.api, `${b.name} should use the item trade API`).toBe("trade");
      expect(b.body.query.status.option).toBe("securable");
    }
  });

  it("sends English names/types on the international realm", () => {
    // 傳奇:用英文名 + 英文基底精確搜尋。
    const ring = built.get("ring-unique-cracklecreep-01")!;
    expect(ring.body.query.name).toBe("Cracklecreep");
    expect(ring.body.query.type).toBe("Ruby Ring");
    expect(ring.enabledStats.length).toBeGreaterThan(0);

    // 稀有且 5 條以上隨機詞綴:改以分類搜尋而非基底(filters.searchRelaxed),
    // body 裡不得漏出 `type`。
    const wand = built.get("wand-rare-dueling-wand-01")!;
    expect(wand.body.query.type).toBeUndefined();
    expect(wand.body.query.filters.type_filters?.filters.category?.option).toBe(
      "weapon.wand",
    );
    // 這支法杖預設只開「賦予技能」一條,而且必須以 `skill.` 群組 id 送出。
    expect(wand.enabledStats.map((s) => s.split(" ")[0])).toEqual([
      "skill.spellslinger_invocation",
    ]);

    const boots = built.get("boots-rare-luxurious-slippers-01")!;
    expect(boots.body.query.type).toBeUndefined();
    expect(
      boots.body.query.filters.type_filters?.filters.category?.option,
    ).toBe("armour.boots");
    expect(boots.body.query.filters.equipment_filters?.filters.es?.min).toBe(
      170,
    );
  });

  it("resolves a unique whose translated base maps to two English bases", () => {
    // 緊繃十字弓 is both "Taut Crossbow" and "Tense Crossbow"; Rampart Raptor
    // only exists on the latter. Upstream ended up with no variant at all and
    // threw item.parse_error.
    const crossbow = built.get("crossbow-unique-rampart-raptor-01")!;
    expect(crossbow.body.query.name).toBe("Rampart Raptor");
    expect(crossbow.body.query.type).toBe("Tense Crossbow");
  });

  it("builds the Mageblood legacy filters from the zh-TW advanced text", () => {
    // 遊戲印成「水銀(紫晶-黃玉)之遺」,範圍夾在句中;沒解到 Legacy 時上游會在
    // buildMageBloodNotFilter 對 undefined 取 tradeId 而整個查詢炸掉。
    const belt = built.get("belt-unique-mageblood-01")!;
    expect(belt.presetId).toBe("filters.preset_exact");
    expect(belt.body.query.name).toBe("Mageblood");
    const andIds = belt.body.query.stats[0].filters
      .filter((f) => !f.disabled)
      .map((f) => f.id);
    // 水銀=8、黃金=5、堅岩=2(黃金出現兩次 → 重複濾鏡)
    expect(andIds).toEqual(
      expect.arrayContaining([
        "explicit.stat_264262054|8",
        "explicit.stat_264262054|5",
        "explicit.stat_264262054|2",
      ]),
    );
    expect(belt.body.query.stats.some((g) => g.type === "count")).toBe(true);
  });

  it("keeps DPS/defence source mods as hidden, unticked filters", () => {
    // 上游把「增加物理傷害%」「附加 X 至 Y 傷害」「增加護甲/能量護盾%」吃進
    // DPS / 防禦值偽屬性後就從清單拿掉,T1 詞綴無法單獨搜尋。fork 改成保留為
    // hidden + 未勾選,並且預設查詢不得因此多送任何條件。
    const spear = built.get("spear-rare-soaring-spear-01")!;
    const phys = spear.filters.find(
      (f) => f.statRef === "#% increased Physical Damage",
    );
    expect(phys).toBeDefined();
    expect(phys!.hidden).toBe("filters.hide_used_in_prop");
    expect(phys!.disabled).toBe(true);
    expect(phys!.value).toBe(176);
    expect(phys!.tradeId).toEqual(["explicit.stat_1509134228"]);
    expect(
      spear.filters.some((f) => f.statRef === "Adds # to # Fire Damage"),
    ).toBe(true);
    // 偽屬性本身還在,而且仍是預設勾選的那幾條
    expect(spear.enabledStats.map((s) => s.split(" ")[0])).toContain(
      "item.physical_dps",
    );
    expect(
      spear.body.query.stats
        .flatMap((g) => g.filters)
        .some((f) => f.id === "explicit.stat_1509134228" && !f.disabled),
    ).toBe(false);

    const boots = built.get("boots-rare-luxurious-slippers-01")!;
    const es = boots.filters.filter(
      (f) => f.statRef === "#% increased Energy Shield",
    );
    // 上游在建 UI 濾鏡時就把有 explicit id 的 crafted 併進 explicit 同一條
    // (30 + 68 = 98,兩個來源),這裡沿用同一條規則,只是不再把它丟掉。
    expect(es).toHaveLength(1);
    expect(es[0].value).toBe(98);
    expect(es[0].hidden).toBe("filters.hide_used_in_prop");
    expect(es[0].disabled).toBe(true);
  });

  it("every stat filter id sent exists in the loaded trade stats", () => {
    // 擋住「stat 被放進交易 API 沒有的群組」(例如只有 explicit.* 的 stat 卻送成 crafted.*)。
    for (const b of built.values()) {
      for (const group of b.body.query.stats) {
        for (const f of group.filters) {
          expect(f.id, `${b.name}: ${f.id}`).toMatch(
            /^(pseudo|explicit|implicit|fractured|crafted|enchant|rune|desecrated|sanctum|skill)\.|^item\./,
          );
        }
      }
    }
  });
});
