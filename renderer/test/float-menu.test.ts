/**
 * 2026-10-08 APT 式懸浮選單:位置正規化 / 夾回、拖曳存比例、速查表放大框、書籤動作(目前遊戲貼上 / 另一代複製)、
 * 設定往返、overlayKey 改開選單的接線、托盤仍直接開設定、overlay 圖層回報、速查表 IPC / 協定守門、字串兩語。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOST_CONFIG_IMMEDIATE_KEYS, _roundTripForTest, hostConfigOf } from '../src/web/Config'
import { FLOAT_MENU_TOGGLES, bookmarkActionFor, floatMenuPlace, floatMenuPosOf, normFloatMenuPos, sheetZoomRect, FLOAT_MENU_MARGIN } from '../src/web/overlay/float-menu-geom'
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
    expect(read('main/src/windowing/overlay-idle.ts')).toContain("'quick', 'menu', 'stash'] as const")
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
    'sheet_builtin', 'sheet_empty_sub', 'sheet_import', 'sheet_no_dialog', 'sheet_failed']
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

describe('內建速查表(2026-10-08 使用者要求自帶 + 可手動匯入)', () => {
  it('沒匯入 → 內建(相對 renderer 根目錄);有匯入 → 使用者的', async () => {
    const { BUILTIN_CHEAT_SHEET, cheatSheetUrl } = await import('../src/web/overlay/float-menu-geom')
    expect(cheatSheetUrl(null, 'app://app/index.html')).toEqual({ url: 'app://app/cheatsheets/syndicate-3.29.webp', builtin: true })
    expect(cheatSheetUrl(null, 'http://127.0.0.1:9/t/abc/')).toEqual({ url: 'http://127.0.0.1:9/t/abc/cheatsheets/syndicate-3.29.webp', builtin: true })
    expect(cheatSheetUrl('app://sheet/x.png', 'app://app/')).toEqual({ url: 'app://sheet/x.png', builtin: false })
    // 檔案真的在 renderer/public(打包進 renderer/dist)
    expect(fs.existsSync(path.join(ROOT, 'renderer/public', BUILTIN_CHEAT_SHEET.file))).toBe(true)
    expect(read('NOTICE.md')).toContain(BUILTIN_CHEAT_SHEET.source)
  })
})

describe('速查表放大框可調整(2026-10-08 使用者要求)', () => {
  it('cheatSheetZoom 往返:舊檔 / 壞值 = null;合法值保留', () => {
    expect(_roundTripForTest(null).config.cheatSheetZoom).toBeNull()
    expect(_roundTripForTest('{"cheatSheetZoom":{"x":-5}}').config.cheatSheetZoom).toBeNull()
    const r = _roundTripForTest('{"cheatSheetZoom":{"x":400,"y":30,"w":1200,"h":500}}')
    expect(r.config.cheatSheetZoom).toEqual({ x: 400, y: 30, w: 1200, h: 500 })
    expect(JSON.parse(r.serialized).cheatSheetZoom).toEqual({ x: 400, y: 30, w: 1200, h: 500 })
  })
  it('只在釘住時有把手 / 可移動;放開才寫設定;有存才顯示還原', () => {
    const m = read('renderer/src/web/overlay/FloatMenu.vue')
    expect(m).toContain('<template v-if="pinned">')
    expect(m).toContain('@pointerdown="beginZoomDrag($event, e)"')
    expect(m).toContain('if (!pinned.value || e.button !== 0 || zoomDrag.active) return')
    expect(m).toMatch(/createRectDrag\(\(r\) => \{\s*config\.cheatSheetZoom = r/)
    expect(m).toContain('v-if="pinned && config.cheatSheetZoom"')
    expect(m).toContain('clampSettingsRect(config.cheatSheetZoom, view)')
  })
})

describe('2026-10-14:前往正則與開關列(T6 / T7 / T8)', () => {
  it('開關依遊戲:PoE1 = 倉庫價格 / 格子名稱,PoE2 = 褻瀆 / 符文塑形', () => {
    // 鍵接錯 → 選單開關改到別的設定
    expect(FLOAT_MENU_TOGGLES.poe1.map(x => x.key)).toEqual(['stashPricesEnabled', 'stashReadQuantity', 'stashShowNames'])
    expect(FLOAT_MENU_TOGGLES.poe2.map(x => x.key)).toEqual(['revealAutoEnabled', 'runeshapeEnabled'])
  })
  it('會影響 main 掃描的開關立即送 main(不等 300 ms 去抖);格子名稱只在 renderer 用', () => {
    for (const k of ['stashPricesEnabled', 'revealAutoEnabled', 'runeshapeEnabled'] as const) expect(HOST_CONFIG_IMMEDIATE_KEYS).toContain(k)
    expect(Object.keys(hostConfigOf(_roundTripForTest(null).config))).not.toContain('stashShowNames')
  })
  it('App.vue:選單 open-tab → openSettingsTo(tab, 懸浮選單)', () => {
    const app = read('renderer/src/web/App.vue')
    expect(app).toContain('@pasted="onMenuPasted" @open-tab="menuOpenTab"')
    expect(app).toMatch(/menuOpenTab \(tab: SettingsTabId\) \{ openSettingsTo\(tab, '懸浮選單'\) \}/)
  })
  it('選單寬高有上限(大字級不超出畫面)', () => {
    const m = read('renderer/src/web/overlay/FloatMenu.vue')
    // 字級 40 時 21em ≈ 840px,沒上限 → 小螢幕超出
    expect(m).toMatch(/\.fm \{[^}]*max-width: min\(\d+(\.\d+)?em, calc\(100vw - [^)]+\)\)/)
    expect(m).toMatch(/\.fm \{[^}]*max-height: calc\(100vh - [^;]+;/)
  })
  it('字串兩語', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz.menu
      for (const k of ['goto_regex', 'grp_scan', 'tg_stash', 'tg_names', 'tg_reveal', 'tg_rune', 'on', 'off']) {
        expect(typeof j[k], `${lang} ${k}`).toBe('string')
        expect(j[k], k).not.toMatch(/[|@$]/)
      }
    }
  })
})

describe('2026-10-15 A 版(指令面板)接線守門', () => {
  const m = read('renderer/src/web/overlay/FloatMenu.vue')
  it('市況只讀既有快照:不呼叫 queuePricesFetch、不強制重抓;重用 PriceSparkline / currencyIcon', () => {
    // 呼叫了 → 開選單就上網抓 poe.ninja,第 30.8 步閒置降耗失效
    expect(m).not.toContain('queuePricesFetch')
    expect(m).not.toMatch(/\.load\(/)
    expect(m).toContain('marketRateOf(ninja.snapshot.value')
    expect(m).toContain("import PriceSparkline from '@/web/ui/PriceSparkline.vue'")
    expect(m).toContain('currencyIcon(config.game')
  })
  it('限流點不嵌 RateLimiterState(彈出框往上會出畫面);429 倒數與 App.vue 共用同一份', () => {
    expect(m).not.toMatch(/import [^\n]*RateLimiterState|<rate-limiter-state|<RateLimiterState/)
    expect(m).toContain('useRateLimitWait()')
    const app = read('renderer/src/web/App.vue')
    expect(app).toContain('const rateLimitWait = useRateLimitWait()')
    // App.vue 不再自己倒數(否則兩份計時器)
    expect(app).not.toContain('watch(Host.rateLimitWait')
  })
  it('限流點兩代都讀交易站限流規則(PoE2 經 @poe2-entry 匯出)', () => {
    expect(m).toContain("import { poe2TradeSession } from '@poe2-entry'")
    expect(m).toMatch(/config\.game === 'poe2' \? poe2TradeSession\(config\.realm\)\.limits : poe1TradeSession\(config\.realm\)\.limits/)
    expect(read('poe2/src/renderer-entry.ts')).toContain('tradeSession as poe2TradeSession')
  })
  it('拆粉排行 → open-tab dust;搜尋框 onMounted 聚焦', () => {
    expect(m).toContain("emit('open-tab', 'dust')")
    expect(m).toMatch(/onMounted\([\s\S]*searchEl\.value\?\.focus\(\)/)
  })
  it('新字串兩語都有', () => {
    const keys = ['search', 'search_placeholder', 'chips', 'chip_all', 'chip_bookmark', 'chip_scan', 'chip_tool', 'grp_market', 'grp_scan', 'grp_tools',
      'market_sub', 'market_none', 'market_none_sub', 'market_none_tw', 'cur_divine', 'cur_chaos', 'cur_exa', 'stash_title', 'stash_pending', 'stash_poe2',
      'dust', 'bm_game', 'league', 'league_none', 'rate', 'rate_wait', 'no_match', 'foot_move', 'foot_run', 'foot_close']
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz.menu
      for (const k of keys) {
        expect(typeof j[k], `${lang} ${k}`).toBe('string')
        expect(j[k], k).not.toMatch(/[|@$]/)
      }
      // 已移除的鍵不留
      for (const k of ['pasted', 'toggles_poe1', 'toggles_poe2']) expect(k in j, `${lang} ${k}`).toBe(false)
    }
  })
  it('用到的 ppz.menu.* 鍵都存在(繁中)', () => {
    const zh = JSON.parse(read('renderer/src/i18n/cmn-Hant.json')).ppz.menu
    const src = m + read('renderer/src/web/overlay/float-menu-items.ts') + read('renderer/src/web/overlay/float-menu-geom.ts')
    const used = [...src.matchAll(/ppz\.menu\.([a-z0-9_]+)/g)].map(x => x[1])
    expect(used.length).toBeGreaterThan(20)
    for (const k of used) expect(typeof zh[k], k).toBe('string')
  })
})
