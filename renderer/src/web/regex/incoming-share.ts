/**
 * 一鍵從 PobTools 送正則分享碼 / 書籤包(2026-10-07;main 端 `main/src/regex-share.ts`,規格 docs/regex-share-cli.md)。
 *
 * main 送來 `RegexShareRequest`(已過格式檢查的碼,或參數錯誤),依 `kind` 分兩條路,共用錯誤畫面:
 * - `share`(`--regex-share`):解碼(`decodeShare`)、載清單、以與「貼上分享碼」相同的 `resolveState` 算出會套用什麼 → `confirm`;
 *   「套用」= `apply`(store `applySharedState` → `applyCombo`:覆蓋該遊戲全部清單的勾選、自訂文字、排除詞與模式)。
 * - `bookmarks`(`--regex-bookmarks`,第 40 步):解碼(`decodeBookmarks`)、載相關遊戲的清單、預覽合併(`mergeBookmarks`)→ `confirm-bookmarks`;
 *   「加入」= `applyBookmarks`(store `addBookmarksFromPack`:加進書籤、不動勾選;同名改名「 (2)」…)。
 * 「取消」= 什麼都不改。新的請求取代還沒決定的舊請求(舊請求解碼中途完成也丟掉)。
 *
 * 這支只依賴 vue 與 `@exile-appraiser/regex`(相依注入),renderer 單元測試直接跑;接線在 `incoming.ts`。
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { BookmarkPack, MergeResult, Mode, RegexGame, RegexPage, ResolvedState, ShareState } from '@exile-appraiser/regex'
import type { RegexShareErrorReason, RegexShareRequest } from '@ipc/types'

/** 某遊戲目前的勾選(頁 id → 勾選數)與自訂文字 / 排除詞數、模式 */
export interface CurrentCombo {
  pages: Array<{ id: string, n: number }>
  custom: number
  excludes: number
  mode: Mode
}

/** 確認對話框的內容(分享碼) */
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

/** 確認對話框的內容(書籤包):依遊戲 → 資料夾分組 */
export interface BookmarkSummary {
  games: Array<{
    game: RegexGame
    folders: Array<{
      /** '' = 未分類 */
      folder: string
      /** 這次新建的資料夾 */
      isNew: boolean
      items: Array<{ name: string, originalName: string, page: string, missed: number }>
    }>
  }>
  total: number
  renamed: number
  /** 有找不到項目的書籤數 */
  withMissed: number
  warnings: number
}

export type IncomingErrorReason = RegexShareErrorReason | 'decode' | 'not-loaded'

export type IncomingView =
  | { phase: 'loading', id: number, kind: RegexShareRequest['kind'] }
  | { phase: 'error', id: number, kind: RegexShareRequest['kind'], reason: IncomingErrorReason, detail: string }
  | { phase: 'confirm', id: number, kind: 'share', state: ShareState, summary: ShareSummary }
  | { phase: 'confirm-bookmarks', id: number, kind: 'bookmarks', pack: BookmarkPack, summary: BookmarkSummary }

export interface IncomingDeps {
  decode: (code: string) => Promise<{ state: ShareState, warnings: string[] }>
  /** 載好清單後的還原結果;清單載入失敗 = null */
  prepare: (s: ShareState) => Promise<{ pages: readonly RegexPage[], resolved: ResolvedState } | null>
  current: (game: RegexGame) => CurrentCombo
  apply: (s: ShareState) => void
  /** 第 40 步書籤包 */
  decodeBookmarks: (code: string) => Promise<{ pack: BookmarkPack, warnings: string[] }>
  /** 預覽合併 + 每筆書籤(包內順序)找不到幾項;清單載入失敗 = null */
  prepareBookmarks: (pack: BookmarkPack) => Promise<{ merge: MergeResult, missed: number[] } | null>
  applyBookmarks: (pack: BookmarkPack) => void
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

/** 書籤包 + 預覽合併結果 + 每筆找不到幾項 → 對話框內容(純函式;遊戲 / 資料夾依包內第一次出現的順序) */
export function summarizeBookmarks (pack: BookmarkPack, merge: MergeResult, missed: readonly number[], warnings: number): BookmarkSummary {
  const games: BookmarkSummary['games'] = []
  const created = new Set(merge.foldersCreated.map(f => `${f.game}\u0000${f.name}`))
  merge.added.forEach((a, i) => {
    let g = games.find(x => x.game === a.game)
    if (!g) { g = { game: a.game, folders: [] }; games.push(g) }
    let f = g.folders.find(x => x.folder === a.folder)
    if (!f) { f = { folder: a.folder, isNew: !!a.folder && created.has(`${a.game}\u0000${a.folder}`), items: [] }; g.folders.push(f) }
    f.items.push({ name: a.name, originalName: a.originalName, page: pack.bookmarks[i]?.page ?? '', missed: missed[i] ?? 0 })
  })
  return {
    games,
    total: merge.added.length,
    renamed: merge.renamed.length,
    withMissed: missed.filter(n => n > 0).length,
    warnings
  }
}

export interface IncomingShare {
  view: ShallowRef<IncomingView | null>
  receive: (req: RegexShareRequest) => Promise<void>
  /** 套用 / 加入目前確認中的內容;不在確認階段 = false(什麼都不做) */
  confirm: () => boolean
  /** 關掉對話框,不改任何狀態 */
  cancel: () => void
}

export function createIncomingShare (deps: IncomingDeps): IncomingShare {
  const view = shallowRef<IncomingView | null>(null)
  /** 最新一筆請求的 id;解碼完成時不是它 = 已被取代 / 取消,丟掉 */
  let current = -1

  async function prepareShare (req: RegexShareRequest, code: string): Promise<IncomingView> {
    const d = await deps.decode(code)
    const prep = await deps.prepare(d.state)
    if (!prep) return { phase: 'error', id: req.id, kind: 'share', reason: 'not-loaded', detail: d.state.game }
    if (d.warnings.length) deps.log(`[regex-share] #${req.id} 分享碼警告:${d.warnings.join(';')}`)
    const summary = summarizeShare(d.state, prep.resolved, deps.current(d.state.game), d.warnings.length)
    deps.log(`[regex-share] #${req.id} 等待確認(${d.state.game}:${summary.incoming.length} 份清單、找不到 ${summary.missed} 項)`)
    return { phase: 'confirm', id: req.id, kind: 'share', state: d.state, summary }
  }

  async function prepareBookmarks (req: RegexShareRequest, code: string): Promise<IncomingView> {
    const d = await deps.decodeBookmarks(code)
    const games = [...new Set(d.pack.bookmarks.map(b => b.game))].join(', ') || '-'
    const prep = await deps.prepareBookmarks(d.pack)
    if (!prep) return { phase: 'error', id: req.id, kind: 'bookmarks', reason: 'not-loaded', detail: games }
    if (d.warnings.length) deps.log(`[regex-share] #${req.id} 書籤包警告:${d.warnings.join(';')}`)
    const summary = summarizeBookmarks(d.pack, prep.merge, prep.missed, d.warnings.length)
    deps.log(`[regex-share] #${req.id} 等待確認(書籤 ${summary.total} 個、改名 ${summary.renamed}、有找不到項目 ${summary.withMissed})`)
    return { phase: 'confirm-bookmarks', id: req.id, kind: 'bookmarks', pack: d.pack, summary }
  }

  async function receive (req: RegexShareRequest): Promise<void> {
    current = req.id
    if (req.error || !req.code) {
      const e = req.error ?? { reason: 'empty' as const, detail: '' }
      deps.log(`[regex-share] #${req.id} 參數不合格:${e.reason}(${e.detail})`)
      view.value = { phase: 'error', id: req.id, kind: req.kind, reason: e.reason, detail: e.detail }
      return
    }
    view.value = { phase: 'loading', id: req.id, kind: req.kind }
    let next: IncomingView
    try {
      next = req.kind === 'bookmarks' ? await prepareBookmarks(req, req.code) : await prepareShare(req, req.code)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      deps.log(`[regex-share] #${req.id} 無法解碼:${detail}`)
      next = { phase: 'error', id: req.id, kind: req.kind, reason: 'decode', detail }
    }
    if (current !== req.id) return
    view.value = next
  }

  function confirm (): boolean {
    const v = view.value
    if (!v || (v.phase !== 'confirm' && v.phase !== 'confirm-bookmarks')) return false
    view.value = null
    current = -1
    if (v.phase === 'confirm') {
      deps.log(`[regex-share] #${v.id} 使用者確認套用`)
      deps.apply(v.state)
    } else {
      deps.log(`[regex-share] #${v.id} 使用者確認加入 ${v.summary.total} 個書籤`)
      deps.applyBookmarks(v.pack)
    }
    return true
  }

  function cancel (): void {
    const v = view.value
    if (v) deps.log(`[regex-share] #${v.id} 關閉(${v.phase === 'confirm' || v.phase === 'confirm-bookmarks' ? '取消,不套用' : v.phase})`)
    view.value = null
    current = -1
  }

  return { view, receive, confirm, cancel }
}
