/**
 * exile-appraiser(WP-R2 §2):符文塑形面板的 OCR 列 → 物品 refName / poe.ninja 鍵(renderer 用;規則說明見 docs/runeshape.md)。
 *
 * 1. 列格式(零依賴的 `row-format.ts`,main 的自動定位也用):前綴決定類型與 namespace ——
 *    `技能等級N:` / `技能:` → GEM(技能寶石,非輔助)、`輔助:` → GEM(輔助寶石)、`Nx` / 沒有前綴 → ITEM。
 * 2. 名稱 → 資料:只用目前語系 `items.ndjson` 的 `name`(GGPK 來源,**不自行翻譯**)→ `refName`;
 *    先精確(`normalizeOcrText` 後相同)→ 再 Levenshtein 模糊(相似度 ≥ `FUZZY_MIN_SIM`、長度差 ≤ `FUZZY_MAX_LEN_DIFF`,與揭露面板同門檻)。
 *    同名多筆:依類別優先序(ITEM:通貨 > 符文 / 靈魂核心 > 未切割寶石 > 預兆 > …;任務物品最後)取最高那層;
 *    最高那層仍有 2 個以上不同 refName(或模糊同分)→ `ambiguous`,**不猜、不查價**。
 * 3. 配方結果(`Nx` / 沒有前綴的列才找):GGPK `expedition2recipes` 的 Description(`data/poe2/runeshape/recipes.json`,
 *    例:`維里西姆堆`、`[傳奇]胸甲`、`5x 隨機通貨`、`未切割的寶石`)是**泛稱**,沒有單一價格 → 列類型 `recipe`、`refName` = 英文、
 *    `ninjaKey: null`、`unpriced: 'recipe'`,UI 顯示「無固定價格」。與物品名的取捨見 `pickItemOrRecipe`。
 *    配方本身帶數量(`5x 隨機通貨`):先以 `Nx名稱` 整串比對配方,命中時數量算在配方裡(`quantity` = 1),不當成外加的 5 個。
 * 4. 價格鍵:ITEM → poe.ninja exchange `currency|<refName>`(帶等級的物品 refName 本身就是 `Thaumaturgic Flux (Level 18)`);
 *    GEM(技能 / 輔助寶石)→ poe.ninja PoE2 沒有技能寶石類別(已錄 LineageSupportGems 也沒有這些符文技能)→ `ninjaKey: null`、`unpriced: 'gem'`,UI 顯示「無價格」。
 * 5. 面板外的列:右緣與面板列(有前綴的列)中位右緣差 > 2.5 行高 → `offPanel`(面板標題、別的 UI),UI 不畫徽章。
 * 6. 「未發現」列(面板上尚未解鎖的配方,`row-format.ts` `UNDISCOVERED_ROW_NAMES`)→ `undiscovered`,不比對,UI 不畫徽章。
 * 對不上的列保留原文(`refName` 留空)。
 *
 * 本檔**零依賴**(相對路徑 import `ocr-text` / `row-format`,不碰 `@/assets/data`):renderer 由 `match.ts` 包上目前語系的索引;
 * main 的 `--runeshape-selftest` 自己讀 items.ndjson + recipes.json 建索引後直接呼叫 `matchRunesRowsWith`。
 */
import {
  EPS,
  FUZZY_MAX_LEN_DIFF,
  FUZZY_MIN_SIM,
  FuzzyCandidates,
  Lru,
  codePoints,
  levenshteinCp,
  normalizeOcrText,
} from "../desecration/ocr-text";
import { RIGHT_ALIGN_LINES, UNDISCOVERED_ROW_NAMES, parseRuneRow, type ParsedRuneRow, type RuneRowKind } from "./row-format";

/** 與 `@ipc/types` 的 `RuneshapeScanRow` 同形(client 實體像素) */
export interface RuneshapeOcrRow {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RuneMatchKind = "exact" | "fuzzy";

/** 列類型:前綴決定的 `RuneRowKind`,或命中配方結果時的 `recipe` */
export type RuneshapeRowKind = RuneRowKind | "recipe";

export interface RuneshapeMatchRow extends RuneshapeOcrRow {
  /** 列類型(前綴決定;命中配方結果 = `recipe`) */
  kind: RuneshapeRowKind;
  /** 正規化後的名稱(含等級後綴;配方自帶數量時含 `Nx`;除錯 / 對不上時顯示) */
  norm: string;
  /** 英文名(配方 = 剝掉標記的英文泛稱);對不上 / 重名無法決定 = undefined */
  refName?: string;
  /** 物品名稱後綴的等級(`奇術熔劑(等級18)`)或技能寶石等級(`技能等級20:`) */
  level?: number;
  /** 數量(`Nx`;預設 1;配方自帶的數量不算) */
  quantity: number;
  /** null = 對不上 */
  match: RuneMatchKind | null;
  /** 模糊命中的相似度 */
  similarity?: number;
  /** 重名(或模糊同分)無法唯一決定時的候選 refName */
  ambiguous?: string[];
  /** 資料檔的類別(`craftable.category`;配方 = `Recipe`) */
  category?: string;
  /** 配方結果的 GGPK id(`3SlotPileofVerisium1`) */
  recipeId?: string;
  /** poe.ninja 快照鍵;null = poe.ninja 沒有這一類(技能 / 輔助寶石、配方泛稱) */
  ninjaKey?: string | null;
  /** 不查價的原因:`gem` = poe.ninja PoE2 沒有技能寶石價格;`recipe` = 配方結果是泛稱,沒有單一價格 */
  unpriced?: "gem" | "recipe";
  /** 不在面板上(右緣沒對齊面板列) */
  offPanel?: boolean;
  /** 面板上尚未解鎖的配方(整列「未發現」,`isUndiscoveredRow`)→ 不比對、UI 不畫徽章 */
  undiscovered?: boolean;
  /** 目前語系 items.ndjson 的 `name`(台服交易站查詢送這個;配方沒有) */
  name?: string;
  /** items.ndjson 的 `tradeTag`(可堆疊物品 → 交易站 bulk exchange 的 want) */
  tradeTag?: string;
}

interface Entry {
  refName: string;
  category: string;
  /** 類別優先序(小 = 優先) */
  rank: number;
  /** 配方結果的 id */
  recipeId?: string;
  /** 目前語系的名稱(原樣,未正規化) */
  name?: string;
  tradeTag?: string;
}

export interface RuneshapeIndex {
  /** ITEM namespace:正規化名稱 → 條目 */
  item: Map<string, Entry[]>;
  /** GEM 非輔助(技能 / Meta) */
  skill: Map<string, Entry[]>;
  /** GEM 輔助 */
  support: Map<string, Entry[]>;
  /** 配方結果(繁中泛稱正規化名稱 → 條目) */
  recipe: Map<string, Entry[]>;
}

/**
 * ITEM 類別優先序:符文塑形面板的獎勵都是可堆疊的東西 → 通貨類最前、裝備底材與任務物品最後。
 * 不在表上的類別排在表後、任務物品之前。
 */
export const ITEM_CATEGORY_PRIORITY = [
  "Currency",
  "SoulCore",
  "UncutSkillGem",
  "Omen",
  "MapFragment",
  "Breachstone",
  "ExpeditionLogbook",
  "PinnacleKey",
  "BrequelFruit",
  "TowerAugment",
  "MiscMapItem",
  "VaultKey",
  "Talisman",
  "Incubator",
  "Relic",
  "Jewel",
];
const QUEST_RANK = 1000;
export const RECIPE_CATEGORY = "Recipe";

function itemRank(category: string): number {
  if (category === "QuestItem") return QUEST_RANK;
  const i = ITEM_CATEGORY_PRIORITY.indexOf(category);
  return i >= 0 ? i : ITEM_CATEGORY_PRIORITY.length;
}

/** items.ndjson 一列的最小形狀(`BaseType` 的子集) */
export interface NameEntry {
  name: string;
  refName: string;
  namespace: string;
  craftable?: { category?: string };
  tradeTag?: string;
}

/** `data/poe2/runeshape/recipes.json` 一筆(`scripts/sync-runeshape-data.mjs` 產生) */
export interface RecipeEntry {
  id: string;
  en: string;
  zh: string;
  /** 剝掉 `[Rarity|X]` 標記的英文 */
  enPlain: string;
  /** 剝掉 `[Rarity|X]` 標記的繁中 */
  zhPlain: string;
}

export interface RuneshapeRecipesFile {
  schema: 1;
  source: { table: string; column: string; sha256: string; ggpkVersion?: string; extractedAt?: string };
  recipes: RecipeEntry[];
}

function add(map: Map<string, Entry[]>, key: string, e: Entry) {
  const list = map.get(key);
  if (!list) map.set(key, [e]);
  else if (!list.some((x) => x.refName === e.refName && x.category === e.category)) list.push(e);
}

export function buildRuneshapeIndex(items: Iterable<NameEntry>, recipes: Iterable<RecipeEntry> = []): RuneshapeIndex {
  const idx: RuneshapeIndex = { item: new Map(), skill: new Map(), support: new Map(), recipe: new Map() };
  for (const it of items) {
    if (!it.name || !it.refName) continue;
    const key = normalizeOcrText(it.name);
    const category = it.craftable?.category ?? "";
    const extra = it.tradeTag ? { name: it.name, tradeTag: it.tradeTag } : { name: it.name };
    if (it.namespace === "ITEM") {
      add(idx.item, key, { refName: it.refName, category, rank: itemRank(category), ...extra });
    } else if (it.namespace === "GEM") {
      const support = category === "Support Skill Gem";
      add(support ? idx.support : idx.skill, key, { refName: it.refName, category, rank: 0, ...extra });
    }
  }
  for (const r of recipes) {
    if (!r.enPlain || !r.zhPlain) continue;
    const e: Entry = { refName: r.enPlain, category: RECIPE_CATEGORY, rank: 0, recipeId: r.id };
    // 只收繁中:列格式解析(`row-format.ts`)目前只認繁中面板(英文客戶端的列格式未確認,見 docs/runeshape.md 已知限制)
    add(idx.recipe, normalizeOcrText(r.zhPlain), e);
  }
  return idx;
}

/** 最高優先那層的不同 refName */
function topEntries(list: Entry[]): Entry[] {
  const best = Math.min(...list.map((e) => e.rank));
  const out: Entry[] = [];
  for (const e of list) if (e.rank === best && !out.some((x) => x.refName === e.refName)) out.push(e);
  return out;
}

interface Lookup {
  match: RuneMatchKind;
  entries: Entry[];
  similarity?: number;
}

const digitsOf = (s: string) => (s.match(/\d+/g) ?? []).join(",");

/**
 * 效能修正第 8 步:每個 namespace map 一份「依碼點長度分桶的 key(順序 = Map 插入順序)+ 預算 digitsOf + 模糊結果 LRU」。
 * 掛在 map 物件上(WeakMap):換語系 / 重載資料時 `buildRuneshapeIndex` 建新 map,快取自然失效;map 大小變了也重建
 * (索引照理建好就不改)。
 */
interface LookupCache {
  size: number;
  cands: FuzzyCandidates<[string, Entry[]]>;
  digits: string[];
  results: Lru<string, Lookup | null>;
}
const lookupCaches = new WeakMap<Map<string, Entry[]>, LookupCache>();

function lookupCache(map: Map<string, Entry[]>): LookupCache {
  let c = lookupCaches.get(map);
  if (!c || c.size !== map.size) {
    const cands = new FuzzyCandidates([...map], ([key]) => key);
    c = { size: map.size, cands, digits: cands.items.map(([key]) => digitsOf(key)), results: new Lru() };
    lookupCaches.set(map, c);
  }
  return c;
}

/** 名稱 → 條目(精確 → 模糊;規則見檔頭)。匯出給等價測試 */
export function lookupRuneName(map: Map<string, Entry[]>, name: string): Lookup | null {
  if (!name) return null;
  const exact = map.get(name);
  if (exact?.length) return { match: "exact", entries: topEntries(exact) };
  const c = lookupCache(map);
  let r = c.results.get(name);
  if (r === undefined) {
    r = fuzzyLookup(c, name);
    c.results.set(name, r);
  }
  // 每次回傳新物件(快取內容不外流)
  return r ? { match: r.match, entries: [...r.entries], similarity: r.similarity } : null;
}

/**
 * 模糊:與依 Map 插入順序全掃相同(同分依順序收、`topEntries` 先到先收),
 * 只跳過長度上不可能達門檻的 key(`fuzzyLengthPossible`;全掃時它們也是「低於門檻 → continue」)。
 */
function fuzzyLookup(c: LookupCache, name: string): Lookup | null {
  const N = codePoints(name);
  const len = N.length;
  // 數字(等級)必須完全相同:`奇術熔劑(等級18)` 與 `(等級19)` 只差一個字,相似度 0.9,但是不同物品
  const digits = digitsOf(name);
  let best = 0;
  let hits: Entry[] = [];
  for (const i of c.cands.candidates(len)) {
    const K = c.cands.cps[i];
    const kl = K.length;
    if (Math.abs(kl - len) > FUZZY_MAX_LEN_DIFF) continue;
    if (c.digits[i] !== digits) continue;
    const sim = 1 - levenshteinCp(N, K) / Math.max(kl, len, 1);
    if (sim < FUZZY_MIN_SIM - EPS) continue;
    const list = c.cands.items[i][1];
    if (sim > best + EPS) {
      best = sim;
      hits = [...list];
    } else if (Math.abs(sim - best) <= EPS) {
      hits.push(...list);
    }
  }
  if (!hits.length) return null;
  return { match: "fuzzy", entries: topEntries(hits), similarity: Math.round(best * 1000) / 1000 };
}

/** 精確勝模糊;同為模糊取相似度高者(同分取前者) */
function better(a: Lookup | null, b: Lookup | null): boolean {
  if (!a) return false;
  if (!b) return true;
  if (a.match !== b.match) return a.match === "exact";
  return (a.similarity ?? 1) > (b.similarity ?? 1) + EPS;
}

interface RecipeLookup extends Lookup {
  /** 以 `Nx名稱` 整串命中(數量是配方文字的一部分) */
  intrinsicQty: boolean;
  norm: string;
}

/** 配方比對:有 `Nx` 前綴時先試 `Nx名稱` 整串(`5x 隨機通貨`),再試名稱本身;取較好的一個 */
function lookupRecipe(index: RuneshapeIndex, p: ParsedRuneRow): RecipeLookup | null {
  if (!index.recipe.size) return null;
  const cands: Array<{ key: string; intrinsicQty: boolean }> = [];
  if (p.prefixed) cands.push({ key: `${p.quantity}x${p.fullName}`, intrinsicQty: true });
  cands.push({ key: p.fullName, intrinsicQty: false });
  let best: RecipeLookup | null = null;
  for (const c of cands) {
    const found = lookupRuneName(index.recipe, c.key);
    if (found && better(found, best)) best = { ...found, intrinsicQty: c.intrinsicQty, norm: c.key };
  }
  return best;
}

/**
 * 物品名 vs 配方結果:
 * - 只有一邊命中 → 那一邊。
 * - 物品精確命中:配方也精確且物品(唯一)的 refName 就是配方的英文泛稱(`未切割的輔助寶石` = 不帶等級的 `Uncut Support Gem`,
 *   poe.ninja 只有帶等級的價格)→ 配方;否則物品(有具體物品就查它的價)。
 * - 物品模糊命中:配方精確 → 配方;配方也模糊 → 相似度高者(同分取物品)。
 */
function pickItemOrRecipe(item: Lookup | null, recipe: RecipeLookup | null): "item" | "recipe" | null {
  if (!recipe) return item ? "item" : null;
  if (!item) return "recipe";
  if (item.match === "exact") {
    if (recipe.match !== "exact") return "item";
    const same = item.entries.length === 1 && recipe.entries.some((e) => e.refName === item.entries[0].refName);
    return same ? "recipe" : "item";
  }
  return better(recipe, item) ? "recipe" : "item";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function matchRunesRowsWith(lines: RuneshapeOcrRow[], index: RuneshapeIndex): RuneshapeMatchRow[] {
  const parsed = lines.map((l) => ({ l, p: parseRuneRow(l.text) }));
  // 面板右緣:有前綴的列的中位右緣(沒有前綴列 → 不判斷面板外)
  const anchors = parsed.filter((x) => x.p.prefixed).map((x) => x.l);
  const panelRight = anchors.length ? median(anchors.map((l) => l.x + l.w)) : null;
  const lineH = anchors.length ? median(anchors.map((l) => l.h)) : 0;
  return parsed.map(({ l, p }) => {
    const row: RuneshapeMatchRow = { ...l, kind: p.kind, norm: p.fullName, quantity: p.quantity, match: null };
    const level = p.kind === "gem" ? p.gemLevel : p.level;
    if (level != null) row.level = level;
    // 尚未解鎖的配方(「未發現」):不比對(免得模糊到別的東西)、UI 不畫徽章
    if (UNDISCOVERED_ROW_NAMES.includes(p.name)) {
      row.undiscovered = true;
      return row;
    }
    if (panelRight != null && !p.prefixed && Math.abs(l.x + l.w - panelRight) > RIGHT_ALIGN_LINES * lineH) row.offPanel = true;
    const map = p.kind === "item" ? index.item : p.kind === "support" ? index.support : index.skill;
    // 帶等級後綴的物品(奇術熔劑(等級18)、未切割寶石)以含等級的全名比對:等級不同就是不同物品
    let found = lookupRuneName(map, p.fullName);
    if (p.kind === "item") {
      const recipe = lookupRecipe(index, p);
      if (pickItemOrRecipe(found, recipe) === "recipe") {
        const r = recipe!;
        row.kind = "recipe";
        row.norm = r.norm;
        if (r.intrinsicQty) row.quantity = 1;
        found = r;
      }
    }
    if (!found) return row;
    row.match = found.match;
    if (found.similarity != null) row.similarity = found.similarity;
    if (found.entries.length > 1) {
      row.ambiguous = found.entries.map((e) => e.refName);
      return row;
    }
    const e = found.entries[0];
    row.refName = e.refName;
    if (e.category) row.category = e.category;
    if (e.name) row.name = e.name;
    if (e.tradeTag) row.tradeTag = e.tradeTag;
    if (row.kind === "recipe") {
      if (e.recipeId) row.recipeId = e.recipeId;
      row.ninjaKey = null;
      row.unpriced = "recipe";
    } else if (p.kind === "item") {
      row.ninjaKey = `currency|${e.refName}`;
      const lv = /\(Level (\d+)\)$/.exec(e.refName);
      if (lv) row.level = Number(lv[1]);
    } else {
      row.ninjaKey = null;
      row.unpriced = "gem";
    }
    return row;
  });
}
