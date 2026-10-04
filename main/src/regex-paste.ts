/**
 * 第 33 步(2026-10-04,使用者裁定):正則書籤「一鍵貼進遊戲」—— 複製搜尋字串 + 自動貼進遊戲搜尋列。
 *
 * 流程(一次點擊 / 一次熱鍵 = 一次搜尋動作):
 * 1. 判斷能不能貼(`regexPasteBlock`):視窗模式 / 沒有附著的遊戲視窗 / 遊戲與 overlay 都不在前景 → **只複製**並回原因(呼叫端提示);
 *    上一次還在送(`busy`)→ 什麼都不做(不重入,避免兩組按鍵交錯);字串空白 → 不複製。
 * 2. overlay 有焦點(從設定視窗旁的書籤列 / 快速面板點的)→ `focusGame`(= `OverlayWindow.assertGameActive`,
 *    electron-overlay-window `focusTarget`)→ 每 `FOCUS_POLL_MS` 看一次遊戲有沒有真的取得前景(`targetHasFocus`),
 *    最多等 `FOCUS_TIMEOUT_MS`;等不到 → 只複製(`focus-timeout`),**不對別的視窗送鍵**。取得後再等 `SETTLE_MS` 讓遊戲處理焦點。
 *    書籤熱鍵(遊戲本來就在前景)不必等。
 * 3. 寫剪貼簿(**不還原**:使用者要的是「複製 + 貼上」,之後還能自己再貼;`restoreClipboard` 只管查價 / 聊天指令)→
 *    沿用倉庫搜尋的按鍵序列 `stashSearchSequence`(Ctrl+F → Ctrl+V → Enter,`text-box.ts`)。
 * 4. 送鍵期間(含之後 `CTRL_QUIET_MS`)請倉庫頁籤捲動忽略 Ctrl 狀態變化(`quietCtrl`,第五輪 30.1 的 Ctrl 輪詢器會看到我們自己送的 Ctrl,
 *    不忽略的話會為了這一下去掛 uiohook 掛鉤)。
 *
 * 純邏輯:不 import electron / uiohook;剪貼簿、送鍵、焦點、計時全部注入(測試 `main/test/regex-paste.test.ts` 用假的,**不送任何真實輸入**)。
 */
import type { RegexPasteReason, RegexPasteResult, WindowMode } from '@ipc/types'
import { stashSearchSequence, type TextBoxKey } from './text-box'

/** 交還焦點後等遊戲真的取得前景的上限 */
export const FOCUS_TIMEOUT_MS = 800
export const FOCUS_POLL_MS = 20
/** 遊戲取得前景後再等一下才送 Ctrl+F(剛切回來的第一幀遊戲可能還沒處理輸入焦點) */
export const SETTLE_MS = 80
/** 送完鍵後多久才恢復倉庫頁籤捲動對 Ctrl 的反應(Ctrl 輪詢器 50 ms 一次 + 管線) */
export const CTRL_QUIET_MS = 250

export interface RegexPasteEnv {
  mode: WindowMode
  /** 有附著的遊戲視窗(electron-overlay-window attach 之後、detach 之前) */
  attached: boolean
  /** 遊戲視窗在前景(`targetHasFocus`) */
  gameFocused: boolean
  /** overlay 有焦點(設定 / 快速面板開著;交還焦點後遊戲會回到前景) */
  overlayInteractable: boolean
  busy: boolean
}

/** 不能貼的原因;null = 可以貼 */
export function regexPasteBlock (env: RegexPasteEnv, text: string): RegexPasteReason | null {
  if (!text.trim()) return 'empty'
  if (env.busy) return 'busy'
  if (env.mode !== 'overlay') return 'window-mode'
  if (!env.attached) return 'no-game'
  if (!env.gameFocused && !env.overlayInteractable) return 'game-inactive'
  return null
}

/** 這個原因要不要先複製(空字串 / 正在送 = 不動剪貼簿) */
export function copiesOnBlock (reason: RegexPasteReason): boolean {
  return reason !== 'empty' && reason !== 'busy'
}

export interface RegexPasteDeps {
  env: () => Omit<RegexPasteEnv, 'busy'>
  writeClipboard: (text: string) => void
  tap: (key: TextBoxKey, mods: TextBoxKey[]) => void
  /** overlay → 遊戲(`OverlayWindow.assertGameActive`) */
  focusGame: () => void
  /** 遊戲視窗目前在前景(`GameWindow.targetHasFocus`) */
  gameFocused: () => boolean
  sleep?: (ms: number) => Promise<void>
  /** 送鍵期間請倉庫頁籤捲動忽略 Ctrl(`StashScroll.quietCtrl`) */
  quietCtrl?: (on: boolean) => void
  platform?: string
  log?: (msg: string) => void
}

export class RegexPaster {
  private busy = false
  private readonly sleep: (ms: number) => Promise<void>
  private readonly log: (msg: string) => void
  private quietTimer: Promise<void> | null = null

  constructor (private readonly deps: RegexPasteDeps) {
    this.sleep = deps.sleep ?? (async (ms) => { await new Promise<void>(resolve => setTimeout(resolve, ms)) })
    this.log = deps.log ?? (() => {})
  }

  get isBusy (): boolean { return this.busy }

  async paste (text: string): Promise<RegexPasteResult> {
    const block = regexPasteBlock({ ...this.deps.env(), busy: this.busy }, text)
    if (block) {
      const copied = copiesOnBlock(block)
      if (copied) this.deps.writeClipboard(text)
      this.log(`[regex-quick] 只${copied ? '複製' : '略過'}(${block})`)
      return { pasted: false, copied, reason: block }
    }
    this.busy = true
    try {
      if (!this.deps.gameFocused()) {
        this.deps.focusGame()
        let waited = 0
        while (!this.deps.gameFocused() && waited < FOCUS_TIMEOUT_MS) {
          await this.sleep(FOCUS_POLL_MS)
          waited += FOCUS_POLL_MS
        }
        if (!this.deps.gameFocused()) {
          this.deps.writeClipboard(text)
          this.log(`[regex-quick] 等不到遊戲取得前景(${FOCUS_TIMEOUT_MS} ms),只複製`)
          return { pasted: false, copied: true, reason: 'focus-timeout' }
        }
        await this.sleep(SETTLE_MS)
        // 等待期間使用者切走了 → 不送(按鍵會進別的視窗)
        if (!this.deps.gameFocused()) {
          this.deps.writeClipboard(text)
          return { pasted: false, copied: true, reason: 'focus-timeout' }
        }
      }
      this.deps.quietCtrl?.(true)
      const seq = stashSearchSequence(text, this.deps.platform)
      this.deps.writeClipboard(seq.clipboard)
      for (const k of seq.keys) this.deps.tap(k.key, k.mods)
      this.log(`[regex-quick] 已送 Ctrl+F → 貼上 → Enter(${[...text].length} 字)`)
      return { pasted: true }
    } finally {
      this.busy = false
      this.releaseQuiet()
    }
  }

  private releaseQuiet (): void {
    if (!this.deps.quietCtrl) return
    const p = this.sleep(CTRL_QUIET_MS).then(() => {
      if (this.quietTimer === p && !this.busy) this.deps.quietCtrl?.(false)
    })
    this.quietTimer = p
  }
}

// ---- 書籤熱鍵的提示(書籤列 / 快速面板由 renderer 自己顯示;熱鍵沒有 overlay 介面可畫,用右下角提示視窗) ----

export type RegexToastLang = 'cmn-Hant' | 'en'

const REASON_TEXT: Readonly<Record<RegexToastLang, Record<RegexPasteReason | 'missing', string>>> = {
  'cmn-Hant': {
    'window-mode': '視窗模式不會自動貼上,已複製',
    'no-game': '找不到遊戲視窗,已複製',
    'game-inactive': '遊戲不在前景,已複製',
    'focus-timeout': '遊戲沒有取得焦點,已複製',
    busy: '上一次還在輸入,略過',
    empty: '書籤沒有產生任何搜尋字串',
    missing: '書籤已不存在或清單載入失敗'
  },
  en: {
    'window-mode': 'Window mode does not paste automatically — copied',
    'no-game': 'Game window not found — copied',
    'game-inactive': 'Game is not in the foreground — copied',
    'focus-timeout': 'Game did not get focus — copied',
    busy: 'Still typing the previous search — skipped',
    empty: 'This bookmark produces no search text',
    missing: 'Bookmark no longer exists or the lists failed to load'
  }
}

/** 書籤熱鍵沒貼成的提示(第一行 = 書籤名,第二行 = 原因;`kind: 'scan'` 同字級兩行) */
export function regexToastMessage (lang: RegexToastLang, name: string, reason: RegexPasteReason | 'missing'): { lang: RegexToastLang, kind: 'scan', title: string, hint: string } {
  const head = lang === 'en' ? `Regex bookmark "${name}"` : `正則書籤「${name}」`
  return { lang, kind: 'scan', title: head, hint: REASON_TEXT[lang][reason] }
}
