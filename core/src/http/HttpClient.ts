/**
 * 交易層對外唯一的網路介面。
 *
 * 形狀刻意與 WHATWG `fetch` 相同,所以:
 * - Electron renderer 端可以直接傳「經 main process 代理(帶 session cookie 過 Cloudflare)」的包裝函式;
 * - Node CLI 傳全域 `fetch`(會缺 Cloudflare cookie,只適合 dry-run 或偶爾一次的驗證);
 * - 測試傳讀錄製檔的假函式(含 `x-rate-limit-*` 標頭、429、`Query is too complex`)。
 *
 * ⚠ 不要在 core 裡直接呼叫全域 `fetch`;所有請求都要經過注入的 HttpFetch,
 *   否則「其實打了外部 API」這種缺陷會躲過測試。
 */
export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>

export interface HttpRequestInit {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** 中止(renderer 經 main 代理時會轉成 `http-abort`);中止後 reject `signal.reason`。 */
  signal?: AbortSignal
  /**
   * 逾時(ms,含讀完 body)。經 main 代理時轉成 `HostFetchInit.timeoutMs`(main 夾在 1 秒 ~ 5 分鐘;省略 = main 預設 30 秒)。
   * code review 第 B 批:poe.ninja 這類大回應由呼叫端傳較長的值;交易站 API 不傳(維持 30 秒)。全域 `fetch`(CLI)不認這個欄位。
   */
  timeoutMs?: number
}

/** `Response` 的子集,夠交易層用即可;真的 `Response` 物件直接滿足這個介面。 */
export interface HttpResponse {
  ok: boolean
  status: number
  headers: Headers
  json: () => Promise<unknown>
  text: () => Promise<string>
}
