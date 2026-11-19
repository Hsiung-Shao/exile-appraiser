import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import { createPresets, createTradeRequest } from '../src/index'

// 2026-11-19:交易站的穢生篩選叫 `mutated`(intl「Foulborn」/ tw「穢生」),上游送的 `foulborn_item` 已不存在
const TEXT = fs.readFileSync(path.join(__dirname, 'fixtures/cmn-Hant/jewel-unique-adorned-01.txt'), 'utf8').replace(/\r\n/g, '\n')

function query (text: string, realm: 'intl' | 'tw') {
  const item = parseClipboard(text)._unsafeUnwrap()
  const { presets, active } = createPresets(item, {
    league: 'Standard', realm, clientLanguage: 'cmn-Hant', searchStatRange: 10,
    currency: null, collapseListings: 'api', activateStockFilter: false, merchantOnly: false
  })
  return createTradeRequest(presets.find(p => p.id === active)!).query as any
}

describe('穢生篩選', () => {
  beforeAll(async () => {
    await init('cmn-Hant')
    await loadForLang('cmn-Hant')
  }, 180_000)

  for (const realm of ['intl', 'tw'] as const) {
    // 失敗代表:查一般傳奇會混進穢生版(或又送回不存在的 foulborn_item)
    it(`${realm}:一般傳奇送 mutated=false`, () => {
      const misc = query(TEXT, realm).filters.misc_filters.filters
      expect(misc.mutated).toEqual({ option: 'false' })
      expect(misc.foulborn_item).toBeUndefined()
    })

    // 失敗代表:查穢生版會連一般版一起撈回來
    it(`${realm}:穢生傳奇送 mutated=true`, () => {
      const text = TEXT.replace('\n朝氣之靈\n', '\n穢生 朝氣之靈\n')
      expect(text).not.toBe(TEXT)
      expect(query(text, realm).filters.misc_filters.filters.mutated).toEqual({ option: 'true' })
    })

    // 失敗代表:未鑑定(看不出是不是穢生)被當成一般版,排除了穢生版掛單
    it(`${realm}:未鑑定傳奇不送 mutated`, () => {
      const text = TEXT.replace('\n朝氣之靈\n', '\n').trimEnd() + '\n--------\n未鑑定\n'
      const item = parseClipboard(text)._unsafeUnwrap()
      expect(item.isUnidentified).toBe(true)
      expect(query(text, realm).filters.misc_filters?.filters.mutated).toBeUndefined()
    })
  }
})
