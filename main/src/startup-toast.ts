/**
 * 啟動時的「已在背景執行」提示(純邏輯,不 import electron;`main/test/startup-toast.test.ts` 測)。
 * 本程式啟動後沒有可見視窗(overlay 附著遊戲、托盤常駐),自動更新套用後重新啟動時使用者尤其不知道它已經在跑,
 * 所以在主螢幕工作區右下角短暫顯示一個不搶焦點、點擊穿透的小視窗(視窗行為在 `main.ts` 的 `showStartupToast`)。
 *
 * - 是否顯示:`shouldShowStartupToast`(設定 `startupToast` 預設開;控制參數 / 自我測試 / 預覽 / 第二實例不顯示)。
 * - 更新後第一次啟動:`userData/last_run.json` 的 `lastRunVersion` 比目前版本舊 → 第一行改「已更新至 vX」。
 * - 第 16 步:overlay 模式下遊戲視窗從「不在」變成「附著到」時再顯示一次(`shouldShowGameAttachToast`;
 *   程式啟動時遊戲已在 → 啟動那次已顯示,不重複)。
 * - 第 16 步:辨識暫停 / 繼續熱鍵按下時用同一個提示視窗顯示「褻瀆辨識:已啟動 / 已暫停」等(`scanToastMessage`;連按更新同一個視窗)。
 * - 頁面:`toastHtml` 產生自足的 HTML(內嵌 CSS、無腳本、CSP `default-src 'none'`),以 data URL 載入。
 */
import { mergeTwoHotkeys } from '@ipc/KeyToCode'
import { normalizeHotkey } from './shortcut-actions'
import { pickDisplayIndex, type PhysRect } from './ocr/overlay-shot'

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

/**
 * 遊戲附著後多久內的「第一次 attach」視為「程式啟動時遊戲已在」(ms)。attach 由第一次 host-config 開始追蹤,
 * 遊戲早就開著時原生端幾乎立刻送 attach;這段時間也大於提示本身的顯示時間(啟動提示還在畫面上,不必再顯示一次)。
 */
export const STARTUP_ATTACH_GRACE_MS = 5000

export interface GameAttachToastEnv {
  /** 設定 `startupToast`(undefined = 開)。 */
  enabled: boolean | undefined
  /** 只有 overlay 模式會附著遊戲視窗;window 模式一律不顯示。 */
  mode: 'overlay' | 'window'
  /** `--preview` 啟動。 */
  preview: boolean
  /** 各種 `--*-selftest`。 */
  selftest: boolean
  /** 帶了控制參數。 */
  controlRequest: boolean
  /** 正在重新啟動(換遊戲 / 標題 / 模式)。 */
  relaunching: boolean
  /** 這個事件之前遊戲是否已經附著著(沒經過 detach 的重複 attach 不算「從不在變成在」)。 */
  wasAttached: boolean
  /** 這是本行程第一次 attach。 */
  firstAttach: boolean
  /** 從開始追蹤遊戲視窗(attachByTitle)到這次 attach 的毫秒數。 */
  msSinceTracking: number
}

/**
 * 遊戲視窗附著時要不要再顯示一次「已在背景執行」。
 * - 程式啟動時遊戲已在:第一次 attach 且在 `STARTUP_ATTACH_GRACE_MS` 內 → 不顯示(啟動那次已顯示)。
 * - 程式啟動後才開遊戲(第一次 attach 但超過寬限)、遊戲關掉再開(detach 後的 attach)→ 顯示。
 * - 設定關、window 模式、預覽、自我測試、控制參數、重新啟動中 → 不顯示。
 */
export function shouldShowGameAttachToast (env: GameAttachToastEnv): boolean {
  if (env.enabled === false || env.mode !== 'overlay') return false
  if (env.preview || env.selftest || env.controlRequest || env.relaunching) return false
  if (env.wasAttached) return false
  if (env.firstAttach && env.msSinceTracking < STARTUP_ATTACH_GRACE_MS) return false
  return true
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
  /** 第二行;空字串 = 只有一行 */
  hint: string
  /** `startup`(預設)= 標題 + 灰色說明;`scan` = 辨識開關通知,每行同樣字級 */
  kind?: 'startup' | 'scan'
}

export type ScanToastKind = 'reveal' | 'rune'

const SCAN_TOAST_STRINGS: Readonly<Record<ToastLang, { reveal: string, rune: string, on: string, paused: string, sep: string }>> = {
  'cmn-Hant': { reveal: '褻瀆辨識', rune: '符文辨識', on: '已啟動', paused: '已暫停', sep: ':' },
  en: { reveal: 'Desecration detection', rune: 'Rune detection', on: 'on', paused: 'paused', sep: ': ' }
}

/**
 * 第 16 步:辨識暫停 / 繼續熱鍵的通知(切換**後**的實際狀態)。一項 = 一行;合併熱鍵兩項 = 兩行(褻瀆在上)。
 */
export function scanToastMessage (lang: ToastLang, items: Array<{ kind: ScanToastKind, paused: boolean }>): ToastMessage {
  const S = SCAN_TOAST_STRINGS[lang]
  const order: ScanToastKind[] = ['reveal', 'rune']
  const lines = [...items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map(it => `${S[it.kind]}${S.sep}${it.paused ? S.paused : S.on}`)
  return { lang, kind: 'scan', title: lines[0] ?? '', hint: lines.slice(1).join(' / ') }
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
  .toast[data-toast="scan"] .hint { font-size: 14px; font-weight: 600; color: #ece6d8; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes toast-out { from { opacity: 1; } to { opacity: 0; } }
</style>
</head>
<body>
<div class="toast" data-toast="${msg.kind === 'scan' ? 'scan' : 'startup'}">${icon}<div class="text"><div class="title" data-toast="title">${escapeHtml(msg.title)}</div>${msg.hint ? `<div class="hint" data-toast="hint">${escapeHtml(msg.hint)}</div>` : ''}</div></div>
</body>
</html>`
}

/** 右下角位置(`workArea` = 主螢幕工作區,已扣掉工作列,所以在托盤上方)。 */
/**
 * code review 第 B 批:提示要畫在哪個螢幕的工作區(DIP)。遊戲視窗(實體像素 client bounds)所在的螢幕
 * (與 OCR 擷取同一個判斷 `pickDisplayIndex`:含中心點 → 重疊最大);沒有遊戲視窗 / 不在任何螢幕上 → 主螢幕。
 */
export function toastWorkArea (
  game: PhysRect | null,
  displays: ReadonlyArray<{ rect: PhysRect, workArea: { x: number, y: number, width: number, height: number } }>,
  primaryWorkArea: { x: number, y: number, width: number, height: number }
): { x: number, y: number, width: number, height: number } {
  if (!game || !(game.width > 0 && game.height > 0)) return primaryWorkArea
  const i = pickDisplayIndex(game, displays.map(d => d.rect))
  return i >= 0 ? displays[i].workArea : primaryWorkArea
}

export function toastBounds (workArea: { x: number, y: number, width: number, height: number }): { x: number, y: number, width: number, height: number } {
  const { width, height } = TOAST_SIZE
  return {
    x: Math.round(workArea.x + workArea.width - width - TOAST_MARGIN),
    y: Math.round(workArea.y + workArea.height - height - TOAST_MARGIN),
    width,
    height
  }
}
