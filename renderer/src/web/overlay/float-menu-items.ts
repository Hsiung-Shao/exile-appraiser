/**
 * 2026-10-15 懸浮選單 A 版(指令面板,設計稿 https://claude.ai/artifact/8G1wDzZxwYDtEMv3KU7U81 `FloatMenuA`)的清單模型。
 *
 * 選單上可搜尋 / 鍵盤選取的項目攤平成 `MenuItem`,順序 = 畫面順序:自動辨識開關 → 正則書籤 → 工具。
 * 市況列與倉庫本頁價值是資訊列,不在這份清單裡(不能選、不參與搜尋)。
 * 純函式(只 import 型別 + 同目錄),`renderer/test/float-menu-items.test.ts` 測。
 */
import type { GroupedBookmarks, RegexGame } from '@exile-appraiser/regex'
import { FLOAT_MENU_TOGGLES, type FloatMenuToggleKey } from './float-menu-geom'

export type MenuKind = 'bookmark' | 'scan' | 'tool'
/** 篩選膠囊:全部 / 書籤 / 辨識 / 工具 */
export type MenuChip = 'all' | MenuKind
export type MenuTool = 'settings' | 'sheet' | 'dust'

export interface MenuItem {
  kind: MenuKind
  /** 清單內唯一(`scan:<設定鍵>` / `bm:<書籤索引>` / `tool:<工具>`) */
  id: string
  label: string
  hotkey?: string
  /** 書籤:`ui.bookmarks` 的索引 */
  index?: number
  /** 書籤:資料夾名('' = 未分類) */
  folder?: string
  /** 書籤:所在資料夾收合中(只有畫資料夾標題時才算) */
  collapsed?: boolean
  toggle?: FloatMenuToggleKey
  tool?: MenuTool
}

export const MENU_CHIPS: readonly MenuChip[] = ['all', 'bookmark', 'scan', 'tool']

/** 工具列(順序 = 畫面順序) */
export const MENU_TOOLS: ReadonlyArray<{ tool: MenuTool, label: string }> = [
  { tool: 'settings', label: 'ppz.menu.settings' },
  { tool: 'sheet', label: 'ppz.menu.sheet' },
  { tool: 'dust', label: 'ppz.menu.dust' }
]

/**
 * 三類攤平。`game` = 目前遊戲(辨識開關依它);`bookmarks` = `bookmarkGroupsOf(書籤清單遊戲, true)`。
 */
export function menuItemsOf (input: { game: RegexGame, bookmarks: GroupedBookmarks, t: (key: string) => string }): MenuItem[] {
  const out: MenuItem[] = []
  for (const s of FLOAT_MENU_TOGGLES[input.game]) {
    out.push({ kind: 'scan', id: `scan:${s.key}`, label: input.t(s.label), toggle: s.key })
  }
  const { groups, headers } = input.bookmarks
  for (const g of groups) {
    for (const it of g.items) {
      const item: MenuItem = { kind: 'bookmark', id: `bm:${it.index}`, label: it.b.name, index: it.index, folder: g.folder, collapsed: headers && g.collapsed }
      if (it.b.hotkey) item.hotkey = it.b.hotkey
      out.push(item)
    }
  }
  for (const x of MENU_TOOLS) out.push({ kind: 'tool', id: `tool:${x.tool}`, label: input.t(x.label), tool: x.tool })
  return out
}

/** 搜尋比對用:全形 → 半形(NFKC)、小寫、去頭尾空白 */
export function normMenuText (s: string): string {
  return s.normalize('NFKC').toLowerCase().trim()
}

/** 膠囊 + 關鍵字(空白分開的每個字都要出現在名稱或資料夾名) */
export function filterMenuItems (items: MenuItem[], chip: MenuChip, query: string): MenuItem[] {
  const words = normMenuText(query).split(/\s+/).filter(Boolean)
  return items.filter((it) => {
    if (chip !== 'all' && it.kind !== chip) return false
    if (!words.length) return true
    const hay = normMenuText(it.label + ' ' + (it.folder ?? ''))
    return words.every(w => hay.includes(w))
  })
}

/** 可用鍵盤選取的列:沒搜尋時,收合資料夾裡的書籤看不見 → 不算;有搜尋時全部列出 */
export function menuRows (items: MenuItem[], query: string): MenuItem[] {
  if (normMenuText(query)) return items
  return items.filter(it => !it.collapsed)
}

/**
 * 選單鍵盤:只處理 ↑↓(循環)/ Home / End(搜尋框為空時才處理)/ Enter(有選取時才處理)。其他鍵(1–9、← →、Tab、Esc、文字)回 null = 不攔,
 * 交給搜尋框 / 瀏覽器(Tab 換焦點)/ main(overlay 的 Esc 由 main 攔下收起選單)。
 */
export function menuKey (e: { key: string }, count: number, sel: number, queryEmpty = true): { sel: number, run: boolean } | null {
  if (count <= 0) return null
  const cur = Math.min(Math.max(sel, -1), count - 1)
  switch (e.key) {
    case 'ArrowDown': return { sel: cur + 1 >= count ? 0 : cur + 1, run: false }
    case 'ArrowUp': return { sel: cur <= 0 ? count - 1 : cur - 1, run: false }
    // Home / End 在搜尋框有字時留給輸入框移游標
    case 'Home': return queryEmpty ? { sel: 0, run: false } : null
    case 'End': return queryEmpty ? { sel: count - 1, run: false } : null
    // 沒有選取時 Enter 不攔(剛叫出選單就按 Enter 不該切換第一個開關)
    case 'Enter': return cur < 0 ? null : { sel: cur, run: true }
    default: return null
  }
}

/** 標題列精簡限流點:一條限流規則的狀態(`RateLimiter` 的 stack 長度 / max / queue) */
export interface RateRuleState { active: number, max: number, queue: number }

/**
 * 限流點:429 Retry-After 等待中 = `wait`(顯示剩餘秒數);有請求在排隊 = `busy`;其他 = `ok`。
 * 數字取用量比例最高的那條規則(`active / max`);沒有規則(拿不到該遊戲的限流狀態)→ 空字串。
 */
export function rateDotOf (rules: RateRuleState[], waitSeconds: number): { tone: 'ok' | 'busy' | 'wait', text: string } {
  let top: RateRuleState | null = null
  for (const r of rules) {
    if (!(r.max > 0)) continue
    if (!top || r.active / r.max > top.active / top.max) top = r
  }
  const usage = top ? `${top.active} / ${top.max}` : ''
  if (waitSeconds > 0) return { tone: 'wait', text: `${waitSeconds}s` }
  if (rules.some(r => r.queue > 0)) return { tone: 'busy', text: usage }
  return { tone: 'ok', text: usage }
}
