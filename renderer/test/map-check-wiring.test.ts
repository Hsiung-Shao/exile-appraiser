// 地圖詞綴檢查(PoE1,移植 APT map-check):設定讀寫、熱鍵總表 / 衝突、設定分頁、overlay 閒置回報、App.vue 接線。純函式 / 讀原始碼,不送輸入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import { MAP_CHECK_DEFAULT_STATS } from '../src/web/map-check-config'
import { OPTIONAL_HOTKEY_FIELDS, hotkeyTable } from '../src/web/settings/hotkey-table'
import { hotkeySlots, type HotkeyConfigLike } from '../src/web/settings/hotkey-conflicts'
import { isTabVisible, resolveSettingsTab, SETTINGS_TABS } from '../src/web/settings/settings-tabs'
import { overlayContentKey, overlayContentOf } from '../src/web/overlay/overlay-content'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('設定讀寫(T6)', () => {
  it('全新與舊設定檔 → 熱鍵空、設定檔 I、APT 預設四條(以 ref 為鍵)', () => {
    for (const raw of [null, '{"game":"poe1"}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect((config as any).hotkeyMapCheck).toBe('')
      expect((config as any).mapCheck).toEqual({ profile: 1, showNewStats: false, selectedStats: MAP_CHECK_DEFAULT_STATS })
      expect(JSON.parse(serialized).mapCheck.selectedStats).toEqual(MAP_CHECK_DEFAULT_STATS)
    }
    expect(MAP_CHECK_DEFAULT_STATS).toEqual([
      { ref: 'Players have #% to all maximum Resistances', decision: 'w--' },
      { ref: 'Monsters reflect #% of Physical Damage', decision: 'd--' },
      { ref: 'Monsters reflect #% of Elemental Damage', decision: 'd--' },
      { ref: 'Area contains two Unique Bosses', decision: 'g--' }
    ])
  })

  it('壞的標記丟掉、其他保留;設定檔超出 1–3 回 1', () => {
    const { config, serialized } = _roundTripForTest(JSON.stringify({
      hotkeyMapCheck: 'Alt + D',
      mapCheck: { profile: 7, showNewStats: true, selectedStats: [{ ref: 'A', decision: 'd-s' }, { ref: 'B', decision: 'xx' }, { matcher: 'C', decision: 'd--' }, null, { ref: 'A', decision: 'g--' }] }
    }))
    expect((config as any).hotkeyMapCheck).toBe('Alt + D')
    expect((config as any).mapCheck).toEqual({ profile: 1, showNewStats: true, selectedStats: [{ ref: 'A', decision: 'd-s' }] })
    expect(_roundTripForTest(serialized).config).toMatchObject({ mapCheck: { selectedStats: [{ ref: 'A', decision: 'd-s' }] } })
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

  it('設定分頁「地圖詞綴」在工具組、只在 PoE1 顯示', () => {
    expect(SETTINGS_TABS.find(t => t.id === 'map-check')).toMatchObject({ group: 'tools' })
    expect(isTabVisible('map-check', 'poe1')).toBe(true)
    expect(isTabVisible('map-check', 'poe2')).toBe(false)
    expect(resolveSettingsTab('map-check', 'poe2')).toBe('game')
  })

  it('字串兩語都有', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const j = JSON.parse(read(`renderer/src/i18n/${lang}.json`))
      for (const k of ['tab_map_check', 'hk.map_check', 'map_check.tag_heist', 'map_check.tag_uber', 'map_check.tag_outdated', 'map_check.lead']) {
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
