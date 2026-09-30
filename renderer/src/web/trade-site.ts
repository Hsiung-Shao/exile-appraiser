/**
 * 開交易站網頁給使用者看(唯一入口):
 * - 查價元件經 `inject('builtin-browser')`(App.vue 提供的就是 `openTradeSite`;兩遊戲 TradeListing / TradeBulk 錯誤框的
 *   「瀏覽器」、`builtinBrowser` 開著時 TradeLinks 的主鈕)
 * - 拆粉排行的「交易 ↗」(`dust/DustTable.vue`)
 *
 * 預設 = 系統預設瀏覽器(`Host.openExternal` → main `shell.openExternal`),與查價「交易」鈕(TradeLinks 在
 * `builtinBrowser` 關時直接呼叫 `Host.openExternal`)同一條路:使用者在自己的瀏覽器已登入 pathofexile.com / pathofexile.tw。
 * 只有上游 APT 的 `priceCheck.builtinBrowser`(本專案設定頁沒有提供,預設 false)開著且在 Electron 內,才開內建視窗
 * (`Host.openCaptcha`,與 session fetch 共用 Cloudflare cookie,但**沒有登入狀態**)。
 *
 * 「開啟驗證視窗」(Cloudflare cookie,App.vue 聯盟錯誤框、設定 › 一般)是另一件事,直接呼叫 `Host.openCaptcha`,不走這裡。
 * 網址(intl = www.pathofexile.com、tw = pathofexile.tw)由呼叫端依目前 realm 組好;這裡不改網址。
 */
import { AppConfig } from './Config'
import { Host } from './background/IPC'
import type { PriceCheckWidget } from './overlay/interfaces'

export type TradeSiteVia = 'external' | 'builtin'

/** 決定用哪個視窗開(純函式,有測試):內建視窗只在 `builtinBrowser` 開著且在 Electron(含預覽 shim)內。 */
export function tradeSiteVia (builtinBrowser: boolean, isElectron: boolean): TradeSiteVia {
  return builtinBrowser && isElectron ? 'builtin' : 'external'
}

export function openTradeSite (url: string): void {
  const via = tradeSiteVia(AppConfig<PriceCheckWidget>('price-check').builtinBrowser === true, Host.isElectron)
  console.log(`[trade-site] ${via === 'builtin' ? '內建視窗' : '系統瀏覽器'} ${url}`)
  void (via === 'builtin' ? Host.openCaptcha(url) : Host.openExternal(url))
}
