import type { DataSource } from '@exile-appraiser/core/games/adapter'

/**
 * 瀏覽器 / Electron renderer 端的資料來源:與上游行為相同(fetch + 動態 import),
 * 只是 base URL 改成由呼叫端傳入(上游是 `import.meta.env.BASE_URL + 'data/'`)。
 *
 * exile-appraiser: 一律先以 `document.baseURI` 解析成絕對網址再交給 fetch / import()。
 * 相對路徑對 fetch 是相對於頁面,但對動態 `import()` 是相對於「這個模組檔」本身——
 * Vite dev 下會變成 `poe2/src/assets/data/data/poe2/...` → 404,整個 renderer 啟動失敗(視窗全空白)。
 */
export function browserDataSource (baseUrl: string): DataSource {
  const url = (rel: string) => new URL(baseUrl.replace(/\/?$/, '/') + rel, document.baseURI).href
  const ensureOk = (r: Response, rel: string) => {
    if (!r.ok) throw new Error(`資料檔載入失敗:${rel} (HTTP ${r.status})`)
    return r
  }
  return {
    async text (rel) { return ensureOk(await fetch(url(rel)), rel).text() },
    async binary (rel) { return ensureOk(await fetch(url(rel)), rel).arrayBuffer() },
    async module (rel) { return (await import(/* @vite-ignore */ url(rel))).default }
  }
}
