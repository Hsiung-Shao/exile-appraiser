// 第 33 步:正則書籤快捷存取(書籤列擺放、快速面板鍵盤、提示字串、熱鍵衝突、設定往返、接線守門)。純函式 + 原始碼守門,不開瀏覽器。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BAR_GAP, BAR_MARGIN, QUICK_REASONS, placeBookmarkBar, quickNoticeKey, quickPanelKey, rectsOverlap, type BarWant, type Rect
} from '../src/web/regex/quick-geom'
import { hotkeyIssues, hotkeySlots, type HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'
import { _roundTripForTest, hostConfigOf } from '../src/web/Config'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const zh = JSON.parse(read('../src/i18n/cmn-Hant.json'))
const en = JSON.parse(read('../src/i18n/en.json'))

const want: BarWant = { colW: 170, colH: 260, minColH: 90, rowH: 36 }
const view = { w: 1920, h: 1080 }

function inside (r: Rect, v: { w: number, h: number }) {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= v.w && r.y + r.h <= v.h
}

describe('placeBookmarkBar', () => {
  it('置中預設(1080p):右側直排、頂端對齊設定視窗、不重疊、不出界', () => {
    const win = { x: 560, y: 236, w: 800, h: 608 }
    const p = placeBookmarkBar(win, view, want)
    expect(p.side).toBe('right')
    expect(p.dir).toBe('column')
    expect(p.x).toBe(win.x + win.w + BAR_GAP)
    expect(p.y).toBe(win.y)
    expect(p.h).toBe(want.colH)
    expect(p.scroll).toBe(false)
    expect(rectsOverlap(p, win)).toBe(false)
    expect(inside(p, view)).toBe(true)
  })
  it('設定視窗貼右邊 → 左側;貼底 → 往上推到不出界', () => {
    const win = { x: 1300, y: 900, w: 600, h: 170 }
    const p = placeBookmarkBar(win, view, want)
    expect(p.side).toBe('left')
    expect(p.x).toBe(win.x - BAR_GAP - want.colW)
    expect(p.y + p.h).toBeLessThanOrEqual(view.h - BAR_MARGIN)
    expect(rectsOverlap(p, win)).toBe(false)
    expect(inside(p, view)).toBe(true)
  })
  it('書籤很多:比可用高度高 → 高度夾住 + 捲動', () => {
    const p = placeBookmarkBar({ x: 100, y: 50, w: 800, h: 600 }, { w: 1280, h: 720 }, { ...want, colH: 2000 })
    expect(p.side).toBe('right')
    expect(p.h).toBe(720 - BAR_MARGIN * 2)
    expect(p.y).toBe(BAR_MARGIN)
    expect(p.scroll).toBe(true)
  })
  it('左右都放不下 → 上方橫排(寬 = 設定視窗寬、橫向捲動);上方也不行 → 下方', () => {
    const top = placeBookmarkBar({ x: 20, y: 100, w: 1880, h: 900 }, view, want)
    expect(top.side).toBe('top')
    expect(top.dir).toBe('row')
    expect(top.y).toBe(100 - BAR_GAP - want.rowH)
    expect(top.w).toBe(1880)
    expect(top.scroll).toBe(true)
    expect(rectsOverlap(top, { x: 20, y: 100, w: 1880, h: 900 })).toBe(false)
    const bottom = placeBookmarkBar({ x: 20, y: 10, w: 1880, h: 900 }, view, want)
    expect(bottom.side).toBe('bottom')
    expect(bottom.y).toBe(10 + 900 + BAR_GAP)
    expect(inside(bottom, view)).toBe(true)
  })
  it('設定視窗佔滿 overlay → none(不顯示,不蓋住設定視窗)', () => {
    expect(placeBookmarkBar({ x: 0, y: 0, w: 1920, h: 1080 }, view, want).side).toBe('none')
    expect(placeBookmarkBar({ x: 16, y: 16, w: 1888, h: 1048 }, view, want).side).toBe('none')
  })
  it('overlay 太矮放不下直排最小高 → 改上下', () => {
    const p = placeBookmarkBar({ x: 300, y: 50, w: 400, h: 20 }, { w: 1000, h: 100 }, want)
    expect(p.dir).toBe('row')
  })
  it('隨機矩陣:不論位置大小,放了就一定不重疊且不出界', () => {
    let seed = 12345
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (let i = 0; i < 3000; i++) {
      const v = { w: 800 + rnd(3000), h: 500 + rnd(1700) }
      const w = Math.min(v.w, 480 + rnd(v.w))
      const h = Math.min(v.h, 360 + rnd(v.h))
      const win = { x: rnd(v.w - w + 1), y: rnd(v.h - h + 1), w, h }
      const p = placeBookmarkBar(win, v, { ...want, colH: 40 + rnd(1500) })
      if (p.side === 'none') continue
      expect(rectsOverlap(p, win), JSON.stringify({ v, win, p })).toBe(false)
      expect(inside(p, v), JSON.stringify({ v, win, p })).toBe(true)
    }
  })
})

describe('quickPanelKey', () => {
  it('上下循環、Home / End、PageUp / PageDown 不循環', () => {
    expect(quickPanelKey(0, 3, 'ArrowDown')).toEqual({ sel: 1, action: null, handled: true })
    expect(quickPanelKey(2, 3, 'ArrowDown').sel).toBe(0)
    expect(quickPanelKey(0, 3, 'ArrowUp').sel).toBe(2)
    expect(quickPanelKey(1, 3, 'Home').sel).toBe(0)
    expect(quickPanelKey(0, 3, 'End').sel).toBe(2)
    expect(quickPanelKey(0, 20, 'PageDown').sel).toBe(5)
    expect(quickPanelKey(18, 20, 'PageDown').sel).toBe(19)
    expect(quickPanelKey(3, 20, 'PageUp').sel).toBe(0)
  })
  it('Enter 執行目前選的;1–9 直接執行(超出筆數只吃掉不執行);Esc 關閉', () => {
    expect(quickPanelKey(1, 3, 'Enter')).toEqual({ sel: 1, action: 'run', handled: true })
    expect(quickPanelKey(0, 3, '3')).toEqual({ sel: 2, action: 'run', handled: true })
    expect(quickPanelKey(0, 3, '7')).toEqual({ sel: 0, action: null, handled: true })
    expect(quickPanelKey(1, 3, 'Escape')).toEqual({ sel: 1, action: 'close', handled: true })
    expect(quickPanelKey(5, 3, 'Enter').sel).toBe(0) // 選擇超出(書籤被刪)→ 回到第一筆
  })
  it('沒有書籤:Enter 不執行、Esc 仍關閉;其他鍵不處理', () => {
    expect(quickPanelKey(-1, 0, 'Enter')).toEqual({ sel: -1, action: null, handled: true })
    expect(quickPanelKey(-1, 0, 'Escape').action).toBe('close')
    expect(quickPanelKey(0, 3, 'a').handled).toBe(false)
    expect(quickPanelKey(0, 3, 'Tab').handled).toBe(false)
  })
})

describe('提示字串', () => {
  it('貼上了沒有提示;每個原因兩語都有字串', () => {
    expect(quickNoticeKey({ pasted: true, copied: true })).toBeNull()
    for (const r of QUICK_REASONS) {
      const key = quickNoticeKey({ pasted: false, copied: true, reason: r })!
      const leaf = key.split('.').pop()!
      expect(zh.ppz.regex[leaf], key).toBeTruthy()
      expect(en.ppz.regex[leaf], key).toBeTruthy()
    }
  })
  it('元件 / 設定頁用到的 ppz.regex.quick_* 兩語都有,且沒有 vue-i18n 特殊字元', () => {
    const used = new Set<string>()
    for (const f of ['../src/web/regex/RegexBookmarkBar.vue', '../src/web/regex/RegexQuickPanel.vue', '../src/web/settings/tabs/Hotkeys.vue', '../src/web/regex/RegexBookmarks.vue']) {
      for (const m of read(f).matchAll(/'ppz\.regex\.((?:quick|bm_hotkey)[a-z_]*)'/g)) used.add(m[1])
    }
    expect(used.size).toBeGreaterThan(12)
    for (const k of used) {
      for (const d of [zh, en]) {
        const s = d.ppz.regex[k]
        expect(typeof s, k).toBe('string')
        expect(s, k).not.toMatch(/[|@$]/)
      }
    }
    // 參數
    expect(zh.ppz.regex.quick_empty).toContain('{game}')
    expect(en.ppz.regex.quick_panel_title).toContain('{game}')
  })
})

describe('熱鍵衝突(hotkey-conflicts.ts)', () => {
  const base: HotkeyConfigLike = {
    hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space', game: 'poe2',
    hotkeyOcrReveal: 'Ctrl + Shift + R', hotkeyOcrRegion: '', hotkeyRuneshapeToggle: '', commands: [], stashSearch: [{ text: 'x', hotkey: 'F3' }]
  }
  it('順序同 main:倉庫搜尋 → 快速面板 → 目前遊戲的書籤熱鍵', () => {
    const slots = hotkeySlots({
      ...base,
      hotkeyRegexQuick: 'F4',
      regexBookmarkHotkeys: [
        { index: 0, name: 'a', game: 'poe2', hotkey: 'ctrl+1' },
        { index: 1, name: 'b', game: 'poe1', hotkey: 'Ctrl + 2' },
        { index: 2, name: 'c', game: 'poe2', hotkey: ' ' }
      ]
    })
    expect(slots.slice(-3)).toEqual([{ id: 'stash:0', hotkey: 'F3' }, { id: 'regexQuick', hotkey: 'F4' }, { id: 'rxbm:0', hotkey: 'Ctrl + 1' }])
  })
  it('重複 / 保留鍵標在後到的;快速面板與書籤撞鍵 → 標書籤', () => {
    const issues = hotkeyIssues(hotkeySlots({
      ...base,
      hotkeyRegexQuick: 'F3',
      regexBookmarkHotkeys: [
        { index: 4, name: 'a', game: 'poe2', hotkey: 'Ctrl + Shift + R' },
        { index: 5, name: 'b', game: 'poe2', hotkey: 'Ctrl + F' },
        { index: 6, name: 'c', game: 'poe2', hotkey: 'F9' },
        { index: 7, name: 'd', game: 'poe2', hotkey: 'F9' }
      ]
    }))
    expect(issues.get('regexQuick')).toEqual({ kind: 'duplicate', key: 'F3', with: 'stash:0' })
    expect(issues.get('rxbm:4')).toEqual({ kind: 'duplicate', key: 'Ctrl + Shift + R', with: 'ocr' })
    expect(issues.get('rxbm:5')).toEqual({ kind: 'reserved', key: 'Ctrl + F' })
    expect(issues.has('rxbm:6')).toBe(false)
    expect(issues.get('rxbm:7')).toEqual({ kind: 'duplicate', key: 'F9', with: 'rxbm:6' })
  })
})

describe('設定往返 / host-config', () => {
  it('舊設定檔:快速面板熱鍵空、書籤列開;明確 false 才關', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.hotkeyRegexQuick).toBe('')
      expect(config.regexBookmarkBar).toBe(true)
      expect(JSON.parse(serialized).regexBookmarkBar).toBe(true)
    }
    const r = _roundTripForTest('{"hotkeyRegexQuick":"Ctrl + Shift + Q","regexBookmarkBar":false}')
    expect(r.config.hotkeyRegexQuick).toBe('Ctrl + Shift + Q')
    expect(r.config.regexBookmarkBar).toBe(false)
    expect(JSON.parse(r.serialized)).toMatchObject({ hotkeyRegexQuick: 'Ctrl + Shift + Q', regexBookmarkBar: false })
    expect(_roundTripForTest('{"regexBookmarkBar":0}').config.regexBookmarkBar).toBe(true)
    expect(_roundTripForTest('{"hotkeyRegexQuick":5}').config.hotkeyRegexQuick).toBe('')
  })
  it('hostConfigOf 帶快速面板熱鍵與書籤熱鍵(複製一份);書籤列開關不進 host-config', () => {
    const { config } = _roundTripForTest('{"hotkeyRegexQuick":"F4"}')
    const list = [{ index: 2, name: 'x', game: 'poe1' as const, hotkey: 'F6' }]
    const h = hostConfigOf(config, list)
    expect(h.hotkeyRegexQuick).toBe('F4')
    expect(h.regexBookmarkHotkeys).toEqual(list)
    expect(h.regexBookmarkHotkeys![0]).not.toBe(list[0])
    expect('regexBookmarkBar' in h).toBe(false)
    expect(hostConfigOf(config).regexBookmarkHotkeys).toEqual([])
  })
})

describe('接線守門', () => {
  const app = read('../src/web/App.vue')
  it('App.vue:書籤列在設定層裡(overlay 浮在旁邊、window / 預覽是上方橫排);快速面板只在 overlay;熱鍵事件', () => {
    const layer = app.slice(app.indexOf('class="settings-layer"'), app.indexOf('<!-- WP-S:靈魂之井'))
    expect(layer).toContain('<regex-bookmark-bar v-if="regexBookmarkBar" :inline="!isOverlay" @pasted="closeSettings(')
    expect(app).toContain('<regex-quick-panel v-if="isOverlay && regexQuickOpen" @close="closeRegexQuick" />')
    expect(app).toContain('Host.onRegexQuickOpen(')
    expect(app).toContain('Host.onRegexBookmarkRun((e) => { void runRegexBookmarkFromHotkey(e) })')
    // overlay 失焦 / 收到物品 / 框選層 → 關快速面板
    expect(app).toContain("closeRegexQuick('focus-change')")
    expect(app.match(/regexQuickOpen\.value = false/g)?.length).toBeGreaterThanOrEqual(3)
  })
  it('啟動就讀 regex_state(書籤熱鍵要先註冊);store 把書籤熱鍵交給 host-config', () => {
    expect(read('../src/main.ts')).toContain('void ensureRegexStateLoaded()')
    const store = read('../src/web/regex/store.ts')
    expect(store).toContain('regexBookmarkHotkeyList.value = list')
    expect(store).toMatch(/started = \(async \(\) => \{\s*await ensureStateLoaded\(\)/)
    expect(read('../src/web/Config.ts')).toContain('regexBookmarkHotkeys: regexHotkeys.map(b => ({ ...b }))')
  })
  it('IPC:預覽 / 純瀏覽器不能貼(呼叫端自己複製)', () => {
    const ipc = read('../src/web/background/IPC.ts')
    expect(ipc).toContain("get canRegexPaste (): boolean { return !this.isPreview && typeof window.host?.regexPaste === 'function' }")
    const quick = read('../src/web/regex/quick.ts')
    expect(quick).toContain("reason: copied ? 'preview' : 'copy-failed'")
    expect(quick).toContain("source: 'hotkey', missing: true")
  })
  it('書籤管理:每個書籤有熱鍵欄位與衝突提示', () => {
    const bm = read('../src/web/regex/RegexBookmarks.vue')
    expect(bm).toContain('@update:model-value="(v: string) => setBookmarkHotkey(x.index, v)"')
    expect(bm).toContain('issueText(`rxbm:${x.index}`, x.b.hotkey)')
  })
})
