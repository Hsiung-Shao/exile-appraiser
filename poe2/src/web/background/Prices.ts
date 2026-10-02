/**
 * exile-appraiser: 取代上游 `web/background/Prices.ts`(poe.ninja 參考價)。
 *
 * 上游 EE2 自己抓 `api.exiledexchange2.dev` 的代理資料;本專案的價格表由 renderer 殼
 * (`renderer/src/web/background/Prices.ts`,poe.ninja exchange / item overview,快照 schema 3)統一抓取與快取,
 * 這裡只是**轉接**:renderer 在啟動時以 `setPriceSource()` 注入(`renderer/src/web/background/poe2-price-source.ts`),
 * 本檔把它包成上游 `usePoeninja()` 的介面,移植來的 .vue / `trade/pathofexile-trade.ts` 不用改。
 *
 * - 沒有注入(測試、CLI)或沒有價格表(台服、私人聯盟、還沒抓到)→ 行為與第 24 步之前的「沒有價格」實作相同:
 *   `findPriceByQuery` / `cachedCurrencyByQuery` 回 null / undefined、`xchgRate` / `xchgRateCurrency` 為 undefined、
 *   `autoCurrency` 原值標 exalted、區間運算恆等換算。
 * - 單位照上游:`primaryValue` / `volumePrimaryValue` 以 **divine** 計;`xchgRate` = 1 divine 換幾個 exalted;
 *   `autoCurrency(divine 數)` → ≥ 1 divine 標 div,否則崇高石(規則在 core `ninja/units.ts`,與符文塑形徽章相同;
 *   上游是 > 0.94 div 就換 div、0.94–1.06 顯示 1 div,這裡統一成 ≥ 1)。
 * - 不 import Vue(`src-coupling.test.ts`):`{ value }` 物件改 getter,讀到的是 renderer 的 shallowRef,
 *   在 .vue 的 computed 裡照樣追蹤得到變化。
 *
 * 型別與常數(`CoreCurrency`、`DivCurrency`、`CurrencyValue`)與 `displayRounding` 逐字照抄上游。
 */
import type { DropEntry } from "@/assets/data";
import { ITEM_BY_REF } from "@/assets/data";
import { autoCurrencyPoe2, type ChaosRates } from "@exile-appraiser/core/ninja";

interface DbQuery {
  ns: string;
  name: string;
  variant?: string;
}

export interface CurrencyValue {
  min: number;
  max: number;
  currency: "chaos" | "exalted" | "div";
}

export interface CoreCurrency {
  id: "exalted" | "chaos" | "div";
  abbrev: string;
  ref: string;
  text: string;
  icon: string;
}

export const DivCurrency: CoreCurrency = {
  id: "div",
  abbrev: "div",
  ref: "Divine Orb",
  text: "Divine Orb",
  icon: "/images/div.png",
};

/** 上游 `findPriceByQuery` 回傳的欄位(上游的 NinjaDenseExchangeInfo / NinjaDenseStashInfo 子集 + url / cx)。 */
export interface PriceSourceEntry {
  /** 價格(divine) */
  primaryValue: number;
  /** 每小時成交量(divine);只有 exchange 類 */
  volumePrimaryValue?: number;
  /** 成交量最大的對手通貨 id(`divine` / `exalted` / `chaos`…);只有 exchange 類 */
  maxVolumeCurrency?: string;
  /** 7 天走勢(每天相對 7 天前的漲跌 %);沒有 → data [] */
  sparkline: { totalChange: number; data: Array<number | null> };
  detailsId: string;
  /** poe.ninja 詳細頁 */
  url: string;
  /** 來自 poe.ninja exchange 類(上游 `cx`);查價面板「通貨價格區」只顯示這種 */
  cx: boolean;
}

/** renderer 注入的價格源(實作:`renderer/src/web/background/poe2-price-source.ts`)。 */
export interface PriceSource {
  /** 價格表版本(遊戲 / 聯盟 / 抓取時間);沒有價格表 → undefined。換算快取以它失效 */
  revision(): string | undefined;
  /** 1 divine / 1 exalted = 幾 chaos;沒有 → undefined */
  rates(): ChaosRates;
  find(query: DbQuery): PriceSourceEntry | null;
  queuePricesFetch(): void;
  initialLoading(): boolean;
}

let source: PriceSource | undefined;

/** renderer 啟動時注入;傳 undefined = 回到「沒有價格」。 */
export function setPriceSource(next: PriceSource | undefined): void {
  source = next;
}

interface Box<T> {
  readonly value: T;
}

function exaltedCurrency(): CoreCurrency {
  let text = "Exalted Orb";
  try {
    text = ITEM_BY_REF("ITEM", "Exalted Orb")?.[0]?.name ?? text;
  } catch {
    // 資料還沒載入
  }
  return {
    id: "exalted",
    abbrev: "ex",
    ref: "Exalted Orb",
    text,
    icon: "/images/exa.png",
  };
}

function createPoeninja() {
  const rates = (): ChaosRates => source?.rates() ?? {};
  /** 1 divine = 幾 exalted(上游 xchgRate 的意義) */
  const xchgRate: Box<number | undefined> = {
    get value() {
      const r = rates();
      return r.divineRate && r.exaltedRate && r.divineRate > 0 && r.exaltedRate > 0
        ? r.divineRate / r.exaltedRate
        : undefined;
    },
  };
  const xchgRateCurrency: Box<CoreCurrency | undefined> = {
    get value() {
      return xchgRate.value !== undefined ? exaltedCurrency() : undefined;
    },
  };
  const availableCoreCurrencies: Box<readonly CoreCurrency[]> = {
    get value() {
      return xchgRate.value !== undefined ? [exaltedCurrency()] : [];
    },
  };
  const ITEM_DROP: { value: DropEntry[] } = { value: [] };

  let priceCache = new Map<string, CurrencyValue>();
  let priceCacheRevision: string | undefined;

  function findPriceByQuery(query: DbQuery): PriceSourceEntry | null {
    return source?.find(query) ?? null;
  }

  /**
   * divine 數 → 顯示單位。沒有 divine 匯率(沒有價格表)→ 原值標 exalted(第 24 步之前的行為)。
   * @param coreOnly 不換成 divine(上游查 Divine Orb 本身時用)
   */
  function autoCurrency(
    value: number | [number, number],
    coreOnly: boolean = false,
  ): CurrencyValue {
    const r = rates();
    if (!r.divineRate || !(r.divineRate > 0)) {
      if (Array.isArray(value)) {
        return { min: value[0], max: value[1], currency: "exalted" };
      }
      return { min: value, max: value, currency: "exalted" };
    }
    const div = r.divineRate;
    const chaos: number | [number, number] = Array.isArray(value)
      ? [value[0] * div, value[1] * div]
      : value * div;
    return autoCurrencyPoe2(chaos, r, { coreOnly });
  }

  function cachedCurrencyByQuery(query: DbQuery, count: number) {
    const revision = source?.revision();
    if (!revision) return undefined;
    if (revision !== priceCacheRevision) {
      priceCache = new Map<string, CurrencyValue>();
      priceCacheRevision = revision;
    }
    // variant should always be undefined for currencies
    const key = `${query.ns}:${query.name}:${query.variant ?? ""}:${count}`;
    if (priceCache.has(key)) {
      return priceCache.get(key)!;
    }

    const price = findPriceByQuery(query);
    if (!price) {
      return;
    }
    const currency = autoCurrency(price.primaryValue * count);
    priceCache.set(key, currency);
    return currency;
  }

  /** 上游 toDivine:沒有匯率時原值(上游同樣)。 */
  function toDivine(value: CurrencyValue): CurrencyValue {
    if (value.currency === "div") return value;
    const r = rates();
    let perDivine: number | undefined;
    if (value.currency === "exalted") perDivine = xchgRate.value;
    else if (value.currency === "chaos" && r.divineRate && r.divineRate > 0) perDivine = r.divineRate;
    if (!perDivine) return value;
    return {
      min: value.min / perDivine,
      max: value.max / perDivine,
      currency: "div",
    };
  }

  // 以下三個照抄上游的區間運算(先 toDivine 再算)
  function addPrice(addend1: CurrencyValue, addend2: CurrencyValue): CurrencyValue {
    const addend1Div = toDivine(addend1);
    const addend2Div = toDivine(addend2);
    return autoCurrency([
      addend1Div.min + addend2Div.min,
      addend1Div.max + addend2Div.max,
    ]);
  }

  function subtractPrice(minuend: CurrencyValue, subtrahend: CurrencyValue): CurrencyValue {
    const minuendDiv = toDivine(minuend);
    const subtrahendDiv = toDivine(subtrahend);
    return autoCurrency([
      minuendDiv.min - subtrahendDiv.max,
      minuendDiv.max - subtrahendDiv.min,
    ]);
  }

  function comparePrice(
    left: CurrencyValue,
    op: ">" | ">=" | "==" | "===" | "<=" | "<",
    right: CurrencyValue,
  ): boolean {
    const leftDiv = toDivine(left);
    const rightDiv = toDivine(right);
    switch (op) {
      case ">":
        return leftDiv.min > rightDiv.max;
      case ">=":
        return leftDiv.min >= rightDiv.max;
      case "==":
        return leftDiv.min === rightDiv.max && leftDiv.max === rightDiv.min;
      case "===":
        return (
          left.currency === right.currency &&
          leftDiv.min === rightDiv.max &&
          leftDiv.max === rightDiv.min
        );
      case "<=":
        return leftDiv.max <= rightDiv.min;
      case "<":
        return leftDiv.max < rightDiv.min;
    }
  }

  return {
    xchgRate,
    xchgRateCurrency,
    findPriceByQuery,
    autoCurrency,
    queuePricesFetch: () => source?.queuePricesFetch(),
    cachedCurrencyByQuery,
    initialLoading: () => source?.initialLoading() ?? false,
    availableCoreCurrencies,
    ITEM_DROP,
    // math
    addPrice,
    subtractPrice,
    comparePrice,
  };
}

let state: ReturnType<typeof createPoeninja> | undefined;

export function usePoeninja() {
  state ??= createPoeninja();
  return state;
}

export function displayRounding(
  value: number,
  fraction: boolean = false,
  truncateLargeNumbers: boolean = false,
): string {
  if (fraction && Math.abs(value) < 1) {
    if (value === 0) return "0";
    const r = `1 / ${displayRounding(1 / value)}`;
    return r === "1 / 1" ? "1" : r;
  }
  if (Math.abs(value) < 10) {
    return Number(value.toFixed(1)).toString().replace(".", " . ");
  }
  if (truncateLargeNumbers && Math.abs(value) > 2250) {
    if (Math.abs(value) < 1_050_000) {
      // keep 1 decimal 12324 -> 12.3k
      return (
        Number((value / 1000).toFixed(1))
          .toString()
          .replace(".", " . ") + "k"
      );
    }
    if (Math.abs(value) < 1_050_000_000) {
      return (
        Number((value / 1_000_000).toFixed(1))
          .toString()
          .replace(".", " . ") + "m"
      );
    }
    if (Math.abs(value) < 1_050_000_000_000) {
      return (
        Number((value / 1_000_000_000).toFixed(1))
          .toString()
          .replace(".", " . ") + "b"
      );
    }
    return (
      Number((value / 1_000_000_000_000).toFixed(1))
        .toString()
        .replace(".", " . ") + "t"
    );
  }
  return Math.round(value).toString();
}
