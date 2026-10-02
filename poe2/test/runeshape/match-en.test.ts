/**
 * exile-appraiser(2026-10-02 第 22 步):英文客戶端的符文塑形面板(`buildRuneshapeIndex(…, "en")`)。
 * 四張使用者提供的英文截圖(`fixtures/ocr/runeshape-*-en-*.png`;`node scripts/ocr-fixture.mjs --set runeshape -en-` 以 en-US 語言包產生快照):
 * Runes / Uniques / Currency / Gems 分頁 → 每列的類型、refName(語言無關鍵)、數量、等級、poe.ninja 鍵、錄製價格表有沒有價;
 * `Undiscovered` 不畫、泛稱(`Random Currency`、`Rare Unique Item`、`Unique Ring`…)= 配方、不查價。
 * 另測英文列格式(前綴字串取自 GGPK clientstrings2)、OCR 誤讀、自動定位(漏前綴的列也框進來)、被切開的 `Skill:` 接回。
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createNinjaClient, toSnapshot, type NinjaSnapshot } from "@exile-appraiser/core/ninja";
import type { HttpFetch } from "@exile-appraiser/core/http";
import { init, ITEMS_ITERATOR, LOADED_DATA, RUNESHAPE_RECIPES } from "@/assets/data";
import { buildRuneshapeIndex, matchRunesRows, matchRunesRowsWith, type RuneshapeIndex, type RuneshapeOcrRow } from "@/runeshape/match";
import {
  EN_UNDISCOVERED_MIN_SIM,
  isPanelRow,
  isUndiscoveredName,
  isUndiscoveredRow,
  joinSplitRowsEn,
  locateRunePanel,
  looksVertical,
  parseRuneRow,
} from "@/runeshape/row-format";

const FIX = path.join(__dirname, "fixtures/ocr");
const REC = path.join(__dirname, "../../../core/test/recordings/ninja/poe2");

interface OcrLine { text: string; x: number; y: number; w: number; h: number }
interface Fixture {
  srcW: number;
  srcH: number;
  scale: number;
  lang: string;
  lines: OcrLine[];
  locate: { scale: 1; lines: OcrLine[] };
  detail?: { crop: { x: number; y: number; w: number; h: number }; scale: number; lines: OcrLine[] };
}
const fixture = (name: string): Fixture => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.ocr.json`), "utf8"));
const toSrc = (lines: OcrLine[], scale: number, off = { x: 0, y: 0 }): RuneshapeOcrRow[] =>
  lines.map((l) => ({ text: l.text, x: l.x / scale + off.x, y: l.y / scale + off.y, w: l.w / scale, h: l.h / scale }));
const fullRows = (f: Fixture) => toSrc(f.lines, f.scale);
const detailRows = (f: Fixture) => toSrc(f.detail!.lines, f.detail!.scale, f.detail!.crop);

async function recordedSnapshot(): Promise<NinjaSnapshot> {
  const http: HttpFetch = async (url) => {
    const type = new URL(url).searchParams.get("type");
    const file = path.join(REC, `exchange_${type}.json`);
    const ok = fs.existsSync(file);
    const body = ok ? fs.readFileSync(file, "utf8") : "not found";
    return { ok, status: ok ? 200 : 404, headers: new Headers(), json: async () => JSON.parse(body), text: async () => body };
  };
  const client = createNinjaClient({ http, game: "poe2", league: "Forbidden Rites", sleep: async () => {} });
  return toSnapshot(await client.fetchAll({ exchange: ["Currency", "Runes", "SoulCores", "UncutGems", "Verisium", "Expedition", "LineageSupportGems"], item: [] }));
}

let snap: NinjaSnapshot;
let index: RuneshapeIndex;
beforeAll(async () => {
  await init("en");
  snap = await recordedSnapshot();
  index = buildRuneshapeIndex([...ITEMS_ITERATOR('"namespace": "ITEM"'), ...ITEMS_ITERATOR('"namespace": "GEM"')], RUNESHAPE_RECIPES?.recipes ?? [], "en");
});

/** 畫徽章的列 → [類型, refName, 數量, 等級, ninja 鍵, 錄製價格表有沒有價];面板外 / 未發現不列 */
const summarize = (rows: ReturnType<typeof matchRunesRowsWith>) =>
  rows.filter((r) => !r.offPanel && !r.undiscovered).map((r) => [
    r.kind,
    r.refName ?? null,
    r.quantity,
    r.level ?? null,
    r.ninjaKey === undefined ? "-" : r.ninjaKey,
    r.ninjaKey ? (snap.prices[r.ninjaKey]?.c ?? 0) > 0 : false,
  ]);

describe("真實英文截圖:runeshape-runes-en-03(Runes 分頁)", () => {
  const RUNES = [
    "Thrud's Might", "Perfect Orb of Transmutation", "Perfect Orb of Augmentation", "Masterwork Rune", "Rune of Confrontation",
    "Rune of Reach", "Rune of Consistency", "Rune of the Blossom", "Rune of the Prism", "Rune of Foundations", "Rune of Accumulation",
  ];
  const EXPECTED = RUNES.map((n) => ["item", n, 1, null, `currency|${n}`, true]);
  it("快照是 en-US 語言包;1x 被讀成 lx / IX", () => {
    const f = fixture("runeshape-runes-en-03");
    expect(f.lang).toBe("en-US");
    expect(f.lines.every((l) => l.text.startsWith("lx "))).toBe(true);
    expect(f.locate.lines.filter((l) => l.text.startsWith("IX ")).length).toBe(9);
  });
  it("整張 ×3:11 列全部精確對上 refName、都有 ninja 價", () => {
    const rows = matchRunesRowsWith(fullRows(fixture("runeshape-runes-en-03")), index);
    expect(summarize(rows)).toEqual(EXPECTED);
    expect(rows.every((r) => r.match === "exact")).toBe(true);
  });
  it("自動定位(×1)漏掉兩列的 `1x` → 往上接右緣對齊的列,裁切框仍包住第一列;定位框 ×3 同樣 11 列", () => {
    const f = fixture("runeshape-runes-en-03");
    const loc = locateRunePanel(f.locate.lines, { x: 0, y: 0, w: f.srcW, h: f.srcH }, "en")!;
    expect(loc.crop.y).toBeLessThanOrEqual(72);
    expect(loc.rows).toHaveLength(11);
    expect(summarize(matchRunesRowsWith(detailRows(f), index))).toEqual(EXPECTED);
  });
});

describe("真實英文截圖:runeshape-currency-en-05(Currency 分頁)", () => {
  const EXPECTED = [
    ["item", "Perfect Orb of Augmentation", 3, null, "currency|Perfect Orb of Augmentation", true],
    ["item", "Orb of Chance", 2, null, "currency|Orb of Chance", true],
    ["item", "Divine Orb", 2, null, "currency|Divine Orb", true],
    ["item", "Orb of Chance", 1, null, "currency|Orb of Chance", true],
    // 配方泛稱(GGPK expedition2recipes `5SlotAstackofrandomcurrency1` 的英文 Description)→ 不查價;數量是配方文字的一部分
    ["recipe", "5x Random Currency", 1, null, null, false],
    ["item", "Divine Orb", 1, null, "currency|Divine Orb", true],
    ["item", "Chaos Orb", 2, null, "currency|Chaos Orb", true],
    ["item", "Orb of Alchemy", 3, null, "currency|Orb of Alchemy", true],
    ["item", "Exalted Orb", 3, null, "currency|Exalted Orb", true],
    ["item", "Thaumaturgic Flux (Level 18)", 1, 18, "currency|Thaumaturgic Flux (Level 18)", true],
  ];
  it("整張 ×3:面板 10 列;分頁標題(Cuneuvj)與搜尋框在面板外", () => {
    const rows = matchRunesRowsWith(fullRows(fixture("runeshape-currency-en-05")), index);
    expect(summarize(rows)).toEqual(EXPECTED);
    expect(rows.filter((r) => r.offPanel).map((r) => r.text)).toEqual(["Cuneuvj", "p Search here"]);
    const random = rows.find((r) => r.kind === "recipe")!;
    expect(random.unpriced).toBe("recipe");
    expect(random.recipeId).toBe("5SlotAstackofrandomcurrency1");
  });
  it("定位框 ×3:同樣 10 列(×1 的 `3* Exalted Orb` 也認得)", () => {
    const f = fixture("runeshape-currency-en-05");
    expect(f.locate.lines.some((l) => l.text === "3* Exalted Orb")).toBe(true);
    expect(locateRunePanel(f.locate.lines, { x: 0, y: 0, w: f.srcW, h: f.srcH }, "en")!.rows).toHaveLength(10);
    expect(summarize(matchRunesRowsWith(detailRows(f), index))).toEqual(EXPECTED);
  });
});

describe("真實英文截圖:runeshape-gems-en-06(Gems 分頁)", () => {
  const EXPECTED = [
    ["item", "Uncut Spirit Gem (Level 19)", 1, 19, "currency|Uncut Spirit Gem (Level 19)", true],
    ["skill", "Rain of Blades", 1, null, null, false],
    ["skill", "Hollow Shell", 1, null, null, false],
    ["skill", "Powered by Verisium", 1, null, null, false],
    ["skill", "Remnants of Kalguur", 1, null, null, false],
  ];
  it("整張 ×3:`Skill:` 列走技能寶石(unpriced gem → 自動查市集);`Undiscovered` 三列(OCR 讀成 UUiscovereÅ)不畫", () => {
    const rows = matchRunesRowsWith(fullRows(fixture("runeshape-gems-en-06")), index);
    expect(summarize(rows)).toEqual(EXPECTED);
    expect(rows.filter((r) => r.kind === "skill").every((r) => r.unpriced === "gem")).toBe(true);
    const und = rows.filter((r) => r.undiscovered);
    expect(und.map((r) => r.text)).toEqual(["UUiscovereÅ", "UUiscovereÅ", "UUiscovereÅ"]);
    expect(und.every((r) => r.match === null && r.refName === undefined)).toBe(true);
  });
  it("定位框 ×3:OCR 把 `Skill:` 切成獨立一行 → 接回同一列,四列寶石都對上", () => {
    const f = fixture("runeshape-gems-en-06");
    expect(f.detail!.lines.filter((l) => l.text === "Skill:").length).toBe(2);
    const rows = matchRunesRowsWith(detailRows(f), index);
    expect(rows).toHaveLength(5);
    const sorted = summarize(rows).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    expect(sorted).toEqual([...EXPECTED].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
  });
  it("自動定位(×1:`Sklll` + `• : Powered by Verisium` 切成兩行)→ 接回後是面板列,裁切框包住全部 5 列", () => {
    const f = fixture("runeshape-gems-en-06");
    const loc = locateRunePanel(f.locate.lines, { x: 0, y: 0, w: f.srcW, h: f.srcH }, "en")!;
    expect(loc.rows.map((r) => r.text)).toEqual([
      "IX Uncut Spirit Gem (Level 19)",
      "Skill: Rain of Blades",
      "Skill: Hollow Shell",
      "Sklll: Powered by Verisium",
      "Sklll: Remnants of Kalguur",
    ]);
    expect(loc.crop.y + loc.crop.h).toBeGreaterThanOrEqual(361);
  });
});

describe("真實英文截圖:runeshape-uniques-en-04(Uniques 分頁:全是泛稱)", () => {
  const NAMES = [
    "Rare Unique Item", "Unique Ring", "Unique Belt", "Unique Amulet", "Unique Wand", "Unique Two Hand Mace",
    "Unique Talisman", "Unique Staff", "Unique Spear", "Unique Shield", "Unique Sceptre",
  ];
  it("每列都是配方泛稱(recipes.json 的 enPlain)→ recipe、無 ninja 鍵、不查價", () => {
    const rows = matchRunesRowsWith(fullRows(fixture("runeshape-uniques-en-04")), index);
    const recipes = rows.filter((r) => r.kind === "recipe");
    expect(recipes.map((r) => r.refName)).toEqual(NAMES);
    expect(recipes.every((r) => r.ninjaKey === null && r.unpriced === "recipe" && r.match === "exact")).toBe(true);
  });
  it("已知限制(與繁中相同):整頁沒有任何帶前綴的列 → 不算面板列,自動定位找不到、main 不送列(要框區域也一樣)", () => {
    const f = fixture("runeshape-uniques-en-04");
    expect(f.lines.filter((l) => isPanelRow(l.text, "en"))).toHaveLength(0);
    expect(locateRunePanel(f.locate.lines, { x: 0, y: 0, w: f.srcW, h: f.srcH }, "en")).toBeNull();
  });
});

describe("英文列格式(前綴字串:GGPK clientstrings2 RemnantRecipe*AutoDescription / clientstrings RemnantRecipeUndiscovered)", () => {
  it("`Nx`:IX / lx / l x / 3* / 1×;後面要有空白再接字母(`Ixchel's Torment` 不是數量)", () => {
    expect(parseRuneRow("IX Thrud's Might", "en")).toEqual({ kind: "item", name: "thrudsmight", fullName: "thrudsmight", quantity: 1, prefixed: true });
    expect(parseRuneRow("lx Rune of Reach", "en").quantity).toBe(1);
    expect(parseRuneRow("3* Exalted Orb", "en")).toMatchObject({ quantity: 3, name: "exaltedorb", prefixed: true });
    expect(parseRuneRow("12× Chaos Orb", "en").quantity).toBe(12);
    expect(parseRuneRow("Ixchel's Torment", "en")).toMatchObject({ prefixed: false, name: "ixchelstorment" });
  });
  it("`Skill Level N:` / `Skill:` / `Support:`(OCR 的 Sklll / 分號也認)", () => {
    expect(parseRuneRow("Skill Level 20: Conductive Runes", "en")).toMatchObject({ kind: "gem", gemLevel: 20, name: "conductiverunes", prefixed: true });
    expect(parseRuneRow("Skill: Rain of Blades", "en")).toMatchObject({ kind: "skill", name: "rainofblades" });
    expect(parseRuneRow("Sklll; Hollow Shell", "en")).toMatchObject({ kind: "skill", name: "hollowshell" });
    expect(parseRuneRow("Support: Concussive Runes", "en")).toMatchObject({ kind: "support", name: "concussiverunes" });
  });
  it("名稱後綴 `(Level N)`(右括號被吃掉也算)", () => {
    expect(parseRuneRow("lx Thaumaturgic Flux (Level 18)", "en")).toMatchObject({ name: "thaumaturgicflux", fullName: "thaumaturgicflux(level18)", level: 18 });
    expect(parseRuneRow("1x Uncut Spirit Gem (Level 19", "en")).toMatchObject({ fullName: "uncutspiritgem(level19)", level: 19 });
  });
  it("Undiscovered:手寫字體的 OCR 誤讀也算;太短 / 不像的不算", () => {
    for (const t of ["Undiscovered", "UUiscovered", "UUiscovereÅ", "Undiscoverd"]) expect(isUndiscoveredRow(t, "en"), t).toBe(true);
    for (const t of ["Divine Orb", "Discover", "Uncut Skill Gem", "Unique Ring"]) expect(isUndiscoveredRow(t, "en"), t).toBe(false);
    expect(EN_UNDISCOVERED_MIN_SIM).toBe(0.7);
    expect(isUndiscoveredName("未發現")).toBe(true);
    expect(isUndiscoveredName("undiscovered")).toBe(false); // 繁中規則只認「未發現」
  });
  it("面板列:有前綴、名稱至少 3 個字母;繁中規則看英文列 → 不是面板列", () => {
    expect(isPanelRow("lx Divine Orb", "en")).toBe(true);
    expect(isPanelRow("Skill: Hollow Shell", "en")).toBe(true);
    expect(isPanelRow("Skill:", "en")).toBe(false);
    expect(isPanelRow("Unique Ring", "en")).toBe(false);
    expect(isPanelRow("lx Divine Orb")).toBe(false);
    expect(looksVertical([{ text: "Divine Orb", x: 0, y: 0, w: 100, h: 20 }], "en")).toBe(false);
  });
  it("joinSplitRowsEn:只接「只有前綴」+ 同一列右邊那行;不同列不接", () => {
    const rows = joinSplitRowsEn([
      { text: "Skill:", x: 100, y: 10, w: 40, h: 20 },
      { text: "Hollow Shell", x: 150, y: 10, w: 120, h: 20 },
      { text: "Skill:", x: 100, y: 60, w: 40, h: 20 },
      { text: "Rain of Blades", x: 150, y: 120, w: 120, h: 20 },
    ]);
    expect(rows.map((r) => r.text)).toEqual(["Skill: Hollow Shell", "Skill:", "Rain of Blades"]);
    expect(rows[0]).toMatchObject({ x: 100, y: 10, w: 170, h: 20 });
  });
});

describe("英文名稱比對規則", () => {
  const row = (text: string): RuneshapeOcrRow => ({ text, x: 100, y: 0, w: 200, h: 20 });
  it("模糊(相似度 ≥ 0.85,長度差由門檻推得)命中、標 fuzzy;數字必須相同", () => {
    const [m] = matchRunesRowsWith([row("lx Perfect Orb of Transmutatlon")], index);
    expect(m).toMatchObject({ refName: "Perfect Orb of Transmutation", match: "fuzzy" });
    expect(m.similarity).toBeGreaterThanOrEqual(0.85);
    const [n] = matchRunesRowsWith([row("lx Thaumaturgic Flux (Level 99)")], index);
    expect(n.refName).toBeUndefined();
  });
  it("技能寶石名不會被當成物品(`Nx` / 沒前綴只找 ITEM)", () => {
    const [m] = matchRunesRowsWith([row("1x Rain of Blades")], index);
    expect(m.refName).toBeUndefined();
  });
  it("renderer 入口 `matchRunesRows`:目前語系英文 → 自動用英文索引", () => {
    expect(LOADED_DATA?.lang).toBe("en");
    const [m] = matchRunesRows([row("2x Divine Orb")]);
    expect(m).toMatchObject({ refName: "Divine Orb", quantity: 2, ninjaKey: "currency|Divine Orb" });
  });
  it("繁中索引看英文列:全部對不上(兩種語言的索引互不影響)", () => {
    const zh = buildRuneshapeIndex([...ITEMS_ITERATOR('"namespace": "ITEM"')], RUNESHAPE_RECIPES?.recipes ?? []);
    expect(zh.lang).toBeUndefined();
    const [m] = matchRunesRowsWith([row("2x Divine Orb")], zh);
    expect(m.refName).toBeUndefined();
  });
});
