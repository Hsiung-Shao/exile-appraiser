// 在 poewiki 開物品:PoE1 網址組法(頁名 = 英文 refName)。只測純函式,不開瀏覽器。
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { wikiUrl } from '../src/web/price-check/item-check/poedb'

const EN_HEADHUNTER = 'Item Class: Belts\nRarity: Unique\nHeadhunter\nLeather Belt\n--------\nItem Level: 85\n'
const EN_KAOM = "Item Class: Body Armours\nRarity: Unique\nKaom's Heart\nGlorious Plate\n--------\nItem Level: 85\n"
const ZH_HEADHUNTER = '物品種類: 腰帶\n稀有度: 傳奇\n獵首\n皮革腰帶\n--------\n物品等級: 85\n'

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
}, 180_000)

describe('wikiUrl(PoE1)', () => {
  it('W1 英文客戶端傳奇腰帶 → poewiki.net 該物品頁', () => {
    expect(wikiUrl(en.headhunter)).toBe('https://www.poewiki.net/wiki/Headhunter')
  })

  it('W2 繁中客戶端同一件物品 → 與英文同一頁、網址不含中文', () => {
    expect(wikiUrl(zh.headhunter)).toBe('https://www.poewiki.net/wiki/Headhunter')
    expect(wikiUrl(zh.headhunter)).toBe(wikiUrl(en.headhunter))
    expect(wikiUrl(zh.headhunter)).not.toMatch(/[㐀-鿿]/)
  })

  it("W3 名稱含撇號 → 撇號保留、空白變底線,不含空白與 undefined", () => {
    const url = wikiUrl(en.kaom)
    expect(url).toBe("https://www.poewiki.net/wiki/Kaom's_Heart")
    expect(url).not.toMatch(/\s|undefined/)
  })
})
