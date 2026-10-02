/**
 * exile-appraiser(2026-10-02 第 25 步):辨識語言獨立於客戶端語言 —— 符文塑形索引依「有效辨識語言」選。
 * 繁中客戶端 + 英文辨識(與反過來)時,另一個語言的物品名稱由 `ensureRuneshapeIndex` 另讀一次 items.ndjson;
 * refName(英文、poe.ninja 鍵)不受辨識語言影響,輸出的 `name`(台服交易站查詢用)仍是客戶端語言的名稱。
 * 繁中客戶端 + 繁中辨識、英文客戶端 + 英文辨識的結果與改前相同(`matchRunesRows` 預設索引)。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { init, ITEMS_ITERATOR } from "@/assets/data";
import { ensureRuneshapeIndex, matchRunesRows, matchRunesRowsFor, runeshapeIndexFor, type RuneshapeOcrRow } from "@/runeshape/match";

const FIX = path.join(__dirname, "fixtures/ocr");
interface OcrLine { text: string; x: number; y: number; w: number; h: number }
interface Fixture { scale: number; lines: OcrLine[] }
const rowsOf = (name: string): RuneshapeOcrRow[] => {
  const f = JSON.parse(fs.readFileSync(path.join(FIX, `${name}.ocr.json`), "utf8")) as Fixture;
  return f.lines.map((l) => ({ text: l.text, x: l.x / f.scale, y: l.y / f.scale, w: l.w / f.scale, h: l.h / f.scale }));
};
const refs = (rows: Array<{ refName?: string; kind: string; quantity: number }>) => rows.map((r) => [r.kind, r.refName ?? null, r.quantity]);
const nameOf = (ns: string, ref: string): string | undefined => {
  for (const r of ITEMS_ITERATOR(`"namespace": "${ns}"`)) if (r.refName === ref) return r.name;
  return undefined;
};

const EN_RUNES = [
  "Thrud's Might", "Perfect Orb of Transmutation", "Perfect Orb of Augmentation", "Masterwork Rune", "Rune of Confrontation",
  "Rune of Reach", "Rune of Consistency", "Rune of the Blossom", "Rune of the Prism", "Rune of Foundations", "Rune of Accumulation",
];

describe("客戶端繁中 + 辨識 English(英文截圖 runeshape-runes-en-03)", () => {
  it("英文索引另讀英文物品名稱:11 列全部精確對上同樣的 refName;name 是繁中名稱", async () => {
    await init("cmn-Hant");
    expect(runeshapeIndexFor("en")).toBeUndefined(); // 還沒準備好 → 呼叫端要等 ensure
    expect(matchRunesRowsFor(rowsOf("runeshape-runes-en-03"), "en")).toBeUndefined();
    expect(await ensureRuneshapeIndex("en")).toBe(true);
    const rows = matchRunesRowsFor(rowsOf("runeshape-runes-en-03"), "en")!;
    const shown = rows.filter((r) => !r.offPanel && !r.undiscovered);
    expect(shown.map((r) => r.refName)).toEqual(EN_RUNES);
    expect(shown.every((r) => r.match === "exact")).toBe(true);
    // name = 客戶端(繁中)語言的名稱,不是辨識用的英文名
    const reach = shown.find((r) => r.refName === "Rune of Reach")!;
    expect(reach.name).toBe(nameOf("ITEM", "Rune of Reach"));
    expect(reach.name).not.toBe("Rune of Reach");
    expect(/[㐀-鿿]/.test(reach.name!)).toBe(true);
  });
  it("同一個辨識語言只讀一次(同時多次呼叫共用同一個結果)", async () => {
    await init("cmn-Hant");
    const [a, b] = await Promise.all([ensureRuneshapeIndex("en"), ensureRuneshapeIndex("en")]);
    expect(a && b).toBe(true);
    expect(runeshapeIndexFor("en")).toBe(runeshapeIndexFor("en"));
  });
  it("辨識 = 客戶端語言(繁中)時用記憶體裡的索引,結果與 matchRunesRows 逐列相同", async () => {
    await init("cmn-Hant");
    expect(await ensureRuneshapeIndex("zh")).toBe(true);
    const rows = rowsOf("runeshape-rewards-02");
    expect(matchRunesRowsFor(rows, "zh")).toEqual(matchRunesRows(rows));
  });
});

describe("客戶端 English + 辨識繁體中文(繁中截圖 runeshape-rewards-02)", () => {
  it("繁中索引另讀繁中物品名稱:refName 與「繁中客戶端 + 繁中辨識」逐列相同;name 是英文", async () => {
    await init("cmn-Hant");
    const expected = matchRunesRows(rowsOf("runeshape-rewards-02"));
    await init("en");
    expect(matchRunesRowsFor(rowsOf("runeshape-rewards-02"), "zh")).toBeUndefined();
    expect(await ensureRuneshapeIndex("zh")).toBe(true);
    const got = matchRunesRowsFor(rowsOf("runeshape-rewards-02"), "zh")!;
    expect(refs(got)).toEqual(refs(expected));
    expect(got.some((r) => r.refName)).toBe(true);
    for (const r of got) if (r.refName && r.kind === "item") expect(r.name).toBe(nameOf("ITEM", r.refName));
  });
  it("英文客戶端 + 英文辨識 = 改前行為(預設索引)", async () => {
    await init("en");
    const rows = rowsOf("runeshape-runes-en-03");
    expect(matchRunesRowsFor(rows, "en")).toEqual(matchRunesRows(rows));
  });
});
