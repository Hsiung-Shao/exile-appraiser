import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import type { FilterOrGroup, StatFilter } from '@/web/price-check/filters/interfaces'
import { createPresets, createTradeRequest } from '../src/index'

// 2026-11-19 使用者裁定「改成可勾選」:劫盜契約 / 藍圖的隨機詞綴、魔偶的固定詞綴,上游不列(勾都勾不到);
// 收進來但預設不勾 = 預設查詢不變。樣本照類型掃描的寫法組(不是實機剪貼簿)
const OPTS = {
  league: 'Standard', realm: 'intl' as const, clientLanguage: 'cmn-Hant' as const, searchStatRange: 10,
  currency: null, collapseListings: 'api' as const, activateStockFilter: false, merchantOnly: false
}
const MODS = (lines: string[]) => lines.flatMap((l, i) => [`{ ${i % 2 ? '後綴' : '前綴'} "測試的"(階層：1) }`, l])
const head = (klass: string, base: string) => [`物品種類: ${klass}`, '稀有度: 稀有', '末日循環', base, '--------', '物品等級: 84']
const ITEMS: Record<string, { text: string, optIn: string[] }> = {
  契約書: {
    // 職業需求與地區等級同一段(parseHeistContract);少了它就驗不到職業等級的預設條件
    text: [...head('契約書', '契約書：碉堡'), '--------', '地區等級: 83', '需要 開鎖 (等級 3)', '--------', ...MODS(['增加 16% 此區域物品數量', '怪物的技能附加 2 次連鎖'])].join('\n'),
    optIn: ['增加 #% 此區域物品數量', '怪物的技能附加 # 次連鎖']
  },
  藍圖: {
    text: [...head('藍圖', '藍圖：碉堡'), '--------', '地區等級: 83', '已揭露側廂: 1/4', '--------', ...MODS(['增加 16% 此區域物品數量', '怪物的技能附加 2 次連鎖'])].join('\n'),
    optIn: ['增加 #% 此區域物品數量', '怪物的技能附加 # 次連鎖']
  },
  魔偶: {
    text: [...head('魔偶', '次要魔偶'), '--------', '{ 固定詞綴 }', '增加 2% 你地圖中掉落的地圖', '--------', ...MODS(['擊殺敵人增加 100% 機率產生超越傳送門'])].join('\n'),
    optIn: ['增加 #% 你地圖中掉落的地圖']
  },
  // 2026-11-24 使用者裁定:3.30 海圖比照稀有地圖;區域段同類型掃描(parseChart 讀區域名 + 區域等級)
  海圖: {
    text: [...head('海圖', '珊瑚林海圖'), '--------', '{ 固定詞綴 }', '航程詞綴會於測繪後揭露', '--------',
      ...MODS(['+21% 怪物物理傷害減免', '10% 更多怪物生命']), '--------', '深海平原', '區域等級: 83'].join('\n'),
    optIn: ['航程詞綴會於測繪後揭露', '#% 怪物物理傷害減免', '#% 更多怪物生命']
  }
}

const rowsOf = (stats: FilterOrGroup[]): StatFilter[] => stats.flatMap(s => s.group ? s.stats : [s])
// 不勾的列仍寫進查詢、帶 `disabled: true`(交易站當成沒勾);算「送出」只看有效的
const sentIds = (q: any): string[] => (q.stats as any[]).filter(g => g.type !== 'not' && !g.disabled)
  .flatMap(g => g.filters.filter((f: any) => !f.disabled).map((f: any) => f.id))

function parse (text: string): ParsedItem {
  const r = parseClipboard(text + '\n')
  if (r.isErr()) throw new Error(`解析失敗:${r.error}`)
  return r.value
}
function activePreset (item: ParsedItem) {
  const { presets, active } = createPresets(item, OPTS)
  return presets.find(p => p.id === active)!
}
const optInRows = (stats: FilterOrGroup[], refs: string[]) => rowsOf(stats).filter(f => refs.includes(f.text))

describe('上游不列的詞綴改成可勾選、預設不勾', () => {
  beforeAll(async () => {
    await init('cmn-Hant')
    await loadForLang('cmn-Hant')
  }, 180_000)

  for (const [name, { text, optIn }] of Object.entries(ITEMS)) {
    // 失敗代表:這類詞綴仍然不列(使用者勾不到)
    it(`${name}:詞綴都有自己的列`, () => {
      const rows = optInRows(activePreset(parse(text)).stats, optIn)
      expect(rows.map(r => r.text).sort()).toEqual([...optIn].sort())
    })

    // 失敗代表:新列預設勾起來,預設查詢變了(這類詞綴全部當條件送出常常 0 筆)
    it(`${name}:新列預設不勾,預設查詢不帶它們`, () => {
      const preset = activePreset(parse(text))
      const rows = optInRows(preset.stats, optIn)
      expect(rows.every(r => r.disabled)).toBe(true)
      const sent = sentIds(createTradeRequest(preset).query)
      for (const r of rows) for (const id of r.tradeId) expect(sent).not.toContain(id)
    })

    // 失敗代表:收進新列時動到原本的預設條件(職業等級、側廂、魔偶原本的詞綴…)
    it(`${name}:實際生效的預設查詢與拿掉這些詞綴的同一件物品相同`, () => {
      const without = text.split('\n').filter((l, i, a) => !optIn.some(r => l.replace(/\d+/g, '#') === r) &&
        !(l.startsWith('{') && optIn.some(r => (a[i + 1] ?? '').replace(/\d+/g, '#') === r))).join('\n')
      expect(without).not.toBe(text)
      const effective = (q: any) => JSON.stringify({ ...q, stats: (q.stats as any[]).filter(g => !g.disabled)
        .map(g => ({ ...g, filters: g.filters.filter((f: any) => !f.disabled) })).filter(g => g.filters.length || g.type === 'not') })
      const base = effective(createTradeRequest(activePreset(parse(without))).query)
      expect(effective(createTradeRequest(activePreset(parse(text))).query)).toBe(base)
      // 拿掉後的物品不受這次改動影響,鎖住它 = 程式整體改壞(兩邊一起變)也抓得到
      expect(JSON.parse(base)).toMatchSnapshot()
    })

    // 失敗代表:勾了也沒送(列只是擺好看)
    it(`${name}:勾選後送出該詞綴`, () => {
      const preset = activePreset(parse(text))
      const row = optInRows(preset.stats, optIn)[0]
      row.disabled = false
      expect(sentIds(createTradeRequest(preset).query)).toContain(row.tradeId[0])
    })
  }

  // 2026-11-24 使用者裁定:海圖的新列比照稀有地圖收進「已隱藏」;失敗代表新列攤在面板上
  it('海圖:新列收進已隱藏,且只藏不勾的列', () => {
    const stats = rowsOf(activePreset(parse(ITEMS.海圖.text)).stats)
    const rows = optInRows(stats, ITEMS.海圖.optIn)
    expect(rows.every(r => r.hidden === 'filters.hide_map_random_mod')).toBe(true)
    // 被藏卻仍勾選 = 看不見的查詢條件
    expect(stats.filter(r => r.hidden === 'filters.hide_map_random_mod' && !r.disabled)).toEqual([])
  })
})
