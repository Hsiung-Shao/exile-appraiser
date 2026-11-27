import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { init } from '@/assets/data'
import { tryParseTranslation } from '@/parser/stat-translations'
import { ARMOUR, HEIST_EQUIPMENT, WEAPON, type ItemCategory } from '@/parser/meta'
import type { ModifierType } from '@/parser/modifiers'

/**
 * 全量逐條往返:stats.ndjson 每一條詞綴的每一個寫法(string 與進階寫法、含 superseded),
 * 數值代入後丟回真的詞綴解析(`tryParseTranslation`),對每一種交易站 id 類型都要:
 * 1. 解析得到(unparsed = 認不得)
 * 2. 解析回同一條詞綴(other = 變成別條)
 * 3. 送出的 id 只屬於這條詞綴(mixed = 混進別條詞綴的 id,2026-11-27「配置 守護者」連守林人一起查);
 *    flag-merge / percent-merge 群組的同組 id 是設計(兩個 stat 一起送),不算
 * 兩個語系都跑。遊戲本身同字的詞綴(GGPK 兩個 stat 同一句,例:魔力恢復率、怪物擊中時獲得耐力球)
 * 解析器分不出來、兩個 id 都送,鎖在 `docs/stat-roundtrip-gaps.json`,**只能變少**;
 * 修好後 `UPDATE_FIXTURES=1` 重寫並 review 差異。pseudo id 不從物品解析,不測。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.resolve(HERE, '../../data/poe1')
const GAPS = path.join(HERE, 'docs/stat-roundtrip-gaps.json')
type Lang = 'en' | 'cmn-Hant'

interface Row { resolve?: { strat: string, test?: Array<string | null> }, stats?: Stat[], ref?: string, matchers?: Matcher[], trade?: { ids: Record<string, string[]> } }
interface Stat { ref: string, matchers: Matcher[], trade: { ids: Record<string, string[]> } }
interface Matcher { string: string, advanced?: string, superseded?: boolean }

const rowsOf = (lang: Lang): Row[] => fs.readFileSync(path.join(DATA, lang, 'stats.ndjson'), 'utf8')
  .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l) as Row)
const bare = (id: string) => id.replace(/^\{[^}]*\}/, '')
/** select 群組的 test 值 → 一個真的物品類別 */
const CATEGORY: Record<string, ItemCategory> = { WEAPON: [...WEAPON][0], ARMOUR: [...ARMOUR][0], HEIST_EQUIPMENT: [...HEIST_EQUIPMENT][0] }
const categoryOf = (test: string | null | undefined) => test == null ? undefined : (CATEGORY[test] ?? test as ItemCategory)

/** 一個語系逐條跑完,回傳缺口 `語系|類型|ref|寫法` → 原因 */
async function sweep (lang: Lang): Promise<{ gaps: Record<string, string>, checked: number }> {
  await init(lang)
  const rows = rowsOf(lang)
  // id → 擁有它的 ref(讀檔另存一份:解析器會把 trivial-merge 的 id 併進記憶體裡的 stat)
  const owners = new Map<string, Set<string>>()
  for (const row of rows) {
    for (const s of row.stats ?? [row as Stat]) {
      for (const id of Object.values(s.trade?.ids ?? {}).flat()) (owners.get(bare(id)) ?? owners.set(bare(id), new Set()).get(bare(id))!).add(s.ref)
    }
  }
  const gaps: Record<string, string> = {}
  let checked = 0
  for (const row of rows) {
    const stats = row.stats ?? [row as Stat]
    const mates = /flag-merge|percent-merge/.test(row.resolve?.strat ?? '') ? new Set(stats.map(s => s.ref)) : new Set<string>()
    stats.forEach((s, i) => {
      if (!s.matchers) return
      const category = row.resolve?.strat === 'select' ? categoryOf(row.resolve.test?.[i]) : undefined
      for (const type of Object.keys(s.trade?.ids ?? {}).filter(t => t !== 'pseudo')) {
        // 有進階寫法的只索引進階寫法(解析器吃進階複製格式;make-index-files),帶「(...)」的另收無標記句
        for (const text of s.matchers.flatMap(m => m.advanced ? [m.advanced, ...m.advanced.includes('(...)') ? [m.string] : []] : [m.string])) {
          checked++
          const key = `${lang}|${type}|${s.ref}|${text}`
          const got = tryParseTranslation({ string: text.replace(/#/g, '13'), unscalable: false }, type as ModifierType, category)
          if (!got) { gaps[key] = 'unparsed'; continue }
          if (got.stat.ref !== s.ref) { gaps[key] = `other: ${got.stat.ref}`; continue }
          // 送了這條詞綴自己沒有的 id(同一個 id 掛在好幾條詞綴上不算)
          const foreign = new Set((got.stat.trade.ids[type] ?? []).map(bare).filter(id => !owners.get(id)?.has(s.ref))
            .flatMap(id => [...(owners.get(id) ?? [])]).filter(r => !mates.has(r)))
          if (foreign.size) gaps[key] = `mixed: ${[...foreign].sort().join(' ; ')}`
        }
      }
    })
  }
  return { gaps, checked }
}

describe('全量逐條往返:每條詞綴的每個寫法都解析回自己、只送自己的 id', () => {
  const found: Record<string, string> = {}
  for (const lang of ['en', 'cmn-Hant'] as const) {
    it(`${lang} 逐條跑完`, async () => {
      const { gaps, checked } = await sweep(lang)
      Object.assign(found, gaps)
      expect(checked).toBeGreaterThan(10000)
    })
  }

  it('缺口不超出已知清單(只能變少)', async () => {
    // 單獨跑這一條(-t)時自己掃,不靠前兩條填 found(否則 UPDATE_FIXTURES 會寫出空清單)
    if (!Object.keys(found).length) for (const lang of ['en', 'cmn-Hant'] as const) Object.assign(found, (await sweep(lang)).gaps)
    if (process.env.UPDATE_FIXTURES) fs.writeFileSync(GAPS, JSON.stringify(Object.fromEntries(Object.entries(found).sort()), null, 1) + '\n')
    const known = JSON.parse(fs.readFileSync(GAPS, 'utf8')) as Record<string, string>
    const fresh = Object.entries(found).filter(([k, v]) => known[k] !== v)
    expect(fresh, '清單外的新缺口').toEqual([])
  })

  it('配置 守護者 只查守護者(GitHub 回報 2026-11-27:貴族的守護者禁忌珠寶混進守林人)', async () => {
    await init('cmn-Hant')
    for (const [line, id] of [['若禁忌血肉上有符合的詞綴，配置 守護者', 'explicit.stat_1190333629|30919'], ['若禁忌烈焰上有符合的詞綴，配置 守護者', 'explicit.stat_2460506030|30919']]) {
      expect(tryParseTranslation({ string: line, unscalable: false }, 'explicit' as ModifierType, undefined)?.stat.trade.ids.explicit).toEqual([id])
    }
  })
})
