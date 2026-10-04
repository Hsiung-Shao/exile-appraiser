/**
 * 設定視窗分頁導覽(2026-10-05 使用者回報「熱鍵點了聊天指令後就回不去原本設定畫面」):
 * - 「← 回到 …」返回連結:熱鍵總表點唯讀列 / 「到 … 編輯」跳到別頁時記住來源(`SettingsBack`),
 *   只在跳到的那一頁顯示;切到別的分頁就清掉(`nextBack`)。
 * - 瀏覽器預覽(或純瀏覽器)的分頁 ↔ 瀏覽器歷史:換分頁 `pushState('#tab=<id>')`、上一頁 / 下一頁(`popstate`)切回對應分頁。
 *   根因:原本換分頁不產生歷史紀錄,預覽裡按瀏覽器「上一頁」(滑鼠側鍵、Alt + ←)會直接離開預覽頁,
 *   預覽伺服器在最後一條連線斷掉 20 秒後關閉 → 再按「下一頁」/ 重新整理也回不去。
 *   Electron(overlay / window)沒有上一頁,不動歷史。
 * 純函式 + 可注入的 history / location(`renderer/test/settings-nav.test.ts`);相對路徑匯入(renderer vitest 不載別名)。
 */
import type { SettingsTabId } from '../../../../ipc/types'

/** 跳轉來源:從 `from` 跳到 `target`,返回時捲回 `scroll` */
export interface SettingsBack {
  from: SettingsTabId
  target: SettingsTabId
  scroll: number
}

/** 目前分頁變了之後的返回狀態:還在跳到的那一頁就保留,否則清掉 */
export function nextBack (back: SettingsBack | null, tab: SettingsTabId): SettingsBack | null {
  return back && back.target === tab && back.from !== tab ? back : null
}

/** 分頁 → 網址 hash(與預覽 boot script 的 `#tab=` 相同格式;重新整理會開回這一頁) */
export function tabHash (tab: SettingsTabId): string {
  return `#tab=${tab}`
}

/** 網址 hash → 分頁 id 字串(未驗證;交給 resolveSettingsTab)。與 preview-server boot script 同一條 regex */
export function tabFromHash (hash: string | null | undefined): string | null {
  const m = /(?:^|[#&])tab=([a-z-]+)/.exec(hash ?? '')
  return m ? m[1] : null
}

/** 分頁要不要寫進瀏覽器歷史:瀏覽器預覽、純瀏覽器(沒有 host)才要;Electron overlay / window 沒有上一頁 */
export function usesBrowserHistory (host: { isPreview: boolean, isElectron: boolean }): boolean {
  return host.isPreview || !host.isElectron
}

/** 存在 history.state 的內容 */
export interface TabHistoryEntry {
  ppzTab: SettingsTabId
  back: SettingsBack | null
  /** 離開這一筆時內容區的捲動位置(返回時捲回) */
  scroll?: number
}

export function isTabHistoryEntry (x: unknown): x is TabHistoryEntry {
  return !!x && typeof x === 'object' && typeof (x as TabHistoryEntry).ppzTab === 'string'
}

export interface HistoryLike {
  readonly state: unknown
  pushState (data: unknown, unused: string, url?: string): void
  replaceState (data: unknown, unused: string, url?: string): void
}

export interface TabHistoryDeps {
  history: HistoryLike
  location: { readonly hash: string }
  addPopListener (fn: () => void): void
  removePopListener (fn: () => void): void
  /** 分頁 id 字串 → 實際要顯示的分頁(resolveSettingsTab + 目前遊戲) */
  resolve (id: string | null): SettingsTabId
  /** 目前內容區的捲動位置 */
  getScroll (): number
  /** 上一頁 / 下一頁:把分頁、返回狀態、捲動位置套回畫面 */
  apply (entry: TabHistoryEntry): void
}

/**
 * 分頁 ↔ 瀏覽器歷史。`start` 把目前這一筆標成目前分頁(replace,不新增);`changed` 在分頁 / 返回狀態變了時呼叫:
 * 與 history.state 同分頁 → 只更新返回狀態(上一頁 / 下一頁套回來的也是這條路 → 不重複 push);不同 → 先記下離開時的捲動位置再 push。
 */
export function createTabHistory (deps: TabHistoryDeps) {
  const { history } = deps
  let started = false
  function current (): TabHistoryEntry | null {
    return isTabHistoryEntry(history.state) ? history.state : null
  }
  function onPop () {
    let entry = current()
    if (!entry) {
      // 使用者手改網址的 hash(沒有 state):照 hash 解析,補上 state(之後的 changed 才不會再 push 一筆)
      entry = { ppzTab: deps.resolve(tabFromHash(deps.location.hash)), back: null }
      history.replaceState(entry, '', tabHash(entry.ppzTab))
    }
    deps.apply(entry)
  }
  return {
    start (tab: SettingsTabId, back: SettingsBack | null) {
      if (started) return
      started = true
      const cur = current()
      history.replaceState({ ...(cur?.ppzTab === tab ? cur : {}), ppzTab: tab, back }, '', tabHash(tab))
      deps.addPopListener(onPop)
    },
    changed (tab: SettingsTabId, back: SettingsBack | null) {
      if (!started) return
      const cur = current()
      if (cur && cur.ppzTab === tab) {
        if (!sameBack(cur.back, back)) history.replaceState({ ...cur, back }, '', tabHash(tab))
        return
      }
      if (cur) history.replaceState({ ...cur, scroll: deps.getScroll() }, '', tabHash(cur.ppzTab))
      history.pushState({ ppzTab: tab, back }, '', tabHash(tab))
    },
    stop () {
      if (!started) return
      started = false
      deps.removePopListener(onPop)
    }
  }
}

function sameBack (a: SettingsBack | null | undefined, b: SettingsBack | null): boolean {
  if (!a || !b) return !a && !b
  return a.from === b.from && a.target === b.target && a.scroll === b.scroll
}
