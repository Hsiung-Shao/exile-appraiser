import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HttpFetch, HttpResponse } from '@exile-appraiser/core/http'
import { parseFetchItem, TradeNumberColors, type DisplayItem, type DisplayLine, type FetchItem } from '@/web/price-check/trade/display-item'
import { requestResults } from '@/web/price-check/trade/pathofexile-trade'
import { resetTradeSessions } from '@/web/price-check/trade/common'

/**
 * P1:PoE1 查價結果懸停浮窗的物品資料(國際服 fetch 錄製回應 `test/docs/fetchResponses.json`,
 * `scripts/record-poe1-fetch.mjs` 一次性錄製、已剝帳號 / 角色名)。不連網。
 */
interface Recording { cases: Array<{ case: string, ids: string[] }>, result: Array<{ id: string, item: FetchItem, listing: unknown }> }
const REC = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs/fetchResponses.json'), 'utf8')) as Recording
const byCase = (name: string, n = 0) => {
  const id = REC.cases.find(c => c.case === name)!.ids[n]
  return REC.result.find(r => r.id === id)!
}
const show = (name: string, n = 0) => parseFetchItem(byCase(name, n).item)!
const texts = (lines: DisplayLine[] | undefined) => (lines ?? []).map(l => l.text)
const vals = (l: DisplayLine | undefined) => (l?.values ?? []).map(v => v.text)
const line = (lines: DisplayLine[] | undefined, key: string) => (lines ?? []).find(l => l.key === key)

describe('P1 PoE1 解析物品資料', () => {
  it('錄製檔六類各兩件、帳號名已剝除', () => {
    expect(REC.cases.map(c => c.case)).toEqual(['rare-ring', 'unique-goldrim', 'gem-arc', 'fractured-gloves', 'crafted-bow', 'shaper-chest'])
    expect(REC.result.length).toBe(12)
    const raw = JSON.stringify(REC)
    expect(raw).not.toMatch(/whisper|"stash"/)
    for (const r of REC.result) expect(Object.keys((r.item as FetchItem & { extended?: object }).extended ?? {})).not.toContain('text')
    for (const r of REC.result) expect((r.listing as { account: { name: string } }).account.name).toMatch(/^seller\d+$/)
  })

  it('稀有戒指:名稱兩行、固定詞綴與隨機詞綴含 tier 與 trade id', () => {
    const d = show('rare-ring')
    expect(d.title).toEqual(['Sorrow Turn', 'Two-Stone Ring'])
    expect(d.rarity).toBe('Rare')
    expect(texts(d.implicitMods)).toEqual(['+14% to Fire and Cold Resistances'])
    expect(d.implicitMods![0].tradeId).toBe('implicit.stat_2915988346')
    expect(d.explicitMods!.map(l => l.tier)).toEqual(['S8', 'P7', 'S3', 'P1', 'S3', 'S3'])
    expect(d.explicitMods![3]).toMatchObject({ text: '+74 to maximum Life', tradeId: 'explicit.stat_3299347043' })
    expect(d.fracturedMods ?? []).toEqual([])
    expect(d.craftedMods ?? []).toEqual([])
  })

  it('物品等級與需求行用語言無關的欄位組成', () => {
    const d = show('rare-ring')
    expect(line(d.itemProps, 'ilvl')).toMatchObject({ text: 'Item Level: ', values: [{ text: '77', color: TradeNumberColors.White }] })
    expect(vals(line(d.itemProps, 'requires'))).toEqual(['Level 35'])
    expect(vals(line(show('shaper-chest').itemProps, 'requires'))).toEqual(['Level 68', '103 Dex', '109 Int'])
  })

  it('傳奇頭盔:傳奇稀有度、屬性值帶強化色、插槽文字', () => {
    const d = show('unique-goldrim')
    expect(d.title).toEqual(['Goldrim', 'Leather Cap'])
    expect(d.rarity).toBe('Unique')
    expect(line(d.nameBlock, 'prop')).toMatchObject({ text: 'Evasion Rating: ', values: [{ text: '55', color: TradeNumberColors.Augmented }] })
    expect(texts(d.explicitMods)).toHaveLength(4)
    expect(d.explicitMods!.every(l => l.tier === undefined)).toBe(true)
    expect(vals(line(d.itemProps, 'sockets'))).toEqual(['W'])
    expect(vals(line(show('unique-goldrim', 1).itemProps, 'sockets'))).toEqual(['W-W'])
  })

  it('寶石:寶石稀有度、標籤行、寶石詞綴沒有 trade id、已汙染標籤', () => {
    const d = show('gem-arc')
    expect(d.title).toEqual(['Arc'])
    expect(d.rarity).toBe('Gem')
    expect(d.nameBlock![0]).toMatchObject({ key: 'tags', text: 'Spell, Chaining, Lightning' })
    expect(d.nameBlock!.find(l => l.text === 'Level: ')?.values?.[0].text).toBe('20 (Max)')
    expect(line(d.itemProps, 'ilvl')).toBeUndefined()
    expect(d.explicitMods!.every(l => l.tradeId === undefined)).toBe(true)
    expect(texts(d.itemTags)).toContain('Corrupted')
  })

  it('破裂手套:破裂詞綴獨立一區、標「Fractured Item」、插槽分組', () => {
    const d = show('fractured-gloves')
    expect(d.fracturedMods).toEqual([expect.objectContaining({ text: '+44% to Cold Resistance', tier: 'S2', tradeId: 'fractured.stat_4220027924', color: TradeNumberColors.Fractured })])
    expect(texts(d.explicitMods)).toEqual(['+55 to Dexterity', '+35 to Intelligence', '+45 to maximum Mana'])
    expect(texts(d.itemTags)).toContain('Fractured Item')
    expect(vals(line(d.itemProps, 'sockets'))).toEqual(['B G'])
  })

  it('工藝弓:類別行、元素傷害多值各自上色、工藝詞綴獨立一區', () => {
    const d = show('crafted-bow')
    expect(d.nameBlock![0]).toMatchObject({ key: 'class', text: 'Bow' })
    expect(d.nameBlock!.find(l => l.text === 'Elemental Damage: ')?.values).toEqual([
      { text: '2-6', color: TradeNumberColors.Cold },
      { text: '16-323', color: TradeNumberColors.Lightning }
    ])
    expect(d.craftedMods).toEqual([expect.objectContaining({ text: '16% increased Lightning Damage', tradeId: 'crafted.stat_2231156303', color: TradeNumberColors.Crafted })])
    expect(texts(d.explicitMods)).not.toContain('16% increased Lightning Damage')
    expect(texts(show('crafted-bow', 1).craftedMods)).toHaveLength(2)
  })

  it('塑者胸甲:勢力標籤與插槽連線', () => {
    const d = show('shaper-chest')
    expect(d.influences).toEqual(['shaper'])
    expect(texts(d.itemTags)).toContain('Shaper Item')
    expect(vals(line(d.itemProps, 'sockets'))).toEqual(['B-G B'])
    expect(d.icon).toMatchObject({ w: 2, h: 3 })
  })

  it('舊格式字串詞綴以 extended.hashes / mods 取 tier 與 trade id', () => {
    const item: FetchItem = {
      name: 'Doom Coil', typeLine: 'Ruby Ring', baseType: 'Ruby Ring', frameType: 2, identified: true,
      explicitMods: ['+30% to Fire Resistance', '+50 to maximum Life'],
      craftedMods: ['+10% to Cold Resistance'],
      extended: {
        mods: { explicit: [{ name: 'of the Volcano', tier: 'S3' }, { name: 'Virile', tier: 'P5' }] },
        hashes: { explicit: [['explicit.stat_3372524247', [0]], ['explicit.stat_3299347043', [1]]], crafted: [['crafted.stat_4220027924', null]] }
      }
    }
    const d = parseFetchItem(item)!
    expect(d.explicitMods!.map(l => [l.text, l.tier, l.tradeId])).toEqual([
      ['+30% to Fire Resistance', 'S3', 'explicit.stat_3372524247'],
      ['+50 to maximum Life', 'P5', 'explicit.stat_3299347043']
    ])
    expect(d.craftedMods![0]).toMatchObject({ tradeId: 'crafted.stat_4220027924', tier: undefined })
  })

  it('藥劑屬性 displayMode 3:%N 代入數值、保留顏色、不留冒號與佔位符', () => {
    const item: FetchItem = {
      name: '', typeLine: 'Divine Life Flask', baseType: 'Divine Life Flask', frameType: 0, identified: true,
      properties: [
        { name: 'Divine Life Flask', values: [], displayMode: 0 },
        { name: 'Recovers %0 Life over %1 Seconds', values: [['1350', 1], ['4.20', 1]], displayMode: 3 },
        { name: 'Consumes %0 of %1 Charges on use', values: [['25', 0], ['60', 0]], displayMode: 3 },
        { name: 'Lasts %0 Seconds', values: [['4.00', 1]], displayMode: 3 }
      ]
    }
    const d = parseFetchItem(item)!
    const lines = d.nameBlock!
    expect(lines.map(l => l.text)).toEqual(['Divine Life Flask', 'Recovers 1350 Life over 4.20 Seconds', 'Consumes 25 of 60 Charges on use', 'Lasts 4.00 Seconds'])
    expect(JSON.stringify(lines)).not.toMatch(/%\d/)
    expect(lines[1].segments).toEqual([
      { text: 'Recovers ', color: TradeNumberColors.White },
      { text: '1350', color: 1, value: true },
      { text: ' Life over ', color: TradeNumberColors.White },
      { text: '4.20', color: 1, value: true },
      { text: ' Seconds', color: TradeNumberColors.White }
    ])
    expect(lines[1].values).toBeUndefined()
  })

  it('displayMode 3 的佔位符比數值多時不留 %N', () => {
    const d = parseFetchItem({ properties: [{ name: 'Lasts %0 Seconds, %1', values: [['4.00', 1]], displayMode: 3 }] } as FetchItem)!
    expect(d.nameBlock![0].text).toBe('Lasts 4.00 Seconds, ')
  })

  it('資料不全的回應不丟錯', () => {
    const d = parseFetchItem({ ilvl: 80 } as FetchItem) as DisplayItem
    expect(d.title).toEqual([])
    expect(parseFetchItem(undefined)).toBeUndefined()
  })
})

describe('P1 requestResults 帶出 displayItem', () => {
  afterEach(() => resetTradeSessions())
  it('fetch 回應每筆都有浮窗資料,合併前的欄位不變', async () => {
    const rows = REC.result.slice(0, 2)
    const http: HttpFetch = async () => ({
      ok: true, status: 200, headers: new Headers(),
      json: async () => JSON.parse(JSON.stringify({ result: rows })),
      text: async () => ''
    }) as HttpResponse
    const out = await requestResults({ http, realm: 'intl', latencySeconds: 0, accountName: '' }, 'Q', rows.map(r => r.id))
    expect(out.map(r => r.displayItem?.title)).toEqual([['Sorrow Turn', 'Two-Stone Ring'], ['Rapture Grip', 'Diamond Ring']])
    expect(out[0]).toMatchObject({ itemLevel: '77', accountName: 'seller1', ign: 'Seller1' })
  })
})
