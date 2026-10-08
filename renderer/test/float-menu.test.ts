/**
 * 2026-10-08 APT 式懸浮選單:位置正規化 / 夾回、拖曳存比例、速查表放大框、書籤動作(目前遊戲貼上 / 另一代複製)、
 * 設定往返、overlayKey 改開選單的接線、托盤仍直接開設定、overlay 圖層回報、速查表 IPC / 協定守門、字串兩語。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest, hostConfigOf } from '../src/web/Config'
import { bookmarkActionFor, floatMenuPlace, floatMenuPosOf, normFloatMenuPos, sheetZoomRect, FLOAT_MENU_MARGIN } from '../src/web/overlay/float-menu-geom'
import { bgImageUrl } from '../src/web/useTheme'
import { QUICK_REASONS, quickNoticeKey } from '../src/web/regex/quick-geom'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const VIEW = { w: 1920, h: 1080 }
const MENU = { w: 300, h: 400 }

describe('位置', () => {
  it('normFloatMenuPos:只收 0–1 的 x / y', () => {
    expect(normFloatMenuPos({ x: 0.5, y: 0.25 })).toEqual({ x: 0.5, y: 0.25 })
    for (const bad of [null, undefined, 'x', { x: 0.5 }, { x: -0.1, y: 0 }, { x: 0, y: 1.2 }, { x: NaN, y: 0 }, { x: '0.5', y: 0.5 }]) {
      expect(normFloatMenuPos(bad)).toBeNull()
    }
  })
  it('null = 左上角預設;比例換算;夾回畫面內(換解析度)', () => {
    expect(floatMenuPlace(null, VIEW, MENU)).toEqual({ left: FLOAT_MENU_MARGIN, top: FLOAT_MENU_MARGIN })
    expect(floatMenuPlace({ x: 0.5, y: 0.5 }, VIEW, MENU)).toEqual({ left: 960, top: 540 })
    // 存在大畫面的右下角 → 小畫面夾回
    expect(floatMenuPlace({ x: 0.95, y: 0.95 }, { w: 1280, h: 720 }, MENU)).toEqual({ left: 1280 - 300 - 4, top: 720 - 400 - 4 })
    // 選單比畫面大 → 貼左上
    expect(floatMenuPlace({ x: 0.5, y: 0.5 }, { w: 200, h: 200 }, MENU)).toEqual({ left: 4, top: 4 })
  })
  it('拖曳放開 → 比例(先夾回),再放回去位置相同', () => {
    const pos = floatMenuPosOf({ left: 700, top: 300 }, VIEW, MENU)
    expect(pos).toEqual({ x: Math.round(700 / 1920 * 10000) / 10000, y: Math.round(300 / 1080 * 10000) / 10000 })
    const back = floatMenuPlace(pos, VIEW, MENU)
    expect(Math.abs(back.left - 700)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.top - 300)).toBeLessThanOrEqual(1)
    expect(floatMenuPosOf({ left: 5000, top: -50 }, VIEW, MENU)).toEqual(floatMenuPosOf({ left: 1920 - 300 - 4, top: 4 }, VIEW, MENU))
  })
})

describe('速查表放大框', () => {
  it('選單在左 → 右側到畫面邊;選單在右 → 左側', () => {
    const r = sheetZoomRect({ left: 24, top: 24, w: 300, h: 400 }, VIEW)
    expect(r.left).toBe(24 + 300 + 16)
    expect(r.left + r.w).toBe(1920 - 24)
    expect(r.top).toBe(24)
    expect(r.h).toBe(1080 - 48)
    const l = sheetZoomRect({ left: 1500, top: 24, w: 300, h: 400 }, VIEW)
    expect(l.left).toBe(24)
    expect(l.left + l.w).toBe(1500 - 16)
  })
})

describe('書籤動作', () => {
  it('目前遊戲 = 貼上;另一代 = 只複製(提示字串)', () => {
    expect(bookmarkActionFor('poe1', 'poe1')).toBe('paste')
    expect(bookmarkActionFor('poe2', 'poe1')).toBe('copy')
    expect(bookmarkActionFor('poe1', 'poe2')).toBe('copy')
    expect(QUICK_REASONS).toContain('other-game')
    expect(quickNoticeKey({ pasted: false, copied: true, reason: 'other-game' })).toBe('ppz.regex.quick_reason_other_game')
  })
})

describe('速查表網址', () => {
  it('app://sheet/ / 預覽 sheet/;不合法檔名 = null;背景圖網址不變', () => {
    expect(bgImageUrl('syndicate-0a1b2c3d.png', { electron: true, preview: false, baseURI: '' }, 'sheet')).toBe('app://sheet/syndicate-0a1b2c3d.png')
    expect(bgImageUrl('a b.png', { electron: true, preview: true, baseURI: 'http://127.0.0.1:1/t/abc/' }, 'sheet')).toBe('http://127.0.0.1:1/t/abc/sheet/a%20b.png')
    expect(bgImageUrl('../x.png', { electron: true, preview: false, baseURI: '' }, 'sheet')).toBeNull()
    expect(bgImageUrl('sky.png', { electron: true, preview: false, baseURI: '' })).toBe('app://bg/sky.png')
  })
})

describe('設定往返', () => {
  it('舊設定檔 → 左上角預設 / 沒有速查表;壞值同;合法值往返', () => {
    for (const raw of [null, '{"game":"poe1"}', '{"floatMenu":{"x":2,"y":0},"cheatSheet":"../evil.png"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.floatMenu).toBeNull()
      expect(config.cheatSheet).toBe('')
      expect(JSON.parse(serialized)).toMatchObject({ floatMenu: null, cheatSheet: '' })
    }
    const r = _roundTripForTest('{"floatMenu":{"x":0.3,"y":0.1},"cheatSheet":"syndicate-0a1b2c3d.png"}')
    expect(r.config.floatMenu).toEqual({ x: 0.3, y: 0.1 })
    expect(r.config.cheatSheet).toBe('syndicate-0a1b2c3d.png')
    expect(JSON.parse(r.serialized)).toMatchObject({ floatMenu: { x: 0.3, y: 0.1 }, cheatSheet: 'syndicate-0a1b2c3d.png' })
  })
  it('不進 host-config(main 用不到)', () => {
    const h = hostConfigOf(_roundTripForTest('{"floatMenu":{"x":0.3,"y":0.1},"cheatSheet":"a.png"}').config, []) as unknown as Record<string, unknown>
    expect('floatMenu' in h).toBe(false)
    expect('cheatSheet' in h).toBe(false)
  })
})

describe('接線守門', () => {
  const app = read('renderer/src/web/App.vue')
  it('overlayKey(沒有物品)改開懸浮選單,不再直接開設定', () => {
    const i = app.indexOf("console.log('[app] overlayKey 叫出懸浮選單')")
    expect(i).toBeGreaterThan(-1)
    const block = app.slice(app.lastIndexOf('state.usingHotkey && !panelShown.value', i), i)
    expect(block).toContain('floatMenuOpen.value = true')
    expect(block).not.toContain('showSettings.value = true')
  })
  it('托盤 / 更新提醒仍直接開設定', () => {
    expect(app).toContain("Host.onOpenSettings(({ tab }) => { openSettingsTo(tab, '托盤') })")
  })
  it('選單只在 overlay;設定開關、貼上、收起都接上;失焦 / 物品進來 / 快速面板 / 框選層收起選單', () => {
    expect(app).toMatch(/<float-menu v-if="isOverlay && floatMenuOpen" :settings-open="settingsVisible"/)
    expect(app).toContain('@close="closeFloatMenu" @settings="menuToggleSettings" @pasted="onMenuPasted"')
    expect(app).toContain("closeFloatMenu('focus-change')")
    expect(app.match(/floatMenuOpen\.value = false/g)!.length).toBeGreaterThanOrEqual(4)
    expect(app).toContain("closeFloatMenu('點背景')")
  })
  it('overlay 圖層回報含 menu(否則遊戲前景時視窗可能被閒置隱藏)', () => {
    expect(app).toContain('menu: floatMenuOpen.value }, overlayLayers)')
    expect(read('main/src/windowing/overlay-idle.ts')).toContain("'quick', 'menu'] as const")
    expect(read('ipc/types.ts')).toMatch(/menu\?: boolean/)
  })
  it('選單:書籤目前遊戲貼上(source menu)、另一代複製;速查表只在 Electron 視窗選檔', () => {
    const m = read('renderer/src/web/overlay/FloatMenu.vue')
    expect(m).toContain("runRegexBookmark(index, 'menu')")
    expect(m).toContain('copyRegexBookmark(index)')
    expect(m).toContain('bookmarkGroupsOf(listGame.value, true)')
    expect(m).toContain('Host.sheetPick()')
    expect(m).toContain("'sheet')")
    // 尺寸不用 rem(跟全域字級)
    expect(m).not.toMatch(/\d(\.\d+)?rem/)
  })
  it('sheet-pick:preview: false、另開資料夾;app://sheet/ 與預覽路由', () => {
    const main = read('main/src/main.ts')
    expect(main).toMatch(/'sheet-pick': \{ kind: 'invoke', preview: false, fn: \(\) => pickImageInto\(SHEET_DIR\(\)/)
    expect(main).toContain("url.host === 'bg' || url.host === 'sheet'")
    expect(main).toContain('sheetDir: SHEET_DIR()')
    expect(read('main/src/backgrounds.ts')).toContain("SHEET_DIR_NAME = 'cheatsheets'")
    expect(read('main/src/preload.ts')).toContain("sheetPick: () => ipcRenderer.invoke('sheet-pick')")
    expect(main).toMatch(/o\.source === 'hotkey' \|\| o\.source === 'menu'/)
  })
})

describe('字串兩語', () => {
  const keys = ['title', 'settings', 'bookmarks', 'sheet', 'close', 'drag', 'bm_hint_paste', 'bm_hint_copy', 'bm_empty', 'sheet_zoom',
    'sheet_hover_hint', 'sheet_pinned_hint', 'sheet_peek_hint', 'sheet_close', 'sheet_title', 'sheet_change', 'sheet_remove',
    'sheet_empty', 'sheet_empty_sub', 'sheet_import', 'sheet_no_dialog', 'sheet_failed']
  for (const lang of ['cmn-Hant', 'en']) {
    it(lang, () => {
      const j = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz
      for (const k of keys) {
        expect(typeof j.menu[k], k).toBe('string')
        expect(j.menu[k], k).not.toMatch(/[|@$]/)
      }
      expect(j.menu.bm_empty).toContain('{game}')
      expect(typeof j.regex.quick_reason_other_game).toBe('string')
    })
  }
  it('繁中沒有簡體字', () => {
    const j = JSON.stringify(JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.menu)
    expect(j).not.toMatch(/[单设复制载显]/)
  })
})
