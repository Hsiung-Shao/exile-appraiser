/**
 * exile-appraiser: 取代上游 `web/background/TradeData.ts`(Vue `createGlobalState` + `Host.proxy` 線上抓
 * `www.pathofexile.com/api/trade2/data/{stats,items}`)。
 *
 * 解析器真的會用到這份資料(不是只有顯示):`assets/data/index.ts` 的 `TRADE_ITEM_BY_REF` /
 * `TRADE_STAT_BY_MATCH_STR` / `TRADE_STAT_BY_STAT_ID` 是本地 ndjson 查不到時的後援
 * (`Parser.ts` 物品名、`magic-name.ts` 魔法物品基底、`stat-translations.ts` 詞綴)。
 * 所以這裡保留上游的回傳形狀與處理邏輯(逐字),只換兩件事:
 * 1. 網路來源 → 可注入的 `TradeDataLoader`;預設讀 DataSource 裡的離線快照
 *    `trade/intl/{stats,items}.json`(`data/poe2/trade/`,抓取日期記在 `data/MANIFEST.json`)。
 *    上游刻意只抓 www(「we want ref items, not translated」),台服那份快照只存檔備查,不餵解析器。
 * 2. 拿掉 Vue 的 shallowRef/readonly(改 `{ value }` 物件,呼叫端用法不變)與每 30 分鐘的 setInterval
 *    (離線快照不會變;計時器還會讓 CLI / vitest 的事件迴圈結束不了)。
 */
import { source } from "@/assets/data/source";

export type TradeDataKind = "stats" | "items";
/** 回傳 `/api/trade2/data/<kind>` 的原始 JSON 文字。 */
export type TradeDataLoader = (kind: TradeDataKind) => Promise<string>;

/** 預設:DataSource 內的國際服快照(與上游一樣只用 www 的英文 ref 資料)。 */
export const snapshotTradeDataLoader: TradeDataLoader = (kind) =>
  source().text(`trade/intl/${kind}.json`);

let loader: TradeDataLoader = snapshotTradeDataLoader;

export function configureTradeDataLoader(next: TradeDataLoader): void {
  loader = next;
}

export interface ItemQuery {
  group: string;
  type: string;
  name?: string;
}

interface TradeItem {
  type: string;
  text?: string;
  name?: string;
  flags?: {
    unique: true;
  };
}

interface TradeStat {
  id: string;
  text: string;
}

interface Box<T> {
  value: T;
}

function createTradeData() {
  let lastInterestTime = 0;

  const isLoading: Box<boolean> = { value: false };
  const error: Box<string | null> = { value: null };
  // ref data - nameplates are always REF
  const itemData: Box<Set<string>> = { value: new Set([]) };
  // translated data
  const statDataSet: Box<Set<string>> = { value: new Set([]) };
  const statData: Box<Map<string, { [type: string]: string[] }>> = {
    value: new Map(),
  };

  async function loadStatData(): Promise<
    [Map<string, Record<string, string[]>>, Set<string>]
  > {
    const resText = await loader("stats");

    const rawStatsData = JSON.parse(resText) as {
      result: Array<{ id: string; entries: TradeStat[] }>;
    };

    const outStatData: Map<string, { [type: string]: string[] }> = new Map();
    const statDataSet = new Set<string>();

    for (const { id: modType, entries } of rawStatsData.result) {
      for (const { id: statId, text: matcher } of entries) {
        let modMap = outStatData.get(matcher);

        if (!modMap) {
          modMap = {};
          outStatData.set(matcher, modMap);
        }

        let statIds = modMap[modType];

        if (!statIds) {
          statIds = [];
          modMap[modType] = statIds;
        }

        statDataSet.add(statId);
        statIds.push(statId);
      }
    }

    return [outStatData, statDataSet];
  }

  async function loadItemData() {
    const resText = await loader("items");

    const rawItemData = JSON.parse(resText) as {
      result: Array<{ entries: TradeItem[] }>;
    };

    const outItemData = new Set<string>();

    for (const category of rawItemData.result) {
      for (const { type, text } of category.entries) {
        if (type) {
          outItemData.add(type);
        }
        if (text) {
          outItemData.add(text);
        }
      }
    }

    return outItemData;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function load(force: boolean = false) {
    let foundItems: number = 0;
    let foundStats: number = 0;

    try {
      isLoading.value = true;
      error.value = null;

      // grab the data
      const [outItemData, outStatTuple] = await Promise.all([
        loadItemData(),
        loadStatData(),
      ]);

      foundItems = outItemData.size - itemData.value.size;
      foundStats = outStatTuple[1].size - statDataSet.value.size;
      // don't regress
      if (foundItems > 0 && foundStats > 0) {
        itemData.value = outItemData;
        statData.value = outStatTuple[0];
        statDataSet.value = outStatTuple[1];
      }
    } catch (e) {
      console.warn(e);
      error.value = (e as Error).message;
    } finally {
      isLoading.value = false;
    }

    // give caller some data if they want it
    return {
      foundItems,
      foundStats,
    };
  }

  function expressInterest() {
    lastInterestTime = Date.now();
  }

  return {
    isLoading,
    error,
    expressInterest,
    get lastInterestTime() {
      return lastInterestTime;
    },
    tradeItemData: itemData as Readonly<Box<ReadonlySet<string>>>,
    tradeStatData: statData as Readonly<
      Box<ReadonlyMap<string, { [type: string]: string[] }>>
    >,
    tradeStatDataSet: statDataSet as Readonly<Box<ReadonlySet<string>>>,
    load,
  };
}

let state: ReturnType<typeof createTradeData> | undefined;

/** 與上游同名、同形狀的全域單例。 */
export function useTradeData() {
  state ??= createTradeData();
  return state;
}
