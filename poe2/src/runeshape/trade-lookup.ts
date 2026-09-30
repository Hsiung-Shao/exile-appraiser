/**
 * exile-appraiser:符文塑形「無 ninja 價的列 → 自動查交易站」(docs/runeshape.md「自動查市集」)。
 *
 * 符文塑形產物很多在 poe.ninja 沒有價格(技能 / 輔助寶石、部分帶等級物品),但交易站查得到。
 * 交易站同名寶石的價差極大(例:維里西姆強化 等級 14、品質 20%、已汙染 415 c vs 等級 20、無品質、未汙染 3 c),
 * 所以查詢**一定要帶與產物相符的篩選**,並把用了哪些篩選交回給 UI(徽章短字 + log;`RuneTradeFilter[]`)。
 *
 * - `planRuneTradeQuery`(純函式):列 → search body 或 bulk exchange 參數 + 篩選清單 + 網頁網址。
 *   - `gem`(技能等級 N):type = 名稱、category = gem、`misc_filters.gem_level` min = max = N、`misc_filters.corrupted` = false、
 *     `type_filters.quality` max = 0(欄位位置依 `/api/trade2/data/filters`:quality 在 type_filters,gem_level / corrupted 在 misc_filters)。
 *   - `skill` / `support`(面板沒寫等級):同上但不限等級(`levelAny`,UI 標「等級不限,價格可能依等級差異大」)。
 *   - `item`:有 `tradeTag` → bulk exchange(want = tag、have = 崇高石 / 神聖石、status online);沒有 → search type = 名稱。
 *   - 不查:`recipe` 泛稱、`ambiguous`、沒有 refName、`offPanel`、台服缺繁中名。
 *   - 名稱:intl(繁中客戶端)送 refName、tw 送繁中 name(`useEnglishNames`,與一般查價相同)。
 * - `executeRuneTradePlan`:重用既有 `requestTradeResultList` / `requestResults` / `execBulkSearch`(限流、快取、realm 各一套);
 *   search 只 fetch 一批(前 10 筆),bulk 只打 1 次 exchange。
 * - `summarizeRuneTrade`(純函式):前 10 筆 → 中位數(≥ 3 筆才給)/ 最低 / 最高;能換算就換成崇高石,不能換算(台服)取最多筆的幣別原幣。
 * - `createRuneTradeQueue`:自動查詢佇列 —— 單一佇列、同時一筆、同一組篩選 30 分鐘記憶體快取、重複出現的列不重排;
 *   **不影響一般查價**:送出前用限流器預估,要等就延後重試(不丟錯、不進限流器的佇列);查價面板開著時暫停;
 *   收到 429 整個佇列暫停到 Retry-After 期滿;面板消失時 `clearPending` 清掉尚未送出的項目(快取保留)。
 */
import type { TradeContext } from "@exile-appraiser/core/games/adapter";
import { parseRetryAfter, type HttpFetch } from "@exile-appraiser/core/http";
import { tradeWebBase, useEnglishNames, type Language, type Realm } from "@exile-appraiser/core/realm";
import type { ParsedItem } from "@/parser";
import type { ItemFilters } from "@/web/price-check/filters/interfaces";
import { requestResults, requestTradeResultList, type TradeRequest } from "@/web/price-check/trade/pathofexile-trade";
import { execBulkSearch } from "@/web/price-check/trade/pathofexile-bulk";
import { activeTradeContext } from "@/web/price-check/trade/context";
import { tradeSession } from "@/web/price-check/trade/common";
import { RateLimiter } from "@/web/price-check/trade/RateLimiter";
import type { RuneshapeMatchRow } from "./match-core";

/** 一次取幾筆明細(最便宜的前幾筆) */
export const RUNE_TRADE_TAKE = 10;
/** 至少幾筆才給中位數;少於這個數顯示最低價並標「筆數少」 */
export const RUNE_TRADE_MIN_FOR_MEDIAN = 3;
/** 本地結果快取:同一組篩選 30 分鐘內不重查 */
export const RUNE_TRADE_CACHE_MS = 30 * 60 * 1000;
/** bulk exchange 用哪些通貨買 */
export const RUNE_TRADE_BULK_HAVE = ["exalted", "divine"] as const;

export type RuneTradeRowInput = Pick<
  RuneshapeMatchRow,
  "kind" | "refName" | "name" | "level" | "tradeTag" | "ambiguous" | "offPanel"
>;

/** 給 UI 顯示的篩選(順序即顯示順序) */
export type RuneTradeFilter =
  | { id: "realm"; value: Realm }
  | { id: "league"; value: string }
  | { id: "mode"; value: "search" | "bulk" }
  | { id: "type"; value: string }
  | { id: "category"; value: "gem" }
  | { id: "gem_level"; value: number }
  | { id: "gem_level_any" }
  | { id: "corrupted"; value: false }
  | { id: "quality"; value: 0 }
  | { id: "want"; value: string }
  | { id: "have"; value: string[] }
  | { id: "status"; value: "securable" | "online" };

export type RuneTradeUnavailable = "recipe" | "ambiguous" | "no-ref" | "off-panel" | "no-name";

interface PlanBase {
  /** 快取鍵(realm + 聯盟 + 查詢內容) */
  key: string;
  realm: Realm;
  league: string;
  filters: RuneTradeFilter[];
  /** 技能 / 輔助寶石沒寫等級 → 等級不限 */
  levelAny: boolean;
  /** 還沒拿到搜尋 id 時的網頁網址(同一組篩選) */
  webUrl: string;
}
export interface RuneTradeSearchPlan extends PlanBase {
  mode: "search";
  body: TradeRequest;
}
export interface RuneTradeBulkPlan extends PlanBase {
  mode: "bulk";
  want: string;
  have: string[];
}
export type RuneTradePlan = RuneTradeSearchPlan | RuneTradeBulkPlan;

export interface RuneTradeOpts {
  realm: Realm;
  language: Language;
  league: string;
}

/** 這一列能不能查交易站;能 → null */
export function runeTradeUnavailable(row: RuneTradeRowInput, opts?: Pick<RuneTradeOpts, "realm" | "language">): RuneTradeUnavailable | null {
  if (row.offPanel) return "off-panel";
  if (row.kind === "recipe") return "recipe";
  if (row.ambiguous?.length) return "ambiguous";
  if (!row.refName) return "no-ref";
  if (opts && !useEnglishNames(opts.realm, opts.language) && !row.name) return "no-name";
  return null;
}

export function planRuneTradeQuery(
  row: RuneTradeRowInput,
  opts: RuneTradeOpts,
): { ok: true; plan: RuneTradePlan } | { ok: false; reason: RuneTradeUnavailable } {
  const reason = runeTradeUnavailable(row, opts);
  if (reason) return { ok: false, reason };
  const english = useEnglishNames(opts.realm, opts.language);
  // 英文客戶端的 name 本身就是英文;繁中 + 國際服送 refName;繁中 + 台服送 name
  const typeName = english ? row.refName! : (row.name ?? row.refName!);
  const head: RuneTradeFilter[] = [
    { id: "realm", value: opts.realm },
    { id: "league", value: opts.league },
  ];

  if (row.kind === "item" && row.tradeTag) {
    const have = [...RUNE_TRADE_BULK_HAVE];
    const filters: RuneTradeFilter[] = [
      ...head,
      { id: "mode", value: "bulk" },
      { id: "want", value: row.tradeTag },
      { id: "have", value: have },
      { id: "status", value: "online" },
    ];
    const exchange = { status: { option: "online" }, have, want: [row.tradeTag] };
    const plan: RuneTradeBulkPlan = {
      mode: "bulk",
      key: JSON.stringify([opts.realm, opts.league, "bulk", row.tradeTag, have]),
      realm: opts.realm,
      league: opts.league,
      filters,
      levelAny: false,
      want: row.tradeTag,
      have,
      webUrl: `${tradeWebBase(opts.realm, "poe2", "exchange", opts.league)}?q=${encodeURIComponent(JSON.stringify({ exchange }))}`,
    };
    return { ok: true, plan };
  }

  const body: TradeRequest = {
    query: {
      status: { option: "securable" },
      type: typeName,
      stats: [{ type: "and", filters: [] }],
      filters: {},
    },
    sort: { price: "asc" },
  };
  const filters: RuneTradeFilter[] = [...head, { id: "mode", value: "search" }, { id: "type", value: typeName }];
  let levelAny = false;
  if (row.kind === "gem" || row.kind === "skill" || row.kind === "support") {
    body.query.filters.type_filters = { filters: { category: { option: "gem" }, quality: { max: 0 } } };
    const misc: NonNullable<TradeRequest["query"]["filters"]["misc_filters"]>["filters"] = { corrupted: { option: "false" } };
    filters.push({ id: "category", value: "gem" });
    if (row.kind === "gem" && row.level != null) {
      misc.gem_level = { min: row.level, max: row.level };
      filters.push({ id: "gem_level", value: row.level });
    } else {
      levelAny = true;
      filters.push({ id: "gem_level_any" });
    }
    body.query.filters.misc_filters = { filters: misc };
    filters.push({ id: "corrupted", value: false }, { id: "quality", value: 0 });
  }
  filters.push({ id: "status", value: "securable" });
  const plan: RuneTradeSearchPlan = {
    mode: "search",
    key: JSON.stringify([opts.realm, opts.league, "search", body]),
    realm: opts.realm,
    league: opts.league,
    filters,
    levelAny,
    body,
    webUrl: `${tradeWebBase(opts.realm, "poe2", "search", opts.league)}?q=${encodeURIComponent(JSON.stringify(body))}`,
  };
  return { ok: true, plan };
}

/** 一筆掛單的單價(bulk = exchange 數量 / 物品數量) */
export interface RuneTradeListing {
  amount: number;
  /** 交易站幣別 id(`exalted` / `divine` / `chaos` …) */
  currency: string;
}

export interface RuneTradeRaw {
  key: string;
  mode: RuneTradePlan["mode"];
  queryId?: string;
  /** 交易站回報的總筆數 */
  total: number;
  /** 最便宜的前幾筆(價格由低到高) */
  listings: RuneTradeListing[];
  /** 有搜尋 id → 開到同一個搜尋;沒有 → plan 的 `?q=` */
  webUrl: string;
  /** 查詢完成時間(ms) */
  at: number;
}

export interface RuneTradeExecHooks {
  /** search 完、fetch 前呼叫(佇列在這裡再預估一次限流;要等就丟 `RuneTradeDeferError`,search 結果留在交易層快取) */
  beforeFetch?: () => void;
}

export async function executeRuneTradePlan(
  ctx: TradeContext,
  plan: RuneTradePlan,
  now: () => number = Date.now,
  hooks: RuneTradeExecHooks = {},
): Promise<RuneTradeRaw> {
  if (plan.mode === "search") {
    const search = await requestTradeResultList(ctx, plan.body, plan.league);
    const ids = search.result.slice(0, RUNE_TRADE_TAKE);
    if (ids.length) hooks.beforeFetch?.();
    const results = ids.length ? await requestResults(ctx, search.id, ids) : [];
    const listings = results
      .filter((r) => r.priceCurrency !== "no price" && r.priceAmount > 0)
      .map((r) => ({ amount: r.priceAmount, currency: r.priceCurrency }));
    return {
      key: plan.key,
      mode: "search",
      queryId: search.id,
      total: search.total,
      listings,
      webUrl: search.id ? `${tradeWebBase(plan.realm, "poe2", "search", plan.league)}/${search.id}` : plan.webUrl,
      at: now(),
    };
  }
  // execBulkSearch 只讀 item.info.tradeTag 與 filters.trade.{listingType, league}(stackSize 沒給 = 不限最少數量)
  const item = { info: { tradeTag: plan.want } } as unknown as ParsedItem;
  const filters = { trade: { listingType: "online", league: plan.league } } as unknown as ItemFilters;
  const byHave = await execBulkSearch(ctx, item, filters, plan.have);
  const listings: RuneTradeListing[] = [];
  let total = 0;
  let queryId: string | undefined;
  for (const r of byHave) {
    if (!r) continue;
    queryId ??= r.queryId;
    total += r.total;
    for (const l of r.listed) {
      if (l.itemAmount > 0 && l.exchangeAmount > 0) listings.push({ amount: l.exchangeAmount / l.itemAmount, currency: r.haveTag });
    }
  }
  return {
    key: plan.key,
    mode: "bulk",
    queryId,
    total,
    listings,
    webUrl: queryId ? `${tradeWebBase(plan.realm, "poe2", "exchange", plan.league)}/${queryId}` : plan.webUrl,
    at: now(),
  };
}

export interface RuneTradeSummary {
  /** `exalted` = 已換算成崇高石;否則是原幣的交易站幣別 id(台服 / 沒有匯率) */
  unit: string;
  converted: boolean;
  /** 參與計算的筆數 */
  count: number;
  /** ≥ `RUNE_TRADE_MIN_FOR_MEDIAN` 筆才有 */
  median?: number;
  min?: number;
  max?: number;
  /** 筆數少於 `RUNE_TRADE_MIN_FOR_MEDIAN` */
  few: boolean;
  /** 幣別換算不了 / 不是主要幣別而沒算進去的筆數 */
  skipped: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 前 `RUNE_TRADE_TAKE` 筆 → 中位數 / 最低 / 最高。
 * `toExalted` 有給(國際服有 poe.ninja 匯率)→ 換成崇高石,換不了的筆數記 `skipped`;一筆都換不了或沒給 → 原幣:
 * 取筆數最多的幣別(同數取先出現 = 較便宜那一端),其他幣別記 `skipped`。
 */
export function summarizeRuneTrade(
  listings: readonly RuneTradeListing[],
  toExalted?: (amount: number, currency: string) => number | undefined,
): RuneTradeSummary {
  const top = listings.slice(0, RUNE_TRADE_TAKE);
  let values: number[] = [];
  let unit = "exalted";
  let converted = false;
  if (toExalted) {
    for (const l of top) {
      const v = toExalted(l.amount, l.currency);
      if (v != null && Number.isFinite(v) && v > 0) values.push(v);
    }
    converted = values.length > 0;
  }
  if (!converted) {
    const counts = new Map<string, number>();
    for (const l of top) counts.set(l.currency, (counts.get(l.currency) ?? 0) + 1);
    let best = "";
    let n = 0;
    for (const [c, k] of counts) if (k > n) { best = c; n = k; }
    unit = best || "exalted";
    values = top.filter((l) => l.currency === best).map((l) => l.amount);
  }
  const count = values.length;
  const out: RuneTradeSummary = { unit, converted, count, few: count < RUNE_TRADE_MIN_FOR_MEDIAN, skipped: top.length - count };
  if (count) {
    out.min = Math.min(...values);
    out.max = Math.max(...values);
    if (count >= RUNE_TRADE_MIN_FOR_MEDIAN) out.median = median(values);
  }
  return out;
}

// ---------------- 自動查詢佇列(docs/runeshape.md「自動查市集」) ----------------

/** 限流預估要等時,多等這麼久再試(避免剛好卡在視窗邊緣又被擋) */
export const RUNE_TRADE_DEFER_MARGIN_MS = 300;
/** 暫停中(查價面板開著)多久檢查一次 */
export const RUNE_TRADE_HOLD_POLL_MS = 1000;
/** 查詢失敗(非限流)後,同一組篩選多久內不再自動排入 */
export const RUNE_TRADE_FAIL_RETRY_MS = 5 * 60 * 1000;

/** 佇列自己打的請求收到 429:整個佇列暫停 `seconds` 秒(不走 `withRetryAfter` 的等待重試) */
export class RuneTradeRateLimitedError extends Error {
  constructor(public readonly seconds: number) {
    super(`429 Retry-After ${seconds} seconds`);
    this.name = "RuneTradeRateLimitedError";
  }
}

/** 送出前(或 fetch 前)限流預估要等:延後 `ms` 再試,不進限流器的佇列 */
export class RuneTradeDeferError extends Error {
  constructor(public readonly ms: number) {
    super(`deferred ${ms} ms`);
    this.name = "RuneTradeDeferError";
  }
}

/**
 * 佇列用的 HttpFetch 包裝:收到 429 → 丟 `RuneTradeRateLimitedError`(Retry-After 秒數,沒給 = 60)。
 * 給它**原始**的 http(不含 `withRetryAfter`),自動查詢不在背景睡著等,而是整個佇列暫停。
 */
export function withRuneTrade429(http: HttpFetch): HttpFetch {
  return async (url, init) => {
    const r = await http(url, init);
    if (r.status === 429) throw new RuneTradeRateLimitedError(parseRetryAfter(r.headers));
    return r;
  };
}

/**
 * 送出前預估要等幾 ms(0 = 可立刻送出,不會進限流器的佇列)。
 * `start`:search 同時看 SEARCH 與 FETCH(一筆物品 = 1 search + 1 fetch)、bulk 看 EXCHANGE;`fetch`:只看 FETCH。
 * 限流器上已經有人在排隊(一般查價)→ 至少讓 `RUNE_TRADE_HOLD_POLL_MS`。
 */
export function runeTradeWaitMs(plan: Pick<RuneTradePlan, "mode">, realm: Realm, step: "start" | "fetch"): number {
  const { limits } = tradeSession(realm);
  const sets = step === "fetch" ? [limits.FETCH] : plan.mode === "bulk" ? [limits.EXCHANGE] : [limits.SEARCH, limits.FETCH];
  let ms = 0;
  for (const set of sets) {
    for (const rl of set) if (rl.queue.value > 0) ms = Math.max(ms, RUNE_TRADE_HOLD_POLL_MS);
    ms = Math.max(ms, RateLimiter.estimateTime(1, set));
  }
  return ms;
}

export type RuneTradeEntry =
  | { state: "queued"; plan: RuneTradePlan }
  | { state: "loading"; plan: RuneTradePlan }
  | { state: "done"; plan: RuneTradePlan; raw: RuneTradeRaw; cached: boolean }
  | { state: "failed"; plan: RuneTradePlan; message: string; at: number };

export interface RuneTradeQueueDeps {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** 交易 context(預設 = `activeTradeContext()`,http 包上 `withRuneTrade429`) */
  ctx?: () => TradeContext;
  exec?: (ctx: TradeContext, plan: RuneTradePlan, now: () => number, hooks: RuneTradeExecHooks) => Promise<RuneTradeRaw>;
  /** 預設 `runeTradeWaitMs`(真的限流器狀態) */
  waitMs?: (plan: RuneTradePlan, realm: Realm, step: "start" | "fetch") => number;
  /** 暫停原因(查價面板開著 / 一般查價進行中);null = 可以跑 */
  held?: () => string | null;
  onChange?: (key: string, entry: RuneTradeEntry | undefined) => void;
  log?: (msg: string) => void;
}

export interface RuneTradeQueue {
  /** 排入(同一組篩選已在佇列 / 查詢中 / 30 分鐘內有結果 / 5 分鐘內失敗 → 不重排);回傳是否真的排入 */
  enqueue(plan: RuneTradePlan): boolean;
  entry(key: string): RuneTradeEntry | undefined;
  /** 清掉尚未送出的項目(面板消失);查詢中那筆照跑、快取保留。回傳清掉幾筆 */
  clearPending(): number;
  /** 整個佇列暫停(一般查價收到 429 的 Retry-After 也用這個) */
  pauseFor(seconds: number, reason: string): void;
  /** 暫停條件可能解除了(查價面板關閉)→ 立刻再試 */
  kick(): void;
  readonly pending: number;
  readonly busy: boolean;
  /** 整個佇列暫停到這個時間(ms;0 = 沒暫停) */
  readonly pausedUntil: number;
  dispose(): void;
}

const RETRY_AFTER_RE = /^Retry after (\d+) seconds$/;
const defaultCtx = (): TradeContext => {
  const c = activeTradeContext();
  return { ...c, http: withRuneTrade429(c.http) };
};

export function createRuneTradeQueue(deps: RuneTradeQueueDeps = {}): RuneTradeQueue {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const exec = deps.exec ?? executeRuneTradePlan;
  const waitMs = deps.waitMs ?? runeTradeWaitMs;
  const getCtx = deps.ctx ?? defaultCtx;
  const log = deps.log ?? ((m: string) => console.log(m));
  const cache = new Map<string, RuneTradeRaw>();
  const entries = new Map<string, RuneTradeEntry>();
  let pending: RuneTradePlan[] = [];
  let inFlight: RuneTradePlan | null = null;
  let pausedUntil = 0;
  let notBefore = 0;
  let timer: unknown = null;
  let lastHeld: string | null = null;
  let disposed = false;

  const set = (key: string, e: RuneTradeEntry | undefined) => {
    if (e) entries.set(key, e);
    else entries.delete(key);
    deps.onChange?.(key, e);
  };
  const desc = (p: RuneTradePlan) => `${p.mode} ${JSON.stringify(p.filters)}`;

  function cached(key: string): RuneTradeRaw | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (now() - hit.at >= RUNE_TRADE_CACHE_MS) {
      cache.delete(key);
      return undefined;
    }
    return hit;
  }

  function schedule(ms: number) {
    if (disposed) return;
    if (timer != null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      pump();
    }, Math.max(0, ms));
  }

  function pump() {
    if (disposed || inFlight) return;
    // 排隊期間別處已有結果(同一組篩選)→ 直接完成
    while (pending.length) {
      const hit = cached(pending[0].key);
      if (!hit) break;
      const p = pending.shift()!;
      set(p.key, { state: "done", plan: p, raw: hit, cached: true });
    }
    if (!pending.length) return;
    const t = now();
    const resumeAt = Math.max(pausedUntil, notBefore);
    if (t < resumeAt) return schedule(resumeAt - t);
    const heldBy = deps.held?.() ?? null;
    if (heldBy) {
      if (heldBy !== lastHeld) log(`[runeshape] 市集佇列暫停(${heldBy}),剩 ${pending.length} 筆`);
      lastHeld = heldBy;
      return schedule(RUNE_TRADE_HOLD_POLL_MS);
    }
    if (lastHeld) log(`[runeshape] 市集佇列繼續(${lastHeld} 解除)`);
    lastHeld = null;
    const plan = pending[0];
    const ctx = getCtx();
    const w = waitMs(plan, ctx.realm, "start");
    if (w > 0) {
      // 限流器預估要等:延後再試(不丟錯、不進限流器的佇列,一般查價優先)
      notBefore = t + w + RUNE_TRADE_DEFER_MARGIN_MS;
      return schedule(w + RUNE_TRADE_DEFER_MARGIN_MS);
    }
    pending.shift();
    inFlight = plan;
    set(plan.key, { state: "loading", plan });
    log(`[runeshape] 市集查詢 ${desc(plan)}`);
    const hooks: RuneTradeExecHooks = {
      beforeFetch: () => {
        const w2 = waitMs(plan, ctx.realm, "fetch");
        if (w2 > 0) throw new RuneTradeDeferError(w2);
      },
    };
    exec(ctx, plan, now, hooks)
      .then((raw) => {
        cache.set(plan.key, raw);
        if (disposed) return;
        set(plan.key, { state: "done", plan, raw, cached: false });
        log(`[runeshape] 市集結果 ${plan.mode} ${raw.listings.length} 筆 / 共 ${raw.total}:${raw.listings.map((l) => `${l.amount} ${l.currency}`).join(", ")}`);
      })
      .catch((e: unknown) => {
        if (disposed) return;
        const back = () => {
          pending.unshift(plan);
          set(plan.key, { state: "queued", plan });
        };
        if (e instanceof RuneTradeRateLimitedError) {
          pausedUntil = Math.max(pausedUntil, now() + e.seconds * 1000);
          log(`[runeshape] 市集佇列收到 429,整個佇列暫停 ${e.seconds} 秒`);
          back();
          return;
        }
        const m = e instanceof Error ? RETRY_AFTER_RE.exec(e.message) : null;
        if (e instanceof RuneTradeDeferError || m) {
          const ms = e instanceof RuneTradeDeferError ? e.ms : Number(m![1]) * 1000;
          notBefore = now() + ms + RUNE_TRADE_DEFER_MARGIN_MS;
          back();
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        set(plan.key, { state: "failed", plan, message, at: now() });
        console.warn(`[runeshape] 市集查詢失敗 ${desc(plan)}:${message}`);
      })
      .finally(() => {
        inFlight = null;
        pump();
      });
  }

  return {
    enqueue(plan) {
      if (disposed) return false;
      const e = entries.get(plan.key);
      if (e?.state === "queued" || e?.state === "loading") return false;
      if (e?.state === "failed" && now() - e.at < RUNE_TRADE_FAIL_RETRY_MS) return false;
      const hit = cached(plan.key);
      if (hit) {
        if (e?.state !== "done") set(plan.key, { state: "done", plan, raw: hit, cached: true });
        return false;
      }
      pending.push(plan);
      set(plan.key, { state: "queued", plan });
      log(`[runeshape] 市集排入(第 ${pending.length} 筆)${desc(plan)}`);
      pump();
      return true;
    },
    entry: (key) => entries.get(key),
    clearPending() {
      const n = pending.length;
      const old = pending;
      pending = [];
      for (const p of old) set(p.key, undefined);
      if (n) log(`[runeshape] 面板消失,清掉 ${n} 筆尚未送出的市集查詢`);
      return n;
    },
    pauseFor(seconds, reason) {
      pausedUntil = Math.max(pausedUntil, now() + seconds * 1000);
      log(`[runeshape] 市集佇列暫停 ${seconds} 秒(${reason})`);
      if (pending.length && !inFlight) schedule(pausedUntil - now());
    },
    kick() {
      if (!inFlight && pending.length) schedule(0);
    },
    get pending() {
      return pending.length;
    },
    get busy() {
      return inFlight != null;
    },
    get pausedUntil() {
      return pausedUntil;
    },
    dispose() {
      disposed = true;
      if (timer != null) clearTimer(timer);
      timer = null;
      pending = [];
    },
  };
}
