// 第 39 步(設定頁資訊架構整理)守門:分頁表與舊 id 映射、熱鍵總表涵蓋 hotkey-conflicts.ts 的全部熱鍵、
// PoE1 不顯示自動辨識頁、條件隱藏、功能頁不再放全域熱鍵、說明一句 + 「?」、i18n 兩語齊全。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEGACY_SETTINGS_TABS, SETTINGS_TABS, SETTINGS_TAB_GROUPS, isTabVisible, resolveSettingsTab, visibleTabs } from '../src/web/settings/settings-tabs'
import { OPTIONAL_HOTKEY_FIELDS, hotkeyTable, hotkeyTableIds } from '../src/web/settings/hotkey-table'
import { _roundTripForTest } from '../src/web/Config'
import { hotkeySlots, type HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'
import { hasCurrencyVolume, hasDefaultCurrency, hasItemHover } from '../src/web/settings/tabs/price-check-options'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz
const en = JSON.parse(read('renderer/src/i18n/en.json')).ppz
const get = (o: any, k: string) => k.split('.').reduce((a, p) => a?.[p], o)
const SETTINGS = 'renderer/src/web/settings'
const TAB_FILES = ['General', 'Game', 'PriceCheck', 'StashChat', 'Recognition', 'Hotkeys', 'About', 'Regex', 'Dust', 'Log'].map(f => `${SETTINGS}/tabs/${f}.vue`)
const SETTINGS_FILES = [...TAB_FILES, ...['SettingsWindow.vue', 'OcrScanSection.vue', 'BadgeStyleSection.vue', 'HelpTip.vue', 'OverlayGate.vue', 'hotkey-table.ts', 'settings-tabs.ts', 'useHotkeyIssues.ts'].map(f => `${SETTINGS}/${f}`)]
/** 第 39 步前的分頁 id(SettingsTabId 舊值) */
const OLD_IDS = ['general', 'price-check', 'hotkeys', 'chat', 'regex', 'dust', 'log', 'about']

describe('分頁表與舊 id 映射', () => {
  it('分頁 id 與 ipc/types.ts 的 SettingsTabId 一致、不重複;兩組依序 = 設定 7 頁 + 工具 3 頁', () => {
    const m = /export type SettingsTabId = ([^\n]+)/.exec(read('ipc/types.ts'))!
    const union = [...m[1].matchAll(/'([a-z-]+)'/g)].map(x => x[1])
    expect(SETTINGS_TABS.map(t => t.id)).toEqual(union)
    expect(new Set(union).size).toBe(union.length)
    expect(SETTINGS_TAB_GROUPS.map(g => g.id)).toEqual(['settings', 'tools'])
    expect(SETTINGS_TABS.filter(t => t.group === 'settings').map(t => t.id)).toEqual(['general', 'game', 'price-check', 'stash-chat', 'recognition', 'hotkeys', 'about'])
    expect(SETTINGS_TABS.filter(t => t.group === 'tools').map(t => t.id)).toEqual(['regex', 'dust', 'log'])
    expect(SETTINGS_TABS.filter(t => t.fill).map(t => t.id)).toEqual(['dust', 'log'])
  })
  it('舊值:chat → 倉庫與聊天;其餘舊 id 沿用;兩個遊戲都對得到看得見的分頁', () => {
    expect(LEGACY_SETTINGS_TABS).toEqual({ chat: 'stash-chat' })
    for (const game of ['poe1', 'poe2'] as const) {
      expect(resolveSettingsTab('chat', game)).toBe('stash-chat')
      for (const id of OLD_IDS) {
        const r = resolveSettingsTab(id, game)
        expect(isTabVisible(r, game), `${game} ${id} → ${r}`).toBe(true)
        if (id !== 'chat') expect(r).toBe(id)
      }
      expect(resolveSettingsTab('nonsense', game)).toBe('general')
      expect(resolveSettingsTab(undefined, game)).toBe('general')
      expect(resolveSettingsTab('__proto__', game)).toBe('general')
    }
  })
  it('PoE1 不顯示自動辨識頁(選單看不到、指定了改到「遊戲」);PoE2 顯示', () => {
    expect(visibleTabs('poe1').map(t => t.id)).not.toContain('recognition')
    expect(visibleTabs('poe2').map(t => t.id)).toContain('recognition')
    expect(resolveSettingsTab('recognition', 'poe1')).toBe('game')
    expect(resolveSettingsTab('recognition', 'poe2')).toBe('recognition')
    expect(visibleTabs('poe1')).toHaveLength(SETTINGS_TABS.length - 1)
  })
  it('跳轉呼叫:托盤 / 預覽網址經 resolveSettingsTab;OCR 框選回自動辨識;⚖ 拆粉排行;書籤列「前往正則」', () => {
    const app = read('renderer/src/web/App.vue')
    expect(app).toMatch(/function openSettingsTo \(requested: SettingsTabId \| LegacySettingsTabId, reason: string\) \{\s*const tab = resolveSettingsTab\(requested, AppConfig\(\)\.game\)\s*settingsTab\.value = tab/)
    expect(app).toContain("Host.onOpenSettings(({ tab }) => { openSettingsTo(tab, '托盤') })")
    expect(app).toContain("openSettingsTo('recognition', `框選結束:${c.outcome}`)")
    expect(app).not.toContain("openSettingsTo('hotkeys'")
    expect(app).toContain("openSettingsTo('dust', '⚖')")
    expect(app).toContain("openRegexTab () { settingsTab.value = 'regex' }")
    // 托盤「關於」照舊送 about
    expect(read('main/src/main.ts')).toContain("openSettings('about')")
    // 預覽網址 #tab= 接受的 id = 新的全部 + 舊的 chat
    const tabs = /var TABS=\[([^\]]+)\]/.exec(read('main/src/preview-server.ts'))![1].split(',').map(s => s.replace(/'/g, ''))
    expect(new Set(tabs)).toEqual(new Set([...SETTINGS_TABS.map(t => t.id), ...Object.keys(LEGACY_SETTINGS_TABS)]))
  })
  it('設定視窗:選單依組畫、實際分頁 = resolveSettingsTab(記住的分頁, 遊戲)、窄版藏組標題', () => {
    const sw = read(`${SETTINGS}/SettingsWindow.vue`)
    expect(sw).toContain('const tab = computed<TabId>(() => resolveSettingsTab(lastTab.value, config.game))')
    expect(sw).toMatch(/v-for="grp in navGroups"[\s\S]*class="sw-nav-group"[\s\S]*v-for="tb in grp\.tabs"/)
    expect(sw).toMatch(/@container settings-window \(max-width: 639px\) \{[\s\S]*\.sw-nav-group \{\s*display: none;/)
    for (const t of SETTINGS_TABS) expect(sw, t.id).toMatch(new RegExp(`'?${t.id}'?: \\w+Tab`))
  })
})

/** 什麼都填滿的設定(每個熱鍵欄位都有值、聊天指令 / 倉庫搜尋 / 書籤熱鍵各有幾筆,含另一遊戲與空白的) */
function fullConfig (game: 'poe1' | 'poe2', over: Partial<HotkeyConfigLike> = {}): HotkeyConfigLike {
  return {
    hotkey: 'D',
    hotkeyHold: 'Ctrl',
    hotkeyLocked: 'Ctrl + Alt + D',
    overlayKey: 'Shift + Space',
    game,
    hotkeyOcrReveal: 'Ctrl + Shift + R',
    hotkeyOcrRegion: 'F6',
    hotkeyRuneshapeToggle: 'F7',
    hotkeyRuneshapeRegion: 'F8',
    revealAutoEnabled: true,
    runeshapeEnabled: true,
    commands: [{ text: '/hideout', hotkey: 'F5' }, { text: '  ', hotkey: 'F2' }, { text: '@last ty', hotkey: '' }],
    stashSearch: [{ text: '"rgb"', hotkey: 'F10' }, { text: '', hotkey: 'F11' }],
    hotkeyRegexQuick: 'F4',
    regexBookmarkHotkeys: [
      { index: 0, name: 'maps', game: 'poe1', hotkey: 'Ctrl + 1' },
      { index: 1, name: 'way', game: 'poe2', hotkey: 'Ctrl + 2' },
      { index: 2, name: 'empty', game: game, hotkey: ' ' }
    ],
    ...over
  }
}

describe('熱鍵總表', () => {
  const variants: Array<[string, HotkeyConfigLike]> = []
  for (const game of ['poe1', 'poe2'] as const) {
    variants.push([`${game} 全開`, fullConfig(game)])
    variants.push([`${game} 辨識關`, fullConfig(game, { revealAutoEnabled: false, runeshapeEnabled: false })])
    variants.push([`${game} 空`, fullConfig(game, { commands: [], stashSearch: [], regexBookmarkHotkeys: [], hotkeyRegexQuick: '', hotkeyRuneshapeRegion: undefined })])
  }
  it('overlay 模式:涵蓋 hotkey-conflicts.ts hotkeySlots 的全部欄位,且 id 不重複', () => {
    for (const [name, c] of variants) {
      const ids = hotkeyTableIds(c, { overlay: true })
      expect(new Set(ids).size, name).toBe(ids.length)
      for (const s of hotkeySlots(c)) expect(ids, `${name}: ${s.id}`).toContain(s.id)
    }
  })
  it('辨識功能關著時暫停鍵仍列在總表(可先設好),並標記 needs;PoE1 沒有自動辨識組', () => {
    const rows = hotkeyTable(fullConfig('poe2', { revealAutoEnabled: false, runeshapeEnabled: false }), { overlay: true }).find(g => g.id === 'scan')!.rows
    expect(rows.map(r => r.id)).toEqual(['ocr', 'region', 'runeshape', 'runeRegion'])
    expect(rows.filter(r => r.kind === 'edit' && r.needs).map(r => r.id)).toEqual(['ocr', 'runeshape'])
    expect(hotkeyTable(fullConfig('poe1'), { overlay: true }).map(g => g.id)).toEqual(['price', 'menu', 'stash-chat', 'regex'])
    expect(hotkeyTable(fullConfig('poe2'), { overlay: true }).map(g => g.id)).toEqual(['price', 'menu', 'scan', 'stash-chat', 'regex'])
  })
  it('window 模式只列查價兩個(其餘只在 overlay 註冊,同 main buildShortcutActions)', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      expect(hotkeyTableIds(fullConfig(game), { overlay: false })).toEqual(['quick', 'locked'])
    }
    const actions = read('main/src/shortcut-actions.ts')
    const head = actions.slice(actions.indexOf('export function buildShortcutActions'), actions.indexOf("if (mode === 'overlay')"))
    expect(head).toContain("type: 'copy-item', focusOverlay: false")
    expect(head).toContain("type: 'copy-item', focusOverlay: true")
    expect(head).not.toContain('toggle-overlay')
  })
  it('聊天指令 / 倉庫搜尋 / 個別書籤熱鍵唯讀、點了跳到各自頁面;其餘在總表編輯且設定鍵不重複', () => {
    const groups = hotkeyTable(fullConfig('poe2'), { overlay: true })
    const rows = groups.flatMap(g => g.rows)
    for (const r of rows) {
      if (/^(cmd|stash):/.test(r.id)) expect(r).toMatchObject({ kind: 'ref', tab: 'stash-chat' })
      else if (/^rxbm:/.test(r.id)) expect(r).toMatchObject({ kind: 'ref', tab: 'regex' })
      else expect(r.kind, r.id).toBe('edit')
    }
    const fields = rows.flatMap(r => r.kind === 'edit' ? [r.field] : [])
    expect(new Set(fields).size).toBe(fields.length)
    expect(fields.sort()).toEqual(['hotkey', 'hotkeyLocked', 'hotkeyOcrRegion', 'hotkeyOcrReveal', 'hotkeyRegexQuick', 'hotkeyRuneshapeRegion', 'hotkeyRuneshapeToggle', 'overlayKey'])
    // 只列目前遊戲、熱鍵非空的書籤
    expect(rows.filter(r => r.id.startsWith('rxbm:')).map(r => r.id)).toEqual(['rxbm:1'])
  })
  it('熱鍵分頁由 hotkeyTable 產生、即時衝突標示走 useHotkeyIssues;功能頁不再放全域熱鍵欄位', () => {
    const vue = read(`${SETTINGS}/tabs/Hotkeys.vue`)
    // 第 36 步:opts 多帶書籤資料夾(只標名稱,不影響列與順序)
    expect(vue).toMatch(/hotkeyTable\(\s*\{ \.\.\.config, regexBookmarkHotkeys: regexBookmarkHotkeyList\.value \},\s*\{ overlay: config\.overlayMode, bookmarkFolders: regexBookmarkFolders\.value \}\)/)
    expect(vue).toMatch(/v-for="g in groups"[\s\S]*v-for="r in g\.rows"/)
    expect(vue).toContain('issueText(r.id, rowHotkey(r))')
    expect(vue).toContain('sharedText(r.id)')
    expect(vue).toMatch(/<hotkey-input v-else v-model="config\[r\.field\]"/)
    for (const f of ['General', 'Game', 'PriceCheck', 'Recognition', 'About', 'Regex']) {
      expect(read(`${SETTINGS}/tabs/${f}.vue`), f).not.toMatch(/<hotkey-input/)
    }
    expect(read(`${SETTINGS}/OcrScanSection.vue`)).not.toMatch(/<hotkey-input|HotkeyInput/)
    // 與項目綁在一起的熱鍵留在各自頁面
    const sc = read(`${SETTINGS}/tabs/StashChat.vue`)
    expect(sc).toContain('<hotkey-input v-model="c.hotkey"')
    expect(sc).toContain('<hotkey-input v-model="s.hotkey"')
    expect(read('renderer/src/web/regex/RegexBookmarks.vue')).toContain('<hotkey-input')
  })
  it('第 36 步:選填熱鍵(Config 預設空)標 optional →「未設定」灰字;有預設值的維持紅字', () => {
    const { config } = _roundTripForTest(null)
    const rows = hotkeyTable(fullConfig('poe2'), { overlay: true }).flatMap(g => g.rows)
    const edits = rows.flatMap(r => r.kind === 'edit' ? [r] : [])
    expect(edits.length).toBe(8)
    for (const r of edits) {
      const def = (config as unknown as Record<string, unknown>)[r.field]
      expect(typeof def, r.field).toBe('string')
      expect(r.optional === true, r.field).toBe(def === '')
      expect(OPTIONAL_HOTKEY_FIELDS.includes(r.field), r.field).toBe(def === '')
    }
    expect([...OPTIONAL_HOTKEY_FIELDS].sort()).toEqual(['hotkeyOcrRegion', 'hotkeyRegexQuick', 'hotkeyRuneshapeRegion', 'hotkeyRuneshapeToggle'])
    expect(read(`${SETTINGS}/tabs/Hotkeys.vue`)).toContain('<hotkey-input v-else v-model="config[r.field]" :optional="r.optional === true"')
    const hi = read(`${SETTINGS}/HotkeyInput.vue`)
    expect(hi).toContain("'is-optional': optional")
    expect(hi).toMatch(/\.hotkey-input\.is-empty::placeholder \{\s*color: var\(--bad\);/)
    expect(hi).toMatch(/\.hotkey-input\.is-empty\.is-optional::placeholder \{\s*color: var\(--ink-3\);/)
    // 書籤熱鍵也是選填(第 33 步原本在 RegexBookmarks.vue 自己蓋顏色,改用同一個 prop)
    const bm = read('renderer/src/web/regex/RegexBookmarks.vue')
    expect(bm).toMatch(/<hotkey-input [^>]*\boptional\b/)
    expect(bm).not.toContain('.rx-bm-hotkey.is-empty::placeholder')
    // 衝突 / 註冊失敗仍是紅字(.err)
    expect(read(`${SETTINGS}/tabs/Hotkeys.vue`)).toContain('<span v-if="issueText(r.id, rowHotkey(r))" class="err"')
  })
  it('第 36 步:書籤唯讀列標資料夾名(未分類不標),列與順序不變', () => {
    const c = fullConfig('poe2', {
      regexBookmarkHotkeys: [
        { index: 0, name: 'a', game: 'poe2', hotkey: 'F6' },
        { index: 1, name: 'b', game: 'poe2', hotkey: 'F7' },
        { index: 2, name: 'c', game: 'poe1', hotkey: 'F8' }
      ]
    })
    const plain = hotkeyTable(c, { overlay: true }).flatMap(g => g.rows).filter(r => r.id.startsWith('rxbm:'))
    const withF = hotkeyTable(c, { overlay: true, bookmarkFolders: ['地圖', '', '倉庫'] }).flatMap(g => g.rows).filter(r => r.id.startsWith('rxbm:'))
    expect(withF.map(r => r.id)).toEqual(plain.map(r => r.id))
    expect(withF.map(r => r.kind === 'ref' ? r.folder ?? '' : '?')).toEqual(['地圖', ''])
    expect(read(`${SETTINGS}/tabs/Hotkeys.vue`)).toContain('<span v-if="r.folder" class="hk-ref-folder" data-hk-folder>{{ r.folder }} ›</span>')
  })
  it('列標籤與組標題兩語都有', () => {
    for (const g of hotkeyTable(fullConfig('poe2'), { overlay: true })) {
      for (const k of [g.title, ...g.rows.map(r => r.label)]) {
        const key = k.replace(/^ppz\./, '')
        expect(typeof get(zh, key), `zh ${k}`).toBe('string')
        expect(typeof get(en, key), `en ${k}`).toBe('string')
      }
    }
    // 組標題「設定選單」與列標籤不同字
    const menu = hotkeyTable(fullConfig('poe2'), { overlay: true }).find(g => g.id === 'menu')!
    expect(get(zh, menu.title.slice(4))).not.toBe(get(zh, menu.rows[0].label.slice(4)))
  })
})

describe('條件隱藏', () => {
  it('純函式:預設價格通貨只 PoE1、成交量只國際服、懸停物品只 PoE2', () => {
    expect([hasDefaultCurrency('poe1'), hasDefaultCurrency('poe2')]).toEqual([true, false])
    expect([hasCurrencyVolume('intl'), hasCurrencyVolume('tw')]).toEqual([true, false])
    expect([hasItemHover('poe1'), hasItemHover('poe2')]).toEqual([false, true])
  })
  it('查價分頁:三個條件都是 v-if(不再只放說明),面板顯示卡片沒有任何一項整張不顯示', () => {
    const vue = read(`${SETTINGS}/tabs/PriceCheck.vue`)
    expect(vue).toMatch(/<div v-if="showDefaultCurrency" class="srow">\s*<span class="k">\{\{ t\('ppz\.default_currency'\) \}\}/)
    expect(vue).toContain('<section v-if="showVolume || showItemHover" class="card" data-setting="panel-section">')
    expect(vue).not.toContain('default_currency_hint')
  })
  it('只在 overlay 有作用的:倉庫與聊天 / 自動辨識整頁換成 OverlayGate、點面板外關閉、正則快速面板熱鍵', () => {
    for (const f of ['StashChat', 'Recognition']) {
      expect(read(`${SETTINGS}/tabs/${f}.vue`), f).toMatch(/<overlay-gate v-if="!config\.overlayMode" \/>\s*<template v-else>/)
    }
    expect(read(`${SETTINGS}/tabs/Game.vue`)).toMatch(/<div v-if="config\.overlayMode" class="chk-row">\s*<label class="chk"><input v-model="config\.overlayBackgroundClose"/)
    expect(read(`${SETTINGS}/tabs/Regex.vue`)).toMatch(/<div v-if="config\.overlayMode" class="srow">\s*<span class="k">\{\{ t\('ppz\.regex\.quick_hotkey'\) \}\}/)
    expect(read(`${SETTINGS}/OverlayGate.vue`)).toContain("settingsTab.value = 'game'")
  })
  it('免安裝版不顯示自動更新開關;舊的「只在 overlay 有效」警告全部移除', () => {
    expect(read(`${SETTINGS}/tabs/About.vue`)).toMatch(/<template v-if="info\?\.reason !== 'not-supported'">\s*<div class="chk-row">\s*<label class="chk"><input v-model="config\.autoUpdate"/)
    for (const f of SETTINGS_FILES) {
      const s = read(f)
      for (const gone of ['chat-overlay-only', 'regex-quick-overlay-only', 'scan-hotkeys-moved', 'chat.overlay_only', 'quick_overlay_only', 'hotkeys_moved']) {
        expect(s, `${f} ${gone}`).not.toContain(gone)
      }
    }
  })
})

describe('文字:一句說明 + 「?」、刪重複、i18n', () => {
  const sources = SETTINGS_FILES.map(f => [f, read(f)] as const)
  it('設定頁用到的 ppz.* 字串兩語都有', () => {
    const keys = new Set<string>()
    for (const [, s] of sources) for (const m of s.matchAll(/'ppz\.([a-z0-9_.]+)'/g)) keys.add(m[1])
    expect(keys.size).toBeGreaterThan(150)
    for (const k of keys) {
      expect(typeof get(zh, k), `zh ${k}`).toBe('string')
      expect(typeof get(en, k), `en ${k}`).toBe('string')
    }
  })
  it('畫面上的說明(.lead / .note)每項只有一句;長說明在「?」', () => {
    let n = 0
    for (const [f, s] of sources) {
      for (const m of s.matchAll(/class="(?:lead|note)"[^>]*>\{\{ t\('ppz\.([a-z0-9_.]+)'/g)) {
        n++
        const z: string = get(zh, m[1])
        expect((z.match(/。/g) ?? []).length, `${f} ${m[1]}: ${z}`).toBeLessThanOrEqual(1)
        expect(z.length, `${f} ${m[1]}`).toBeLessThanOrEqual(60)
      }
    }
    expect(n).toBeGreaterThan(8)
  })
  it('隱私 / CPU 說明只在自動辨識頁共用卡片出現一次;卡片標題與開關不再重複「(PoE2)」', () => {
    const all = sources.map(([, s]) => s).join('\n')
    expect(all.match(/'ppz\.scan\.privacy'/g)).toHaveLength(1)
    expect(all.match(/'ppz\.scan\.cpu_help'/g)).toHaveLength(1)
    for (const k of ['ocr.privacy', 'ocr.cpu_hint', 'runeshape.cpu_hint', 'scan.hotkeys_moved', 'chat.overlay_only', 'regex.quick_overlay_only', 'default_currency_hint', 'tab_chat']) {
      expect(get(zh, k), k).toBeUndefined()
      expect(get(en, k), k).toBeUndefined()
    }
    for (const k of ['ocr.section', 'ocr.auto_enabled', 'runeshape.section', 'runeshape.enabled', 'badge_style.section', 'item_hover_hint', 'item_hover']) {
      expect(get(zh, k), k).not.toMatch(/PoE2|疊加模式/)
      expect(get(en, k), k).not.toMatch(/PoE2|overlay mode/)
    }
    // 「只截圖 + 本機 OCR、不送按鍵」只剩共用那一句
    const zhUsed = [...new Set([...all.matchAll(/'ppz\.([a-z0-9_.]+)'/g)].map(m => m[1]))].map(k => get(zh, k)).filter(v => typeof v === 'string') as string[]
    expect(zhUsed.filter(v => /不送任何按鍵|不送按鍵/.test(v))).toHaveLength(1)
  })
  it('標籤與按鈕不同字:瀏覽器預覽沒有同字標籤列、交易站驗證有標籤', () => {
    const g = read(`${SETTINGS}/tabs/General.vue`)
    expect(g).not.toMatch(/<span class="k">\{\{ t\('ppz\.preview\.open'\) \}\}<\/span>/)
    expect(g.match(/'ppz\.preview\.open'/g)).toHaveLength(1)
    const game = read(`${SETTINGS}/tabs/Game.vue`)
    expect(game).toMatch(/<span class="k">\{\{ t\('ppz\.trade_captcha'\) \}\}[\s\S]{0,200}t\('ppz\.trade_captcha_open'\)/)
    expect(get(zh, 'trade_captcha')).not.toBe(get(zh, 'trade_captcha_open'))
  })
  it('「?」可 hover / 聚焦 / 點擊 / Esc,有無障礙標籤;尺寸不用 rem', () => {
    const h = read(`${SETTINGS}/HelpTip.vue`)
    expect(h).toContain(':aria-label="label || t(\'ppz.help\')"')
    expect(h).toContain(':aria-expanded="shown"')
    expect(h).toContain(':aria-describedby="shown ? bubbleId : undefined"')
    expect(h).toContain('role="tooltip"')
    expect(h).toMatch(/@mouseenter="hover = true" @mouseleave="hover = false"/)
    expect(h).toContain('@click="toggle"')
    expect(h).toContain('@focus="focused = true"')
    expect(h).toContain('@keydown.esc.stop="close"')
    for (const f of SETTINGS_FILES.filter(x => x.endsWith('.vue'))) {
      expect(read(f).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), f).not.toMatch(/\d(?:\.\d+)?rem\b/)
    }
    expect(zh.help).toBe('說明')
    expect(en.help).toBe('Help')
  })
  it('選單 / 組標題兩語都有', () => {
    for (const k of [...SETTINGS_TABS.map(t => t.key), ...SETTINGS_TAB_GROUPS.map(g => g.key)]) {
      expect(typeof get(zh, k.slice(4)), k).toBe('string')
      expect(typeof get(en, k.slice(4)), k).toBe('string')
    }
  })
})
