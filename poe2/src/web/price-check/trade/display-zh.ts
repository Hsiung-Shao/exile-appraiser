/**
 * exile-appraiser(第 19 步):PoE2 查價結果「懸停顯示物品」浮窗的繁中顯示。
 *
 * 國際服 `/api/trade2/fetch` 回的詞綴 / 物品名一律是英文;介面語言是繁中時,這裡把它們換成
 * repo 既有資料(`data/poe2/cmn-Hant/{stats,items}.ndjson`)裡的繁中,**不自行翻譯任何字**。
 *
 * 對接一律用語言無關的鍵(CLAUDE.md 規則 2,禁止位置對位):
 * - 詞綴:每行自己的 trade stat id(新格式 `explicitMods[i].hash`;舊格式字串陣列用
 *   `extended.hashes[type][i][0]` —— 同一份回應裡同一個 i 的那一行,不是跨語系對位)
 *   → 兩個語系 stats.ndjson 裡 `trade.ids` 含這個 id 的條目,以 `ref`(英文原文鍵)配對英 / 繁兩筆。
 * - matcher 變體:英文行必須**完整匹配**該條目某個英文 matcher(`#` 個數相同、其餘字面相同),
 *   再用語言無關的 `negate` / `value` 旗標挑繁中 matcher;數值依 `#` 出現順序代入。
 *   挑不出唯一的繁中結果(沒有對應變體、多個不同寫法、數值個數不符…)一律保留英文。
 * - 物品名:`refName`(UNIQUE 用 `name`、其餘用 `typeLine`,且 typeLine 必須等於 baseType;
 *   魔法物品的 typeLine 帶詞綴名,對不上 → 保留英文;稀有物品的隨機名不翻)。
 *
 * veiled(未揭露)行與 P/S tier、排序完全不動;只換 `text`。
 *
 * 2026-10-14(使用者實機:符文詞綴、類別行、需求行仍是英文):
 * - 同旗標多種繁中寫法(例:`增加#%護甲、閃避、和能量護盾` / `增加#%護甲值、閃避和能量護盾`)→ 以台服交易站
 *   `data/poe2/trade/tw/stats.json` 同一個 trade stat id 的文字代入同樣數值,恰好命中其中一個才採用;否則照舊保留英文。
 * - 物品類別行(`properties[0]`,沒有數值)→ GGPK 物品種類繁中名(`data/poe2/item-classes/`,`scripts/sync-poe2-item-classes.mjs`)。
 * - 需求行 → 依 `requirements[].type`(62 等級 / 63 力量 / 64 敏捷 / 65 智慧,語言無關)取繁中 `client_strings`
 *   的 `REQUIRES` 與 `REQUIRES_LINE` 裡的字;有任何一項對不上就整行保留英文。
 *
 * 2026-10-30(PoE1 同類修正後的交叉審查):nameBlock 走 `buildNameBlock` 預設分支的屬性行(`Stack Size `、
 * `Quality: {0}`、`Quality (Life Modifiers): {0}`…)→ GGPK 繁中(`item-classes.json` 的 `strings`:clientstrings 白名單 +
 * 品質類型表,已剝顯示標記);`item.*` 介面字串鍵行(護甲、閃避…)本來就由介面語系翻,不動。
 *
 * code review 第 B 批(載入不擋查價):
 * - 懸停浮窗設成「關閉」(`hostOptions().itemHoverTooltip === "off"`)→ 不載資料、不翻。
 * - `requestResults` 不 await 資料:已在記憶體就同步翻;還沒載 → 這次回英文、背景開始載,載好後下一次查價(含快取結果)就是繁中。
 * - 重用 `@/assets/data` 已載入的那一個語系(`LOADED_DATA`;客戶端繁中 → 繁中 stats / items 用記憶體裡的,只另讀 en/stats;
 *   客戶端英文 → en stats 用記憶體裡的,另讀繁中 stats / items)。逐行解析結果與直接讀檔相同(測試守著)。
 */
import { LOADED_DATA, ITEMS_ITERATOR, STATS_ITERATOR } from "@/assets/data";
import { source } from "@/assets/data/source";
import type { DataSource } from "@exile-appraiser/core/games/adapter";
import { clientStringsFor } from "@/assets/data";
import type { Stat, StatMatcher, TranslationDict } from "@/assets/data/interfaces";
import { parseAffixStrings } from "@/parser/Parser";
import { hostOptions } from "@/parser/host-options";
import type { DisplayItem, DisplayItemLine } from "./pathofexile-trade";

/** 本模組翻的詞綴區塊(`DisplayItem[`${t}Mods`]`、fetch `item[`${t}Mods`]`、`extended.hashes[t]`)。veiled 不在內。 */
export const ZH_MOD_TYPES = [
  "enchant",
  "rune",
  "implicit",
  "fractured",
  "explicit",
  "crafted",
  "desecrated",
  "mutated",
  "pseudo",
] as const;
export type ZhModType = (typeof ZH_MOD_TYPES)[number];

/** 只取用到的欄位(`pathofexile-trade.ts` 的 FetchResult 沒有 export)。 */
export interface ZhFetchItem {
  name?: string;
  typeLine?: string;
  baseType?: string;
  rarity?: string;
  properties?: ReadonlyArray<{ name: string; values?: ReadonlyArray<readonly unknown[]> }>;
  requirements?: ReadonlyArray<{ name: string; type?: number; values?: ReadonlyArray<readonly unknown[]> }>;
  extended?: { hashes?: Record<string, ReadonlyArray<readonly [string, ...unknown[]] | null | undefined>> };
  /** `${type}Mods` 各區塊(字串陣列或 `{ description, hash }` 物件陣列)以 `modsOf()` 讀 */
}

function modsOf(item: ZhFetchItem, key: string): unknown {
  return (item as unknown as Record<string, unknown>)[key];
}

interface StatPair {
  en: Stat;
  zh: Stat;
}

export interface DisplayZhData {
  /** 正規化後的 trade stat id(`explicit.stat_123`)→ 英 / 繁條目配對 */
  statsByTradeId: Map<string, StatPair[]>;
  /** `stat_123`(去掉類別前綴)→ 配對;完整 id 查不到時的後備(同一個 stat hash 跨類別是同一條詞綴) */
  statsByHash: Map<string, StatPair[]>;
  /** `${namespace}::${refName}` → 繁中名集合 */
  itemNames: Map<string, Set<string>>;
  /** 台服交易站 trade stat id(`rune.stat_123`)→ 繁中文字;同旗標多種寫法時用來挑一個 */
  tradeTextZh?: Map<string, string>;
  /** GGPK `ItemClasses` 的 Id 與英文名(`data/poe2/item-classes/item-classes.json`)→ 繁中名集合 */
  itemClassZh?: Map<string, Set<string>>;
  /** 屬性名:同一檔的 `strings` 英文 → 繁中(同一英文對到多個不同繁中的不收) */
  stringZh?: Map<string, string>;
  /** 需求行:`REQUIRES`(`需求: `)與各 requirement type 的字 */
  requiresZh?: { label: string; level: string; attrs: Record<number, string> };
}

/** 繁中 stats / items 以外的補充來源(原始內容;沒有 = 那部分不翻) */
export interface DisplayZhExtras {
  /** `trade/tw/stats.json` */
  tradeStatsTw?: string;
  /** `item-classes/item-classes.json`(`scripts/sync-poe2-item-classes.mjs` 由 GGPK 同步) */
  itemClasses?: string;
  /** `cmn-Hant/client_strings.js` 的 default export */
  clientStringsZh?: Pick<TranslationDict, "REQUIRES" | "REQUIRES_LINE">;
}

export type ZhLineReason =
  | "ok"
  | "no-id"
  | "unknown-id"
  | "no-en-match"
  | "no-zh-variant"
  | "ambiguous";

export interface ZhLineReport {
  type: ZhModType;
  index: number;
  tradeId: string | undefined;
  en: string;
  zh: string | undefined;
  reason: ZhLineReason;
}

// ---------------------------------------------------------------------------
// 資料載入(與目前載入的客戶端語言無關:兩個語系的 stats 都要)

const loaded = new WeakMap<DataSource, Promise<DisplayZhData>>();
/** 已載好的資料(`displayZhFor` 同步取用;沒有 = 還沒載好) */
const ready = new WeakMap<DataSource, DisplayZhData>();

function parseNdjson<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s) out.push(JSON.parse(s) as T);
  }
  return out;
}

type ZhItemRecord = { namespace: string; refName: string; name: string };

export function buildDisplayZhData(
  enStatsNdjson: string,
  zhStatsNdjson: string,
  zhItemsNdjson: string,
  extras?: DisplayZhExtras,
): DisplayZhData {
  return buildDisplayZhDataFrom(
    parseNdjson<Stat>(enStatsNdjson),
    parseNdjson<Stat>(zhStatsNdjson),
    parseNdjson<ZhItemRecord>(zhItemsNdjson),
    extras,
  );
}

/** `REQUIRES_LINE`(`…(?:等級[^\d,]*(?<level>\d+))?…(?<str>\d+)[^\d,]*(力量|力量)…`)取出各項的字;結構不符 → undefined。 */
function requiresWords(cs: DisplayZhExtras["clientStringsZh"]): DisplayZhData["requiresZh"] {
  const src = cs?.REQUIRES_LINE?.source;
  if (!cs?.REQUIRES || !src) return undefined;
  const level = /\(\?:([^()[\]\\|]+)\[\^\\d,\]\*\(\?<level>/.exec(src)?.[1];
  const word = (k: string) => new RegExp(escapeRe(`(?<${k}>\\d+)[^\\d,]*(`) + "([^|()]+)").exec(src)?.[1];
  const str = word("str");
  const dex = word("dex");
  const int = word("int");
  if (!level || !str || !dex || !int) return undefined;
  return { label: cs.REQUIRES, level, attrs: { 63: str, 64: dex, 65: int } };
}

function buildExtras(extras: DisplayZhExtras | undefined): Partial<DisplayZhData> {
  const out: Partial<DisplayZhData> = {};
  if (extras?.tradeStatsTw) {
    const map = new Map<string, string>();
    const json = JSON.parse(extras.tradeStatsTw) as {
      result?: Array<{ entries?: Array<{ id?: unknown; text?: unknown }> }>;
    };
    for (const group of json.result ?? []) {
      for (const e of group.entries ?? []) {
        if (typeof e.id === "string" && typeof e.text === "string" && !map.has(e.id)) map.set(e.id, e.text);
      }
    }
    out.tradeTextZh = map;
  }
  if (extras?.itemClasses) {
    const json = JSON.parse(extras.itemClasses) as {
      classes?: Array<{ id?: unknown; en?: unknown; zh?: unknown }>;
      strings?: Array<{ en?: unknown; zh?: unknown }>;
    };
    const map = new Map<string, Set<string>>();
    const add = (key: string, zh: string) => {
      let set = map.get(key);
      if (!set) map.set(key, (set = new Set()));
      set.add(zh);
    };
    for (const c of json.classes ?? []) {
      if (typeof c.zh !== "string" || !c.zh) continue;
      if (typeof c.id === "string") add(c.id, c.zh);
      if (typeof c.en === "string" && c.en !== c.id) add(c.en, c.zh);
    }
    out.itemClassZh = map;

    const byEn = new Map<string, Set<string>>();
    for (const s of json.strings ?? []) {
      if (typeof s.en !== "string" || typeof s.zh !== "string" || !s.en || !s.zh) continue;
      let set = byEn.get(s.en);
      if (!set) byEn.set(s.en, (set = new Set()));
      set.add(s.zh);
    }
    out.stringZh = new Map([...byEn].filter(([, set]) => set.size === 1).map(([en, set]) => [en, [...set][0]]));
  }
  const req = requiresWords(extras?.clientStringsZh);
  if (req) out.requiresZh = req;
  return out;
}

/** 同 `buildDisplayZhData`,輸入是已解析的記錄(`@/assets/data` 記憶體裡的迭代器或 `parseNdjson`)。 */
export function buildDisplayZhDataFrom(
  enStats: Iterable<Stat>,
  zhStats: Iterable<Stat>,
  zhItems: Iterable<ZhItemRecord>,
  extras?: DisplayZhExtras,
): DisplayZhData {
  const enByRef = new Map<string, Stat>();
  for (const s of enStats) {
    if (!enByRef.has(s.ref)) enByRef.set(s.ref, s);
  }
  const statsByTradeId = new Map<string, StatPair[]>();
  const statsByHash = new Map<string, StatPair[]>();
  const push = (map: Map<string, StatPair[]>, key: string, pair: StatPair) => {
    const list = map.get(key);
    if (!list) map.set(key, [pair]);
    else if (!list.includes(pair)) list.push(pair);
  };
  for (const zh of zhStats) {
    const en = enByRef.get(zh.ref);
    if (!en) continue;
    const pair = { en, zh };
    for (const ids of Object.values(zh.trade?.ids ?? {})) {
      for (const id of ids) {
        push(statsByTradeId, id, pair);
        const dot = id.indexOf(".");
        if (dot !== -1) push(statsByHash, id.slice(dot + 1), pair);
      }
    }
  }

  const itemNames = new Map<string, Set<string>>();
  for (const r of zhItems) {
    const key = `${r.namespace}::${r.refName}`;
    let set = itemNames.get(key);
    if (!set) itemNames.set(key, (set = new Set()));
    set.add(r.name);
  }
  return { statsByTradeId, statsByHash, itemNames, ...buildExtras(extras) };
}

/** stats / items ndjson 每一行都含的鍵(`ndjsonFindLines` 的搜尋字串;`"refName"` 不含 `"ref":`) */
const STAT_LINE_KEY = '"ref":';
const ITEM_LINE_KEY = '"namespace":';

/**
 * 讀 `en/stats.ndjson`、`cmn-Hant/{stats,items}.ndjson`(同一個 DataSource 只讀一次;失敗下次重試)。
 * `@/assets/data` 已從同一個 DataSource 載好其中一個語系時,那個語系直接用記憶體裡的(不重讀檔)。
 */
export function loadDisplayZhData(ds: DataSource = source()): Promise<DisplayZhData> {
  const have = ready.get(ds);
  if (have) return Promise.resolve(have);
  let p = loaded.get(ds);
  if (!p) {
    // 記憶體裡的資料:呼叫當下取(之後換語系會換掉迭代器,這裡拿到的仍是同一份)
    const mem = LOADED_DATA?.source === ds ? LOADED_DATA.lang : undefined;
    const statsIt = STATS_ITERATOR;
    const itemsIt = ITEMS_ITERATOR;
    const text = (rel: string) => ds.text(rel);
    const parsed = <T>(rel: string) => text(rel).then((t) => parseNdjson<T>(t));
    p = (async () => {
      const extras = await loadExtras(ds);
      if (mem === "cmn-Hant") {
        const en = await parsed<Stat>("en/stats.ndjson");
        return buildDisplayZhDataFrom(
          en,
          statsIt(STAT_LINE_KEY),
          itemsIt(ITEM_LINE_KEY) as Iterable<ZhItemRecord>,
          extras,
        );
      }
      if (mem === "en") {
        const [zh, items] = await Promise.all([
          parsed<Stat>("cmn-Hant/stats.ndjson"),
          parsed<ZhItemRecord>("cmn-Hant/items.ndjson"),
        ]);
        return buildDisplayZhDataFrom(statsIt(STAT_LINE_KEY), zh, items, extras);
      }
      const [en, zh, items] = await Promise.all([
        text("en/stats.ndjson"),
        text("cmn-Hant/stats.ndjson"),
        text("cmn-Hant/items.ndjson"),
      ]);
      return buildDisplayZhData(en, zh, items, extras);
    })().then((d) => {
      ready.set(ds, d);
      return d;
    });
    p.catch(() => loaded.delete(ds));
    loaded.set(ds, p);
  }
  return p;
}

/** 浮窗會翻繁中的條件(國際服、介面繁中、懸停浮窗不是「關閉」);與 `displayZhFor` 共用 */
function wantsZh(realm: string): boolean {
  const opts = hostOptions();
  return realm === "intl" && opts.uiLanguage === "cmn-Hant" && opts.itemHoverTooltip !== "off";
}

/** 延後到閒置:`requestIdleCallback`(最多等 5 秒),沒有就 `setTimeout` 2 秒(不跟啟動搶 CPU / 讀檔) */
function whenIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === "function") ric(fn, { timeout: 5000 });
  else setTimeout(fn, 2000);
}

/**
 * 2026-10-15(使用者回報重啟後第一次查價浮窗全英文):renderer 在 PoE2 資料載好後、或設定(遊戲 / 伺服器 / 介面語言 /
 * 懸停浮窗)改變時呼叫;符合翻譯條件且還沒載 / 沒在載 → 排到閒置時背景載入,第一次查價就能同步翻。
 * 回傳是否排了新的載入。不符條件或已載好 / 載入中 → no-op(查價時 `displayZhFor` 的背景載入仍是後備)。
 */
export function scheduleDisplayZhPreload(realm: string, later: (fn: () => void) => void = whenIdle): boolean {
  if (!wantsZh(realm)) return false;
  let ds: DataSource;
  try {
    ds = source();
  } catch {
    return false;
  }
  if (ready.has(ds) || loaded.has(ds)) return false;
  later(() => {
    // 排程到執行之間設定可能又變了
    if (!wantsZh(realm)) return;
    const started = Date.now();
    loadDisplayZhData(ds).then(
      () => console.log(`[trade] 懸停浮窗繁中資料預先載入完成(${Date.now() - started} ms)`),
      (e) => console.error("[trade] 懸停浮窗繁中資料預先載入失敗,查價時再試:", e),
    );
  });
  return true;
}

/** 補充來源各自讀;失敗只記錄,那部分維持英文(詞綴翻譯照常) */
async function loadExtras(ds: DataSource): Promise<DisplayZhExtras> {
  const soft = <T>(what: string, run: () => Promise<T>): Promise<T | undefined> =>
    run().catch((e: unknown) => {
      console.error(`[trade] 懸停浮窗繁中補充資料 ${what} 載入失敗,該部分維持英文:`, e);
      return undefined;
    });
  let primary = false;
  try {
    primary = source() === ds;
  } catch {
    primary = false;
  }
  const [tradeStatsTw, itemClasses, clientStringsZh] = await Promise.all([
    soft("trade/tw/stats.json", () => ds.text("trade/tw/stats.json")),
    soft("item-classes/item-classes.json", () => ds.text("item-classes/item-classes.json")),
    soft("cmn-Hant/client_strings.js", async () =>
      primary
        ? await clientStringsFor("cmn-Hant")
        : ((await ds.module("cmn-Hant/client_strings.js")) as TranslationDict),
    ),
  ]);
  return { tradeStatsTw, itemClasses, clientStringsZh };
}

/** 測試用:清掉某個 DataSource 的快取(模擬第一次查價) */
export const __displayZhTest = {
  reset(ds: DataSource = source()): void {
    loaded.delete(ds);
    ready.delete(ds);
  },
};

// ---------------------------------------------------------------------------
// 單行詞綴

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const SIGNED_NUM = String.raw`([+-]?\d+(?:\.\d+)?)`;

function normalizeText(s: string): string {
  return s.replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Template {
  /** 以 `#` 切開的字面段,parts.length = 佔位數 + 1 */
  parts: string[];
  /** 第 k 個 `#` 前面緊貼的字面正負號(`+#`、`-#`) */
  signs: Array<"+" | "-" | undefined>;
  /** 匹配用的 RegExp(第一次匹配才建;無 g flag,exec 無狀態可重用) */
  re?: RegExp;
}

function parseTemplate(tpl: string): Template {
  const parts = normalizeText(tpl).split("#");
  const signs = parts.slice(0, -1).map((p) => {
    const last = p.slice(-1);
    return last === "+" || last === "-" ? last : undefined;
  });
  return { parts, signs };
}

/** matcher 物件 → 解析好的模板(資料載入後 matcher 不變;每行每 matcher 不用重解析 / 重編 RegExp) */
const templateCache = new WeakMap<StatMatcher, Template>();
function templateOf(m: StatMatcher): Template {
  let t = templateCache.get(m);
  if (!t) {
    t = parseTemplate(m.string);
    templateCache.set(m, t);
  }
  return t;
}

/** 英文行完整匹配模板 → 每個 `#` 的值(帶上模板字面正負號);不匹配 → undefined。 */
function matchTemplate(line: string, tpl: Template): string[] | undefined {
  if (!tpl.re) {
    let re = "^" + escapeRe(tpl.parts[0]);
    for (let k = 1; k < tpl.parts.length; k += 1) {
      re += (tpl.signs[k - 1] ? NUM : SIGNED_NUM) + escapeRe(tpl.parts[k]);
    }
    tpl.re = new RegExp(re + "$");
  }
  const m = tpl.re.exec(line);
  if (!m) return undefined;
  return m.slice(1).map((v, k) => (tpl.signs[k] ? tpl.signs[k] + v : v));
}

/** 值代入繁中模板;模板字面正負號與值的正負號衝突 → undefined。 */
function fillTemplate(tpl: Template, values: string[]): string | undefined {
  if (values.length !== tpl.parts.length - 1) return undefined;
  let out = tpl.parts[0];
  for (let k = 0; k < values.length; k += 1) {
    let v = values[k];
    const literal = tpl.signs[k];
    if (literal) {
      const own = /^[+-]/.exec(v)?.[0];
      if (own && own !== literal) return undefined;
      if (own) v = v.slice(1);
      else if (literal === "-") return undefined;
    }
    out += v + tpl.parts[k + 1];
  }
  return out;
}

/**
 * 一個英 / 繁條目配對對這一行可能產生的繁中結果(0 或多個),並回報英文 matcher 有沒有完整匹配這一行(`enMatched`,不論 value 是否通過)。
 * 英文 matcher 完整匹配後,依語言無關的 `negate` / `value` 挑繁中 matcher:
 * 1. 同 negate 且同 value 的繁中 matcher;
 * 2. 英文 matcher 有 value 但繁中沒有對應變體(英文的單複數寫法,例:`Has # Charm Slot` value 1)→
 *    同 negate、無 value、恰好一個 `#` 的繁中 matcher,代入行內數值(行內沒有數值就代 value 本身);
 *    選項型詞綴(`trade.option`,value 是選項 id 不是數值)不走這條。
 */
function candidatesForPair(
  line: string,
  pair: StatPair,
): { out: Set<string>; enMatched: boolean; valueSets: string[][] } {
  const out = new Set<string>();
  const valueSets: string[][] = [];
  let enMatched = false;
  for (const enM of pair.en.matchers) {
    const values = matchTemplate(line, templateOf(enM));
    if (!values) continue;
    enMatched = true;
    const enHasValue = enM.value != null;
    // 有 value 又有 `#` 的英文變體(單數形):行內數值必須等於 value
    if (enHasValue && values.length === 1 && Number(values[0]) !== enM.value) continue;

    const sameKey = (m: StatMatcher) => !!m.negate === !!enM.negate && m.value === enM.value;
    let zhMatchers = pair.zh.matchers.filter(sameKey);
    let zhValues = values;
    if (!zhMatchers.length && enHasValue && !pair.zh.trade?.option && values.length <= 1) {
      zhMatchers = pair.zh.matchers.filter(
        (m) =>
          !!m.negate === !!enM.negate &&
          m.value == null &&
          templateOf(m).parts.length === 2,
      );
      zhValues = values.length ? values : [String(enM.value)];
    }
    if (zhMatchers.length) valueSets.push(zhValues);
    for (const zhM of zhMatchers) {
      const filled = fillTemplate(templateOf(zhM), zhValues);
      if (filled != null) out.add(filled);
    }
  }
  return { out, enMatched, valueSets };
}

/** 台服交易站文字 → 解析後模板(資料載入後不變) */
const tradeTplCache = new Map<string, Template>();

/**
 * 同旗標多種繁中寫法時:台服交易站同一個 id 的文字代入同樣數值,恰好落在候選裡一個 → 採用它。
 * 交易站文字只有正向寫法,減少(negate)的行代進去不會落在候選裡 → 維持不唯一、保留英文。
 */
function pickByTradeText(
  results: Set<string>,
  valueSets: string[][],
  fullIds: string[],
  data: DisplayZhData,
): string | undefined {
  if (!data.tradeTextZh) return undefined;
  const text = fullIds.map((id) => data.tradeTextZh!.get(id)).find((t) => t != null);
  if (text == null) return undefined;
  let tpl = tradeTplCache.get(text);
  if (!tpl) tradeTplCache.set(text, (tpl = parseTemplate(text)));
  const picks = new Set<string>();
  for (const values of valueSets) {
    const filled = fillTemplate(tpl, values);
    if (filled != null && results.has(filled)) picks.add(filled);
  }
  return picks.size === 1 ? [...picks][0] : undefined;
}

/** `stat.explicit.stat_1`(新格式)/ `explicit.stat_1|64921`(選項)→ 查表用的 id(依優先序)。 */
function idKeys(rawId: string): { full: string[]; hash: string[] } {
  let id = rawId.startsWith("stat.") ? rawId.slice(5) : rawId;
  const full = [id];
  const bar = id.indexOf("|");
  if (bar !== -1) {
    id = id.slice(0, bar);
    full.push(id);
  }
  const dot = id.indexOf(".");
  return { full, hash: dot !== -1 ? [id.slice(dot + 1)] : [] };
}

export function translateModLine(
  enLine: string,
  rawId: string | undefined,
  data: DisplayZhData,
): { zh: string | undefined; reason: ZhLineReason } {
  if (!rawId) return { zh: undefined, reason: "no-id" };
  const keys = idKeys(rawId);
  let pairs: StatPair[] | undefined;
  for (const k of keys.full) {
    pairs = data.statsByTradeId.get(k);
    if (pairs) break;
  }
  if (!pairs) {
    for (const k of keys.hash) {
      pairs = data.statsByHash.get(k);
      if (pairs) break;
    }
  }
  if (!pairs?.length) return { zh: undefined, reason: "unknown-id" };

  const line = normalizeText(enLine);
  let enMatched = false;
  const results = new Set<string>();
  const valueSets: string[][] = [];
  for (const pair of pairs) {
    const cand = candidatesForPair(line, pair);
    if (cand.enMatched) enMatched = true;
    for (const c of cand.out) results.add(c);
    valueSets.push(...cand.valueSets);
  }
  if (!enMatched) return { zh: undefined, reason: "no-en-match" };
  if (results.size === 0) return { zh: undefined, reason: "no-zh-variant" };
  if (results.size > 1) {
    const picked = pickByTradeText(results, valueSets, keys.full, data);
    return picked != null ? { zh: picked, reason: "ok" } : { zh: undefined, reason: "ambiguous" };
  }
  return { zh: [...results][0], reason: "ok" };
}

// ---------------------------------------------------------------------------
// 整個浮窗

function rawLineOf(raw: unknown): { text: string; hash?: string } | undefined {
  if (typeof raw === "string") return { text: raw };
  if (raw && typeof raw === "object") {
    const r = raw as { description?: unknown; hash?: unknown };
    if (typeof r.description === "string") {
      return { text: r.description, hash: typeof r.hash === "string" ? r.hash : undefined };
    }
  }
  return undefined;
}

function uniqueName(data: DisplayZhData, keys: string[]): string | undefined {
  const names = new Set<string>();
  for (const k of keys) for (const n of data.itemNames.get(k) ?? []) names.add(n);
  return names.size === 1 ? [...names][0] : undefined;
}

function translateTitle(title: string[], item: ZhFetchItem, data: DisplayZhData): string[] {
  return title.map((t) => {
    if (item.name && t === item.name) {
      // 稀有物品名是隨機組字,只有傳奇名是 refName
      return item.rarity === "Unique" ? (uniqueName(data, [`UNIQUE::${t}`]) ?? t) : t;
    }
    if (item.typeLine && t === item.typeLine) {
      // 魔法物品 typeLine 帶詞綴名(≠ baseType),拆不出來 → 保留英文
      if (item.baseType && item.baseType !== item.typeLine) return t;
      return uniqueName(data, [`ITEM::${t}`, `GEM::${t}`]) ?? t;
    }
    return t;
  });
}

/**
 * 物品類別行(`buildNameBlock` 把沒有數值的 `properties[0]` 原樣放在第一行)→ GGPK 物品種類繁中名。
 * 交易站給的是單數英文(`Body Armour`、`Charm`、`Waystone`);先比 GGPK `Id` / 英文名(`Body Armour`、`Tablet`),
 * 沒有才比「英文名去掉結尾 s」(`Charms` → `Charm`、`Waystones` → `Waystone`)。繁中名必須唯一,否則保留英文。
 */
function translateClassLine(
  block: DisplayItem["nameBlock"],
  item: ZhFetchItem,
  data: DisplayZhData,
): DisplayItem["nameBlock"] {
  const first = block?.[0];
  const prop = item.properties?.[0];
  const classes = data.itemClassZh;
  if (!block || !first || !prop || prop.values?.length || !classes) return block;
  const name = parseAffixStrings(prop.name);
  if (first.text !== `${name} ` || first.value) return block;
  let names = classes.get(name);
  if (!names) names = classes.get(`${name}s`);
  const zh = names?.size === 1 ? [...names][0] : undefined;
  if (!zh) return block;
  return [{ ...first, text: `${zh} ` }, ...block.slice(1)];
}

/**
 * nameBlock 屬性行(`buildNameBlock` 預設分支 `<英文> `、品質 `<英文>: {0}`)→ GGPK 繁中,保留後綴。
 * `item.*` 介面字串鍵行沒有這兩種後綴、類別行由 `translateClassLine` 先處理,查不到的行一律不動。
 */
function translatePropLabels(block: DisplayItem["nameBlock"], data: DisplayZhData): DisplayItem["nameBlock"] {
  const labels = data.stringZh;
  if (!block || !labels?.size) return block;
  return block.map((line) => {
    const m = /^(.+?)(: \{0\}| )$/.exec(line.text);
    const zh = m ? labels.get(m[1]) : undefined;
    return zh && m ? { ...line, text: zh + m[2] } : line;
  });
}

/** 需求行(`buildItemProps` 的最後一行)→ `需求: 等級 ` + `80, 67 力量, 67 敏捷`;任何一項對不上 → 原樣。 */
function translateRequirements(
  props: DisplayItem["itemProps"],
  item: ZhFetchItem,
  data: DisplayZhData,
): DisplayItem["itemProps"] {
  const reqs = item.requirements;
  const words = data.requiresZh;
  const last = props?.[props.length - 1];
  if (!props || !last || !reqs?.length || !words) return props;
  if (last.text !== `${parseAffixStrings(reqs[0].name)} `) return props;
  let level: string | undefined;
  const parts: string[] = [];
  for (const [i, r] of reqs.entries()) {
    const v = r.values?.[0]?.[0];
    if (typeof v !== "string" && typeof v !== "number") return props;
    if (r.type === 62) {
      if (i !== 0) return props;
      level = String(v);
      continue;
    }
    const w = r.type != null ? words.attrs[r.type] : undefined;
    if (!w) return props;
    parts.push(`${v} ${w}`);
  }
  const text = words.label + (level != null ? `${words.level} ` : "");
  const value = [...(level != null ? [level] : []), ...parts].join(", ");
  return [...props.slice(0, -1), { ...last, text, value }];
}

/**
 * 回傳換成繁中的新 DisplayItem(輸入不變)與每一行的結果。
 * 只換 `text`;顏色、tier、順序、veiled 不動。對不上的行保留英文。
 */
export function translateDisplayItem(
  display: DisplayItem,
  item: ZhFetchItem,
  data: DisplayZhData,
): { display: DisplayItem; lines: ZhLineReport[] } {
  const lines: ZhLineReport[] = [];
  const out: DisplayItem = {
    ...display,
    title: translateTitle(display.title, item, data),
    nameBlock: translatePropLabels(translateClassLine(display.nameBlock, item, data), data),
    itemProps: translateRequirements(display.itemProps, item, data),
  };
  const target = out as unknown as Record<string, DisplayItemLine[] | undefined>;

  for (const type of ZH_MOD_TYPES) {
    const key = `${type}Mods`;
    const shown = target[key];
    const rawList = modsOf(item, key);
    if (!shown?.length || !Array.isArray(rawList)) continue;
    const hashes = item.extended?.hashes?.[type];
    target[key] = shown.map((dl, index) => {
      // 顯示行是 parseModBlock 從同一個 fetch 陣列逐一 map 出來的;文字對不上就不碰
      const raw = rawLineOf(rawList[index]);
      if (!raw || parseAffixStrings(raw.text) !== dl.text) {
        lines.push({ type, index, tradeId: undefined, en: dl.text, zh: undefined, reason: "no-id" });
        return dl;
      }
      const tradeId = raw.hash ?? hashes?.[index]?.[0] ?? undefined;
      const { zh, reason } = translateModLine(dl.text, tradeId, data);
      lines.push({ type, index, tradeId, en: dl.text, zh, reason });
      return zh != null ? { ...dl, text: zh } : dl;
    });
  }
  return { display: out, lines };
}

/**
 * `requestResults` 用:國際服(回應是英文)且介面語言是繁中、且懸停浮窗不是「關閉」才回傳轉換函式,否則 undefined
 * (英文介面完全不變;台服回應本身就是繁中,不處理)。
 * code review 第 B 批:**同步**、不擋查價 —— 資料已載好就回轉換函式;還沒載 → 回 undefined(這次英文)並在背景載入,
 * 載好後下一次查價生效。載入失敗只記錄(下次查價再試),浮窗維持英文。
 */
export function displayZhFor(
  realm: string,
): ((display: DisplayItem, item: ZhFetchItem) => DisplayItem) | undefined {
  if (!wantsZh(realm)) return undefined;
  let ds: DataSource;
  try {
    ds = source();
  } catch {
    return undefined;
  }
  const data = ready.get(ds);
  if (!data) {
    loadDisplayZhData(ds).catch((e) => {
      console.error("[trade] 懸停浮窗繁中資料載入失敗,維持英文(下次查價再試):", e);
    });
    return undefined;
  }
  return (display, item) => translateDisplayItem(display, item, data).display;
}
