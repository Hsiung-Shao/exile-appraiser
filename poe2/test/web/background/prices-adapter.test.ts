/**
 * 第 24 步:`web/background/Prices.ts`(上游 usePoeninja 介面的轉接殼)。
 * 價格源 = 錄製的 poe.ninja PoE2 exchange 回應(core/test/recordings/ninja/poe2,Forbidden Rites)→ core 快照 →
 * 與 renderer `poe2-price-source.ts` 相同的 divine 換算;不打網路。
 * 沒注入價格源(其他所有 PoE2 測試、CLI)= 第 24 步之前的「沒有價格」行為,這裡也守著。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNinjaClient,
  lookupPrice,
  toSnapshot,
  type NinjaSnapshot,
} from "@exile-appraiser/core/ninja";
import type { HttpFetch, HttpResponse } from "@exile-appraiser/core/http";
import { init } from "@/assets/data";
import {
  setPriceSource,
  usePoeninja,
  type PriceSource,
} from "@/web/background/Prices";
import { requestResults } from "@/web/price-check/trade/pathofexile-trade";
import { resetTradeSessions } from "@/web/price-check/trade/common";
import { setupTests } from "../../vitest.setup";

const REC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../core/test/recordings/ninja/poe2",
);
const C_PER_DIV = 9.61;
const EX_PER_DIV = 610.9;

function res(body: string, status = 200): HttpResponse {
  return {
    ok: status === 200,
    status,
    headers: new Headers(),
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

let snap: NinjaSnapshot;

/** 與 renderer/src/web/background/poe2-price-source.ts 相同的換算(chaos → divine) */
function sourceOf(s: NinjaSnapshot, revision = "poe2|Forbidden Rites|1"): PriceSource {
  return {
    revision: () => revision,
    rates: () => ({ divineRate: s.divineRate, exaltedRate: s.exaltedRate }),
    find(query) {
      const hit = lookupPrice(s, query);
      if (!hit) return null;
      return {
        primaryValue: hit.entry.c / s.divineRate!,
        ...(hit.entry.v !== undefined ? { volumePrimaryValue: hit.entry.v / s.divineRate! } : {}),
        maxVolumeCurrency: hit.entry.mv,
        sparkline: { totalChange: hit.entry.sc ?? 0, data: [...(hit.entry.s ?? [])] },
        detailsId: hit.entry.id ?? "",
        url: "https://poe.ninja/poe2/economy/x/" + (hit.entry.id ?? ""),
        cx: hit.key.startsWith("currency|"),
      };
    },
    queuePricesFetch: () => {},
    initialLoading: () => false,
  };
}

beforeAll(async () => {
  setupTests({ language: "en" });
  await init("en");
  const http: HttpFetch = async (url) => {
    const file = path.join(REC, "exchange_" + new URL(url).searchParams.get("type") + ".json");
    return fs.existsSync(file) ? res(fs.readFileSync(file, "utf8")) : res("", 404);
  };
  const client = createNinjaClient({ http, game: "poe2", league: "Forbidden Rites", sleep: async () => {}, now: () => 1 });
  snap = toSnapshot(await client.fetchAll({ exchange: ["Currency", "Runes"], item: [] }));
});

afterEach(() => {
  setPriceSource(undefined);
  resetTradeSessions();
});

describe("沒有價格源 = 第 24 步之前的「沒有價格」", () => {
  it("findPriceByQuery null、cachedCurrencyByQuery undefined、匯率 undefined、autoCurrency 原值標 exalted", () => {
    const n = usePoeninja();
    expect(n.findPriceByQuery({ ns: "ITEM", name: "Divine Orb" })).toBeNull();
    expect(n.cachedCurrencyByQuery({ ns: "ITEM", name: "Chaos Orb" }, 4)).toBeUndefined();
    expect(n.xchgRate.value).toBeUndefined();
    expect(n.xchgRateCurrency.value).toBeUndefined();
    expect(n.availableCoreCurrencies.value).toEqual([]);
    expect(n.autoCurrency(3)).toEqual({ min: 3, max: 3, currency: "exalted" });
    expect(n.autoCurrency([1, 2])).toEqual({ min: 1, max: 2, currency: "exalted" });
    expect(n.subtractPrice({ min: 5, max: 5, currency: "exalted" }, { min: 2, max: 2, currency: "exalted" }))
      .toEqual({ min: 3, max: 3, currency: "exalted" });
    expect(n.initialLoading()).toBe(false);
  });
});

describe("有價格源(錄製快照)", () => {
  it("匯率:1 div = 610.9 ex;核心通貨 = 崇高石(本地名稱、ex)", () => {
    setPriceSource(sourceOf(snap));
    const n = usePoeninja();
    expect(n.xchgRate.value).toBeCloseTo(EX_PER_DIV, 9);
    expect(n.xchgRateCurrency.value).toMatchObject({ id: "exalted", abbrev: "ex", ref: "Exalted Orb", text: "Exalted Orb" });
    expect(n.availableCoreCurrencies.value.map((c) => c.id)).toEqual(["exalted"]);
  });

  it("findPriceByQuery:divine 計價 + 走勢 / 成交量 / cx(上游 PriceTrend 的欄位)", () => {
    setPriceSource(sourceOf(snap));
    const e = usePoeninja().findPriceByQuery({ ns: "ITEM", name: "Aldur's Legacy" })!;
    expect(e.primaryValue).toBeCloseTo(385.3, 9);
    expect(e.volumePrimaryValue).toBeCloseTo(13228, 3);
    expect(e).toMatchObject({ maxVolumeCurrency: "divine", cx: true, sparkline: { totalChange: 15.12 } });
  });

  it("autoCurrency:< 1 div 崇高石、≥ 1 div 神聖石;coreOnly(查 Divine Orb 本身)維持崇高石", () => {
    setPriceSource(sourceOf(snap));
    const n = usePoeninja();
    const half = n.autoCurrency(0.5);
    expect(half.currency).toBe("exalted");
    expect(half.min).toBeCloseTo(305.45, 6);
    const big = n.autoCurrency(7.5);
    expect(big.currency).toBe("div");
    expect(big.min).toBeCloseTo(7.5, 9);
    const div = n.autoCurrency(1, true);
    expect(div.currency).toBe("exalted");
    expect(div.min).toBeCloseTo(EX_PER_DIV, 6);
  });

  it("cachedCurrencyByQuery:數量 × 單價換單位;價格表版本變了就清快取", () => {
    setPriceSource(sourceOf(snap, "r1"));
    const n = usePoeninja();
    const four = n.cachedCurrencyByQuery({ ns: "ITEM", name: "Chaos Orb" }, 4)!;
    expect(four.currency).toBe("exalted");
    expect(four.min).toBeCloseTo((4 / C_PER_DIV) * EX_PER_DIV, 6);
    // 換一份價格表(Chaos Orb 漲一倍,4 c → 8 c 仍 < 1 div):同一版本號 → 沿用快取;新版本號 → 重算
    const doubled: NinjaSnapshot = { ...snap, prices: { ...snap.prices, "currency|Chaos Orb": { ...snap.prices["currency|Chaos Orb"], c: 2 } } };
    setPriceSource(sourceOf(doubled, "r1"));
    expect(n.cachedCurrencyByQuery({ ns: "ITEM", name: "Chaos Orb" }, 4)!.min).toBeCloseTo(four.min, 9);
    setPriceSource(sourceOf(doubled, "r2"));
    expect(n.cachedCurrencyByQuery({ ns: "ITEM", name: "Chaos Orb" }, 4)!.min).toBeCloseTo(four.min * 2, 6);
  });

  it("區間運算先換成 divine(上游 toDivine):崇高石 / 神聖石 / 混沌石可比較", () => {
    setPriceSource(sourceOf(snap));
    const n = usePoeninja();
    const oneDivInEx = { min: EX_PER_DIV, max: EX_PER_DIV, currency: "exalted" as const };
    expect(n.comparePrice(oneDivInEx, "<", { min: 1.5, max: 1.5, currency: "div" })).toBe(true);
    expect(n.comparePrice({ min: C_PER_DIV * 2, max: C_PER_DIV * 2, currency: "chaos" }, ">", { min: 1.5, max: 1.5, currency: "div" })).toBe(true);
    const profit = n.subtractPrice({ min: 3, max: 3, currency: "div" }, oneDivInEx);
    expect(profit.currency).toBe("div");
    expect(profit.min).toBeCloseTo(2, 9);
  });

  it("requestResults:換算價(normalizedPrice)以崇高石標示;沒有價格源時維持 undefined", async () => {
    const body = (currency: string, amount: number) => JSON.stringify({
      result: [{
        id: "a",
        item: { ilvl: 80, name: "", typeLine: "Kamasan Tiara", baseType: "Kamasan Tiara" },
        listing: { indexed: new Date().toISOString(), price: { amount, currency, type: "~price" }, account: { name: "s", lastCharacterName: "S", online: {} } },
      }],
    });
    const ctx = (currency: string, amount: number) => ({
      http: (async () => res(body(currency, amount))) as HttpFetch,
      realm: "intl" as const, latencySeconds: 0, accountName: "",
    });
    const [plain] = await requestResults(ctx("chaos", 5), "q", ["a"]);
    expect(plain.normalizedPrice).toBeUndefined();
    resetTradeSessions();
    setPriceSource(sourceOf(snap));
    const [chaos] = await requestResults(ctx("chaos", 5), "q", ["a"]);
    // 5 c = 5 / 9.61 div = 317.85 ex → displayRounding 四捨五入
    expect(chaos.normalizedPrice).toBe(String(Math.round((5 / C_PER_DIV) * EX_PER_DIV)));
    expect(chaos.normalizedPriceCurrency).toMatchObject({ id: "exalted", abbrev: "ex" });
  });
});
