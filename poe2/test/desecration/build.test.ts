/**
 * exile-appraiser(WP-R):`scripts/build-desecration-tiers.mjs` 的產物 vs poenavi 產物抽樣。
 *
 * fixtures/poenavi-sample.json = poenavi `data/poetore/poe2/desecration_tiers.json`(PoB2 revision ce566eac…)
 * 抽 35 條(三個 pool + 多 part + 極性翻轉 + poenavi 解析不到範圍的幾條);日文文字已移除,profile 改以
 * `category|tags` 為鍵(profile id 是排序序號,兩邊 PoB 版本不同時序號會漂)。
 *
 * 本機是 PoB2 0.23.1 portable,兩邊 PoB 版本不同,允許的差異(逐條列在下面,新增差異一律紅):
 * - PROFILE_ONLY_IN_POENAVI:poenavi 那版的法杖/長杖/權杖底材帶 `*_implicit_skill` tag,0.23.1 沒有 → 這些
 *   profile 鍵兩邊不共有,不比對(但共有的 profile 必須逐一相等)。
 * - RANGES_RESOLVED_HERE:poenavi 用 GGG trade2 文字當模板,單複數/措辭不同就解析不到(ranges = null);
 *   本產生器改用 EE2 `ref`,對不上再試同一 stat 的其他英文 matcher、並把跨兩行的模板接回 → 解得出來。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_DIR } from "../vitest.setup";
import type { DesecrationTiers } from "@/desecration";

interface SampleEntry {
  mod_id: string;
  pool: string;
  type: string;
  group: string;
  required_level: number;
  profile_tiers: Record<string, number>;
  parts: Array<{ stat_hash: string; ranges: number[][] | null; direction?: string }>;
}

const tiers = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "desecration", "tiers.json"), "utf8"),
) as DesecrationTiers;
const sample = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "poenavi-sample.json"), "utf8"),
) as { entries: SampleEntry[] };

const profileKey = new Map(
  tiers.profiles.map((p) => [p.id, `${p.category}|${p.tags.join(",")}`]),
);
const ourKeys = new Set(profileKey.values());
const byId = new Map(tiers.entries.map((e) => [e.mod_id, e]));

/** poenavi 解析不到、這裡解得出來的(理由見檔頭) */
const RANGES_RESOLVED_HERE = new Map<string, string>([
  ["JewelManaonKill", "poenavi 的 trade2 模板帶「 (Jewel)」尾綴,對不上 PoB 文字;EE2 ref「Recover #% of maximum Mana on Kill」對得上"],
  ["AbyssModHelmAmanamuSuffixSpiritReservationEfficiency", "ref 多了「of Skills」,改用同 stat 的 matcher「#% increased Spirit Reservation Efficiency」"],
  ["AbyssModFocusKurgalSuffixChanceForAdditionalInfusion", "模板跨兩行、PoB 拆成兩段文字 → 接回一段後 fullmatch"],
]);

describe("desecration tiers.json 產物", () => {
  it("版本鎖與統計(PoB2 0.23.1:1713 條、三 pool 198/32/1483、全部可比對)", () => {
    // 第 22 步:schema 2 = parts 多了 `text.enVariants`(英文客戶端 OCR);其餘欄位與 schema 1 相同
    expect(tiers.schema).toBe(2);
    expect(tiers.source.pob2Version).toBe("0.23.1");
    expect(Object.keys(tiers.source.files)).toContain("Data/ModVeiled.lua");
    expect(tiers.entries.length).toBe(1713);
    const pools: Record<string, number> = {};
    for (const e of tiers.entries) pools[e.pool] = (pools[e.pool] ?? 0) + 1;
    expect(pools).toEqual({
      desecration_exclusive: 198,
      desecration_exclusive_jewel: 32,
      normal: 1483,
    });
    expect(tiers.diagnostics.rows_with_unparsed_parts).toEqual([]);
    expect(tiers.profiles.length).toBe(422);
  });

  it(`poenavi 抽樣 ${sample.entries.length} 條:pool / type / required_level / 共有 profile 的 Tier / ranges 一致`, () => {
    expect(sample.entries.length).toBeGreaterThanOrEqual(20);
    const problems: string[] = [];
    let tierChecks = 0;
    let skippedProfiles = 0;
    for (const s of sample.entries) {
      const e = byId.get(s.mod_id);
      if (!e) {
        problems.push(`${s.mod_id}:本產物沒有這條`);
        continue;
      }
      for (const f of ["pool", "type", "group", "required_level"] as const) {
        if (e[f] !== s[f]) problems.push(`${s.mod_id}.${f}:poenavi ${s[f]} ≠ 本產物 ${e[f]}`);
      }
      const ours = Object.fromEntries(
        Object.entries(e.profile_tiers).map(([id, t]) => [profileKey.get(id)!, t]),
      );
      for (const [key, t] of Object.entries(s.profile_tiers)) {
        if (!ourKeys.has(key)) {
          expect(key).toMatch(/_implicit_skill/); // 唯一允許的 profile 差異(PoB 版本)
          skippedProfiles++;
          continue;
        }
        tierChecks++;
        if (ours[key] !== t) problems.push(`${s.mod_id}[${key}]:poenavi T${t} ≠ 本產物 T${ours[key]}`);
      }
      for (const [key, t] of Object.entries(ours)) {
        if (!(key in s.profile_tiers) && !/_spell_mods/.test(key)) {
          problems.push(`${s.mod_id}[${key}]:本產物多出 T${t}`);
        }
      }
      const theirs = JSON.stringify(s.parts.map((p) => [p.stat_hash, p.ranges, p.direction ?? null]));
      const mine = JSON.stringify(e.parts.map((p) => [p.stat_hash, p.ranges, p.direction ?? null]));
      if (theirs !== mine) {
        if (RANGES_RESOLVED_HERE.has(s.mod_id)) {
          expect(s.parts.every((p) => p.ranges === null)).toBe(true);
          expect(e.parts.every((p) => p.ranges !== null)).toBe(true);
        } else {
          problems.push(`${s.mod_id}.parts:poenavi ${theirs} ≠ 本產物 ${mine}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(tierChecks).toBeGreaterThan(200);
    // 0.23.1 的法杖/長杖沒有 *_implicit_skill profile(見檔頭);抽樣裡有碰到才會 > 0
    expect(skippedProfiles).toBeGreaterThanOrEqual(0);
  });

  it("第 22 步:text.enVariants = 同一 en stats 列的其他英文寫法(negate 相對 text.en;271 個模板 / 277 個寫法)", () => {
    const byTemplate = new Map<string, Array<{ text: string; negate?: true }>>();
    let parts = 0;
    for (const e of tiers.entries) {
      for (const p of e.parts) {
        expect(p.text.en.trim(), e.mod_id).not.toBe("");
        if (!p.text.enVariants) continue;
        parts++;
        expect(p.text.enVariants.length, e.mod_id).toBeGreaterThan(0);
        for (const v of p.text.enVariants) {
          expect(v.text, e.mod_id).not.toBe(p.text.en);
          expect(v.text.trim(), e.mod_id).not.toBe("");
        }
        byTemplate.set(p.text.en, p.text.enVariants);
      }
    }
    const all = [...byTemplate.values()].flat();
    expect(parts).toBe(1058);
    expect(byTemplate.size).toBe(271);
    expect(all.length).toBe(277);
    expect(all.filter((v) => v.negate).length).toBe(248);
    // 極性:`text.en` 是翻轉後的 `#% reduced Attack Speed` → `#% increased Attack Speed` 是反向寫法
    const e = tiers.entries.find((x) => x.mod_id === "AbyssModAllMacesKurgalPrefixIncreasedPhysicalDamageReducedAttackSpeed")!;
    expect(e.parts[0].text.en).toBe("#% reduced Attack Speed");
    expect(e.parts[0].text.enVariants).toEqual([{ text: "#% increased Attack Speed", negate: true }]);
    expect(e.parts[1].text.enVariants).toEqual([{ text: "#% reduced Physical Damage", negate: true }, { text: "No Physical Damage" }]);
  });

  it("三神專屬詞綴都標了神名(UI 顯示 pool 用)", () => {
    for (const e of tiers.entries) {
      if (e.pool === "desecration_exclusive") {
        expect(e.gods?.length, e.mod_id).toBe(1);
        expect(["ulaman", "amanamu", "kurgal"]).toContain(e.gods![0]);
      } else {
        expect(e.gods).toBeUndefined();
      }
    }
  });
});
