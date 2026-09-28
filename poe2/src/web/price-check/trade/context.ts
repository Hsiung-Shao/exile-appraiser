// exile-appraiser: 「目前交易情境」的持有者(common.ts 會 re-export)。刻意獨立成不 import 任何上游模組的小檔:
// 測試 setup 要注入 provider,若從 common.ts 取會連帶載入 @/parser → @/assets/data,
// 使個別 spec 的 vi.mock("@/assets/data") 對已快取的模組失效。
import type { TradeContext } from "@exile-appraiser/core/games/adapter";

let contextProvider: (() => TradeContext) | undefined;

/** shell(renderer main.ts)注入;CLI 與測試不設,直接把 ctx 傳進 request 函式。 */
export function setTradeContextProvider(provider: () => TradeContext): void {
  contextProvider = provider;
}

export function activeTradeContext(): TradeContext {
  if (!contextProvider)
    throw new Error(
      "TradeContext provider 未設定:shell 啟動時要呼叫 setTradeContextProvider()",
    );
  return contextProvider();
}
