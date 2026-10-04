/**
 * 第 34 步(2026-10-04 使用者需求):有新版本時每 10 分鐘提醒一次(純邏輯,不 import electron;`main/test/update-reminder.test.ts` 測)。
 * 視窗(右下角可點擊的提示)在 `main.ts` 的 `showUpdateReminder`;這裡只決定「要不要、什麼時候、提醒什麼」與頁面 HTML。
 *
 * - 提醒什麼(`reminderTarget`):`downloaded` → 立即更新 = 安裝(`autoUpdate` 開時就是 `quitAndInstall(true, true)`);
 *   `available` 安裝版(`autoUpdate` 關)→ 開設定 › 更新與關於並開始下載;`available` portable(`not-supported`)→ 開 Releases 頁。
 *   其他狀態(還沒檢查、已是最新、下載中、`--no-updates`)= 沒有東西可提醒,**絕不彈**。`checking` / `error` 是暫時狀態:沿用上一個目標。
 * - 什麼時候(`UpdateReminderScheduler`):偵測到新版(或版號變了)→ 立刻一次,之後每 `UPDATE_REMINDER_INTERVAL_MS`(10 分鐘);
 *   「稍後」/ 自動淡出 = 10 分鐘後再提醒;「略過此版本」= 同版號不再提醒(新版號照常);設定 `updateReminder` 關、
 *   預覽 / 自我測試(`blocked`)、已開始安裝(`stop()`)不彈。畫面上有其他提示(啟動提示、辨識開關通知…)時延後重試,不互相覆蓋。
 * - 常駐期間定期重新檢查更新在 `updater-core.ts` `shouldPeriodicCheck` / `UpdaterCore.periodicCheck`(每 2 小時)。
 */
import type { UpdaterInfo } from '@ipc/types'
import { RELEASES_URL } from './updater-core'
import { TOAST_FADE_MS, TOAST_MARGIN, compareVersions, escapeHtml, type ToastLang } from './startup-toast'

/** 兩次提醒的間隔(「稍後」與自動淡出都從關閉時起算)。 */
export const UPDATE_REMINDER_INTERVAL_MS = 10 * 60_000
/** 提醒在畫面上停留多久開始淡出(滑鼠停在上面時暫停計時)。 */
export const UPDATE_REMINDER_VISIBLE_MS = 8000
/** 畫面上有其他提示時,隔多久再試一次。 */
export const UPDATE_REMINDER_RETRY_MS = 1500
/** 提醒視窗大小(DIP;比一般提示高,多一列按鈕)。英文最長一行不截斷(`--toast-selftest --toast-update=…` 截圖驗過)。 */
export const UPDATE_REMINDER_SIZE = { width: 460, height: 112 } as const

export type ReminderAction = 'install' | 'download' | 'releases'
export interface ReminderTarget {
  version: string
  action: ReminderAction
  /** 新版的 Release 頁(portable「前往 Releases」用)。 */
  url: string
  /** `autoUpdate`(install 的說明文字:開 = 不按也會在結束程式時套用)。 */
  autoUpdate: boolean
}

/**
 * 由更新狀態推出要提醒什麼;`null` = 沒有新版 / 不該提醒。
 * 版號必須比目前版本新(electron-updater 本來就只回報較新的,這裡再擋一次)。
 */
export function reminderTarget (info: UpdaterInfo): ReminderTarget | null {
  if (info.reason === 'disabled-by-flag') return null
  const version = info.version
  if (!version) return null
  if (info.currentVersion && compareVersions(version, info.currentVersion) !== 1) return null
  const url = info.releaseNotesUrl ?? RELEASES_URL
  const autoUpdate = info.autoUpdate !== false
  if (info.state === 'downloaded') return { version, action: 'install', url, autoUpdate }
  if (info.state === 'available') return { version, action: info.reason === 'not-supported' ? 'releases' : 'download', url, autoUpdate }
  return null
}

/** `checking` / `error`:暫時狀態(定期重新檢查中、網路斷一下),沿用上一個提醒目標;其他狀態以這次的為準。 */
export function isTransientUpdaterState (state: UpdaterInfo['state']): boolean {
  return state === 'checking' || state === 'error'
}

/** 設定 `updateSkippedVersion` 正規化:`x.y.z`(可帶後綴,最多 40 字)才算數,其他 → null。main / renderer 同規則。 */
export function normSkippedVersion (v: unknown): string | null {
  return typeof v === 'string' && v.length <= 40 && /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/.test(v) ? v : null
}

export type ReminderCloseReason = 'timeout' | 'later' | 'skip' | 'action' | 'interrupted'

export interface ReminderTimers {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
}

export interface UpdateReminderDeps {
  timers: ReminderTimers
  /** 畫面上沒有其他提示(啟動提示 / 辨識開關通知 / 正則貼上提示)時才能顯示。 */
  canShow: () => boolean
  /** 顯示提醒視窗;關閉時(按鈕 / 淡出 / 被其他提示打斷)呼叫 `closed(reason)`。 */
  show: (target: ReminderTarget) => void
  /** 收回畫面上的提醒(目標消失、設定關掉、停止)。 */
  hide: () => void
  /** 「略過此版本」要存進設定(main 交給 renderer 寫 config.json)。 */
  persistSkip: (version: string) => void
  log?: (msg: string) => void
  intervalMs?: number
  retryMs?: number
}

/**
 * 提醒排程。狀態只有:目前目標、設定(開關 / 略過的版號)、是否被擋(預覽 / 還沒收到設定)、下一次時間、畫面上有沒有。
 * 每次狀態改變都 `reschedule()`(清掉舊計時器,依 `nextAt` 重設);畫面上有提醒時不排計時器,關閉才排下一次。
 */
export class UpdateReminderScheduler {
  private target: ReminderTarget | null = null
  private enabled = true
  private skipped: string | null = null
  private blocked = true
  private stopped = false
  private visible = false
  private nextAt: number | null = null
  private timer: unknown = null
  private readonly intervalMs: number
  private readonly retryMs: number
  private readonly log: (msg: string) => void
  /** 顯示次數(測試 / log 用)。 */
  shownCount = 0

  constructor (private readonly deps: UpdateReminderDeps) {
    this.intervalMs = deps.intervalMs ?? UPDATE_REMINDER_INTERVAL_MS
    this.retryMs = deps.retryMs ?? UPDATE_REMINDER_RETRY_MS
    this.log = deps.log ?? (() => {})
  }

  get current (): ReminderTarget | null { return this.target }
  get isVisible (): boolean { return this.visible }
  get nextReminderAt (): number | null { return this.eligible() ? this.nextAt : null }

  /** 這個目標現在能不能提醒(不看「畫面上有其他提示」與時間)。 */
  eligible (): boolean {
    const t = this.target
    return t != null && this.enabled && !this.blocked && !this.stopped && t.version !== this.skipped
  }

  /** 每次 `updater-state` 都呼叫。 */
  setInfo (info: UpdaterInfo): void {
    if (isTransientUpdaterState(info.state)) return
    const next = reminderTarget(info)
    const prev = this.target
    this.target = next
    if (!next) {
      if (prev) this.log(`[update-reminder] 沒有可提醒的新版(state=${info.state}),停止提醒`)
      this.nextAt = null
      this.hideIfVisible()
      this.reschedule()
      return
    }
    if (!prev || prev.version !== next.version || prev.action !== next.action) {
      // 偵測到新版 / 版號變了 / 從「可下載」變成「已下載」→ 立刻提醒一次(畫面上的舊內容收回重開)
      this.log(this.eligible()
        ? `[update-reminder] 新版 v${next.version}(${next.action})→ 立刻提醒,之後每 ${Math.round(this.intervalMs / 1000)} 秒`
        : `[update-reminder] 新版 v${next.version}(${next.action}),目前不提醒(${next.version === this.skipped ? '已略過此版本' : !this.enabled ? '設定關閉' : '預覽 / 尚未就緒'})`)
      this.nextAt = this.deps.timers.now()
      this.hideIfVisible()
    }
    this.reschedule()
  }

  /** 設定 `updateReminder` / `updateSkippedVersion`(每次 host-config 都會來;沒變不做事)。 */
  setConfig (cfg: { enabled: boolean, skippedVersion: string | null }): void {
    const skipped = normSkippedVersion(cfg.skippedVersion)
    // main 端剛按了「略過」、renderer 還沒存檔回來 → 不被舊值蓋掉(只會往「有略過」的方向更新)
    const nextSkipped = skipped ?? this.skipped
    if (cfg.enabled === this.enabled && nextSkipped === this.skipped) return
    this.enabled = cfg.enabled
    this.skipped = nextSkipped
    this.log(`[update-reminder] 設定 updateReminder=${String(cfg.enabled)} skipped=${nextSkipped ?? '(none)'}`)
    if (!this.eligible()) this.hideIfVisible()
    else if (this.nextAt == null) this.nextAt = this.deps.timers.now()
    this.reschedule()
  }

  /** 預覽啟動 / 還沒收到 Electron 視窗的設定 → 擋住。 */
  setBlocked (blocked: boolean): void {
    if (blocked === this.blocked) return
    this.blocked = blocked
    if (blocked) this.hideIfVisible()
    this.reschedule()
  }

  /** 開始安裝 / 程式結束中:之後一律不再提醒。 */
  stop (): void {
    if (this.stopped) return
    this.stopped = true
    this.hideIfVisible()
    this.clearTimer()
    this.log('[update-reminder] 停止(安裝 / 結束程式)')
  }

  /** 使用者按「略過此版本」。 */
  skip (): void {
    const t = this.target
    if (!t) return
    this.skipped = t.version
    this.log(`[update-reminder] 略過 v${t.version}(同版號不再提醒)`)
    this.deps.persistSkip(t.version)
    this.closed('skip')
  }

  /** 提醒視窗關閉(按鈕 / 淡出 / 被其他提示打斷)。 */
  closed (reason: ReminderCloseReason): void {
    if (!this.visible && reason !== 'skip') return
    this.visible = false
    const now = this.deps.timers.now()
    if (reason === 'interrupted') this.nextAt = now + this.retryMs
    else if (reason !== 'skip') this.nextAt = now + this.intervalMs
    this.log(`[update-reminder] 關閉(${reason})${this.eligible() && this.nextAt != null ? `,${Math.round((this.nextAt - now) / 1000)} 秒後再提醒` : ''}`)
    this.reschedule()
  }

  private hideIfVisible (): void {
    if (!this.visible) return
    this.visible = false
    this.deps.hide()
  }

  private clearTimer (): void {
    if (this.timer != null) { this.deps.timers.clearTimeout(this.timer); this.timer = null }
  }

  private reschedule (): void {
    this.clearTimer()
    if (!this.eligible() || this.visible || this.nextAt == null) return
    const delay = Math.max(0, this.nextAt - this.deps.timers.now())
    this.timer = this.deps.timers.setTimeout(() => { this.timer = null; this.fire() }, delay)
  }

  private fire (): void {
    const t = this.target
    if (!t || !this.eligible() || this.visible) return
    if (!this.deps.canShow()) {
      // 其他提示還在畫面上(啟動提示、辨識開關通知…):等它結束再顯示,不互相覆蓋
      this.nextAt = this.deps.timers.now() + this.retryMs
      this.reschedule()
      return
    }
    this.visible = true
    this.shownCount++
    this.log(`[update-reminder] 顯示提醒 #${this.shownCount} v${t.version}(${t.action})`)
    this.deps.show(t)
  }
}

/** 淡出計時:只累計滑鼠不在提醒上的時間,滿 `visibleMs` 開始淡出、再 `TOAST_FADE_MS` 關閉(與 CSS `animation-play-state: paused` 同步)。 */
export class HoverPausedCountdown {
  private elapsed = 0
  constructor (private readonly visibleMs = UPDATE_REMINDER_VISIBLE_MS, private readonly fadeMs = TOAST_FADE_MS) {}
  /** 前進 `dtMs`(滑鼠停在上面時不前進);回傳是否已經到「可以銷毀」。 */
  advance (dtMs: number, hovered: boolean): boolean {
    if (!hovered && dtMs > 0) this.elapsed += dtMs
    return this.done
  }

  get done (): boolean { return this.elapsed >= this.visibleMs + this.fadeMs }
  get elapsedMs (): number { return this.elapsed }
}

/** 游標(DIP)是否在視窗範圍內。 */
export function pointInBounds (p: { x: number, y: number }, b: { x: number, y: number, width: number, height: number }): boolean {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
}

const REMINDER_STRINGS: Readonly<Record<ToastLang, {
  title: Record<ReminderAction, string>
  hint: { install: string, installManual: string, download: string, releases: string }
  now: string, releases: string, later: string, skip: string
}>> = {
  'cmn-Hant': {
    title: { install: '流亡鑑價 v{v} 已下載,可以更新', download: '流亡鑑價有新版本 v{v}', releases: '流亡鑑價有新版本 v{v}' },
    hint: {
      install: '立即更新會重新啟動程式;不按也會在結束程式時自動套用',
      installManual: '按「立即更新」重新啟動並安裝新版',
      download: '立即更新會開啟設定 › 更新與關於並開始下載',
      releases: '免安裝版請到 Releases 頁下載新版'
    },
    now: '立即更新',
    releases: '前往 Releases',
    later: '稍後',
    skip: '略過此版本'
  },
  en: {
    title: { install: 'ExileAppraiser v{v} is ready to install', download: 'ExileAppraiser v{v} is available', releases: 'ExileAppraiser v{v} is available' },
    hint: {
      install: 'Update now restarts the app; otherwise it installs when you quit',
      installManual: 'Update now restarts the app and runs the installer',
      download: 'Update now opens Settings › Updates & about and starts the download',
      releases: 'Download the portable build from the Releases page'
    },
    now: 'Update now',
    releases: 'Open Releases',
    later: 'Later',
    skip: 'Skip this version'
  }
}

export interface ReminderMessage {
  lang: ToastLang
  title: string
  hint: string
  primary: string
  later: string
  skip: string
}

export function reminderMessage (lang: ToastLang, t: ReminderTarget): ReminderMessage {
  const S = REMINDER_STRINGS[lang]
  const hint = t.action === 'install' ? (t.autoUpdate ? S.hint.install : S.hint.installManual) : S.hint[t.action]
  return {
    lang,
    title: S.title[t.action].replace('{v}', t.version),
    hint,
    primary: t.action === 'releases' ? S.releases : S.now,
    later: S.later,
    skip: S.skip
  }
}

/**
 * 頁面按鈕的連結(頁面本身沒有腳本):點擊 = 導覽到 `https://ppz-reminder.invalid/<動作>`(`.invalid` 保留網域,永遠不會真的連線),
 * main 在 `will-navigate` 攔下(preventDefault)並依網址判斷按了哪個。
 * ⚠ 不用同頁錨點 `#…`:data: URL 頁面的錨點導覽不發 `did-navigate-in-page`(2026-10-04 dev 實測,按鈕完全沒反應)。
 */
export type ReminderButton = 'now' | 'later' | 'skip'
export const REMINDER_BUTTON_ORIGIN = 'https://ppz-reminder.invalid/'
export const REMINDER_BUTTON_URL: Readonly<Record<ReminderButton, string>> = {
  now: `${REMINDER_BUTTON_ORIGIN}now`,
  later: `${REMINDER_BUTTON_ORIGIN}later`,
  skip: `${REMINDER_BUTTON_ORIGIN}skip`
}

/** `will-navigate` 的網址 → 哪個按鈕;不是我們的按鈕網址 → null。 */
export function reminderButtonFromUrl (url: string): ReminderButton | null {
  for (const [k, v] of Object.entries(REMINDER_BUTTON_URL) as Array<[ReminderButton, string]>) if (url === v) return k
  return null
}

/**
 * 提醒頁 HTML:配色、字型與 `toastHtml` 相同(深色島);無腳本、CSP `default-src 'none'`;
 * 按鈕是 `REMINDER_BUTTON_URL` 連結(main `will-navigate` 攔下);滑鼠停在提醒上時 CSS 動畫暫停(淡出跟著停,main 的計時也暫停)。`animate: false` 給自我測試截圖。
 */
export function reminderHtml (msg: ReminderMessage, iconDataUrl: string | null, opts: { animate?: boolean, visibleMs?: number } = {}): string {
  const animate = opts.animate !== false
  const visibleMs = opts.visibleMs ?? UPDATE_REMINDER_VISIBLE_MS
  const icon = iconDataUrl && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(iconDataUrl)
    ? `<img class="icon" src="${iconDataUrl}" alt="">`
    : ''
  const anim = animate
    ? `animation: toast-in .22s ease-out both, toast-out ${TOAST_FADE_MS}ms ease-in ${visibleMs}ms forwards;`
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
  .toast { display: flex; align-items: flex-start; gap: 12px; width: 100%; height: 100%; box-sizing: border-box;
    padding: 10px 14px; border-radius: 8px; background: #192029; border: 1px solid #3a4554;
    border-left: 3px solid #d8aa4b; color: #ece6d8; box-shadow: 0 2px 6px rgba(0, 0, 0, .45); ${anim} }
  .toast:hover { animation-play-state: paused; }
  .icon { width: 36px; height: 36px; flex: none; margin-top: 2px; }
  .text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .title { font-size: 14px; font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { font-size: 12px; line-height: 1.3; color: #c3bfb4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .btns { display: flex; gap: 8px; margin-top: 6px; }
  .btn { display: inline-block; padding: 3px 12px; border-radius: 4px; font-size: 12px; line-height: 1.5; text-decoration: none;
    color: #ece6d8; background: #232c38; border: 1px solid #3a4554; cursor: pointer; white-space: nowrap; }
  .btn:hover { background: #2c3746; border-color: #58677a; }
  .btn.primary { background: #d8aa4b; border-color: #d8aa4b; color: #1a1408; font-weight: 600; }
  .btn.primary:hover { background: #e6bb5f; border-color: #e6bb5f; }
  .btn.ghost { background: transparent; border-color: transparent; color: #c3bfb4; }
  .btn.ghost:hover { color: #ece6d8; border-color: #3a4554; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes toast-out { from { opacity: 1; } to { opacity: 0; } }
</style>
</head>
<body>
<div class="toast" data-toast="update">${icon}<div class="text"><div class="title" data-toast="title">${escapeHtml(msg.title)}</div><div class="hint" data-toast="hint">${escapeHtml(msg.hint)}</div><div class="btns"><a class="btn primary" data-btn="now" href="${REMINDER_BUTTON_URL.now}" draggable="false">${escapeHtml(msg.primary)}</a><a class="btn" data-btn="later" href="${REMINDER_BUTTON_URL.later}" draggable="false">${escapeHtml(msg.later)}</a><a class="btn ghost" data-btn="skip" href="${REMINDER_BUTTON_URL.skip}" draggable="false">${escapeHtml(msg.skip)}</a></div></div></div>
</body>
</html>`
}

/** 右下角位置(同一般提示的邊距;高度不同)。 */
export function reminderBounds (workArea: { x: number, y: number, width: number, height: number }): { x: number, y: number, width: number, height: number } {
  const { width, height } = UPDATE_REMINDER_SIZE
  return {
    x: Math.round(workArea.x + workArea.width - width - TOAST_MARGIN),
    y: Math.round(workArea.y + workArea.height - height - TOAST_MARGIN),
    width,
    height
  }
}
