import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { createPresets } from '@/web/price-check/filters/create-presets'
import { createTradeRequest } from '@/web/price-check/trade/pathofexile-trade'
import type { FilterGroup, FilterPreset } from '@/web/price-check/filters/interfaces'
import { runFixture, FIXTURES_DIR } from './helpers/fixture-harness'

/**
 * 傭兵契約書「非」篩選器的送出方式。
 *
 * 上游的做法:只要技能有 5 個輔助(因此有「6 連結」篩選器),勾選的「非」就被改寫成
 * 「6 連結但排除這些輔助」的**加權群組** —— 技能 id 重複 weight 次 + 剩下所有可能輔助的
 * 每個階層 id。一個「非」就是 20 幾條 filter,匿名使用者直接撞交易站的
 * 「Query is too complex」(使用者實機回報,勾兩個「非」就查不了)。
 *
 * 本 fork:使用者**沒勾** 6 連結時,「非」就只是「沒有這些輔助」,送便宜的 `not` 群組;
 * 只有真的勾了 6 連結才走上游的排除式加權群組。
 *
 * ⚠ 樣本是**合成的**:拿使用者的實物 `cmn-Hant/mercenary-warrant-01.txt`,替「電球」多加
 *   一行「感電機率(階層:2)」湊滿 5 個輔助(感電機率在電球的可用輔助表裡)。上游只對五輔助
 *   技能產生 6 連結與「非」,而實物樣本最多四個。它放在 `fixtures/synthetic/`,
 *   **不是** parser corpus 的一部分(corpus 只掃宣告的語系目錄),只給這一支測試用。
 */

const SAMPLE = path.join(FIXTURES_DIR, 'synthetic', 'mercenary-warrant-spark-5supports.txt')
const OPTS = {
  league: 'Standard',
  currency: null,
  collapseListings: 'api' as const,
  activateStockFilter: false,
  searchStatRange: 10,
  useEn: false,
  merchantOnly: false
}

let preset: FilterPreset
let spark: FilterGroup

beforeAll(async () => {
  await init('cmn-Hant')
  await loadForLang('cmn-Hant')
  const outcome = runFixture({
    name: 'mercenary-warrant-spark-5supports',
    language: 'cmn-Hant',
    text: fs.readFileSync(SAMPLE, 'utf8'),
    expectedPath: ''
  })
  if (outcome.kind !== 'parsed') throw new Error(outcome.error)
  expect(outcome.item.unknownModifiers, '合成的第五個輔助必須是可解析的').toEqual([])

  preset = createPresets(outcome.item, OPTS).presets[0]
  spark = preset.stats.find((s): s is FilterGroup =>
    s.group === 'mercenary' && s.meta.statRef === 'Spark')!
  expect(spark, '電球應該是一個傭兵群組').toBeDefined()
})

function enabledGroups () {
  return createTradeRequest(preset.filters, preset.stats).query.stats.filter(g => !g.disabled)
}

function sixLink () {
  return spark.stats.find(s => s.tradeId[0] === 'item.mercenary_6link')!
}

describe('傭兵契約書的「非」篩選器', () => {
  it('五個輔助的技能會有 6 連結篩選器與「非」清單', () => {
    expect(sixLink()).toBeDefined()
    expect(spark.stats.filter(s => s.not).length).toBeGreaterThan(0)
  })

  it('沒勾 6 連結時,「非」走 not 群組,不展開成加權群組', () => {
    spark.meta.disabled = false
    sixLink().disabled = true
    const nots = spark.stats.filter(s => s.not)
    nots.forEach(s => { s.disabled = true })
    nots[0].disabled = false
    nots[1].disabled = false

    const groups = enabledGroups()
    const notGroup = groups.find(g => g.type === 'not')
    expect(notGroup, '要有 not 群組').toBeDefined()
    const expectedIds = [...nots[0].tradeId, ...nots[1].tradeId]
    expect(notGroup!.filters.map(f => f.id)).toEqual(expect.arrayContaining(expectedIds))

    // 沒有被強制展開的 6 連結加權群組(上游的 forceEnabled)
    expect(groups.filter(g => g.type === 'mercenary')).toEqual([])
    // 總 filter 數要落在匿名可查的範圍(實測 not 群組 30 條以內可查)
    const total = groups.reduce((n, g) => n + g.filters.length, 0)
    expect(total).toBeLessThanOrEqual(30)
  })

  it('勾了 6 連結時,維持上游的排除式加權群組,且被「非」的家族不在其中', () => {
    spark.meta.disabled = false
    sixLink().disabled = false
    const nots = spark.stats.filter(s => s.not)
    nots.forEach(s => { s.disabled = true })
    nots[0].disabled = false

    const groups = enabledGroups()
    expect(groups.find(g => g.type === 'not'), '6 連結模式下「非」不送 not 群組').toBeUndefined()
    const weighted = groups.filter(g => g.type === 'mercenary')
    expect(weighted.length).toBeGreaterThan(0)
    for (const g of weighted) {
      for (const id of nots[0].tradeId) {
        expect(g.filters.map(f => f.id), `被「非」的 ${id} 不該出現在加權群組`).not.toContain(id)
      }
    }
  })
})

describe('傭兵契約書的「以下皆無」群組', () => {
  /**
   * 這個群組列的是「流派裡這件契約書沒有的所有技能」(風暴之手 15 技能,實物有 6 → 9 條)。
   * 上游不管群組有沒有勾,全部送出(沒勾的只帶 disabled 旗標),查詢因此被撐長。
   */
  function noneGroup (): FilterGroup {
    const found = preset.stats.find((s): s is FilterGroup => s.group === 'not')
    expect(found, '應該有「以下皆無」群組').toBeDefined()
    return found!
  }

  beforeAll(() => {
    // 把電球群組與 6 連結全部關掉,讓查詢裡只剩主技能與這個群組的影響
    spark.meta.disabled = true
    sixLink().disabled = true
    spark.stats.forEach(s => { s.disabled = true })
  })

  it('群組沒勾時,一條都不送', () => {
    const g = noneGroup()
    g.meta.disabled = true
    g.stats.forEach(s => { s.disabled = true })
    expect(g.stats.length).toBeGreaterThan(1)

    const groups = createTradeRequest(preset.filters, preset.stats).query.stats
    expect(groups.filter(q => q.type === 'not')).toEqual([])
  })

  it('群組有勾時,只送勾選的那幾條', () => {
    const g = noneGroup()
    g.meta.disabled = false
    g.stats.forEach(s => { s.disabled = true })
    g.stats[0].disabled = false

    const groups = createTradeRequest(preset.filters, preset.stats).query.stats
    const nots = groups.filter(q => q.type === 'not')
    expect(nots.length).toBe(1)
    expect(nots[0].disabled).toBe(false)
    expect(nots[0].filters.map(f => f.id)).toEqual(g.stats[0].tradeId)
  })
})
