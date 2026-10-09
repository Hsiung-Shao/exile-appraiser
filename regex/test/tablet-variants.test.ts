// 碑牌詞綴(2026-10-09,對照 poe2db 八種碑牌 ModifiersCalc 補缺漏):
//   ① 同一條詞綴依 roll 值印不同寫法(值 1「地圖內含有額外的一個保險箱」、值 2「地圖內含有額外的2個保險箱」;
//      「地圖中首名出土…」/「地圖中前2名出土…」)。PobTools 產生器把主寫法以外的寫法放在 `altZh` / `altEn`
//      (同時進 hidden,只能否決別條的片段);`gen.ts` 只拿主寫法提片段,所以這裡守門:單選該列產生的字串
//      必須同時命中主寫法與每一種其他寫法。
//   ② `default` 標籤的詞綴每種碑牌都會出 → 歸「通用」(原本精髓 / 保險箱 / 神殿被歸到總督)。
// 資料同步後數字變了要看過再改(新賽季、GGPK 重抽)。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Mode } from '../src/gen'
import { buildCorpus, type RegexLang } from '../src/data'
import { loadAllRegexPages } from '../src/node'
import { combine } from '../src/combine'
import { classTermOf } from '../src/class-term'

interface RawEntry { id: string, zh: string[], en: string[], altZh?: string[], altEn?: string[] }
interface RawPage { id: string, entries?: RawEntry[] }

const raw = JSON.parse(readFileSync(join(__dirname, '../../data/regex/regex_poe2.json'), 'utf8')) as { pages: RawPage[] }
const { pages } = loadAllRegexPages('poe2')
const page = (id: string) => pages.find(p => p.game === 'poe2' && p.id === id)!

/** 遊戲搜尋列不分大小寫;片段已排除正則特殊字元,只會帶 ^ / $ 錨點 */
const hits = (tokens: readonly string[], line: string): boolean =>
  tokens.some(t => new RegExp(t, 'i').test(line))

const ROLLS = [1, 2, 10]

/**
 * 無法單獨指定的(gen 據實回報 unresolved,不給只中一半的字串)。英文總督碑牌「Map contains an additional
 * Azmeri Spirit」/「# additional Azmeri Spirits」與通用「Map contains # additional Azmeri Spirit」幾乎同字,
 * C++ 報告在加 alts 之前就把它列為卡住(singly findable 78 / 81)。
 */
const KNOWN_STUCK = new Set(['tablet_mods TowerMapBossAdditionalSpirit en'])

const withAlts = raw.pages.flatMap(p => (p.entries ?? [])
  .filter(e => (e.altZh?.length ?? 0) + (e.altEn?.length ?? 0) > 0)
  .map(e => ({ pageId: p.id, e })))

describe('依 roll 值換寫法的詞綴:單選產生的字串命中每一種寫法', () => {
  it('碑牌頁確實有這類列(守門不是空轉)', () => {
    const tablet = withAlts.filter(x => x.pageId === 'tablet_mods')
    expect(tablet.map(x => x.e.id).sort()).toEqual([
      'TowerAdditionalEssence1', 'TowerAdditionalShrine1', 'TowerAdditionalStrongbox1',
      'TowerBreachAdditionalRares', 'TowerExpeditionAdditionalSentinels', 'TowerExpeditionBuriedStrongboxes',
      'TowerExpeditionFrozenBosses', 'TowerExpeditionUnearthedRares', 'TowerExpeditionVaalRemnants', 'TowerMapAdditionalModifier',
      'TowerMapBossAdditionalSpirit', 'TowerRitualAdditionalReroll'])
    const sentinels = tablet.find(x => x.e.id === 'TowerExpeditionAdditionalSentinels')!.e
    expect(sentinels.zh).toEqual(['地圖中的探險含有1個額外維里西姆守望'])
    expect(sentinels.altZh).toEqual(['地圖中的探險含有#個額外維里西姆守望'])
  })

  for (const { pageId, e } of withAlts) {
    for (const lang of ['zh', 'en'] as RegexLang[]) {
      const alts = (lang === 'zh' ? e.altZh : e.altEn) ?? []
      if (alts.length === 0) continue
      for (const mode of ['any', 'all'] as Mode[]) {
        it(`${pageId} ${e.id} ${lang} ${mode}`, () => {
          const p = page(pageId)
          const idx = p.entries.findIndex(x => x.id === e.id)
          expect(idx).toBeGreaterThanOrEqual(0)
          const c = buildCorpus(p, lang)
          const r = c.build([idx], mode)
          if (KNOWN_STUCK.has(`${pageId} ${e.id} ${lang}`)) {
            expect(r.unresolved).toEqual([idx])
            expect(c.verify([idx], r.query).extra).toEqual([])
            return
          }
          expect(r.unresolved).toEqual([])
          expect(c.verify([idx], r.query).ok).toBe(true)
          // 其他寫法是值 ≥ 2 才印的(值 1 用主寫法),代 1 進去會造出遊戲不會印的行
          const lines = [...(lang === 'zh' ? e.zh : e.en).map(l => [l, ROLLS] as const),
            ...alts.map(l => [l, ROLLS.filter(n => n >= 2)] as const)]
          for (const [line, rolls] of lines) {
            for (const n of rolls) {
              const printed = line.replaceAll('#', String(n))
              expect(hits(r.usedTokens, printed), `${r.query} 要命中「${printed}」`).toBe(true)
            }
          }
        })
      }
    }
  }
})

describe('碑牌頁分組', () => {
  const p = page('tablet_mods')
  const groupOf = (zh: string) => p.groups[p.entries.find(e => e.zh[0] === zh)!.g]

  it('每種碑牌都會出的詞綴歸「通用」', () => {
    for (const zh of ['地圖內含有額外的一個保險箱', '地圖內含有額外的一個神殿', '地圖內含有額外的一個精髓']) {
      expect(groupOf(zh), zh).toBe('通用（輻照）')
    }
    // 只有總督碑牌有「額外的一個阿茲莫里魂靈」(通用那條是「#個額外阿茲莫里魂靈」)
    expect(groupOf('地圖內含有額外的一個阿茲莫里魂靈')).toBe('總督')
  })

  // 2026-10-09 GGPK 重抽(0.5.5.4.2)後:探險補上「炸藥範圍」「瓦爾遺物」= 13,與 poe2db 八頁逐條對過
  it('各組列數(對照 poe2db;資料同步後變了要看過再改)', () => {
    const count: Record<string, number> = {}
    for (const e of p.entries) count[p.groups[e.g]] = (count[p.groups[e.g]] ?? 0) + 1
    expect(count).toEqual({
      '通用（輻照）': 24, 裂痕: 7, 探險: 13, 譫妄: 9, 祭祀: 9, 深淵: 9, 總督: 5, 神廟: 7,
    })
  })
})

describe('物品類型條件:碑牌頁輸出多一段「碑牌」(只會亮碑牌,不誤中珠寶等其他物品)', () => {
  const tablet = page('tablet_mods')
  const waystone = page('waystone_mods')
  const pick = (id: string) => tablet.entries.findIndex(e => e.id === id)
  const picks = [pick('TowerExpeditionExplosionRadius'), pick('TowerExpeditionVaalRemnants')]

  it('八種碑牌的基底名一定含這個字(items.ndjson,兩語)', () => {
    for (const [lang, dir] of [['zh', 'cmn-Hant'], ['en', 'en']] as const) {
      const bases = readFileSync(join(__dirname, `../../data/poe2/${dir}/items.ndjson`), 'utf8').split('\n')
        .filter(l => l.includes('"TowerAugment"')).map(l => JSON.parse(l).name as string)
      expect(bases.length, lang).toBe(8)
      const re = new RegExp(classTermOf(tablet, lang)!, 'i')
      for (const b of bases) expect(re.test(b), `${lang} ${b}`).toBe(true)
    }
  })

  for (const lang of ['zh', 'en'] as RegexLang[]) {
    const term = `"${lang === 'zh' ? '碑牌' : 'tablet'}"`
    for (const mode of ['any', 'all', 'none'] as Mode[]) {
      it(`${lang} ${mode}:單頁 = build 的字串 + ${term}(none 的 ! term 照舊在最後)`, () => {
        const want = buildCorpus(tablet, lang).build(picks, mode).query
        const r = combine({ lang, mode, pages: [{ page: tablet, picks }] })
        expect(r.classTerm).toBe(term)
        expect(r.query).toBe(mode === 'none' ? `${term} ${want}` : `${want} ${term}`)
        expect(r.length).toBe(r.query.length)
      })
    }
    it(`${lang}:碑牌頁 + 換界石頁一起勾 → 不加(否則會擋掉換界石)`, () => {
      const r = combine({ lang, mode: 'any', pages: [{ page: tablet, picks }, { page: waystone, picks: [0] }] })
      expect(r.classTerm).toBeNull()
      expect(r.query.includes(term)).toBe(false)
    })
  }

  it('使用者回報的組合:"圍|個瓦" + 稀有度 → 只會亮碑牌', () => {
    const r = combine({ lang: 'zh', mode: 'any', pages: [{ page: tablet, picks }] })
    expect(r.query).toBe('"圍|個瓦" "碑牌"')
    // 珠寶的「範圍效果」中「圍」,但沒有「碑牌」→ AND 之後不亮
    const jewel = ['稀有度: 稀有', '增加 12% 範圍效果', '藍寶石']
    const tablets = ['稀有度: 稀有', '探險碑牌', '地圖中的探險含有2個瓦爾遺物']
    const lit = (lines: string[]) => r.query.match(/"[^"]*"/g)!.map(t => t.slice(1, -1))
      .every(t => lines.some(l => new RegExp(t, 'i').test(l)))
    expect(lit(jewel)).toBe(false)
    expect(lit(tablets)).toBe(true)
  })

  it('C3 只勾無法單獨指定的詞綴 → 不加物品類型 term(否則只剩「tablet」會亮所有碑牌);卡住 + 正常各一條 → 照加', () => {
    const stuck = pick('TowerMapBossAdditionalSpirit')
    expect(stuck).toBeGreaterThanOrEqual(0)
    const only = combine({ lang: 'en', mode: 'any', pages: [{ page: tablet, picks: [stuck] }] })
    expect(only.perPage[0].fragments).toEqual([])
    expect(only.classTerm).toBeNull()
    expect(only.query).toBe('')
    const mixed = combine({ lang: 'en', mode: 'any', pages: [{ page: tablet, picks: [stuck, picks[0]] }] })
    expect(mixed.classTerm).toBe('"tablet"')
    expect(mixed.query.endsWith(' "tablet"')).toBe(true)
  })

  it('其他頁沒有物品類型條件', () => {
    for (const p of pages) if (p.id !== 'tablet_mods') expect(classTermOf(p, 'zh'), p.id).toBeNull()
  })
})
