/**
 * exile-appraiser(WP-R2 §2):符文塑形面板的 OCR 列 → 物品 refName / poe.ninja 鍵(renderer 入口)。
 * 規則與實作在零依賴的 `match-core.ts`(說明見該檔與 docs/runeshape.md);這裡只包上**目前語系** `items.ndjson` 的索引
 * + 語言無關的配方結果(`RUNESHAPE_RECIPES`,`data/poe2/runeshape/recipes.json`;缺檔時只少了配方這一層)。
 * 第 22 步:目前語系是英文(`LOADED_DATA.lang === "en"`)→ 建英文索引(`buildRuneshapeIndex(…, "en")`),列以英文規則解析。
 * 第 25 步:索引語言改依**有效辨識語言**(設定 `ocrLang`,與客戶端語言獨立)。辨識語言 = 目前載入的客戶端語言 → 用記憶體裡的 items(同改版前);
 * 不同(繁中客戶端 + 英文辨識,或反過來)→ `ensureRuneshapeIndex(lang)` 只另讀那個語言的 `items.ndjson`(只取 ITEM / GEM 的名稱 / refName / 類別 / tradeTag,
 * 建好的索引快取;資料重載 / 配方換新才重建)。輸出的 `name`(台服交易站查詢用)一律是**客戶端語言**的名稱(以 refName + namespace + 類別對回記憶體裡的 items),
 * `refName`(英文)與 poe.ninja 鍵不受辨識語言影響。
 * 第 27 步:查價時資料集可能暫時換成另一語言的物品(國際服依物品文字自動判斷語言)——這裡的「客戶端語言」一律取
 * `PRIMARY_DATA`(`loadForLang` 載入的那一套),不跟著查價的物品語言換。
 */
import { ITEMS_ITERATOR, LOADED_DATA, PRIMARY_DATA, RUNESHAPE_RECIPES } from "@/assets/data";
import { source } from "@/assets/data/source";
import type { OcrTextLang } from "../desecration/ocr-text";
import { buildRuneshapeIndex, matchRunesRowsWith, type NameEntry, type RecipeEntry, type RuneshapeIndex, type RuneshapeMatchRow, type RuneshapeOcrRow } from "./match-core";

export * from "./match-core";

let cached: { iter: typeof ITEMS_ITERATOR; recipes: typeof RUNESHAPE_RECIPES; en: boolean; index: RuneshapeIndex } | null = null;

/** 第 27 步:客戶端語言那一套的物品迭代器(還沒載完 = 目前繫結,同改版前) */
function clientItems(): typeof ITEMS_ITERATOR {
  return PRIMARY_DATA?.ITEMS_ITERATOR ?? ITEMS_ITERATOR;
}

/** 第 27 步:客戶端語言(還沒載完 = 目前繫結的語系,同改版前) */
function clientLang(): string | undefined {
  return PRIMARY_DATA ? PRIMARY_DATA.lang : LOADED_DATA?.lang;
}

/** 目前語系的索引(資料重載 / 換語系後 `ITEMS_ITERATOR` 換新、或配方資料換新 → 重建) */
function defaultIndex(): RuneshapeIndex {
  const en = clientLang() === "en";
  const items = clientItems();
  if (!cached || cached.iter !== items || cached.recipes !== RUNESHAPE_RECIPES || cached.en !== en) {
    const all = [...items('"namespace": "ITEM"'), ...items('"namespace": "GEM"')];
    const recipes = RUNESHAPE_RECIPES?.recipes ?? [];
    cached = { iter: items, recipes: RUNESHAPE_RECIPES, en, index: en ? buildRuneshapeIndex(all, recipes, "en") : buildRuneshapeIndex(all, recipes) };
  }
  return cached.index;
}

export function matchRunesRows(lines: RuneshapeOcrRow[], index: RuneshapeIndex = defaultIndex()): RuneshapeMatchRow[] {
  return matchRunesRowsWith(lines, index);
}

// ---- 第 25 步:辨識語言獨立於客戶端語言 ----

/** 目前載入的客戶端資料語系 → 文字語言(載入中 = 繁中,同 `loadedOcrTextLang`) */
function loadedTextLang(): OcrTextLang {
  return clientLang() === "en" ? "en" : "zh";
}

interface AltCacheEntry {
  iter: typeof ITEMS_ITERATOR;
  recipes: typeof RUNESHAPE_RECIPES;
  lang: OcrTextLang;
  index?: RuneshapeIndex;
  pending?: Promise<boolean>;
}
let altCache: AltCacheEntry | null = null;

const refKey = (ns: string, ref: string, category: string) => `${ns}|${ref}|${category}`;

/** 另一個語言的 items.ndjson(ITEM / GEM 的名稱)→ 索引;name 一律換回客戶端語言的名稱 */
function buildAltIndex(ndjson: string, lang: OcrTextLang, recipes: Iterable<RecipeEntry>): RuneshapeIndex {
  const shown = new Map<string, string>();
  const items = clientItems();
  for (const ns of ["ITEM", "GEM"]) {
    for (const r of items(`"namespace": "${ns}"`)) {
      const k = refKey(r.namespace, r.refName, r.craftable?.category ?? "");
      if (!shown.has(k)) shown.set(k, r.name);
    }
  }
  const entries: NameEntry[] = [];
  for (const line of ndjson.split("\n")) {
    if (!line.includes('"namespace": "ITEM"') && !line.includes('"namespace": "GEM"')) continue;
    const r = JSON.parse(line) as NameEntry;
    if (!r.name || !r.refName) continue;
    entries.push({
      name: r.name,
      refName: r.refName,
      namespace: r.namespace,
      craftable: r.craftable,
      tradeTag: r.tradeTag,
      displayName: shown.get(refKey(r.namespace, r.refName, r.craftable?.category ?? "")) ?? r.name,
    });
  }
  return lang === "en" ? buildRuneshapeIndex(entries, recipes, "en") : buildRuneshapeIndex(entries, recipes);
}

/**
 * 準備好某個辨識語言的符文索引(renderer 在辨識語言變了 / 資料載好時呼叫;resolve true = `matchRunesRowsFor` 可用)。
 * 與客戶端語言相同 → 立刻 true;不同 → 讀一次另一語言的 items.ndjson(結果快取,同時多次呼叫共用同一個讀取)。讀檔失敗 → false。
 */
export function ensureRuneshapeIndex(lang: OcrTextLang): Promise<boolean> {
  if (lang === loadedTextLang()) return Promise.resolve(true);
  const iter = clientItems();
  const recipes = RUNESHAPE_RECIPES;
  if (altCache && altCache.iter === iter && altCache.recipes === recipes && altCache.lang === lang) {
    if (altCache.index) return Promise.resolve(true);
    if (altCache.pending) return altCache.pending;
  }
  const entry: AltCacheEntry = { iter, recipes, lang };
  altCache = entry;
  entry.pending = (async () => {
    try {
      const file = `${lang === "en" ? "en" : "cmn-Hant"}/items.ndjson`;
      const text = await source().text(file);
      // 讀的期間資料又重載了 → 這份對不上新的 name 對照,丟掉(呼叫端會在資料載好後再 ensure)
      if (altCache !== entry || clientItems() !== iter) return false;
      entry.index = buildAltIndex(text, lang, recipes?.recipes ?? []);
      return true;
    } catch (e) {
      console.error(`[runeshape] 讀取 ${lang} 物品名稱失敗,辨識語言與客戶端語言不同時符文列會對不上:`, e);
      if (altCache === entry) altCache = null;
      return false;
    }
  })();
  return entry.pending;
}

/** 某辨識語言的索引;還沒準備好(alt 語言尚未 `ensureRuneshapeIndex`)→ undefined */
export function runeshapeIndexFor(lang: OcrTextLang): RuneshapeIndex | undefined {
  if (lang === loadedTextLang()) return defaultIndex();
  if (altCache && altCache.iter === clientItems() && altCache.recipes === RUNESHAPE_RECIPES && altCache.lang === lang) return altCache.index;
  return undefined;
}

/** 依有效辨識語言比對;alt 索引還沒準備好 → undefined(呼叫端等 `ensureRuneshapeIndex` 後重試) */
export function matchRunesRowsFor(lines: RuneshapeOcrRow[], lang: OcrTextLang): RuneshapeMatchRow[] | undefined {
  const index = runeshapeIndexFor(lang);
  return index ? matchRunesRowsWith(lines, index) : undefined;
}
