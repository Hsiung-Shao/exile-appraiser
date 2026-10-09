// 物品詞綴數值頁:多種寫法互不包含的詞綴改查仲裁檔 `data/regex/item-mod-forms.json`(poe2db / poedb 查得到的寫法)。
//   仲裁一種 → 用那一種;仲裁多種 → 共同前綴 / 後綴 + 差異段交替;`#` 在差異段 / 多行 / 需縮短 / 太長 / 仲裁檔沒有 → 仍 multi_form。
//   T1 施法速度收錄且只用仲裁寫法
//   T2 多寫法交替兩種都中
//   T3 交替不放行其他字
//   T4 `#` 在差異段仍排除
//   T4b 仲裁單一寫法即收錄
//   T5 查無的仍排除
//   T6 全量唯一性含交替
//   T7 英文不分大小寫
//   T8 仲裁檔格式與守門
//   T9 收錄統計
//   T10 沒有仲裁參數時行為同舊版
// 片段一律只經公開 API `itemModFragment(entry.anchors[lang], 條件)` 取得。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultRegexDataDir, loadItemModData } from '../src/node'
import { buildItemModData, itemModFragment, parseStatsNdjson, type ItemModData, type ItemModEntryData, type StatLite } from '../src/pages'
import type { RegexLang } from '../src/data'

const DATA_DIR = path.resolve(defaultRegexDataDir(), '..')
const REPO = path.resolve(DATA_DIR, '..')
const FORMS_PATH = path.join(DATA_DIR, 'regex', 'item-mod-forms.json')
const GAMES = ['poe1', 'poe2'] as const
type Game = typeof GAMES[number]
const LANGS: RegexLang[] = ['zh', 'en']
const LANG_DIR: Record<RegexLang, string> = { zh: 'cmn-Hant', en: 'en' }
const MARKERS = ['', ' (fractured)']

interface FormsFile {
  schema: number
  fetchedAt: string
  sources: unknown
  note: string
  poe1: Record<RegexLang, Record<string, string[]>>
  poe2: Record<RegexLang, Record<string, string[]>>
}
const FORMS: FormsFile = JSON.parse(fs.readFileSync(FORMS_PATH, 'utf8'))

const STATS: Record<string, StatLite[]> = {}
for (const g of GAMES) for (const l of LANGS) {
  STATS[`${g}.${l}`] = parseStatsNdjson(fs.readFileSync(path.join(DATA_DIR, g, LANG_DIR[l], 'stats.ndjson'), 'utf8'))
}

const DATA: Record<Game, ItemModData> = { poe1: loadItemModData('poe1'), poe2: loadItemModData('poe2') }

const flags = (l: RegexLang): string => (l === 'en' ? 'i' : '')
const stripPlus = (s: string): string => s.replace(/\+(?=#)/g, '').trim()
const keyOfEntry = (e: ItemModEntryData): string => (e.id.includes('|') ? e.id : `${e.id}|${e.ref}`)
const sameKey = (s: string, l: RegexLang): string => (l === 'en' ? stripPlus(s).toLowerCase() : stripPlus(s))

function entryOf (g: Game, key: string): ItemModEntryData | undefined {
  return DATA[g].entries.find(e => keyOfEntry(e) === key || e.id === key.split('|')[0] && e.ref === key.slice(key.indexOf('|') + 1))
}

function frag (e: ItemModEntryData, l: RegexLang, v: { min?: number, max?: number }): RegExp {
  const f = itemModFragment(e.anchors[l], v)
  expect(f, `${e.ref} ${l} 片段`).toBeTruthy()
  return new RegExp(f!, flags(l))
}

const VALUES = ['0', '1', '2', '5', '7', '9', '10', '12', '25', '50', '99', '100', '200', '999', '1000', '12345']

/** 一行模板的全部實例(`#` 依序代入同一個數值;有 / 沒有 `+`;另加行尾標記版) */
function instances (line: string): string[] {
  const base: string[] = []
  if (!line.includes('#')) base.push(line)
  else {
    for (const v of VALUES) {
      base.push(line.replace(/#/g, v))
      base.push(line.replace(/\+?#/g, '+' + v))
    }
  }
  const out: string[] = []
  for (const b of base) for (const m of MARKERS) out.push(b + m)
  return out
}

/**
 * 片段字串裡「任何命中都必含」的最長字面段(用來篩候選行;篩選是證明,不是抽樣):
 * 只取最外層、括號 / 字元類之外的字面字元;量詞(? * {)吃掉前一個字;數字與 `.` 斷開;
 * 最外層出現 `|` 就無法保證 → 回空字串(不篩)。
 */
function mustLiteral (f: string): string {
  const runs: string[] = []
  let cur = ''
  let depth = 0
  let inClass = false
  const cut = (): void => { if (cur) runs.push(cur); cur = '' }
  for (let i = 0; i < f.length; i++) {
    const c = f[i]
    if (c === '\\') {
      const n = f[i + 1] ?? ''
      i++
      if (inClass || depth > 0) continue
      if (/[0-9a-zA-Z]/.test(n)) { cut(); continue }
      cur += n
      continue
    }
    if (inClass) { if (c === ']') inClass = false; continue }
    if (c === '[') { inClass = true; cut(); continue }
    if (c === '(') { depth++; cut(); continue }
    if (c === ')') { depth--; cut(); continue }
    if (depth > 0) continue
    if (c === '|') return ''
    if (c === '?' || c === '*' || c === '{') { cur = cur.slice(0, -1); cut(); if (c === '{') { while (i < f.length && f[i] !== '}') i++ } continue }
    if (c === '+' || c === '^' || c === '$' || c === '.' || /[0-9]/.test(c)) { cut(); continue }
    cur += c
  }
  cut()
  return runs.reduce((x, y) => (y.length > x.length ? y : x), '')
}

interface Corpus { lines: string[], inst: string[][], instLower: string[][] }
const CORPUS: Record<string, Corpus> = {}
const SAME: Record<string, Map<string, Set<string>>> = {}
for (const g of GAMES) for (const l of LANGS) {
  const st = STATS[`${g}.${l}`]
  const set = new Set<string>()
  for (const s of st) for (const str of s.strings) for (const part of str.split('\n')) { const t = part.trim(); if (t) set.add(t) }
  const lines = [...set]
  const inst = lines.map(instances)
  CORPUS[`${g}.${l}`] = { lines, inst, instLower: inst.map(xs => xs.map(x => x.toLowerCase())) }
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

describe('多種寫法仲裁(item-mod-forms.json)', () => {
  it('T1 施法速度收錄且只用仲裁寫法', () => {
    const e = entryOf('poe2', 'stat_2891184298|#% increased Cast Speed')
    expect(e, 'PoE2「#% increased Cast Speed」應收錄').toBeTruthy()
    const f = itemModFragment(e!.anchors.zh, { min: 38 })
    expect(f).toBeTruthy()
    expect(new RegExp(f!).test('增加42%施法速度')).toBe(true)
    expect(f!.includes('施放')).toBe(false)
  })

  it('T2 多寫法交替兩種都中', () => {
    const e = entryOf('poe2', 'stat_2481353198|#% increased Block chance')
    expect(e, 'PoE2「#% increased Block chance」應收錄').toBeTruthy()
    const re = frag(e!, 'zh', { min: 10 })
    expect(re.test('增加12%格擋率')).toBe(true)
    expect(re.test('增加12%格擋機率')).toBe(true)
    expect(re.test('增加9%格擋機率')).toBe(false)
  })

  it('T3 交替不放行其他字', () => {
    const e = entryOf('poe2', 'stat_2481353198|#% increased Block chance')
    expect(e, 'PoE2「#% increased Block chance」應收錄').toBeTruthy()
    const re = frag(e!, 'zh', { min: 10 })
    expect(re.test('增加12%格擋效率')).toBe(false)
    expect(re.test('增加12%格擋')).toBe(false)
  })

  it('T4 `#` 在差異段仍排除', () => {
    // 仲裁三種:區域含有#個額外保險箱 / 你的地圖含有額外#個保險箱 / 地圖內含有額外的#個保險箱(# 落在差異段)
    const key = 'stat_3240183538|Map contains # additional Strongboxes'
    expect(FORMS.poe2.zh[key]?.length).toBe(3)
    const e = entryOf('poe2', key)
    const usable = e ? itemModFragment(e.anchors.zh, { min: 1 }) : null
    expect(usable, '不應收錄(# 落在差異段)').toBeFalsy()
  })

  it('T4b 仲裁單一寫法即收錄', () => {
    const key = 'stat_3771516363|#% additional Physical Damage Reduction'
    expect(FORMS.poe2.zh[key]).toEqual(['額外#%物理傷害減免'])
    const e = entryOf('poe2', key)
    expect(e, `PoE2「${key}」應收錄`).toBeTruthy()
    const re = frag(e!, 'zh', { min: 10 })
    expect(re.test('額外12%物理傷害減免')).toBe(true)
    expect(re.test('12%額外物理傷害減免')).toBe(false)
    expect(re.test('額外9%物理傷害減免')).toBe(false)
  })

  it('T5 查無的仍排除', () => {
    const key = 'stat_2571125745|Area has #% chance to contain a Shrine'
    expect(FORMS.poe2.zh[key]).toBeUndefined()
    expect(FORMS.poe2.en[key]).toBeUndefined()
    expect(entryOf('poe2', key)).toBeUndefined()
  })

  it('T6 全量唯一性含交替(仲裁寫法全中、其他詞綴模板 0 命中)', () => {
    const fails: string[] = []
    const checked: Record<string, number> = {}
    for (const g of GAMES) {
      for (const l of LANGS) {
        const ck = `${g}.${l}`
        checked[ck] = 0
        const corpus = CORPUS[ck]
        const same = SAME[ck]
        for (const [key, forms] of Object.entries(FORMS[g][l])) {
          const e = entryOf(g, key)
          if (!e) continue
          checked[ck]++
          // ① 仲裁的每種寫法:≥ 0 全中;區間 10–50 只中區間內
          const fAll = itemModFragment(e.anchors[l], { min: 0 })
          const fRange = itemModFragment(e.anchors[l], { min: 10, max: 50 })
          if (!fAll || !fRange) { fails.push(`${ck} ${key}: 片段為 null`); continue }
          const reAll = new RegExp(fAll, flags(l))
          const reRange = new RegExp(fRange, flags(l))
          for (const form of forms) {
            for (const m of MARKERS) {
              for (const v of VALUES) {
                for (const plus of [false, true]) {
                  const text = form.replace(/\+?#/g, (plus ? '+' : '') + v) + m
                  if (!reAll.test(text)) fails.push(`${ck} ${key}: ≥0 沒中「${text}」(${fAll})`)
                  const n = Number(v)
                  const want = n >= 10 && n <= 50
                  if (reRange.test(text) !== want) fails.push(`${ck} ${key}: 10–50 對「${text}」應為 ${want}(${fRange})`)
                }
              }
            }
          }
          // ② 唯一性:對該語言其他全部模板行 0 命中(同 stat 的行、同字行除外)
          const own = new Set<string>([...(same.get(key) ?? []), ...forms.map(x => sameKey(x, l))])
          const lit = mustLiteral(fAll)
          const litL = lit.toLowerCase()
          for (let i = 0; i < corpus.lines.length; i++) {
            if (own.has(sameKey(corpus.lines[i], l))) continue
            const xs = corpus.inst[i]
            const xl = corpus.instLower[i]
            for (let j = 0; j < xs.length; j++) {
              if (litL && !(l === 'en' ? xl[j] : xs[j]).includes(l === 'en' ? litL : lit)) continue
              if (reAll.test(xs[j])) { fails.push(`${ck} ${key}: 誤中「${xs[j]}」(${fAll})`); break }
            }
          }
        }
      }
    }
    expect(fails.slice(0, 30)).toEqual([])
    // 確認真的有檢查到(舊版仲裁鍵幾乎全是 multi_form → 0 筆);2026-10-10 實作後鎖收錄數(資料或仲裁檔變了要看過再改)
    const EXPECT_CHECKED: Record<string, number> = { 'poe1.zh': 35, 'poe1.en': 65, 'poe2.zh': 92, 'poe2.en': 36 }
    for (const g of GAMES) for (const l of LANGS) {
      const total = Object.keys(FORMS[g][l]).length
      expect(checked[`${g}.${l}`], `${g}.${l} 收錄的仲裁鍵 / 全部 ${total}`).toBe(EXPECT_CHECKED[`${g}.${l}`])
    }
  }, 300_000)

  it('T7 英文不分大小寫', () => {
    const key = 'stat_1276056105|#% increased Gold found in Map'
    expect(FORMS.poe2.en[key]?.length).toBeGreaterThanOrEqual(2)
    const e = entryOf('poe2', key)
    expect(e, `PoE2「${key}」應收錄`).toBeTruthy()
    const re = frag(e!, 'en', { min: 10 })
    expect(re.test('42% INCREASED gold Found In Map')).toBe(true)
    expect(re.test('42% Increased GOLD found in THIS area')).toBe(true)
    expect(re.test('9% increased Gold found in Map')).toBe(false)
  })

  it('T8 仲裁檔格式與守門', () => {
    expect(FORMS.schema).toBe(1)
    expect(typeof FORMS.fetchedAt).toBe('string')
    const bad: string[] = []
    for (const g of GAMES) {
      for (const l of LANGS) {
        const byKey = new Map<string, StatLite>()
        for (const s of STATS[`${g}.${l}`]) if (s.statId) { const k = `${s.statId}|${s.ref}`; if (!byKey.has(k)) byKey.set(k, s) }
        for (const [key, forms] of Object.entries(FORMS[g][l])) {
          const s = byKey.get(key)
          if (!s) { bad.push(`${g}.${l} ${key}: stats.ndjson 找不到`); continue }
          if (!Array.isArray(forms) || forms.length === 0) { bad.push(`${g}.${l} ${key}: 寫法為空`); continue }
          if (new Set(forms).size !== forms.length) bad.push(`${g}.${l} ${key}: 寫法重複`)
          for (const f of forms) if (!s.plain.includes(f)) bad.push(`${g}.${l} ${key}: 「${f}」不是非 negate、無 value 的 matcher`)
          // 依 stats.ndjson 原順序
          const idx = forms.map(f => s.plain.indexOf(f))
          if (idx.some((x, i) => i > 0 && x <= idx[i - 1])) bad.push(`${g}.${l} ${key}: 順序與 stats.ndjson 不同`)
        }
      }
    }
    expect(bad).toEqual([])
    const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'MANIFEST.json'), 'utf8'))
    const entry = manifest.files?.['data/regex/item-mod-forms.json']
    expect(entry, 'MANIFEST files 應有 data/regex/item-mod-forms.json').toBeTruthy()
    const buf = fs.readFileSync(FORMS_PATH)
    expect(entry.sha256).toBe(crypto.createHash('sha256').update(buf).digest('hex'))
    expect(manifest.sources?.['data/regex/item-mod-forms.json'], 'MANIFEST sources 應有來源').toBeTruthy()
    expect(path.relative(REPO, FORMS_PATH).replace(/\\/g, '/')).toBe('data/regex/item-mod-forms.json')
  })

  it('T9 收錄統計', () => {
    // 2026-10-10 仲裁後(舊值:poe2 entries 1198 / multi_form 135;poe1 entries 4785 / multi_form 87)
    expect(DATA.poe2.entries.length).toBe(1294)
    expect(DATA.poe2.excluded.multi_form).toBe(33)
    expect(DATA.poe1.entries.length).toBe(4854)
    expect(DATA.poe1.excluded.multi_form).toBe(12)
    for (const g of GAMES) {
      const d = DATA[g]
      const ex = Object.values(d.excluded).reduce((a, b) => a + b, 0)
      expect(d.entries.length + d.merged + ex).toBe(d.itemStats)
    }
  })

  it('T10 沒有仲裁參數時行為同舊版', () => {
    const old: Record<Game, { entries: number, multi: number }> = { poe2: { entries: 1198, multi: 135 }, poe1: { entries: 4785, multi: 87 } }
    for (const g of GAMES) {
      const d = (buildItemModData as any)(g, STATS[`${g}.zh`], STATS[`${g}.en`]) as ItemModData
      expect(d.entries.length, `${g} entries`).toBe(old[g].entries)
      expect(d.excluded.multi_form, `${g} multi_form`).toBe(old[g].multi)
    }
  }, 120_000)
})
