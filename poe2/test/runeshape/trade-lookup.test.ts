/**
 * exile-appraiser:符文塑形「點選無 ninja 價的列 → 查交易站」(poe2/src/runeshape/trade-lookup.ts;docs/runeshape.md「點選查交易站」)。
 * - 查詢組法:gem 有 / 無等級、support、item bulk / search、不可查類型;intl 送英文名、tw 送繁中名;篩選清單(給 UI 顯示)。
 * - 執行:錄製的真實交易站回應(fixtures/trade/,2026-09-30 intl 各打一次,已剝帳號 / 角色名 / 密語)經離線 HttpFetch 回放。
 * - 中位數與筆數規則、原幣 / 換算、本地快取 30 分鐘、同時一筆、限流不排隊。
 * 沒有任何真實網路請求。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HttpFetch, HttpResponse } from "@exile-appraiser/core/http";
import type { TradeContext } from "@exile-appraiser/core/games/adapter";
import { init } from "@/assets/data";
import { resetTradeSessions } from "@/web/price-check/trade/common";
import { matchRunesRows } from "@/runeshape/match";
import {
  RUNE_TRADE_CACHE_MS,
  createRuneTradeStore,
  executeRuneTradePlan,
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

describe("本地快取與限流(createRuneTradeStore)", () => {
  const rawOf = (key: string, at: number) => ({ key, mode: "search" as const, total: 1, listings: [], webUrl: "u", at });

  it("同一組篩選 30 分鐘內不重查,過期才重查", async () => {
    let t = 0;
    let calls = 0;
    const store = createRuneTradeStore({ now: () => t, exec: async (_c, p, now) => { calls++; return rawOf(p.key, now ? now() : 0); } });
    const p = plan(gemRow);
    const ctx = ctxOf(recordedHttp([]));
    expect(await store.lookup(p, ctx)).toMatchObject({ ok: true, cached: false });
    t = RUNE_TRADE_CACHE_MS - 1;
    expect(await store.lookup(p, ctx)).toMatchObject({ ok: true, cached: true });
    expect(store.cached(p.key)).toBeDefined();
    t = RUNE_TRADE_CACHE_MS;
    expect(store.cached(p.key)).toBeUndefined();
    expect(await store.lookup(p, ctx)).toMatchObject({ ok: true, cached: false });
    expect(calls).toBe(2);
  });

  it("同時只跑一筆:進行中再點另一列 → busy(不排隊)", async () => {
    let release!: () => void;
    const store = createRuneTradeStore({ exec: (_c, p) => new Promise((r) => { release = () => r(rawOf(p.key, 0)); }) });
    const ctx = ctxOf(recordedHttp([]));
    const first = store.lookup(plan(gemRow), ctx);
    expect(store.busy).toBe(true);
    expect(await store.lookup(plan({ kind: "skill", refName: "Repulsion", name: "排斥" }), ctx)).toEqual({ ok: false, error: "busy" });
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(store.busy).toBe(false);
  });

  it("限流預估要等 → rate-limited 帶秒數(真的限流器:連續兩筆不同搜尋,第二筆不排隊直接拒絕)", async () => {
    const log: Recorded[] = [];
    const store = createRuneTradeStore();
    const ctx = ctxOf(recordedHttp(log));
    expect(await store.lookup(plan(gemRow), ctx)).toMatchObject({ ok: true });
    const second = await store.lookup(plan({ kind: "skill", refName: "Repulsion", name: "排斥" }), ctx);
    expect(second).toMatchObject({ ok: false, error: "rate-limited" });
    expect(second.ok === false && second.error === "rate-limited" && second.seconds).toBeGreaterThan(0);
    // 第二筆沒有送出任何請求
    expect(log).toHaveLength(2);
  });

  it("其他錯誤 → failed 帶訊息", async () => {
    const store = createRuneTradeStore({ exec: async () => { throw new Error("boom"); } });
    expect(await store.lookup(plan(gemRow), ctxOf(recordedHttp([])))).toEqual({ ok: false, error: "failed", message: "boom" });
    expect(store.busy).toBe(false);
  });
});
