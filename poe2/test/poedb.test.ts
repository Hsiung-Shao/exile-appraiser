// 在 poe2db 開物品:PoE2 網址組法(EE2 規則)。只測純函式,不開瀏覽器。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { setupTests } from './vitest.setup'
import { poe2dbUrl } from '../src/web/item-check/poedb'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'zhTW/fixtures')
const fixture = (dir: string, name: string) => fs.readFileSync(path.join(FIX, dir, `${name}.txt`), 'utf8')

/** 手寫的英文剪貼簿(只有底材資料與一行防禦值,parser 靠基底名認物品) */
const rare = (cls: string, base: string, stats: string) =>
  `Item Class: ${cls}\nRarity: Rare\nDoom Shell\n${base}\n--------\n${stats}\n--------\nRequirements:\nLevel: 70\n--------\nItem Level: 80\n`

function parse (text: string, label: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`${label} 解析失敗:${r.error}`)
  return r.value
}

const en: Record<string, ParsedItem> = {}
const zh: Record<string, ParsedItem> = {}

beforeAll(async () => {
  // 兩個語系資料不能同時載入(模組層級全域),先解析英文再切繁中
  setupTests({ language: 'en' })
  await init('en')
  en.str = parse(rare('Body Armours', 'Barbarian Plate', 'Armour: 355'), 'str')
  en.strDex = parse(rare('Body Armours', 'Ancestral Mail', 'Armour: 214\nEvasion Rating: 194'), 'strDex')
  en.int = parse(rare('Body Armours', 'Altar Robe', 'Energy Shield: 95'), 'int')
  en.buckler = parse(rare('Bucklers', 'Ancient Buckler', 'Evasion Rating: 178'), 'buckler')
  en.focus = parse(rare('Foci', 'Antler Focus', 'Energy Shield: 18'), 'focus')
  en.noCat = parse(rare('Body Armours', 'Barbarian Plate', 'Armour: 355'), 'noCat')
  en.noCat.category = undefined
  en.unique = parse(fixture('en', 'amulet-unique-oduuns-idol-01'), 'unique')
  en.boots = parse(fixture('en', 'boots-rare-luxurious-slippers-01'), 'boots')
  en.gem = parse(fixture('en', 'gem-skill-01'), 'gem')
  en.currency = parse(fixture('en', 'currency-01'), 'currency')
  setupTests({ language: 'cmn-Hant' })
  await init('cmn-Hant')
  zh.unique = parse(fixture('cmn-Hant', 'amulet-unique-oduuns-idol-01'), 'zh unique')
}, 180_000)

const BASE_US = 'https://poe2db.tw/us/'

describe('poe2dbUrl(PoE2)', () => {
  it('T3 稀有純力量胸甲 → 類別頁 Body_Armours_str#ModifiersCalc', () => {
    expect(poe2dbUrl(en.str, 'en')).toBe(`${BASE_US}Body_Armours_str#ModifiersCalc`)
  })

  it('T3 力量+敏捷胸甲 → 後綴依序 _str_dex(順序錯會開到別頁)', () => {
    expect(poe2dbUrl(en.strDex, 'en')).toBe(`${BASE_US}Body_Armours_str_dex#ModifiersCalc`)
  })

  it('T3 純智慧胸甲 → 後綴 _int', () => {
    expect(poe2dbUrl(en.int, 'en')).toBe(`${BASE_US}Body_Armours_int#ModifiersCalc`)
  })

  it('T3 稀有純能量護盾鞋 → 同樣依防禦屬性加 _int 並帶 #ModifiersCalc', () => {
    expect(poe2dbUrl(en.boots, 'en')).toMatch(/^https:\/\/poe2db\.tw\/us\/Boots_int#ModifiersCalc$/)
  })

  it('T3 圓盾與法器不加防禦後綴,只有類別頁 + #ModifiersCalc', () => {
    for (const k of ['buckler', 'focus']) {
      expect(poe2dbUrl(en[k], 'en'), k).toMatch(/^https:\/\/poe2db\.tw\/us\/[A-Za-z]+#ModifiersCalc$/)
    }
  })

  it('T4 傳奇 → refName 去撇號、空白轉底線,不帶 #ModifiersCalc', () => {
    expect(poe2dbUrl(en.unique, 'en')).toBe(`${BASE_US}Idol_of_Uldurn`)
  })

  it('T4 繁中客戶端傳奇 → /tw/ 路徑,頁名仍是英文 refName', () => {
    expect(poe2dbUrl(zh.unique, 'cmn-Hant')).toBe('https://poe2db.tw/tw/Idol_of_Uldurn')
  })

  // 規格的「寶石」指珠寶(Ruby / Emerald / Sapphire);技能寶石不在 EE2 對照表 → refName 轉換
  it('T3 技能寶石不在對照表 → refName 轉換,不帶 #ModifiersCalc', () => {
    const url = poe2dbUrl(en.gem, 'en')
    expect(url).toBe(`${BASE_US}${en.gem.info.refName.replaceAll(' ', '_').replaceAll("'", '')}`)
    expect(url).not.toContain('#ModifiersCalc')
  })

  it('T3 不在對照表的通貨 → refName 轉換,不帶 #ModifiersCalc', () => {
    expect(poe2dbUrl(en.currency, 'en')).toBe(`${BASE_US}Exalted_Orb`)
  })

  it('T3 沒有 category → 退回 refName 轉換,不得出現 undefined', () => {
    const url = poe2dbUrl(en.noCat, 'en')
    expect(url).toBe(`${BASE_US}Barbarian_Plate`)
    expect(url).not.toContain('undefined')
  })
})
