import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "@specs/vitest.setup";
import { init, ITEM_BY_TRANSLATED } from "@/assets/data";
import { parseClipboard } from "@/parser";

/**
 * 2026-11-27 同類掃描:同一個繁中名對到好幾個英文物品時,名稱索引的二分搜尋只落到其中一筆,其他的查不到。
 * 改成收齊同名的每一筆,讓後面的步驟(傳奇底材、disc)有得挑。
 * 還分不出來、維持資料順序第一個的:絕望 = Despair(技能)/ Desperation(輔助)(解析器沒保留物品種類那行)、
 * 目眩 = Daze / Dazzle、湧升流 I = Upwelling I / II(GGPK 本身同字)、緊繃十字弓 = Taut / Tense Crossbow(非傳奇,缺底材數值)。
 */
beforeAll(async () => {
  setupTests({ language: "cmn-Hant" });
  await init("cmn-Hant");
});

describe("同名物品查詢收齊每一筆", () => {
  for (const [ns, name, refs] of [
    ["GEM", "絕望", ["Despair", "Desperation"]],
    ["GEM", "目眩", ["Daze", "Dazzle"]],
    ["GEM", "湧升流 I", ["Upwelling I", "Upwelling II"]],
    ["ITEM", "緊繃十字弓", ["Taut Crossbow", "Tense Crossbow"]],
  ] as const) {
    it(`${name} → ${refs.join(" / ")}`, () => {
      expect(ITEM_BY_TRANSLATED(ns, name)?.map((x) => x.refName).sort()).toEqual([...refs].sort());
    });
  }

  // 失敗代表:同名同底材的傳奇留著交易站沒有的舊拼法列(收齊同名後可能取到它,查不到掛單;規則 P3)
  it("同名同底材的傳奇,每一列的英文名都在交易站", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../../data/poe2");
    const trade = JSON.parse(fs.readFileSync(path.join(dir, "trade/intl/items.json"), "utf8")).result
      .flatMap((g: { entries: Array<{ name?: string, type: string, flags?: { unique?: boolean } }> }) => g.entries)
      .filter((e: { flags?: { unique?: boolean } }) => e.flags?.unique)
      .map((e: { name?: string, type: string }) => `${e.name}|${e.type}`);
    const set = new Set<string>(trade);
    type Row = { name: string, refName: string, unique?: { base: string } };
    const rows = (fs.readFileSync(path.join(dir, "cmn-Hant/items.ndjson"), "utf8").split(/\r?\n/).filter(Boolean)
      .map((l: string) => JSON.parse(l)) as Row[]).filter((r) => r.unique);
    const groups = new Map<string, Row[]>();
    for (const r of rows) { const k = `${r.name}|${r.unique!.base}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    const bad = [...groups.values()].filter((g) => new Set(g.map((r) => r.refName)).size > 1)
      .flatMap((g) => g.filter((r) => !set.has(`${r.refName}|${r.unique!.base}`)).map((r) => r.refName));
    expect(bad).toEqual([]);
  });

  it("傳奇十字弓(壁壘猛禽)的底材 緊繃十字弓 只留 Tense Crossbow 那個變體", () => {
    const text = ["物品種類: 十字弓", "稀有度: 傳奇", "壁壘猛禽", "緊繃十字弓", "--------", "物品等級: 80"].join("\r\n") + "\r\n";
    const r = parseClipboard(text);
    if (r.isErr()) throw new Error(String(r.error));
    // infoVariants 只在解析狀態上(parser-fixtures 也這樣讀)
    const variants = (r.value as unknown as { infoVariants: Array<{ unique?: { base: string } }> }).infoVariants;
    expect(variants.map((x) => x.unique?.base)).toEqual(["Tense Crossbow"]);
  });
});
