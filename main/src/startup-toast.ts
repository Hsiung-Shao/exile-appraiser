/**
 * 啟動時的「已在背景執行」提示(純邏輯,不 import electron;`main/test/startup-toast.test.ts` 測)。
 * 本程式啟動後沒有可見視窗(overlay 附著遊戲、托盤常駐),自動更新套用後重新啟動時使用者尤其不知道它已經在跑,
 * 所以在主螢幕工作區右下角短暫顯示一個不搶焦點、點擊穿透的小視窗(視窗行為在 `main.ts` 的 `showStartupToast`)。
 *
 * - 是否顯示:`shouldShowStartupToast`(設定 `startupToast` 預設開;控制參數 / 自我測試 / 預覽 / 第二實例不顯示)。
 * - 更新後第一次啟動:`userData/last_run.json` 的 `lastRunVersion` 比目前版本舊 → 第一行改「已更新至 vX」。
 * - 頁面:`toastHtml` 產生自足的 HTML(內嵌 CSS、無腳本、CSP `default-src 'none'`),以 data URL 載入。
 */
import { mergeTwoHotkeys } from '@ipc/KeyToCode'
import { normalizeHotkey } from './shortcut-actions'

export type ToastLang = 'cmn-Hant' | 'en'

/** 顯示多久後開始淡出(ms)與淡出長度;視窗在兩者相加後銷毀。 */
export const TOAST_VISIBLE_MS = 2800
export const TOAST_FADE_MS = 450
/** 視窗大小(DIP)與距工作區邊緣的距離。寬度以英文最長的一行(更新後 / 一般標題)不被截斷為準(`--toast-selftest` 截圖驗過)。 */
export const TOAST_SIZE = { width: 460, height: 78 } as const
export const TOAST_MARGIN = 16

export interface ToastStartupEnv {
  /** 設定 `startupToast`(undefined = 舊設定檔沒有這欄 → 開)。 */
  enabled: boolean | undefined
  /** 帶了 `--quit` / `--install-update` 等控制參數。 */
  controlRequest: boolean
  /** `--ocr-selftest` / `--runeshape-selftest` / `--toast-selftest`。 */
  selftest: boolean
  /** `--preview` 啟動(瀏覽器預覽用),或 host-config 來自預覽分頁。 */
  preview: boolean
  /** 沒拿到單一實例鎖(第二個行程)。 */
  secondInstance: boolean
  /** 這個行程已經顯示過一次。 */
  alreadyShown: boolean
}

export function shouldShowStartupToast (env: ToastStartupEnv): boolean {
  if (env.controlRequest || env.selftest || env.preview || env.secondInstance || env.alreadyShown) return false
  return env.enabled !== false
}

/** 取 `x.y.z`(可帶 `v` 前綴;後綴忽略);無法解析 → null。 */
function parseVersion (v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** -1 / 0 / 1;任一邊無法解析 → null。 */
export function compareVersions (a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/**
 * 這次啟動是不是更新後的第一次:上次記錄的版本存在且比目前舊。
 * 沒有記錄(第一次安裝 / 舊版沒寫過)、同版、降版、無法解析 → false。
 */
export function isFirstRunAfterUpdate (lastRunVersion: string | null | undefined, current: string): boolean {
  if (typeof lastRunVersion !== 'string' || !lastRunVersion) return false
  return compareVersions(lastRunVersion, current) === -1
}

/** 解析 `last_run.json` 內容(損毀 / 缺欄位 → null)。 */
export function parseLastRun (raw: string | null): string | null {
  if (!raw) return null
  try {
    const v = (JSON.parse(raw) as { lastRunVersion?: unknown } | null)?.lastRunVersion
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

export function serializeLastRun (version: string): string {
  return JSON.stringify({ lastRunVersion: version }, null, 2)
}

/** 查價熱鍵顯示字串(= `buildShortcutActions` 註冊的快速查價組合,如 `Ctrl + D`);沒有主鍵 → null。 */
export function priceCheckHotkeyLabel (hotkeyHold: string | undefined, hotkey: string | undefined): string | null {
  const main = normalizeHotkey(hotkey ?? '')
  if (!main) return null
  const hold = normalizeHotkey(hotkeyHold ?? '')
  return hold ? mergeTwoHotkeys(hold, main) : main
}

export interface ToastMessage {
  lang: ToastLang
  title: string
  hint: string
}

export function toastLang (uiLanguage: string | undefined): ToastLang {
  return uiLanguage === 'en' ? 'en' : 'cmn-Hant'
}

export function toastMessage (opts: { lang: ToastLang, version: string, hotkey: string | null, updated: boolean }): ToastMessage {
  const { lang, version, hotkey, updated } = opts
  if (lang === 'en') {
    return {
      lang,
      title: updated ? `Updated to v${version}, running in the background` : `ExileAppraiser v${version} is running in the background`,
      hint: hotkey
        ? `Press ${hotkey} in game to price check · Tray icon for settings`
        : 'Tray icon for settings'
    }
  }
  return {
    lang,
    title: updated ? `已更新至 v${version},在背景執行中` : `流亡鑑價 v${version} 已在背景執行`,
    hint: hotkey
      ? `在遊戲中按 ${hotkey} 查價 · 系統匣圖示開啟設定`
      : '系統匣圖示開啟設定'
  }
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function escapeHtml (s: string): string {
  return s.replace(/[&<>"']/g, c => HTML_ESCAPES[c] ?? c)
}

/**
 * 提示頁 HTML。深色島:色值取自 `renderer/src/theme/pobtools.css` 的 slate token(不隨淺色主題變白)。
 * 沒有腳本:淡入 / 淡出都是 CSS 動畫;`iconDataUrl` 只接受 `data:image/png;base64,`(其他值不畫圖示)。
 * `animate: false` 給自我測試截圖(不必等動畫)。
 */
export function toastHtml (msg: ToastMessage, iconDataUrl: string | null, opts: { animate?: boolean } = {}): string {
  const animate = opts.animate !== false
  const icon = iconDataUrl && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(iconDataUrl)
    ? `<img class="icon" src="${iconDataUrl}" alt="">`
    : ''
  const anim = animate
    ? `animation: toast-in .22s ease-out both, toast-out ${TOAST_FADE_MS}ms ease-in ${TOAST_VISIBLE_MS}ms forwards;`
    : ''
  return `<!doctype html>
<html lang="${msg.lang === 'en' ? 'en' : 'zh-Hant'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>ExileAppraiser</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none; cursor: default; }
  body { padding: 4px; box-sizing: border-box;
    font-family: "Noto Sans TC", "Microsoft JhengHei UI", "Microsoft JhengHei", "Segoe UI", sans-serif; }
  .toast { display: flex; align-items: center; gap: 12px; width: 100%; height: 100%; box-sizing: border-box;
    padding: 10px 14px; border-radius: 8px; background: #192029; border: 1px solid #3a4554;
    border-left: 3px solid #d8aa4b; color: #ece6d8; box-shadow: 0 2px 6px rgba(0, 0, 0, .45); ${anim} }
  .icon { width: 36px; height: 36px; flex: none; }
  .text { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .title { font-size: 14px; font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { font-size: 12px; line-height: 1.3; color: #c3bfb4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes toast-out { from { opacity: 1; } to { opacity: 0; } }
</style>
</head>
<body>
<div class="toast" data-toast="startup">${icon}<div class="text"><div class="title" data-toast="title">${escapeHtml(msg.title)}</div><div class="hint" data-toast="hint">${escapeHtml(msg.hint)}</div></div></div>
</body>
</html>`
}

/** 右下角位置(`workArea` = 主螢幕工作區,已扣掉工作列,所以在托盤上方)。 */
export function toastBounds (workArea: { x: number, y: number, width: number, height: number }): { x: number, y: number, width: number, height: number } {
  const { width, height } = TOAST_SIZE
  return {
    x: Math.round(workArea.x + workArea.width - width - TOAST_MARGIN),
    y: Math.round(workArea.y + workArea.height - height - TOAST_MARGIN),
    width,
    height
  }
}
