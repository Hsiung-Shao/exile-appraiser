import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

// 查價面板統一「機制」分段按鈕的字串(計畫 M14):兩語系都要有、非空;舊的工藝二選一字串移除
const ROOT = path.resolve(__dirname, '../..')
const load = (lang: string) => JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
const KEYS = ['group', 'normal', 'fractured', 'crafted', 'desecrated', 'rune', 'title_normal']

describe('機制字串', () => {
  for (const lang of ['cmn-Hant', 'en']) {
    for (const key of KEYS) {
      it(`${lang} 有非空的 ppz.mechanism.${key}`, () => {
        const v = load(lang).ppz?.mechanism?.[key]
        expect(typeof v).toBe('string')
        expect(String(v).trim().length).toBeGreaterThan(0)
      })
    }
  }

  it('繁中五個機制名稱都含中文且互不相同', () => {
    const m = load('cmn-Hant').ppz?.mechanism ?? {}
    const names = ['normal', 'fractured', 'crafted', 'desecrated', 'rune'].map(k => String(m[k]))
    for (const n of names) expect(n).toMatch(/[㐀-鿿]/)
    expect(new Set(names).size).toBe(5)
  })

  it('兩語系都移除舊的 ppz.crafted_toggle', () => {
    for (const lang of ['cmn-Hant', 'en']) expect(load(lang).ppz?.crafted_toggle).toBeUndefined()
  })
})
