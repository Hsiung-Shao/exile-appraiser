// 2026-10-05 使用者回報「熱鍵點了聊天指令後就回不去原本設定畫面」(瀏覽器預覽):
// 換分頁沒有瀏覽器歷史 → 上一頁直接離開預覽頁(伺服器 20 秒後關閉,回不來)。
// 守門:返回連結狀態(nextBack)、分頁 ↔ 瀏覽器歷史(假 history 模擬上一頁 / 下一頁)、三種情境(overlay / window / 預覽)、接線、i18n 兩語。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createTabHistory, isTabHistoryEntry, nextBack, tabFromHash, tabHash, usesBrowserHistory,
  type SettingsBack, type TabHistoryEntry
} from '../src/web/settings/settings-nav'
import { SETTINGS_TABS, resolveSettingsTab } from '../src/web/settings/settings-tabs'
import type { SettingsTabId } from '../../ipc/types'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const SETTINGS = 'renderer/src/web/settings'

/** 瀏覽器歷史的最小模擬:push 截掉「下一頁」、back / forward 移動索引並觸發 popstate;退到第一筆之前 = 離開這一頁 */
class FakeBrowser {
  entries: Array<{ state: unknown, hash: string }>
  index = 0
  left = false
  private pop: Array<() => void> = []
  constructor (hash = '') { this.entries = [{ state: null, hash }] }
  get location () { const self = this; return { get hash () { return self.entries[self.index].hash } } }
  history = {
    get state () { return (this as any)._b.entries[(this as any)._b.index].state },
    _b: this as FakeBrowser,
    pushState (data: unknown, _u: string, url?: string) {
      const b = this._b
      b.entries.splice(b.index + 1)
      b.entries.push({ state: structuredClone(data), hash: url ?? b.entries[b.index].hash })
      b.index++
    },
    replaceState (data: unknown, _u: string, url?: string) {
      const b = this._b
      b.entries[b.index] = { state: structuredClone(data), hash: url ?? b.entries[b.index].hash }
    }
  }
  add (fn: () => void) { this.pop.push(fn) }
  remove (fn: () => void) { this.pop = this.pop.filter(f => f !== fn) }
  back () { if (this.index === 0) { this.left = true; return } this.index--; this.pop.forEach(f => f()) }
  forward () { if (this.index >= this.entries.length - 1) return; this.index++; this.pop.forEach(f => f()) }
  /** 使用者手改網址 hash(同一份文件、沒有 state) */
  typeHash (hash: string) { this.history.pushState(null, '', hash); this.pop.forEach(f => f()) }
}

/**
 * SettingsWindow 的導覽邏輯(watch([tab, settingsBack]) → nextBack + tabHistory.changed)用純函式重演;
 * `browser` 為 null = Electron(overlay / window),不動歷史。
 */
function makeSettings (opts: { browser: FakeBrowser | null, game?: 'poe1' | 'poe2', start?: string }) {
  const game = opts.game ?? 'poe2'
  const s = { tab: resolveSettingsTab(opts.start ?? 'general', game) as SettingsTabId, back: null as SettingsBack | null, scroll: 0 }
  let oldTab = s.tab
  /** = watch([tab, settingsBack]):清返回連結 → 同步歷史(這時還讀得到離開那一頁的捲動)→ 換了分頁捲回頂端 */
  const sync = () => {
    const kept = nextBack(s.back, s.tab)
    s.back = kept
    hist?.changed(s.tab, kept)
    if (s.tab !== oldTab) s.scroll = 0
    oldTab = s.tab
  }
  const hist = opts.browser
    ? createTabHistory({
      history: opts.browser.history,
      location: opts.browser.location,
      addPopListener: (fn) => opts.browser!.add(fn),
      removePopListener: (fn) => opts.browser!.remove(fn),
      resolve: (id) => resolveSettingsTab(id, game),
      getScroll: () => s.scroll,
      // 捲動位置在畫面更新後(nextTick)才套
      apply (e: TabHistoryEntry) { s.back = e.back; s.tab = e.ppzTab; sync(); if (e.scroll) s.scroll = e.scroll }
    })
    : null
  hist?.start(s.tab, s.back)
  return {
    s,
    /** 左選單 */
    select (id: SettingsTabId) { s.tab = id; sync() },
    /** 熱鍵總表唯讀列 / 「到 … 編輯」(jumpToTab) */
    jump (to: SettingsTabId) { s.back = { from: s.tab, target: to, scroll: s.scroll }; s.tab = to; sync() },
    /** 「← 回到 …」 */
    goBack () { const b = nextBack(s.back, s.tab); if (!b) return false; s.back = null; s.tab = b.from; sync(); s.scroll = b.scroll; return true },
    backLink: () => nextBack(s.back, s.tab),
    stop: () => hist?.stop()
  }
}

describe('返回連結狀態', () => {
  const b: SettingsBack = { from: 'hotkeys', target: 'stash-chat', scroll: 120 }
  it('只在跳到的那一頁保留;切到別的分頁(含回到來源頁)就清掉', () => {
    expect(nextBack(b, 'stash-chat')).toBe(b)
    for (const t of SETTINGS_TABS.map(x => x.id).filter(x => x !== 'stash-chat')) expect(nextBack(b, t)).toBeNull()
    expect(nextBack(null, 'stash-chat')).toBeNull()
    expect(nextBack({ from: 'regex', target: 'regex', scroll: 0 }, 'regex')).toBeNull()
  })
})

describe('網址 hash', () => {
  it('每個分頁 tabHash ↔ tabFromHash 往返;與預覽 boot script 同格式、同一條 regex、TABS 都收', () => {
    const boot = read('main/src/preview-server.ts')
    const bootTabs = /var TABS=\[([^\]]+)\]/.exec(boot)![1].split(',').map(x => x.replace(/'/g, ''))
    const bootRe = /var m=(\/[^;]+\/)\.exec\(location\.hash/.exec(boot)![1]
    expect(read(`${SETTINGS}/settings-nav.ts`)).toContain(`const m = ${bootRe}.exec(hash ?? '')`)
    for (const t of SETTINGS_TABS) {
      expect(tabHash(t.id)).toBe(`#tab=${t.id}`)
      expect(tabFromHash(tabHash(t.id))).toBe(t.id)
      expect(bootTabs).toContain(t.id)
    }
    expect(tabFromHash('')).toBeNull()
    expect(tabFromHash('#x=1&tab=regex')).toBe('regex')
    expect(isTabHistoryEntry(null)).toBe(false)
    expect(isTabHistoryEntry({ ppzTab: 'regex', back: null })).toBe(true)
  })
})

describe('三種情境', () => {
  it('寫不寫瀏覽器歷史:只有預覽 / 純瀏覽器', () => {
    expect(usesBrowserHistory({ isElectron: true, isPreview: false })).toBe(false) // overlay / window(Electron)
    expect(usesBrowserHistory({ isElectron: true, isPreview: true })).toBe(true) // 瀏覽器預覽(boot script 也給 isElectron: true)
    expect(usesBrowserHistory({ isElectron: false, isPreview: false })).toBe(true) // 純瀏覽器(dev:renderer)
  })

  for (const mode of ['overlay', 'window', 'preview'] as const) {
    it(`${mode}:熱鍵總表跳到倉庫與聊天 / 正則 → 返回連結回到熱鍵(捲回原位)、左選單照常、切到別頁連結消失`, () => {
      const browser = mode === 'preview' ? new FakeBrowser('#tab=hotkeys') : null
      const w = makeSettings({ browser, start: 'hotkeys' })
      for (const target of ['stash-chat', 'regex'] as const) {
        w.select('hotkeys')
        w.s.scroll = 340
        w.jump(target)
        expect(w.s.tab).toBe(target)
        expect(w.backLink()).toEqual({ from: 'hotkeys', target, scroll: 340 })
        expect(w.goBack()).toBe(true)
        expect(w.s.tab).toBe('hotkeys')
        expect(w.s.scroll).toBe(340)
        expect(w.backLink()).toBeNull()
        // 跳過去後改點左選單:任何分頁都到得了,連結消失
        w.jump(target)
        w.select('general')
        expect(w.s.tab).toBe('general')
        expect(w.backLink()).toBeNull()
        w.select('hotkeys')
        expect(w.s.tab).toBe('hotkeys')
        expect(w.backLink()).toBeNull()
      }
      if (browser) expect(browser.left).toBe(false)
      else expect(browser).toBeNull()
    })
  }
})

describe('瀏覽器預覽的上一頁 / 下一頁', () => {
  it('跳轉後按上一頁回到熱鍵(捲回原位、不離開預覽頁),下一頁再回來且返回連結還在', () => {
    const br = new FakeBrowser('#tab=hotkeys')
    const w = makeSettings({ browser: br, start: 'hotkeys' })
    expect(br.entries).toHaveLength(1)
    expect(br.location.hash).toBe('#tab=hotkeys')
    w.s.scroll = 500
    w.jump('stash-chat')
    expect(br.entries.map(e => e.hash)).toEqual(['#tab=hotkeys', '#tab=stash-chat'])
    br.back()
    expect(br.left).toBe(false)
    expect(w.s.tab).toBe('hotkeys')
    expect(w.s.scroll).toBe(500)
    expect(w.backLink()).toBeNull()
    expect(br.entries).toHaveLength(2) // 套回來的不再 push
    br.forward()
    expect(w.s.tab).toBe('stash-chat')
    expect(w.backLink()).toEqual({ from: 'hotkeys', target: 'stash-chat', scroll: 500 })
    expect(br.entries).toHaveLength(2)
  })

  it('改版前的行為(沒有歷史)= 上一頁直接離開預覽頁;改版後要按到第一筆之前才離開', () => {
    const before = new FakeBrowser('#tab=hotkeys')
    // 改版前:換分頁不碰歷史
    before.back()
    expect(before.left).toBe(true)
    const br = new FakeBrowser('#tab=hotkeys')
    const w = makeSettings({ browser: br, start: 'hotkeys' })
    w.jump('stash-chat')
    w.select('general')
    w.select('regex')
    br.back(); expect(w.s.tab).toBe('general')
    br.back(); expect(w.s.tab).toBe('stash-chat')
    expect(w.backLink()?.from).toBe('hotkeys')
    br.back(); expect(w.s.tab).toBe('hotkeys')
    expect(br.left).toBe(false)
    br.back(); expect(br.left).toBe(true)
  })

  it('返回連結 = 新的一筆歷史;上一頁回到跳轉後的那一頁', () => {
    const br = new FakeBrowser('#tab=hotkeys')
    const w = makeSettings({ browser: br, start: 'hotkeys' })
    w.jump('regex')
    w.goBack()
    expect(br.entries.map(e => e.hash)).toEqual(['#tab=hotkeys', '#tab=regex', '#tab=hotkeys'])
    br.back()
    expect(w.s.tab).toBe('regex')
  })

  it('同一分頁再點不新增歷史;手改網址 hash 照 hash 開(舊 id 映射),之後不重複 push', () => {
    const br = new FakeBrowser('')
    const w = makeSettings({ browser: br, start: 'general', game: 'poe1' })
    expect(br.location.hash).toBe('#tab=general')
    w.select('general')
    expect(br.entries).toHaveLength(1)
    br.typeHash('#tab=chat')
    expect(w.s.tab).toBe('stash-chat')
    expect(br.location.hash).toBe('#tab=stash-chat')
    const n = br.entries.length
    w.select('stash-chat')
    expect(br.entries).toHaveLength(n)
    br.typeHash('#tab=recognition') // PoE1 看不到自動辨識 → 遊戲
    expect(w.s.tab).toBe('game')
  })

  it('關掉設定(stop)後不再處理上一頁', () => {
    const br = new FakeBrowser('#tab=hotkeys')
    const w = makeSettings({ browser: br, start: 'hotkeys' })
    w.jump('regex')
    w.stop()
    br.back()
    expect(w.s.tab).toBe('regex')
  })
})

describe('接線', () => {
  const sw = read(`${SETTINGS}/SettingsWindow.vue`)
  const hk = read(`${SETTINGS}/tabs/Hotkeys.vue`)
  it('熱鍵總表的唯讀列與「到 … 編輯」都走 jumpToTab(記來源與捲動位置)', () => {
    expect(hk).toContain("jumpToTab('hotkeys', id, body?.scrollTop ?? 0)")
    expect(hk).not.toMatch(/settingsTab\.value\s*=/)
    expect(hk.match(/@click="goto\([a-z.]+\.tab, \$event\)"/g)).toHaveLength(2)
    expect(read(`${SETTINGS}/tabState.ts`)).toMatch(/export function jumpToTab \(from: TabId, to: TabId, scroll = 0\): void \{\s*settingsBack\.value = from === to \? null : \{ from, target: to, scroll \}\s*settingsTab\.value = to/)
  })
  it('SettingsWindow:返回連結只在 backTo 時顯示、切分頁清掉、歷史只在預覽 / 純瀏覽器、卸載時解除', () => {
    expect(sw).toContain('<div v-if="backTo" class="sw-back-row">')
    expect(sw).toContain('data-action="settings-back"')
    expect(sw).toContain("t('ppz.settings_back', { page: tabName(backTo.from) })")
    expect(sw).toContain('const backTo = computed(() => nextBack(settingsBack.value, tab.value))')
    // 先同步歷史(讀離開那一頁的捲動)再捲回頂端;換分頁捲回頂端只剩這一處
    expect(sw).toMatch(/watch\(\[tab, settingsBack\], \(\[t, back\], \[oldTab\]\) => \{\s*const kept = nextBack\(back, t\)\s*if \(kept !== back\) settingsBack\.value = kept\s*tabHistory\?\.changed\(t, kept\)\s*if \(t !== oldTab && bodyEl\.value\) bodyEl\.value\.scrollTop = 0/)
    expect(sw.match(/scrollTop = 0/g)).toHaveLength(1)
    expect(sw).toContain('const tabHistory = usesBrowserHistory(Host) &&')
    expect(sw).toContain("addPopListener: (fn) => window.addEventListener('popstate', fn)")
    expect(sw).toMatch(/onBeforeUnmount\(\(\) => \{\s*tabHistory\?\.stop\(\)/)
    // 左選單仍直接改分頁(不經歷史 API),歷史由 watch 同步
    expect(sw).toContain('selectTab (id: TabId) { lastTab.value = id }')
  })
  it('i18n 兩語', () => {
    const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz
    const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz
    expect(zh.settings_back).toBe('回到{page}')
    expect(en.settings_back).toBe('Back to {page}')
    expect(zh.tab_hotkeys).toBe('熱鍵')
  })
})
