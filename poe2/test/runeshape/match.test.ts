/**
 * exile-appraiser(WP-R2 §2):符文塑形面板 OCR 列 → refName / poe.ninja 鍵。
 * - 回歸:兩張真實繁中截圖(fixtures/ocr/*.webp)的 Windows OCR 快照(`node scripts/ocr-fixture.mjs --set runeshape`)
 *   → 每列的類型、名稱、refName、數量、等級、ninja 鍵、錄製價格表裡有沒有價(core/test/recordings/ninja/poe2)。
 * - 列格式解析(全形 / 半形、空白、`Nx`、等級括號、OCR 常見誤讀)、模糊、重名、面板定位與直書判定。
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createNinjaClient, toSnapshot, type NinjaSnapshot } from "@exile-appraiser/core/ninja";
import type { HttpFetch } from "@exile-appraiser/core/http";
import { init, ITEMS_ITERATOR, RUNESHAPE_RECIPES } from "@/assets/data";
import { buildRuneshapeIndex, matchRunesRows, type RuneshapeOcrRow, type RuneshapeRecipesFile } from "@/runeshape/match";
import { UNDISCOVERED_ROW_NAMES, isPanelRow, isUndiscoveredRow, locateRunePanel, looksVertical, parseRuneRow } from "@/runeshape/row-format";

const FIX = path.join(__dirname, "fixtures/ocr");
const REC = path.join(__dirname, "../../../core/test/recordings/ninja/poe2");

interface OcrLine { text: string; x: number; y: number; w: number; h: number }
interface Fixture {
  source: string;
  srcW: number;
  srcH: number;
  scale: number;
  lines: OcrLine[];
  locate: { scale: 1; lines: OcrLine[] };
  detail: { crop: { x: number; y: number; w: number; h: number }; scale: number; lines: OcrLine[] };
}
const fixture = (name: string): Fixture => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.ocr.json`), "utf8"));
/** 快照座標 → 原圖像素(= client 像素) */
const toSrc = (lines: OcrLine[], scale: number, off = { x: 0, y: 0 }): RuneshapeOcrRow[] =>
  lines.map((l) => ({ text: l.text, x: l.x / scale + off.x, y: l.y / scale + off.y, w: l.w / scale, h: l.h / scale }));
const detailRows = (f: Fixture) => toSrc(f.detail.lines, f.detail.scale, f.detail.crop);

/** 錄製檔 → 快照(與 runtime 同一個 client 解析;沒錄的類別 404) */
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
beforeAll(async () => {
  await init("cmn-Hant");
  snap = await recordedSnapshot();
});

/** 一列 → 回歸表的一格:[類型, 名稱, refName, 數量, 等級, ninja 鍵, 是否有價] */
const summarize = (rows: ReturnType<typeof matchRunesRows>) =>
  rows.filter((r) => !r.offPanel).map((r) => [
    r.kind,
    r.norm,
    r.refName ?? null,
    r.quantity,
    r.level ?? null,
    r.ninjaKey === undefined ? "-" : r.ninjaKey,
    r.ninjaKey ? (snap.prices[r.ninjaKey]?.c ?? 0) > 0 : false,
  ]);

describe("真實截圖回歸:runeshape-skills-01(技能寶石列)", () => {
  const SKILLS = [
    ["gem", "傳導符文", "Conductive Runes", 1, 20, null, false],
    ["gem", "排斥", "Repulsion", 1, 20, null, false],
    ["gem", "霜火新星", "Frostflame Nova", 1, 20, null, false],
    ["gem", "往昔碎片", "Fragments Of The Past", 1, 20, null, false],
    ["gem", "永恆行軍", "Eternal March", 1, 20, null, false],
    ["gem", "活體引爆", "Detonate Living", 1, 20, null, false],
    // 「維里西姆堆」不在 items.ndjson(只有「維里西姆」,差一字相似度 0.8 < 0.85);是 GGPK expedition2recipes 的配方結果
    // `3SlotPileofVerisium1` = Verisium Pile(泛稱,poe.ninja 沒有)→ recipe、無 ninja 鍵
    ["recipe", "維里西姆堆", "Verisium Pile", 1, null, null, false],
    ["support", "震盪符文", "Concussive Runes", 1, null, null, false],
    ["skill", "傳導符文", "Conductive Runes", 1, null, null, false],
    ["skill", "排斥", "Repulsion", 1, null, null, false],
    ["skill", "霜火新星", "Frostflame Nova", 1, null, null, false],
  ];

  it("自動定位框 ×3 的列 → 11 列全數解析;技能 / 輔助寶石 poe.ninja 沒有價格(unpriced: gem)", () => {
    const rows = matchRunesRows(detailRows(fixture("runeshape-skills-01")));
    expect(summarize(rows)).toEqual(SKILLS);
    expect(rows.every((r) => r.match === null || r.match === "exact")).toBe(true);
    expect(rows.filter((r) => r.unpriced === "gem")).toHaveLength(10);
    expect(rows.filter((r) => r.unpriced === "recipe").map((r) => r.recipeId)).toEqual(["3SlotPileofVerisium1"]);
    expect(rows.some((r) => r.offPanel)).toBe(false);
  });

  it("定位段 ×1 的列(OCR 漏「級」、行尾「丨」「1」雜訊)→ 同樣結果;英文紅框殘留不是面板列", () => {
    const f = fixture("runeshape-skills-01");
    const rows = matchRunesRows(toSrc(f.locate.lines, 1));
    const banner = rows.find((r) => r.text.startsWith("Position"))!;
    expect(banner.refName).toBeUndefined();
    expect(banner.offPanel).toBe(true);
    expect(summarize(rows)).toEqual(SKILLS);
  });

  it("整張 ×3 被 WinRT 當成直書 → looksVertical(掃描迴圈據此改走 ×1 定位 + 裁切重辨識)", () => {
    const f = fixture("runeshape-skills-01");
    expect(looksVertical(toSrc(f.lines, f.scale))).toBe(true);
    expect(looksVertical(toSrc(f.locate.lines, 1))).toBe(false);
    expect(looksVertical(detailRows(f))).toBe(false);
  });
});

describe("真實截圖回歸:runeshape-rewards-02(符形組合,Nx 數量)", () => {
  const REWARDS = [
    ["item", "遠古控制符文", "Ancient Rune of Control", 1, null, "currency|Ancient Rune of Control", true],
    ["item", "崇敬積累符文", "Rune of Accumulation", 1, null, "currency|Rune of Accumulation", true],
    ["item", "崇敬巧技符文", "Rune of Acrobatics", 1, null, "currency|Rune of Acrobatics", true],
    ["item", "崇敬狩獵符文", "Rune of the Hunt", 1, null, "currency|Rune of the Hunt", true],
    // poe.ninja Expedition 類錄製時(2026-09-30 Forbidden Rites)有等級 13~20 → 等級 18 有自己的價格(沒有的等級不拿別的頂替)
    ["item", "奇術熔劑(等級18)", "Thaumaturgic Flux (Level 18)", 1, 18, "currency|Thaumaturgic Flux (Level 18)", true],
    ["item", "適應合金", "Adaptive Alloy", 1, null, "currency|Adaptive Alloy", true],
    ["item", "富豪石", "Regal Orb", 3, null, "currency|Regal Orb", true],
  ];

  for (const [label, pick] of [
    ["自動定位框 ×3", (f: Fixture) => detailRows(f)],
    ["整張 ×3(含標題與右緣別的工具的數字)", (f: Fixture) => toSrc(f.lines, f.scale)],
    ["定位段 ×1", (f: Fixture) => toSrc(f.locate.lines, 1)],
  ] as const) {
    it(`${label} → 7 列全數對上;數量 3x、等級後綴都讀到`, () => {
      const rows = matchRunesRows(pick(fixture("runeshape-rewards-02")));
      expect(summarize(rows)).toEqual(REWARDS);
    });
  }

  it("標題「符形組合」→ offPanel(右緣沒對齊面板列),不畫徽章", () => {
    const f = fixture("runeshape-rewards-02");
    const title = matchRunesRows(toSrc(f.lines, f.scale)).find((r) => r.text.includes("符"))!;
    expect(title.text.replace(/\s/g, "")).toBe("符形組合");
    expect(title.offPanel).toBe(true);
  });

  it("類別:符文 = SoulCore、合金 / 富豪石 / 熔劑 = Currency", () => {
    const rows = matchRunesRows(detailRows(fixture("runeshape-rewards-02")));
    expect(rows.map((r) => r.category)).toEqual(["SoulCore", "SoulCore", "SoulCore", "SoulCore", "Currency", "Currency", "Currency"]);
  });
});

describe("列格式解析 parseRuneRow", () => {
  it("數量前綴:1x / lx / Ix / 1 × / 3X / 12x;沒有前綴 = 1", () => {
    for (const [t, q] of [["1x 富豪石", 1], ["lx 富豪石", 1], ["Ix 富豪石", 1], ["1 × 富豪石", 1], ["3X富豪石", 3], ["12x 富豪石", 12], ["富豪石", 1]] as const) {
      const p = parseRuneRow(t);
      expect([p.kind, p.name, p.quantity], t).toEqual(["item", "富豪石", q]);
      expect(p.prefixed, t).toBe(t !== "富豪石");
    }
  });
  it("0x 不是數量;英文 Ix 後面不是 CJK 不當數量", () => {
    expect(parseRuneRow("0x 富豪石")).toMatchObject({ quantity: 1, prefixed: false });
    expect(parseRuneRow("Ix Position")).toMatchObject({ quantity: 1, prefixed: false });
  });
  it("技能等級 N:全形 / 半形冒號、空白、漏「級」", () => {
    for (const t of ["技能等級 20：傳導符文", "技能等級20:傳導符文", "技 能 等 級 2 0 ： 傳 導 符 文", "技能等20:傳導符文", "技能級20;傳導符文"]) {
      expect(parseRuneRow(t), t).toMatchObject({ kind: "gem", name: "傳導符文", gemLevel: 20, prefixed: true });
    }
  });
  it("技能: / 輔助:", () => {
    expect(parseRuneRow("技能：排斥")).toMatchObject({ kind: "skill", name: "排斥", prefixed: true });
    expect(parseRuneRow("輔助: 震盪符文")).toMatchObject({ kind: "support", name: "震盪符文", prefixed: true });
  });
  it("等級後綴:（等級18）/ (等級 18) / 右括號被吃掉;名稱與全名分開", () => {
    for (const t of ["1x 奇術熔劑（等級18）", "1x 奇術熔劑 (等級 18)", "奇術熔劑(等級18", "奇 術 熔 劑 （ 等 級 1 8 ）"]) {
      expect(parseRuneRow(t), t).toMatchObject({ name: "奇術熔劑", fullName: "奇術熔劑(等級18)", level: 18 });
    }
  });
  it("頭尾雜訊:行尾逗號 / 數字 / 「丨」、開頭「…」", () => {
    expect(parseRuneRow("lx 遠古控制符文 ,").name).toBe("遠古控制符文");
    expect(parseRuneRow("技能等級 20：永恆行軍 丨").name).toBe("永恆行軍");
    expect(parseRuneRow("技能等級 20：活體引爆 1").name).toBe("活體引爆");
    expect(parseRuneRow("… 3x 富豪石")).toMatchObject({ name: "富豪石", quantity: 3 });
  });
  it("isPanelRow:要有前綴、名稱至少 2 個 CJK 字", () => {
    expect(isPanelRow("1x 富豪石")).toBe(true);
    expect(isPanelRow("技能：排斥")).toBe(true);
    expect(isPanelRow("維里西姆堆")).toBe(false);
    expect(isPanelRow("符形組合")).toBe(false);
    expect(isPanelRow("1x 石")).toBe(false);
    expect(isPanelRow("Position the red box")).toBe(false);
  });
});

describe("名稱比對:模糊、重名、類別", () => {
  const row = (text: string, y = 0): RuneshapeOcrRow => ({ text, x: 100, y, w: 200, h: 20 });

  it("模糊:長名稱錯一字(相似度 ≥ 0.85)→ fuzzy;短名稱錯一字不猜", () => {
    // 「崇敬狩獵符文」6 字錯 1 → 0.833 < 0.85:不猜
    expect(matchRunesRows([row("1x 崇敬狩臘符文")])[0].refName).toBeUndefined();
    // 「奇術熔劑(等級18)」10 字錯 1 → 0.9
    const [a] = matchRunesRows([row("1x 奇術溶劑（等級18）")]);
    expect(a).toMatchObject({ match: "fuzzy", refName: "Thaumaturgic Flux (Level 18)", level: 18, similarity: 0.9 });
    // 等級數字不同 → 不模糊到別的等級
    const [b] = matchRunesRows([row("1x 奇術熔劑（等級25）")]);
    expect(b.refName).toBeUndefined();
    expect(b.level).toBe(25);
  });

  it("前綴限定 namespace:技能 → 技能寶石、輔助 → 輔助寶石(「絕望」技能 Despair / 輔助 Desperation)", () => {
    const [s, p] = matchRunesRows([row("技能：絕望"), row("輔助：絕望", 30)]);
    expect([s.refName, s.category]).toEqual(["Despair", "Active Skill Gem"]);
    expect([p.refName, p.category]).toEqual(["Desperation", "Support Skill Gem"]);
    // 沒有前綴 → 只找 ITEM(寶石名稱不會被當成物品)
    expect(matchRunesRows([row("絕望")])[0].refName).toBeUndefined();
  });

  it("重名:類別優先序決定(通貨 > 任務物品);同一層仍有 2 個以上 refName → ambiguous、不給 refName", () => {
    const idx = buildRuneshapeIndex([
      { name: "甲", refName: "A-quest", namespace: "ITEM", craftable: { category: "QuestItem" } },
      { name: "甲", refName: "A-cur", namespace: "ITEM", craftable: { category: "Currency" } },
      { name: "乙", refName: "B1", namespace: "ITEM", craftable: { category: "Currency" } },
      { name: "乙", refName: "B2", namespace: "ITEM", craftable: { category: "Currency" } },
      { name: "丙", refName: "C", namespace: "GEM", craftable: { category: "Active Skill Gem" } },
    ] as never);
    const [a, b, c] = matchRunesRows([row("1x 甲"), row("1x 乙", 30), row("1x 丙", 60)], idx);
    expect(a).toMatchObject({ refName: "A-cur", ninjaKey: "currency|A-cur" });
    expect(b.refName).toBeUndefined();
    expect(b.ambiguous).toEqual(["B1", "B2"]);
    expect(b.ninjaKey).toBeUndefined();
    expect(c.refName).toBeUndefined();
  });

  it("真實資料的重名:「破碎三曲」通貨 vs 任務物品 → 通貨", () => {
    expect(matchRunesRows([row("1x 破碎三曲")])[0]).toMatchObject({ refName: "Shattered Triskelion", category: "Currency" });
  });

  it("座標原樣帶回", () => {
    expect(matchRunesRows([{ text: "3x 富豪石", x: 10, y: 30, w: 100, h: 20 }])[0]).toMatchObject({ x: 10, y: 30, w: 100, h: 20, quantity: 3 });
  });
});

describe("「未發現」列(尚未解鎖的配方,2026-10-01 使用者截圖「寶石」分頁)", () => {
  const row = (text: string, y: number): RuneshapeOcrRow => ({ text, x: 400, y, w: 300, h: 20 });

  it("isUndiscoveredRow:整列只有「未發現」(容許頭尾 OCR 雜訊);帶其他字的不算", () => {
    for (const t of ["未發現", " 未 發 現 ", "?未發現", "…未發現,", "未發現丨"]) expect(isUndiscoveredRow(t), t).toBe(true);
    for (const t of ["技能：刀刃之雨", "未發現的寶石", "發現", "未切割的精魂寶石（等級 19）", ""]) expect(isUndiscoveredRow(t), t).toBe(false);
    expect(UNDISCOVERED_ROW_NAMES).toEqual(["未發現"]);
  });

  it("截圖對應的列:寶石 / 技能照常比對,「未發現」列標 undiscovered、不比對", () => {
    const rows = matchRunesRows([
      row("1x 未切割的精魂寶石（等級 19）", 100),
      row("技能：刀刃之雨", 150),
      row("技能：空無披甲", 200),
      row("技能：卡爾葛之痕", 250),
      row("技能：維里西姆強化", 300),
      row("未發現", 350),
      row("未發現", 400),
    ]);
    expect(rows.map((r) => [r.kind, r.refName ?? null, r.undiscovered ?? false])).toEqual([
      ["item", "Uncut Spirit Gem (Level 19)", false],
      ["skill", "Rain of Blades", false],
      ["skill", "Hollow Shell", false],
      ["skill", "Remnants of Kalguur", false],
      ["skill", "Powered by Verisium", false],
      ["item", null, true],
      ["item", null, true],
    ]);
    expect(rows[5].match).toBeNull();
    expect(rows[5].offPanel).toBeUndefined();
  });
});

describe("配方結果(GGPK expedition2recipes → data/poe2/runeshape/recipes.json)", () => {
  const row = (text: string, y = 0): RuneshapeOcrRow => ({ text, x: 100, y, w: 200, h: 20 });
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../data/poe2/runeshape/recipes.json"), "utf8")) as RuneshapeRecipesFile;

  it("資料:29 筆、schema 1、記 GGPK 版本;[Rarity|X] 標記剝成 X", () => {
    expect(file.schema).toBe(1);
    expect(file.recipes).toHaveLength(29);
    expect(file.source.table).toBe("expedition2recipes");
    expect(file.source.ggpkVersion).toMatch(/^\d+\.\d+/);
    expect(RUNESHAPE_RECIPES?.recipes).toHaveLength(29);
    for (const r of file.recipes) {
      expect(r.zhPlain, r.id).not.toMatch(/[[\]|]/);
      expect(r.enPlain, r.id).not.toMatch(/[[\]|]/);
    }
    expect(file.recipes.find((r) => r.id === "3SlotUniqueBodyArmour1")).toMatchObject({ zh: "[Rarity|傳奇]胸甲", zhPlain: "傳奇胸甲", enPlain: "Unique Body Armour" });
  });

  it("29 筆 round-trip:繁中泛稱當 OCR 列 → recipe、refName = 英文、無 ninja 鍵、數量 1", () => {
    const rows = matchRunesRows(file.recipes.map((r, i) => row(r.zhPlain, i * 30)));
    expect(rows.map((r) => [r.kind, r.refName, r.recipeId, r.match, r.quantity, r.ninjaKey, r.unpriced])).toEqual(
      file.recipes.map((r) => ["recipe", r.enPlain, r.id, "exact", 1, null, "recipe"]),
    );
  });

  it("「未切割的輔助寶石」「精魂寶石」items.ndjson 也有(不帶等級的 Uncut Support / Spirit Gem,poe.ninja 只有帶等級的價)→ 配方勝;有等級的照樣是物品", () => {
    const [a, b, c] = matchRunesRows([row("未切割的輔助寶石"), row("精魂寶石", 30), row("1x 未切割的輔助寶石（等級 2）", 60)]);
    expect([a.kind, a.refName]).toEqual(["recipe", "Uncut Support Gem"]);
    expect([b.kind, b.refName]).toEqual(["recipe", "Uncut Spirit Gem"]);
    expect([c.kind, c.refName, c.ninjaKey]).toEqual(["item", "Uncut Support Gem (Level 2)", "currency|Uncut Support Gem (Level 2)"]);
  });

  it("配方自帶的數量:`5x 隨機通貨` → 數量 1(5x 是配方文字);別的數量 / 別的配方 `Nx` 照常是外加數量", () => {
    const [a, b, c, d] = matchRunesRows([row("5x 隨機通貨"), row("5 × 隨 機 通 貨", 30), row("2x 維里西姆堆", 60), row("3x 隨機通貨", 90)]);
    // refName = 英文泛稱原文(數量本來就在文字裡)
    expect(a).toMatchObject({ kind: "recipe", refName: "5x Random Currency", norm: "5x隨機通貨", quantity: 1, match: "exact", recipeId: "5SlotAstackofrandomcurrency1" });
    expect(b).toMatchObject({ kind: "recipe", quantity: 1 });
    expect(c).toMatchObject({ kind: "recipe", refName: "Verisium Pile", quantity: 2 });
    // 「3x 隨機通貨」不是配方原文(數字必須相同,不模糊到 5x)→ 對不上,保留外加數量 3
    expect(d).toMatchObject({ kind: "item", quantity: 3, match: null });
    expect(d.refName).toBeUndefined();
  });

  it("模糊:長泛稱錯一字 → recipe(≈);物品精確命中時不被配方蓋掉", () => {
    const [a] = matchRunesRows([row("克里爾森的海彎鑰匙")]);
    expect(a).toMatchObject({ kind: "recipe", refName: "Krillson's Bay Key", match: "fuzzy" });
    const [b] = matchRunesRows([row("3x 富豪石")]);
    expect([b.kind, b.refName, b.quantity]).toEqual(["item", "Regal Orb", 3]);
  });

  it("配方只找 Nx / 沒有前綴的列;技能 / 輔助前綴不找配方", () => {
    const [a] = matchRunesRows([row("技能：維里西姆堆")]);
    expect(a.kind).toBe("skill");
    expect(a.refName).toBeUndefined();
  });

  it("沒有配方資料(舊安裝缺檔)→ 泛稱列對不上,其他照常", () => {
    const all = [...ITEMS_ITERATOR('"namespace": "ITEM"')];
    const [a, b] = matchRunesRows([row("維里西姆堆"), row("3x 富豪石", 30)], buildRuneshapeIndex(all));
    expect([a.kind, a.refName]).toEqual(["item", undefined]);
    expect(b.refName).toBe("Regal Orb");
  });
});

describe("面板定位 locateRunePanel", () => {
  const inside = (r: { x: number; y: number; w: number; h: number }, c: { x: number; y: number; w: number; h: number }) =>
    r.x >= c.x && r.y >= c.y && r.x + r.w <= c.x + c.w && r.y + r.h <= c.y + c.h;

  it("skills-01:框住全部 11 列、不含上方英文紅框殘留", () => {
    const f = fixture("runeshape-skills-01");
    const lines = toSrc(f.locate.lines, 1);
    const loc = locateRunePanel(lines, { x: 0, y: 0, w: f.srcW, h: f.srcH })!;
    expect(loc.rows).toHaveLength(10); // 有前綴的 10 列;「維里西姆堆」沒前綴但在框內
    expect(loc.clusters).toEqual([10]);
    const cjk = lines.filter((l) => /[㐀-鿿]/.test(l.text));
    for (const l of cjk) expect(inside(l, loc.crop), l.text).toBe(true);
    const banner = lines.find((l) => l.text.startsWith("Position"))!;
    expect(loc.crop.y).toBeGreaterThanOrEqual(banner.y + banner.h);
    expect(loc.crop).toEqual({ x: 257, y: 109, w: 303, h: 540 });
    expect(loc.crop).toEqual(f.detail.crop); // fixture 腳本用同一份規則裁的
  });

  it("rewards-02:框住全部 7 列、不含右緣別的工具的數字(x ≥ 585)", () => {
    const f = fixture("runeshape-rewards-02");
    const lines = toSrc(f.locate.lines, 1);
    const loc = locateRunePanel(lines, { x: 0, y: 0, w: f.srcW, h: f.srcH })!;
    expect(loc.rows).toHaveLength(7);
    for (const l of loc.rows) expect(inside(l, loc.crop), l.text).toBe(true);
    expect(loc.crop.x + loc.crop.w).toBeLessThan(585);
    expect(loc.crop).toEqual({ x: 237, y: 40, w: 343, h: 405 });
    expect(loc.crop).toEqual(f.detail.crop);
  });

  it("少於 2 列面板列 → null;右緣不對齊的兩列不算同一面板", () => {
    const b = { x: 0, y: 0, w: 2000, h: 1000 };
    expect(locateRunePanel([{ text: "1x 富豪石", x: 100, y: 100, w: 80, h: 20 }], b)).toBeNull();
    expect(locateRunePanel([{ text: "維里西姆堆", x: 100, y: 100, w: 80, h: 20 }, { text: "符形組合", x: 100, y: 150, w: 80, h: 20 }], b)).toBeNull();
    expect(locateRunePanel([
      { text: "1x 富豪石", x: 100, y: 100, w: 80, h: 20 },
      { text: "1x 富豪石", x: 900, y: 150, w: 80, h: 20 },
    ], b)).toBeNull();
  });

  it("兩塊面板列 → 取列數多的那塊;外擴夾在 bounds 內", () => {
    const lines = [
      { text: "1x 富豪石", x: 10, y: 5, w: 80, h: 20 },
      { text: "2x 富豪石", x: 10, y: 60, w: 80, h: 20 },
      { text: "1x 崇高石", x: 1500, y: 500, w: 80, h: 20 },
      { text: "1x 崇高石", x: 1500, y: 555, w: 80, h: 20 },
      { text: "1x 崇高石", x: 1500, y: 610, w: 80, h: 20 },
    ];
    const loc = locateRunePanel(lines, { x: 0, y: 0, w: 2000, h: 1000 })!;
    expect(loc.rows.map((r) => r.y)).toEqual([500, 555, 610]);
    expect(loc.clusters).toEqual([2, 3]);
    const top = locateRunePanel(lines.slice(0, 2), { x: 0, y: 0, w: 2000, h: 1000 })!;
    expect(top.crop.x).toBe(0);
    expect(top.crop.y).toBe(0);
  });
});
