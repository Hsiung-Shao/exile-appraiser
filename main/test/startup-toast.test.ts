// 啟動時「已在背景執行」提示的純邏輯(main/src/startup-toast.ts):是否顯示、更新後首次、訊息組字、HTML、位置。
import { describe, expect, it } from 'vitest'
import {
  TOAST_MARGIN, TOAST_SIZE, compareVersions, escapeHtml, isFirstRunAfterUpdate, parseLastRun, priceCheckHotkeyLabel,
  serializeLastRun, shouldShowStartupToast, toastBounds, toastHtml, toastLang, toastMessage, type ToastStartupEnv
} from '../src/startup-toast'

const base: ToastStartupEnv = { enabled: true, controlRequest: false, selftest: false, preview: false, secondInstance: false, alreadyShown: false }

describe('shouldShowStartupToast', () => {
  it('一般啟動:設定開或舊設定檔沒有這欄 → 顯示', () => {
    expect(shouldShowStartupToast(base)).toBe(true)
    expect(shouldShowStartupToast({ ...base, enabled: undefined })).toBe(true)
  })
  it('設定關 → 不顯示', () => {
    expect(shouldShowStartupToast({ ...base, enabled: false })).toBe(false)
  })
  it('控制參數 / 自我測試 / 預覽 / 第二實例 / 已顯示過 → 不顯示', () => {
    for (const k of ['controlRequest', 'selftest', 'preview', 'secondInstance', 'alreadyShown'] as const) {
      expect(shouldShowStartupToast({ ...base, [k]: true }), k).toBe(false)
    }
  })
})

describe('更新後第一次啟動', () => {
  it('compareVersions', () => {
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1)
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('garbage', '1.0.0')).toBeNull()
  })
  it('上次版本比目前舊才算', () => {
    expect(isFirstRunAfterUpdate('0.1.0', '0.1.1')).toBe(true)
    expect(isFirstRunAfterUpdate('0.1.1', '0.1.1')).toBe(false)
    expect(isFirstRunAfterUpdate('0.2.0', '0.1.1')).toBe(false) // 降版
    expect(isFirstRunAfterUpdate(null, '0.1.0')).toBe(false) // 第一次安裝
    expect(isFirstRunAfterUpdate('', '0.1.0')).toBe(false)
    expect(isFirstRunAfterUpdate('x', '0.1.0')).toBe(false)
  })
  it('last_run.json 往返與損毀', () => {
    expect(parseLastRun(serializeLastRun('0.1.0'))).toBe('0.1.0')
    expect(parseLastRun(null)).toBeNull()
    expect(parseLastRun('{')).toBeNull()
    expect(parseLastRun('null')).toBeNull()
    expect(parseLastRun('{"lastRunVersion":3}')).toBeNull()
  })
})

describe('訊息組字', () => {
  it('查價熱鍵 = 按住鍵 + 主鍵(同註冊的組合)', () => {
    expect(priceCheckHotkeyLabel('Ctrl', 'D')).toBe('Ctrl + D')
    expect(priceCheckHotkeyLabel('alt', 'd')).toBe('Alt + D')
    expect(priceCheckHotkeyLabel('', 'F5')).toBe('F5')
    expect(priceCheckHotkeyLabel('Ctrl', '')).toBeNull()
    expect(priceCheckHotkeyLabel(undefined, undefined)).toBeNull()
  })
  it('介面語言:只有 en 是英文,其餘繁中', () => {
    expect(toastLang('en')).toBe('en')
    expect(toastLang('cmn-Hant')).toBe('cmn-Hant')
    expect(toastLang(undefined)).toBe('cmn-Hant')
  })
  it('繁中:一般 / 更新後 / 沒有熱鍵', () => {
    expect(toastMessage({ lang: 'cmn-Hant', version: '0.1.0', hotkey: 'Ctrl + D', updated: false }))
      .toEqual({ lang: 'cmn-Hant', title: '流亡鑑價 v0.1.0 已在背景執行', hint: '在遊戲中按 Ctrl + D 查價 · 系統匣圖示開啟設定' })
    expect(toastMessage({ lang: 'cmn-Hant', version: '0.1.1', hotkey: 'Ctrl + D', updated: true }).title)
      .toBe('已更新至 v0.1.1,在背景執行中')
    expect(toastMessage({ lang: 'cmn-Hant', version: '0.1.0', hotkey: null, updated: false }).hint).toBe('系統匣圖示開啟設定')
  })
  it('英文:一般 / 更新後', () => {
    const m = toastMessage({ lang: 'en', version: '0.1.0', hotkey: 'Alt + D', updated: false })
    expect(m.title).toBe('ExileAppraiser v0.1.0 is running in the background')
    expect(m.hint).toBe('Press Alt + D in game to price check · Tray icon for settings')
    expect(toastMessage({ lang: 'en', version: '0.1.1', hotkey: null, updated: true }).title).toBe('Updated to v0.1.1, running in the background')
  })
})

describe('toastHtml', () => {
  const msg = toastMessage({ lang: 'cmn-Hant', version: '0.1.0', hotkey: 'Ctrl + D', updated: false })
  it('內容跳脫、CSP 無腳本、深色 token', () => {
    const html = toastHtml({ ...msg, hint: '<script>x</script>&' }, null)
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;&amp;')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('#192029')
    expect(html).toContain('lang="zh-Hant"')
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;')
  })
  it('圖示只收 png data URL', () => {
    expect(toastHtml(msg, 'data:image/png;base64,AAAA')).toContain('<img class="icon" src="data:image/png;base64,AAAA"')
    expect(toastHtml(msg, 'https://evil.example/x.png')).not.toContain('<img')
    expect(toastHtml(msg, 'data:image/png;base64,AA" onerror="x')).not.toContain('<img')
  })
  it('animate:false 不帶動畫', () => {
    expect(toastHtml(msg, null)).toContain('animation:')
    expect(toastHtml(msg, null, { animate: false })).not.toContain('animation:')
  })
})

describe('toastBounds', () => {
  it('主螢幕工作區右下角、留邊距', () => {
    const b = toastBounds({ x: 0, y: 0, width: 1920, height: 1040 })
    expect(b).toEqual({ x: 1920 - TOAST_SIZE.width - TOAST_MARGIN, y: 1040 - TOAST_SIZE.height - TOAST_MARGIN, width: TOAST_SIZE.width, height: TOAST_SIZE.height })
    const off = toastBounds({ x: -1920, y: 40, width: 1920, height: 1000 })
    expect(off.x).toBe(-TOAST_SIZE.width - TOAST_MARGIN)
    expect(off.y).toBe(40 + 1000 - TOAST_SIZE.height - TOAST_MARGIN)
  })
})
