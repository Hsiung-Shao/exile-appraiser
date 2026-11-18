// 設定 › 一般「建立桌面捷徑」:按鈕接線與兩語字串
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const KEYS = ['label', 'button', 'done', 'failed', 'dev', 'hint'] as const

describe('S10 設定頁桌面捷徑', () => {
  it('Startup.vue(啟動與更新)有帶 data-action 的按鈕', () => {
    expect(read('../src/web/settings/tabs/Startup.vue')).toContain('data-action="desktop-shortcut-create"')
  })
  for (const lang of ['cmn-Hant', 'en'] as const) {
    it(`${lang}:六個字串鍵都存在且非空`, () => {
      const ds = JSON.parse(read(`../src/i18n/${lang}.json`)).ppz?.desktop_shortcut ?? {}
      for (const k of KEYS) {
        expect(typeof ds[k], `${lang} ppz.desktop_shortcut.${k}`).toBe('string')
        expect(ds[k].trim().length, `${lang} ppz.desktop_shortcut.${k}`).toBeGreaterThan(0)
      }
    })
  }
  it('hint 提到釘選到工作列(繁中)/ taskbar(英文)', () => {
    const hint = (lang: string): string => JSON.parse(read(`../src/i18n/${lang}.json`)).ppz?.desktop_shortcut?.hint ?? ''
    expect(hint('cmn-Hant')).toContain('釘選到工作列')
    expect(hint('en').toLowerCase()).toContain('taskbar')
  })
})
