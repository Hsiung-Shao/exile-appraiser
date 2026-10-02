// exile-appraiser(2026-10-02 第 22 步):英文客戶端 OCR 的 renderer 端 —— 設定頁語言包提示、徽章上顯示的原文。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HostConfigForMain } from '@ipc/types'
import { effectiveOcrLang as mainEffective } from '../../main/src/ocr/ocr-lang'
import { HOST_CONFIG_IMMEDIATE_KEYS, _roundTripForTest, hostConfigOf, normOcrLang } from '../src/web/Config'
import { createHostConfigSync } from '../src/web/host-config-sync'
import { displayOcrText, effectiveOcrLang, ocrTextLangOf, ocrWantsEnglish } from '../src/web/ocr-lang'

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

// ---- 第 25 步:OCR 辨識語言獨立設定 `ocrLang` ----
describe('有效辨識語言(effectiveOcrLang;與 main/src/ocr/ocr-lang.ts 同規則)', () => {
  it('follow × 客戶端語言;手動指定優先;缺 / 壞值 = follow', () => {
    expect(effectiveOcrLang('follow', 'cmn-Hant')).toBe('cmn-Hant')
    expect(effectiveOcrLang('follow', 'en')).toBe('en')
    expect(effectiveOcrLang(undefined, 'en')).toBe('en')
    expect(effectiveOcrLang('nope', 'cmn-Hant')).toBe('cmn-Hant')
    expect(effectiveOcrLang('en', 'cmn-Hant')).toBe('en')
    expect(effectiveOcrLang('cmn-Hant', 'en')).toBe('cmn-Hant')
    expect(ocrTextLangOf('en')).toBe('en')
    expect(ocrTextLangOf('cmn-Hant')).toBe('zh')
  })
  it('與 main 逐格相同(兩邊各一份純函式,這裡對照)', () => {
    for (const ocrLang of ['follow', 'cmn-Hant', 'en', undefined] as const) {
      for (const language of ['cmn-Hant', 'en'] as const) {
        expect(effectiveOcrLang(ocrLang, language)).toBe(mainEffective({ language, ocrLang }))
      }
    }
  })
  it('缺語言包的提示:main 回報優先;沒回報 → 依有效辨識語言(手動指定蓋過客戶端語言)', () => {
    expect(ocrWantsEnglish(null, 'cmn-Hant', 'en')).toBe(true)
    expect(ocrWantsEnglish(null, 'en', 'cmn-Hant')).toBe(false)
    expect(ocrWantsEnglish(null, 'en', 'follow')).toBe(true)
    expect(ocrWantsEnglish({ ok: false, error: 'lang-missing', lang: 'zh-Hant-TW', langs: [] }, 'en', 'cmn-Hant')).toBe(false)
  })
})

describe('ocrLang 設定', () => {
  it('舊設定檔沒有這欄 / 壞值 → follow;合法值保留並寫進檔', () => {
    for (const raw of [null, '{"game":"poe2"}', '{"ocrLang":"zh"}', '{"ocrLang":1}', '{"ocrLang":null}']) {
      const { config, serialized } = _roundTripForTest(raw)
      expect(config.ocrLang).toBe('follow')
      expect(JSON.parse(serialized).ocrLang).toBe('follow')
    }
    for (const v of ['follow', 'cmn-Hant', 'en'] as const) {
      const { config, serialized } = _roundTripForTest(JSON.stringify({ ocrLang: v }))
      expect(config.ocrLang).toBe(v)
      expect(JSON.parse(serialized).ocrLang).toBe(v)
    }
    expect(normOcrLang('en')).toBe('en')
    expect(normOcrLang('EN')).toBe('follow')
  })
  it('獨立於客戶端語言與介面語言:三者各自存取', () => {
    const { config } = _roundTripForTest('{"language":"cmn-Hant","uiLanguage":"cmn-Hant","ocrLang":"en"}')
    expect([config.uiLanguage, config.language, config.ocrLang]).toEqual(['cmn-Hant', 'cmn-Hant', 'en'])
    expect(hostConfigOf(config)).toMatchObject({ uiLanguage: 'cmn-Hant', language: 'cmn-Hant', ocrLang: 'en' })
  })
  it('host-config 帶出 ocrLang,且不經去抖立即送出(main 要馬上換 OCR 語言包重啟行程)', () => {
    vi.useFakeTimers()
    try {
      expect(HOST_CONFIG_IMMEDIATE_KEYS).toContain('ocrLang')
      const send = vi.fn()
      const sync = createHostConfigSync<HostConfigForMain>({ send, immediateKeys: [...HOST_CONFIG_IMMEDIATE_KEYS] })
      const { config } = _roundTripForTest(null)
      sync.update(hostConfigOf(config))
      expect(send).toHaveBeenCalledTimes(1)
      config.ocrLang = 'en'
      sync.update(hostConfigOf(config))
      expect(send).toHaveBeenCalledTimes(2) // 沒推進計時器就已送出
      expect(send.mock.calls[1][0].ocrLang).toBe('en')
    } finally { vi.useRealTimers() }
  })
  it('兩種介面語言都有辨識語言的文案', () => {
    for (const lang of ['cmn-Hant', 'en']) {
      const s = ocrStrings(lang)
      for (const k of ['lang', 'lang_follow', 'lang_zh', 'lang_en', 'lang_hint']) expect(s[k], `${lang}.${k}`).toBeTruthy()
    }
  })
  it('熱鍵卡片的 overlayKey 文案:設定選單 / Settings menu', () => {
    const p = (lang: string) => (JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8')) as { ppz: Record<string, string> }).ppz
    expect(p('cmn-Hant').overlay_key).toBe('設定選單')
    expect(p('en').overlay_key).toBe('Settings menu')
  })
})
