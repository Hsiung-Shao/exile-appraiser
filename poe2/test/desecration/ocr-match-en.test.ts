/**
 * exile-appraiser(2026-10-02 第 22 步):英文客戶端的靈魂之井揭露面板 OCR(`lang: "en"`)。
 * ① 真實英文截圖(`fixtures/ocr/well-of-souls-weapon-en-04.png`,使用者提供;`node scripts/ocr-fixture.mjs --with-locate -en-` 以 `en-US` 語言包產生快照)
 *    → 三組全對上、各給 Tier;第一個選項是折行(`ATTACKS WITH THIS WEAPON PENETRATE 25% FIRE` / `RESISTANCE`)。
 * ② 英文模板 round-trip:`text.en` + `text.enVariants` 全部填入數值 → 大寫 small caps 形狀(字間空白、大寫)精確命中自己的 part。
 * ③ 模糊:長模板錯 1 個字母仍命中自己;正規化(大小寫、`to45` 的 o 不動、數字旁的 O/l、字母間的 0/1、`'`、全形)。
 * ④ 定位(main 的 `ocr-locate`)與否決規則(英文關鍵字、加分);⑤ 負樣本(合成英文物品浮窗,含 Prefix / Suffix 標頭與屬性行)。
 * 繁中行為不受影響另由 ocr-match / ocr-locate / panel-veto 既有測試守著(這些函式省略 `lang` = 繁中)。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { matchLine, matchReveal, normalizeOcrText, normalizeOcrTextEn, ocrIndex, type OcrTextLine, type RevealMatchResult } from "@/desecration/ocr-match";
import { buildLocateIndex, checkRegion, findPanelHits, lineLooksLikeMod, locatePanel } from "@/desecration/ocr-locate";
import { panelAnchorScore, panelVeto, vetoLineReason, VETO_KEYWORDS_EN } from "@/desecration/panel-veto";
import { EN_FUZZY, ZH_FUZZY, fuzzyRules, hasLangText, ocrTextLangOf, templateSkeleton } from "@/desecration/ocr-text";
import type { DesecrationData } from "@/desecration/infer";
import type { BaseProfiles, DesecrationTiers } from "@/desecration/types";

const DATA_DIR = path.resolve(__dirname, "../../../data/poe2/desecration");
const tiers = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tiers.json"), "utf8")) as DesecrationTiers;
const data: DesecrationData = {
  tiers,
  baseProfiles: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "base_profiles.json"), "utf8")) as BaseProfiles,
};
const EN = { lang: "en" as const };

interface Snap {
  srcW: number;
  srcH: number;
  scale: number;
  lang: string;
  lines: OcrTextLine[];
  locate: { scale: number; lines: OcrTextLine[] };
}
const snap = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/ocr/well-of-souls-weapon-en-04.ocr.json"), "utf8"),
) as Snap;
const X3: OcrTextLine[] = snap.lines.map((l) => ({ text: l.text, x: l.x / snap.scale, y: l.y / snap.scale, w: l.w / snap.scale, h: l.h / snap.scale }));
const X1: OcrTextLine[] = snap.locate.lines.map((l) => ({ text: l.text, x: l.x, y: l.y, w: l.w, h: l.h }));
const BOUNDS = { x: 0, y: 0, w: snap.srcW, h: snap.srcH };

function ok(r: RevealMatchResult) {
  if (!r.ok) throw new Error(`預期 ok,得到 ${r.error}${r.veto ? `(${r.veto.kind} ${r.veto.detail})` : ""}`);
  return r;
}

/** 每組:[行文字, Tier, pool, mod id] */
const EXPECTED: Array<[string, number, string, string]> = [
  ["ATTACKS WITH THIS WEAPON PENETRATE 25% FIRE RESISTANCE", 1, "desecration_exclusive", "AbyssModGenWeaponAmanamuPrefixFirePenetration"],
  ["ADDS 28 TO 45 COLD DAMAGE", 6, "normal", "LocalAddedColdDamageTwoHand5"],
  ["ADDS 23 TO 54 PHYSICAL DAMAGE", 3, "normal", "LocalAddedPhysicalDamageTwoHand7"],
];

describe("① 真實英文截圖 well-of-souls-weapon-en-04(en-US 語言包)", () => {
  it("快照是英文語言包產生的:6 行全大寫(small caps)、第一個選項折成兩行", () => {
    expect(snap.lang).toBe("en-US");
    expect(X3.map((l) => l.text)).toEqual([
      "THE WELL OF SOULR",
      "ATTACKS WITH THIS WEAPON PENETRATE 25% FIRE",
      "RESISTANCE",
      "ADDS 28 TO 45 COLD DAMAGE",
      "ADDS 23 TO 54 PHYSICAL DAMAGE",
      "CONFIRM",
    ]);
  });

  for (const [label, lines] of [["×3(runtime 面板區)", X3], ["×1(自動定位那一段)", X1]] as const) {
    it(`${label}:三組全對上、折行合併、各給 Tier(三個選項共同的可能底材推算)`, () => {
      const r = ok(matchReveal(lines, data, EN));
      expect(r.groups).toHaveLength(3);
      r.groups.forEach((g, i) => {
        const [text, tier, pool, id] = EXPECTED[i];
        expect(g.lines.map((l) => l.text)).toEqual([text]);
        expect(g.lines[0].match).not.toBeNull();
        expect(g.partial).toBe(false);
        expect(g.candidates).toHaveLength(1);
        const c = g.candidates[0];
        expect(c.tier).toBe(tier);
        expect(c.pool).toBe(pool);
        expect(c.entryIds).toEqual([id]);
        expect(c.fuzzy).toBe(false);
      });
      expect(r.groups[0].lines[0].merged).toBe(true);
      expect(r.groups[0].candidates[0].gods).toEqual(["amanamu"]);
      expect(r.profileSource).toBe("intersection");
      expect(r.profileExact).toBe(false);
    });
  }

  it("同一份行不帶 lang(= 繁中)→ 沒有任何一行算文字,no-panel(繁中路徑不受英文影響)", () => {
    expect(matchReveal(X3, data).ok).toBe(false);
  });

  it("數值落在範圍外就不是那一條(28–45 的冷傷不會被當成別的 Tier)", () => {
    const m = matchLine("ADDS 28 TO 45 COLD DAMAGE", data, "en")!;
    expect(m.skeleton).toBe("adds#to#colddamage");
    expect(m.values).toEqual([28, 45]);
    expect(m.hits[0].fuzzy).toBe(false);
  });
});

describe("② 英文模板 round-trip(text.en + text.enVariants)", () => {
  const idx = ocrIndex(data, "en");
  const fill = (t: string, v: number) => t.replace(/#/g, String(v));
  it("索引:669 個 skeleton(英文 670 個寫法);繁中索引不受影響(706)", () => {
    expect(idx.list.length).toBe(669);
    expect(idx.lang).toBe("en");
    expect(ocrIndex(data).list.length).toBe(706);
    expect(ocrIndex(data, "zh")).toBe(ocrIndex(data));
  });
  it("每個英文寫法填入數字、轉成 small caps 大寫 + 字間多一個空白 → 精確命中自己的 part", () => {
    let n = 0;
    for (const e of tiers.entries) {
      e.parts.forEach((p, partIdx) => {
        const forms = [p.text.en, ...(p.text.enVariants ?? []).map((v) => v.text)];
        for (const form of forms) {
          const ocr = fill(form, 7).toUpperCase().replace(/ /g, "  ");
          const m = matchLine(ocr, data, "en");
          expect(m, `${e.mod_id}: ${ocr}`).not.toBeNull();
          expect(m!.hits[0].fuzzy, ocr).toBe(false);
          expect(m!.hits.some((h) => h.info.refs.some((r) => r.entry === e && r.partIdx === partIdx)), ocr).toBe(true);
          n++;
        }
      });
    }
    expect(n).toBeGreaterThan(2000);
  });
  it("反向寫法(enVariants negate)的數值語意:`#% increased Attack Speed` 對不上 `#% reduced Attack Speed`(15)那條", () => {
    const e = tiers.entries.find((x) => x.mod_id === "AbyssModAllMacesKurgalPrefixIncreasedPhysicalDamageReducedAttackSpeed")!;
    const m = matchLine("15% increased Attack Speed", data, "en")!;
    const ref = m.hits[0].info.refs.find((r) => r.entry === e && r.partIdx === 0)!;
    expect(ref.negate).toBe(true);
    expect(ref.variant).toBe("#% increased Attack Speed");
  });
});

describe("③ 英文正規化與模糊", () => {
  it("normalizeOcrTextEn:大小寫、刪空白與 `'`、全形、破折號", () => {
    expect(normalizeOcrTextEn("ADDS 28 TO 45 COLD DAMAGE")).toBe("adds28to45colddamage");
    expect(normalizeOcrTextEn("Thrud’s  Might")).toBe("thrudsmight");
    expect(normalizeOcrTextEn("＋１５％ to Fire Resistance")).toBe("+15%tofireresistance");
    expect(normalizeOcrTextEn("Non–Channelling")).toBe("non-channelling");
  });
  it("數字旁的 O/l → 0/1 只在另一邊不是字母時(`to45` 的 o、`Level 19` 的 l 不動)", () => {
    expect(normalizeOcrTextEn("2O% increased")).toBe("20%increased");
    expect(normalizeOcrTextEn("Adds l5 to 2O Fire Damage")).toBe("adds15to20firedamage");
    expect(normalizeOcrTextEn("adds 28 to45")).toBe("adds28to45");
    expect(normalizeOcrTextEn("Uncut Spirit Gem (Level 19)")).toBe("uncutspiritgem(level19)");
  });
  it("夾在字母間的 0 / 1 / | → o / l(small caps 誤讀)", () => {
    expect(normalizeOcrTextEn("PHYSICA1 DAMAGE")).toBe("physica1damage"); // 結尾那個 1 只有一邊是字母 → 不動
    expect(normalizeOcrTextEn("C0LD DAMAGE")).toBe("colddamage");
    expect(normalizeOcrTextEn("PHYS|CAL")).toBe("physlcal");
  });
  it("繁中正規化不變;它的「數字旁 O → 0」對英文不合用(`TO45` → `T045`),所以英文另走 normalizeOcrTextEn", () => {
    expect(normalizeOcrText("+ 86 護 甲 值")).toBe("+86護甲值");
    expect(normalizeOcrText("ADDS 28 TO 45")).toBe("ADDS28T045");
    expect(normalizeOcrTextEn("ADDS 28 TO 45")).toBe("adds28to45");
  });
  it("門檻:英文相似度 0.85、長度差不另設上限(由門檻推得);繁中維持 0.85 / 2", () => {
    expect(fuzzyRules("en")).toBe(EN_FUZZY);
    expect(fuzzyRules()).toBe(ZH_FUZZY);
    expect(EN_FUZZY.minSim).toBe(0.85);
    expect(EN_FUZZY.maxLenDiff).toBe(Number.POSITIVE_INFINITY);
    expect(ZH_FUZZY).toEqual({ minSim: 0.85, maxLenDiff: 2 });
    expect(ocrTextLangOf("en-US")).toBe("en");
    expect(ocrTextLangOf("zh-Hant-TW")).toBe("zh");
    expect(ocrTextLangOf(undefined)).toBe("zh");
  });
  it("長模板錯 1–2 個字母 / 漏一個字母仍模糊命中自己(固定種子,200 個 ≥ 20 字的寫法)", () => {
    const forms: Array<{ text: string; entry: string }> = [];
    for (const e of tiers.entries) for (const p of e.parts) if (templateSkeleton(p.text.en, "en").skeleton.length >= 20) forms.push({ text: p.text.en, entry: e.mod_id });
    let seed = 22;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let checked = 0;
    for (let k = 0; k < 200; k++) {
      const f = forms[Math.floor(rnd() * forms.length)];
      const ocr = f.text.replace(/#/g, "9").toUpperCase();
      const letters = [...ocr].map((c, i) => (/[A-Z]/.test(c) ? i : -1)).filter((i) => i >= 0);
      const i = letters[Math.floor(rnd() * letters.length)];
      const typo = ocr.slice(0, i) + (ocr[i] === "E" ? "F" : "E") + ocr.slice(i + 1);
      const m = matchLine(typo, data, "en");
      expect(m, typo).not.toBeNull();
      const self = templateSkeleton(f.text, "en").skeleton;
      expect(m!.hits.map((h) => h.info.skeleton), typo).toContain(self);
      checked++;
    }
    expect(checked).toBe(200);
  });
  it("面板上的固定字(標題 / 按鈕)不像詞綴", () => {
    const li = buildLocateIndex(tiers, "en");
    for (const t of ["THE WELL OF SOULS", "THE WELL OF SOULR", "CONFIRM", "Search here"]) expect(lineLooksLikeMod(t, li), t).toBe(false);
    expect(hasLangText("CONFIRM", "en")).toBe(true);
    expect(hasLangText("25%", "en")).toBe(false);
  });
});

describe("④ main 的面板定位(英文索引)與否決規則", () => {
  const li = buildLocateIndex(tiers, "en");
  it("索引帶 lang: en、669 個;繁中索引沒有 lang(706)", () => {
    expect(li.lang).toBe("en");
    expect(li.list.length).toBe(669);
    const zh = buildLocateIndex(tiers);
    expect("lang" in zh).toBe(false);
    expect(zh.list.length).toBe(706);
  });
  for (const [label, lines] of [["×1", X1], ["×3", X3]] as const) {
    it(`${label}:4 行像詞綴(含折行兩半)、裁切框包住三個選項、checkRegion 通過`, () => {
      const hits = findPanelHits(lines, li)!;
      expect(hits.hits.map((l) => l.text)).toEqual([
        "ATTACKS WITH THIS WEAPON PENETRATE 25% FIRE",
        "RESISTANCE",
        "ADDS 28 TO 45 COLD DAMAGE",
        "ADDS 23 TO 54 PHYSICAL DAMAGE",
      ]);
      const loc = locatePanel(lines, li, BOUNDS)!;
      expect(loc.crop.y).toBeLessThanOrEqual(469);
      expect(loc.crop.y + loc.crop.h).toBeGreaterThanOrEqual(719);
      const inCrop = lines.filter((l) => l.y >= loc.crop.y && l.y + l.h <= loc.crop.y + loc.crop.h);
      expect(ok(matchReveal(inCrop, data, EN)).groups).toHaveLength(3);
      expect(checkRegion(lines, li, BOUNDS, BOUNDS).ok).toBe(true);
    });
  }
  it("加分:`CONFIRM`(下方)+ `THE WELL OF SOULS`(上方,OCR 讀成 SOULR 也算)= 2;繁中規則看不到英文字 = 0", () => {
    const hits = findPanelHits(X3, li)!.hits;
    const others = X3.filter((l) => !hits.includes(l));
    expect(panelAnchorScore(hits, others, "en")).toBe(2);
    expect(panelAnchorScore(hits, others)).toBe(0);
  });
  it("vetoLineReason(英文):冒號、Prefix / Suffix / Modifier / Tier / Item Level;Requires / Quality 只在沒有 % 時", () => {
    expect(VETO_KEYWORDS_EN).toEqual(["prefix", "suffix", "modifier", "tier", "itemlevel"]);
    expect(vetoLineReason("Requires: Level 65", "en")).toBe("colon");
    expect(vetoLineReason("Quality: +20%", "en")).toBe("colon");
    expect(vetoLineReason('{ Prefix Modifier "Tempered" (Tier 2) }', "en")).toBe("keyword");
    expect(vetoLineReason("Desecrated Suffix", "en")).toBe("keyword");
    expect(vetoLineReason("Item Level 82", "en")).toBe("keyword");
    expect(vetoLineReason("Requires Level 65", "en")).toBe("keyword");
    expect(vetoLineReason("+3% to Quality of all Skills", "en")).toBeNull();
    expect(vetoLineReason("ADDS 28 TO 45 COLD DAMAGE", "en")).toBeNull();
    expect(vetoLineReason("CONFIRM", "en")).toBeNull();
    // 繁中規則看英文 → 不是 CJK,不否決(兩種語言互不影響)
    expect(vetoLineReason("Requires: Level 65")).toBeNull();
  });
  it("英文模板(670 個寫法)沒有任何一個含否決關鍵字或冒號(真面板不會被關鍵字規則誤殺)", () => {
    for (const e of tiers.entries) {
      for (const p of e.parts) {
        for (const t of [p.text.en, ...(p.text.enVariants ?? []).map((v) => v.text)]) {
          expect(vetoLineReason(t.replace(/#/g, "5"), "en"), t).toBeNull();
        }
      }
    }
  });
  it("真面板的命中行不觸發否決規則", () => {
    const hits = findPanelHits(X3, li)!.hits;
    expect(panelVeto(hits, X3.filter((l) => !hits.includes(l)), { lang: "en" })).toBeNull();
  });
});

describe("⑤ 負樣本:英文物品浮窗(合成,依真實浮窗的行距)不是揭露面板", () => {
  const li = buildLocateIndex(tiers, "en");
  const H = 19;
  /** 行 = [文字, 第幾個行高];行距 1.45 × 行高(浮窗是連續的行) */
  const tip = (rows: Array<[string, number]>, x = 1200): OcrTextLine[] =>
    rows.map(([text, k]) => ({ text, x: x + (400 - text.length * 8) / 2, y: 300 + k * H, w: text.length * 8, h: H }));
  it("進階說明開著:每條詞綴上方一行 `{ Prefix / Suffix Modifier … (Tier: n) }` 標頭 → 否決(關鍵字)", () => {
    const lines = tip([
      ["Item Class: Quarterstaves", 0],
      ["Quality: +20%", 1.45],
      ["Requires: Level 65", 2.9],
      ['{ Prefix Modifier "Tempered" (Tier: 3) }', 5],
      ["Adds 23 to 54 Physical Damage", 6.45],
      ['{ Prefix Modifier "Frosted" (Tier: 6) }', 7.9],
      ["Adds 28 to 45 Cold Damage", 9.35],
      ['{ Suffix Modifier "of Infusion" (Tier: 1) }', 10.8],
      ["Attacks with this Weapon Penetrate 25% Fire Resistance", 12.25],
    ]);
    const r = matchReveal(lines, data, EN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.veto?.kind).toBe("keyword-line");
    expect(findPanelHits(lines, li)).toBeNull();
    expect(locatePanel(lines, li, { x: 0, y: 0, w: 2560, h: 1440 })).toBeNull();
  });
  it("一般複製的稀有裝備:5 條詞綴連續 → 否決(組數 / 行數)", () => {
    const lines = tip([
      ["Adds 23 to 54 Physical Damage", 0],
      ["Adds 28 to 45 Cold Damage", 1.45],
      ["+120 to Accuracy Rating", 2.9],
      ["15% increased Attack Speed", 4.35],
      ["+25% to Fire Resistance", 5.8],
    ]);
    const r = matchReveal(lines, data, EN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.veto?.kind).toBe("too-many-groups");
    expect(findPanelHits(lines, li)).toBeNull();
  });
  it("浮窗與揭露面板同框:面板照常(浮窗在右側 x 1200,不影響)", () => {
    const tooltip = tip([
      ['{ Prefix Modifier "Tempered" (Tier: 3) }', 0],
      ["Adds 23 to 54 Physical Damage", 1.45],
      ['{ Suffix Modifier "of the Ice" (Tier: 2) }', 2.9],
      ["+25% to Cold Resistance", 4.35],
    ]);
    const r = ok(matchReveal([...X3, ...tooltip], data, EN));
    expect(r.groups.map((g) => g.candidates[0]?.entryIds[0])).toEqual(EXPECTED.map((e) => e[3]));
  });
});
