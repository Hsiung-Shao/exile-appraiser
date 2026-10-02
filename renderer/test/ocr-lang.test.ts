// exile-appraiser(2026-10-02 第 22 步):英文客戶端 OCR 的 renderer 端 —— 設定頁語言包提示、徽章上顯示的原文。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { displayOcrText, ocrWantsEnglish } from '../src/web/ocr-lang'

const I18N = path.resolve(__dirname, '../src/i18n')
const ocrStrings = (lang: string) => (JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8')) as { ppz: { ocr: Record<string, string> } }).ppz.ocr

describe('設定頁:缺的是哪個語言包', () => {
  it('main 回報想用的語言包優先(en-US → 英文提示;zh-Hant-TW → 繁中提示)', () => {
    expect(ocrWantsEnglish({ ok: false, error: 'lang-missing', lang: 'en-US', langs: ['zh-Hant-TW'] }, 'cmn-Hant')).toBe(true)
    expect(ocrWantsEnglish({ ok: false, error: 'lang-missing', lang: 'zh-Hant-TW', langs: ['en-US'] }, 'en')).toBe(false)
  })
  it('舊 main 沒回報 / 還沒檢查 → 依目前的客戶端語言', () => {
    expect(ocrWantsEnglish({ ok: false, error: 'lang-missing', langs: [] }, 'en')).toBe(true)
    expect(ocrWantsEnglish(null, 'en')).toBe(true)
    expect(ocrWantsEnglish(undefined, 'cmn-Hant')).toBe(false)
    expect(ocrWantsEnglish({ ok: true, lang: 'en-US', langs: ['en-US'] }, 'cmn-Hant')).toBe(false)
  })
  it('兩種介面語言都有英文語言包的狀態與安裝說明', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const s = ocrStrings(lang)
      expect(s.status_missing_en, lang).toContain('{langs}')
      expect(s.err_lang_missing_en, lang).toMatch(/en|英文/i)
      expect(s.status_missing, lang).toBeTruthy()
      expect(s.err_lang_missing, lang).toBeTruthy()
    }
  })
})

describe('displayOcrText:徽章上的 OCR 原文', () => {
  it('繁中:刪掉字間空白(與改版前相同)', () => {
    expect(displayOcrText('增 加 25 % 護 甲 值')).toBe('增加25%護甲值')
    expect(displayOcrText('1x 遠 古 控 制 符 文')).toBe('1x遠古控制符文')
  })
  it('英文:空白縮成一個、保留字界', () => {
    expect(displayOcrText('UNIQUE  RING ')).toBe('UNIQUE RING')
    expect(displayOcrText('lx Thrud\'s Might')).toBe('lx Thrud\'s Might')
  })
})
