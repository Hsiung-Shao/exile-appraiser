/**
 * exile-appraiser(WP-S):靈魂之井揭露面板 OCR 比對(`src/desecration/ocr-match.ts`)。
 *
 * ① 真實截圖的 OCR 快照(`fixtures/ocr/*.ocr.json`,由 `node scripts/ocr-fixture.mjs` 以 runtime 同一支 PowerShell 腳本產生)
 *    → 三組、7 行全部精確命中,Tier 與手算一致。
 * ② 395 個模板(去掉空字串 = 394 個 skeleton)逐一「填入 ranges 中位數 → 假 OCR 行(字間空白、`+` 號)」必須精確命中自己;
 *    `text.zhVariants`(同 ref 的其他寫法)每個也要命中自己的 part,反向寫法(negate)的數值語意另測。
 * ③ 模糊:替換 1 字元仍命中自己;隨機 200 對不同模板不互相誤命中。
 * ④ 分組:行距邊界、只有 2 組、只有 1 組(no-panel)、折行(4 行 → 3 行混合詞綴)、等距單行詞綴靠語意切段、
 *    中間那個選項沒認出(自成一組 partial,不拆散面板)與雜訊不被併入。
 * 不依賴 WinRT;資料直接讀 data/poe2/desecration(不經 init())。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GROUP_GAP_RATIO,
  PANEL_GAP_RATIO,
  matchLine,
  matchReveal,
  normalizeOcrText,
  ocrIndex,
  levenshtein,
  templateSkeleton,
  valuesFit,
  type OcrTextLine,
  type RevealMatchResult,
} from "@/desecration/ocr-match";
import type { DesecrationData } from "@/desecration/infer";
import type { BaseProfiles, DesecrationTiers } from "@/desecration/types";

const DATA_DIR = path.resolve(__dirname, "../../../data/poe2/desecration");
const data: DesecrationData = {
  tiers: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tiers.json"), "utf8")) as DesecrationTiers,
  baseProfiles: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "base_profiles.json"), "utf8")) as BaseProfiles,
};

interface Snapshot {
  srcW: number;
  srcH: number;
  scale: number;
  lines: OcrTextLine[];
}

function loadSnapshot(name: string): OcrTextLine[] {
  const snap = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/ocr", `${name}.ocr.json`), "utf8"),
  ) as Snapshot;
  // 快照是放大後的像素 → 換回 client 像素(runtime 的 reveal.ts 做同樣的事)
  return snap.lines.map((l) => ({
    text: l.text,
    x: l.x / snap.scale,
    y: l.y / snap.scale,
    w: l.w / snap.scale,
    h: l.h / snap.scale,
  }));
}

function okResult(r: RevealMatchResult) {
  if (!r.ok) throw new Error(`預期 ok,得到 ${r.error}`);
  return r;
}

const summary = (r: ReturnType<typeof okResult>) =>
  r.groups.map((g) => ({
    lines: g.lines.map((l) => normalizeOcrText(l.text)),
    partial: g.partial,
    candidates: g.candidates.map((c) => ({
      tier: c.tier,
      tierRange: c.tierRange,
      pool: c.pool,
      ranges: c.ranges,
      fuzzy: c.fuzzy,
      entryIds: c.entryIds,
    })),
  }));

describe("① 真實截圖 OCR 快照:well-of-souls-body-armour-01", () => {
  const lines = loadSnapshot("well-of-souls-body-armour-01");

  it("快照含 7 行詞綴(外加面板標題等雜訊)", () => {
    const norm = lines.map((l) => normalizeOcrText(l.text));
    expect(norm).toEqual(
      expect.arrayContaining([
        "+86護甲值",
        "+79閃避值",
        "增加25%護甲值和閃避",
        "+21最大生命",
        "+17護甲值",
        "+20閃避值",
        "增加23%護甲值和閃避",
      ]),
    );
  });

  it("profile = Rogue Armour(胸甲 str_dex):三組全 T4", () => {
    expect(data.baseProfiles.profiles["Rogue Armour"]).toBeDefined();
    const r = okResult(matchReveal(lines, data, { refName: "Rogue Armour" }));
    expect(r.profileExact).toBe(true);
    expect(r.profileSource).toBe("refName");
    const s = summary(r);
    for (const g of s) console.log(`[Rogue Armour] ${g.lines.join(" / ")} → ${JSON.stringify(g.candidates)}`);
    expect(s.map((g) => g.lines)).toEqual([
      ["+86護甲值", "+79閃避值"],
      ["增加25%護甲值和閃避", "+21最大生命"],
      ["+17護甲值", "+20閃避值", "增加23%護甲值和閃避"],
    ]);
    for (const g of s) {
      expect(g.partial).toBe(false);
      expect(g.candidates).toHaveLength(1);
      expect(g.candidates[0].fuzzy).toBe(false);
      expect(g.candidates[0].pool).toBe("normal");
      expect(g.candidates[0].tier).toBe(4);
    }
    // 手算(tiers.json):86 ∈ 86–102、79 ∈ 79–94 → LocalBaseArmourAndEvasionRating5(p032 T4)
    expect(s[0].candidates[0].entryIds).toEqual(["LocalBaseArmourAndEvasionRating5"]);
    expect(s[0].candidates[0].ranges).toEqual([[86, 102], [79, 94]]);
    // 25 ∈ 21–26、21 ∈ 20–25 → LocalIncreasedArmourAndEvasionAndLife3(T4)
    expect(s[1].candidates[0].entryIds).toEqual(["LocalIncreasedArmourAndEvasionAndLife3"]);
    expect(s[1].candidates[0].ranges).toEqual([[21, 26], [20, 25]]);
    // 17 ∈ 17–23、20 ∈ 15–21、23 ∈ 21–26 → LocalIncreasedArmourAndEvasionAndBase3(T4)
    expect(s[2].candidates[0].entryIds).toEqual(["LocalIncreasedArmourAndEvasionAndBase3"]);
    expect(s[2].candidates[0].ranges).toEqual([[17, 23], [15, 21], [21, 26]]);
  });

  it("沒有 profile:三組候選 profile 取交集(= 胸甲 str_dex 類),Tier 仍唯一但 profileExact=false", () => {
    const r = okResult(matchReveal(lines, data));
    expect(r.profileExact).toBe(false);
    expect(r.profileSource).toBe("intersection");
    const s = summary(r);
    for (const g of s) console.log(`[無 profile] ${g.lines.join(" / ")} → ${JSON.stringify(g.candidates)}`);
    expect(s).toHaveLength(3);
    for (const g of s) {
      expect(g.candidates.length).toBeGreaterThan(0);
      expect(g.candidates.every((c) => c.tierRange[0] >= 1)).toBe(true);
    }
    expect(s.map((g) => g.candidates.map((c) => c.tierRange))).toEqual([[[4, 4]], [[4, 4]], [[4, 4]]]);
  });

  it("不取交集(全部 profile 聯集):Tier 變成範圍,候選不變", () => {
    const r = okResult(matchReveal(lines, data, { intersectProfiles: false }));
    expect(r.profileSource).toBe("all");
    expect(r.profileExact).toBe(false);
    const s = summary(r);
    for (const g of s) console.log(`[全部 profile 聯集] ${g.lines.join(" / ")} → ${JSON.stringify(g.candidates)}`);
    expect(s.map((g) => g.candidates.map((c) => c.entryIds[0]))).toEqual([
      ["LocalBaseArmourAndEvasionRating5"],
      ["LocalIncreasedArmourAndEvasionAndLife3"],
      ["LocalIncreasedArmourAndEvasionAndBase3"],
    ]);
    // 同一條詞綴在不同部位(胸甲 / 手套 / 鞋 / 盾…)的 Tier 不同 → 範圍包含 4
    for (const g of s) {
      const [lo, hi] = g.candidates[0].tierRange;
      expect(lo).toBeLessThanOrEqual(4);
      expect(hi).toBeGreaterThanOrEqual(4);
    }
  });

  it("面板標題「靈魂之井」、按鈕「確認」與角落的「倉庫」不進任何組", () => {
    // 快照裡有「倉庫」;標題與按鈕依縮放演算法時有時無 → 補兩行假的
    const extra: OcrTextLine[] = [
      { text: "靈 魂 之 井 ;", x: 405, y: 133, w: 247, h: 38 },
      { text: "確 認", x: 440, y: 854, w: 49, h: 24 },
    ];
    const r = okResult(matchReveal([...lines, ...extra], data));
    expect(r.groups).toHaveLength(3);
    const all = r.groups.flatMap((g) => g.lines.map((l) => normalizeOcrText(l.text)));
    expect(all.some((t) => /靈魂之井|倉庫|確認/.test(t))).toBe(false);
    expect(r.groups.every((g) => !g.partial)).toBe(true);
  });
});

// exile-appraiser(WP-S 兩段式):使用者真實全螢幕截圖 2000×1125(面板在左半中間、右側開著背包、另有小地圖 / 金幣 / 堆疊數雜訊)
describe("①b 真實全螢幕截圖 OCR 快照:well-of-souls-fullscreen-02", () => {
  const lines = loadSnapshot("well-of-souls-fullscreen-02");

  it("快照含 4 行詞綴", () => {
    const norm = lines.map((l) => normalizeOcrText(l.text));
    expect(norm).toEqual(expect.arrayContaining(["增加71%護甲值和閃避", "+60護甲值", "+59閃避值", "+16最大生命"]));
  });

  it("沒有 profile:三組、entry 與 Tier 範圍(現行引擎輸出的回歸快照);雜訊行不入組", () => {
    const r = okResult(matchReveal(lines, data));
    const s = summary(r);
    for (const g of s) console.log(`[fullscreen-02] ${g.lines.join(" / ")} → ${JSON.stringify(g.candidates)}`);
    expect(s.map((g) => g.lines)).toEqual([["增加71%護甲值和閃避"], ["+60護甲值", "+59閃避值"], ["+16最大生命"]]);
    expect(s.map((g) => g.candidates.map((c) => c.entryIds))).toEqual([
      [["LocalIncreasedArmourAndEvasion5"]],
      [["LocalBaseArmourAndEvasionRating3"]],
      [["IncreasedLife1"]],
    ]);
    expect(s.map((g) => g.candidates.map((c) => c.tierRange))).toEqual([[[3, 4]], [[2, 6]], [[9, 13]]]);
    for (const g of s) {
      expect(g.partial).toBe(false);
      expect(g.candidates[0].fuzzy).toBe(false);
    }
    // 小地圖「深井」、「確認」按鈕、背包的「Ⅳ」與堆疊數等雜訊不進任何組
    const all = r.groups.flatMap((g) => g.lines.map((l) => normalizeOcrText(l.text)));
    expect(all).toHaveLength(4);
  });
});

/** 同一份資料去掉 `text.zhVariants`(= 產生器補變體之前的資料),用來單獨驗證分組容錯 */
function withoutVariants(d: DesecrationData): DesecrationData {
  const tiers = JSON.parse(JSON.stringify(d.tiers)) as DesecrationTiers;
  for (const e of tiers.entries) for (const p of e.parts) delete p.text.zhVariants;
  return { tiers, baseProfiles: d.baseProfiles };
}

// exile-appraiser(WP-S 比對缺陷修正):使用者真實全螢幕截圖 2000×1121;三組各一行、等距(組距約 4.6 行高)。
// 修正前 `matchReveal` 回 no-panel:中間那行 `技能增加10%精魂保留效用` 資料只有 `增加#%精魂保留效用`(相似度 0.83 < 0.85)→ 未命中,
// 第 1、3 組相距約 8 行高 > PANEL_GAP(6)→ 拆成兩個各 1 組的「面板」。
describe("①c 真實全螢幕截圖 OCR 快照:well-of-souls-fullscreen-03(寫法變體 + 分組容錯)", () => {
  const lines = loadSnapshot("well-of-souls-fullscreen-03");
  const MODS = ["減少49%你身上的中毒持續時間", "技能增加10%精魂保留效用", "+11點力量與敏捷"];

  it("快照含 3 行詞綴(逐字正確)", () => {
    const norm = lines.map((l) => normalizeOcrText(l.text));
    expect(norm).toEqual(expect.arrayContaining(MODS));
  });

  it("沒有 profile:三組,第 2 組經 zhVariants 命中精魂保留效用;雜訊行不入組", () => {
    const r = okResult(matchReveal(lines, data));
    const s = summary(r);
    for (const g of s) console.log(`[fullscreen-03] ${g.lines.join(" / ")} → ${JSON.stringify(g.candidates)}`);
    console.log(`[fullscreen-03] profileSource=${r.profileSource} profileExact=${r.profileExact}`);
    expect(s.map((g) => g.lines)).toEqual(MODS.map((m) => [m]));
    for (const g of s) {
      expect(g.partial).toBe(false);
      expect(g.candidates.length).toBeGreaterThan(0);
      expect(g.candidates.every((c) => !c.fuzzy)).toBe(true);
    }
    // 第 1 組:一般池 ReducedPoisonDuration3(49 ∈ 46–50);三神專屬的 20–30 不含 49
    expect(s[0].candidates.map((c) => c.entryIds)).toEqual([["ReducedPoisonDuration3"]]);
    expect(s[0].candidates[0].pool).toBe("normal");
    expect(s[0].candidates[0].ranges).toEqual([[46, 50]]);
    // 第 2 組:`增加#%精魂保留效用` 的 entry(Spirit Reservation Efficiency of Skills,阿姆那姆專屬)。
    // 10 同時落在身體護甲 6–12 與武器 5–10;三組 profile 交集(= 身體護甲類)把武器那條排除
    const g2 = s[1].candidates.flatMap((c) => c.entryIds);
    for (const id of g2) {
      const e = data.tiers.entries.find((x) => x.mod_id === id)!;
      expect(e.parts.map((p) => p.text.zh)).toEqual(["增加#%精魂保留效用"]);
      expect(e.parts[0].ref).toBe("#% increased Spirit Reservation Efficiency of Skills");
    }
    expect(g2).toEqual(["AbyssModBodyArmourAmanamuSuffixSpiritReservationEfficiency"]);
    expect(s[1].candidates[0].pool).toBe("desecration_exclusive");
    expect(s[1].candidates[0].ranges).toEqual([[6, 12]]);
    expect(r.groups[1].candidates[0].gods).toEqual(["amanamu"]);
    // 第 3 組:烏拉曼專屬 +#點力量與敏捷(11 ∈ 9–15)
    expect(s[2].candidates.map((c) => c.entryIds)).toEqual([["AbyssModArmourJewelleryUlamanSuffixStrengthAndDexterity"]]);
    expect(s[2].candidates[0].pool).toBe("desecration_exclusive");
    expect(s[2].candidates[0].ranges).toEqual([[9, 15]]);
    expect(r.groups[2].candidates[0].gods).toEqual(["ulaman"]);
    // 實際 Tier(profile 交集,profileExact = false → UI 加「?」):T3 / T1 / T1
    expect(r.profileSource).toBe("intersection");
    expect(s.map((g) => g.candidates.map((c) => c.tierRange))).toEqual([[[3, 3]], [[1, 1]], [[1, 1]]]);
  });

  it("資料沒有 zhVariants 時(只驗分組容錯):中間那行自成 partial 組,面板仍是 3 組", () => {
    const r = okResult(matchReveal(lines, withoutVariants(data)));
    const s = summary(r);
    for (const g of s) console.log(`[fullscreen-03 無變體] ${g.lines.join(" / ")} partial=${g.partial} → ${JSON.stringify(g.candidates)}`);
    expect(s.map((g) => g.lines)).toEqual(MODS.map((m) => [m]));
    expect(s.map((g) => g.partial)).toEqual([false, true, false]);
    expect(s[1].candidates).toEqual([]);
    expect(r.groups[1].lines[0].match).toBeNull();
    expect(s[0].candidates.map((c) => c.entryIds)).toEqual([["ReducedPoisonDuration3"]]);
    expect(s[2].candidates.map((c) => c.entryIds)).toEqual([["AbyssModArmourJewelleryUlamanSuffixStrengthAndDexterity"]]);
  });
});

/** 模板填值 → 假 OCR 行(字間空白;開頭是數值就加 `+`) */
function fakeOcr(template: string, values: number[]): string {
  let k = 0;
  const filled = template.replace(/#/g, () => String(values[k++]));
  const spaced = [...filled.replace(/\s+/g, "")].join(" ");
  return /^\d/.test(filled) ? `+ ${spaced}` : spaced;
}

function midValues(ranges: number[][] | null, n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const r = ranges?.[i];
    if (!r) return 7;
    const lo = Math.min(Math.abs(r[0]), Math.abs(r[1]));
    const hi = Math.max(Math.abs(r[0]), Math.abs(r[1]));
    return Math.round(((lo + hi) / 2) * 100) / 100;
  });
}

describe("② 每個模板 round-trip 精確命中自己", () => {
  const idx = ocrIndex(data);
  const templates = new Map<string, { zh: string; ranges: number[][] | null }>();
  for (const e of data.tiers.entries)
    for (const p of e.parts) if (p.text.zh.trim() && !templates.has(p.text.zh)) templates.set(p.text.zh, { zh: p.text.zh, ranges: p.ranges });

  it("395 個模板(含 1 個空字串)→ 394 個 text.zh skeleton,互不相撞;加上 zhVariants 共 706 個 skeleton", () => {
    expect(templates.size).toBe(394);
    const zhSkeletons = new Set([...templates.keys()].map((t) => templateSkeleton(t).skeleton));
    expect(zhSkeletons.size).toBe(394);
    console.log(`skeleton:text.zh ${zhSkeletons.size} + 變體 → ${idx.list.length}`);
    expect(idx.list.length).toBe(706);
  });

  it("全部 394 個 text.zh", () => {
    const failures: string[] = [];
    for (const { zh, ranges } of templates.values()) {
      const n = (zh.match(/#/g) ?? []).length;
      const text = fakeOcr(zh, midValues(ranges, n));
      const m = matchLine(text, data);
      const own = idx.bySkeleton.get(templateSkeleton(zh).skeleton);
      const ownRef = own?.refs.some((r) => r.variant == null && r.entry.parts[r.partIdx].text.zh === zh);
      if (!m || m.hits.length !== 1 || m.hits[0].fuzzy || m.hits[0].info !== own || !ownRef) failures.push(`${zh} ← ${text}`);
    }
    expect(failures).toEqual([]);
  });

  // 同一模板(text.zh)的變體在每個用到它的 part 都一樣;以 (text.zh, 變體) 去重
  const variants = new Map<string, { zh: string; v: { text: string; negate?: true }; ranges: number[][] | null }>();
  for (const e of data.tiers.entries)
    for (const p of e.parts)
      if (p.text.zh.trim())
        for (const v of p.text.zhVariants ?? []) {
          const k = `${p.text.zh}\u0000${v.text}`;
          if (!variants.has(k)) variants.set(k, { zh: p.text.zh, v, ranges: p.ranges });
        }

  it("zhVariants 統計:269 個模板有其他寫法,共 317 個(negate 270、不含 # 18)", () => {
    const withV = new Set([...variants.values()].map((x) => x.zh));
    const all = [...variants.values()].map((x) => x.v);
    console.log(`zhVariants:${withV.size} 個模板、${all.length} 個寫法`);
    expect(withV.size).toBe(269);
    expect(all).toHaveLength(317);
    expect(all.filter((v) => v.negate)).toHaveLength(270);
    expect(all.filter((v) => !v.text.includes("#"))).toHaveLength(18);
    // 變體不等於自己的 text.zh、同一模板內不重複
    for (const x of variants.values()) expect(x.v.text).not.toBe(x.zh);
  });

  it("每個變體填值後命中自己的 part(非 negate:ranges 中位數;negate:數值語意見 valuesFit)", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { zh, v, ranges } of variants.values()) {
      const n = (v.text.match(/#/g) ?? []).length;
      const text = fakeOcr(v.text, midValues(ranges, n));
      const m = matchLine(text, data);
      // 這個寫法指向「text.zh = zh 的 part」的 ref
      const refs =
        m && !m.hits[0].fuzzy && m.hits.length === 1
          ? m.hits[0].info.refs.filter((r) => r.variant === v.text && r.entry.parts[r.partIdx].text.zh === zh)
          : [];
      if (!refs.length) {
        failures.push(`${zh} ⇐ ${v.text} ← ${text}:沒有精確命中自己的 part`);
        continue;
      }
      checked++;
      for (const r of refs) {
        const part = r.entry.parts[r.partIdx];
        // 同一模板在不同 entry 的 ranges 不同(各 Tier)→ 每個 ref 用自己 part 的中位數
        const mid = midValues(part.ranges, n);
        expect(r.negate).toBe(v.negate === true);
        if (!v.negate) {
          // 同極性:ranges 中位數必須符合(不含 # 的寫法沒有數值,只靠文字)
          if (!valuesFit(part, n ? mid : null, false)) failures.push(`${zh} ⇐ ${v.text}:中位數 ${mid} 不符`);
        } else if (n) {
          // 反向寫法:畫面數字 X 在 text.zh 語意下是 −X。擲出的值(以 text.zh 顯示時為正)換成反向寫法顯示 → 不符;
          // 語意上一致的值是 −X 落在 range 內(畫面上顯示負數的反向寫法,例 `增加-15%攻擊速度` = `減少15%攻擊速度`)
          if (valuesFit(part, mid, true)) failures.push(`${zh} ⇐ ${v.text}:反向寫法 + 正數 ${mid} 不該符合`);
          if (!valuesFit(part, mid.map((x) => -x), true)) failures.push(`${zh} ⇐ ${v.text}:反向寫法 + 負數 ${mid} 應符合`);
        }
      }
    }
    console.log(`變體 round-trip:${checked}/${variants.size}`);
    expect(failures).toEqual([]);
    expect(checked).toBe(variants.size);
  });

  it("反向寫法的數值語意:part `減少#%攻擊速度`(decrease,15)vs 畫面 `增加15%攻擊速度`", () => {
    // 唯一用到這個模板的是柯戈專屬混合詞綴(增加#%物理傷害 + 減少#%攻擊速度)
    const dec = data.tiers.entries.find((e) => e.parts.some((p) => p.text.zh === "減少#%攻擊速度"))!;
    expect(dec.mod_id).toBe("AbyssModAllMacesKurgalPrefixIncreasedPhysicalDamageReducedAttackSpeed");
    const decIdx = dec.parts.findIndex((p) => p.text.zh === "減少#%攻擊速度");
    const decPart = dec.parts[decIdx];
    expect(decPart.direction).toBe("decrease");
    expect(decPart.text.zhVariants).toEqual([{ text: "增加#%攻擊速度", negate: true }]);
    // `增加15%攻擊速度` 的 skeleton 同時是一般池 `增加#%攻擊速度` 的 text.zh 與這條的反向寫法
    const inc = matchLine("增 加 15 % 攻 擊 速 度", data)!;
    const refToDec = inc.hits[0].info.refs.find((r) => r.entry === dec && r.partIdx === decIdx)!;
    expect(refToDec.negate).toBe(true);
    expect(inc.hits[0].info.refs.some((r) => !r.negate && r.entry.parts[r.partIdx].text.zh === "增加#%攻擊速度")).toBe(true);
    expect(valuesFit(decPart, [15], true)).toBe(false); // 增加 15% ≠ 減少 15%
    expect(valuesFit(decPart, [15], false)).toBe(true); // 畫面 `減少15%攻擊速度`
    expect(valuesFit(decPart, [-15], true)).toBe(true); // `增加-15%` = `減少15%`(語意一致的值)
    expect(valuesFit(decPart, null, true)).toBe(false); // OCR 漏數字也不收反向寫法(下限 15 > 0)
    // 面板層級:`減少15%` 那組對上這條混合詞綴;`增加15%` 那組不會對上它
    const H = 23;
    const mk = (text: string, y: number): OcrTextLine => ({ text, x: 480 - text.length * 10, y, w: text.length * 20, h: H });
    const y2 = 300 + 1.54 * H + 3.1 * H;
    const r = okResult(
      matchReveal(
        [
          mk("增 加 130 % 物 理 傷 害", 300),
          mk("減 少 15 % 攻 擊 速 度", 300 + 1.54 * H),
          mk("增 加 130 % 物 理 傷 害", y2),
          mk("增 加 15 % 攻 擊 速 度", y2 + 1.54 * H),
        ],
        data,
      ),
    );
    const ids = r.groups.map((g) => g.candidates.flatMap((c) => c.entryIds));
    console.log(`[反向寫法] ${JSON.stringify(r.groups.map((g) => g.lines.map((l) => normalizeOcrText(l.text))))} → ${JSON.stringify(ids)}`);
    expect(ids[0]).toEqual([dec.mod_id]);
    expect(ids.slice(1).flat()).not.toContain(dec.mod_id);
  });
});

/** 固定種子的 LCG(測試可重現) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("③ 模糊比對", () => {
  const idx = ocrIndex(data);
  const rand = rng(20260929);
  const long = idx.list.filter((i) => [...i.skeleton].length >= 7);

  it("替換 1 個非數值字元仍命中自己(200 次;同分並列的只允許距離 ≤ 2 的近親模板)", () => {
    let ambiguous = 0;
    for (let n = 0; n < 200; n++) {
      const info = long[Math.floor(rand() * long.length)];
      const chars = [...info.skeleton];
      const pos = chars.map((c, i) => (c === "#" ? -1 : i)).filter((i) => i >= 0);
      const at = pos[Math.floor(rand() * pos.length)];
      chars[at] = "㐀"; // 不在任何模板裡的字
      const text = chars.join("").replace(/#/g, "12");
      const m = matchLine(text, data);
      expect(m, text).not.toBeNull();
      expect(m!.hits.map((h) => h.info)).toContain(info);
      expect(m!.hits.every((h) => h.fuzzy)).toBe(true);
      if (m!.hits.length > 1) {
        ambiguous++;
        for (const h of m!.hits) expect(levenshtein(h.info.skeleton, info.skeleton)).toBeLessThanOrEqual(2);
      }
    }
    console.log(`模糊命中並列:${ambiguous}/200`);
    expect(ambiguous).toBeLessThan(20);
  });

  it("隨機 200 對不同模板:A 的文字不會命中 B", () => {
    for (let n = 0; n < 200; n++) {
      const a = idx.list[Math.floor(rand() * idx.list.length)];
      let b = idx.list[Math.floor(rand() * idx.list.length)];
      if (b === a) b = idx.list[(idx.list.indexOf(a) + 1) % idx.list.length];
      const m = matchLine(a.skeleton.replace(/#/g, "5"), data)!;
      expect(m.hits.map((h) => h.info)).toEqual([a]);
      expect(m.hits.map((h) => h.info)).not.toContain(b);
    }
  });

  it("全形與 OCR 混淆:`＋８６ 護 甲 值`、`增加2O％護甲值和閃避` 都能精確命中", () => {
    expect(matchLine("＋８６ 護 甲 值", data)?.hits[0].fuzzy).toBe(false);
    const m = matchLine("增加2O％護甲值和閃避", data)!;
    expect(m.hits[0].fuzzy).toBe(false);
    expect(m.values).toEqual([20]);
  });
});

describe("④ 分組", () => {
  const H = 23; // 1080p 左右的字高(client px)
  const line = (text: string, cy: number, cx = 480): OcrTextLine => ({
    text,
    x: cx - text.length * 10,
    y: cy - H / 2,
    w: text.length * 20,
    h: H,
  });
  /** 依序排版:每組內行距 1.54H,組間 gapRatio × H */
  function layout(groups: string[][], gapRatio = 3.1): OcrTextLine[] {
    const out: OcrTextLine[] = [];
    let y = 300;
    groups.forEach((g, gi) => {
      if (gi > 0) y += gapRatio * H - 1.54 * H;
      for (const t of g) {
        out.push(line(t, y));
        y += 1.54 * H;
      }
    });
    return out;
  }
  const G1 = ["+86 護 甲 值", "+79 閃 避 值"];
  const G2 = ["增 加 25 % 護 甲 值 和 閃 避", "+21 最 大 生 命"];
  const G3 = ["+17 護 甲 值", "+20 閃 避 值", "增 加 23 % 護 甲 值 和 閃 避"];

  it("組間中心距 1.95H → 切開;1.85H → 視為同一組(再由語意切段)", () => {
    const split = okResult(matchReveal(layout([G1, G2], GROUP_GAP_RATIO + 0.05), data, { refName: "Rogue Armour" }));
    expect(split.groups.map((g) => g.lines.length)).toEqual([2, 2]);
    // 1.85H:幾何上併成 4 行一組 → 語意切段仍拆回兩條詞綴
    const merged = okResult(matchReveal(layout([G1, G2], GROUP_GAP_RATIO - 0.05), data, { refName: "Rogue Armour" }));
    expect(merged.groups.map((g) => g.lines.length)).toEqual([2, 2]);
    expect(merged.groups.map((g) => g.candidates[0]?.entryIds[0])).toEqual([
      "LocalBaseArmourAndEvasionRating5",
      "LocalIncreasedArmourAndEvasionAndLife3",
    ]);
  });

  it("只有 2 組也算面板", () => {
    const r = okResult(matchReveal(layout([G2, G3]), data, { refName: "Rogue Armour" }));
    expect(r.groups).toHaveLength(2);
    expect(r.groups.map((g) => g.candidates[0].tier)).toEqual([4, 4]);
  });

  it("只有 1 組 → no-panel", () => {
    const r = matchReveal(layout([G3]), data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("no-panel");
  });

  it("折行:4 行(`增加23%護甲值` + `和閃避`)合併回 3 行混合詞綴", () => {
    const wrapped = ["+17 護 甲 值", "+20 閃 避 值", "增 加 23 % 護 甲 值", "和 閃 避"];
    const r = okResult(matchReveal(layout([G1, wrapped, G2]), data, { refName: "Rogue Armour" }));
    expect(r.groups).toHaveLength(3);
    const g = r.groups[1];
    expect(g.lines).toHaveLength(3);
    expect(g.lines[2].merged).toBe(true);
    expect(g.partial).toBe(false);
    expect(g.candidates.map((c) => c.entryIds[0])).toEqual(["LocalIncreasedArmourAndEvasionAndBase3"]);
  });

  it("三個單行詞綴等距排列(幾何切不開)→ 語意切成 3 組", () => {
    const singles = [["增 加 30 % 護 甲 值"], ["+60 最 大 生 命"], ["增 加 30 % 閃 避 值"]];
    const r = okResult(matchReveal(layout(singles, 1.54), data, { refName: "Rogue Armour" }));
    expect(r.groups.map((g) => g.lines.map((l) => normalizeOcrText(l.text)))).toEqual([
      ["增加30%護甲值"],
      ["+60最大生命"],
      ["增加30%閃避值"],
    ]);
  });

  it("對不上的行留在組內顯示原文(partial)", () => {
    const g3 = ["+17 護 甲 值", "+20 閃 避 值", "增 加 23 % 護 甲 值 和 閃 避", "@@ 看 不 懂 的 字"];
    const r = okResult(matchReveal(layout([G1, g3]), data, { refName: "Rogue Armour" }));
    expect(r.groups[1].partial).toBe(true);
    expect(r.groups[1].lines.map((l) => l.match == null)).toEqual([false, false, false, true]);
    expect(r.groups[1].candidates[0].entryIds).toEqual(["LocalIncreasedArmourAndEvasionAndBase3"]);
  });

  // exile-appraiser(WP-S 比對缺陷修正):中間那個選項沒認出不得拆散面板;雜訊不得被併入
  const UNKNOWN = "看 不 懂 的 一 串 文 字 啊";
  const singles3 = [["+21 最 大 生 命"], [UNKNOWN], ["增 加 25 % 護 甲 值 和 閃 避"]];
  const at = (l: OcrTextLine, patch: Partial<OcrTextLine>): OcrTextLine => ({ ...l, ...patch });

  it("中間那個選項沒認出(組距 4.6H,同 fullscreen-03)→ 自成一組 partial,面板仍是 3 組", () => {
    const ls = layout(singles3, 4.6);
    expect(matchLine(UNKNOWN, data)).toBeNull();
    // 沒有這一組時,第 1、3 組的間距超過 PANEL_GAP(修正前就是在這裡拆成兩個面板 → no-panel)
    expect((ls[2].y - (ls[0].y + ls[0].h)) / H).toBeGreaterThan(PANEL_GAP_RATIO);
    const r = okResult(matchReveal(ls, data, { refName: "Rogue Armour" }));
    expect(r.groups.map((g) => g.lines.map((l) => normalizeOcrText(l.text)))).toEqual([
      ["+21最大生命"],
      [normalizeOcrText(UNKNOWN)],
      ["增加25%護甲值和閃避"],
    ]);
    expect(r.groups.map((g) => g.partial)).toEqual([false, true, false]);
    expect(r.groups[1].candidates).toEqual([]);
    expect(r.groups[0].candidates.length).toBeGreaterThan(0);
    expect(r.groups[2].candidates.length).toBeGreaterThan(0);
  });

  it("中間的未命中行 x 不對齊(小地圖 / 背包字)→ 不併入,面板照舊斷開(no-panel)", () => {
    const ls = layout(singles3, 4.6);
    ls[1] = at(ls[1], { x: ls[1].x + 6 * H });
    expect(matchReveal(ls, data).ok).toBe(false);
  });

  it("中間的未命中行行高差太多(1.5×)→ 不併入(no-panel)", () => {
    const ls = layout(singles3, 4.6);
    ls[1] = at(ls[1], { y: ls[1].y - 0.25 * H, h: 1.5 * H });
    expect(matchReveal(ls, data).ok).toBe(false);
  });

  it("面板上方的標題(字大)與下方的「確認」按鈕不會變成 partial 組", () => {
    const ls = layout(singles3, 4.6);
    const top = ls[0].y;
    const bottom = ls[2].y + ls[2].h;
    const extra: OcrTextLine[] = [
      { text: "靈 魂 之 井", x: 480 - 86, y: top - 14.5 * H, w: 173, h: 1.37 * H },
      { text: "確 認", x: 480 - 20, y: bottom + 2.9 * H, w: 40, h: H },
    ];
    const r = okResult(matchReveal([...ls, ...extra], data, { refName: "Rogue Armour" }));
    expect(r.groups).toHaveLength(3);
    const all = r.groups.flatMap((g) => g.lines.map((l) => normalizeOcrText(l.text)));
    expect(all.some((t) => /靈魂之井|確認/.test(t))).toBe(false);
  });

  it("三組都認得出時,夾在兩組之間的雜字(離兩組都遠)不會擠掉真的選項", () => {
    const ls = layout([["+21 最 大 生 命"], ["增 加 25 % 護 甲 值 和 閃 避"], ["+86 護 甲 值"]], 4.6);
    const mid = (ls[0].y + ls[1].y) / 2;
    const stray: OcrTextLine = { text: "雜 字", x: 480 - 20, y: mid, w: 40, h: H };
    const r = okResult(matchReveal([...ls, stray], data, { refName: "Rogue Armour" }));
    for (const g of r.groups) console.log(`[雜字] ${g.lines.map((l) => normalizeOcrText(l.text)).join(" / ")} partial=${g.partial} → ${g.candidates.map((c) => c.entryIds.join("+")).join(", ")}`);
    expect(r.groups.map((g) => g.lines.map((l) => normalizeOcrText(l.text)))).toEqual([
      ["+21最大生命"],
      ["增加25%護甲值和閃避"],
      ["+86護甲值"],
    ]);
    // 三組都是真的命中(不是 partial);雜字不在任何組
    expect(r.groups.every((g) => !g.partial && g.lines.every((l) => l.match))).toBe(true);
    expect(r.groups[0].candidates.length).toBeGreaterThan(0);
    expect(r.groups[1].candidates.length).toBeGreaterThan(0);
  });

  it("只有 1 組對上 + 一行未命中 → 仍是 no-panel(至少 2 組要真的對上詞綴)", () => {
    const ls = layout([["+21 最 大 生 命"], [UNKNOWN]], 4.6);
    expect(matchReveal(ls, data).ok).toBe(false);
  });
});
