import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

// 查價面板「排除工藝詞綴」按鈕文字與說明:兩語系都要有、非空
const ROOT = path.resolve(__dirname, '../..')
const load = (lang: string) => JSON.parse(fs.readFileSync(path.join(ROOT, `renderer/src/i18n/${lang}.json`), 'utf8'))

describe('排除工藝詞綴字串', () => {
  for (const lang of ['cmn-Hant', 'en']) {
    for (const key of ['exclude', 'title']) {
      it(`${lang} 有非空的 ppz.crafted_filter.${key}`, () => {
        const v = load(lang).ppz?.crafted_filter?.[key]
        expect(typeof v).toBe('string')
        expect((v as string).trim().length).toBeGreaterThan(0)
      })
    }
  }

  it('繁中按鈕文字含中文、英文按鈕文字不含中文', () => {
    const zh = load('cmn-Hant').ppz?.crafted_filter?.exclude
    const en = load('en').ppz?.crafted_filter?.exclude
    expect(String(zh)).toMatch(/[㐀-鿿]/)
    expect(typeof en).toBe('string')
    expect(String(en)).not.toMatch(/[㐀-鿿]/)
  })
})
