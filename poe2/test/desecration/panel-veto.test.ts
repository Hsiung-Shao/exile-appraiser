/**
 * exile-appraiser(2026-10-01 第 13 步):褻瀆揭露面板的否決規則(`src/desecration/panel-veto.ts`)與它在
 * main 定位(`ocr-locate.ts` `findPanelHits` / `locatePanel`)、renderer 比對(`ocr-match.ts` `matchReveal`)兩層的效果。
 *
 * - 正樣本:三張真實揭露面板快照(`fixtures/ocr/well-of-souls-*.ocr.json`)一條規則都不觸發(量測值寫在斷言裡)。
 * - 負樣本(真實):`tooltip-gloves-advanced-01`(使用者回報的全螢幕截圖:沒開揭露面板、背包手套的進階詞綴說明開著;
 *   畫面上還疊著舊版 overlay 誤出的徽章與提示)→ 三層都不是面板。快照由 `node scripts/ocr-fixture.mjs --with-locate tooltip` 產生(×3 + 整張 ×1)。
 * - 負樣本(合成,依真實快照的行資料):同一個浮窗去掉進階說明 + 分隔線、進階說明的「前綴 / 後綴詞綴」標頭(有 / 沒有關鍵字)、
 *   5 組以上詞綴的稀有裝備(有空隙 / 連續)。
 * 不依賴 WinRT;資料直接讀 data/poe2/desecration(不經 init())。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { matchReveal, normalizeOcrText, type OcrTextLine } from "@/desecration/ocr-match";
import {
  buildLocateIndex,
  findPanelHits,
  lineLooksLikeMod,
  locatePanel,
  modLines,
  type PanelHitsDiag,
} from "@/desecration/ocr-locate";
import {
  MAX_GROUP_LINES,
  MAX_PANEL_GROUPS,
  panelAnchorScore,
  panelVeto,
  shapeGroups,
  shapeLineH,
  vetoLineReason,
} from "@/desecration/panel-veto";
import type { DesecrationData } from "@/desecration/infer";
import type { BaseProfiles, DesecrationTiers } from "@/desecration/types";

const DATA_DIR = path.resolve(__dirname, "../../../data/poe2/desecration");
const data: DesecrationData = {
  tiers: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tiers.json"), "utf8")) as DesecrationTiers,
  baseProfiles: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "base_profiles.json"), "utf8")) as BaseProfiles,
};
const idx = buildLocateIndex(data.tiers);

interface Snap {
  srcW: number;
  srcH: number;
  scale: number;
  lines: OcrTextLine[];
  locate?: { scale: number; lines: OcrTextLine[] };
}
const readSnap = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/ocr", `${name}.ocr.json`), "utf8")) as Snap;
const toClient = (lines: OcrTextLine[], scale: number): OcrTextLine[] =>
  lines.map((l) => ({ text: l.text, x: l.x / scale, y: l.y / scale, w: l.w / scale, h: l.h / scale }));
const norm = (s: string) => normalizeOcrText(s);
const cy = (l: OcrTextLine) => l.y + l.h / 2;

const POSITIVES = ["well-of-souls-body-armour-01", "well-of-souls-fullscreen-02", "well-of-souls-fullscreen-03"];

describe("正樣本:三張真實揭露面板,否決規則一條都不觸發", () => {
  for (const name of POSITIVES) {
    const s = readSnap(name);
    const lines = toClient(s.lines, s.scale);
    const hits = modLines(lines, idx);
    const others = lines.filter((l) => !hits.includes(l));
    it(`${name}:組數 ≤ 3、每組 ≤ 3 行、整張沒有冒號 / 關鍵字行、詞綴行之間沒有夾未命中行`, () => {
      const H = shapeLineH(hits);
      const groups = shapeGroups(hits, H);
      expect(groups.length).toBe(3);
      expect(Math.max(...groups.map((g) => g.length))).toBeLessThanOrEqual(MAX_GROUP_LINES);
      // 組內 1.50–1.54 × 行高、組間 2.31–4.64 ×(都在分組門檻 1.9 的兩側)
      for (const g of groups) for (let i = 1; i < g.length; i++) expect((cy(g[i]) - cy(g[i - 1])) / H).toBeLessThan(1.6);
      for (let i = 1; i < groups.length; i++) {
        const prev = groups[i - 1];
        expect((cy(groups[i][0]) - cy(prev[prev.length - 1])) / H).toBeGreaterThan(2.3);
      }
      expect(others.filter((u) => vetoLineReason(u.text))).toEqual([]);
      const y0 = Math.min(...hits.map((l) => l.y));
      const y1 = Math.max(...hits.map((l) => l.y + l.h));
      expect(others.filter((u) => cy(u) > y0 && cy(u) < y1 && u.x < 1300)).toEqual([]);
      expect(panelVeto(hits, others)).toBeNull();
      const diag: PanelHitsDiag = { vetoes: [] };
      expect(findPanelHits(lines, idx, diag)).not.toBeNull();
      expect(diag.vetoes).toEqual([]);
      const r = matchReveal(lines, data);
      expect(r.ok).toBe(true);
    });
  }
  it("面板固定元素只加分:fullscreen-02 有「確認」= 1、fullscreen-03 另有「靈魂之井」標題(OCR 掉首字)= 2、裁切圖沒有 = 0", () => {
    const score = (name: string) => {
      const s = readSnap(name);
      const lines = toClient(s.lines, s.scale);
      const hits = modLines(lines, idx);
      return panelAnchorScore(hits, lines.filter((l) => !hits.includes(l)));
    };
    expect(POSITIVES.map(score)).toEqual([0, 1, 2]);
  });
});

describe("vetoLineReason", () => {
  it("冒號(半形 / 全形)、浮窗關鍵字 → 否決;需求 / 品質只在沒有 % 時;詞綴行與面板字不算", () => {
    expect(vetoLineReason("護 甲 值 : 103")).toBe("colon");
    expect(vetoLineReason("需求:等級 80")).toBe("colon");
    expect(vetoLineReason("前 綴 詞 綴 「 迅 捷 之 」")).toBe("keyword");
    expect(vetoLineReason("可 以 骰 出 射 手 詞 綴")).toBe("keyword");
    expect(vetoLineReason("( 階 級 2 )")).toBe("keyword");
    expect(vetoLineReason("需 求 等 級 80 , 55 力 量")).toBe("keyword");
    expect(vetoLineReason("減 少 15 % 能 力 值 需 求")).toBeNull();
    expect(vetoLineReason("+ 3 % 至 全 部 技 能 的 品 質")).toBeNull();
    expect(vetoLineReason("確 認")).toBeNull();
    expect(vetoLineReason("一 魂 之 井")).toBeNull();
    expect(vetoLineReason("12:34")).toBeNull(); // 沒有 CJK(時鐘之類)不算
  });
});

// ---------------------------------------------------------------- 真實負樣本

const TOOLTIP = readSnap("tooltip-gloves-advanced-01");
const TIP_FULL = toClient(TOOLTIP.lines, TOOLTIP.scale);
const TIP_ONE = toClient(TOOLTIP.locate!.lines, TOOLTIP.locate!.scale);

describe("真實負樣本 tooltip-gloves-advanced-01(背包手套的進階詞綴說明,沒開揭露面板)", () => {
  it("快照:1920×1080,整張 ×3 與 ×1 都有;浮窗的詞綴確實「像詞綴」(舊判定會被騙的原因)", () => {
    expect([TOOLTIP.srcW, TOOLTIP.srcH, TOOLTIP.scale]).toEqual([1920, 1080, 3]);
    expect(modLines(TIP_FULL, idx).length).toBeGreaterThanOrEqual(4);
    expect(modLines(TIP_ONE, idx).length).toBeGreaterThanOrEqual(2);
    expect(TIP_FULL.some((l) => norm(l.text) === "可以骰出射手詞綴")).toBe(true);
  });
  it("main 定位(整張 ×3):浮窗那一簇被否決(4 行連在一起 > 3)→ findPanelHits null", () => {
    const diag: PanelHitsDiag = { vetoes: [] };
    expect(findPanelHits(TIP_FULL, idx, diag)).toBeNull();
    expect(diag.vetoes.map((v) => v.kind)).toContain("group-too-tall");
  });
  it("main 自動定位(整張 ×1):locatePanel 不回傳浮窗框(附近有「可以…詞綴」行)", () => {
    const diag: PanelHitsDiag = { vetoes: [] };
    expect(locatePanel(TIP_ONE, idx, { x: 0, y: 0, w: 1920, h: 1080 })).toBeNull();
    expect(findPanelHits(TIP_ONE, idx, diag)).toBeNull();
    expect(diag.vetoes.map((v) => v.kind)).toEqual(["keyword-line"]);
  });
  it("renderer matchReveal:no-panel(整張 ×3 與 ×1 都是),帶否決原因", () => {
    const kinds = [TIP_FULL, TIP_ONE].map((lines) => {
      const r = matchReveal(lines, data);
      expect(r.ok).toBe(false);
      return r.ok ? null : `${r.error}:${r.veto?.kind}`;
    });
    // ×3:4 條詞綴連在一起被語意切成 4 段(> 3 組);×1:只認出 2 條,靠附近的「可以…詞綴」行
    expect(kinds).toEqual(["no-panel:too-many-groups", "no-panel:keyword-line"]);
  });
});

// ---------------------------------------------------------------- 合成負樣本(依真實快照的行資料)

/** 真實快照裡浮窗的屬性行(物品等級 / 護甲 / 需求 / 可以…詞綴),排除舊 overlay 疊上去的徽章與提示、左側的前綴 / 後綴標籤 */
const TIP_PROPS = TIP_FULL.filter((l) => /物品等級|護甲值|閃避值|求等級|可以有|可以骰出/.test(norm(l.text)));
/** 真實快照的詞綴行(第一條的中心 y、行高、置中 x) */
const TIP_MOD_Y = 464;
const TIP_H = 20.3;
const TIP_CX = 1325;
const mk = (text: string, cyv: number, h = TIP_H, cx = TIP_CX): OcrTextLine => {
  const w = [...text.replace(/\s+/g, "")].length * h * 0.95;
  return { text, x: cx - w / 2, y: cyv - h / 2, w, h };
};
const PREFIX = ["增 加 40 % 投 射 物 速 度", "攻 擊 附 加 15 至 20 物 理 傷 害"];
const SUFFIX = ["全 部 投 射 物 技 能 等 級 + 2", "+ 38 % 火 焰 抗 性", "增 加 26 % 暴 擊 傷 害 加 成"];
const RARE6 = [...PREFIX, ...SUFFIX, "+ 25 % 閃 電 抗 性"];

/** 每行行距 `step` × 行高;`breaks` 裡的索引之前多加 `extra` × 行高(分隔線) */
function column(texts: string[], step: number, breaks: number[] = [], extra = 1): OcrTextLine[] {
  let y = TIP_MOD_Y;
  return texts.map((t, i) => {
    if (i > 0) y += step * TIP_H + (breaks.includes(i) ? extra * TIP_H : 0);
    return mk(t, y);
  });
}

function expectNotPanel(lines: OcrTextLine[], kinds: string[]) {
  // 前提:合成的詞綴行都對得上模板(像詞綴)
  for (const l of lines) if (RARE6.includes(l.text)) expect(lineLooksLikeMod(l.text, idx)).toBe(true);
  const diag: PanelHitsDiag = { vetoes: [] };
  expect(findPanelHits(lines, idx, diag)).toBeNull();
  expect(kinds).toContain(diag.vetoes[0]?.kind);
  expect(locatePanel(lines, idx, { x: 0, y: 0, w: 1920, h: 1080 })).toBeNull();
  const r = matchReveal(lines, data);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(kinds).toContain(r.veto?.kind);
}

describe("合成負樣本", () => {
  it("A. 同一個浮窗沒開進階說明:前綴 2 行 + 分隔線 + 後綴 3 行(2 組、每組 ≤ 3 行 —— 舊判定會過)→ 屬性行「可以…詞綴」否決", () => {
    const mods = column([...PREFIX, ...SUFFIX], 1.35, [2]);
    // 前提:舊判定(≥ 2 行像詞綴且 ≥ 2 組)會過
    expect(shapeGroups(modLines(mods, idx)).map((g) => g.length)).toEqual([2, 3]);
    expectNotPanel([...TIP_PROPS, ...mods], ["keyword-line"]);
  });

  it("B. 進階說明開著:每條詞綴上方一行「前綴 / 後綴詞綴」標頭(使用者回報的情況)→ 否決", () => {
    const lines: OcrTextLine[] = [];
    let y = TIP_MOD_Y;
    [...PREFIX, ...SUFFIX].forEach((t, i) => {
      lines.push(mk(`${i < 2 ? "前 綴" : "後 綴"} 詞 綴 「 迅 捷 之 」 ( 階 級 : ${i + 1} )`, y, TIP_H * 0.8));
      y += 1.25 * TIP_H;
      lines.push(mk(t, y));
      y += 1.4 * TIP_H;
    });
    // 標頭把詞綴撐開成每行一組(舊判定:≥ 2 組 → 面板)
    expect(shapeGroups(modLines(lines, idx)).length).toBe(5);
    expectNotPanel([...TIP_PROPS, ...lines], ["too-many-groups", "keyword-line", "tooltip-header"]);
    // 沒有屬性行、只剩 2 條詞綴 + 標頭(組數不超過):仍靠標頭的關鍵字否決
    expectNotPanel(lines.slice(0, 4), ["keyword-line"]);
  });

  it("B'. 標頭沒有關鍵字 / 冒號(OCR 只認出詞綴名):夾在詞綴之間、緊貼、x 對齊 → tooltip-header", () => {
    const lines = [mk("「 迅 捷 之 」", TIP_MOD_Y, TIP_H * 0.8), mk(PREFIX[0], TIP_MOD_Y + 1.25 * TIP_H)];
    lines.push(mk("「 屠 夫 之 」", TIP_MOD_Y + 2.65 * TIP_H, TIP_H * 0.8), mk(PREFIX[1], TIP_MOD_Y + 3.9 * TIP_H));
    expectNotPanel(lines, ["tooltip-header"]);
  });

  it("C. 稀有裝備 5 條詞綴、彼此有空隙(5 組)→ too-many-groups", () => {
    const mods = column([...PREFIX, ...SUFFIX], 2.4);
    expect(shapeGroups(modLines(mods, idx)).length).toBe(5);
    expect(5).toBeGreaterThan(MAX_PANEL_GROUPS);
    expectNotPanel(mods, ["too-many-groups"]);
  });

  it("C'. 稀有裝備 6 條詞綴連在一起:main = 一組 6 行(group-too-tall);renderer = 語意切成 6 段(too-many-groups)", () => {
    const mods = column(RARE6, 1.35);
    const diag: PanelHitsDiag = { vetoes: [] };
    expect(findPanelHits(mods, idx, diag)).toBeNull();
    expect(diag.vetoes[0]?.kind).toBe("group-too-tall");
    const r = matchReveal(mods, data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.veto?.kind).toBe("too-many-groups");
  });
});

describe("否決規則不誤殺", () => {
  const H = 23;
  const at = (text: string, cyv: number): OcrTextLine => ({ text, x: 480 - text.length * 10, y: cyv - H / 2, w: text.length * 20, h: H });
  it("同一個選項中間那行 OCR 認錯(帶 % / +數字,像詞綴數值)→ 不當成浮窗標頭,面板照常", () => {
    const lines = [
      at("+86 護 甲 值", 300),
      at("+79 閃 避 值", 300 + 1.54 * H),
      at("+21 最 大 生 命", 300 + 4.6 * H),
      at("+3O% 看 不 懂 的 字", 300 + 6.14 * H), // 認錯的一行
      at("增 加 25 % 護 甲 值 和 閃 避", 300 + 7.68 * H),
      at("+17 護 甲 值", 300 + 12.3 * H),
    ];
    const r = matchReveal(lines, data, { refName: "Rogue Armour" });
    expect(r.ok).toBe(true);
    const hits = modLines(lines, idx);
    expect(panelVeto(hits, lines.filter((l) => !hits.includes(l)))).toBeNull();
  });
  it("面板下方的「確認」、上方遠處的標題、旁邊遠處的聊天訊息(含冒號)都不否決", () => {
    const mods = [at("+21 最 大 生 命", 300), at("增 加 25 % 護 甲 值 和 閃 避", 300 + 4.6 * H), at("+86 護 甲 值", 300 + 9.2 * H)];
    const chat = { text: "[20:51] 某 人 : 你 好", x: 0, y: 300, w: 200, h: H }; // 左緣 0–200,離詞綴框 > 2 個行高
    const extra = [at("確 認", 300 + 12.5 * H), at("靈 魂 之 井", 300 - 14 * H), chat];
    const r = matchReveal([...mods, ...extra], data, { refName: "Rogue Armour" });
    expect(r.ok).toBe(true);
    expect(findPanelHits([...mods, ...extra], idx)).not.toBeNull();
  });
});
