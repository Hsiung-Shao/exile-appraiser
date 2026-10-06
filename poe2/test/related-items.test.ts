/**
 * 查價面板旁的「相關物品」(EE2 RelatedItems.vue → core `games/related-items.ts`)。
 * 真實 `data/poe2/item-drop.json` + 物品資料;價格走轉接殼 `usePoeninja()`(與 RelatedItems.vue 同一條路),價格源是假的(不連網)。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  findRelatedItem,
  relatedItemPrices,
  relatedQueryId,
  type RelatedDeps,
} from "@exile-appraiser/core/games/related-items";
import { init, ITEM_BY_REF, ITEM_DROP } from "@/assets/data";
import { setPriceSource, usePoeninja, type CurrencyValue, type PriceSource } from "@/web/background/Prices";
import { getDetailsId } from "@/web/price-check/trends/getDetailsId";
import { parseClipboard } from "@/parser";
import { setupTests } from "./vitest.setup";

const itemByRef: RelatedDeps<unknown>["itemByRef"] = (ns, name) =>
  ITEM_BY_REF(ns as Parameters<typeof ITEM_BY_REF>[0], name);

/** 與 RelatedItems.vue 相同的組法 */
function componentDeps(): RelatedDeps<CurrencyValue> {
  const { findPriceByQuery, autoCurrency, ITEM_DROP: drops } = usePoeninja();
  return {
    drops: drops.value,
    itemByRef,
    priceOf: (q) => {
      const e = findPriceByQuery(q);
      return e ? autoCurrency(e.primaryValue) : undefined;
    },
  };
}

/** 假價格源:只有 Primary Calamity Fragment 有價(0.5 divine);1 div = 400 chaos、1 ex = 1 chaos */
const fakeSource: PriceSource = {
  revision: () => "poe2|test|1",
  rates: () => ({ divineRate: 400, exaltedRate: 1 }),
  find: (q) =>
    q.ns === "ITEM" && q.name === "Primary Calamity Fragment"
      ? { primaryValue: 0.5, sparkline: { totalChange: 0, data: [] }, detailsId: "x", url: "", cx: true }
      : null,
  queuePricesFetch: () => {},
  initialLoading: () => false,
};

beforeAll(async () => {
  setupTests({ language: "en" });
  await init("en");
});

afterEach(() => {
  setPriceSource(undefined);
});

describe("轉接殼 ITEM_DROP", () => {
  it("usePoeninja().ITEM_DROP = 已載入的 item-drop.json(原本是寫死的空陣列)", () => {
    expect(usePoeninja().ITEM_DROP.value).toBe(ITEM_DROP);
    expect(ITEM_DROP.length).toBe(115);
  });
});

describe("PoE2 真實資料", () => {
  it("Primary Calamity Fragment:同組三片、自己高亮、可換物品(寶石 / 鑰匙 / 傳奇)", () => {
    const out = relatedItemPrices(componentDeps(), "ITEM::Primary Calamity Fragment")!;
    expect(out.missing).toEqual([]);
    expect(out.related.map((r) => r.id)).toEqual([
      "ITEM::Primary Calamity Fragment",
      "ITEM::Secondary Calamity Fragment",
      "ITEM::Tertiary Calamity Fragment",
    ]);
    expect(out.related.filter((r) => r.highlight).map((r) => r.id)).toEqual(["ITEM::Primary Calamity Fragment"]);
    expect(out.items.map((i) => i.id)).toEqual(
      expect.arrayContaining(["GEM::Arbiter's Ignition", "UNIQUE::Prism of Belief // Diamond"]),
    );
    expect(out.related[0].name).toBe("Primary Calamity Fragment");
  });

  it("沒有價格源 → 全部沒有價格(台服 / 還沒抓到;畫面顯示「?」)", () => {
    const out = relatedItemPrices(componentDeps(), "ITEM::Primary Calamity Fragment")!;
    expect([...out.related, ...out.items].every((r) => r.price === undefined)).toBe(true);
  });

  it("有價格源:primaryValue(divine)經 autoCurrency 換成顯示單位(< 1 div → 崇高石)", () => {
    setPriceSource(fakeSource);
    const out = relatedItemPrices(componentDeps(), "ITEM::Primary Calamity Fragment")!;
    expect(out.related[0].price).toEqual(usePoeninja().autoCurrency(0.5));
    expect(out.related[0].price?.currency).toBe("exalted");
    expect(out.related[1].price).toBeUndefined();
  });

  it("全量:item-drop.json 每個 id 都找得到物品(資料同步後數字變了要看過再改)", () => {
    const all = new Set(ITEM_DROP.flatMap((e) => [...e.query, ...e.items]));
    const missing = [...all].filter((id) => !findRelatedItem(itemByRef, id));
    // 已知缺口(EE2 item-drop.json 與 items.ndjson 不一致;EE2 遇到會整塊顯示 Can't find,這裡只略過這幾筆)
    expect(missing).toEqual([
      "GEM::Techrod's Revenge",
      "ITEM::Zarokh's Reliquary Key: Sandstorm Visage",
      "UNIQUE::Sekhema's Resolve // Ring",
      "ITEM::Zarokh's Reliquary Key: Sekhema's Resolve",
      "ITEM::Legacy of Edyrns Tusks",
      "UNIQUE::Edyrns Tusks // Iron Cuirass",
    ]);
  });

  it("剪貼簿物品 → getDetailsId → 對上 item-drop 組", () => {
    const text = [
      "Item Class: Pinnacle Keys",
      "Rarity: Normal",
      "Primary Calamity Fragment",
    ].join("\n");
    const parsed = parseClipboard(text);
    expect(parsed.isOk()).toBe(true);
    const id = relatedQueryId(getDetailsId(parsed._unsafeUnwrap())!);
    expect(id).toBe("ITEM::Primary Calamity Fragment");
    expect(relatedItemPrices(componentDeps(), id)?.related.length).toBe(3);
  });
});
