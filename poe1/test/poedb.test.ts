// 在 poedb 開物品:PoE1 網址組法(APT 規則)。只測純函式,不開瀏覽器。
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { poedbUrl } from '../src/web/price-check/item-check/poedb'

const EN_HEADHUNTER = 'Item Class: Belts\nRarity: Unique\nHeadhunter\nLeather Belt\n--------\nItem Level: 85\n'
const EN_KAOM = "Item Class: Body Armours\nRarity: Unique\nKaom's Heart\nGlorious Plate\n--------\nItem Level: 85\n"
const ZH_HEADHUNTER = '物品種類: 腰帶\n稀有度: 傳奇\n獵首\n皮革腰帶\n--------\n物品等級: 85\n'
const ZH_KAOM = '物品種類: 胸甲\n稀有度: 傳奇\n岡姆的壯志\n榮耀戰鎧\n--------\n物品等級: 85\n'

function parse (text: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`)
  return r.value
}

const en: Record<string, ParsedItem> = {}
const zh: Record<string, ParsedItem> = {}

beforeAll(async () => {
  // 兩個語系資料不能同時載入(模組層級全域),先解析英文再切繁中
  await init('en')
  en.headhunter = parse(EN_HEADHUNTER)
  en.kaom = parse(EN_KAOM)
  await loadForLang('cmn-Hant')
  zh.headhunter = parse(ZH_HEADHUNTER)
  zh.kaom = parse(ZH_KAOM)
}, 180_000)

describe('poedbUrl(PoE1)', () => {
  it('T1 繁中客戶端傳奇腰帶 → poedb.tw/tw 用英文 refName 當頁名', () => {
    expect(zh.headhunter.info.refName).toBe('Headhunter')
    expect(poedbUrl(zh.headhunter, 'cmn-Hant')).toBe('https://poedb.tw/tw/Headhunter')
  })

  it('T2 英文客戶端名稱含撇號與空白 → /us/、撇號移除、空白變底線', () => {
    expect(poedbUrl(en.kaom, 'en')).toBe('https://poedb.tw/us/Kaoms_Heart')
  })

  it('T2 繁中客戶端同一件物品 → 頁名仍用英文 refName(不受客戶端語言影響),只換 /tw/', () => {
    expect(poedbUrl(zh.kaom, 'cmn-Hant')).toBe('https://poedb.tw/tw/Kaoms_Heart')
  })

  it('T1 語言參數只決定 us / tw 路徑,頁名不變', () => {
    expect(poedbUrl(en.headhunter, 'en')).toBe('https://poedb.tw/us/Headhunter')
    expect(poedbUrl(en.headhunter, 'cmn-Hant')).toBe('https://poedb.tw/tw/Headhunter')
  })

  it('T2 網址不含撇號、空白、%27 或 undefined', () => {
    const url = poedbUrl(en.kaom, 'en')
    expect(url).not.toMatch(/['\s]|%27|%20|undefined/)
  })
})
