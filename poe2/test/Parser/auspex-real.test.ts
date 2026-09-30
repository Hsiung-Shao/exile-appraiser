import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init } from "@/assets/data";
import { parseClipboard } from "@/parser";
import type { ParsedItem } from "@/parser";

/**
 * exile-appraiser:使用者 2026-09-30 提供的**遊戲內真實** Ctrl+Alt+C(繁中)觀鳥者。
 * 與合成 fixture 的差異:`賦予技能` 區塊、`— 無法變動的值` 後綴、`{ 傳奇詞綴 — 閃避 }` 標籤、需求的 `(augmented)`。
 */
describe("觀鳥者:遊戲內真實進階複製(繁中)", () => {
  let item: ParsedItem;
  beforeAll(async () => {
    setupTests({ language: "cmn-Hant" });
    await init("cmn-Hant");
    const text = fs.readFileSync(path.resolve(__dirname, "fixtures/auspex-real-advanced.zh.txt"), "utf8");
    const res = parseClipboard(text);
    if (res.isErr()) throw new Error(String(res.error));
    item = res.value;
  });

  it("名稱與底材", () => {
    expect(item.info.refName).toBe("The Auspex");
    expect(item.unknownModifiers.length).toBe(0);
  });

  it("六條傳奇詞綴與賦予技能都對到 trade id", () => {
    const ids = item.newMods.flatMap((m) => m.stats.flatMap((s) => Object.values(s.stat.trade.ids).flat()));
    for (const id of [
      "skill.summon_mist_raven",
      "explicit.stat_124859000",
      "explicit.stat_3299347043",
      "explicit.stat_3639275092",
      "explicit.stat_1675120891",
      "explicit.stat_3628041050",
      "explicit.stat_3198163869",
    ]) expect(ids).toContain(id);
  });

  it("數值範圍取自進階複製", () => {
    const life = item.newMods.flatMap((m) => m.stats).find((s) => s.stat.ref === "# to maximum Life")!;
    expect(life.roll).toMatchObject({ value: 75, min: 70, max: 120 });
  });
});
