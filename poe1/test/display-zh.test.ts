import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { nodeDataSource } from '@/assets/data/node-source'
import { parseFetchItem, type DisplayItem, type DisplayLine, type FetchItem } from '@/web/price-check/trade/display-item'
import {
  __displayZhTest,
  buildDisplayZhData,
  configureDisplayZh,
  displayZhFor,
  loadDisplayZhData,
  scheduleDisplayZhPreload,
  translateDisplayItem,
  translateModLine,
  type DisplayZhData,
  type DisplayZhOptions,
  type ZhLineReport
} from '@/web/price-check/trade/display-zh'

/**
 * P3–P5:PoE1 查價結果懸停浮窗的繁中化(display-zh.ts)。錄製的國際服 fetch 回應(test/docs/fetchResponses.json),不連網。
 */
const DATA = path.resolve(__dirname, '../../data/poe1')
const read = (rel: string) => fs.readFileSync(path.join(DATA, rel), 'utf8')
interface Recording { cases: Array<{ case: string, ids: string[] }>, result: Array<{ id: string, item: FetchItem }> }
const REC = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs/fetchResponses.json'), 'utf8')) as Recording
const raw = (name: string, n = 0) => REC.result.find(r => r.id === REC.cases.find(c => c.case === name)!.ids[n])!.item
const zhOf = (name: string, n = 0) => translateDisplayItem(parseFetchItem(raw(name, n))!, raw(name, n), data).display
const texts = (lines: DisplayLine[] | undefined) => (lines ?? []).map(l => l.text)
const vals = (l: DisplayLine | undefined) => (l?.values ?? []).map(v => v.text)
const line = (lines: DisplayLine[] | undefined, key: string) => (lines ?? []).find(l => l.key === key)

let data: DisplayZhData
let options: DisplayZhOptions
const source = nodeDataSource(DATA)
beforeAll(async () => {
  await init('en')
  data = buildDisplayZhData(read('en/stats.ndjson'), read('cmn-Hant/stats.ndjson'), read('cmn-Hant/items.ndjson'), {
    tradeStatsTw: read('trade/tw/stats.json'),
    itemClasses: read('item-classes/item-classes.json')
  })
})
afterEach(() => {
  configureDisplayZh(undefined)
  __displayZhTest.reset(source)
})

describe('P3 PoE1 詞綴繁中', () => {
  it('稀有戒指的固定與隨機詞綴全部換成繁中,tier / 顏色 / 行數不變', () => {
    const before = parseFetchItem(raw('rare-ring'))!
    const d = zhOf('rare-ring')
    expect(texts(d.implicitMods)).toEqual(['+14% 火焰與冰冷抗性'])
    expect(texts(d.explicitMods)).toEqual([
      '+14 敏捷', '攻擊附加 1 至 22 閃電傷害', '增加 9% 全域命中值', '+74 最大生命', '增加 44% 魔力恢復率', '增加 5% 照亮範圍'
    ])
    expect(d.explicitMods!.map(l => [l.tier, l.color, l.tradeId])).toEqual(before.explicitMods!.map(l => [l.tier, l.color, l.tradeId]))
  })

  it('破裂與工藝詞綴各自用自己的 trade id 翻', () => {
    expect(texts(zhOf('fractured-gloves').fracturedMods)).toEqual(['+44% 冰冷抗性'])
    expect(texts(zhOf('crafted-bow').craftedMods)).toEqual(['增加 16% 閃電傷害'])
    expect(texts(zhOf('crafted-bow', 1).craftedMods)).toEqual(['當你擊殺敵人時，有 10% 機率觸發等級 1 的鮮血狂怒', '增加 8% 攻擊速度'])
  })

  it('同旗標多種繁中寫法以台服交易站文字挑出唯一', () => {
    const en = '12% increased Effect of Jewel Socket Passive Skills containing Corrupted Magic Jewels'
    expect(translateModLine(en, 'explicit.stat_461663422', data)).toEqual({ zh: '增加12%天賦樹插槽內的已汙染魔法珠寶效果', reason: 'ok' })
    const noTw = { ...data, tradeTextZh: undefined }
    expect(translateModLine(en, 'explicit.stat_461663422', noTw)).toEqual({ zh: undefined, reason: 'ambiguous' })
  })

  it('對不上一律保留英文:沒有 id、未知 id、錯置 id、數值個數不符', () => {
    expect(translateModLine('+74 to maximum Life', undefined, data).reason).toBe('no-id')
    expect(translateModLine('+74 to maximum Life', 'explicit.stat_1', data).reason).toBe('unknown-id')
    expect(translateModLine('+74 to maximum Life', 'explicit.stat_3261801346', data).reason).toBe('no-en-match')
    expect(translateModLine('+74 to maximum Life and more', 'explicit.stat_3299347043', data).reason).toBe('no-en-match')
    const gem = zhOf('gem-arc')
    expect(texts(gem.explicitMods)).toEqual(texts(parseFetchItem(raw('gem-arc'))!.explicitMods))
  })

  it('減少寫法挑 negate 變體', () => {
    expect(translateModLine('10% reduced Attack Speed', 'explicit.stat_681332047', data)).toEqual({ zh: '減少 10% 攻擊速度', reason: 'ok' })
  })

  it('物品名:傳奇名與基底 / 寶石換繁中,稀有隨機名保留英文', () => {
    expect(zhOf('unique-goldrim').title).toEqual(['金縷帽', '皮帽'])
    expect(zhOf('rare-ring').title).toEqual(['Sorrow Turn', '雙玉戒指'])
    expect(zhOf('gem-arc').title).toEqual(['電弧'])
  })

  it('錄製回應覆蓋率:有 trade id 的 55 行詞綴全部翻成繁中', () => {
    const reports: ZhLineReport[] = []
    for (const r of REC.result) reports.push(...translateDisplayItem(parseFetchItem(r.item)!, r.item, data).lines)
    const withId = reports.filter(l => l.tradeId)
    expect(withId.filter(l => l.reason === 'ok').length).toBe(55)
    expect(withId.length).toBe(55)
    expect(withId.filter(l => l.reason !== 'ok').map(l => `${l.reason} ${l.en}`)).toEqual([])
  })

  it('輸入不被修改', () => {
    const item = raw('shaper-chest')
    const before = parseFetchItem(item)!
    const snapshot = JSON.stringify([before, item])
    translateDisplayItem(before, item, data)
    expect(JSON.stringify([before, item])).toBe(snapshot)
  })
})

describe('P4 類別行、屬性、需求行與標籤', () => {
  it('類別行換成 GGPK 物品種類名', () => {
    expect(zhOf('crafted-bow').nameBlock![0]).toMatchObject({ key: 'class', text: '弓' })
  })

  it('屬性名換成繁中,數值與顏色不變', () => {
    const d = zhOf('crafted-bow')
    expect(texts(d.nameBlock)).toEqual(['弓', '物理傷害: ', '元素傷害: ', '暴擊率: ', '每秒攻擊次數: '])
    expect(d.nameBlock![2].values).toEqual(parseFetchItem(raw('crafted-bow'))!.nameBlock![2].values)
    expect(texts(zhOf('unique-goldrim').nameBlock)).toEqual(['閃避值: '])
  })

  it('需求行依 requirement type 換成「需求 等級 68, 103 敏捷, 109 智慧」', () => {
    const req = line(zhOf('shaper-chest').itemProps, 'requires')!
    expect(req.text).toBe('需求 ')
    expect(vals(req)).toEqual(['等級 68', '103 敏捷', '109 智慧'])
    expect(vals(line(zhOf('rare-ring').itemProps, 'requires'))).toEqual(['等級 35'])
  })

  it('物品等級、插槽與底部標籤換成繁中', () => {
    const d = zhOf('shaper-chest')
    expect(line(d.itemProps, 'ilvl')!.text).toBe('物品等級: ')
    expect(line(d.itemProps, 'sockets')!.text).toBe('插槽: ')
    expect(texts(d.itemTags)).toEqual(['塑者之物'])
    expect(texts(zhOf('fractured-gloves').itemTags)).toEqual(['破裂之物'])
    expect(texts(zhOf('gem-arc').itemTags)).toEqual(['已汙染'])
  })

  it('未知類別、未知需求類型維持英文', () => {
    const item: FetchItem = {
      typeLine: 'X', frameType: 0,
      properties: [{ name: 'Mystery Thing', values: [] }],
      requirements: [{ name: 'Level', values: [['10', 0]], type: 62 }, { name: 'Wis', values: [['5', 0]], type: 99 }]
    }
    const d = translateDisplayItem(parseFetchItem(item)!, item, data).display
    expect(d.nameBlock![0].text).toBe('Mystery Thing')
    expect(line(d.itemProps, 'requires')).toMatchObject({ text: 'Requires ', values: [{ text: 'Level 10' }, { text: '5 Wis' }] })
  })

  it('物品種類與字串資料來自 data/poe1/item-classes', () => {
    expect(data.itemClassZh?.get('Bow')).toEqual(new Set(['弓']))
    expect(data.stringZh?.get('Shaper Item')).toBe('塑者之物')
  })
})

describe('P5 開關條件與預載', () => {
  const on = (o: Partial<DisplayZhOptions> = {}) => {
    options = { uiLanguage: 'cmn-Hant', itemHoverTooltip: 'keybind', ...o }
    configureDisplayZh({ options: () => options, source: () => source })
  }

  it('沒設定宿主(CLI / 測試)一律不翻、不排程', () => {
    expect(displayZhFor('intl')).toBeUndefined()
    expect(scheduleDisplayZhPreload('intl', () => { throw new Error('不該排程') })).toBe(false)
  })

  it('台服 / 英文介面 / 浮窗關閉不翻,也不排程預載', () => {
    on()
    expect(scheduleDisplayZhPreload('tw', () => { throw new Error('不該排程') })).toBe(false)
    on({ uiLanguage: 'en' })
    expect(displayZhFor('intl')).toBeUndefined()
    expect(scheduleDisplayZhPreload('intl', () => { throw new Error('不該排程') })).toBe(false)
    on({ itemHoverTooltip: 'off' })
    expect(displayZhFor('intl')).toBeUndefined()
  })

  it('國際服 + 繁中介面 + 浮窗非關閉:閒置預載排一次,載好後同步回轉換函式', async () => {
    on()
    const queued: Array<() => void> = []
    expect(scheduleDisplayZhPreload('intl', fn => queued.push(fn))).toBe(true)
    expect(queued.length).toBe(1)
    expect(scheduleDisplayZhPreload('intl', fn => queued.push(fn))).toBe(true) // 還沒開始載 → 仍可排
    queued[0]()
    await loadDisplayZhData(source)
    expect(scheduleDisplayZhPreload('intl', () => { throw new Error('已載好不該再排') })).toBe(false)
    const toZh = displayZhFor('intl')!
    expect(typeof toZh).toBe('function')
    const item = raw('rare-ring')
    expect((toZh(parseFetchItem(item)!, item) as DisplayItem).title).toEqual(['Sorrow Turn', '雙玉戒指'])
  })

  it('第一次查價不等資料:回 undefined 並在背景載入,載好後下一次就翻', async () => {
    on({ itemHoverTooltip: 'always' })
    expect(displayZhFor('intl')).toBeUndefined()
    await loadDisplayZhData(source)
    expect(displayZhFor('intl')).toBeTypeOf('function')
  })

  it('重用已載入語系的資料與直接讀檔結果相同(客戶端英文 / 繁中)', async () => {
    const direct = data
    for (const lang of ['en', 'cmn-Hant']) {
      await loadForLang(lang)
      __displayZhTest.reset(source)
      const mem = await loadDisplayZhData(source)
      expect(mem.statsByTradeId.size).toBe(direct.statsByTradeId.size)
      expect(mem.itemNames.size).toBe(direct.itemNames.size)
      for (const r of REC.result) {
        const d = parseFetchItem(r.item)!
        expect(translateDisplayItem(d, r.item, mem).display).toEqual(translateDisplayItem(d, r.item, direct).display)
      }
    }
    await loadForLang('en')
  })
})
