import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { HttpFetch } from '@exile-appraiser/core/http'
import { createNinjaClient, lookupPrice, toSnapshot, type NinjaSnapshot } from '@exile-appraiser/core/ninja'
import {
  findRelatedItem, parseRelatedId, relatedItemPrices, relatedQueryId, type RelatedDeps
} from '@exile-appraiser/core/games/related-items'
import { ITEM_BY_REF, ITEM_DROP } from '@/assets/data'
import { nodeDataSource } from '@/assets/data/node-source'
import { getDetailsId } from '@/web/price-check/trends/getDetailsId'
import { poe1Adapter } from '../src/index'
import { parseClipboard } from '@/parser'

/**
 * 查價面板旁的「相關物品」(APT RelatedItems.vue → core `games/related-items.ts`)。
 * 真實 `data/poe1/item-drop.json` + 物品資料 + poe.ninja 錄製檔(`core/test/recordings/ninja/`,不連網)。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(HERE, '../../data/poe1')
const NINJA_DIR = path.resolve(HERE, '../../core/test/recordings/ninja')

const recordingHttp: HttpFetch = async (url) => {
  const u = new URL(url)
  const kind = u.pathname.includes('/exchange/') ? 'exchange' : 'item'
  const file = path.join(NINJA_DIR, `${kind}_${u.searchParams.get('type')}.json`)
  const ok = fs.existsSync(file)
  const body = ok ? fs.readFileSync(file, 'utf8') : 'not found'
  return { ok, status: ok ? 200 : 404, headers: new Headers(), json: async () => JSON.parse(body), text: async () => body }
}

let snap: NinjaSnapshot
function deps (): RelatedDeps<number> {
  return {
    drops: ITEM_DROP,
    itemByRef: (ns, name) => ITEM_BY_REF(ns as Parameters<typeof ITEM_BY_REF>[0], name),
    priceOf: (q) => lookupPrice(snap, q)?.entry.c
  }
}

beforeAll(async () => {
  await poe1Adapter.loadData(nodeDataSource(DATA_DIR), 'en')
  const r = await createNinjaClient({ http: recordingHttp, game: 'poe1', league: 'Allflame', sleep: async () => {}, now: () => 1 }).fetchAll()
  snap = toSnapshot(r)
})

describe('id 解析', () => {
  it('relatedQueryId / parseRelatedId 往返(含傳奇底材 variant)', () => {
    expect(relatedQueryId({ ns: 'ITEM', name: 'Sacrifice at Dawn', variant: undefined })).toBe('ITEM::Sacrifice at Dawn')
    expect(relatedQueryId({ ns: 'UNIQUE', name: "Doryani's Catalyst", variant: 'Vaal Sceptre' })).toBe("UNIQUE::Doryani's Catalyst // Vaal Sceptre")
    expect(parseRelatedId("UNIQUE::Doryani's Catalyst // Vaal Sceptre")).toEqual({ ns: 'UNIQUE', name: "Doryani's Catalyst", variant: 'Vaal Sceptre' })
    expect(parseRelatedId('ITEM::Mortal Hope')).toEqual({ ns: 'ITEM', name: 'Mortal Hope', variant: undefined })
  })
})

describe('PoE1 真實資料', () => {
  it('Sacrifice at Dawn:同組四片、自己高亮、可換物品帶 ninja 價格', () => {
    const out = relatedItemPrices(deps(), 'ITEM::Sacrifice at Dawn')!
    expect(out.missing).toEqual([])
    expect(out.related.map(r => r.id)).toEqual([
      'ITEM::Sacrifice at Dawn', 'ITEM::Sacrifice at Midnight', 'ITEM::Sacrifice at Noon', 'ITEM::Sacrifice at Dusk'
    ])
    expect(out.related.filter(r => r.highlight).map(r => r.id)).toEqual(['ITEM::Sacrifice at Dawn'])
    expect(out.items.map(i => i.id)).toContain("UNIQUE::Doryani's Catalyst // Vaal Sceptre")
    // 名稱 = 目前資料集的語系(這裡是英文)、圖示是網址
    expect(out.related[0].name).toBe('Sacrifice at Dawn')
    expect(out.related[0].icon).toMatch(/^https:\/\//)
    // 錄製檔 exchange_Fragment 有碎片 → 至少一片有價格;價格就是 lookupPrice 的 chaos
    const priced = out.related.filter(r => r.price != null)
    expect(priced.length).toBeGreaterThan(0)
    for (const r of priced) expect(r.price).toBe(lookupPrice(snap, parseRelatedId(r.id))!.entry.c)
  })

  it('沒有價格 → price undefined(畫面顯示「?」)', () => {
    const out = relatedItemPrices({ ...deps(), priceOf: () => undefined }, 'ITEM::Sacrifice at Dawn')!
    expect(out.related.every(r => r.price === undefined)).toBe(true)
  })

  it('不在任何一組 → null', () => {
    expect(relatedItemPrices(deps(), 'ITEM::Chaos Orb')).toBeNull()
    expect(relatedItemPrices(deps(), 'UNIQUE::Not A Real Item')).toBeNull()
  })

  it('找不到的物品略過並回報 missing(上游會把整塊換成錯誤字串)', () => {
    const drops = [{ query: ['ITEM::Sacrifice at Dawn', 'ITEM::No Such Fragment'], items: ['UNIQUE::No Such Unique'] }]
    const out = relatedItemPrices({ ...deps(), drops }, 'ITEM::Sacrifice at Dawn')!
    expect(out.related.map(r => r.id)).toEqual(['ITEM::Sacrifice at Dawn'])
    expect(out.items).toEqual([])
    expect(out.missing).toEqual(['ITEM::No Such Fragment', 'UNIQUE::No Such Unique'])
  })

  it('傳奇 variant 挑底材相同的那件', () => {
    const found = findRelatedItem(deps().itemByRef, "UNIQUE::Doryani's Catalyst // Vaal Sceptre")
    expect(found?.unique?.base).toBe('Vaal Sceptre')
  })

  it('全量:item-drop.json 每個 id 都找得到物品(資料同步後數字變了要看過再改)', () => {
    const all = new Set(ITEM_DROP.flatMap(e => [...e.query, ...e.items]))
    const missing = [...all].filter(id => !findRelatedItem(deps().itemByRef, id))
    expect(ITEM_DROP.length).toBe(130)
    // 已知缺口:The Beachhead 系列傳奇地圖不在 items.ndjson(APT 遇到會整塊顯示 Can't find;這裡只略過這兩件)
    expect(missing).toEqual(['UNIQUE::The Beachhead // T15', 'UNIQUE::Infused Beachhead // T16'])
  })

  it('剪貼簿物品 → getDetailsId → 對上 item-drop 組(與 RelatedItems.vue 同一條路)', () => {
    const text = [
      'Item Class: Map Fragments',
      'Rarity: Normal',
      'Sacrifice at Dawn',
      '--------',
      'Can be used in a personal Map Device to add modifiers to a Map.'
    ].join('\n')
    const parsed = parseClipboard(text)
    expect(parsed.isOk()).toBe(true)
    const id = relatedQueryId(getDetailsId(parsed._unsafeUnwrap())!)
    expect(id).toBe('ITEM::Sacrifice at Dawn')
    expect(relatedItemPrices(deps(), id)?.related.length).toBe(4)
  })
})
