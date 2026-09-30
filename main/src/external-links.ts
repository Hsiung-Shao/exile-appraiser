/**
 * 外部網址規則(純函式,`main/test/external-links.test.ts`)。main.ts 用在:
 * - IPC `open-external`(renderer 與瀏覽器預覽共用的 `Host.openExternal`):只把 http(s) 交給 `shell.openExternal`
 * - 主視窗 `setWindowOpenHandler`(`window.open` / `<a target="_blank">`):一律 deny,http(s) 轉系統瀏覽器
 *   —— 不讓 Electron 自己開一個新的 BrowserWindow(那個視窗沒有使用者瀏覽器的登入狀態)
 * - 主視窗 `will-navigate`(`<a href>` 沒有 target):不是 app 自己的頁面就攔下,http(s) 轉系統瀏覽器
 * - 內建驗證視窗(`open-captcha`)裡交易站開的新視窗:同樣 deny + 轉系統瀏覽器
 */

/** 只有 http: / https: 可以交給系統瀏覽器;file:、javascript:、自訂協定、壞網址一律 false。 */
export function isExternalWebUrl (url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 32_768) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * 主視窗的導覽是不是 app 自己的頁面(`app://app/…`,或開發模式的 Vite origin):是 → 放行(重新載入、HMR);
 * 否則由呼叫端攔下。`appOrigins` 例:`['app://app', 'http://localhost:5173']`(只比 origin,不比路徑)。
 */
export function isAppNavigation (url: string, appOrigins: readonly string[]): boolean {
  let origin: string
  try {
    const u = new URL(url)
    // app:// 這類非特殊 scheme 的 URL.origin 是 'null',自己組
    origin = u.origin !== 'null' ? u.origin : `${u.protocol}//${u.host}`
  } catch {
    return false
  }
  return appOrigins.some(o => {
    try {
      const a = new URL(o)
      const ao = a.origin !== 'null' ? a.origin : `${a.protocol}//${a.host}`
      return ao === origin
    } catch {
      return false
    }
  })
}
