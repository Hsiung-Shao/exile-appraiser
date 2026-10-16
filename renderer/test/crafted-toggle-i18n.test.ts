import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

// 查價面板「一般 / 工藝」二選一的字串:兩語系五個鍵都要有、非空
const ROOT = path.resolve(__dirname, '../..')
const load = (lang: string) => JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))
const KEYS = ['group', 'normal', 'label', 'title_normal', 'title_on']

describe('一般 / 工藝二選一字串', () => {
  for (const lang of ['cmn-Hant', 'en']) {
    for (const key of KEYS) {
      it(`${lang} 有非空的 ppz.crafted_toggle.${key}`, () => {
        const v = load(lang).ppz?.crafted_toggle?.[key]
        expect(typeof v).toBe('string')
        expect(String(v).trim().length).toBeGreaterThan(0)
      })
    }
  }

  it('繁中「工藝」選項文字含中文', () => {
    expect(String(load('cmn-Hant').ppz?.crafted_toggle?.label)).toMatch(/[㐀-鿿]/)
  })
})
