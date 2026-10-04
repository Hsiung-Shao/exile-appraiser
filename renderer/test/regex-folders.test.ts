// 第 36 步:正則書籤資料夾的 renderer 端 —— 快速面板分組鍵盤(純函式)、字串兩語、元件接線守門。不開瀏覽器。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  quickGroupedKey, quickHeadKey, quickItemKey, quickNavRows, quickPanelKey, quickRows, type QuickGroupLike
} from '../src/web/regex/quick-geom'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const zh = JSON.parse(read('../src/i18n/cmn-Hant.json'))
const en = JSON.parse(read('../src/i18n/en.json'))

const g = (folder: string, idx: number[], collapsed = false): QuickGroupLike => ({ folder, collapsed, items: idx.map(index => ({ index })) })
const B = quickItemKey
const H = quickHeadKey

describe('quickRows', () => {
  it('沒有資料夾:只有書籤列、編號 1..9(第 10 筆起沒有編號)', () => {
    const rows = quickRows([g('', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])], false)
    expect(rows.every(r => r.kind === 'item')).toBe(true)
    expect(rows.map(r => r.kind === 'item' ? r.no : -1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0])
  })
  it('有資料夾:標題 + 展開組的書籤;收合的組只剩標題;編號只算看得見的書籤', () => {
    const rows = quickRows([g('A', [3, 4]), g('B', [5, 6], true), g('', [0, 1])], true)
    expect(rows.map(r => r.key)).toEqual([H('A'), B(3), B(4), H('B'), H(''), B(0), B(1)])
    expect(rows.filter(r => r.kind === 'item').map(r => r.kind === 'item' && r.no)).toEqual([1, 2, 3, 4])
    expect(quickNavRows(rows).map(r => r.key)).toEqual([B(3), B(4), H('B'), B(0), B(1)])
  })
  it('沒有標題時收合旗標無效(全部展開)', () => {
    expect(quickRows([g('', [0, 1], true)], false).map(r => r.key)).toEqual([B(0), B(1)])
  })
})

describe('quickGroupedKey:跨分組鍵盤', () => {
  const groups = [g('A', [3, 4]), g('B', [5, 6], true), g('', [0, 1])]
  it('↑↓ 跳過展開的標題、停在收合的標題、循環', () => {
    expect(quickGroupedKey(groups, true, B(4), 'ArrowDown').sel).toBe(H('B'))
    expect(quickGroupedKey(groups, true, H('B'), 'ArrowDown').sel).toBe(B(0)) // 跳過展開的「未分類」標題
    expect(quickGroupedKey(groups, true, B(1), 'ArrowDown').sel).toBe(B(3)) // 循環,跳過 A 的標題
    expect(quickGroupedKey(groups, true, B(3), 'ArrowUp').sel).toBe(B(1))
    expect(quickGroupedKey(groups, true, '', 'ArrowDown').sel).toBe(B(3))
    expect(quickGroupedKey(groups, true, '', 'ArrowUp').sel).toBe(B(1))
    expect(quickGroupedKey(groups, true, B(4), 'Home').sel).toBe(B(3))
    expect(quickGroupedKey(groups, true, B(4), 'End').sel).toBe(B(1))
    expect(quickGroupedKey(groups, true, B(3), 'PageDown').sel).toBe(B(1))
    expect(quickGroupedKey(groups, true, B(1), 'PageUp').sel).toBe(B(3))
  })
  it('← 收合目前書籤的資料夾(選擇移到標題);→ / Enter 在收合的標題上展開(選擇移到第一筆)', () => {
    expect(quickGroupedKey(groups, true, B(4), 'ArrowLeft')).toEqual({ sel: H('A'), action: 'toggle', folder: 'A', collapse: true, handled: true })
    expect(quickGroupedKey(groups, true, B(0), 'ArrowLeft')).toMatchObject({ sel: H(''), folder: '', collapse: true })
    expect(quickGroupedKey(groups, true, H('B'), 'ArrowRight')).toEqual({ sel: B(5), action: 'toggle', folder: 'B', collapse: false, handled: true })
    expect(quickGroupedKey(groups, true, H('B'), 'Enter')).toMatchObject({ sel: B(5), action: 'toggle', folder: 'B', collapse: false })
    // 已收合的標題上再按 ← / 書籤上按 → = 不動(但吃掉鍵)
    expect(quickGroupedKey(groups, true, H('B'), 'ArrowLeft')).toEqual({ sel: H('B'), action: null, handled: true })
    expect(quickGroupedKey(groups, true, B(3), 'ArrowRight')).toEqual({ sel: B(3), action: null, handled: true })
  })
  it('Enter 執行書籤、1–9 照看得見的順序(收合的組不算)、Esc 關', () => {
    expect(quickGroupedKey(groups, true, B(4), 'Enter')).toEqual({ sel: B(4), action: 'run', index: 4, handled: true })
    expect(quickGroupedKey(groups, true, B(3), '3')).toEqual({ sel: B(0), action: 'run', index: 0, handled: true })
    expect(quickGroupedKey(groups, true, B(3), '5')).toEqual({ sel: B(3), action: null, handled: true })
    expect(quickGroupedKey(groups, true, B(3), 'Escape').action).toBe('close')
    expect(quickGroupedKey(groups, true, B(3), 'a').handled).toBe(false)
  })
  it('收合 → 展開來回:選擇鍵穩定(依書籤索引,不依列位置)', () => {
    let gs = groups
    let sel = B(4)
    const press = (k: string) => {
      const r = quickGroupedKey(gs, true, sel, k)
      if (r.action === 'toggle') gs = gs.map(x => (x.folder === r.folder ? { ...x, collapsed: r.collapse === true } : x))
      sel = r.sel
      return r
    }
    press('ArrowLeft')
    expect(sel).toBe(H('A'))
    expect(press('ArrowDown').sel).toBe(H('B')) // A、B 都收合 → 兩個標題都可停
    press('ArrowRight')
    expect(sel).toBe(B(5))
    expect(press('1')).toMatchObject({ action: 'run', index: 5 }) // A 收合 → 第 1 筆是 B 的第一筆
  })
  it('沒有資料夾(headers = false):與舊 quickPanelKey 逐鍵相同;← / → 不處理', () => {
    const flat = [g('', [7, 8, 9, 10, 11, 12])]
    const idx = [7, 8, 9, 10, 11, 12]
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter', '1', '3', '9', 'Escape', 'x']) {
      for (let s = -1; s < idx.length; s++) {
        const old = quickPanelKey(s, idx.length, key)
        const neu = quickGroupedKey(flat, false, s < 0 ? '' : B(idx[s]), key)
        expect(neu.handled, `${key} @${s}`).toBe(old.handled)
        expect(neu.action, `${key} @${s}`).toBe(old.action)
        if (old.sel >= 0 && old.handled) expect(neu.sel, `${key} @${s}`).toBe(B(idx[old.sel]))
      }
    }
    expect(quickGroupedKey(flat, false, B(7), 'ArrowLeft').handled).toBe(false)
    expect(quickGroupedKey(flat, false, B(7), 'ArrowRight').handled).toBe(false)
  })
  it('沒有書籤:Enter / 方向鍵吃掉但不動、Esc 關', () => {
    expect(quickGroupedKey([], false, '', 'Enter')).toEqual({ sel: '', action: null, handled: true })
    expect(quickGroupedKey([], false, '', 'Escape').action).toBe('close')
  })
})

describe('字串兩語', () => {
  it('元件用到的 ppz.regex.(fd_* / bm_*) 兩語都有、沒有 vue-i18n 特殊字元;已移除的鍵沒有殘留引用', () => {
    const used = new Set<string>()
    for (const f of ['../src/web/regex/RegexBookmarks.vue', '../src/web/regex/RegexBookmarkBar.vue', '../src/web/regex/RegexQuickPanel.vue', '../src/web/regex/store.ts']) {
      for (const m of read(f).matchAll(/'ppz\.regex\.((?:fd|bm|quick)_[a-z_]*)'/g)) used.add(m[1])
    }
    for (const k of ['fd_add', 'fd_uncategorized', 'fd_delete_confirm', 'fd_notice_deleted', 'bm_title', 'bm_other_note', 'quick_panel_hint_folders']) expect(used, k).toContain(k)
    for (const k of used) {
      for (const d of [zh, en]) {
        expect(typeof d.ppz.regex[k], k).toBe('string')
        expect(d.ppz.regex[k], k).not.toMatch(/[|@$]/)
      }
    }
    for (const k of ['bookmarks', 'bm_elsewhere', 'bm_elsewhere_tip']) {
      expect(zh.ppz.regex[k], k).toBeUndefined()
      expect(en.ppz.regex[k], k).toBeUndefined()
    }
    expect(zh.ppz.regex.bm_other_note).toContain('{game}')
    expect(en.ppz.regex.fd_delete_warn).toContain('{n}')
  })
})

describe('接線守門', () => {
  const bmVue = read('../src/web/regex/RegexBookmarks.vue')
  it('管理卡片:PoE1 / PoE2 分頁(預設 = 清單遊戲)、依資料夾分組(管理頁不略過空資料夾)、另一代不能「更新」', () => {
    expect(bmVue).toContain("const tab = shallowRef<RegexGame>(store.selGame.value)")
    expect(bmVue).toContain('watch(store.selGame, (g) => { tab.value = g })')
    expect(bmVue).toContain('bookmarkGroupsOf(tab.value)')
    expect(bmVue).toMatch(/data-regex="bm-update" :disabled="x\.b\.game !== selGame"/)
    expect(bmVue).toMatch(/data-regex="bm-tab"/)
    // 熱鍵衝突只算目前遊戲
    expect(bmVue).toContain('x.b.game === currentGame && x.b.hotkey && issueText(')
  })
  it('拖曳用 pointer events + setPointerCapture,Esc 取消;鍵盤替代:書籤與資料夾都有上移 / 下移按鈕', () => {
    expect(bmVue).toContain('setPointerCapture(e.pointerId)')
    expect(bmVue).toContain("addEventListener('pointermove'")
    expect(bmVue).toContain("addEventListener('pointercancel'")
    expect(bmVue).toMatch(/e\.key !== 'Escape'/)
    for (const a of ['bm-up', 'bm-down', 'bm-folder-up', 'bm-folder-down', 'bm-grip', 'bm-folder-grip', 'bm-folder-select']) expect(bmVue, a).toContain(`data-regex="${a}"`)
    expect(bmVue).not.toMatch(/draggable="true"|@dragstart/)
  })
  it('刪除資料夾走 .modal 確認;對話框 Teleport 綁 fs-own;尺寸不用 rem', () => {
    expect(bmVue).toMatch(/<div v-if="folderDel" class="modal rx-modal" :class="fsClass" :style="fsStyle"/)
    expect(bmVue).toMatch(/<div v-if="folderModal" class="modal rx-modal" :class="fsClass" :style="fsStyle"/)
    expect(bmVue).toContain('deleteBookmarkFolder(d.game, d.name)')
    for (const f of ['RegexBookmarks.vue', 'RegexBookmarkBar.vue', 'RegexQuickPanel.vue']) {
      const css = read(`../src/web/regex/${f}`).split('<style>')[1] ?? ''
      expect(css, f).not.toMatch(/\d(\.\d+)?rem\b/)
    }
  })
  it('書籤列 / 快速面板:分組(略過空資料夾)+ 共用收合狀態;快速面板鍵盤改 quickGroupedKey', () => {
    const bar = read('../src/web/regex/RegexBookmarkBar.vue')
    expect(bar).toContain('bookmarkGroupsOf(game.value, true)')
    expect(bar).toContain('setBookmarkFolderCollapsed(game.value, folder, collapse)')
    expect(bar).toMatch(/v-if="grouped\.headers"[^>]*data-regex="quick-bar-folder"|data-regex="quick-bar-folder"/)
    const qp = read('../src/web/regex/RegexQuickPanel.vue')
    expect(qp).toContain('bookmarkGroupsOf(game.value, true)')
    expect(qp).toContain('quickGroupedKey(g.groups, g.headers, sel.value, e.key)')
    expect(qp).not.toContain('quickPanelKey(')
    expect(qp).toContain('data-regex="quick-folder"')
  })
  it('store:資料夾操作都 scheduleSave;熱鍵總表資料夾名不進 host-config', () => {
    const st = read('../src/web/regex/store.ts')
    for (const fn of ['addBookmarkFolder', 'renameBookmarkFolder', 'deleteBookmarkFolder', 'moveBookmarkFolder', 'setBookmarkFolderCollapsed', 'moveBookmarkToFolder', 'moveBookmarkStep']) {
      const body = st.slice(st.indexOf(`export function ${fn} `), st.indexOf('\n}\n', st.indexOf(`export function ${fn} `)))
      expect(body, fn).toContain('scheduleSave()')
    }
    expect(st).toContain('regexBookmarkFolders.value = list')
    expect(read('../src/web/Config.ts')).not.toContain('regexBookmarkFolders')
  })
})
