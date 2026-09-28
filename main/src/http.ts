/**
 * renderer 的所有對外請求都走這裡(`ipcMain.handle('http-fetch')`):
 * - 用 Electron session 的 fetch 送出,才會帶 Cloudflare 在內建瀏覽器視窗解挑戰時拿到的 cookie;
 * - host 白名單(上游 `proxy.ts` 的 PROXY_HOSTS,縮成本專案會打的三個);
 * - Cloudflare 的 Set-Cookie 帶 `Partitioned`,Electron 的 net 沒有 partition key 可指定,剝掉才存得進去(上游同一招);
 * - User-Agent 固定用 `app.userAgentFallback`(內含 `exile-appraiser/<version>`;GGG 靠它擋舊版第三方工具)。
 */
import { app, session } from 'electron'
import type { HostFetchInit, HostFetchResult } from '@ipc/types'

const ALLOWED_HOSTS = new Set(['www.pathofexile.com', 'pathofexile.tw', 'poe.ninja'])

export function installCookiePatch () {
  session.defaultSession.webRequest.onHeadersReceived((details, next) => {
    const cookies = details.responseHeaders?.['set-cookie']
    if (cookies) {
      details.responseHeaders!['set-cookie'] = cookies.map(cookie =>
        cookie.split(';').filter(part => part.trim().toLowerCase() !== 'partitioned').join(';'))
    }
    next({ responseHeaders: details.responseHeaders })
  })
}

export async function hostFetch (url: string, init: HostFetchInit = {}): Promise<HostFetchResult> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.host)) {
    throw new Error(`refused host: ${parsed.host}`)
  }
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith('sec-') || ['host', 'origin', 'content-length', 'user-agent'].includes(key.toLowerCase())) delete headers[key]
  }
  headers['User-Agent'] = app.userAgentFallback

  const res = await session.defaultSession.fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body,
    credentials: 'include',
    redirect: 'follow',
    referrerPolicy: 'no-referrer-when-downgrade'
  })
  const body = await res.text()
  return {
    status: res.status,
    statusText: res.statusText,
    headers: [...res.headers.entries()],
    body
  }
}
