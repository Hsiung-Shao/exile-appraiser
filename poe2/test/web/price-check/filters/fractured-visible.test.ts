import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import { createPresets, createTradeRequest } from "../../../../src/index";
import {
  canToggleFractured,
  isFracturedOn,
} from "@/web/price-check/filters/fractured-toggle";
import * as fs from "node:fs";
import * as path from "node:path";
import { FIXTURES_DIR } from "../../../zhTW/helpers/fixture-harness";
import { setupTests } from "../../../vitest.setup";
import { FracturedItem } from "../../../Parser/items";

// 2026-10-14 使用者回報(PoE1)的同類問題在 PoE2:弓的破裂物理傷害被標成「用在 DPS 屬性」預設隱藏 → 要預設可見、帶切換鈕、不重複。
const PHYS = "Adds # to # Physical Damage";
const PHYS_IDS = ["explicit.stat_1940865751", "fractured.stat_1940865751"];
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
// 未汙染的頭盔、破裂混沌抗性被 pseudo「#% total to Chaos Resistance」吃掉 → 沒有 explicit 列,孿生拿出來
const HELMET_MODIFIABLE = fs
  .readFileSync(
    path.join(FIXTURES_DIR, "en", "helmet-rare-kamasan-tiara-01.txt"),
    "utf8",
  )
  .split(String.fromCharCode(13)).join("")
  .replace("--------" + String.fromCharCode(10) + "Twice Corrupted" + String.fromCharCode(10), "")
  .replace(
    '{ Suffix Modifier "of Bameth"',
    '{ Fractured Suffix Modifier "of Bameth"',
  );
function build(text = FracturedItem.rawText) {
  const item = parseClipboard(text)._unsafeUnwrap();
  const { presets, active } = createPresets(item, OPTS);
  return { item, preset: presets.find((p) => p.id === active)! };
}

beforeAll(async () => {
  setupTests({ language: "en" });
  await init("en");
});

describe("PoE2 破裂詞綴預設可見", () => {
  it("破裂物理傷害有一列在可見清單且帶切換鈕", () => {
    const { item, preset } = build();
    const rows = preset.stats.filter(
      (f) => f.statRef === PHYS && f.hidden == null,
    );
    expect(rows.length).toBe(1);
    expect(canToggleFractured(rows[0], item)).toBe(true);
  });

  it("同一條破裂詞綴只有一列可見", () => {
    const { preset } = build();
    expect(
      preset.stats.filter(
        (f) => f.hidden == null && f.tradeId.some((id) => PHYS_IDS.includes(id)),
      ).length,
    ).toBe(1);
  });

  it("讓破裂詞綴可見不改變預設查詢", () => {
    const { item, preset } = build();
    const req = JSON.stringify(createTradeRequest(preset, item));
    for (const f of preset.stats) f.hidden = "x";
    expect(JSON.stringify(createTradeRequest(preset, item))).toBe(req);
  });

  it("破裂詞綴被 pseudo 吃掉時,破裂孿生列可見、帶切換鈕、預設送破裂 id", () => {
    const { item, preset } = build(HELMET_MODIFIABLE);
    expect(item.isCorrupted).toBeFalsy();
    const t = preset.stats.filter((f) => canToggleFractured(f, item));
    const chaos = t.find((f) => f.statRef === "#% to Chaos Resistance")!;
    expect(chaos.tag).toBe("fractured");
    expect(chaos.hidden).toBeUndefined();
    expect(isFracturedOn(chaos)).toBe(true);
    expect(t.some((f) => f.tag === "pseudo")).toBe(false);
  });
});
