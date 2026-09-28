/**
 * exile-appraiser: 取代上游 `renderer/specs/vitest.setup.ts`。
 *
 * 上游用三個 mock 把瀏覽器環境補起來;本 package 的對應作法:
 * | 上游 mock                                   | 這裡                                                       |
 * |---------------------------------------------|------------------------------------------------------------|
 * | `vi.mock("@/web/Config")`(AppConfig 假設定) | `setHostOptions(...)`(parser 只剩 host-options 一個入口)   |
 * | `vi.mock("@/assets/client-string-loader")` + `global.fetch` 讀 `public/` | `configureDataSource(nodeDataSource(data/poe2))` |
 * | `vi.mock("@/web/background/IPC")` 的 `Host.proxy` 回 `specs/data/{stats,items}.json` | `configureTradeDataLoader(snapshotTradeDataLoader)`:讀 `data/poe2/trade/intl/` 離線快照 |
 *
 * 呼叫介面與上游相同(`setupTests(overrides)`),所以移植來的測試檔不必改。
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { configureDataSource } from "@/assets/data";
import { nodeDataSource } from "@/assets/data/node-source";
import { resetHostOptions, setHostOptions } from "@/parser/host-options";
import {
  configureTradeDataLoader,
  snapshotTradeDataLoader,
} from "@/web/background/TradeData";
import { setTradeContextProvider } from "@/web/price-check/trade/context";

export const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/poe2",
);

/** 上游 `Config` 裡測試會覆寫的欄位(其餘欄位 parser 已經不讀)。 */
export interface TestConfigOverrides {
  language?: string;
  realm?: string;
  leagueId?: string;
}

export const setupTests = (configOverrides: TestConfigOverrides = {}) => {
  configureDataSource(nodeDataSource(DATA_DIR));
  configureTradeDataLoader(snapshotTradeDataLoader);
  resetHostOptions();
  setHostOptions({
    // 上游 defaultConfigMock:language 預設 "en"
    language: configOverrides.language ?? "en",
    // 上游 mock 的 price-check widget 只有 `savedAugments: {}`,沒有 searchStatRange(= undefined);照抄
    savedAugments: {},
    searchStatRange: undefined as unknown as number,
  });
  // 上游 Host mock + mockConfig.accountName "TestAccount":Vue composable(trade-api.ts 等)經
  // activeTradeContext() 取 ctx。http 一律拒絕 —— 測試不准真的打網路(要打的測試自己傳 ctx)。
  setTradeContextProvider(() => ({
    http: async (url) => {
      throw new Error(`測試不得發出網路請求:${url}`);
    },
    realm: "intl",
    latencySeconds: 0,
    accountName: "TestAccount",
  }));
};
