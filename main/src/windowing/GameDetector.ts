/**
 * PoE1 / PoE2 自動切換的偵測器。
 *
 * 為何不「換綁」而是「寫設定 + 重啟」:`electron-overlay-window` 的原生碼(`src/lib/windows.c:176`)用 `strcmp`
 * 精確比對**單一**視窗標題,且 `OverlayController.attachByTitle` 每個行程只能呼叫一次 → 同一行程不能同時綁兩款遊戲、
 * 也不能改綁。所以偵測到要換遊戲時,把 config.json 的 `game` 改掉後 `app.relaunch()`(overlay 是透明視窗,重啟無感)。
 * 詳見 `docs/game-auto-switch.md`。
 *
 * 判定:每 2 秒用 `desktopCapturer.getSources({ types: ['window'] })` 取所有頂層視窗名稱;
 * 某遊戲「存在」= 有名稱**完全等於** `windowTitleBy[game]` 的視窗(與原生碼的 strcmp 同語意)。
 * 目前遊戲不在、另一款在,**連續 2 次**成立才觸發;兩款都在或都不在 → 不動。
 * desktopCapturer 不列最小化視窗,候選成立時另以 PowerShell `Get-Process` 的 MainWindowTitle(含最小化)確認。
 */
import { desktopCapturer } from 'electron'
import { execFile } from 'node:child_process'
import type { GameId } from '@ipc/types'

export const GAMES: readonly GameId[] = ['poe1', 'poe2']
const INTERVAL_MS = 2000
const REQUIRED_HITS = 2
/**
 * 否決(視窗只是最小化)結果的沿用時間(code review 第 B 批):
 * - `VETO_MIN_MS` 內一律沿用,不看視窗清單(無關視窗標題常常在變 —— 瀏覽器分頁、播放器 —— 只看簽章最壞每 2 秒 spawn 一次 PowerShell);
 * - 之後到 `VETO_MS` 為止,視窗清單(標題集合)與否決當時相同才沿用,清單變了就重查;
 * - 目前遊戲的視窗 detach(`invalidateVeto`,遊戲被關掉)→ 立即失效,不必等滿 10 秒才切換。
 */
export const VETO_MIN_MS = 10_000
export const VETO_MS = 60_000
/** 目前遊戲在前景而跳過列舉時,連續跳過這麼多次就強制完整列舉一次(防 focus 狀態殘留)。 */
const MAX_FOREGROUND_SKIPS = 15

/**
 * 第 29 步效能診斷(`perf/perf-monitor.ts`)讀的模組層級計數:視窗列舉(`getSources`)與 PowerShell 行程標題確認的累計次數。
 * 只有 `++`,不建物件、不開計時器;診斷關著也照常累加(成本可忽略)。
 */
export const detectorCounters = { enums: 0, processProbes: 0 }

export interface GameDetectorOpts {
  /** 目前綁定(overlay)或使用中(window)的遊戲。 */
  currentGame: () => GameId
  windowTitleBy: () => Record<GameId, string>
  onSwitch: (game: GameId) => void
  /**
   * overlay 模式下「目前綁定的遊戲視窗正在前景」。為 true 時視窗必定存在(且未最小化)→ 判定必為「不切換」,
   * 該 tick 跳過視窗列舉與 PowerShell。沒提供 / window 模式回 false。
   */
  isCurrentGameForeground?: () => boolean
  /** 測試注入:頂層視窗名稱 / 行程視窗標題 / 時鐘。 */
  listWindowNames?: () => Promise<string[]>
  processTitles?: () => Promise<string[] | null>
  now?: () => number
}

async function listWindowNamesDefault (): Promise<string[]> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  })
  return sources.map(s => s.name)
}

/** 視窗清單(標題集合)的簽章,順序與重複無關。 */
export function namesSignature (names: readonly string[]): string {
  return [...new Set(names)].sort().join('\0')
}

/** 純函式:給定視窗名稱清單,回傳「應切換到哪款遊戲」(不切換 → null)。 */
export function decideSwitch (names: readonly string[], current: GameId, titles: Record<GameId, string>): GameId | null {
  const present = (g: GameId) => titles[g] !== '' && names.includes(titles[g])
  const other = GAMES.find(g => g !== current)!
  // 兩款標題設成一樣就無從分辨,不動
  if (titles[current] === titles[other]) return null
  return !present(current) && present(other) ? other : null
}

/** 各行程主視窗標題(含最小化視窗)。失敗回 null(呼叫端退回只用 desktopCapturer)。 */
function processWindowTitles (): Promise<string[] | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const script = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Where-Object MainWindowTitle | Select-Object -ExpandProperty MainWindowTitle'
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' },
      (err, stdout) => {
        if (err) { console.warn('[detect] 取行程視窗標題失敗,只用 desktopCapturer 判定', err.message); resolve(null); return }
        resolve(stdout.split(/\r?\n/).filter(Boolean))
      })
  })
}

export class GameDetector {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private candidate: GameId | null = null
  private hits = 0
  private fired = false
  /** 最近一次「最小化否決」:當時的視窗清單簽章與時間。 */
  private veto: { sig: string, at: number } | null = null
  private fgSkips = 0

  constructor (private opts: GameDetectorOpts) {}

  get running (): boolean { return this.timer != null }

  start () {
    if (this.timer) return
    console.log(`[detect] 啟動遊戲視窗偵測(每 ${INTERVAL_MS / 1000} 秒,連續 ${REQUIRED_HITS} 次才切換)`)
    this.fired = false
    this.timer = setInterval(() => { void this.tick() }, INTERVAL_MS)
  }

  stop () {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.candidate = null
    this.hits = 0
    this.fgSkips = 0
    console.log('[detect] 停止遊戲視窗偵測')
  }

  /**
   * 目前綁定的遊戲視窗 detach(視窗關閉)→ 「只是最小化」的否決立即失效,下一個 tick 重新確認
   * (最小化之後被關掉的情況,不必等 10 秒下限 / 60 秒沿用期滿)。
   */
  invalidateVeto () {
    if (this.veto) console.log('[detect] 遊戲視窗 detach,最小化否決作廢')
    this.veto = null
  }

  /** window 模式切完遊戲後繼續偵測(overlay 模式觸發後就重啟了)。 */
  rearm () {
    this.fired = false
    this.candidate = null
    this.hits = 0
  }

  /** 單次偵測(timer 呼叫;測試直接呼叫)。 */
  async tick () {
    if (this.busy || this.fired) return
    this.busy = true
    try {
      // 目前遊戲在前景 → 視窗必在 → 原判斷必為 null(並重置連續計數)。直接跳過列舉,計數照原行為重置。
      if (this.opts.isCurrentGameForeground?.() && this.fgSkips < MAX_FOREGROUND_SKIPS) {
        this.fgSkips++
        if (this.candidate) console.log(`[detect] 條件不再成立,取消切換到 ${this.candidate}`)
        this.candidate = null
        this.hits = 0
        return
      }
      this.fgSkips = 0
      const now = this.opts.now ?? Date.now
      detectorCounters.enums++
      const names = await (this.opts.listWindowNames ?? listWindowNamesDefault)()
      const current = this.opts.currentGame()
      const titles = this.opts.windowTitleBy()
      let target = decideSwitch(names, current, titles)
      if (target != null) {
        // desktopCapturer 不列**最小化**的視窗(實測);全螢幕 PoE 切出去會最小化 → 誤判「目前遊戲不在」。
        // 候選成立時再用行程主視窗標題(含最小化)確認一次;只在候選時跑,平常不 spawn。
        // 確認後否決的:10 秒內一律沿用;之後「視窗清單(標題集合)不變」才沿用到 60 秒(視窗一直最小化時不必反覆 spawn PowerShell);
        // 遊戲視窗 detach 時 invalidateVeto() 立即作廢。
        const sig = namesSignature(names)
        const age = this.veto ? now() - this.veto.at : Infinity
        if (this.veto && age >= 0 && (age < VETO_MIN_MS || (this.veto.sig === sig && age < VETO_MS))) {
          target = null
        } else {
          this.veto = null
          detectorCounters.processProbes++
          const extra = await (this.opts.processTitles ?? processWindowTitles)()
          if (extra) {
            target = decideSwitch([...names, ...extra], current, titles)
            if (target == null) {
              console.log(`[detect] ${current} 視窗「${titles[current]}」只是最小化(行程視窗標題仍在),不切換`)
              this.veto = { sig, at: now() }
            }
          }
        }
      }
      if (target == null) {
        if (this.candidate) console.log(`[detect] 條件不再成立,取消切換到 ${this.candidate}`)
        this.candidate = null
        this.hits = 0
        return
      }
      if (this.candidate !== target) { this.candidate = target; this.hits = 0 }
      this.hits++
      console.log(`[detect] ${current} 視窗「${titles[current]}」不在、${target} 視窗「${titles[target]}」在(${this.hits}/${REQUIRED_HITS})`)
      if (this.hits >= REQUIRED_HITS) {
        this.fired = true
        console.log(`[detect] 偵測到 ${target} 視窗、${current} 不在 → 切換到 ${target}`)
        this.opts.onSwitch(target)
      }
    } catch (e) {
      console.error('[detect] 取視窗清單失敗', e)
    } finally {
      this.busy = false
    }
  }
}
