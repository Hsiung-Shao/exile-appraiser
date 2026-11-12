// 在 poe2wiki 開物品:PoE2 網址組法(頁名 = 英文 refName)。只測純函式,不開瀏覽器。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { setupTests } from './vitest.setup'
import { poe2wikiUrl } from '../src/web/item-check/poedb'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'zhTW/fixtures')
const fixture = (dir: string, name: string) => fs.readFileSync(path.join(FIX, dir, `${name}.txt`), 'utf8')

function parse (text: string, label: string): ParsedItem {
  const r = parseClipboard(text)
  if (r.isErr()) throw new Error(`${label} 解析失敗:${r.error}`)
  return r.value
}

const en: Record<string, ParsedItem> = {}

beforeAll(async () => {
  setupTests({ language: 'en' })
  await init('en')
  en.unique = parse(fixture('en', 'amulet-unique-oduuns-idol-01'), 'unique')
  en.rare = parse(fixture('en', 'boots-rare-luxurious-slippers-01'), 'rare')
}, 180_000)

const BASE = 'https://www.poe2wiki.net/wiki/'
const expected = (item: ParsedItem) => `${BASE}${encodeURIComponent(item.info.refName.replaceAll(' ', '_'))}`

describe('poe2wikiUrl(PoE2)', () => {
  it('W4 傳奇 → poe2wiki.net 傳奇名頁;稀有 → 底材名頁', () => {
    for (const k of ['unique', 'rare']) {
      const url = poe2wikiUrl(en[k])
      expect(url.startsWith(BASE), k).toBe(true)
      expect(url, k).toBe(expected(en[k]))
      expect(url, k).not.toMatch(/\s|undefined/)
    }
    // 兩件物品的頁名不同,避免兩者都退成同一個預設值
    expect(poe2wikiUrl(en.unique)).not.toBe(poe2wikiUrl(en.rare))
  })
})
