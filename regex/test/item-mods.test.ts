// 第 37 步:物品詞綴數值頁(`item_mod_values` / `item_mod_values_poe2`)。
// 片段的組法與唯一性推理見 regex/src/pages/item-mods.ts 檔頭。本檔驗:
//   ① 唯一性(全量,不抽樣):每個可選詞綴 × 兩語言,把片段的數值換成 `[0-9]+`(任何數值條件的超集合),對該語言**全部** stat 模板行
//      (全部類別、含 negate / 固定值 / 偽詞綴、多行拆開)逐行測試;每行的 `#` 依序代入 16 種數值、前面有 / 沒有 `+`。
//      不含片段字面文字的行不可能命中 → 先以字面文字篩(這一步是證明,不是抽樣;篩後的行全部用 RegExp 跑)。
//      只有「與自己文字相同的行」與同一 stat 的非 negate 行(固定值寫法)例外。
//   ② 自身模板逐值:每個詞綴 × 兩語言,輪替一種條件(≥ / ≤ / 區間,門檻由詞綴序號決定)對 0–999 逐值 + 1000 以上,
//      另兩種條件在門檻 ±3、0、999、1000、12345 抽查;前面有 / 沒有 `+` 兩種寫法。常用 10 條三種條件 × 多組門檻全部逐值。
//   ③ 分類純函式、清單篩選、排除統計(數量鎖住:資料同步後數字變了要看過再改)、書籤 / 分享碼往返、合併。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { combine } from '../src/combine'
import { bookmarkApplyOf, bookmarkBodyOf, combineSels, shareStateOf } from '../src/embed'
import { defaultRegexDataDir, loadAllPagesFor, loadItemModData } from '../src/node'
import {
  ITEM_MOD_CATEGORIES, ITEM_MOD_PAGE_IDS, MAX_ANCHOR_TEXT, escapeFragText, filterItemMods, isItemModPageId, itemModCategory, itemModFragment,
  itemModGroupCounts, itemModPage, parseStatsNdjson, type ItemModData, type ItemModEntryData, type ModAnchor, type StatLite
} from '../src/pages'
import { bookmarkQuery } from '../src/quick'
import { decodeShare, encodeShare, resolveState } from '../src/share'
import type { RegexLang, RegexPage } from '../src/data'

const DATA_DIR = path.resolve(defaultRegexDataDir(), '..')
const GAMES = ['poe1', 'poe2'] as const
const LANGS: RegexLang[] = ['zh', 'en']
const LANG_DIR: Record<RegexLang, string> = { zh: 'cmn-Hant', en: 'en' }

const stats = (game: string, lang: RegexLang): StatLite[] =>
  parseStatsNdjson(fs.readFileSync(path.join(DATA_DIR, game, LANG_DIR[lang], 'stats.ndjson'), 'utf8'))

const DATA: Record<string, ItemModData> = { poe1: loadItemModData('poe1'), poe2: loadItemModData('poe2') }

const stripPlus = (s: string): string => s.replace(/\+(?=#)/g, '').trim()

/** 片段的結構版本:數值換成 `[0-9]+`(任何條件的超集合) */
function genericOf (a: ModAnchor): RegExp {
  return new RegExp(`${a.caret ? '^' : ''}${escapeFragText(a.p)}${a.plus ? '\\+?' : ''}[0-9]+${escapeFragText(a.s)}${a.dollar ? '$' : ''}`, 'i')
}

/** 片段字面文字裡不含數字的最長一段(用來篩候選行) */
function filterKey (a: ModAnchor): string {
  const parts = `${a.p}\u0001${a.s}`.split(/[0-9\u0001]+/)
  return parts.reduce((x, y) => (y.length > x.length ? y : x), '').toLowerCase()
}

const VALUES = ['0', '1', '2', '5', '7', '9', '10', '12', '25', '50', '99', '100', '200', '999', '1000', '12345']

/** 一行模板的全部實例(`#` 依序代入同一個數值;有 / 沒有 `+`) */
function instances (line: string): string[] {
  if (!line.includes('#')) return [line]
  const out: string[] = []
  for (const v of VALUES) {
    out.push(line.replace(/#/g, v))
    out.push(line.replace(/\+?#/g, '+' + v))
  }
  return out
}

interface Corpus { lines: string[], lower: string[] }
const CORPUS: Record<string, Corpus> = {}
const SAME: Record<string, Map<string, Set<string>>> = {}
for (const g of GAMES) {
  for (const l of LANGS) {
    const st = stats(g, l)
    const set = new Set<string>()
    for (const s of st) for (const str of s.strings) for (const part of str.split('\n')) { const t = part.trim(); if (t) set.add(t) }
    const lines = [...set]
    CORPUS[`${g}.${l}`] = { lines, lower: lines.map(x => x.toLowerCase()) }
    // 同一個 stat(鍵 = statId|ref)的非 negate 行:命中不算誤中
    const m = new Map<string, Set<string>>()
    for (const s of st) {
      if (!s.statId) continue
      const k = `${s.statId}|${s.ref}`
      const cur = m.get(k) ?? new Set<string>()
      for (const str of s.same) for (const part of str.split('\n')) cur.add(sameKey(part, l))
      m.set(k, cur)
    }
    SAME[`${g}.${l}`] = m
  }
}

/**
 * 「與自己同字」的比較鍵:`#` 前的 `+` 去掉;英文不分大小寫(遊戲搜尋不分大小寫 —— 例如兩個不同 stat 的
 * 「Socketed Gems are supported by Level #…」/「…Supported by…」在物品上就是同一行字,分不出來也不必分)
 */
function sameKey (s: string, l: RegexLang): string {
  const t = stripPlus(s)
  return l === 'en' ? t.toLowerCase() : t
}

const keyOfEntry = (e: ItemModEntryData): string => (e.id.includes('|') ? e.id : `${e.id}|${e.ref}`)
const templateOf = (e: ItemModEntryData, l: RegexLang): string => (l === 'zh' ? e.zh : e.en)

describe('排除統計(資料同步後數字變了要看過再改)', () => {
  it('PoE1 / PoE2 可選詞綴數與排除原因', () => {
    const summary = (d: ItemModData) => ({ itemStats: d.itemStats, entries: d.entries.length, merged: d.merged, excluded: d.excluded })
    expect(summary(DATA.poe1)).toEqual({
      itemStats: 7550,
      // 2026-10-08:假掰(The Adorned)補上遊戲內寫法 → 該條有兩種繁中寫法,改列 multi_form(4786 → 4785、86 → 87)
      entries: 4785,
      merged: 47,
      excluded: { decimal: 149, multi_value: 2129, multi_form: 87, multiline: 142, missing_lang: 0, no_unique: 2, too_long: 209 }
    })
    expect(summary(DATA.poe2)).toEqual({
      itemStats: 1847,
      entries: 1198,
      merged: 0,
      excluded: { decimal: 30, multi_value: 441, multi_form: 135, multiline: 35, missing_lang: 2, no_unique: 0, too_long: 6 }
    })
    for (const g of GAMES) {
      const d = DATA[g]
      const ex = Object.values(d.excluded).reduce((a, b) => a + b, 0)
      // 每個物品詞綴不是收錄、併入同字列,就是有排除原因
      expect(d.entries.length + d.merged + ex).toBe(d.itemStats)
      // 多數值詞綴(「附加 # 至 # 火焰傷害」)不收
      expect(d.samples.multi_value.some(r => /# to # Added .*Damage|# to # .*Damage/i.test(r))).toBe(true)
    }
  })

  it('id 唯一、兩語模板恰好一個 #、P + S 不超過上限', () => {
    for (const g of GAMES) {
      const ids = DATA[g].entries.map(e => e.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const e of DATA[g].entries) {
        for (const l of LANGS) {
          expect((templateOf(e, l).match(/#/g) ?? []).length).toBe(1)
          expect(e.anchors[l].cost).toBeLessThanOrEqual(MAX_ANCHOR_TEXT[l])
        }
      }
    }
  })
})

describe('好讀:預設整行、縮只縮在詞界(協調者裁定 2026-10-04)', () => {
  const isBreak = (c: string | undefined): boolean => c !== undefined && /[\s,，、:：;；。.!！?？()（）「」『』[\]/·]/.test(c)
  it('P 是 # 前文字的尾段且起點在詞界、S 是 # 後文字的前段且終點在詞界;錨點 = 整段;整行沒超過上限就一定是整行', () => {
    const bad: string[] = []
    let full = 0
    let total = 0
    for (const g of GAMES) {
      for (const e of DATA[g].entries) {
        for (const l of LANGS) {
          const a = e.anchors[l]
          const shown = stripPlus(templateOf(e, l))
          const at = shown.indexOf('#')
          const B = shown.slice(0, at)
          const A = shown.slice(at + 1)
          total++
          if (!B.endsWith(a.p) || !A.startsWith(a.s)) { bad.push(`不是模板文字:${e.ref} [${l}]`); continue }
          const pStart = B.length - a.p.length
          if (pStart > 0 && !isBreak(B[pStart - 1])) bad.push(`P 斷在詞中:${e.ref} [${l}] 「${a.p}」`)
          if (a.s.length < A.length && !isBreak(A[a.s.length])) bad.push(`S 斷在詞中:${e.ref} [${l}] 「${a.s}」`)
          if (a.caret && pStart !== 0) bad.push(`^ 但 P 不是整段:${e.ref} [${l}]`)
          if (a.dollar && a.s.length !== A.length) bad.push(`$ 但 S 不是整段:${e.ref} [${l}]`)
          const fullCost = escapeFragText(B).length + escapeFragText(A).length + 2
          if (fullCost <= MAX_ANCHOR_TEXT[l] && !(a.caret && a.dollar)) bad.push(`整行沒超過上限卻縮了:${e.ref} [${l}]`)
          if (a.caret && a.dollar) full++
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
    console.log(`[item-mods] 整行(^…$):${full} / ${total}(詞綴 × 語言)`)
  })
})

describe('① 唯一性:片段(數值任意)不命中該語言任何其他模板行(全量)', () => {
  for (const g of GAMES) {
    for (const l of LANGS) {
      it(`${g} ${l}`, () => {
        const corpus = CORPUS[`${g}.${l}`]
        const same = SAME[`${g}.${l}`]
        let checkedLines = 0
        let checkedStrings = 0
        const bad: string[] = []
        for (const e of DATA[g].entries) {
          const a = e.anchors[l]
          const re = genericOf(a)
          const key = filterKey(a)
          const own = sameKey(templateOf(e, l), l)
          const sameSet = same.get(keyOfEntry(e)) ?? new Set<string>()
          for (let i = 0; i < corpus.lines.length; i++) {
            if (key && !corpus.lower[i].includes(key)) continue
            const line = corpus.lines[i]
            const norm = sameKey(line, l)
            if (norm === own || sameSet.has(norm)) continue
            checkedLines++
            for (const s of instances(line)) {
              checkedStrings++
              if (re.test(s)) { bad.push(`${e.ref} | ${re.source} | ${s}`); break }
            }
          }
          // 自己的模板一定要中(數值任意)
          if (!re.test(templateOf(e, l).replace('#', '12'))) bad.push(`自己不中:${e.ref} | ${re.source}`)
        }
        expect(bad.slice(0, 10)).toEqual([])
        // 篩選後實際以 RegExp 檢查的行數(報告用)
        expect(checkedLines).toBeGreaterThan(0)
        console.log(`[item-mods] ${g} ${l}:${DATA[g].entries.length} 條 × 候選行 ${checkedLines} 行 / ${checkedStrings} 個實例,0 命中`)
      })
    }
  }
})

type Cond = { v: { min?: number, max?: number }, ok: (n: number) => boolean }
const ge = (m: number): Cond => ({ v: { min: m }, ok: n => n >= m })
const le = (m: number): Cond => ({ v: { max: m }, ok: n => n <= m })
const rg = (a: number, b: number): Cond => ({ v: { min: a, max: b }, ok: n => n >= a && n <= b })

/** 實際模板 → 遊戲顯示行(數值 n;withPlus = 數值前加 +) */
function shown (template: string, n: number, withPlus: boolean): string {
  return stripPlus(template).replace('#', (withPlus ? '+' : '') + String(n))
}

function checkValues (e: ItemModEntryData, l: RegexLang, c: Cond, values: Iterable<number>): string | null {
  const f = itemModFragment(e.anchors[l], c.v)
  if (!f) return `沒有片段:${e.ref} ${JSON.stringify(c.v)}`
  const re = new RegExp(f)
  for (const n of values) {
    for (const p of [false, true]) {
      const s = shown(templateOf(e, l), n, p)
      if (re.test(s) !== c.ok(n)) return `${e.ref} [${l}] ${JSON.stringify(c.v)} ${f} 對「${s}」判斷錯`
    }
  }
  return null
}

const ALL_VALUES = [...Array.from({ length: 1000 }, (_, i) => i), 1000, 1001, 1234, 2000, 9999, 12345]

describe('② 自身模板逐值', () => {
  for (const g of GAMES) {
    it(`${g}:每條 × 兩語,輪替一種條件 0–999 逐值 + 另兩種條件邊界抽查`, () => {
      const bad: string[] = []
      let full = 0
      DATA[g].entries.forEach((e, idx) => {
        const m = 1 + ((idx * 37) % 300)
        const conds = [ge(m), le(m), rg(m, m + 1 + ((idx * 13) % 120))]
        for (const l of LANGS) {
          const rot = idx % 3
          const r = checkValues(e, l, conds[rot], ALL_VALUES)
          if (r) bad.push(r)
          full++
          conds.forEach((c, ci) => {
            if (ci === rot) return
            const edge = [0, 1, m - 3, m - 2, m - 1, m, m + 1, m + 2, m + 3, 999, 1000, 12345].filter(n => n >= 0)
            if (c.v.max !== undefined) edge.push(c.v.max - 1, c.v.max, c.v.max + 1)
            const r2 = checkValues(e, l, c, edge)
            if (r2) bad.push(r2)
          })
        }
      })
      expect(bad.slice(0, 10)).toEqual([])
      console.log(`[item-mods] ${g}:${full} 組(詞綴 × 語言)0–999 逐值,另 ${full * 2} 組邊界抽查`)
    })
  }
})

// ---- 常用 10 條 ----

const COMMON: Array<{ ref: string, m: number, zh: string, en: string }> = [
  { ref: '+# to maximum Life', m: 80, zh: '^\\+?([89][0-9]|[1-9][0-9]{2,}) 最大生命($| \\()', en: '^\\+?([89][0-9]|[1-9][0-9]{2,}) to maximum Life($| \\()' },
  { ref: '+#% to Fire Resistance', m: 30, zh: '^\\+?([3-9][0-9]|[1-9][0-9]{2,})% 火焰抗性($| \\()', en: '^\\+?([3-9][0-9]|[1-9][0-9]{2,})% to Fire Resistance($| \\()' },
  { ref: '+#% to Cold Resistance', m: 30, zh: '^\\+?([3-9][0-9]|[1-9][0-9]{2,})% 冰冷抗性($| \\()', en: '^\\+?([3-9][0-9]|[1-9][0-9]{2,})% to Cold Resistance($| \\()' },
  { ref: '+#% to Lightning Resistance', m: 30, zh: '^\\+?([3-9][0-9]|[1-9][0-9]{2,})% 閃電抗性($| \\()', en: '^\\+?([3-9][0-9]|[1-9][0-9]{2,})% to Lightning Resistance($| \\()' },
  { ref: '+#% to Chaos Resistance', m: 20, zh: '^\\+?([2-9][0-9]|[1-9][0-9]{2,})% 混沌抗性($| \\()', en: '^\\+?([2-9][0-9]|[1-9][0-9]{2,})% to Chaos Resistance($| \\()' },
  { ref: '+#% to all Elemental Resistances', m: 10, zh: '^\\+?[1-9][0-9]{1,}% 全部元素抗性($| \\()', en: '^\\+?[1-9][0-9]{1,}% to all Elemental Resistances($| \\()' },
  { ref: '+# to Strength', m: 30, zh: '^\\+?([3-9][0-9]|[1-9][0-9]{2,}) 力量($| \\()', en: '^\\+?([3-9][0-9]|[1-9][0-9]{2,}) to Strength($| \\()' },
  { ref: '+# to Dexterity', m: 30, zh: '^\\+?([3-9][0-9]|[1-9][0-9]{2,}) 敏捷($| \\()', en: '^\\+?([3-9][0-9]|[1-9][0-9]{2,}) to Dexterity($| \\()' },
  { ref: '+# to Intelligence', m: 30, zh: '^\\+?([3-9][0-9]|[1-9][0-9]{2,}) 智慧($| \\()', en: '^\\+?([3-9][0-9]|[1-9][0-9]{2,}) to Intelligence($| \\()' },
  { ref: '#% increased Movement Speed', m: 25, zh: '^增加 \\+?(2[5-9]|[3-9][0-9]|[1-9][0-9]{2,})% 移動速度($| \\()', en: '^\\+?(2[5-9]|[3-9][0-9]|[1-9][0-9]{2,})% increased Movement Speed($| \\()' }
]

// T6(2026-10-09):行尾可接「空白 + 括號標記」(破裂 / 固定 / 符文…),原本以 `$` 結尾的片段改以 `($| \()` 結尾
describe('PoE1 常用 10 條', () => {
  const find = (ref: string): ItemModEntryData => {
    const e = DATA.poe1.entries.find(x => x.ref === ref)
    if (!e) throw new Error(`沒有 ${ref}`)
    return e
  }
  it('片段字串(兩語)', () => {
    for (const c of COMMON) {
      const e = find(c.ref)
      expect(itemModFragment(e.anchors.zh, { min: c.m }), c.ref).toBe(c.zh)
      expect(itemModFragment(e.anchors.en, { min: c.m }), c.ref).toBe(c.en)
    }
  })
  it('三種條件 × 多組門檻 0–999 逐值', () => {
    const bad: string[] = []
    for (const c of COMMON) {
      const e = find(c.ref)
      for (const m of [0, 1, 9, 10, 25, 80, 99, 100, 101, 150, 999]) {
        for (const cond of [ge(m), le(m), rg(m, Math.min(999, m + 15)), rg(Math.max(0, m - 40), m)]) {
          for (const l of LANGS) { const r = checkValues(e, l, cond, ALL_VALUES); if (r) bad.push(r) }
        }
      }
    }
    expect(bad).toEqual([])
  })
  it('分類', () => {
    const cats = COMMON.map(c => find(c.ref).cat)
    expect(cats).toEqual(['life', 'resist', 'resist', 'resist', 'resist', 'resist', 'attr', 'attr', 'attr', 'move'])
  })
  it('真實物品行:不中別的詞綴(附加的小天賦、最大抗性、幽魂生命…)', () => {
    const life = find('+# to maximum Life')
    const re = new RegExp(itemModFragment(life.anchors.zh, { min: 80 })!)
    expect(re.test('+90 最大生命')).toBe(true)
    expect(re.test('90 最大生命')).toBe(true)
    expect(re.test('+79 最大生命')).toBe(false)
    expect(re.test('附加的小天賦給予：+90 最大生命')).toBe(false)
    expect(re.test('+90 幽魂最大生命')).toBe(false)
    const fire = find('+#% to Fire Resistance')
    const rf = new RegExp(itemModFragment(fire.anchors.zh, { min: 30 })!)
    expect(rf.test('+45% 火焰抗性')).toBe(true)
    expect(rf.test('+4% 最大火焰抗性')).toBe(false)
    expect(rf.test('+45% 火焰與冰冷抗性')).toBe(false)
    const rfEn = new RegExp(itemModFragment(fire.anchors.en, { min: 30 })!, 'i')
    expect(rfEn.test('+45% to Fire Resistance')).toBe(true)
    expect(rfEn.test('+45% to Fire and Cold Resistances')).toBe(false)
    expect(rfEn.test('+4% to maximum Fire Resistance')).toBe(false)
  })
})

describe('③ 分類 / 篩選 / 頁', () => {
  it('itemModCategory', () => {
    expect(itemModCategory('#% increased Movement Speed')).toBe('move')
    expect(itemModCategory('+#% to Fire Resistance')).toBe('resist')
    expect(itemModCategory('+#% to all Elemental Resistances')).toBe('resist')
    expect(itemModCategory('+# to Strength')).toBe('attr')
    expect(itemModCategory('+# to all Attributes')).toBe('attr')
    expect(itemModCategory('+# to maximum Energy Shield')).toBe('es')
    expect(itemModCategory('#% increased Energy Shield Recharge Rate')).toBe('es')
    expect(itemModCategory('+# to maximum Life')).toBe('life')
    expect(itemModCategory('Regenerate # Life per second')).toBe('life')
    expect(itemModCategory('+# to maximum Mana')).toBe('mana')
    expect(itemModCategory('#% increased Attack Speed')).toBe('speed')
    expect(itemModCategory('#% increased Cast Speed')).toBe('speed')
    expect(itemModCategory('#% increased Fire Damage')).toBe('damage')
    expect(itemModCategory('+# to Armour')).toBe('other')
    // 先符合先贏:移速優先於「傷害」等;抗性優先於屬性
    expect(itemModCategory('#% increased Movement Speed if you have dealt Damage Recently')).toBe('move')
    expect(itemModCategory('+#% to Fire Resistance per 10 Strength')).toBe('resist')
    expect(ITEM_MOD_CATEGORIES.map(c => c.id)).toEqual(['life', 'mana', 'es', 'resist', 'attr', 'speed', 'damage', 'move', 'other'])
  })

  it('條件不成立 = null(沒有值、上限超過 999、下限大於上限);≥ 沒有上限', () => {
    const e = DATA.poe1.entries.find(x => x.ref === '+# to maximum Life')!
    expect(itemModFragment(e.anchors.zh, {})).toBeNull()
    expect(itemModFragment(e.anchors.zh, { max: 1000 })).toBeNull()
    expect(itemModFragment(e.anchors.zh, { min: 10, max: 1500 })).toBeNull()
    expect(itemModFragment(e.anchors.zh, { min: 50, max: 10 })).toBeNull()
    expect(new RegExp(itemModFragment(e.anchors.zh, { min: 1200 })!).test('+1500 最大生命')).toBe(true)
    expect(new RegExp(itemModFragment(e.anchors.zh, { max: 999 })!).test('+1000 最大生命')).toBe(false)
  })

  it('itemModPage:頁 id、未載入時沒有項目、groups 對應分類', () => {
    expect(itemModPage('poe1', null).entries).toEqual([])
    expect(itemModPage('poe1', null).id).toBe(ITEM_MOD_PAGE_IDS.poe1)
    expect(itemModPage('poe2', null).id).toBe(ITEM_MOD_PAGE_IDS.poe2)
    expect(isItemModPageId('item_mod_values')).toBe(true)
    expect(isItemModPageId('item_mod_values_poe2')).toBe(true)
    expect(isItemModPageId('map_mods')).toBe(false)
    const p = itemModPage('poe1', DATA.poe1)
    expect(p.entries.length).toBe(DATA.poe1.entries.length)
    expect(p.groups.length).toBe(ITEM_MOD_CATEGORIES.length)
    expect(p.entries.every(e => e.g >= 0 && e.g < p.groups.length)).toBe(true)
    const counts = itemModGroupCounts(p)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(p.entries.length)
    // 頁 id 不與既有頁撞
    for (const g of GAMES) expect(loadAllPagesFor(g).some(x => isItemModPageId(x.id))).toBe(false)
  })

  it('filterItemMods:關鍵字(繁中 / 英文 / 多字)、分類、只看已勾選、上限、已勾選置頂', () => {
    const p = itemModPage('poe1', DATA.poe1)
    const life = p.entries.findIndex(e => e.en[0] === '+# to maximum Life')
    const byZh = filterItemMods(p, [], { search: '最大生命', group: -1, pickedOnly: false }, 5000)
    expect(byZh.rows).toContain(life)
    const byEn = filterItemMods(p, [], { search: 'MAXIMUM life', group: -1, pickedOnly: false }, 5000)
    expect(byEn.rows).toContain(life)
    const two = filterItemMods(p, [], { search: 'fire resistance', group: -1, pickedOnly: false }, 5000)
    expect(two.rows.every(i => /fire/i.test(p.entries[i].en[0]) && /resistance/i.test(p.entries[i].en[0] + p.entries[i].hiddenEn[0]))).toBe(true)
    const g = ITEM_MOD_CATEGORIES.findIndex(c => c.id === 'resist')
    const res = filterItemMods(p, [], { search: '', group: g, pickedOnly: false }, 5000)
    expect(res.rows.every(i => p.entries[i].g === g)).toBe(true)
    expect(res.total).toBe(itemModGroupCounts(p)[g])
    const capped = filterItemMods(p, [life], { search: '', group: g, pickedOnly: false }, 10)
    expect(capped.rows[0]).toBe(life)
    expect(capped.rows.length).toBe(11)
    expect(capped.total).toBe(res.total + 1)
    expect(filterItemMods(p, [life, 3], { search: 'zzz', group: -1, pickedOnly: true }).rows).toEqual([3, life].sort((a, b) => a - b))
  })
})

describe('③ 書籤 / 分享碼 / 合併', () => {
  const pagesFor = (game: 'poe1' | 'poe2'): RegexPage[] => [...loadAllPagesFor(game), itemModPage(game, DATA[game])]

  it('書籤往返:單頁輸出逐字相同(兩遊戲 × 兩語 × 隨機勾選與數值)', () => {
    for (const game of GAMES) {
      const pages = pagesFor(game)
      const page = pages.find(p => p.id === ITEM_MOD_PAGE_IDS[game])!
      for (let seed = 1; seed <= 12; seed++) {
        const picked = [...new Set(Array.from({ length: 1 + (seed % 5) }, (_, k) => (seed * 977 + k * 131) % page.entries.length))].sort((a, b) => a - b)
        const vals: Record<string, { min?: number, max?: number }> = {}
        picked.forEach((i, k) => { vals[page.entries[i].id] = k % 3 === 0 ? { min: 10 + seed } : k % 3 === 1 ? { max: 50 + seed } : { min: 5, max: 40 + seed } })
        const picks = { [page.id]: picked }
        const values = { [page.id]: vals }
        for (const lang of LANGS) {
          const direct = combine({ lang, mode: 'any', pages: combineSels(pages, picks, values, page.id) })
          expect(direct.query.length).toBeGreaterThan(0)
          expect(direct.conflicts.filter(c => c.kind === 'invalid')).toEqual([])
          const body = bookmarkBodyOf(pages, page, picks, values, { game, mode: 'any', lang })!
          const back = JSON.parse(JSON.stringify({ name: 'x', ...body }))
          const q = bookmarkQuery(pages, back)!
          expect(q.query).toBe(direct.query)
          expect(q.missed).toBe(0)
          const a = bookmarkApplyOf(pages, back)!
          expect(a.picks[page.id]).toEqual(picked)
        }
      }
    }
  })

  it('分享碼往返:鍵 = stat id(語言無關),還原勾選與數值', async () => {
    for (const game of GAMES) {
      const pages = pagesFor(game)
      const page = pages.find(p => p.id === ITEM_MOD_PAGE_IDS[game])!
      const picked = [0, 7, 42].filter(i => i < page.entries.length)
      const vals: Record<string, { min?: number, max?: number }> = {}
      picked.forEach((i, k) => { vals[page.entries[i].id] = { min: 3 + k } })
      const s = shareStateOf(game, pages, { [page.id]: picked }, { [page.id]: vals }, { mode: 'all', custom: [], excludes: [] })
      expect(s.pages[page.id]).toEqual(picked.map(i => page.entries[i].id))
      expect(s.pages[page.id].every(k => /^stat_\d+(\|.+)?$/.test(k))).toBe(true)
      const d = await decodeShare(await encodeShare(s))
      const r = resolveState(d.state, pages)
      expect(r.picks[page.id]).toEqual(picked)
      expect(r.values[page.id]).toEqual(vals)
      expect(r.missed).toBe(0)
      // 頁還沒載入(沒有項目)時解析 = 全部還原不到(store 會先載入再套用)
      const r2 = resolveState(d.state, [...loadAllPagesFor(game), itemModPage(game, null)])
      expect(r2.missed).toBe(picked.length)
    }
  })

  it('與地圖詞綴頁合併:片段不誤中語料頁詞綴(fragment 衝突 = 0)', () => {
    const pages = pagesFor('poe1')
    const page = pages.find(p => p.id === ITEM_MOD_PAGE_IDS.poe1)!
    const life = page.entries.findIndex(e => e.en[0] === '+# to maximum Life')
    const fire = page.entries.findIndex(e => e.en[0] === '+#% to Fire Resistance')
    const r = combine({
      lang: 'zh',
      mode: 'any',
      pages: combineSels(pages, { [page.id]: [life, fire], map_mods: [0, 1] }, { [page.id]: { [page.entries[life].id]: { min: 80 } } })
    })
    expect(r.conflicts.filter(c => c.kind === 'fragment')).toEqual([])
    expect(r.query).toContain('"^\\+?([89][0-9]|[1-9][0-9]{2,}) 最大生命($| \\()"')
  })
})
