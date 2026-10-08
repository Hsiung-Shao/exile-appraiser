/**
 * 就地回報(2026-10-08):報告 error 行、字串兩語、移植檔接線守門(只切耦合點、都有 exile-appraiser 註解)、
 * App.vue provide、PoE2 wrong_language 不再原字串外露。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inlineReportError } from '../src/web/report-inline'

const ROOT = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('inlineReportError', () => {
  it('詞綴 / 查價錯誤帶細節,整件物品不帶', () => {
    expect(inlineReportError('mod', ' 增加 22% 某效果 ')).toBe('未解析詞綴 / Unrecognized modifier: 增加 22% 某效果')
    expect(inlineReportError('trade', 'Query is too complex.')).toBe('查價失敗 / Trade query failed: Query is too complex.')
    expect(inlineReportError('item')).toBeUndefined()
  })
})

describe('字串兩語', () => {
  for (const lang of ['cmn-Hant', 'en']) {
    it(lang, () => {
      const j = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz
      for (const k of ['problem', 'this_mod', 'unknown_summary', 'unknown_sub', 'parse']) {
        expect(typeof j.report[k], k).toBe('string')
        expect(j.report[k]).not.toMatch(/[|@$]/)
      }
      expect(j.report.unknown_summary).toContain('{n}')
      expect(j.wrong_language).toContain('{found}')
      expect(j.wrong_language).toContain('{configured}')
    })
  }
})

describe('接線守門', () => {
  const ported = [
    ['poe1/src/web/price-check/filters/UnknownModifier.vue', 'mode="mod"'],
    ['poe2/src/web/price-check/filters/UnknownModifier.vue', 'mode="mod"'],
    ['poe1/src/web/price-check/filters/FiltersBlock.vue', 'mode="summary"'],
    ['poe2/src/web/price-check/filters/FiltersBlock.vue', 'mode="summary"'],
    ['poe1/src/web/price-check/trade/TradeListing.vue', 'mode="trade"'],
    ['poe1/src/web/price-check/trade/TradeBulk.vue', 'mode="trade"'],
    ['poe2/src/web/price-check/trade/TradeListing.vue', 'mode="trade"'],
    ['poe2/src/web/price-check/trade/TradeBulk.vue', 'mode="trade"']
  ]
  for (const [file, mark] of ported) {
    it(file, () => {
      const s = read(file)
      expect(s).toContain(mark)
      expect(s).toMatch(/import ReportInline from ['"]@\/web\/ui\/ReportInline\.vue['"]/)
      expect(s).toMatch(/exile-appraiser: 就地回報/)
    })
  }

  it('ReportInline 沒有注入就不畫', () => {
    const s = read('renderer/src/web/ui/ReportInline.vue')
    expect(s).toContain('inject(REPORT_INLINE_KEY, null)')
    expect(s).toContain('<template v-if="reporter">')
  })

  it('App.vue provide 並沿用同一件物品的報告內容', () => {
    const s = read('renderer/src/web/App.vue')
    expect(s).toMatch(/provide\(REPORT_INLINE_KEY,/)
    expect(s).toContain('reportIssue({ ...itemReportContext(), error: inlineReportError(kind, detail) })')
  })

  it('wrong_language 以 | 切開翻譯', () => {
    const s = read('renderer/src/web/App.vue')
    expect(s).toContain("error.startsWith('item.wrong_language|')")
    expect(s).toContain("t('ppz.wrong_language'")
  })
})

describe('未解析詞綴列不貼邊(2026-10-08)', () => {
  it('兩代 UnknownModifier 根元素帶 ppz-unknown-mod,樣式有左右留白', () => {
    for (const f of ['poe1/src/web/price-check/filters/UnknownModifier.vue', 'poe2/src/web/price-check/filters/UnknownModifier.vue']) {
      expect(read(f)).toMatch(/<template>\r?\n {2}<div class="[^"]*ppz-unknown-mod">/)
    }
    const s = read('renderer/src/web/ui/ReportInline.vue')
    expect(s).toMatch(/\.ppz-unknown-mod \{\s*padding-left: 0\.6em;\s*padding-right: 0\.6em;/)
  })
})
