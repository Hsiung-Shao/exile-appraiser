/**
 * exile-appraiser(2026-10-03):profile 提示(最近 10 分鐘查過價的物品)與揭露面板不符時否決提示。
 * 使用者實機:先查價 `Militant Bow`,再開另一把武器的靈魂之井面板(`well-of-souls-weapon-en-04`)→
 * 提示下只有第 1 組對得上、第 2 / 3 組「此底材擲不出對應的詞綴」。
 * 規則:提示下有任一組對不上、而改用推算的可能底材(交集;交集為空 = 全部)對不上的組更少 → `profileSource: "hint-rejected"`,
 * 結果與沒有提示時相同(只多 `rejectedHint`);提示全部對得上 → 行為完全不變(精確 Tier)。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { matchReveal, type OcrTextLine, type RevealMatchResult } from "@/desecration/ocr-match";
import type { DesecrationData } from "@/desecration/infer";
import type { BaseProfiles, DesecrationTiers } from "@/desecration/types";

const DATA_DIR = path.resolve(__dirname, "../../../data/poe2/desecration");
const data: DesecrationData = {
  tiers: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tiers.json"), "utf8")) as DesecrationTiers,
  baseProfiles: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "base_profiles.json"), "utf8")) as BaseProfiles,
};

function load(name: string): OcrTextLine[] {
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/ocr", `${name}.ocr.json`), "utf8")) as {
    scale: number;
    lines: OcrTextLine[];
  };
  return snap.lines.map((l) => ({ text: l.text, x: l.x / snap.scale, y: l.y / snap.scale, w: l.w / snap.scale, h: l.h / snap.scale }));
}

function ok(r: RevealMatchResult) {
  if (!r.ok) throw new Error(`預期 ok,得到 ${r.error}`);
  return r;
}

/** 提示 profile 是否在交集裡:取交集中任一 profile 對應的底材名(base_profiles 依字母序的第一個) */
function baseInIntersection(lines: OcrTextLine[], lang?: "en"): string {
  const r = ok(matchReveal(lines, data, lang ? { lang } : {}));
  expect(r.profileSource).toBe("intersection");
  // 交集裡的 profile:每組候選 entry 的 profile_tiers 鍵取交集
  const ids = r.groups.map((g) => new Set(g.candidates.flatMap((c) => c.entryIds)));
  const entries = data.tiers.entries;
  const perGroup = ids.map((set) => new Set(entries.filter((e) => set.has(e.mod_id)).flatMap((e) => Object.keys(e.profile_tiers))));
  const inter = [...perGroup[0]].filter((p) => perGroup.every((s) => s.has(p)));
  const name = Object.keys(data.baseProfiles.profiles)
    .sort()
    .find((n) => inter.includes(data.baseProfiles.profiles[n]));
  expect(name).toBeDefined();
  return name!;
}

const cases = [
  { label: "英文 well-of-souls-weapon-en-04", lines: load("well-of-souls-weapon-en-04"), lang: "en" as const },
  { label: "繁中 well-of-souls-body-armour-01", lines: load("well-of-souls-body-armour-01"), lang: undefined },
];

describe("profile 提示與面板不符 → 否決提示(hint-rejected)", () => {
  for (const { label, lines, lang } of cases) {
    const L = lang ? { lang } : {};
    const none = ok(matchReveal(lines, data, L));

    it(`${label}:提示 Militant Bow(與面板不符)→ 三組都有結果、profileSource = hint-rejected、結果與無提示相同`, () => {
      expect(data.baseProfiles.profiles["Militant Bow"]).toBeDefined();
      const r = ok(matchReveal(lines, data, { ...L, refName: "Militant Bow" }));
      expect(r.profileSource).toBe("hint-rejected");
      expect(r.profileExact).toBe(false);
      expect(r.groups).toHaveLength(3);
      for (const g of r.groups) expect(g.candidates.length).toBeGreaterThan(0);
      expect(r.groups).toEqual(none.groups);
      expect(r.rejectedHint).toMatchObject({ refName: "Militant Bow", hintSource: "refName", fallback: "intersection", fallbackNoMatch: 0, groups: 3 });
      expect(r.rejectedHint!.hintNoMatch).toBeGreaterThan(0);
      console.log(`[${label}] Militant Bow 否決:${JSON.stringify(r.rejectedHint)}`);
    });

    it(`${label}:提示 = 交集中的底材 → 維持提示(refName、精確 Tier),沒有 rejectedHint`, () => {
      const base = baseInIntersection(lines, lang);
      const r = ok(matchReveal(lines, data, { ...L, refName: base }));
      console.log(`[${label}] 正確底材 ${base} → ${data.baseProfiles.profiles[base]}`);
      expect(r.profileSource).toBe("refName");
      expect(r.profileExact).toBe(true);
      expect(r.rejectedHint).toBeUndefined();
      for (const g of r.groups) {
        expect(g.candidates.length).toBeGreaterThan(0);
        for (const c of g.candidates) expect(c.tier).toBeDefined();
      }
      expect(r.groups.map((g) => g.candidates.map((c) => c.entryIds))).toEqual(none.groups.map((g) => g.candidates.map((c) => c.entryIds)));
    });

    it(`${label}:只有類別提示(Bow,與面板不符)→ hint-rejected,hintSource = category`, () => {
      const r = ok(matchReveal(lines, data, { ...L, category: "Bow" }));
      expect(r.profileSource).toBe("hint-rejected");
      expect(r.rejectedHint).toMatchObject({ hintSource: "category", category: "Bow" });
      expect(r.groups).toEqual(none.groups);
    });

    it(`${label}:提示被否決且不取交集 → 改用全部 profile(fallback = all)`, () => {
      const r = ok(matchReveal(lines, data, { ...L, refName: "Militant Bow", intersectProfiles: false }));
      expect(r.profileSource).toBe("hint-rejected");
      expect(r.rejectedHint!.fallback).toBe("all");
      expect(r.groups).toEqual(ok(matchReveal(lines, data, { ...L, intersectProfiles: false })).groups);
    });

    it(`${label}:沒有提示的結果不帶 rejectedHint 欄位(快照逐字不變)`, () => {
      expect("rejectedHint" in none).toBe(false);
      expect(none.profileSource).toBe("intersection");
    });
  }

  it("使用者實機:Militant Bow 提示下第 1 組(火焰穿透)對得上、第 2 / 3 組對不上 → hintNoMatch = 2", () => {
    const r = ok(matchReveal(load("well-of-souls-weapon-en-04"), data, { lang: "en", refName: "Militant Bow" }));
    expect(r.rejectedHint!.hintNoMatch).toBe(2);
  });
});
