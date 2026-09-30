import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import type { ParsedItem } from "@/parser";
import { ItemCategory } from "@/parser/meta";
import { ItemRarity } from "@/parser/ParsedItem";
import { createPresets } from "@/web/price-check/filters/create-presets";
import { createTradeRequest } from "@/web/price-check/trade/pathofexile-trade";

/**
 * exile-appraiser:兩件使用者回報物品的回歸(2026-09-30)。fixture 在 `fixtures/`:
 *
 * | 檔案 | 來源 |
 * |---|---|
 * | `auspex-trade-copy.en.txt` | 使用者原文(逐字):交易站「複製物品」格式 —— 沒有 `Item Class:`、屬性段第一行是類別 `Body Armour` |
 * | `auspex-ingame.en.txt` | 由上一份改成遊戲 Ctrl+C 格式:補 `Item Class: Body Armours`(GGPK ItemClasses)、拿掉 `Body Armour` 行 |
 * | `auspex-ingame.zh.txt` | 依 GGPK 4.5.5.2 組的繁中 Ctrl+C:名稱 Words「觀鳥者」、基底 BaseItemTypes「精美背心」、類別 ItemClasses「胸甲」、各詞綴 stat_descriptions tc、風味文字 FlavourText `FourUniqueBodyDex16`;`閃避值: … (augmented)`、`需求: 等級 …, … 敏捷` 的寫法照既有真實繁中 fixture |
 * | `auspex-advanced.zh.txt` | 同上改成進階格式(Ctrl+Alt+C):`{ 傳奇詞綴 }` 標頭**不含標籤**(標籤未知,不影響解析);數值範圍取 PoB2 `Uniques/body.lua`(210-240 / 70-120) |
 * | `auspex-no-item-class.zh.txt` | 繁中版的「沒有物品種類行」:結構照交易站複製格式,類別行 `胸甲`(合成,驗 parser 修正在繁中同樣成立) |
 * | `delirium-tablet-magic.zh.txt` | 使用者原文(逐字):繁中進階複製 |
 * | `delirium-tablet-magic.en.txt` | 依 GGPK 組的英文對應:詞綴名 Mods `TowerExperienceGainIncrease1`「Elevated」/ `TowerDeliriumMonsterSplinterIncrease`「of the Simulacrum」、詞綴文字 `tablet_stat_descriptions.csd`、說明 ClientStrings `ItemDescriptionPrecursorTablet`;`Adds a Mirror of Delirium to a Map` 行尾空白是否印出未確認(GGPK 模板在 `\n` 前有一個空白),這裡不帶 |
 */

const FIXTURES = path.resolve(__dirname, "fixtures");
const read = (name: string) =>
  fs.readFileSync(path.join(FIXTURES, name), "utf8");

async function useLang(lang: "en" | "cmn-Hant") {
  setupTests({ language: lang });
  await init(lang);
}

function parse(name: string): ParsedItem {
  const res = parseClipboard(read(name));
  if (res.isErr()) throw new Error(`${name}: ${res.error}`);
  return res.value;
}

/** 走與 CheckedItem.vue 相同的路徑,把指定 trade id 的篩選打開後組出查詢 body */
function requestWith(item: ParsedItem, useEn: boolean, enable: string[]) {
  const presets = createPresets(item, {
    league: "Standard",
    currency: undefined,
    listingType: undefined,
    collapseListings: "api",
    activateStockFilter: false,
    searchStatRange: 10,
    useEn,
    defaultAllSelected: false,
  });
  const active = presets.presets.find((p) => p.id === presets.active)!;
  for (const s of active.stats) {
    if (s.tradeId.some((id) => enable.includes(id))) s.disabled = false;
  }
  return {
    stats: active.stats,
    body: createTradeRequest(active.filters, active.stats, item),
  };
}

const AUSPEX_STATS: Array<[ref: string, tradeId: string]> = [
  ["#% increased Evasion Rating", "explicit.stat_124859000"],
  ["# to maximum Life", "explicit.stat_3299347043"],
  ["#% increased Attribute Requirements", "explicit.stat_3639275092"],
  [
    "Chance to Deflect is Lucky while on Low Life",
    "explicit.stat_1675120891",
  ],
  [
    "Enemies in your Presence gain 1 Gruelling Madness each second",
    "explicit.stat_3628041050",
  ],
  ["Raven-Touched", "explicit.stat_3198163869"],
];

function expectAuspex(item: ParsedItem) {
  expect(item.info.refName).toBe("The Auspex");
  expect(item.info.unique?.base).toBe("Exquisite Vest");
  expect(item.category).toBe(ItemCategory.BodyArmour);
  expect(item.rarity).toBe(ItemRarity.Unique);
  expect(item.unknownModifiers).toEqual([]);
  const refs = item.statsByType.map((s) => s.stat.ref);
  for (const [ref, tradeId] of AUSPEX_STATS) {
    expect(refs, ref).toContain(ref);
    const stat = item.statsByType.find((s) => s.stat.ref === ref)!;
    expect(Object.values(stat.stat.trade.ids).flat(), ref).toContain(tradeId);
  }
}

function expectRavenQuery(item: ParsedItem, useEn: boolean) {
  const { stats, body } = requestWith(item, useEn, [
    "explicit.stat_3198163869",
  ]);
  // 每條詞綴都有對應篩選(交易站 intl / tw 快照都有這 6 個 id)
  const ids = stats.flatMap((s) => s.tradeId);
  for (const [, tradeId] of AUSPEX_STATS) expect(ids).toContain(tradeId);
  const sent = body.query.stats.flatMap((g) => g.filters.map((f) => f.id));
  expect(sent).toContain("explicit.stat_3198163869");
  expect(body.query.name).toBe(useEn ? "The Auspex" : "觀鳥者");
}

describe("觀鳥者 The Auspex:渡鴉所觸 Raven-Touched", () => {
  it("英文:交易站複製格式(沒有 Item Class 行)能解析,六條詞綴都辨識", async () => {
    await useLang("en");
    const item = parse("auspex-trade-copy.en.txt");
    expectAuspex(item);
    expectRavenQuery(item, true);
  });

  it("英文:遊戲 Ctrl+C 格式", async () => {
    await useLang("en");
    const item = parse("auspex-ingame.en.txt");
    expectAuspex(item);
    expectRavenQuery(item, true);
  });

  it("繁中:遊戲 Ctrl+C 格式(國際服送英文、台服送繁中)", async () => {
    await useLang("cmn-Hant");
    const item = parse("auspex-ingame.zh.txt");
    expectAuspex(item);
    expectRavenQuery(item, true);
    expectRavenQuery(item, false);
  });

  it("繁中:進階格式", async () => {
    await useLang("cmn-Hant");
    const item = parse("auspex-advanced.zh.txt");
    expectAuspex(item);
    expectRavenQuery(item, true);
  });

  it("繁中:沒有物品種類行也能解析", async () => {
    await useLang("cmn-Hant");
    const item = parse("auspex-no-item-class.zh.txt");
    expectAuspex(item);
  });

  it("沒有 Item Class 行、稀有度是寶石時仍照上游當成寶石(meta 技能寶石)", async () => {
    await useLang("en");
    const res = parseClipboard(
      "Rarity: Gem\nMirage Archer\n--------\nBuff, Persistent, Trigger, Duration, Meta\nLevel: 14\n",
    );
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().category).toBe(ItemCategory.Gem);
  });
});

describe("魔法碑牌:後綴名裡的物品名不可被當成底材", () => {
  const EXPLICIT = ["explicit.stat_57434274", "explicit.stat_3836551197"];

  function expectTablet(item: ParsedItem) {
    expect(item.info.refName).toBe("Delirium Tablet");
    expect(item.category).toBe(ItemCategory.Tablet);
    expect(item.rarity).toBe(ItemRarity.Magic);
    expect(item.unknownModifiers).toEqual([]);
    const ids = item.statsByType.flatMap((s) =>
      Object.values(s.stat.trade.ids).flat(),
    );
    for (const id of [...EXPLICIT, "implicit.stat_3879011313"]) {
      expect(ids).toContain(id);
    }
  }

  it("繁中:昇華的幻像異界之譫妄碑牌 → 譫妄碑牌(不是幻像異界)", async () => {
    await useLang("cmn-Hant");
    const item = parse("delirium-tablet-magic.zh.txt");
    expectTablet(item);
    expect(requestWith(item, true, EXPLICIT).body.query.type).toBe(
      "Delirium Tablet",
    );
    expect(requestWith(item, false, EXPLICIT).body.query.type).toBe(
      "譫妄碑牌",
    );
  });

  it("英文:Elevated Delirium Tablet of the Simulacrum", async () => {
    await useLang("en");
    const item = parse("delirium-tablet-magic.en.txt");
    expectTablet(item);
    expect(requestWith(item, true, EXPLICIT).body.query.type).toBe(
      "Delirium Tablet",
    );
  });
});
