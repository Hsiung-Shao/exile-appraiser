/**
 * exile-appraiser(WP-S 兩段式):main 端的面板定位(`src/desecration/ocr-locate.ts`)。
 *
 * - 真實全螢幕截圖(well-of-souls-fullscreen-02,2000×1125)的 OCR 快照換算成 client 座標,當成「第 1 段 ×1」的輸入
 *   (實測 ×1 整張 4 行詞綴全對;快照是 ×3 產生的,座標 ÷ 3 後與 ×1 同一套座標系)。
 * - 裁切框必須包住 4 行詞綴、不含右側背包(x > 1300);只留框內的行再跑 renderer 的 `matchReveal`,三組結果與整張相同。
 * - `checkRegion`:完整框住 → ok;貼邊 / 命中太少 → 不採用。
 * 資料直接讀 data/poe2/desecration/tiers.json(不經 init())。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLocateIndex,
  checkRegion,
  expandBox,
  findPanelHits,
  lineLooksLikeMod,
  locatePanel,
  type Rect,
} from "@/desecration/ocr-locate";
import { matchReveal, normalizeOcrText, ocrIndex, type OcrTextLine } from "@/desecration/ocr-match";
import type { DesecrationData } from "@/desecration/infer";
import type { BaseProfiles, DesecrationTiers } from "@/desecration/types";

const DATA_DIR = path.resolve(__dirname, "../../../data/poe2/desecration");
const data: DesecrationData = {
  tiers: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tiers.json"), "utf8")) as DesecrationTiers,
  baseProfiles: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "base_profiles.json"), "utf8")) as BaseProfiles,
};
const idx = buildLocateIndex(data.tiers);

function loadSnapshot(name: string): { lines: OcrTextLine[]; w: number; h: number } {
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/ocr", `${name}.ocr.json`), "utf8")) as {
    srcW: number;
    srcH: number;
    scale: number;
    lines: OcrTextLine[];
  };
  return {
    w: snap.srcW,
    h: snap.srcH,
    lines: snap.lines.map((l) => ({
      text: l.text,
      x: l.x / snap.scale,
      y: l.y / snap.scale,
      w: l.w / snap.scale,
      h: l.h / snap.scale,
    })),
  };
}

const MODS = ["增加71%護甲值和閃避", "+60護甲值", "+59閃避值", "+16最大生命"];
const inside = (l: OcrTextLine, r: Rect) => l.x >= r.x && l.y >= r.y && l.x + l.w <= r.x + r.w && l.y + l.h <= r.y + r.h;

describe("模板索引", () => {
  it("skeleton 數與 renderer 的 ocrIndex 相同(同一套排除規則)", () => {
    expect(idx.set.size).toBe(ocrIndex(data).bySkeleton.size);
    expect(idx.list).toHaveLength(idx.set.size);
  });

  it("text.zhVariants 的寫法也收(`技能增加#%精魂保留效用` 只在變體裡)", () => {
    expect(lineLooksLikeMod("技 能 增 加 10 % 精 魂 保 留 效 用", idx)).toBe(true);
    expect(lineLooksLikeMod("增 加 5 % 施 放 速 度", idx)).toBe(true);
    const noVariants = buildLocateIndex({
      entries: data.tiers.entries.map((e) => ({ parts: e.parts.map((p) => ({ text: { zh: p.text.zh } })) })),
    });
    expect(noVariants.set.size).toBe(394);
    expect(lineLooksLikeMod("技 能 增 加 10 % 精 魂 保 留 效 用", noVariants)).toBe(false);
  });

  it("像不像詞綴:詞綴行 / 模糊一字 → 是;雜訊 → 否", () => {
    expect(lineLooksLikeMod("+ 60 護 甲 值", idx)).toBe(true);
    expect(lineLooksLikeMod("增 加 71 % 護 甲 值 和 閃 因", idx)).toBe(true); // 模糊(一字錯)
    for (const t of ["深 井", "確 認", "伙 的 生", "Ⅳ", "1 1", "〕 傳 點"]) expect(lineLooksLikeMod(t, idx)).toBe(false);
  });
});

describe("well-of-souls-fullscreen-02(2000×1125,右側開著背包)", () => {
  const snap = loadSnapshot("well-of-souls-fullscreen-02");
  const bounds: Rect = { x: 0, y: 0, w: snap.w, h: snap.h };

  it("命中恰好 4 行詞綴(雜訊不算)", () => {
    const found = findPanelHits(snap.lines, idx)!;
    expect(found).not.toBeNull();
    expect(found.hits.map((l) => normalizeOcrText(l.text)).sort()).toEqual([...MODS].sort());
  });

  it("裁切框包住 4 行詞綴、不含背包區(x > 1300)、夾在 client 內", () => {
    const loc = locatePanel(snap.lines, idx, bounds)!;
    expect(loc).not.toBeNull();
    console.log(`[locate] box=${JSON.stringify(loc.box)} lineH=${loc.lineH} crop=${JSON.stringify(loc.crop)}`);
    const mods = snap.lines.filter((l) => MODS.includes(normalizeOcrText(l.text)));
    expect(mods).toHaveLength(4);
    for (const l of mods) expect(inside(l, loc.crop)).toBe(true);
    expect(loc.crop.x + loc.crop.w).toBeLessThanOrEqual(1300);
    expect(loc.crop.x).toBeGreaterThanOrEqual(0);
    expect(loc.crop.y).toBeGreaterThanOrEqual(0);
    expect(loc.crop.y + loc.crop.h).toBeLessThanOrEqual(snap.h);
    // 外擴:水平每邊 ≥ 0.75 × 框寬、垂直每邊 ≥ 3 × 行高
    expect(loc.box.x - loc.crop.x).toBeGreaterThanOrEqual(0.75 * loc.box.w - 1);
    expect(loc.crop.x + loc.crop.w - (loc.box.x + loc.box.w)).toBeGreaterThanOrEqual(0.75 * loc.box.w - 1);
    expect(loc.box.y - loc.crop.y).toBeGreaterThanOrEqual(3 * loc.lineH - 1);
    expect(loc.crop.y + loc.crop.h - (loc.box.y + loc.box.h)).toBeGreaterThanOrEqual(3 * loc.lineH - 1);
    // 右側背包的「Ⅳ」、堆疊數不在框內
    for (const l of snap.lines.filter((l) => l.x > 1300)) expect(inside(l, loc.crop)).toBe(false);
  });

  it("只留框內的行(模擬第 2 段)→ matchReveal 三組結果與整張相同", () => {
    const loc = locatePanel(snap.lines, idx, bounds)!;
    const cropped = snap.lines.filter((l) => inside(l, loc.crop));
    const a = matchReveal(snap.lines, data);
    const b = matchReveal(cropped, data);
    if (!a.ok || !b.ok) throw new Error("預期 ok");
    const brief = (r: typeof a) =>
      r.ok ? r.groups.map((g) => [g.lines.map((l) => normalizeOcrText(l.text)), g.candidates.map((c) => c.entryIds)]) : null;
    expect(brief(b)).toEqual(brief(a));
    expect(b.groups).toHaveLength(3);
  });

  it("checkRegion:裁切框 → ok;框切掉一半 → touches-edge;只含 1 行 → too-few-hits", () => {
    const loc = locatePanel(snap.lines, idx, bounds)!;
    const inCrop = (r: Rect) => snap.lines.filter((l) => inside(l, r));
    expect(checkRegion(inCrop(loc.crop), idx, loc.crop, bounds)).toEqual({ ok: true, hits: 4 });
    // 下緣切在「+59閃避值」下方一點(最後一行「+16最大生命」掉出去,+59 貼底)
    const tight: Rect = { ...loc.crop, h: 645 + 18 + 5 - loc.crop.y };
    const r1 = checkRegion(inCrop(tight), idx, tight, bounds);
    expect(r1).toEqual({ ok: false, hits: 3, reason: "touches-edge" });
    const one: Rect = { x: 500, y: 600, w: 300, h: 40 };
    expect(checkRegion(inCrop(one), idx, one, bounds)).toMatchObject({ ok: false, reason: "too-few-hits" });
  });

  it("範圍邊界就是 client 邊界時,貼邊不算", () => {
    const box: Rect = { x: 0, y: 500, w: 200, h: 100 };
    const lines: OcrTextLine[] = [
      { text: "+ 60 護 甲 值", x: 0, y: 500, w: 90, h: 18 },
      { text: "+ 59 閃 避 值", x: 0, y: 528, w: 90, h: 18 },
    ];
    expect(checkRegion(lines, idx, { x: 0, y: 400, w: 400, h: 300 }, bounds).ok).toBe(true);
    expect(checkRegion(lines, idx, { x: 0, y: 499, w: 400, h: 300 }, bounds)).toMatchObject({ ok: false, reason: "touches-edge" });
    // expandBox 夾在 bounds 內
    const e = expandBox(box, 18, bounds);
    expect(e.x).toBe(0);
    expect(e.x + e.w).toBeLessThanOrEqual(bounds.w);
  });

  it("沒有任何像詞綴的行 → null(呼叫端退回整張 ×3)", () => {
    const noise = snap.lines.filter((l) => !MODS.includes(normalizeOcrText(l.text)));
    expect(locatePanel(noise, idx, bounds)).toBeNull();
  });

  it("well-of-souls-fullscreen-03(2000×1121):3 行詞綴都命中(含變體寫法),裁切框包住它們", () => {
    const s3 = loadSnapshot("well-of-souls-fullscreen-03");
    const MODS3 = ["減少49%你身上的中毒持續時間", "技能增加10%精魂保留效用", "+11點力量與敏捷"];
    const found = findPanelHits(s3.lines, idx)!;
    expect(found.hits.map((l) => normalizeOcrText(l.text)).sort()).toEqual([...MODS3].sort());
    const loc = locatePanel(s3.lines, idx, { x: 0, y: 0, w: s3.w, h: s3.h })!;
    for (const l of s3.lines.filter((l) => MODS3.includes(normalizeOcrText(l.text)))) expect(inside(l, loc.crop)).toBe(true);
    console.log(`[locate fullscreen-03] box=${JSON.stringify(loc.box)} crop=${JSON.stringify(loc.crop)} clusters=${JSON.stringify(loc.clusters)}`);
  });

  it("只認出 1 行時,垂直外擴仍 ≥ 14 行高(蓋得住整個面板)", () => {
    const one = snap.lines.filter((l) => normalizeOcrText(l.text) === "+60護甲值");
    const loc = locatePanel(one, idx, bounds)!;
    expect(loc.crop.h).toBeGreaterThanOrEqual(14 * loc.lineH - 1);
    for (const l of snap.lines.filter((l) => MODS.includes(normalizeOcrText(l.text)))) expect(inside(l, loc.crop)).toBe(true);
  });
});
