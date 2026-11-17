// 地圖詞綴檢查(PoE1,移植 APT map-check;2026-11-18 起依正則書籤上色):熱鍵讀寫 / 總表 / 衝突、正則頁預設書籤、overlay 閒置回報、App.vue 接線。純函式 / 讀原始碼,不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import { OPTIONAL_HOTKEY_FIELDS, hotkeyTable } from '../src/web/settings/hotkey-table'
import { hotkeySlots, type HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'
import { SETTINGS_TABS } from '../src/web/settings/settings-tabs'
import { overlayContentKey, overlayContentOf } from '../src/web/overlay/overlay-content'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('熱鍵設定讀寫', () => {
  it('全新與舊設定檔 → 熱鍵空;設過的值讀得回來', () => {
    for (const raw of [null, '{"game":"poe1"}']) expect((_roundTripForTest(raw).config as any).hotkeyMapCheck).toBe('')
    const { serialized } = _roundTripForTest(JSON.stringify({ hotkeyMapCheck: 'Alt + D' }))
    expect((_roundTripForTest(serialized).config as any).hotkeyMapCheck).toBe('Alt + D')
  })
})

describe('熱鍵總表、衝突與設定分頁(T7)', () => {
  const cfg = (game: 'poe1' | 'poe2'): HotkeyConfigLike => ({
    hotkey: 'D', hotkeyHold: 'Ctrl', hotkeyLocked: 'Ctrl + Alt + D', overlayKey: 'Shift + Space', game,
    hotkeyOcrReveal: '', hotkeyOcrRegion: '', hotkeyRuneshapeToggle: '', hotkeyRuneshapeRegion: '',
    revealAutoEnabled: true, runeshapeEnabled: true, hotkeyStashToggle: '', hotkeyStashRegion: '', stashPricesEnabled: true,
    commands: [], stashSearch: [], hotkeyRegexQuick: '', regexBookmarkHotkeys: [], hotkeyMapCheck: 'Alt + D'
  } as HotkeyConfigLike)
  const row = (game: 'poe1' | 'poe2', overlay: boolean) => hotkeyTable(cfg(game), { overlay }).flatMap(g => g.rows).find(r => r.id === 'map-check')

  it('只在 PoE1 + overlay 列出(選填)', () => {
    expect(row('poe1', true)).toEqual({ kind: 'edit', id: 'map-check', label: 'ppz.hk.map_check', field: 'hotkeyMapCheck', optional: true })
    expect(row('poe2', true)).toBeUndefined()
    expect(row('poe1', false)).toBeUndefined()
    expect(OPTIONAL_HOTKEY_FIELDS).toContain('hotkeyMapCheck')
  })

  it('衝突檢查涵蓋它', () => {
    expect(hotkeySlots(cfg('poe1')).find(s => s.id === 'map-check')?.hotkey).toBe('Alt + D')
  })

  it('沒有獨立的「地圖詞綴」設定分頁(2026-11-18 改用正則書籤)', () => {
    expect(SETTINGS_TABS.some(t => (t.id as string) === 'map-check')).toBe(false)
  })

  it('字串兩語都有', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`renderer/src/i18n/${lang}.json`))
      for (const k of ['hk.map_check', 'map_check.bookmark', 'map_check.pick_bookmark', 'map_check.no_bookmark', 'map_check.default_label', 'map_check.default_none', 'map_check.default_lead']) {
        expect(k.split('.').reduce((o: any, p) => o?.[p], j.ppz), `${lang} ppz.${k}`).toBeTruthy()
      }
    }
  })
})

describe('overlay 閒置回報與 App.vue 接線(T8)', () => {
  it('地圖檢查開著也算 overlay 有內容', () => {
    const off = overlayContentOf({ panel: false, settings: false, picker: false }, { reveal: false, rune: false })
    const on = overlayContentOf({ panel: false, settings: false, picker: false, map: true }, { reveal: false, rune: false })
    expect(on.map).toBe(true)
    expect(overlayContentKey(on)).not.toBe(overlayContentKey(off))
    expect(read('main/src/windowing/overlay-idle.ts')).toMatch(/CONTENT_KEYS = \[[^\]]*'map'/)
  })

  it('target map-check 走地圖檢查、不是地圖類什麼都不做、不進一般查價', () => {
    const app = read('renderer/src/web/App.vue')
    const i = app.indexOf("e.target === 'map-check'")
    expect(i).toBeGreaterThan(-1)
    // 判斷在一般查價(load)之前就 return
    expect(app.indexOf('return', i)).toBeLessThan(app.indexOf('void load(e.clipboard)'))
    expect(app).toMatch(/isMapLike\(/)
    expect(app).toMatch(/<map-check-layer[^>]*v-if="isOverlay && mapCheckItem"/)
    expect(app).toMatch(/map: mapCheckItem\.value !== null/)
  })

  it('不是地圖類 / 不是 PoE1 → 一律把焦點還給遊戲(熱鍵已讓 overlay 取得焦點;快速查價面板開著也一樣)', () => {
    const app = read('renderer/src/web/App.vue')
    const fn = app.slice(app.indexOf('async function openMapCheck'), app.indexOf('hidePanel(\'地圖詞綴檢查\')'))
    const returns = fn.split('return').slice(0, -1)
    expect(returns.length).toBe(2)
    for (const before of returns) expect(before.trimEnd().split('\n').pop()).toMatch(/Host\.focusGame\(\);?$/)
    expect(fn).not.toMatch(/if \(!panelShown\.value\) Host\.focusGame/)
  })
})

describe('正則頁的預設書籤與圖層接線(R5、R8)', () => {
  it('設定 › 正則 書籤卡片(PoE1 分頁)有「地圖檢查書籤」下拉,寫 mapCheckBookmark', () => {
    const v = read('renderer/src/web/regex/RegexBookmarks.vue')
    expect(v).toMatch(/v-if="tab === 'poe1'" class="srow" data-regex="bm-map-check"/)
    expect(v).toContain('config.mapCheckBookmark = b ? mapCheckRefOf(b, list) : null')
    expect(v).toContain('mapCheckBookmarks(store.ui.bookmarks)')
  })

  it('圖層用正則書籤上色,視窗裡換書籤寫回同一個設定', () => {
    const v = read('renderer/src/web/overlay/MapCheckLayer.vue')
    expect(v).toContain('bookmarkMarks(pages.value, current.value)')
    expect(v).toContain('config.mapCheckBookmark = mapCheckRefOf(b, list.value)')
    expect(v).toMatch(/@update:bookmark="select"/)
  })
})

describe('正則書籤改名接線', () => {
  it('store.renameBookmark 改名前算好、改名後寫回 mapCheckBookmark', () => {
    const v = read('renderer/src/web/regex/store.ts')
    const fn = v.slice(v.indexOf('export function renameBookmark'), v.indexOf('export function setBookmarkHotkey'))
    expect(fn).toMatch(/mapCheckRefAfterRename\(ui\.bookmarks, cfg\.mapCheckBookmark, index, name\)[\s\S]*b\.name = name[\s\S]*cfg\.mapCheckBookmark = mapRef/)
  })
})
