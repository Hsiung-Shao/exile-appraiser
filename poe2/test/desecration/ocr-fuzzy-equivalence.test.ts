/**
 * exile-appraiser 效能修正第 8 步:OCR 模糊比對(長度剪枝 + 碼點快取 + 結果 LRU)與改前**逐位元相同**。
 *
 * oracle = 改前(commit 3088f8a)`ocr-text.ts` `levenshtein` / `skeletonSimilarity`、`ocr-locate.ts` `lineLooksLikeMod`、
 * `ocr-match.ts` `matchLine`、`runeshape/match-core.ts` `lookup` 的逐字複製(只留在本測試檔,src 不保留舊實作)。
 * 樣本:全部 OCR 快照的每一行(含相鄰兩行接起來 = 折行合併的查詢)、資料檔所有 skeleton / 名稱 key 本身、
 * 固定種子的隨機擾動(刪字、換字、插字、加數字、繁中 / 英文混雜)。每個查詢跑兩次(第二次走快取)都要與 oracle 相同,
 * 含分數(Object.is)、候選順序與物件身分。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CJK,
  EPS,
  FUZZY_MAX_LEN_DIFF,
  FUZZY_MIN_SIM,
  FuzzyCandidates,
  Lru,
  fuzzyLengthPossible,
  levenshtein,
  normalizeOcrText,
  ocrSkeleton,
  skeletonSimilarity,
} from "@/desecration/ocr-text";
import { buildLocateIndex, lineLooksLikeMod, type LocateIndex } from "@/desecration/ocr-locate";
import { matchLine, ocrIndex, type LineMatch, type TemplateHit } from "@/desecration/ocr-match";
import { buildRuneshapeIndex, lookupRuneName, type NameEntry, type RuneshapeRecipesFile } from "@/runeshape/match-core";
import { parseRuneRow } from "@/runeshape/row-format";
import type { DesecrationData } from "@/desecration/infer";
import type { BaseProfiles, DesecrationTiers } from "@/desecration/types";

const ROOT = path.resolve(__dirname, "../../..");
const DES = path.join(ROOT, "data/poe2/desecration");
const data: DesecrationData = {
  tiers: JSON.parse(fs.readFileSync(path.join(DES, "tiers.json"), "utf8")) as DesecrationTiers,
  baseProfiles: JSON.parse(fs.readFileSync(path.join(DES, "base_profiles.json"), "utf8")) as BaseProfiles,
};
const locIdx: LocateIndex = buildLocateIndex(data.tiers);
const mIdx = ocrIndex(data);

const readNdjson = (file: string): NameEntry[] =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as NameEntry);
const recipes = (JSON.parse(fs.readFileSync(path.join(ROOT, "data/poe2/runeshape/recipes.json"), "utf8")) as RuneshapeRecipesFile)
  .recipes;
const runeIdxZh = buildRuneshapeIndex(readNdjson(path.join(ROOT, "data/poe2/cmn-Hant/items.ndjson")), recipes);
const runeIdxEn = buildRuneshapeIndex(readNdjson(path.join(ROOT, "data/poe2/en/items.ndjson")), recipes);
const runeMaps = [runeIdxZh.item, runeIdxZh.skill, runeIdxZh.support, runeIdxZh.recipe, runeIdxEn.item, runeIdxEn.skill, runeIdxEn.support];

// ---------------------------------------------------------------- oracle(3088f8a 逐字)

function oldLevenshtein(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}

function oldSkeletonSimilarity(a: string, b: string): number {
  const la = [...a].length;
  const lb = [...b].length;
  if (Math.abs(la - lb) > FUZZY_MAX_LEN_DIFF) return 0;
  return 1 - oldLevenshtein(a, b) / Math.max(la, lb, 1);
}

function oldLineLooksLikeMod(text: string, idx: LocateIndex): boolean {
  const norm = normalizeOcrText(text);
  if (!CJK.test(norm)) return false;
  const { skeleton } = ocrSkeleton(norm);
  if (idx.set.has(skeleton)) return true;
  for (const t of idx.list) {
    if (oldSkeletonSimilarity(skeleton, t) >= FUZZY_MIN_SIM - EPS) return true;
  }
  return false;
}

function oldMatchLine(text: string): LineMatch | null {
  const norm = normalizeOcrText(text);
  if (!CJK.test(norm)) return null;
  const idx = mIdx;
  const { skeleton, values } = ocrSkeleton(norm);
  const exact = idx.bySkeleton.get(skeleton);
  if (exact) return { norm, skeleton, values, hits: [{ info: exact, score: 1, fuzzy: false }] };
  const len = [...skeleton].length;
  let best = 0;
  let hits: TemplateHit[] = [];
  for (const info of idx.list) {
    const l2 = [...info.skeleton].length;
    if (Math.abs(l2 - len) > FUZZY_MAX_LEN_DIFF) continue;
    const sim = 1 - oldLevenshtein(skeleton, info.skeleton) / Math.max(len, l2);
    if (sim < FUZZY_MIN_SIM - EPS || sim < best - EPS) continue;
    if (sim > best + EPS) {
      best = sim;
      hits = [];
    }
    hits.push({ info, score: sim, fuzzy: true });
  }
  return hits.length ? { norm, skeleton, values, hits } : null;
}

type Entry = NonNullable<ReturnType<typeof lookupRuneName>>["entries"][number];
interface OldLookup {
  match: "exact" | "fuzzy";
  entries: Entry[];
  similarity?: number;
}
function oldTopEntries(list: Entry[]): Entry[] {
  const best = Math.min(...list.map((e) => e.rank));
  const out: Entry[] = [];
  for (const e of list) if (e.rank === best && !out.some((x) => x.refName === e.refName)) out.push(e);
  return out;
}
const oldDigitsOf = (s: string) => (s.match(/\d+/g) ?? []).join(",");
function oldLookup(map: Map<string, Entry[]>, name: string): OldLookup | null {
  if (!name) return null;
  const exact = map.get(name);
  if (exact?.length) return { match: "exact", entries: oldTopEntries(exact) };
  const len = [...name].length;
  const digits = oldDigitsOf(name);
  let best = 0;
  let hits: Entry[] = [];
  for (const [key, list] of map) {
    const kl = [...key].length;
    if (Math.abs(kl - len) > FUZZY_MAX_LEN_DIFF) continue;
    if (oldDigitsOf(key) !== digits) continue;
    const sim = 1 - oldLevenshtein(name, key) / Math.max(kl, len, 1);
    if (sim < FUZZY_MIN_SIM - EPS) continue;
    if (sim > best + EPS) {
      best = sim;
      hits = [...list];
    } else if (Math.abs(sim - best) <= EPS) {
      hits.push(...list);
    }
  }
  if (!hits.length) return null;
  return { match: "fuzzy", entries: oldTopEntries(hits), similarity: Math.round(best * 1000) / 1000 };
}

// ---------------------------------------------------------------- 樣本

interface SnapLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
function fixtureTexts(dir: string): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".ocr.json")).sort()) {
    const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>;
    const sets: SnapLine[][] = [];
    const collect = (v: unknown) => {
      if (v && typeof v === "object" && Array.isArray((v as { lines?: unknown }).lines)) sets.push((v as { lines: SnapLine[] }).lines);
    };
    collect(snap);
    for (const v of Object.values(snap)) collect(v);
    for (const lines of sets) {
      const sorted = [...lines].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
      sorted.forEach((l, i) => {
        out.push(l.text);
        if (sorted[i + 1]) out.push(l.text + sorted[i + 1].text);
      });
    }
  }
  return out;
}
const desFixtureTexts = fixtureTexts(path.join(__dirname, "fixtures/ocr"));
const runeFixtureTexts = fixtureTexts(path.join(__dirname, "../runeshape/fixtures/ocr"));
const allFixtureTexts = [...desFixtureTexts, ...runeFixtureTexts];

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CJK_POOL = [...new Set([...mIdx.list.map((i) => i.skeleton).join("")].filter((c) => CJK.test(c)))];
const ASCII_POOL = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%+-.:()| OoIl"];
const EN_WORDS = ["increased", "Attack", "Speed", "Life", "+", "to", "Level", "x", "Rune", "Soul"];

function perturb(base: string, r: () => number): string {
  let cs = [...base];
  const ops = 1 + Math.floor(r() * 3);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const randChar = () => (r() < 0.7 ? pick(CJK_POOL) : pick(ASCII_POOL));
  for (let k = 0; k < ops; k++) {
    const op = Math.floor(r() * 6);
    const at = Math.floor(r() * (cs.length + 1));
    if (op === 0 && cs.length) cs.splice(Math.min(at, cs.length - 1), 1); // 刪字
    else if (op === 1 && cs.length) cs[Math.min(at, cs.length - 1)] = randChar(); // 換字
    else if (op === 2) cs.splice(at, 0, randChar()); // 插字
    else if (op === 3) cs.splice(at, 0, ...String(Math.floor(r() * 200))); // 加數字
    else if (op === 4) cs.splice(at, 0, " ", ...pick(EN_WORDS), " "); // 英文混雜
    else cs = [...cs.join("").replace(/#/g, () => String(Math.floor(r() * 100)))]; // 把 # 填數字
  }
  return cs.join("");
}

const N_RANDOM = 6000;

// ---------------------------------------------------------------- 比對工具

function sameLineMatch(a: LineMatch | null, b: LineMatch | null) {
  if (a === null || b === null) {
    expect(a).toBe(b);
    return;
  }
  expect(Object.keys(a)).toEqual(Object.keys(b));
  expect(a.norm).toBe(b.norm);
  expect(a.skeleton).toBe(b.skeleton);
  expect(a.values).toEqual(b.values);
  expect(a.hits.length).toBe(b.hits.length);
  a.hits.forEach((h, i) => {
    const o = b.hits[i];
    expect(Object.keys(h)).toEqual(Object.keys(o));
    expect(h.info).toBe(o.info);
    expect(Object.is(h.score, o.score)).toBe(true);
    expect(h.fuzzy).toBe(o.fuzzy);
  });
}

function sameLookup(a: ReturnType<typeof lookupRuneName>, b: OldLookup | null) {
  if (a === null || b === null) {
    expect(a).toBe(b);
    return;
  }
  expect(Object.keys(a)).toEqual(Object.keys(b));
  expect(a.match).toBe(b.match);
  expect(Object.is(a.similarity, b.similarity)).toBe(true);
  expect(a.entries.length).toBe(b.entries.length);
  a.entries.forEach((e, i) => expect(e).toBe(b.entries[i]));
}

// ---------------------------------------------------------------- 測試

describe("長度界限", () => {
  it("fuzzyLengthPossible 與「長度差 ≤ 2 且 1 − d/max ≥ 門檻」逐點相同,且換算為 d=1 → M≥7、d=2 → M≥14", () => {
    for (let L = 0; L <= 80; L++)
      for (let m = 0; m <= 82; m++) {
        const d = Math.abs(L - m);
        const M = Math.max(L, m, 1);
        expect(fuzzyLengthPossible(L, m)).toBe(d <= 2 && (d === 0 || (d === 1 && M >= 7) || (d === 2 && M >= 14)));
      }
  });

  it("界限是真的上界:被剪掉的長度組合,任何字串的相似度都低於門檻(窮舉短字串 + 隨機長字串)", () => {
    const r = rng(8);
    for (let k = 0; k < 3000; k++) {
      const L = 1 + Math.floor(r() * 20);
      const m = Math.max(0, L - 2 + Math.floor(r() * 5));
      if (fuzzyLengthPossible(L, m)) continue;
      const a = Array.from({ length: L }, () => "ab"[Math.floor(r() * 2)]).join("");
      const b = Array.from({ length: m }, () => "ab"[Math.floor(r() * 2)]).join("");
      expect(oldSkeletonSimilarity(a, b)).toBeLessThan(FUZZY_MIN_SIM - EPS);
    }
  });

  it("候選順序 = 原本順序(遞增索引),且涵蓋所有可能的長度", () => {
    const fc = new FuzzyCandidates(mIdx.list, (i) => i.skeleton);
    for (let L = 0; L <= 60; L++) {
      const c = fc.candidates(L);
      const want = mIdx.list.map((info, i) => [i, [...info.skeleton].length] as const).filter(([, m]) => fuzzyLengthPossible(L, m)).map(([i]) => i);
      expect(c).toEqual(want);
    }
  });
});

describe("Levenshtein / skeletonSimilarity 與舊實作相同", () => {
  it("資料 skeleton 兩兩(抽樣)+ 擾動 + 代理對", () => {
    const r = rng(1);
    const pool = [...mIdx.list.map((i) => i.skeleton), ...allFixtureTexts, "𠀋𠀌a", "a𠀋", "", "a"];
    for (let k = 0; k < 6000; k++) {
      const a = pool[Math.floor(r() * pool.length)];
      const b = r() < 0.5 ? perturb(a, r) : pool[Math.floor(r() * pool.length)];
      expect(levenshtein(a, b)).toBe(oldLevenshtein(a, b));
      expect(Object.is(skeletonSimilarity(a, b), oldSkeletonSimilarity(a, b))).toBe(true);
    }
  });
});

describe("lineLooksLikeMod 與舊實作相同", () => {
  const check = (texts: string[]) => {
    for (const t of texts) {
      const want = oldLineLooksLikeMod(t, locIdx);
      expect(lineLooksLikeMod(t, locIdx), t).toBe(want);
      expect(lineLooksLikeMod(t, locIdx), t).toBe(want); // 第二次走快取
    }
  };
  it("全部 OCR 快照的行(含相鄰兩行接起來)", () => check(allFixtureTexts));
  it("所有模板 skeleton 本身(# 原樣 / 填數字)", () => check(locIdx.list.flatMap((s) => [s, s.replace(/#/g, "12")])));
  it(`隨機擾動 ${N_RANDOM} 筆(種子 2)`, () => {
    const r = rng(2);
    const bases = [...locIdx.list, ...desFixtureTexts];
    check(Array.from({ length: N_RANDOM }, () => perturb(bases[Math.floor(r() * bases.length)], r)));
  });
  it("另一個索引物件(不含寫法變體)各自快取", () => {
    const noVariants = buildLocateIndex({ entries: data.tiers.entries.map((e) => ({ parts: e.parts.map((p) => ({ text: { zh: p.text.zh } })) })) });
    for (const t of desFixtureTexts.slice(0, 200)) expect(lineLooksLikeMod(t, noVariants)).toBe(oldLineLooksLikeMod(t, noVariants));
  });
});

describe("matchLine 與舊實作相同(含分數、候選順序、物件身分)", () => {
  const check = (texts: string[]) => {
    let fuzzy = 0;
    for (const t of texts) {
      const want = oldMatchLine(t);
      sameLineMatch(matchLine(t, data), want);
      sameLineMatch(matchLine(t, data), want); // 第二次走快取
      if (want?.hits[0].fuzzy) fuzzy++;
    }
    return fuzzy;
  };
  it("全部 OCR 快照的行(含相鄰兩行接起來)", () => {
    check(allFixtureTexts);
  });
  it("所有模板 skeleton 本身(# 原樣 / 填數字)", () => {
    check(mIdx.list.flatMap((i) => [i.skeleton, i.skeleton.replace(/#/g, "7")]));
  });
  it(`隨機擾動 ${N_RANDOM} 筆(種子 3),其中確實有模糊命中與多候選同分`, () => {
    const r = rng(3);
    const bases = [...mIdx.list.map((i) => i.skeleton), ...desFixtureTexts];
    const texts = Array.from({ length: N_RANDOM }, () => perturb(bases[Math.floor(r() * bases.length)], r));
    const fuzzy = check(texts);
    expect(fuzzy).toBeGreaterThan(500);
    expect(texts.some((t) => (oldMatchLine(t)?.hits.length ?? 0) > 1)).toBe(true);
  });
  it("回傳的物件不與快取共用(改了不影響下一次)", () => {
    const t = perturb(mIdx.list[5].skeleton, rng(9));
    const a = matchLine(t, data);
    if (a) {
      a.hits.length = 0;
      a.values.push(999);
    }
    sameLineMatch(matchLine(t, data), oldMatchLine(t));
  });
});

describe("符文塑形 lookup 與舊實作相同(含相似度、候選順序、物件身分)", () => {
  const queriesOf = (texts: string[]) =>
    texts.flatMap((t) => {
      const p = parseRuneRow(t);
      return p.prefixed ? [p.fullName, `${p.quantity}x${p.fullName}`] : [p.fullName];
    });
  const check = (names: string[], maps = runeMaps) => {
    let fuzzy = 0;
    for (const name of names)
      for (const map of maps) {
        const want = oldLookup(map, name);
        sameLookup(lookupRuneName(map, name), want);
        sameLookup(lookupRuneName(map, name), want); // 第二次走快取
        if (want?.match === "fuzzy") fuzzy++;
      }
    return fuzzy;
  };
  it("全部 OCR 快照的行(列格式解析後的名稱,含 Nx 整串)", () => {
    check(queriesOf(allFixtureTexts));
  });
  it("所有 key 本身(對自己的 map 與繁中 ITEM map)", () => {
    for (const m of runeMaps) check([...m.keys()], m === runeIdxZh.item ? [m] : [m, runeIdxZh.item]);
  });
  it(`隨機擾動 ${N_RANDOM} 筆(種子 4),其中確實有模糊命中`, () => {
    const r = rng(4);
    const bases = [...new Set([...runeIdxZh.item.keys(), ...runeIdxZh.skill.keys(), ...runeIdxZh.recipe.keys(), ...runeIdxEn.item.keys()])];
    const names = Array.from({ length: N_RANDOM }, () => normalizeOcrText(perturb(bases[Math.floor(r() * bases.length)], r)));
    expect(check(names, [runeIdxZh.item, runeIdxZh.skill, runeIdxZh.support, runeIdxZh.recipe, runeIdxEn.item])).toBeGreaterThan(300);
  });
});

describe("LRU", () => {
  it("上限、最近使用的保留、值可為 null / false", () => {
    const l = new Lru<string, boolean | null>(3);
    l.set("a", false);
    l.set("b", null);
    l.set("c", true);
    expect(l.get("a")).toBe(false); // a 變最新
    l.set("d", true); // 擠掉最舊的 b
    expect(l.has("b")).toBe(false);
    expect(l.get("b")).toBeUndefined();
    expect(l.has("a") && l.has("c") && l.has("d")).toBe(true);
    expect(l.size).toBe(3);
  });
  it("超過上限仍與舊實作相同(快取被擠掉後重算)", () => {
    const r = rng(5);
    const texts = Array.from({ length: 2500 }, () => perturb(locIdx.list[Math.floor(r() * locIdx.list.length)], r));
    for (const t of [...texts, ...texts.slice(0, 300)]) expect(lineLooksLikeMod(t, locIdx)).toBe(oldLineLooksLikeMod(t, locIdx));
  });
});
