/**
 * exile-appraiser(2026-10-02 第 25 步):褻瀆比對的文字語言由呼叫端(有效辨識語言)決定,不再只看載入的客戶端資料。
 * 繁中客戶端 + 英文辨識:`matchRevealLines(rows, { lang: "en" })` 對英文截圖(well-of-souls-weapon-en-04)三組全對上,
 * 結果與英文客戶端(預設語言)逐位元相同;省略 `lang` = 跟載入的客戶端語言(改版前行為)。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { init } from "@/assets/data";
import { loadedOcrTextLang, matchRevealLines } from "@/desecration/reveal-entry";
import type { OcrTextLine } from "@/desecration/ocr-match";

interface Snap { scale: number; lines: OcrTextLine[] }
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/ocr/well-of-souls-weapon-en-04.ocr.json"), "utf8")) as Snap;
const X3: OcrTextLine[] = snap.lines.map((l) => ({ text: l.text, x: l.x / snap.scale, y: l.y / snap.scale, w: l.w / snap.scale, h: l.h / snap.scale }));

describe("matchRevealLines 的文字語言", () => {
  it("英文客戶端(預設語言)= 英文;三組全對上", async () => {
    await init("en");
    expect(loadedOcrTextLang()).toBe("en");
    const r = matchRevealLines(X3)!;
    expect(r.ok).toBe(true);
    expect(r.ok && r.groups).toHaveLength(3);
  });
  it("繁中客戶端 + 辨識 English:`lang: en` 對上英文截圖,結果與英文客戶端逐位元相同", async () => {
    await init("en");
    const asEnClient = JSON.stringify(matchRevealLines(X3));
    await init("cmn-Hant");
    expect(loadedOcrTextLang()).toBe("zh");
    const r = matchRevealLines(X3, { lang: "en" })!;
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).toBe(asEnClient);
  });
  it("繁中客戶端、省略 lang = 繁中比對(改版前):英文截圖對不上", async () => {
    await init("cmn-Hant");
    const r = matchRevealLines(X3)!;
    expect(r.ok).toBe(false);
  });
  it("英文客戶端 + 辨識繁體中文:`lang: zh` 不用英文索引,英文截圖對不上", async () => {
    await init("en");
    const r = matchRevealLines(X3, { lang: "zh" })!;
    expect(r.ok).toBe(false);
  });
});
