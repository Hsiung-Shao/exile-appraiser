// 第 27 步:查價時依物品文字判斷語言(純函式;標頭字串取自實際的 client_strings.js)
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  chooseParseLanguage,
  detectItemTextLanguage,
  markersFromClientStrings,
  type LanguageMarkers
} from '../src/realm/item-language'

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data')

async function clientStrings (game: 'poe1' | 'poe2', lang: string): Promise<unknown> {
  const mod = await import(pathToFileURL(path.join(DATA, game, lang, 'client_strings.js')).href) as { default: unknown }
  return mod.default
}

const markers: Record<'poe1' | 'poe2', LanguageMarkers> = { poe1: {}, poe2: {} }

beforeAll(async () => {
  for (const game of ['poe1', 'poe2'] as const) {
    markers[game] = {
      'cmn-Hant': markersFromClientStrings(await clientStrings(game, 'cmn-Hant')),
      en: markersFromClientStrings(await clientStrings(game, 'en'))
    }
  }
})

/** 使用者回報的那件(PoE2 英文進階複製) */
const GLOOM = `Item Class: Body Armours
Rarity: Rare
Gloom Hide
Trailblazer Armour
--------
Armour: 434 (augmented)
`

describe('markersFromClientStrings', () => {
  it('兩代、兩語系都從 client_strings 取到 ITEM_CLASS / RARITY', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      expect(markers[game].en).toEqual({ itemClass: 'Item Class: ', rarity: 'Rarity: ' })
      expect(markers[game]['cmn-Hant']).toEqual({ itemClass: '物品種類: ', rarity: '稀有度: ' })
    }
  })

  it('缺欄位 / 空字串 / 非物件 → undefined', () => {
    expect(markersFromClientStrings(undefined)).toBeUndefined()
    expect(markersFromClientStrings('x')).toBeUndefined()
    expect(markersFromClientStrings({ ITEM_CLASS: 'Item Class: ' })).toBeUndefined()
    expect(markersFromClientStrings({ ITEM_CLASS: ': ', RARITY: 'Rarity: ' })).toBeUndefined()
  })
})

describe('detectItemTextLanguage', () => {
  it('英文 / 繁中名牌區', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      expect(detectItemTextLanguage(GLOOM, markers[game])).toBe('en')
      expect(detectItemTextLanguage('物品種類: 戒指\n稀有度: 稀有\n厄運 指環\n紅玉戒指\n--------\n', markers[game])).toBe('cmn-Hant')
    }
  })

  it('CRLF、全形冒號、開頭空行都認得', () => {
    const m = markers.poe1
    expect(detectItemTextLanguage(GLOOM.replace(/\n/g, '\r\n'), m)).toBe('en')
    expect(detectItemTextLanguage('物品種類：戒指\n稀有度：稀有\n', m)).toBe('cmn-Hant')
    expect(detectItemTextLanguage('\n\nItem Class: Rings\nRarity: Rare\n', m)).toBe('en')
  })

  it('沒有物品種類行(PoE2 meta 技能寶石)→ 用稀有度行判斷', () => {
    expect(detectItemTextLanguage('Rarity: Gem\nCast on Critical\n--------\n', markers.poe2)).toBe('en')
    expect(detectItemTextLanguage('稀有度: 寶石\n暴擊施放\n--------\n', markers.poe2)).toBe('cmn-Hant')
  })

  it('只看名牌區(第一個分隔線之前、最多 4 行):詞綴區的字樣不算', () => {
    expect(detectItemTextLanguage('Gloom Hide\n--------\nItem Class: Rings\n', markers.poe2)).toBeUndefined()
    expect(detectItemTextLanguage('a\nb\nc\nd\nItem Class: Rings\n', markers.poe2)).toBeUndefined()
  })

  it('標頭要後接冒號:`Rarity:` 前綴相同的別的字不算;`物品稀有度:`(地圖詞綴)不是稀有度行', () => {
    expect(detectItemTextLanguage('Rarityx: Rare\n', markers.poe2)).toBeUndefined()
    expect(detectItemTextLanguage('物品稀有度: +20%\n', markers.poe2)).toBeUndefined()
  })

  it('其他語言 / 空字串 / 亂碼 → undefined(呼叫端照客戶端語言,照舊報錯)', () => {
    const m = markers.poe2
    expect(detectItemTextLanguage('', m)).toBeUndefined()
    expect(detectItemTextLanguage('hello world\n', m)).toBeUndefined()
    expect(detectItemTextLanguage('Класс предмета: Кольца\nРедкость: Редкий\n', m)).toBeUndefined()
    expect(detectItemTextLanguage('Gegenstandsklasse: Ringe\nSeltenheit: Selten\n', m)).toBeUndefined()
  })

  it('某語系沒有標頭(client_strings 缺欄位)→ 該語系不參與判斷', () => {
    expect(detectItemTextLanguage(GLOOM, { 'cmn-Hant': markers.poe2['cmn-Hant'] })).toBeUndefined()
    expect(detectItemTextLanguage(GLOOM, {})).toBeUndefined()
  })
})

describe('chooseParseLanguage', () => {
  it('國際服:判斷得出就用文字的語言,判斷不出用客戶端語言', () => {
    expect(chooseParseLanguage('intl', 'cmn-Hant', 'en')).toBe('en')
    expect(chooseParseLanguage('intl', 'en', 'cmn-Hant')).toBe('cmn-Hant')
    expect(chooseParseLanguage('intl', 'cmn-Hant', 'cmn-Hant')).toBe('cmn-Hant')
    expect(chooseParseLanguage('intl', 'cmn-Hant', undefined)).toBe('cmn-Hant')
    expect(chooseParseLanguage('intl', 'en', undefined)).toBe('en')
  })

  it('台服:一律客戶端語言(英文文字照舊提示語言不符)', () => {
    expect(chooseParseLanguage('tw', 'cmn-Hant', 'en')).toBe('cmn-Hant')
    expect(chooseParseLanguage('tw', 'cmn-Hant', undefined)).toBe('cmn-Hant')
  })
})
