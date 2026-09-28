import { describe, expect, it } from 'vitest'
import { ModifierType, statSourcesTotal, translateStatWithRoll, type StatCalculated, type StatSource } from '@/parser/modifiers'
import { StatBetter, type Stat } from '@/assets/data'

/**
 * `statSourcesTotal` / `translateStatWithRoll` 的定點測試。
 *
 * 為什麼不靠 fixture:這兩支的邊界是「來源帶不帶數值」的各種組合,而真實樣本只覆蓋
 * 得到其中一種。用合成來源把每一種組合都寫出來,壞掉時才會有明確的紅點,而不是
 * 等某天剛好有人貼進一件踩得到的物品。
 *
 * ⚠ 合成資料只用在**純函式**上。物品解析一律走真實剪貼簿樣本 —— 手寫的假物品
 *   會把「我以為遊戲長這樣」寫死進測試,那不是回歸網。
 */

const FLAG_STAT: Stat = {
  ref: 'Area is Influenced by the Originator\'s Memories',
  matchers: [{ string: 'Area is Influenced by the Originator\'s Memories' }],
  better: StatBetter.NotComparable,
  trade: { ids: { implicit: ['implicit.stat_0'] } }
}

const NUMERIC_STAT: Stat = {
  ref: '+# to maximum Life',
  matchers: [{ string: '+# to maximum Life' }],
  better: StatBetter.PositiveRoll,
  trade: { ids: { explicit: ['explicit.stat_0'] } }
}

/**
 * 沒有數值的來源(旗標詞綴):`stat.roll` 與 `contributes` 都是 undefined。
 *
 * ⚠ 這些替身的型別由 `tsconfig` 的 `include` 涵蓋 —— `test/**` 有進型別檢查是刻意的。
 *   少了那道檢查,手寫的替身可以少欄位、可以形狀不對,測起來全綠卻是在測一個
 *   現實中不存在的物件。第一版就漏了 `ModifierInfo.tags`,是型別檢查抓到的。
 */
function flagSource (stat: Stat): StatSource {
  return {
    modifier: { info: { type: ModifierType.Implicit, tags: [] }, stats: [] },
    stat: { stat, translation: stat.matchers[0] }
  }
}

/** 帶數值的來源。 */
function rolledSource (stat: Stat, value: number, dp = false): StatSource {
  return {
    modifier: { info: { type: ModifierType.Explicit, tags: [] }, stats: [] },
    stat: {
      stat,
      translation: stat.matchers[0],
      roll: { unscalable: false, dp, value, min: value, max: value }
    },
    contributes: { value, min: value, max: value }
  }
}

function calcOf (stat: Stat, sources: StatSource[], type = ModifierType.Implicit): StatCalculated {
  return { stat, type, sources }
}

describe('statSourcesTotal', () => {
  it('沒有來源帶數值時回 undefined,不論出現幾次', () => {
    // 這正是那張把「區域受到開創者的記憶影響」列了兩次的稀有地圖踩到的路徑。
    // 修之前它會把兩個沒有數值的來源各補成 1 再相加,回一個假的 { value: 2 }。
    expect(statSourcesTotal([flagSource(FLAG_STAT)])).toBeUndefined()
    expect(statSourcesTotal([flagSource(FLAG_STAT), flagSource(FLAG_STAT)])).toBeUndefined()
    expect(statSourcesTotal([
      flagSource(FLAG_STAT), flagSource(FLAG_STAT), flagSource(FLAG_STAT)
    ])).toBeUndefined()
  })

  it('沒有來源時回 undefined', () => {
    expect(statSourcesTotal([])).toBeUndefined()
  })

  it('單一帶數值的來源原樣回傳', () => {
    expect(statSourcesTotal([rolledSource(NUMERIC_STAT, 70)]))
      .toEqual({ value: 70, min: 70, max: 70 })
  })

  it('多個帶數值的來源相加', () => {
    expect(statSourcesTotal([rolledSource(NUMERIC_STAT, 70), rolledSource(NUMERIC_STAT, 30)]))
      .toEqual({ value: 100, min: 100, max: 100 })
  })

  it('mode=max 取最大而非相加', () => {
    expect(statSourcesTotal([rolledSource(NUMERIC_STAT, 70), rolledSource(NUMERIC_STAT, 30)], 'max'))
      .toEqual({ value: 70, min: 70, max: 70 })
  })

  it('部分帶數值時,沒數值的那些仍照舊算成 1', () => {
    // 這是上游刻意的計數語意,不在這次的修正範圍內 —— 明寫出來,免得日後被
    // 當成「順手一起清掉」的殘留。
    expect(statSourcesTotal([rolledSource(NUMERIC_STAT, 70), flagSource(NUMERIC_STAT)]))
      .toEqual({ value: 71, min: 71, max: 71 })
  })
})

describe('translateStatWithRoll', () => {
  it('來源有帶小數的數值時 dp 為 true', () => {
    const calc = calcOf(NUMERIC_STAT, [rolledSource(NUMERIC_STAT, 1.5, true)], ModifierType.Explicit)
    expect(translateStatWithRoll(calc, statSourcesTotal(calc.sources)).dp).toBe(true)
  })

  it('來源混了沒有數值的那種也不會丟例外', () => {
    // 這一項守的是 `s.stat.roll?.dp` 那個 `?.`。整體有 roll **不代表每個來源都有**,
    // 寫成 `!` 的話這裡會是 TypeError: Cannot read properties of undefined (reading 'dp')。
    // ⚠ 沒有真實樣本涵蓋這個組合,所以只有這裡擋得住。
    const calc = calcOf(NUMERIC_STAT, [
      rolledSource(NUMERIC_STAT, 70), flagSource(NUMERIC_STAT)
    ], ModifierType.Explicit)
    const roll = statSourcesTotal(calc.sources)
    expect(roll, '前提:這個組合必須真的算得出 roll,否則下面那行根本不會執行').toBeDefined()
    expect(() => translateStatWithRoll(calc, roll)).not.toThrow()
    expect(translateStatWithRoll(calc, roll).dp).toBe(false)
  })

  it('沒有 roll 時 dp 是 undefined', () => {
    const calc = calcOf(FLAG_STAT, [flagSource(FLAG_STAT), flagSource(FLAG_STAT)])
    expect(translateStatWithRoll(calc, statSourcesTotal(calc.sources)).dp).toBeUndefined()
  })
})
