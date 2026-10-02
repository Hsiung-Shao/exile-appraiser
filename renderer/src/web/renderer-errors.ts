/**
 * renderer 錯誤一律進 main log(2026-10-03 修「查價面板一片空白」時補的觀測缺口)。
 *
 * main 用 `webContents.on('console-message')` 把 renderer 的 console 轉印成 `[renderer] …`(main/src/main.ts),
 * 但轉過去的只有訊息字串:`console.error(err)` 只剩 `TypeError: x`,沒有堆疊、也不知道是哪個元件;
 * Vue 正式版的預設處理也只是 `console.error(err)`。所以這裡自己把錯誤組成**一個字串**(含堆疊與 Vue 的錯誤來源)再印,
 * 前綴固定 `[renderer-error]`,log 裡一搜就找得到。
 *
 * 三個入口:`app.config.errorHandler`(沒被 ErrorBoundary 攔下的 Vue 錯誤)、`window` 的 `error` / `unhandledrejection`
 * (Vue 以外未捕捉的例外與 Promise),以及 `ui/ErrorBoundary.vue`(查價面板的元件錯誤,攔下後顯示錯誤框)。
 */
import type { App, ComponentPublicInstance } from 'vue'

/** 堆疊最多留幾行(main log 一行一筆,太長難讀) */
const MAX_STACK_LINES = 12
/** 同一則錯誤在這段時間內只記一次(渲染迴圈裡重複拋錯時不洗版) */
const DEDUPE_MS = 2000

export interface ErrorSink { (line: string): void }

/** 元件名稱(找不到 → `anonymous`);沿父元件往上最多 4 層,看得出在面板的哪一塊 */
export function componentPath (instance: ComponentPublicInstance | null | undefined): string {
  const names: string[] = []
  let cur = instance?.$ ?? null
  for (let i = 0; cur && i < 4; i++) {
    const t = cur.type as { name?: string, __name?: string, __file?: string }
    const name = t.name ?? t.__name ?? (t.__file ? t.__file.split(/[\\/]/).pop() : undefined)
    if (name) names.push(name)
    cur = cur.parent
  }
  return names.length ? names.join(' < ') : 'anonymous'
}

/** Vue 正式版的錯誤來源是錯誤碼網址(`…/error-reference/#runtime-1`),換成看得懂的名稱(開發版本來就是文字,原樣) */
const VUE_ERROR_SOURCES: Record<string, string> = {
  0: 'setup', 1: 'render', 2: 'watcher getter', 3: 'watcher callback', 4: 'watcher cleanup',
  5: 'native event handler', 6: 'component event handler', 7: 'vnode hook', 8: 'directive hook',
  9: 'transition hook', 10: 'app errorHandler', 11: 'app warnHandler', 12: 'ref function',
  13: 'async component loader', 14: 'scheduler flush', 15: 'component update', 16: 'app unmount cleanup',
  sp: 'serverPrefetch', bc: 'beforeCreate', c: 'created', bm: 'beforeMount', m: 'mounted',
  bu: 'beforeUpdate', u: 'updated', bum: 'beforeUnmount', um: 'unmounted',
  a: 'activated', da: 'deactivated', ec: 'errorCaptured', rtc: 'renderTracked', rtg: 'renderTriggered'
}

export function describeVueInfo (info: string): string {
  const code = /#runtime-(\w+)$/.exec(info)?.[1]
  return code != null ? (VUE_ERROR_SOURCES[code] ?? info) : info
}

/** 錯誤 → 單一字串:`[renderer-error] <where>(<info>)<名稱>: <訊息>` + 堆疊(縮排) */
export function formatRendererError (err: unknown, where: string, info?: string): string {
  let head: string
  let stack: string | undefined
  if (err instanceof Error) {
    head = `${err.name}: ${err.message}`
    stack = err.stack
  } else {
    try { head = typeof err === 'string' ? err : JSON.stringify(err) } catch { head = String(err) }
  }
  const lines = (stack ?? '').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith(head) && s !== head)
  const tail = lines.slice(0, MAX_STACK_LINES).map(s => `\n    ${s}`).join('')
  const more = lines.length > MAX_STACK_LINES ? `\n    …(另 ${lines.length - MAX_STACK_LINES} 行)` : ''
  return `[renderer-error] ${where}${info ? `(${describeVueInfo(info)})` : ''} ${head}${tail}${more}`
}

/**
 * Vue 的錯誤來源是否只是事件處理(點按鈕、懸停):這類錯誤只記 log,不把面板換成錯誤框。
 * 開發版 info 是文字(`component event handler`),正式版是錯誤碼網址(`…#runtime-5` / `-6`)。
 */
export function isEventHandlerError (info: string | undefined): boolean {
  if (!info) return false
  return /event handler/i.test(info) || /#runtime-(5|6)$/.test(info)
}

export function createErrorLogger (sink: ErrorSink = (line) => { console.error(line) }, now: () => number = Date.now) {
  const recent = new Map<string, number>()
  return function log (err: unknown, where: string, info?: string): string {
    const line = formatRendererError(err, where, info)
    const t = now()
    const prev = recent.get(line)
    if (prev == null || t - prev > DEDUPE_MS) sink(line)
    recent.set(line, t)
    if (recent.size > 50) recent.delete(recent.keys().next().value!)
    return line
  }
}

export const logRendererError = createErrorLogger()

/** `app.config.errorHandler`:沒被 ErrorBoundary 攔下的 Vue 錯誤(設定視窗、OCR 徽章…)。 */
export function installVueErrorHandler (app: App, log = logRendererError): void {
  app.config.errorHandler = (err, instance, info) => {
    log(err, `vue ${componentPath(instance)}`, info)
  }
}

interface ErrorTarget {
  addEventListener: (type: string, cb: (e: any) => void) => void // eslint-disable-line @typescript-eslint/no-explicit-any -- 事件型別隨全域物件而異(window / worker),此處只當最小介面用
}

/** `window` 未捕捉的例外 / Promise(只收冒泡到 window 的;圖片載入失敗不冒泡,不會進來)。 */
export function installWindowErrorLogging (target: ErrorTarget, log = logRendererError): void {
  target.addEventListener('error', (e: { error?: unknown, message?: string, filename?: string, lineno?: number }) => {
    const where = e.filename ? `uncaught ${e.filename.split('/').pop()}:${e.lineno ?? 0}` : 'uncaught'
    log(e.error ?? e.message ?? 'unknown error', where)
  })
  target.addEventListener('unhandledrejection', (e: { reason?: unknown }) => {
    log(e.reason, 'unhandledrejection')
  })
}
