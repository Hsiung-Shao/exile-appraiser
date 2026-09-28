// exile-appraiser: 移植自 Exiled Exchange 2;改動(同 poe1 那份):
// - 拿掉 Vue(shallowReactive)與 AppConfig,限流規則改成「每個 realm 一組」的實例
//   (`createRateLimitRules` + `tradeSession`),延遲補償秒數由呼叫端傳入。
// - `getTradeEndpoint` 不再從 @/web/Config re-export;host 由 core 的 realm 模型決定,
//   Vue 元件經 `activeTradeContext()`(shell 注入)取得 http / realm / 設定。
import type { ItemFilters, StatFilter } from "../filters/interfaces";
import { RateLimiter } from "./RateLimiter";
import { Cache } from "./Cache";
import { ParsedItem, ItemCategory } from "@/parser";
import { REALMS, type Realm } from "@exile-appraiser/core/realm";
import type { TradeContext } from "@exile-appraiser/core/games/adapter";

import { activeTradeContext } from "./context";
export { activeTradeContext, setTradeContextProvider } from "./context";

/** exile-appraiser: 上游同名函式(原本 re-export 自 @/web/Config 的 poeWebApi):目前 realm 的 host。 */
export function getTradeEndpoint(): string {
  return REALMS[activeTradeContext().realm].host;
}

export interface Account {
  name: string;
  lastCharacterName: string;
  online?: {
    status?: "afk";
  };
}

export type TradeResponse<T> =
  | (T & { error?: null })
  | {
      error: {
        code: number;
        message: string;
      };
    };

export function apiToSatisfySearch(
  item: ParsedItem,
  stats: StatFilter[],
  filters: ItemFilters,
): "trade" | "bulk" {
  if (stats.some((s) => !s.disabled)) {
    return "trade";
  }

  if (filters.stackSize) {
    if (
      item.category === ItemCategory.DivinationCard ||
      item.category === ItemCategory.Map
    ) {
      return filters.stackSize.disabled ? "trade" : "bulk";
    }
  }

  return tradeTag(item) != null ? "bulk" : "trade";
}

export function tradeTag(item: ParsedItem): string | undefined {
  return item.info.tradeTag;
}

// exile-appraiser: 上游是模組層單例 `RATE_LIMIT_RULES`(shallowReactive);改成每個 realm 一組。
export interface RateLimitRules {
  SEARCH: Set<RateLimiter>;
  EXCHANGE: Set<RateLimiter>;
  FETCH: Set<RateLimiter>;
}

export function createRateLimitRules(): RateLimitRules {
  return {
    SEARCH: new Set([new RateLimiter(1, 5)]),
    EXCHANGE: new Set([new RateLimiter(1, 5)]),
    FETCH: new Set([new RateLimiter(1, 5)]),
  };
}

/**
 * exile-appraiser: 每個 realm 各一套限流狀態與快取。國際服與台服是不同 host,GGG 的額度各自計算,
 * 而快取鍵若不含 realm,切區後會拿到另一區的搜尋 id。(PoE1 的 poe1 package 有自己的一份。)
 */
export interface TradeSession {
  realm: Realm;
  limits: RateLimitRules;
  cache: Cache;
}

const sessions = new Map<Realm, TradeSession>();

export function tradeSession(realm: Realm): TradeSession {
  let s = sessions.get(realm);
  if (!s) {
    s = { realm, limits: createRateLimitRules(), cache: new Cache() };
    sessions.set(realm, s);
  }
  return s;
}

/** exile-appraiser: 測試用:丟掉所有 realm 的限流與快取狀態。 */
export function resetTradeSessions(): void {
  for (const s of sessions.values()) {
    for (const set of [s.limits.SEARCH, s.limits.EXCHANGE, s.limits.FETCH]) {
      for (const rl of set) rl.destroy();
    }
  }
  sessions.clear();
}

export function adjustRateLimits(
  clientLimits: Set<RateLimiter>,
  headers: Headers,
  latencySeconds = 0, // exile-appraiser: 上游讀 AppConfig("price-check").apiLatencySeconds
): void {
  if (!headers.has("x-rate-limit-rules")) return;

  const rules = headers.get("x-rate-limit-rules")!.split(",");

  _adjustRateLimits(
    clientLimits,
    rules.map((rule) => headers.get(`x-rate-limit-${rule}`)!).join(","),
    rules.map((rule) => headers.get(`x-rate-limit-${rule}-state`)!).join(","),
    latencySeconds,
  );
}

function _adjustRateLimits(
  clientLimits: Set<RateLimiter>,
  limitStr: string,
  stateStr: string,
  latencySeconds: number,
): void {
  /* eslint-disable @typescript-eslint/no-unused-expressions */
  const DEBUG = false;
  const DESYNC_FIX = latencySeconds; // exile-appraiser

  const limitRuleState = stateStr
    .split(",")
    .map((rule) => rule.split(":"))
    .map((rule) => Number(rule[0]));
  const limitRule = limitStr
    .split(",")
    .map((rule) => rule.split(":"))
    .map((rule, idx) => ({
      max: Number(rule[0]),
      window: Number(rule[1]) + DESYNC_FIX,
      state: limitRuleState[idx],
    }));

  // destroy
  for (const limit of clientLimits) {
    const isActive = limitRule.some((serverLimit) =>
      limit.isEqualLimit(serverLimit),
    );
    if (!isActive) {
      clientLimits.delete(limit);
      limit.destroy();
      DEBUG && console.log("Destroy", limit.toString());
    }
  }

  // compare client<>server state
  for (const limit of clientLimits) {
    const serverLimit = limitRule.find((serverLimit) =>
      limit.isEqualLimit(serverLimit),
    )!;
    const delta = serverLimit.state - limit.stack.length;

    if (delta === 0) {
      DEBUG && console.log("Limits are in sync");
    } else if (delta > 0) {
      DEBUG &&
        console.error(
          `Rate limit state on Server is greater by ${Math.abs(delta)}. Bursting to prevent rate limiting.`,
        );
      for (let i = 0; i < Math.min(delta, limit.available); ++i) {
        limit.wait();
      }
    } else if (delta < 0) {
      DEBUG &&
        console.warn(
          `Rate limit state on Client is greater by ${Math.abs(delta)}`,
        );
    }
  }

  // add new
  serverLimits: for (const serverLimit of limitRule) {
    for (const limit of clientLimits) {
      if (limit.isEqualLimit(serverLimit)) continue serverLimits;
    }

    const rl = new RateLimiter(serverLimit.max, serverLimit.window);
    clientLimits.add(rl);
    DEBUG && console.log("Add", rl.toString());

    for (let i = 0; i < serverLimit.state; ++i) {
      rl.wait();
    }
  }
}

export function preventQueueCreation(
  targets: Array<{ count: number; limiters: Iterable<RateLimiter> }>,
) {
  const estimatedMillis = Math.max(
    ...targets.map((target) => {
      const estimated = RateLimiter.estimateTime(target.count, target.limiters);
      const estimatedCleanState = RateLimiter.estimateTime(
        target.count,
        target.limiters,
        true,
      );

      // ignore if impossible to run without queue
      return estimated === estimatedCleanState ? 0 : estimated;
    }),
  );

  if (estimatedMillis >= 1500) {
    throw new Error(
      `Retry after ${Math.round(estimatedMillis / 1000)} seconds`,
    );
  }
}
