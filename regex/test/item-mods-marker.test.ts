// 物品詞綴數值頁:遊戲搜尋的物品文字在破裂 / 固定 / 符文等詞綴行尾多了「空白 + 括號標記」
// (例:`增加238%法術傷害 (fractured)`)。片段原本以 `$` 結尾的,改以 `($| \()` 結尾;行首 `^` 不變;
// 唯一性判斷把「別行模板 = 本行文字 + ` (`…」也當成衝突。
//   T1 破裂行帶括號標記仍命中
//   T2 一般行行為不變
//   T3 標記以外的尾巴不放行
//   T4 全部模板加標記後仍唯一(自身加標記行要中;別的詞綴模板行含加標記版本 0 命中)
//   T5 英文同樣適用
// (T6 鎖住的常用片段字串在 item-mods.test.ts)
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultRegexDataDir, loadItemModData } from '../src/node'
import { itemModFragment, parseStatsNdjson, type ItemModData, type ItemModEntryData, type ModAnchor, type StatLite } from '../src/pages'
import type { RegexLang } from '../src/data'

const DATA_DIR = path.resolve(defaultRegexDataDir(), '..')
const GAMES = ['poe1', 'poe2'] as const
const LANGS: RegexLang[] = ['zh', 'en']
const LANG_DIR: Record<RegexLang, string> = { zh: 'cmn-Hant', en: 'en' }
const MARKERS = [' (fractured)', ' (rune)', ' (implicit)', ' (已破裂)']

const DATA: Record<string, ItemModData> = { poe1: loadItemModData('poe1'), poe2: loadItemModData('poe2') }

const flags = (l: RegexLang): string => (l === 'en' ? 'i' : '')
const stripPlus = (s: string): string => s.replace(/\+(?=#)/g, '').trim()
const templateOf = (e: ItemModEntryData, l: RegexLang): string => (l === 'zh' ? e.zh : e.en)
const keyOfEntry = (e: ItemModEntryData): string => (e.id.includes('|') ? e.id : `${e.id}|${e.ref}`)
function sameKey (s: string, l: RegexLang): string {
  const t = stripPlus(s)
  return l === 'en' ? t.toLowerCase() : t
}

/** PoE2「增加#%法術傷害」 */
function spellDamage (): ItemModEntryData {
  const e = DATA.poe2.entries.find(x => x.id === 'stat_2974417149' || x.id.startsWith('stat_2974417149|'))
  if (!e) throw new Error('沒有 PoE2 stat_2974417149')
  return e
}
const spellZh = (): RegExp => new RegExp(itemModFragment(spellDamage().anchors.zh, { min: 209 })!)
const spellEn = (): RegExp => new RegExp(itemModFragment(spellDamage().anchors.en, { min: 209 })!, 'i')

describe('行尾括號標記(破裂 / 固定 / 符文…)', () => {
  it('T1 破裂行帶括號標記仍命中', () => {
    expect(spellDamage().zh).toBe('增加#%法術傷害')
    expect(spellZh().test('增加238%法術傷害 (fractured)')).toBe(true)
  })

  it('T2 一般行行為不變', () => {
    const re = spellZh()
    expect(re.test('增加238%法術傷害')).toBe(true)
    expect(re.test('增加208%法術傷害')).toBe(false)
  })

  it('T3 標記以外的尾巴不放行', () => {
    const re = spellZh()
    expect(re.test('增加238%法術傷害提高')).toBe(false)
    expect(re.test('增加238%法術傷害(x)')).toBe(false)
  })

  it('T5 英文同樣適用', () => {
    expect(spellEn().test('238% increased Spell Damage (fractured)')).toBe(true)
    // 條件外的值加標記也不中
    expect(spellEn().test('208% increased Spell Damage (fractured)')).toBe(false)
  })
})

// ---- T4 全量 ----

const VALUES = ['0', '1', '7', '12', '99', '100', '999', '1000', '12345']

/** 一行模板的實例(`#` 代入數值;有 / 沒有 `+`),另加每種標記的版本 */
function instancesWithMarkers (line: string): string[] {
  const base: string[] = []
  if (!line.includes('#')) base.push(line)
  else {
    for (const v of VALUES) {
      base.push(line.replace(/#/g, v))
      base.push(line.replace(/\+?#/g, '+' + v))
    }
  }
  const out: string[] = []
  for (const b of base) { out.push(b); for (const m of MARKERS) out.push(b + m) }
  return out
}

/** 錨點字面文字(P / S)裡不含數字的最長一段(篩候選行用:不含它的行不可能命中;與 item-mods.test.ts 同法) */
function filterKey (a: ModAnchor): string {
  const parts = `${a.p}${a.s}`.split(/[0-9]+/)
  return parts.reduce((x, y) => (y.length > x.length ? y : x), '').toLowerCase()
}

interface Corpus { lines: string[], lower: string[] }
const CORPUS: Record<string, Corpus> = {}
const SAME: Record<string, Map<string, Set<string>>> = {}
for (const g of GAMES) {
  for (const l of LANGS) {
    const st: StatLite[] = parseStatsNdjson(fs.readFileSync(path.join(DATA_DIR, g, LANG_DIR[l], 'stats.ndjson'), 'utf8'))
    const set = new Set<string>()
    for (const s of st) for (const str of s.strings) for (const part of str.split('\n')) { const t = part.trim(); if (t) set.add(t) }
    const lines = [...set]
    CORPUS[`${g}.${l}`] = { lines, lower: lines.map(x => x.toLowerCase()) }
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

describe('T4 全部模板加標記後仍唯一', () => {
  for (const g of GAMES) {
    for (const l of LANGS) {
      it(`${g} ${l}:自身模板行加標記要中(條件內)、條件外不中`, () => {
        const bad: string[] = []
        DATA[g].entries.forEach((e, idx) => {
          const m = 1 + ((idx * 37) % 300)
          const f = itemModFragment(e.anchors[l], { min: m })
          if (!f) { bad.push(`沒有片段:${e.ref}`); return }
          const re = new RegExp(f, flags(l))
          const t = stripPlus(templateOf(e, l))
          for (const n of [m, m + 1, m + 50, 999]) {
            for (const p of ['', '+']) {
              for (const mk of MARKERS) {
                const s = t.replace('#', p + String(n)) + mk
                if (!re.test(s)) { bad.push(`自身加標記不中:${e.ref} [${l}] ${f} 對「${s}」`); return }
              }
            }
          }
          for (const mk of MARKERS) {
            const s = t.replace('#', String(m - 1)) + mk
            if (re.test(s)) { bad.push(`條件外加標記卻中:${e.ref} [${l}] ${f} 對「${s}」`); return }
          }
        })
        expect(bad.slice(0, 10)).toEqual([])
      })

      it(`${g} ${l}:片段(數值任意)不命中其他詞綴模板行與其加標記版本`, () => {
        const corpus = CORPUS[`${g}.${l}`]
        const same = SAME[`${g}.${l}`]
        const bad: string[] = []
        let checkedLines = 0
        for (const e of DATA[g].entries) {
          // { min: 0 } = 任何數值(0 起、沒有上限)
          const f = itemModFragment(e.anchors[l], { min: 0 })
          if (!f) { bad.push(`沒有片段:${e.ref}`); continue }
          const re = new RegExp(f, flags(l))
          const key = filterKey(e.anchors[l])
          const own = sameKey(templateOf(e, l), l)
          const sameSet = same.get(keyOfEntry(e)) ?? new Set<string>()
          for (let i = 0; i < corpus.lines.length; i++) {
            if (key && !corpus.lower[i].includes(key)) continue
            const line = corpus.lines[i]
            const norm = sameKey(line, l)
            if (norm === own || sameSet.has(norm)) continue
            checkedLines++
            for (const s of instancesWithMarkers(line)) {
              if (re.test(s)) { bad.push(`${e.ref} | ${f} | ${s}`); break }
            }
          }
        }
        expect(bad.slice(0, 10)).toEqual([])
        expect(checkedLines).toBeGreaterThan(0)
      })
    }
  }
})
