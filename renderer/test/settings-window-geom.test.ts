// 第 21 步:設定視窗大小 / 位置與獨立字級(`src/web/settings/settings-window-geom.ts` + Config.ts 兩個欄位)
import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { _roundTripForTest } from '../src/web/Config'
import {
  SETTINGS_FS_MAX, SETTINGS_FS_MIN, SETTINGS_MIN_H, SETTINGS_MIN_W,
  clampSettingsRect, createBackdropGuard, createRectDrag, dragRect, edgeCursor, effectiveSettingsFs, isInteractiveTarget,
  normSettingsFontSize, normSettingsWindow, settingsFsClass, settingsFsShortcut, settingsFsVars, settingsFsWheel, stepSettingsFs,
  type SettingsWindowRect
} from '../src/web/settings/settings-window-geom'

describe('Config:settingsWindow / settingsFontSize 往返與舊檔相容', () => {
  it('全新 / 舊設定檔沒有這兩鍵 → null(= 現行置中預設、跟隨全域),且寫進檔', () => {
    for (const raw of [null, '{"game":"poe1"}', '{"game":"poe2","fsBase":15,"stashScroll":false}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.settingsWindow).toBeNull()
      expect(config.settingsFontSize).toBeNull()
      const j = JSON.parse(serialized)
      expect(j).toHaveProperty('settingsWindow', null)
      expect(j).toHaveProperty('settingsFontSize', null)
    }
  })
  it('合法值原樣保留(取整數)', () => {
    const { config, serialized } = _roundTripForTest('{"settingsWindow":{"w":900.4,"h":700,"x":-20,"y":35.6},"settingsFontSize":20}')
    expect(config.settingsWindow).toEqual({ w: 900, h: 700, x: -20, y: 36 })
    expect(config.settingsFontSize).toBe(20)
    expect(JSON.parse(serialized).settingsWindow).toEqual({ w: 900, h: 700, x: -20, y: 36 })
    expect(JSON.parse(serialized).settingsFontSize).toBe(20)
  })
  it('壞值 → null;太小拉到最小值;字級夾在 11–24', () => {
    for (const bad of ['"x"', '[]', '1', '{"w":800,"h":600,"x":10}', '{"w":"800","h":600,"x":0,"y":0}', '{"w":0,"h":600,"x":0,"y":0}',
      '{"w":800,"h":-5,"x":0,"y":0}', '{"w":800,"h":600,"x":1e9,"y":0}', 'null']) {
      expect(_roundTripForTest(`{"settingsWindow":${bad}}`).config.settingsWindow).toBeNull()
    }
    expect(_roundTripForTest('{"settingsWindow":{"w":100,"h":50,"x":0,"y":0}}').config.settingsWindow).toEqual({ w: SETTINGS_MIN_W, h: SETTINGS_MIN_H, x: 0, y: 0 })
    expect(_roundTripForTest('{"settingsFontSize":5}').config.settingsFontSize).toBe(SETTINGS_FS_MIN)
    expect(_roundTripForTest('{"settingsFontSize":99}').config.settingsFontSize).toBe(SETTINGS_FS_MAX)
    expect(_roundTripForTest('{"settingsFontSize":15.6}').config.settingsFontSize).toBe(16)
    for (const bad of ['"20"', 'null', 'true', '{}']) expect(_roundTripForTest(`{"settingsFontSize":${bad}}`).config.settingsFontSize).toBeNull()
  })
  it('norm 函式直接呼叫', () => {
    expect(normSettingsWindow(undefined)).toBeNull()
    expect(normSettingsWindow({ w: Number.NaN, h: 1, x: 0, y: 0 })).toBeNull()
    expect(normSettingsFontSize(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('clampSettingsRect:夾進 overlay 可視範圍', () => {
  const r = (w: number, h: number, x: number, y: number): SettingsWindowRect => ({ w, h, x, y })
  it('在範圍內不變', () => {
    expect(clampSettingsRect(r(800, 600, 100, 50), { w: 1920, h: 1080 })).toEqual(r(800, 600, 100, 50))
  })
  it('負座標推回 0', () => {
    expect(clampSettingsRect(r(800, 600, -300, -40), { w: 1920, h: 1080 })).toEqual(r(800, 600, 0, 0))
  })
  it('超出右 / 下邊推回(大小不變)', () => {
    expect(clampSettingsRect(r(800, 600, 1500, 900), { w: 1920, h: 1080 })).toEqual(r(800, 600, 1120, 480))
  })
  it('換成較小解析度:大小縮到 overlay 大小、位置推回', () => {
    expect(clampSettingsRect(r(1800, 1000, 100, 60), { w: 1280, h: 720 })).toEqual(r(1280, 720, 0, 0))
    // 切 DPI 150%:1920×1080 實體 → 1280×720 CSS
    expect(clampSettingsRect(r(1000, 700, 900, 300), { w: 1280, h: 720 })).toEqual(r(1000, 700, 280, 20))
  })
  it('比最小值小的 overlay:填滿 overlay', () => {
    expect(clampSettingsRect(r(800, 600, 10, 10), { w: 400, h: 300 })).toEqual(r(400, 300, 0, 0))
    expect(clampSettingsRect(r(100, 100, 0, 0), { w: 400, h: 1000 })).toEqual(r(400, SETTINGS_MIN_H, 0, 0))
  })
  it('小於最小值的矩形拉到最小值', () => {
    expect(clampSettingsRect(r(100, 100, 50, 50), { w: 1920, h: 1080 })).toEqual(r(SETTINGS_MIN_W, SETTINGS_MIN_H, 50, 50))
  })
  it('小數 / 0 大小的 overlay 不出 NaN', () => {
    const out = clampSettingsRect(r(800, 600, 10, 10), { w: 1366.6, h: 767.2 })
    expect(out).toEqual(r(800, 600, 10, 10))
    expect(clampSettingsRect(r(800, 600, 10, 10), { w: 0, h: 0 })).toEqual(r(0, 0, 0, 0))
  })
  it('結果一定在範圍內(隨機)', () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n) }
    for (let i = 0; i < 2000; i++) {
      const view = { w: 200 + rnd(3000), h: 200 + rnd(2000) }
      const out = clampSettingsRect(r(rnd(4000), rnd(3000), rnd(6000) - 3000, rnd(6000) - 3000), view)
      expect(out.x).toBeGreaterThanOrEqual(0)
      expect(out.y).toBeGreaterThanOrEqual(0)
      expect(out.x + out.w).toBeLessThanOrEqual(view.w)
      expect(out.y + out.h).toBeLessThanOrEqual(view.h)
      expect(out.w).toBeGreaterThanOrEqual(Math.min(SETTINGS_MIN_W, view.w))
      expect(out.h).toBeGreaterThanOrEqual(Math.min(SETTINGS_MIN_H, view.h))
    }
  })
})

describe('dragRect:四邊 / 四角 / 移動', () => {
  const view = { w: 1920, h: 1080 }
  const s: SettingsWindowRect = { w: 800, h: 600, x: 500, y: 200 }
  it('右下角拉大', () => {
    expect(dragRect(s, 'se', 150, 100, view)).toEqual({ w: 950, h: 700, x: 500, y: 200 })
  })
  it('左上角:右 / 下邊固定', () => {
    expect(dragRect(s, 'nw', -100, -50, view)).toEqual({ w: 900, h: 650, x: 400, y: 150 })
  })
  it('拉左邊縮到最小值後再拉,視窗不被推著走(右邊固定)', () => {
    expect(dragRect(s, 'w', 700, 0, view)).toEqual({ w: SETTINGS_MIN_W, h: 600, x: 500 + 800 - SETTINGS_MIN_W, y: 200 })
  })
  it('拉超出 overlay 邊界:停在邊界', () => {
    expect(dragRect(s, 'e', 5000, 0, view)).toEqual({ w: 1920 - 500, h: 600, x: 500, y: 200 })
    expect(dragRect(s, 'n', 0, -5000, view)).toEqual({ w: 800, h: 800, x: 500, y: 0 })
  })
  it('只改單一軸', () => {
    expect(dragRect(s, 's', 999, 40, view)).toEqual({ w: 800, h: 640, x: 500, y: 200 })
    expect(dragRect(s, 'e', 30, 999, view)).toEqual({ w: 830, h: 600, x: 500, y: 200 })
  })
  it('移動:夾在範圍內、大小不變', () => {
    expect(dragRect(s, 'move', -1000, 2000, view)).toEqual({ w: 800, h: 600, x: 0, y: 480 })
  })
  it('游標樣式', () => {
    expect([edgeCursor('n'), edgeCursor('e'), edgeCursor('ne'), edgeCursor('se'), edgeCursor('move')])
      .toEqual(['ns-resize', 'ew-resize', 'nesw-resize', 'nwse-resize', 'move'])
  })
})

describe('createRectDrag:拖曳結束才寫入', () => {
  const view = { w: 1920, h: 1080 }
  const start: SettingsWindowRect = { w: 800, h: 600, x: 500, y: 200 }
  it('move 只更新 live,不寫;end 寫一次', () => {
    const commit = vi.fn()
    const lives: Array<SettingsWindowRect | null> = []
    const d = createRectDrag(commit, (r) => lives.push(r))
    d.start('se', start, 1300, 800, view)
    expect(d.active).toBe(true)
    for (let i = 1; i <= 30; i++) d.move(1300 + i * 5, 800 + i * 3)
    expect(commit).not.toHaveBeenCalled()
    expect(d.live).toEqual({ w: 950, h: 690, x: 500, y: 200 })
    expect(d.end(1300 + 150, 800 + 90)).toEqual({ w: 950, h: 690, x: 500, y: 200 })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ w: 950, h: 690, x: 500, y: 200 })
    expect(d.active).toBe(false)
    expect(d.live).toBeNull()
    expect(lives.at(-1)).toBeNull()
  })
  it('沒動(只是點一下)不寫', () => {
    const commit = vi.fn()
    const d = createRectDrag(commit)
    d.start('move', start, 10, 10, view)
    expect(d.end(10, 10)).toBeNull()
    expect(commit).not.toHaveBeenCalled()
  })
  it('cancel 不寫;end 沒給座標用最後的 live', () => {
    const commit = vi.fn()
    const d = createRectDrag(commit)
    d.start('move', start, 0, 0, view)
    d.move(40, 20)
    d.cancel()
    expect(commit).not.toHaveBeenCalled()
    d.start('move', start, 0, 0, view)
    d.move(40, 20)
    d.end()
    expect(commit).toHaveBeenCalledWith({ w: 800, h: 600, x: 540, y: 220 })
  })
  it('沒開始就 move / end → 什麼都不做', () => {
    const commit = vi.fn()
    const d = createRectDrag(commit)
    expect(d.move(1, 1)).toBeNull()
    expect(d.end(1, 1)).toBeNull()
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('點暗幕關閉的誤關防護', () => {
  it('按下與 click 都在暗幕上 → 關', () => {
    const g = createBackdropGuard()
    g.down(true)
    expect(g.click(true)).toBe(true)
  })
  it('在視窗內按下(含拖曳移動 / 調整大小)、在暗幕上放開 → 不關', () => {
    const g = createBackdropGuard()
    g.down(false)
    expect(g.click(true)).toBe(false)
  })
  it('在暗幕按下、在視窗內放開 → 不關;旗標每次 click 後重設', () => {
    const g = createBackdropGuard()
    g.down(true)
    expect(g.click(false)).toBe(false)
    expect(g.click(true)).toBe(false) // 沒有新的按下
  })
  it('標題列按鈕 / 輸入元件上不開始移動', () => {
    const el = (hit: boolean) => ({ closest: (sel: string) => (hit && sel.includes('button') ? {} : null) })
    expect(isInteractiveTarget(el(true))).toBe(true)
    expect(isInteractiveTarget(el(false))).toBe(false)
    expect(isInteractiveTarget(null)).toBe(false)
    expect(isInteractiveTarget({})).toBe(false)
  })
})

describe('獨立字級', () => {
  it('跟隨全域 → 不輸出任何變數(= 改版前逐像素相同)', () => {
    expect(settingsFsVars(null, 13)).toBeNull()
    expect(effectiveSettingsFs(null, 15)).toBe(15)
  })
  it('變數組:--fs-* 全部重定義 + --app-fs-base = 全域字級', () => {
    expect(settingsFsVars(20, 13)).toEqual({
      '--fs-base': '20px', '--fs-2xs': '17px', '--fs-xs': '18px', '--fs-sm': '19px', '--fs-md': '20px',
      '--fs-lg': '22px', '--fs-xl': '27px', '--app-fs-base': '13px'
    })
    expect(settingsFsVars(99, 13)?.['--fs-base']).toBe('24px')
  })
  it('公式與 pobtools.css :root 的 --fs-* 一致(主題檔改了這裡要跟著改)', () => {
    const css = fs.readFileSync(new URL('../src/theme/pobtools.css', import.meta.url), 'utf8')
    const vars = settingsFsVars(17, 13)!
    for (const name of ['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl']) {
      const m = css.match(new RegExp(`${name}:\\s*([^;]+);`))
      expect(m, name).not.toBeNull()
      const expr = m![1].trim()
      const off = expr === 'var(--fs-base)' ? 0 : Number(/calc\(var\(--fs-base\) ([+-]) (\d+)px\)/.exec(expr)!.slice(1).join(''))
      expect(vars[name], name).toBe(`${17 + off}px`)
    }
    // 除了這六個,主題檔沒有其他由 --fs-base 推導的字級變數(有的話也要放進 settingsFsVars)
    const derived = [...css.matchAll(/(--[\w-]+):\s*[^;]*var\(--fs-base\)/g)].map(m => m[1])
    expect(new Set(derived)).toEqual(new Set(['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl']))
  })
  it('快速調整:從有效字級起算、夾在範圍、reset = 跟隨', () => {
    expect(stepSettingsFs(null, 13, 'inc')).toBe(14)
    expect(stepSettingsFs(null, 13, 'dec')).toBe(12)
    expect(stepSettingsFs(20, 13, 'inc')).toBe(21)
    expect(stepSettingsFs(SETTINGS_FS_MAX, 13, 'inc')).toBe(SETTINGS_FS_MAX)
    expect(stepSettingsFs(SETTINGS_FS_MIN, 13, 'dec')).toBe(SETTINGS_FS_MIN)
    expect(stepSettingsFs(20, 13, 'reset')).toBeNull()
  })
  it('鍵盤:Ctrl + = / + / − / 0(含數字鍵盤);其他組合不攔', () => {
    const k = (key: string, code: string, mods: Partial<{ ctrlKey: boolean, altKey: boolean, metaKey: boolean, shiftKey: boolean }> = {}) =>
      settingsFsShortcut({ key, code, ctrlKey: true, altKey: false, metaKey: false, shiftKey: false, ...mods })
    expect(k('=', 'Equal')).toBe('inc')
    expect(k('+', 'Equal', { shiftKey: true })).toBe('inc')
    expect(k('+', 'NumpadAdd')).toBe('inc')
    expect(k('-', 'Minus')).toBe('dec')
    expect(k('-', 'NumpadSubtract')).toBe('dec')
    expect(k('0', 'Digit0')).toBe('reset')
    expect(k('0', 'Numpad0')).toBe('reset')
    expect(k(')', 'Digit0', { shiftKey: true })).toBeNull()
    expect(k('=', 'Equal', { ctrlKey: false })).toBeNull()
    expect(k('=', 'Equal', { altKey: true })).toBeNull()
    expect(k('-', 'Minus', { metaKey: true })).toBeNull()
    expect(k('c', 'KeyC')).toBeNull()
    expect(k('w', 'KeyW')).toBeNull()
  })
  it('滾輪:Ctrl + 往上 = 放大;沒按 Ctrl 不攔', () => {
    const w = (deltaY: number, ctrlKey = true) => settingsFsWheel({ deltaY, ctrlKey, altKey: false, metaKey: false })
    expect(w(-100)).toBe('inc')
    expect(w(100)).toBe('dec')
    expect(w(0)).toBeNull()
    expect(w(-100, false)).toBeNull()
  })
})

describe('code review 第 C 批:Teleport 到 body 的 Regex 對話框 / 提示框也套 fs-own 補高規則', () => {
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
  it('settingsFsClass:有獨立字級變數 → fs-own;跟隨全域(null)→ 不加 class(= 與改版前相同)', () => {
        expect(settingsFsClass({ '--fs-base': '20px' })).toBe('fs-own')
    expect(settingsFsClass(null)).toBeUndefined()
    expect(settingsFsClass(undefined)).toBeUndefined()
  })
  it('SettingsWindow.vue 的控制項補高規則以 :is(.settings-window, .rx-modal, .rx-tip).fs-own 為範圍,且不留只限 .settings-window 的舊規則', () => {
    const src = read('../src/web/settings/SettingsWindow.vue')
    const scope = ':is(.settings-window, .rx-modal, .rx-tip).fs-own'
    expect(src).toContain(`${scope} :is(.btn, .input:not(textarea), .select) { height: max(26px, calc(var(--fs-base) + 13px)); }`)
    expect(src).toContain(`${scope} .btn.sm { height: max(22px, calc(var(--fs-base) + 9px)); }`)
    expect(src).toContain(`${scope} :is(.input.sm:not(textarea), .select.sm), ${scope} .seg button { height: max(24px, calc(var(--fs-base) + 11px)); }`)
    expect(src).not.toMatch(/^\.settings-window\.fs-own :is\(\.btn/m)
    expect(src).toMatch(/cls: computed\(\(\) => settingsFsClass\(fsVars\.value\)\)/)
  })
  it('Regex 的每個 Teleport 對話框 / 提示框都綁 fs-own class(與字級變數同一處)', () => {
    let n = 0
    for (const f of ['RegexPanel.vue', 'RegexBookmarks.vue', 'RegexList.vue']) {
      const src = read(`../src/web/regex/${f}`)
      const tags = src.split('\n').filter(l => /<div .*class="[^"]*\b(rx-modal|rx-tip)\b/.test(l))
      expect(tags.length, f).toBeGreaterThan(0)
      for (const t of tags) { expect(t).toContain(':class="fsClass"'); expect(t).toContain('fsStyle'); n++ }
      expect(src).toMatch(/fsClass: settingsFs\.cls/)
    }
    expect(n).toBe(5)
  })
})
