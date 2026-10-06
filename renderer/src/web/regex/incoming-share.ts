/**
 * 一鍵從 PobTools 送正則分享碼(2026-10-07;main 端 `main/src/regex-share.ts`,規格 docs/regex-share-cli.md)。
 *
 * main 送來 `RegexShareRequest`(已過格式檢查的碼,或參數錯誤)→ 這裡解碼(`decodeShare`)、載清單、
 * 以與「貼上分享碼」相同的 `resolveState` 算出會套用什麼 → 進入 `confirm` 等使用者決定:
 * - 「套用」= `apply`(store `applySharedState` → `applyCombo`,與貼上分享碼完全相同:覆蓋該遊戲全部清單的勾選、
 *   自訂文字、排除詞與模式;找不到的項目照現有行為在面板提示回報);
 * - 「取消」= 什麼都不改。
 * 新的請求取代還沒決定的舊請求(舊請求解碼中途完成也丟掉)。
 *
 * 這支只依賴 vue 與 `@exile-appraiser/regex`(相依注入),renderer 單元測試直接跑;接線在 `incoming.ts`。
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { Mode, RegexGame, RegexPage, ResolvedState, ShareState } from '@exile-appraiser/regex'
import type { RegexShareErrorReason, RegexShareRequest } from '@ipc/types'

/** 某遊戲目前的勾選(頁 id → 勾選數)與自訂文字 / 排除詞數、模式 */
export interface CurrentCombo {
  pages: Array<{ id: string, n: number }>
  custom: number
  excludes: number
  mode: Mode
}

/** 確認對話框的內容 */
export interface ShareSummary {
  game: RegexGame
  mode: Mode
  /** 套用後有勾選的清單(頁 id;數值區用內部頁 id)與勾選數 */
  incoming: Array<{ id: string, n: number }>
  /** 目前有勾選、套用後會被覆蓋(換成分享碼的內容或清空)的清單 */
  replaced: Array<{ id: string, n: number }>
  custom: number
  excludes: number
  current: { custom: number, excludes: number, mode: Mode }
  /** 鍵還原不到的數量(跨賽季改了、另一版資料、物品詞綴頁鍵不互通) */
  missed: number
  /** 這個版本沒有的頁 id */
  unknownPages: string[]
  /** 解碼時的警告數(未知欄位等;內容只記 log) */
  warnings: number
}

export type IncomingErrorReason = RegexShareErrorReason | 'decode' | 'not-loaded'

export type IncomingView =
  | { phase: 'loading', id: number }
  | { phase: 'error', id: number, reason: IncomingErrorReason, detail: string }
  | { phase: 'confirm', id: number, state: ShareState, summary: ShareSummary }

export interface IncomingDeps {
  decode: (code: string) => Promise<{ state: ShareState, warnings: string[] }>
  /** 載好清單後的還原結果;清單載入失敗 = null */
  prepare: (s: ShareState) => Promise<{ pages: readonly RegexPage[], resolved: ResolvedState } | null>
  current: (game: RegexGame) => CurrentCombo
  apply: (s: ShareState) => void
  log: (msg: string) => void
}

/** ShareState + 還原結果 + 目前勾選 → 對話框內容(純函式) */
export function summarizeShare (s: ShareState, r: ResolvedState, cur: CurrentCombo, warnings: number): ShareSummary {
  const incoming = Object.entries(r.picks).filter(([, list]) => list.length > 0).map(([id, list]) => ({ id, n: list.length }))
  return {
    game: s.game,
    mode: s.mode,
    incoming,
    replaced: cur.pages.filter(p => p.n > 0),
    custom: s.custom.length,
    excludes: s.excludes.length,
    current: { custom: cur.custom, excludes: cur.excludes, mode: cur.mode },
    missed: r.missed,
    unknownPages: [...r.unknownPages],
    warnings
  }
}

export interface IncomingShare {
  view: ShallowRef<IncomingView | null>
  receive: (req: RegexShareRequest) => Promise<void>
  /** 套用目前確認中的分享碼;不在確認階段 = false(什麼都不做) */
  confirm: () => boolean
  /** 關掉對話框,不改任何狀態 */
  cancel: () => void
}

export function createIncomingShare (deps: IncomingDeps): IncomingShare {
  const view = shallowRef<IncomingView | null>(null)
  /** 最新一筆請求的 id;解碼完成時不是它 = 已被取代 / 取消,丟掉 */
  let current = -1

  async function receive (req: RegexShareRequest): Promise<void> {
    current = req.id
    if (req.error || !req.code) {
      const e = req.error ?? { reason: 'empty' as const, detail: '' }
      deps.log(`[regex-share] #${req.id} 參數不合格:${e.reason}(${e.detail})`)
      view.value = { phase: 'error', id: req.id, reason: e.reason, detail: e.detail }
      return
    }
    view.value = { phase: 'loading', id: req.id }
    let next: IncomingView
    try {
      const d = await deps.decode(req.code)
      const prep = await deps.prepare(d.state)
      if (!prep) {
        next = { phase: 'error', id: req.id, reason: 'not-loaded', detail: d.state.game }
      } else {
        if (d.warnings.length) deps.log(`[regex-share] #${req.id} 分享碼警告:${d.warnings.join(';')}`)
        const summary = summarizeShare(d.state, prep.resolved, deps.current(d.state.game), d.warnings.length)
        deps.log(`[regex-share] #${req.id} 等待確認(${d.state.game}:${summary.incoming.length} 份清單、找不到 ${summary.missed} 項)`)
        next = { phase: 'confirm', id: req.id, state: d.state, summary }
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      deps.log(`[regex-share] #${req.id} 無法解碼:${detail}`)
      next = { phase: 'error', id: req.id, reason: 'decode', detail }
    }
    if (current !== req.id) return
    view.value = next
  }

  function confirm (): boolean {
    const v = view.value
    if (!v || v.phase !== 'confirm') return false
    view.value = null
    current = -1
    deps.log(`[regex-share] #${v.id} 使用者確認套用`)
    deps.apply(v.state)
    return true
  }

  function cancel (): void {
    const v = view.value
    if (v) deps.log(`[regex-share] #${v.id} 關閉(${v.phase === 'confirm' ? '取消,不套用' : v.phase})`)
    view.value = null
    current = -1
  }

  return { view, receive, confirm, cancel }
}
