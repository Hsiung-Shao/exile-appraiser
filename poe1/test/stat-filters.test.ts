import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang, stat } from '@/assets/data'
import { findAndResolveByRef } from '@/web/price-check/filters/pseudo/utils'
import { ModifierType } from '@/parser/modifiers'
import { ItemCategory } from '@/parser'
import { createPresets } from '@/web/price-check/filters/create-presets'
import { createTradeRequest } from '@/web/price-check/trade/pathofexile-trade'
import { FilterTag, type FilterPreset, type FilterGroup, type FilterOrGroup, type StatFilter } from '@/web/price-check/filters/interfaces'
import type { ParsedItem } from '@/parser/ParsedItem'
import { fixtureLanguages, listFixtures, runFixture, type Fixture } from './helpers/fixture-harness'

/**
 * 篩選器層的回歸網。
 *
 * ## 為什麼要有這一層
 *
 * `parser-fixtures.test.ts` 只跑到「剪貼簿文字 → ParsedItem」為止。實際發生過的
 * 事故是:解析結果完全正確,**壞在下一層** —— `calculatedStatToFilter` 直接寫
 *
 *     tradeId: stat.trade.ids[type]
 *
 * 沒有 `type` 對應的 id 時它是 `undefined`,而 `FilterModifier.vue` 與
 * `pathofexile-trade.ts` 都無條件取 `filter.tradeId[0]`。結果是 Vue 在算繪時丟
 * TypeError,**整個查價視窗變白畫面** —— 比原本那條詞綴查不到還糟。
 *
 * 當時 fixtures 全綠、`vue-tsc` 過、`eslint` 過,因為這一層沒有任何測試。
 *
 * ## 這裡守的不變式
 *
 * 1. **每個產生出來的篩選器都必須有非空的 `tradeId`。** 這不是防禦性寫法而是
 *    真正的不變式:解析器在 `tryParseTranslation` 就用
 *    `!(modType in found.stat.trade.ids)` 擋掉了沒有對應 id 的詞綴,所以能走到
 *    篩選器層的每一條理論上都有 id。斷言它,就能讓「有人繞過那道守門」或
 *    「某層事後改了 `type`」當場紅掉,而不是等使用者看到白畫面。
 * 2. **送給交易站的查詢裡不能有 `undefined` 的 id。** 這是同一件事在出口端的
 *    投影 —— 就算前面漏了,這裡也擋得住。
 *
 * ⚠ 走 `createPresets` 而不是直接呼叫 `createExactStatFilters` / `initUiModFilters`:
 *   哪一個物品走哪一條路徑是 `createPresets` 決定的,直接呼叫等於自己重寫一份
 *   分派邏輯,那份會跟本尊漂移,而測試不會知道。
 */

/** 與 `CheckedItem.vue` 實際傳的一致;`searchStatRange` 取預設值 10。 */
const PRESET_OPTS = {
  league: 'Standard',
  currency: null,
  collapseListings: 'api' as const,
  activateStockFilter: false,
  searchStatRange: 10,
  useEn: false,
  merchantOnly: false
}

/**
 * 上游 3.29.103 起 `preset.stats` 是 `FilterOrGroup[]`:傭兵技能等會包成群組
 * (`meta` 是技能本身、`stats` 是底下的輔助)。逐條斷言要把群組攤平,
 * 否則群組裡的篩選器一條都不會被檢查到。
 */
function flatStats (stats: FilterOrGroup[]): StatFilter[] {
  return stats.flatMap(s => s.group ? [s.meta, ...s.stats] : [s])
}

interface Case {
  fixture: Fixture
  item: ParsedItem
  presets: FilterPreset[]
}

const LANGUAGES = fixtureLanguages()
const cases = new Map<string, Case[]>()
/** 連篩選器都建不出來的樣本。⚠ 這些**不會**出現在 `cases` 裡,所以必須單獨斷言。 */
const crashes = new Map<string, string[]>()

beforeAll(async () => {
  await init(LANGUAGES[0] ?? 'en')
  for (const language of LANGUAGES) {
    // ⚠ 兩個語系的資料集不能同時載入(`assets/data/index.ts` 用模組層級的全域變數),
    //   所以逐一切換、跑完一個才換下一個 —— 與 parser-fixtures 同一個理由。
    await loadForLang(language)
    const built: Case[] = []
    const failed: string[] = []
    for (const fixture of await listFixtures(language)) {
      const outcome = runFixture(fixture)
      if (outcome.kind !== 'parsed') continue
      // ⚠ 逐件捕捉,不讓例外往 beforeAll 外面跑。一件炸掉就讓整個檔的斷言全部
      //   skip 掉的話,畫面上是「15 skipped」而不是「哪一件壞了」—— 回歸網要能
      //   指出兇手,不是集體停擺。
      try {
        built.push({
          fixture,
          item: outcome.item,
          presets: createPresets(outcome.item, PRESET_OPTS).presets
        })
      } catch (err) {
        failed.push(`${fixture.name}: ${(err as Error).stack ?? String(err)}`)
      }
    }
    cases.set(language, built)
    crashes.set(language, failed)
  }
}, 180_000)

function describeFilter (c: Case, preset: FilterPreset, filter: StatFilter): string {
  return `${c.fixture.language}/${c.fixture.name} [${preset.id}] ${filter.statRef}(tag=${filter.tag})`
}

describe('篩選器層覆蓋範圍', () => {
  it('有語系可測', () => {
    // 沒有這一項的話,LANGUAGES 空掉時下面每個 describe 都不會產生,
    // 測試會「全部通過」—— 那正是回歸網最危險的失效方式。
    expect(LANGUAGES.length, '找不到任何 fixture 語系目錄').toBeGreaterThan(0)
  })
})

for (const language of LANGUAGES) {
  describe(`stat filters:${language}`, () => {
    const all = (): Case[] => {
      const value = cases.get(language)
      if (value === undefined) throw new Error(`${language} 尚未建立篩選器`)
      return value
    }

    it('這個語系有可用的樣本', () => {
      expect(all().length).toBeGreaterThan(0)
    })

    it('每件樣本都建得出篩選器', () => {
      const failed = crashes.get(language) ?? []
      expect(
        failed.map(f => f.split('\n')[0]),
        failed.length === 0 ? '' : `以下樣本在建篩選器時丟例外:\n${failed.join('\n\n')}`
      ).toEqual([])
    })

    it('每個篩選器都有非空的 tradeId', () => {
      const bad: string[] = []
      for (const c of all()) {
        for (const preset of c.presets) {
          for (const filter of flatStats(preset.stats)) {
            const id = filter.tradeId
            if (!Array.isArray(id)) {
              bad.push(`${describeFilter(c, preset, filter)}:tradeId 不是陣列(${String(id)})`)
            } else if (id.length === 0) {
              bad.push(`${describeFilter(c, preset, filter)}:tradeId 是空陣列`)
            } else if (id.some(one => typeof one !== 'string' || one.length === 0)) {
              bad.push(`${describeFilter(c, preset, filter)}:tradeId 含空值 ${JSON.stringify(id)}`)
            }
          }
        }
      }
      expect(
        bad,
        bad.length === 0
          ? ''
          : `以下 ${bad.length} 個篩選器沒有可送出的交易站 id,` +
            `畫面上會是 TypeError 白畫面:\n  ` + bad.join('\n  ')
      ).toEqual([])
    })

    it('送出的查詢裡沒有空的 stat id', () => {
      const bad: string[] = []
      for (const c of all()) {
        for (const preset of c.presets) {
          let request: ReturnType<typeof createTradeRequest>
          try {
            request = createTradeRequest(preset.filters, preset.stats)
          } catch (err) {
            bad.push(`${c.fixture.language}/${c.fixture.name} [${preset.id}] 組裝查詢就丟例外:${String(err)}`)
            continue
          }
          for (const group of request.query.stats) {
            for (const one of group.filters) {
              if (typeof one.id !== 'string' || one.id.length === 0) {
                bad.push(`${c.fixture.language}/${c.fixture.name} [${preset.id}] 查詢含空 id:${JSON.stringify(one)}`)
              }
            }
          }
        }
      }
      expect(bad, bad.join('\n  ')).toEqual([])
    })

    it('沒有勾選中的篩選器是隱藏的', () => {
      // 隱藏又勾選 = 看不見的查詢條件。使用者查不到東西,而畫面上看不出是哪一條在擋
      // —— `create-stat-filters.ts` 處理稀有地圖時就特別註明過這個陷阱。
      const bad: string[] = []
      for (const c of all()) {
        for (const preset of c.presets) {
          for (const filter of flatStats(preset.stats)) {
            if (filter.hidden && !filter.disabled) {
              bad.push(`${describeFilter(c, preset, filter)}:hidden=${filter.hidden} 卻是勾選狀態`)
            }
          }
        }
      }
      expect(bad, bad.join('\n  ')).toEqual([])
    })
  })
}

describe('傭兵契約書(Mercenary Warrant)', () => {
  /**
   * 兩層對接疊在一起,少一層都會撈回一堆不相干的契約書:
   *   1. 流派 → 交易站的內部 type id(本 fork 的 `gen-disc-variants` 變體列,
   *      `風暴之手` → `ElementalWitchLightning`)。上游不送這一層,只送「傭兵契約書」。
   *   2. 技能/輔助 → `mercenary.skill_*` / `mercenary.support_*`(上游 3.29.103 的實作,
   *      主技能預設勾選、副技能與輔助預設不勾)。
   * 樣本是使用者實際複製的契約書(維拉．猜疑者 / 風暴之手 / 六段技能)。
   */
  const WARRANT = 'mercenary-warrant-01'
  const PRIMARY_IDS = ['mercenary.skill_41484', 'mercenary.skill_33661'] // 導電、咒符之力

  function warrantCase (): Case {
    const found = (cases.get('cmn-Hant') ?? []).find(c => c.fixture.name === WARRANT)
    expect(found, `找不到 fixture ${WARRANT} —— 它是傭兵契約書唯一的樣本,不可移除`).toBeDefined()
    return found!
  }

  it('流派會送成交易站的內部 type id,而不是顯示名', () => {
    const c = warrantCase()
    expect(c.item.mercenaryBuild?.refName, '上游的流派查表').toBe('Stormhand')
    expect(c.item.info.tradeType, '本 fork 的變體列').toBe('ElementalWitchLightning')

    const types = c.presets.map(preset =>
      createTradeRequest(preset.filters, preset.stats).query.type)
    expect(types.length).toBeGreaterThan(0)
    for (const type of types) {
      expect(type).toEqual({ discriminator: 'mercenary_warrant', option: 'ElementalWitchLightning' })
    }
  })

  it('六段技能全部解析出來,沒有未知詞綴', () => {
    const c = warrantCase()
    expect(c.item.unknownModifiers).toEqual([])
    expect(c.item.mercenarySkills?.map(group => group[0].stat.ref)).toEqual([
      'Conductivity', 'Sigil of Power', 'Spark', 'Greater Stormcall', 'Purity of Lightning', 'Wrath'
    ])
    // 輔助帶階層,而且是剪貼簿寫法「(階層:N)」對上 `advanced` matcher 的結果
    expect(c.item.mercenarySkills?.[2].slice(1).map(s => `${s.stat.ref}@${s.stat.mercenary?.tier}`)).toEqual([
      'Greater Multiple Projectiles@3', 'Elemental Focus@2', 'Lightning Penetration@2', 'Greater Faster Projectiles@3'
    ])
  })

  it('主技能預設勾選並進入 and 群組;輔助以群組呈現、預設不勾', () => {
    const c = warrantCase()
    const preset = c.presets[0]
    const request = createTradeRequest(preset.filters, preset.stats)
    const sentIds = request.query.stats
      .filter(group => !group.disabled)
      .flatMap(group => group.filters.map(f => f.id))
    for (const id of PRIMARY_IDS) {
      expect(sentIds, `主技能 ${id} 沒有送出`).toContain(id)
    }

    const groups = preset.stats.filter((s): s is FilterGroup => s.group === 'mercenary')
    expect(groups.length, '每個帶輔助的技能各一個群組(導電、咒符之力、電球、高階風暴呼喚)').toBe(4)
    const supportIds = groups.flatMap(g => g.stats.filter(st => !st.not).flatMap(st => st.tradeId))
    expect(supportIds).toContain('mercenary.support_53342') // 增加效果範圍(階層:2)
    expect(groups.flatMap(g => g.stats).filter(st => !st.not).every(st => st.disabled), '輔助預設不勾').toBe(true)
  })
})

describe('傭兵契約書(第二件實物:動能師,遊戲內複製)', () => {
  /**
   * 使用者的第二張契約書(黎榭爾．第五人 / 動能師 / 六段技能),遊戲內 Ctrl+C 的原文。
   * 釘住的重點:技能名帶全形間隔號(「力量爆破．聚集」)也查得到、流派 type 對接、
   * 以及 BUILD_RULES 對動能師的 brick 技能(Kinetic Bolt)預設進「以下皆無」群組
   * —— 而依本 fork 的規則,群組只送勾選的那一條。
   */
  const WARRANT = 'mercenary-warrant-02'

  function warrantCase (): Case {
    const found = (cases.get('cmn-Hant') ?? []).find(c => c.fixture.name === WARRANT)
    expect(found, `找不到 fixture ${WARRANT}`).toBeDefined()
    return found!
  }

  it('流派、type id 與六段技能全部認出', () => {
    const c = warrantCase()
    expect(c.item.mercenaryBuild?.refName).toBe('Kineticist')
    expect(c.item.info.tradeType).toBe('MiscScionWandAttacks')
    expect(c.item.unknownModifiers).toEqual([])
    expect(c.item.mercenarySkills?.map(group => group[0].stat.ref)).toEqual([
      'Elemental Weakness', 'Flame Wall', 'Kinetic Blast of Clustering', 'Kinetic Rain of Impact', 'Haste', 'Flame Dash'
    ])
  })

  it('預設查詢:brick 技能是「以下皆無」群組裡唯一送出的條目,總 filter 數很小', () => {
    const c = warrantCase()
    const preset = c.presets[0]
    const request = createTradeRequest(preset.filters, preset.stats)
    expect(request.query.type).toEqual({ discriminator: 'mercenary_warrant', option: 'MiscScionWandAttacks' })

    const notGroups = request.query.stats.filter(g => g.type === 'not')
    expect(notGroups.length, '只有一個 not 群組').toBe(1)
    const kineticBolt = stat('Kinetic Bolt')
    const bolt = findAndResolveByRef(kineticBolt, ModifierType.Pseudo, ItemCategory.MercenaryWarrant)
    expect(notGroups[0].filters.map(f => f.id)).toEqual(bolt.trade.ids[ModifierType.Pseudo])

    const total = request.query.stats.filter(g => !g.disabled).reduce((n, g) => n + g.filters.length, 0)
    expect(total).toBeLessThanOrEqual(12)
  })
})

describe('殘存(Vestigial)固定屬性', () => {
  /**
   * 3.29 的殘存機制把另一件同部位傳奇的一條詞綴複製過來,而**複製後以固定屬性
   * (implicit)呈現**。所以同一條詞綴在原主身上是 `explicit.stat_N`、被賦予後是
   * `implicit.stat_N`,兩個 id 都必須在資料集裡。
   *
   * 這一項釘住的是實際踩過的坑:當時只有 explicit 存在,於是
   *   - 修之前:解析器把整條詞綴丟進 unknownModifiers,篩選清單裡看不到它;
   *   - 修錯之後(讓它退回用 explicit id):篩選器層拿不到 implicit id -> 白畫面。
   * 正解是補資料,不是在任何一層做退讓。
   */
  const BOOTS = 'boots-unique-vestigial-02'
  const STAT_REF = 'Immune to Elemental Ailments while affected by Glorious Madness'

  it('殘存詞綴會產生一個預設勾選、帶 implicit id 的篩選器', () => {
    const found = (cases.get('cmn-Hant') ?? []).find(c => c.fixture.name === BOOTS)
    expect(found, `找不到 fixture ${BOOTS} —— 它是這個機制唯一的樣本,不可移除`).toBeDefined()

    const filters = found!.presets.flatMap(preset => flatStats(preset.stats))
    const vestigial = filters.filter(f => f.tag === FilterTag.Vestigial)

    expect(
      vestigial.map(f => f.statRef),
      '殘存詞綴沒有被標成 Vestigial'
    ).toContain(STAT_REF)

    const target = vestigial.find(f => f.statRef === STAT_REF)!
    expect(target.tradeId, '殘存詞綴要送的是 implicit id,不是 explicit')
      .toEqual(['implicit.stat_1065479853'])
    expect(target.disabled, '殘存詞綴決定這件裝備值不值錢,預設要勾選').toBe(false)
    expect(target.hidden, '殘存詞綴不該被藏起來').toBeUndefined()
  })

  it('這件鞋子沒有任何未知詞綴', () => {
    const found = (cases.get('cmn-Hant') ?? []).find(c => c.fixture.name === BOOTS)
    expect(found!.item.unknownModifiers).toEqual([])
  })
})

describe('同一條無數值詞綴出現兩次', () => {
  /**
   * `map-rare-01` 這張稀有地圖把「區域受到開創者的記憶影響」列了**兩次**,而它是
   * 一條沒有數值的旗標詞綴。
   *
   * 修之前:`statSourcesTotal` 把兩個沒有 `contributes` 的來源各補成 1 再相加,
   * 憑空生出 `{ value: 2 }`;`translateStatWithRoll` 看到有 roll 就去讀每個來源的
   * `stat.roll!.dp`,而那些來源根本沒有 roll -> TypeError,查價視窗與地圖檢查
   * 小工具雙雙掛掉。
   *
   * 這一項同時釘住兩件事:**不再丟例外**,而且**不要生出那個假的 2** ——
   * 只修例外的話,畫面上會多一個「區域受到開創者的記憶影響 = 2」的數值條件,
   * 送出去必定查無結果,而且看起來像是正常的篩選器。
   */
  const MAP = 'map-rare-01'
  const STAT_REF = "Area is Influenced by the Originator's Memories"

  it('產生的是「有沒有這條」的篩選器,不是憑空生出的數值', () => {
    const found = (cases.get('cmn-Hant') ?? []).find(c => c.fixture.name === MAP)
    expect(found, `找不到 fixture ${MAP}`).toBeDefined()

    // 前提:這件樣本真的把同一條詞綴列了兩次,而且兩次都沒有數值。
    // 少了這段,哪天樣本被換成只列一次的版本,下面的斷言會**照樣通過**卻什麼都沒測到。
    const calc = found!.item.statsByType.find(c => c.stat.ref === STAT_REF)
    expect(calc, '樣本不再包含這條詞綴,這個回歸測試已失去意義').toBeDefined()
    expect(calc!.sources.length, '樣本不再是「同一條詞綴出現兩次」').toBe(2)
    expect(calc!.sources.every(s => s.contributes === undefined), '樣本的來源變成有數值了').toBe(true)

    const filters = found!.presets.flatMap(preset => flatStats(preset.stats))
      .filter(f => f.statRef === STAT_REF)
    expect(filters.length, '這條詞綴沒有產生篩選器').toBeGreaterThan(0)
    for (const filter of filters) {
      expect(filter.roll, `${STAT_REF} 不該有數值範圍`).toBeUndefined()
      expect(filter.option, `${STAT_REF} 不該有選項值`).toBeUndefined()
    }
  })
})
