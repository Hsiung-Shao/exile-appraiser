import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'
import { createExactStatFilters, initUiModFilters } from '@/web/price-check/filters/create-stat-filters'
import type { StatFilter } from '@/web/price-check/filters/interfaces'

/**
 * 地圖查價面板「該顯示哪幾條」的回歸網。
 *
 * 為什麼需要它:地圖的定價只看少數幾條 —— 物品數量/稀有度/怪物群大小(property)、
 * 更多地圖/聖甲蟲/通貨/命運卡(pseudo)、以及固定詞綴(implicit,例如「區域受到
 * 開創者的記憶影響」)。稀有地圖同時還帶 5-9 條隨機詞綴,它們占滿版面卻沒有一條
 * 是勾選的,使用者得先略過一長串才找得到真正在看的那幾條。
 *
 * 判定寫在 `create-stat-filters.ts` 的 `item.category === ItemCategory.Map` 分支:
 * 隱藏的範圍與它**同一行**停用的範圍逐字相同(稀有地圖的 explicit)。這條測試存在
 * 是為了擋兩件事:
 *   1. 該留的被收走(白名單那幾條要一直看得見)
 *   2. **範圍外洩** —— 這條規則跑去影響裝備、珠寶、海圖等其他物品類別。
 *      第 2 條比第 1 條重要,`boots-rare-01` 那一組就是為它存在的。
 *
 * 樣本來自使用者實際貼上的地圖文字(`fixtures/filter-visibility/`),涵蓋 T16.5、
 * T16、T17 夢魘地圖、異界佔據、壁壘地圖。
 */

const SAMPLES_DIR = path.resolve(__dirname, 'fixtures/filter-visibility')
// 本專案的資料檔在 repo 根的 data/poe1(上游是 renderer/public/data)
const DATA_DIR = path.resolve(__dirname, '../../data/poe1')

/** 新增的隱藏理由。i18n 鍵拼錯不會有任何錯誤,只會在畫面上印出鍵本身。 */
const HIDE_REASON = 'filters.hide_map_random_mod'

function loadItem (fixture: string): ParsedItem {
  const text = fs.readFileSync(path.join(SAMPLES_DIR, `${fixture}.txt`), 'utf8')
  const result = parseClipboard(text)
  if (result.isErr()) throw new Error(`${fixture} 解析失敗:${result.error}`)
  return result.value
}

function loadFilters (fixture: string): StatFilter[] {
  const item = loadItem(fixture)
  // 地圖在 create-presets.ts 一律走 exact 這條路,沒有第二個 preset
  return createExactStatFilters(item, item.statsByType, { searchStatRange: 10 })
}

function shape (filters: StatFilter[]): Array<[string, string, string | undefined, boolean]> {
  return filters.map(f => [f.tag as string, f.statRef, f.hidden, f.disabled])
}

interface MapExpectation {
  /**
   * 面板上**看得見**的那幾條,逐字逐序,連**勾沒勾**都釘住。
   * 空陣列代表這張圖沒有一條會影響定價。
   *
   * ⚠ 第三欄是 `disabled`,勾選狀態直接決定送出去的查詢 ——
   *   物品稀有度在有更多掉落時**刻意不勾**(`maps.ts` 的 `disabled: hasMoreDrops`),
   *   那是既有行為,不是漏勾。
   */
  visible: Array<[tag: string, statRef: string, disabled: boolean]>
  /** 被收進「已隱藏」的隨機詞綴條數。 */
  hidden: number
  /** 這份樣本為什麼長這樣。 */
  why: string
}

const MAPS: Record<string, MapExpectation> = {
  // 使用者的 T16.5 主樣本(剪貼簿的進階格式,詞綴帶 `{ 前綴 }` 標註)。
  // 白名單的 8 項 + 開創者的記憶全在這一件上。
  'map-t165-annotated-01': {
    visible: [
      ['property', 'Item Quantity: +#%', false],
      // 有更多掉落 → 稀有度預設不勾
      ['property', 'Item Rarity: +#%', true],
      ['property', 'Monster Pack Size: +#%', false],
      ['pseudo', 'More Maps: #%', false],
      ['pseudo', 'More Scarabs: #%', false],
      ['pseudo', 'More Currency: #%', false],
      // 使用者列的清單沒提命運卡,但它與更多地圖/聖甲蟲/通貨是同一類 more-drops
      // pseudo,漏掉會讓同類東西行為不一致
      ['pseudo', 'More Divination Cards: #%', false],
      // 固定詞綴 = 玩家口中的 T16.5 高難度地圖
      ['implicit', "Area is Influenced by the Originator's Memories", false]
    ],
    hidden: 9,
    why: '六條產出屬性 + 命運卡 + 開創者的記憶都留著,9 條隨機詞綴收起來'
  },
  'map-t165-strongsteel': {
    visible: [
      ['property', 'Item Quantity: +#%', false],
      ['property', 'Item Rarity: +#%', true],
      ['property', 'Monster Pack Size: +#%', false],
      ['pseudo', 'More Maps: #%', false]
    ],
    hidden: 5,
    why:
      '⚠ 這份是 tooltip 形式(詞綴沒有 `{ }` 標註)。同一張圖的剪貼簿形式是上面那件 ——' +
      '差別在開創者的記憶那一段在這裡被解析器丟掉了(`parseUnannotatedModifiers` 認不出' +
      '只有 implicit trade id 的詞綴),與這次的隱藏規則無關。'
  },
  'map-t165-agony-trickery': {
    visible: [
      ['property', 'Item Quantity: +#%', false],
      ['property', 'Item Rarity: +#%', true],
      ['property', 'Monster Pack Size: +#%', false],
      ['pseudo', 'More Scarabs: #%', false],
      ['pseudo', 'More Currency: #%', false]
    ],
    hidden: 9,
    why: '更多聖甲蟲 + 更多通貨'
  },
  'map-t16-corrupted': {
    visible: [
      ['property', 'Item Quantity: +#%', false],
      // 沒有更多掉落 → 稀有度就是這張圖的賣點,預設勾選
      ['property', 'Item Rarity: +#%', false],
      ['property', 'Monster Pack Size: +#%', false]
    ],
    hidden: 8,
    why: '已汙染的 T16(汙染狀態是 FiltersBlock 的按鈕,不是這裡的詞綴)'
  },
  // 使用者要的關鍵案例:沒汙染、沒有更多掉落的普通稀有 T16。
  // 放寬 `mapProps()` 的早退之前,這張圖**一項 property 都不產生**,
  // 隨機詞綴收起來之後面板會整個空掉。
  'map-t16-no-more-drops': {
    visible: [
      ['property', 'Item Quantity: +#%', false],
      ['property', 'Item Rarity: +#%', false],
      ['property', 'Monster Pack Size: +#%', false]
    ],
    hidden: 8,
    why: '無汙染、無更多掉落的 T16 —— 三項產出屬性都要產生,且稀有度是勾選的'
  },
  'map-t17-nightmare': {
    visible: [
      ['property', 'Item Quantity: +#%', false],
      ['property', 'Item Rarity: +#%', true],
      ['property', 'Monster Pack Size: +#%', false],
      ['pseudo', 'More Scarabs: #%', false]
    ],
    hidden: 6,
    why: '玩家口中的 T17 夢魘地圖'
  },
  'map-t16-eater-occupied': {
    visible: [
      ['property', 'Item Quantity: +#%', false],
      ['property', 'Item Rarity: +#%', false],
      ['property', 'Monster Pack Size: +#%', false]
    ],
    hidden: 5,
    why:
      '異界佔據的 T16。⚠「地圖被異界．根除佔據」在 tooltip 形式下被解析器丟掉' +
      '(`parseUnannotatedModifiers` 認不出只有 implicit trade id 的詞綴),' +
      '所以看得見的只有三項產出屬性 —— 那是既有的解析缺口,不是隱藏規則造成的。'
  },
  'map-t16-maven-bulwark': {
    visible: [],
    hidden: 0,
    why:
      '⚠ 未鑑定的壁壘地圖目前一條 filter 都沒有:它連物品數量都沒有(未鑑定的圖不顯示' +
      '產出屬性),而「地圖含有圖拉克斯的壁壘」在 tooltip 形式下被解析器丟掉。' +
      '這裡把現況釘住:哪天壁壘詞綴解析得出來,這條會紅,' +
      '那時要回來確認它有沒有被誤收進「已隱藏」(它是固定詞綴,應該看得見)。'
  }
}

/**
 * **反向樣本**:與地圖毫無關係的物品。
 *
 * 這是整份測試最重要的一組。地圖那條規則寫在 `item.category === ItemCategory.Map`
 * 的分支裡,只要有人動到那個判斷(或把規則搬到迴圈外),別的物品就會跟著被收起來,
 * 而使用者只會覺得「詞綴莫名其妙不見了」。
 *
 * ⚠ **稀有魔偶是這一組的關鍵樣本,不能只放裝備。** `createExactStatFilters` 的
 *   `keepByType` 只在兩種情況下收 explicit 詞綴:魔法物品,以及**稀有的魔偶或地圖**
 *   (見同檔 `:56-63`)。所以稀有裝備走 exact 這條路時**根本沒有 explicit filter**,
 *   拿它當反向樣本,「地圖的規則跑去套用到所有物品」這個突變會**測不出來**
 *   —— 實測過,一開始只放鞋子時該突變存活。魔偶是唯一與稀有地圖形狀相同的
 *   非地圖物品,它才是這條防線真正的守衛。
 *
 * 期望值是人工核可過的:每條路徑各自的 tag / hidden / disabled 逐項固定。
 */
const BOOTS_EXACT: Array<[string, string, string | undefined, boolean]> = [
  ['property', 'Base Percentile: #%', undefined, true]
]

const BOOTS_UI: Array<[string, string, string | undefined, boolean]> = [
  ['property', 'Armour: #', undefined, true],
  ['property', 'Evasion Rating: #', undefined, true],
  ['pseudo', '+#% total Elemental Resistance', undefined, false],
  ['pseudo', '+#% total to Fire Resistance', 'filters.hide_ele_res', true],
  ['pseudo', '+# total maximum Life', undefined, false],
  ['pseudo', '#% increased Movement Speed', undefined, true],
  ['explicit', '#% increased Rarity of Items found', undefined, true]
]

const IDOL_EXACT: Array<[string, string, string | undefined, boolean]> = [
  ['explicit', 'Your Maps have +#% chance to contain a Legion Encounter', undefined, true],
  ['explicit', 'Your Maps have +#% chance to contain a Strongbox', undefined, true],
  // 沒有 roll 的詞綴 `enableGoodRolledFilters` 會勾起來
  ['explicit', 'Your Maps contain an additional Shrine', undefined, false]
]

const IDOL_UI: Array<[string, string, string | undefined, boolean]> = [
  ['explicit', 'Your Maps have +#% chance to contain a Legion Encounter', undefined, true],
  ['explicit', 'Your Maps have +#% chance to contain a Strongbox', undefined, true],
  ['explicit', 'Your Maps contain an additional Shrine', undefined, true]
]

const NON_MAP_GOLDEN: Array<{
  fixture: string
  exact: Array<[string, string, string | undefined, boolean]>
  ui: Array<[string, string, string | undefined, boolean]>
}> = [
  { fixture: 'boots-rare-01', exact: BOOTS_EXACT, ui: BOOTS_UI },
  { fixture: 'idol-rare-01', exact: IDOL_EXACT, ui: IDOL_UI }
]

describe('地圖查價的詞綴顯示', () => {
  beforeAll(async () => {
    await init('cmn-Hant')
    await loadForLang('cmn-Hant')
  }, 180_000)

  it('樣本目錄非空', () => {
    // 全空的話下面每個 for 迴圈都會空轉通過,那比沒有測試更危險
    const files = fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.txt'))
    expect(files.length).toBeGreaterThan(0)
    expect(new Set(files)).toEqual(new Set([
      ...Object.keys(MAPS).map(n => `${n}.txt`),
      ...NON_MAP_GOLDEN.map(g => `${g.fixture}.txt`)
    ]))
  })

  describe('白名單:會影響定價的那幾條看得見', () => {
    for (const [fixture, expectation] of Object.entries(MAPS)) {
      it(`${fixture} — ${expectation.why}`, () => {
        const filters = loadFilters(fixture)
        const visible = filters.filter(f => !f.hidden)
        expect(visible.map(f => [f.tag as string, f.statRef, f.disabled]))
          .toEqual(expectation.visible)
      })
    }

    it('有數值的稀有地圖一律看得到數量 / 稀有度 / 群大小三項', () => {
      // 使用者列的第 3-5 項。放寬 `mapProps()` 的早退之前,沒汙染也沒有更多掉落的
      // 圖一項都不產生 —— 隨機詞綴收起來之後面板會空掉,那是把問題從「太多」
      // 換成「什麼都沒有」。
      const THREE = ['Item Quantity: +#%', 'Item Rarity: +#%', 'Monster Pack Size: +#%']
      const missing: string[] = []
      let checked = 0
      for (const fixture of Object.keys(MAPS)) {
        const item = loadItem(fixture)
        // ⚠ 「有沒有這三項數值」要問**解析出來的物品**,不能問「有沒有產生 filter」——
        //   後者正是這條測試要驗的東西,拿它當跳過條件,規則被改回早退時整條會
        //   靜靜跳過所有樣本然後通過(實測過:突變後這條原本是綠的)。
        //   未鑑定的圖沒有這三項數值,本來就不該產生。
        if (item.areaItemQuantity == null) continue
        checked += 1
        const visible = createExactStatFilters(item, item.statsByType, { searchStatRange: 10 })
          .filter(f => !f.hidden).map(f => f.statRef)
        missing.push(...THREE
          .filter(ref => !visible.includes(ref))
          .map(ref => `${fixture}: ${ref}`))
      }
      // 一件都沒掃到的話上面那圈是空轉
      expect(checked).toBeGreaterThan(0)
      expect(missing).toEqual([])
    })

    it('沒有更多掉落的圖,面板不會是空的', () => {
      const filters = loadFilters('map-t16-no-more-drops')
      expect(filters.filter(f => !f.hidden).length).toBeGreaterThan(0)
      // 而且隨機詞綴確實有被收起來 —— 否則「不是空的」是因為根本沒隱藏
      expect(filters.filter(f => f.hidden).length).toBeGreaterThan(0)
    })

    it('物品稀有度的預設勾選狀態由「有沒有更多掉落」決定', () => {
      // 這是上游刻意的行為,不是漏勾:賣掉落量的圖不該拿稀有度當條件去篩結果。
      // 使用者的截圖也是這樣(數量與群大小有勾、稀有度 30% 沒勾)。
      const rarityOf = (fixture: string) =>
        loadFilters(fixture).find(f => f.statRef === 'Item Rarity: +#%')
      const withMoreDrops = rarityOf('map-t165-annotated-01')
      const withoutMoreDrops = rarityOf('map-t16-no-more-drops')
      expect(withMoreDrops, 'map-t165-annotated-01 應該有物品稀有度').toBeDefined()
      expect(withoutMoreDrops, 'map-t16-no-more-drops 應該有物品稀有度').toBeDefined()
      expect(withMoreDrops!.disabled, '有更多掉落 → 不勾').toBe(true)
      expect(withoutMoreDrops!.disabled, '沒有更多掉落 → 勾').toBe(false)
    })

    it('開創者的記憶不但看得見,而且是勾選的', () => {
      const filters = loadFilters('map-t165-annotated-01')
      const originator = filters.find(f =>
        f.statRef === "Area is Influenced by the Originator's Memories")
      expect(originator, '這件 T16.5 樣本應該帶開創者的記憶').toBeDefined()
      expect(originator!.hidden).toBeUndefined()
      expect(originator!.disabled).toBe(false)
    })
  })

  describe('隨機詞綴被收進「已隱藏」', () => {
    for (const [fixture, expectation] of Object.entries(MAPS)) {
      it(`${fixture} 收起 ${expectation.hidden} 條`, () => {
        const filters = loadFilters(fixture)
        const hidden = filters.filter(f => f.hidden)
        expect(hidden.length).toBe(expectation.hidden)
        // 全部都要是這次新增的理由,不能混進別的(混進去代表判定跑到別的分支了)
        expect(hidden.map(f => f.hidden)).toEqual(hidden.map(() => HIDE_REASON))
        // 被收起來的一定是隨機詞綴,不會是產出屬性或固定詞綴
        expect(hidden.map(f => f.tag as string)).toEqual(hidden.map(() => 'explicit'))
      })
    }

    it('至少有一件樣本真的收到東西', () => {
      // 上面那圈若期望值全是 0 就等於沒測到隱藏
      const total = Object.values(MAPS).reduce((n, e) => n + e.hidden, 0)
      expect(total).toBeGreaterThan(0)
    })
  })

  describe('不變量:被隱藏的條件不會偷偷送出去', () => {
    for (const fixture of Object.keys(MAPS)) {
      it(fixture, () => {
        const filters = loadFilters(fixture)
        const sneaky = filters.filter(f => f.hidden && !f.disabled)
        // 隱藏卻仍勾選 = 看不見的查詢條件。使用者搜不到東西也看不出是哪一條在擋。
        expect(sneaky.map(f => f.statRef)).toEqual([])
      })
    }
  })

  describe('範圍:不得外洩到地圖以外的物品', () => {
    for (const { fixture, exact, ui } of NON_MAP_GOLDEN) {
      it(`${fixture} 的 exact 路徑逐項不變`, () => {
        const text = fs.readFileSync(path.join(SAMPLES_DIR, `${fixture}.txt`), 'utf8')
        const result = parseClipboard(text)
        if (result.isErr()) throw new Error(`${fixture} 解析失敗:${result.error}`)
        expect(shape(createExactStatFilters(
          result.value, result.value.statsByType, { searchStatRange: 10 }))).toEqual(exact)
      })

      it(`${fixture} 的 pseudo 路徑逐項不變`, () => {
        const text = fs.readFileSync(path.join(SAMPLES_DIR, `${fixture}.txt`), 'utf8')
        const result = parseClipboard(text)
        if (result.isErr()) throw new Error(`${fixture} 解析失敗:${result.error}`)
        expect(shape(initUiModFilters(result.value, { searchStatRange: 10 })
          .filter((f): f is StatFilter => !f.group))).toEqual(ui)
      })
    }

    it('地圖以外的樣本一條都不帶地圖的隱藏理由', () => {
      // 既有 fixture 也一起掃:傳奇鞋子、最後通牒雕刻、浸血碑器
      const others = [
        path.resolve(__dirname, 'fixtures/cmn-Hant/boots-unique-vestigial-01.txt'),
        path.resolve(__dirname, 'fixtures/cmn-Hant/ultimatum-01.txt'),
        path.resolve(__dirname, 'fixtures/cmn-Hant/blood-filled-vessel-01.txt'),
        path.join(SAMPLES_DIR, 'boots-rare-01.txt'),
        path.join(SAMPLES_DIR, 'idol-rare-01.txt')
      ]
      let checked = 0
      const leaked: string[] = []
      for (const file of others) {
        const result = parseClipboard(fs.readFileSync(file, 'utf8'))
        if (result.isErr()) throw new Error(`${path.basename(file)} 解析失敗:${result.error}`)
        const item = result.value
        // 上游把篩選器改成 FilterOrGroup[];這裡只看單條篩選器,群組(傭兵技能)不在地圖的範圍內
        const filters = [
          ...createExactStatFilters(item, item.statsByType, { searchStatRange: 10 }),
          ...initUiModFilters(item, { searchStatRange: 10 })
        ].filter((f): f is StatFilter => !f.group)
        checked += filters.length
        leaked.push(...filters
          .filter(f => f.hidden === HIDE_REASON)
          .map(f => `${path.basename(file)}: ${f.statRef}`))
      }
      // 「掃了 0 條」也會讓上面那個斷言恆真
      expect(checked).toBeGreaterThan(0)
      expect(leaked).toEqual([])
    })
  })

  it('新的隱藏理由在 en 與 cmn-Hant 都有翻譯', () => {
    // 缺鍵不會報錯,vue-i18n 會安靜地把鍵本身印在畫面上
    for (const locale of ['en', 'cmn-Hant']) {
      const i18n = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, locale, 'app_i18n.json'), 'utf8'))
      const text = i18n.filters?.hide_map_random_mod
      expect(typeof text, `${locale} 缺少 ${HIDE_REASON}`).toBe('string')
      expect(String(text).length).toBeGreaterThan(0)
    }
  })
})
