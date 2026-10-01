/**
 * exile-appraiser:符文塑形「無 ninja 價的列 → 自動查交易站」(poe2/src/runeshape/trade-lookup.ts;docs/runeshape.md「自動查市集」)。
 * - 查詢組法:gem 有 / 無等級、support、item bulk / search、不可查類型;intl 送英文名、tw 送繁中名;篩選清單(log / 徽章短字)。
 * - 執行:錄製的真實交易站回應(fixtures/trade/,2026-09-30 intl 各打一次,已剝帳號 / 角色名 / 密語)經離線 HttpFetch 回放。
 * - 中位數與筆數規則、原幣 / 換算。
 * - 自動查詢佇列(假時鐘 + 假 http):同時一筆、快取命中不重送、重複不重排、限流需等待時延後、429 整個暫停、面板消失清佇列、查價面板開著暫停。
 * 沒有任何真實網路請求。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HttpFetch, HttpResponse } from "@exile-appraiser/core/http";
import type { TradeContext } from "@exile-appraiser/core/games/adapter";
import { init } from "@/assets/data";
import { resetTradeSessions, tradeSession } from "@/web/price-check/trade/common";
import { matchRunesRows } from "@/runeshape/match";
import {
  RUNE_TRADE_CACHE_MS,
  RUNE_TRADE_DEFER_MARGIN_MS,
  RUNE_TRADE_FAIL_RETRY_MS,
  RUNE_TRADE_MAX_ENTRIES,
  RuneTradeRateLimitedError,
  createRuneTradeQueue,
  executeRuneTradePlan,
  runeTradeWaitMs,
  withRuneTrade429,
  type RuneTradeQueueDeps,
  type RuneTradeRaw,
  planRuneTradeQuery,
  runeTradeUnavailable,
  summarizeRuneTrade,
  type RuneTradeOpts,
  type RuneTradePlan,
  type RuneTradeRowInput,
} from "@/runeshape/trade-lookup";

const FX = path.join(__dirname, "fixtures/trade");
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FX, name), "utf8"));
const LEAGUE = "Runes of Aldur";
const INTL: RuneTradeOpts = { realm: "intl", language: "cmn-Hant", league: LEAGUE };
const TW: RuneTradeOpts = { realm: "tw", language: "cmn-Hant", league: LEAGUE };

interface Recorded { url: string; init?: { method?: string; body?: string } }
function response(status: number, body: unknown): HttpResponse {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
}
/** 錄製檔回放:search / fetch / exchange 各一份 */
function recordedHttp(log: Recorded[]): HttpFetch {
  return async (url, init) => {
    log.push({ url, init: init as Recorded["init"] });
    if (url.includes("/api/trade2/search/")) return response(200, fixture("search-powered-by-verisium-l20.json"));
    if (url.includes("/api/trade2/fetch/")) return response(200, fixture("fetch-powered-by-verisium-l20.json"));
    if (url.includes("/api/trade2/exchange/")) return response(200, fixture("exchange-thaumaturgic-flux-18.json"));
    return response(404, { error: { code: 404, message: "not found" } });
  };
}
const ctxOf = (http: HttpFetch, realm: "intl" | "tw" = "intl"): TradeContext => ({ http, realm, latencySeconds: 0, accountName: "" });

const gemRow: RuneTradeRowInput = { kind: "gem", refName: "Powered by Verisium", name: "維里西姆強化", level: 20 };
const plan = (row: RuneTradeRowInput, opts = INTL): RuneTradePlan => {
  const p = planRuneTradeQuery(row, opts);
  if (!p.ok) throw new Error(p.reason);
  return p.plan;
};

beforeAll(async () => {
  await init("cmn-Hant");
});
afterEach(() => resetTradeSessions());

describe("查詢組法(planRuneTradeQuery)", () => {
  it("技能等級 N:type = 英文名、gem_level min = max = N、未汙染、品質 0(欄位位置依 /api/trade2/data/filters)", () => {
    const p = plan(gemRow);
    expect(p.mode).toBe("search");
    if (p.mode !== "search") return;
    expect(p.body).toEqual({
      query: {
        status: { option: "securable" },
        type: "Powered by Verisium",
        stats: [{ type: "and", filters: [] }],
        filters: {
          type_filters: { filters: { category: { option: "gem" }, quality: { max: 0 } } },
          misc_filters: { filters: { corrupted: { option: "false" }, gem_level: { min: 20, max: 20 } } },
        },
      },
      sort: { price: "asc" },
    });
    // 錄製時送出的就是這份 body(交易站接受、回來的 10 筆全是等級 20、無品質、未汙染)
    expect(p.body).toEqual(fixture("search-powered-by-verisium-l20.json")._meta.request);
    expect(p.levelAny).toBe(false);
    expect(p.filters).toEqual([
      { id: "realm", value: "intl" },
      { id: "league", value: LEAGUE },
      { id: "mode", value: "search" },
      { id: "type", value: "Powered by Verisium" },
      { id: "category", value: "gem" },
      { id: "gem_level", value: 20 },
      { id: "corrupted", value: false },
      { id: "quality", value: 0 },
      { id: "status", value: "securable" },
    ]);
    expect(p.webUrl.startsWith("https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur?q=")).toBe(true);
    expect(JSON.parse(decodeURIComponent(p.webUrl.split("?q=")[1]))).toEqual(p.body);
  });

  it("台服送繁中名、網址是 pathofexile.tw;英文客戶端 + 國際服送英文名", () => {
    const tw = plan(gemRow, TW);
    expect(tw.mode === "search" && tw.body.query.type).toBe("維里西姆強化");
    expect(tw.filters.find((f) => f.id === "type")).toEqual({ id: "type", value: "維里西姆強化" });
    expect(tw.webUrl.startsWith("https://pathofexile.tw/trade2/search/poe2/")).toBe(true);
    const en = plan({ ...gemRow, name: "Powered by Verisium" }, { ...INTL, language: "en" });
    expect(en.mode === "search" && en.body.query.type).toBe("Powered by Verisium");
    // 同一組篩選不同區服 → 快取鍵不同
    expect(tw.key).not.toBe(plan(gemRow).key);
  });

  it("技能 / 輔助(面板沒寫等級):不帶 gem_level、標 levelAny,其他篩選相同", () => {
    for (const kind of ["skill", "support"] as const) {
      const p = plan({ kind, refName: "Repulsion", name: "排斥" });
      expect(p.levelAny).toBe(true);
      if (p.mode !== "search") throw new Error("mode");
      expect(p.body.query.filters.misc_filters).toEqual({ filters: { corrupted: { option: "false" } } });
      expect(p.body.query.filters.type_filters).toEqual({ filters: { category: { option: "gem" }, quality: { max: 0 } } });
      expect(p.filters.map((f) => f.id)).toEqual(["realm", "league", "mode", "type", "category", "gem_level_any", "corrupted", "quality", "status"]);
    }
  });

  it("物品有 tradeTag → bulk exchange(want = tag、have = 崇高石 / 神聖石、online)", () => {
    const p = plan({ kind: "item", refName: "Thaumaturgic Flux (Level 18)", name: "奇術熔劑（等級18）", level: 18, tradeTag: "thaumaturgic-flux-18" });
    expect(p.mode).toBe("bulk");
    if (p.mode !== "bulk") return;
    expect([p.want, p.have]).toEqual(["thaumaturgic-flux-18", ["exalted", "divine"]]);
    expect(p.filters).toEqual([
      { id: "realm", value: "intl" },
      { id: "league", value: LEAGUE },
      { id: "mode", value: "bulk" },
      { id: "want", value: "thaumaturgic-flux-18" },
      { id: "have", value: ["exalted", "divine"] },
      { id: "status", value: "online" },
    ]);
    expect(p.webUrl.startsWith("https://www.pathofexile.com/trade2/exchange/poe2/Runes%20of%20Aldur?q=")).toBe(true);
  });

  it("物品沒有 tradeTag → search 只用 type,不加寶石篩選", () => {
    const p = plan({ kind: "item", refName: "Some Item", name: "某物品" });
    if (p.mode !== "search") throw new Error("mode");
    expect(p.body.query.filters).toEqual({});
    expect(p.filters.map((f) => f.id)).toEqual(["realm", "league", "mode", "type", "status"]);
  });

  it("不可查:配方泛稱、重名、對不上、面板外、台服缺繁中名", () => {
    expect(runeTradeUnavailable({ kind: "recipe", refName: "Verisium Pile" })).toBe("recipe");
    expect(runeTradeUnavailable({ kind: "item", ambiguous: ["A", "B"] })).toBe("ambiguous");
    expect(runeTradeUnavailable({ kind: "item" })).toBe("no-ref");
    expect(runeTradeUnavailable({ ...gemRow, offPanel: true })).toBe("off-panel");
    expect(runeTradeUnavailable({ kind: "gem", refName: "X" }, TW)).toBe("no-name");
    expect(runeTradeUnavailable({ kind: "gem", refName: "X" }, INTL)).toBeNull();
    expect(planRuneTradeQuery({ kind: "recipe", refName: "Verisium Pile" }, INTL)).toEqual({ ok: false, reason: "recipe" });
  });

  it("真實列(items.ndjson 繁中)→ 名稱 / tradeTag 帶到列上,再組查詢", () => {
    const rows = matchRunesRows([
      { text: "技能等級 20：維里西姆強化", x: 100, y: 10, w: 200, h: 20 },
      { text: "1x 奇術熔劑（等級18）", x: 100, y: 60, w: 200, h: 20 },
    ]);
    expect(rows.map((r) => [r.kind, r.refName, r.name, r.level, r.tradeTag ?? null])).toEqual([
      ["gem", "Powered by Verisium", "維里西姆強化", 20, null],
      ["item", "Thaumaturgic Flux (Level 18)", "奇術熔劑（等級18）", 18, "thaumaturgic-flux-18"],
    ]);
    expect(plan(rows[0]).key).toBe(plan(gemRow).key);
    expect(plan(rows[1], TW).mode).toBe("bulk");
  });
});

describe("執行(錄製回應回放)", () => {
  it("search → fetch 前 10 筆:打對端點、送 plan 的 body、價格照順序", async () => {
    const log: Recorded[] = [];
    const p = plan(gemRow);
    const raw = await executeRuneTradePlan(ctxOf(recordedHttp(log)), p, () => 1000);
    const search = fixture("search-powered-by-verisium-l20.json");
    expect(log[0].url).toBe("https://www.pathofexile.com/api/trade2/search/Runes%20of%20Aldur");
    expect(JSON.parse(log[0].init!.body!)).toEqual(p.mode === "search" ? p.body : null);
    expect(log[1].url).toBe(`https://www.pathofexile.com/api/trade2/fetch/${search.result.slice(0, 10).join(",")}?query=${search.id}`);
    expect(log).toHaveLength(2);
    expect(raw.total).toBe(379);
    expect(raw.listings.map((l) => `${l.amount} ${l.currency}`)).toEqual([
      "30 exalted", "70 exalted", "70 exalted", "75 exalted", "80 exalted", "80 exalted", "80 exalted", "80 exalted", "80 exalted", "199 exalted",
    ]);
    expect(raw.webUrl).toBe(`https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur/${search.id}`);
    expect(raw.at).toBe(1000);
    expect(summarizeRuneTrade(raw.listings, (a, c) => (c === "exalted" ? a : undefined))).toEqual({
      unit: "exalted", converted: true, count: 10, median: 80, min: 30, max: 199, few: false, skipped: 0,
    });
  });

  it("bulk:have 分開算、單價 = exchange / item 數量;網頁開到同一個 exchange id", async () => {
    const log: Recorded[] = [];
    const p = plan({ kind: "item", refName: "Thaumaturgic Flux (Level 18)", name: "奇術熔劑（等級18）", tradeTag: "thaumaturgic-flux-18" });
    const raw = await executeRuneTradePlan(ctxOf(recordedHttp(log)), p);
    expect(log.map((l) => l.url)).toEqual(["https://www.pathofexile.com/api/trade2/exchange/Runes%20of%20Aldur"]);
    expect(JSON.parse(log[0].init!.body!)).toEqual(fixture("exchange-thaumaturgic-flux-18.json")._meta.request);
    expect(raw.listings.map((l) => `${l.amount} ${l.currency}`)).toEqual([
      "1 exalted", "1 exalted", "50 exalted", "1 divine", "1 divine", "1 divine", "10 divine", "50 divine",
    ]);
    expect(raw.total).toBe(8);
    expect(raw.webUrl).toBe(`https://www.pathofexile.com/trade2/exchange/poe2/Runes%20of%20Aldur/${fixture("exchange-thaumaturgic-flux-18.json").id}`);
    // 國際服換成崇高石(1 div = 600 ex)→ 8 筆偶數取中間兩筆平均
    const toEx = (a: number, c: string) => (c === "exalted" ? a : c === "divine" ? a * 600 : undefined);
    expect(summarizeRuneTrade(raw.listings, toEx)).toMatchObject({ converted: true, count: 8, median: 600, min: 1, max: 30000 });
    // 台服沒有匯率:取筆數最多的幣別(神聖石 5 筆),崇高石 3 筆不計
    expect(summarizeRuneTrade(raw.listings)).toEqual({ unit: "divine", converted: false, count: 5, median: 1, min: 1, max: 50, few: false, skipped: 3 });
  });

  it("台服打 pathofexile.tw", async () => {
    const log: Recorded[] = [];
    await executeRuneTradePlan(ctxOf(recordedHttp(log), "tw"), plan(gemRow, TW));
    expect(log[0].url).toBe("https://pathofexile.tw/api/trade2/search/Runes%20of%20Aldur");
    expect(JSON.parse(log[0].init!.body!).query.type).toBe("維里西姆強化");
  });
});

describe("中位數與筆數規則(summarizeRuneTrade)", () => {
  const ex = (...xs: number[]) => xs.map((amount) => ({ amount, currency: "exalted" }));
  const id = (a: number, c: string) => (c === "exalted" ? a : undefined);
  it("少於 3 筆不給中位數(few),只給最低 / 最高", () => {
    expect(summarizeRuneTrade(ex(5, 9), id)).toEqual({ unit: "exalted", converted: true, count: 2, min: 5, max: 9, few: true, skipped: 0 });
    expect(summarizeRuneTrade([], id)).toEqual({ unit: "exalted", converted: false, count: 0, few: true, skipped: 0 });
  });
  it("3 筆起給中位數;只取前 10 筆", () => {
    expect(summarizeRuneTrade(ex(3, 1, 2), id).median).toBe(2);
    expect(summarizeRuneTrade(ex(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1000, 1000), id)).toMatchObject({ count: 10, median: 5.5, max: 10 });
  });
  it("換算不了的幣別記 skipped;全部換不了 → 原幣", () => {
    const mixed = [...ex(1, 2, 3), { amount: 1, currency: "annul" }];
    expect(summarizeRuneTrade(mixed, id)).toMatchObject({ converted: true, count: 3, skipped: 1 });
    expect(summarizeRuneTrade([{ amount: 4, currency: "chaos" }, { amount: 6, currency: "chaos" }], id)).toMatchObject({ unit: "chaos", converted: false, count: 2 });
  });
});

describe("429 偵測(withRuneTrade429)", () => {
  it("佇列自己的請求收到 429 → RuneTradeRateLimitedError 帶 Retry-After 秒數(沒給 = 60);其他狀態原樣回傳", async () => {
    const h429 = (headers: Record<string, string>): HttpFetch => async () => ({ ...response(429, {}), headers: new Headers(headers) });
    const e = await withRuneTrade429(h429({ "retry-after": "12" }))("u").catch((x) => x);
    expect(e).toBeInstanceOf(RuneTradeRateLimitedError);
    expect(e.seconds).toBe(12);
    expect((await withRuneTrade429(h429({}))("u").catch((x) => x)).seconds).toBe(60);
    // 真的 executeRuneTradePlan:search 就 429 → 丟出,不 fetch
    const log: Recorded[] = [];
    const http: HttpFetch = async (url, init) => { log.push({ url, init: init as Recorded["init"] }); return { ...response(429, {}), headers: new Headers({ "retry-after": "30" }) }; };
    const err = await executeRuneTradePlan(ctxOf(withRuneTrade429(http)), plan(gemRow)).catch((x) => x);
    expect(err).toBeInstanceOf(RuneTradeRateLimitedError);
    expect(log).toHaveLength(1);
    const ok = await withRuneTrade429(recordedHttp([]))("https://www.pathofexile.com/api/trade2/search/x");
    expect(ok.status).toBe(200);
  });
});

/** 假時鐘 + 假計時器(setTimer / clearTimer 注入佇列);advance 依序觸發到期的計時器,每次觸發後讓 promise 跑完 */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers: Array<{ at: number; id: number; fn: () => void }> = [];
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; timers.push({ at: t + ms, id, fn }); return id; },
    clearTimer: (id: unknown) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    flush,
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        t = next.at;
        next.fn();
        await flush();
      }
      t = end;
      await flush();
    },
    get timers() { return timers.length; },
  };
}

describe("自動查詢佇列(createRuneTradeQueue)", () => {
  const skillRow: RuneTradeRowInput = { kind: "skill", refName: "Repulsion", name: "排斥" };
  const supportRow: RuneTradeRowInput = { kind: "support", refName: "Concussive Runes", name: "震盪符文" };
  const rawOf = (key: string, at: number): RuneTradeRaw => ({ key, mode: "search", total: 1, listings: [{ amount: 5, currency: "exalted" }], webUrl: "u", at });

  /** 假 exec:每筆都掛起,測試手動 resolve / reject */
  function manualExec() {
    const calls: Array<{ key: string; resolve: () => void; reject: (e: unknown) => void }> = [];
    const exec: RuneTradeQueueDeps["exec"] = (_c, p, now) =>
      new Promise<RuneTradeRaw>((resolve, reject) => { calls.push({ key: p.key, resolve: () => resolve(rawOf(p.key, now())), reject }); });
    return { calls, exec };
  }
  function setup(over: Partial<RuneTradeQueueDeps> = {}) {
    const clock = fakeClock();
    const m = manualExec();
    const logs: string[] = [];
    const changes: Array<[string, string | undefined]> = [];
    const q = createRuneTradeQueue({
      now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      ctx: () => ctxOf(recordedHttp([])),
      exec: m.exec,
      waitMs: () => 0,
      log: (s) => logs.push(s),
      onChange: (k, e) => changes.push([k, e?.state]),
      ...over,
    });
    return { clock, q, calls: m.calls, logs, changes };
  }

  it("單一佇列、同時一筆:依排入順序一筆做完才送下一筆", async () => {
    const { clock, q, calls } = setup();
    const [a, b, c] = [plan(gemRow), plan(skillRow), plan(supportRow)];
    expect([q.enqueue(a), q.enqueue(b), q.enqueue(c)]).toEqual([true, true, true]);
    expect(calls.map((x) => x.key)).toEqual([a.key]);
    expect([q.entry(a.key)?.state, q.entry(b.key)?.state, q.entry(c.key)?.state]).toEqual(["loading", "queued", "queued"]);
    expect(q.busy).toBe(true);
    calls[0].resolve();
    await clock.flush();
    expect(q.entry(a.key)?.state).toBe("done");
    expect(calls.map((x) => x.key)).toEqual([a.key, b.key]);
    calls[1].resolve();
    await clock.flush();
    calls[2].resolve();
    await clock.flush();
    expect(calls).toHaveLength(3);
    expect(q.busy).toBe(false);
    expect(q.pending).toBe(0);
  });

  it("重複出現的列不重排;快取 30 分鐘內命中不重送,過期才重查", async () => {
    const { clock, q, calls } = setup();
    const a = plan(gemRow);
    expect(q.enqueue(a)).toBe(true);
    expect(q.enqueue(a)).toBe(false); // 查詢中
    const b = plan(skillRow);
    expect(q.enqueue(b)).toBe(true);
    expect(q.enqueue(b)).toBe(false); // 排隊中
    expect(q.pending).toBe(1);
    calls[0].resolve();
    await clock.flush();
    calls[1].resolve();
    await clock.flush();
    expect(q.enqueue(a)).toBe(false); // 30 分鐘內有結果
    expect(q.entry(a.key)).toMatchObject({ state: "done", cached: false });
    await clock.advance(RUNE_TRADE_CACHE_MS - 1);
    expect(q.enqueue(a)).toBe(false);
    expect(calls).toHaveLength(2);
    await clock.advance(1);
    expect(q.enqueue(a)).toBe(true); // 過期 → 重查
    expect(calls).toHaveLength(3);
  });

  it("送出前限流預估要等 → 延後重試(不丟錯、不送請求),等到期滿 + 餘裕才送", async () => {
    let wait = 4000;
    const { clock, q, calls } = setup({ waitMs: () => wait });
    const a = plan(gemRow);
    q.enqueue(a);
    expect(calls).toHaveLength(0);
    expect(q.entry(a.key)?.state).toBe("queued");
    wait = 0;
    await clock.advance(4000 + RUNE_TRADE_DEFER_MARGIN_MS - 1);
    expect(calls).toHaveLength(0);
    await clock.advance(1);
    expect(calls).toHaveLength(1);
  });

  it("真的限流器:第一筆 search + fetch 後,第二筆預估要等 → 不送、不進限流器的佇列(一般查價不受影響)", async () => {
    const log: Recorded[] = [];
    const { clock, q } = setup({ exec: undefined, waitMs: runeTradeWaitMs, ctx: () => ctxOf(recordedHttp(log)) });
    const a = plan(gemRow);
    const b = plan(skillRow);
    q.enqueue(a);
    q.enqueue(b);
    await clock.flush();
    expect(q.entry(a.key)?.state).toBe("done");
    expect(log.map((l) => l.url.split("/api/trade2/")[1].split("/")[0])).toEqual(["search", "fetch"]);
    expect(q.entry(b.key)?.state).toBe("queued");
    expect(runeTradeWaitMs(b, "intl", "start")).toBeGreaterThan(0);
    const { limits } = tradeSession("intl");
    for (const set of [limits.SEARCH, limits.FETCH]) for (const rl of set) expect(rl.queue.value).toBe(0);
    expect(log).toHaveLength(2);
    q.dispose();
  });

  it("fetch 前限流要等 → 延後;重試時 search 走交易層快取,總共 1 search + 1 fetch", async () => {
    const log: Recorded[] = [];
    let fetchWait = 2000;
    const { clock, q } = setup({
      exec: undefined,
      ctx: () => ctxOf(recordedHttp(log)),
      waitMs: (_p, _r, step) => (step === "fetch" ? fetchWait : 0),
    });
    const a = plan(gemRow);
    q.enqueue(a);
    await clock.flush();
    expect(log.map((l) => l.url.includes("/search/"))).toEqual([true]);
    expect(q.entry(a.key)?.state).toBe("queued");
    fetchWait = 0;
    await clock.advance(2000 + RUNE_TRADE_DEFER_MARGIN_MS);
    expect(q.entry(a.key)?.state).toBe("done");
    expect(log.map((l) => (l.url.includes("/search/") ? "search" : "fetch"))).toEqual(["search", "fetch"]);
  });

  it("收到 429 → 整個佇列暫停到 Retry-After 期滿,該筆放回隊首", async () => {
    const { clock, q, calls, logs } = setup();
    const [a, b] = [plan(gemRow), plan(skillRow)];
    q.enqueue(a);
    q.enqueue(b);
    calls[0].reject(new RuneTradeRateLimitedError(20));
    await clock.flush();
    expect(q.pausedUntil).toBe(20_000);
    expect([q.entry(a.key)?.state, q.entry(b.key)?.state]).toEqual(["queued", "queued"]);
    expect(logs.some((l) => l.includes("429"))).toBe(true);
    await clock.advance(19_999);
    expect(calls).toHaveLength(1);
    await clock.advance(1);
    expect(calls.map((x) => x.key)).toEqual([a.key, a.key]);
  });

  it("一般查價收到 429(pauseFor)→ 佇列一起暫停", async () => {
    const { clock, q, calls } = setup();
    q.pauseFor(10, "一般查價收到 429");
    q.enqueue(plan(gemRow));
    expect(calls).toHaveLength(0);
    await clock.advance(10_000);
    expect(calls).toHaveLength(1);
  });

  it("面板消失 → 清掉尚未送出的項目(查詢中那筆照跑、快取保留)", async () => {
    const { clock, q, calls, changes } = setup();
    const [a, b, c] = [plan(gemRow), plan(skillRow), plan(supportRow)];
    q.enqueue(a); q.enqueue(b); q.enqueue(c);
    expect(q.clearPending()).toBe(2);
    expect([q.entry(b.key), q.entry(c.key)]).toEqual([undefined, undefined]);
    expect(changes.filter(([, s]) => s === undefined).map(([k]) => k)).toEqual([b.key, c.key]);
    calls[0].resolve();
    await clock.flush();
    expect(calls).toHaveLength(1);
    expect(q.entry(a.key)?.state).toBe("done");
    // 面板再出現:快取命中不重送;清掉的那筆重新排入
    expect(q.enqueue(a)).toBe(false);
    expect(q.enqueue(b)).toBe(true);
    expect(calls.map((x) => x.key)).toEqual([a.key, b.key]);
  });

  it("查價面板開著(held)→ 暫停不送;解除後 kick 立刻送", async () => {
    let held: string | null = "查價面板開著";
    const { clock, q, calls, logs } = setup({ held: () => held });
    q.enqueue(plan(gemRow));
    await clock.advance(5000);
    expect(calls).toHaveLength(0);
    expect(logs.filter((l) => l.includes("暫停(查價面板開著)"))).toHaveLength(1);
    held = null;
    q.kick();
    await clock.advance(0);
    expect(calls).toHaveLength(1);
  });

  it("其他錯誤 → failed;5 分鐘內同一組篩選不再自動排入", async () => {
    const { clock, q, calls } = setup();
    const a = plan(gemRow);
    q.enqueue(a);
    calls[0].reject(new Error("boom"));
    await clock.flush();
    expect(q.entry(a.key)).toMatchObject({ state: "failed", message: "boom" });
    expect(q.enqueue(a)).toBe(false);
    await clock.advance(RUNE_TRADE_FAIL_RETRY_MS);
    expect(q.enqueue(a)).toBe(true);
  });

  it("過期清除:done 超過 30 分鐘、failed 超過 5 分鐘,下次排入時順手清掉(通知 undefined),TTL 語意不變", async () => {
    const { clock, q, calls, changes } = setup();
    const a = plan(gemRow);
    const b = plan(skillRow);
    q.enqueue(a);
    calls[0].resolve();
    await clock.flush();
    q.enqueue(b);
    calls[1].reject(new Error("boom"));
    await clock.flush();
    await clock.advance(RUNE_TRADE_FAIL_RETRY_MS);
    const c = plan(supportRow);
    q.enqueue(c);
    expect(q.entry(b.key)).toBeUndefined(); // failed 已過重試間隔
    expect(q.entry(a.key)?.state).toBe("done"); // done 還在 TTL 內
    await clock.advance(RUNE_TRADE_CACHE_MS - RUNE_TRADE_FAIL_RETRY_MS);
    q.enqueue(plan({ kind: "skill", refName: "Other", name: "其他" }));
    expect(q.entry(a.key)).toBeUndefined();
    expect(changes.filter(([k, s2]) => k === a.key && s2 === undefined)).toHaveLength(1);
  });

  it("筆數上限:超過時淘汰最舊的已完成項目,排隊中 / 查詢中的不被淘汰", async () => {
    const { clock, q, calls } = setup();
    const mk = (i: number): RuneTradePlan => ({ ...plan(gemRow), key: `k${i}` });
    const N = RUNE_TRADE_MAX_ENTRIES;
    // 先做完 N 筆(每筆時間戳遞增)
    for (let i = 0; i < N; i++) {
      q.enqueue(mk(i));
      calls[calls.length - 1].resolve();
      await clock.advance(1);
    }
    // 再排入一筆(查詢中)與一筆(排隊中),總數超過上限
    q.enqueue(mk(N));
    q.enqueue(mk(N + 1));
    q.enqueue(mk(N + 2));
    expect(q.entry(`k${N}`)?.state).toBe("loading");
    expect(q.entry(`k${N + 1}`)?.state).toBe("queued");
    expect(q.entry(`k${N + 2}`)?.state).toBe("queued");
    // 最舊的已完成項目被淘汰,較新的還在
    expect(q.entry("k0")).toBeUndefined();
    expect(q.entry("k1")).toBeUndefined();
    expect(q.entry("k2")?.state).toBe("done"); // 每次排入前才清,各清到剛好回到上限
    expect(q.entry(`k${N - 1}`)?.state).toBe("done");
  });

  it("全部都在排隊 / 查詢中時超過上限也不淘汰任何一筆", () => {
    const { q } = setup();
    const N = RUNE_TRADE_MAX_ENTRIES + 20;
    for (let i = 0; i < N; i++) q.enqueue({ ...plan(gemRow), key: `p${i}` });
    for (let i = 0; i < N; i++) expect(q.entry(`p${i}`)).toBeDefined();
  });
});
