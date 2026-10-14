// P2(查價面板 B 改版):PoE2 掛單原幣 → divine 換算(與結果列 normalizedPrice 同一條查價路徑,不四捨五入)
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { init } from "@/assets/data";
import { setPriceSource, type PriceSource } from "@/web/background/Prices";
import { poe2HeroConverters } from "@/web/price-check/price-hero-adapter";
import { setupTests } from "../../vitest.setup";

const DIV_C = 100; // 1 divine = 100 chaos
const EX_C = 0.2; // 1 exalted = 0.2 chaos → 1 div = 500 ex

function fakeSource(): PriceSource {
  const byRef: Record<string, number> = { "Divine Orb": 1, "Exalted Orb": EX_C / DIV_C };
  return {
    revision: () => "poe2|x|1",
    rates: () => ({ divineRate: DIV_C, exaltedRate: EX_C }),
    find: (q) =>
      byRef[q.name] != null
        ? { primaryValue: byRef[q.name], sparkline: { totalChange: 0, data: [] }, detailsId: "", url: "", cx: true }
        : null,
    queuePricesFetch: () => {},
    initialLoading: () => false,
  };
}

beforeAll(async () => {
  setupTests({ language: "en" });
  await init("en");
});
afterEach(() => setPriceSource(undefined));

describe("poe2HeroConverters", () => {
  it("沒有價格表(台服 / 沒注入)→ 不給換算器", () => {
    expect(poe2HeroConverters().toBase).toBeUndefined();
  });
  it("崇高石 / 神聖石掛單換成 divine;查不到的幣別 → undefined", () => {
    setPriceSource(fakeSource());
    const { toBase } = poe2HeroConverters();
    expect(toBase!(250, "exalted")).toBeCloseTo(0.5);
    expect(toBase!(2, "divine")).toBe(2);
    expect(toBase!(1, "no-such-currency")).toBeUndefined();
  });
  it("顯示:≥ 1 div 用神聖石,否則崇高石", () => {
    setPriceSource(fakeSource());
    const { show } = poe2HeroConverters();
    expect(show(2)).toEqual({ amount: 2, unit: "div" });
    expect(show(0.5).unit).toBe("exalted");
    expect(show(0.5).amount).toBeCloseTo(250);
  });
});
