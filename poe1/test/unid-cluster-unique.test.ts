import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, ITEMS_ITERATOR } from '@/assets/data'
import { parseClipboard, makeIdentifiedUnique } from '@/parser'
import { createPresets, createTradeRequest } from '../src/index'
import { getDetailsId } from '@/web/price-check/trends/getDetailsId'

// 2026-11-18 使用者實測:未鑑定的傳奇巨型星團珠寶,選定傳奇後查價面板崩潰(reading 'sources')
const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'cmn-Hant' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}

describe('未鑑定傳奇巨型星團珠寶', () => {
  beforeAll(async () => { await init('cmn-Hant') }, 180_000)

  it('選定每一個可能的傳奇後都建得出篩選與查詢(不丟例外)', () => {
    const item = parseClipboard(fs.readFileSync(path.resolve(__dirname, 'docs/unid-large-cluster-unique.cmn-Hant.txt'), 'utf8'))._unsafeUnwrap()
    const uniques = [...ITEMS_ITERATOR(JSON.stringify(item.info.refName))].filter(m => m.namespace === 'UNIQUE' && m.unique!.base === item.info.refName)
    expect(uniques.length).toBeGreaterThan(0)
    for (const u of uniques) {
      const picked = makeIdentifiedUnique(u, item)
      // 失敗代表:價格走勢的 poe.ninja 變體判斷讀了不存在的詞綴(Voices 未鑑定沒有「附加 # 個小天賦」)
      expect(() => getDetailsId(picked), u.refName).not.toThrow()
      const { presets } = createPresets(picked, OPTS)
      for (const p of presets) expect(() => createTradeRequest(p), u.refName).not.toThrow()
    }
  })
})
