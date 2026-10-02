// 第 27 步:查價依物品文字自動判斷語言 —— renderer 端的接線(解析前換資料集、useIntlSite 依資料集語系、設定頁說明)。
// 判斷規則與「結果與客戶端語言設對時相同」的回歸在 core/test/item-language.test.ts、poe{1,2}/test/auto-language.test.ts。
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { AppConfig } from '../src/web/Config'
import { dataLanguage } from '../src/web/games/active'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

afterEach(() => { dataLanguage.value = undefined })

describe('useIntlSite 依目前資料集的語系(不是只看客戶端語言設定)', () => {
  it('國際服 + 客戶端繁中:英文物品 → 不轉英文名(name 本來就是英文);繁中物品 → 送 refName', () => {
    const c = AppConfig()
    c.realm = 'intl'
    c.language = 'cmn-Hant'
    dataLanguage.value = 'en'
    expect(c.useIntlSite).toBe(false)
    dataLanguage.value = 'cmn-Hant'
    expect(c.useIntlSite).toBe(true)
  })

  it('國際服 + 客戶端英文收到繁中物品 → 送 refName(否則會把繁中名送進國際服)', () => {
    const c = AppConfig()
    c.realm = 'intl'
    c.language = 'en'
    dataLanguage.value = 'cmn-Hant'
    expect(c.useIntlSite).toBe(true)
  })

  it('資料還沒載入 → 照客戶端語言設定(同改版前)', () => {
    const c = AppConfig()
    c.realm = 'intl'
    c.language = 'cmn-Hant'
    expect(c.useIntlSite).toBe(true)
    c.language = 'en'
    expect(c.useIntlSite).toBe(false)
    c.realm = 'tw'
    c.language = 'cmn-Hant'
    expect(c.useIntlSite).toBe(false)
  })
})

describe('接線守門', () => {
  it('App.vue load():先 prepareItemText 換資料集,再 parseClipboard;較舊的等待不覆蓋較新的物品', () => {
    const src = read('renderer/src/web/App.vue')
    const body = src.slice(src.indexOf('async function load (text: string)'))
    const prep = body.indexOf('adapter.prepareItemText(text, AppConfig().realm)')
    const parse = body.indexOf('Poe2.parseClipboard(text)')
    expect(prep).toBeGreaterThan(0)
    expect(parse).toBeGreaterThan(prep)
    expect(body.slice(prep, parse)).toContain('if (seq !== loadSeq) return')
    expect(body.slice(prep, parse)).toContain('dataLanguage.value = adapter.dataLanguage()')
  })

  it('main.ts:PoE2 host 選項的 language 不從設定給(adapter 依資料集設);載入完成回到客戶端語言', () => {
    const src = read('renderer/src/main.ts')
    const provider = src.slice(src.indexOf('Poe2.setHostOptionsProvider('), src.indexOf('Poe2.setPriceSource('))
    expect(provider).not.toMatch(/language:\s*AppConfig\(\)\.language/)
    expect(src).toContain('dataLanguage.value = lang')
  })

  it('一鍵回報重算查詢用這件物品的解析語系', () => {
    expect(read('renderer/src/web/report.ts')).toContain('clientLanguage: dataLanguage.value ?? c.language')
  })
})

describe('設定頁說明', () => {
  it('客戶端語言下方有說明,中英字串都有', () => {
    expect(read('renderer/src/web/settings/tabs/General.vue')).toContain("t('ppz.language_auto_hint')")
    for (const lang of ['en', 'cmn-Hant']) {
      const ppz = JSON.parse(read(`renderer/src/i18n/${lang}.json`)).ppz
      expect(typeof ppz.language_auto_hint, lang).toBe('string')
      expect(ppz.language_auto_hint.length).toBeGreaterThan(10)
    }
  })
})
