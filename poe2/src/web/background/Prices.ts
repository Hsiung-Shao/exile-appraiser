/**
 * exile-appraiser: 取代上游 `web/background/Prices.ts`(poe.ninja 參考價)。Phase 2 **刻意不做 ninja**
 * (與 renderer/src/web/background/Prices.ts 的 PoE1 版同一個決定),但移植來的
 * `trade/pathofexile-trade.ts`(換算價格欄)與幾個 .vue 會 import 這個模組,所以提供同名、
 * 行為為「沒有價格」的實作:`findPriceByQuery` / `cachedCurrencyByQuery` 永遠回 undefined,
 * 於是 `normalizedPrice` 為 undefined、UI 不顯示換算價。
 *
 * 型別與常數(`CoreCurrency`、`DivCurrency`、`CurrencyValue`)與 `displayRounding` 逐字照抄上游。
 * 不 import Vue:`{ value }` 物件形狀與上游 `readonly(shallowRef)` 在 script 端用法相同。
 */
import type { DropEntry } from "@/assets/data";

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

interface Box<T> {
  readonly value: T;
}

function createPoeninja() {
  const xchgRate: Box<number | undefined> = { value: undefined };
  const xchgRateCurrency: Box<CoreCurrency | undefined> = { value: undefined };
  const availableCoreCurrencies: Box<readonly CoreCurrency[]> = { value: [] };
  const ITEM_DROP: { value: DropEntry[] } = { value: [] };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function findPriceByQuery(_query: DbQuery):
    | { primaryValue: number; detailsId?: string }
    | undefined {
    return undefined;
  }

  function autoCurrency(value: number | [number, number]): CurrencyValue {
    if (Array.isArray(value)) {
      return { min: value[0], max: value[1], currency: "exalted" };
    }
    return { min: value, max: value, currency: "exalted" };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function cachedCurrencyByQuery(_query: DbQuery, _count: number):
    | CurrencyValue
    | undefined {
    return undefined;
  }

  // 以下三個照抄上游的區間運算;上游會先 toDivine() 換算,這裡沒有 ninja 匯率 → 恆等換算(上游在沒有匯率時也是原值)。
  function addPrice(addend1: CurrencyValue, addend2: CurrencyValue): CurrencyValue {
    return autoCurrency([addend1.min + addend2.min, addend1.max + addend2.max]);
  }

  function subtractPrice(minuend: CurrencyValue, subtrahend: CurrencyValue): CurrencyValue {
    return autoCurrency([minuend.min - subtrahend.max, minuend.max - subtrahend.min]);
  }

  function comparePrice(
    left: CurrencyValue,
    op: ">" | ">=" | "==" | "===" | "<=" | "<",
    right: CurrencyValue,
  ): boolean {
    switch (op) {
      case ">":
        return left.min > right.max;
      case ">=":
        return left.min >= right.max;
      case "==":
        return left.min === right.max && left.max === right.min;
      case "===":
        return (
          left.currency === right.currency &&
          left.min === right.max &&
          left.max === right.min
        );
      case "<=":
        return left.max <= right.min;
      case "<":
        return left.max < right.min;
    }
  }

  return {
    xchgRate,
    xchgRateCurrency,
    findPriceByQuery,
    autoCurrency,
    queuePricesFetch: () => {},
    cachedCurrencyByQuery,
    initialLoading: () => false,
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
