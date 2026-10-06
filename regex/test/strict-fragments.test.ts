// 第 35 步:地圖 / 換界石數值區的嚴格片段(`標籤[:：] *\+?<數值> *%`、階級名稱、稀有度)。
// 依據與推理見 regex/src/pages/frag.ts「嚴格寫法」段。本檔驗:
//   ① 0–999 逐值 × 分隔寫法(半形 / 全形冒號、有無空白、有無 +、(augmented)、% 前空白)
//   ② 跨行負例:標籤行數值不符、下一行有符合的數值 → `.` 跨行或不跨行兩種假設下都不中(舊 `.*` 寫法在跨行假設下會中)
//   ③ 稀有度 | 汙染條件列(第 40 步起稀有度可多選、併入汙染)不中「物品稀有度 / 怪物稀有度」行與任何語料行;真實剪貼簿樣本只中稀有度 / 汙染那一行
//   ④ 階級:名稱格式的證據(APT 解析器、items.ndjson、剪貼簿樣本)+ 逐值
//   ⑤ 舊書籤 / 分享碼(只存數值)換成新片段後,對真實格式的屬性行命中集合與舊片段相同
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isCorpusPage } from '../src/data'
import { defaultRegexDataDir, loadAllPagesFor } from '../src/node'
import { encodeRarityChoice, parseRarityChoice, toggleCorruptionIn, toggleRarityIn, type Corruption } from '../src/rarity'
import {
  isAlgoPage, mapTierFragment, propertyFragment, rarityFragment, strictPropertyFragment, type AlgoEntry, type AlgoPage, type AlgoValue
} from '../src/pages'
import { condText } from '../src/view'

const ROOT = path.resolve(defaultRegexDataDir(), '..', '..')
const ci = (src: string): RegExp => new RegExp(src, 'i')
/** `.` 也跨行(假設遊戲把整件物品文字當一個字串、`.` 吃換行) */
const ciDot = (src: string): RegExp => new RegExp(src, 'is')
const readLines = (rel: string): string[] => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/)

const GAMES = ['poe1', 'poe2'] as const
const numPage = (game: 'poe1' | 'poe2'): AlgoPage =>
  loadAllPagesFor(game).find(p => isAlgoPage(p) && p.kind === 'numeric') as AlgoPage
const percentEntries = (p: AlgoPage): AlgoEntry[] => p.entries.filter(e => e.input.kind === 'range' && e.input.percent)

const CONDS: Array<{ v: AlgoValue, ok: (n: number) => boolean }> = [
  { v: { min: 80 }, ok: n => n >= 80 },
  { v: { min: 30 }, ok: n => n >= 30 },
  { v: { min: 7 }, ok: n => n >= 7 },
  { v: { min: 100 }, ok: n => n >= 100 },
  { v: { min: 150 }, ok: n => n >= 150 },
  { v: { min: 0 }, ok: () => true },
  { v: { max: 50 }, ok: n => n <= 50 },
  { v: { max: 5 }, ok: n => n <= 5 },
  { v: { max: 0 }, ok: n => n === 0 },
  { v: { min: 60, max: 86 }, ok: n => n >= 60 && n <= 86 },
  { v: { min: 100, max: 120 }, ok: n => n >= 100 && n <= 120 },
  { v: { min: 9, max: 10 }, ok: n => n >= 9 && n <= 10 }
]

/** 遊戲 / 剪貼簿可能的百分比行寫法(社群寫法 `[:：] *\+?N *%` 全部涵蓋) */
const pctLines = (lab: string, n: number): string[] => [
  `${lab}: +${n}%`, `${lab}: +${n}% (augmented)`, `${lab}：+${n}%`, `${lab}:+${n}%`, `${lab}： +${n}%`,
  `${lab}: ${n}%`, `${lab}:${n}%`, `${lab}：${n}%`, `${lab}: +${n} %`
]

describe('① strictPropertyFragment:0–999 逐值 × 分隔寫法', () => {
  it('百分比(物品數量)', () => {
    for (const c of CONDS) {
      const f = strictPropertyFragment('物品數量', c.v, 3, true)!
      const r = ci(f)
      for (let n = 0; n <= 999; n++) {
        for (const line of pctLines('物品數量', n)) if (r.test(line) !== c.ok(n)) throw new Error(`${f} × 「${line}」 期望 ${c.ok(n)}`)
      }
      // 開放上界:≥ 條件對 1000+ 也成立
      for (const n of [1000, 1234, 99999]) expect(r.test(`物品數量: +${n}%`)).toBe(c.ok(n))
    }
  })
  it('沒有冒號、負值、數字在別的標籤後都不中(前界固定)', () => {
    const r = ci(strictPropertyFragment('物品數量', { min: 0 }, 3, true)!)
    expect(r.test('物品數量 +80%')).toBe(false)
    expect(r.test('物品數量: -80%')).toBe(false)
    expect(r.test('地圖掉落物品數量增加 80%')).toBe(false)
    const le = ci(strictPropertyFragment('物品數量', { max: 50 }, 3, true)!)
    expect(le.test('物品數量: +150%')).toBe(false) // 舊寫法前界 `[^\d]` 也擋得住;新寫法靠冒號後直接接數字
  })
  it('非百分比(匯出的通用版;數值頁的階級改走名稱):`[:：]?` + ≤ / 區間後界', () => {
    for (const c of CONDS) {
      const f = strictPropertyFragment('物品等級', c.v, 3, false)!
      const r = ci(f)
      for (let n = 0; n <= 999; n++) {
        for (const line of [`物品等級: ${n}`, `物品等級：${n}`, `物品等級 ${n}`, `物品等級:${n} (x)`]) {
          if (r.test(line) !== c.ok(n)) throw new Error(`${f} × 「${line}」 期望 ${c.ok(n)}`)
        }
      }
    }
  })
  it('只寫 [0-9],不寫 \\d / 大寫跳脫 / `.*`', () => {
    for (const game of GAMES) {
      for (const e of numPage(game).entries) {
        for (const lang of ['zh', 'en'] as const) {
          const vals: AlgoValue[] = e.input.kind === 'select' ? e.input.options.map(o => ({ choice: o.id })) : CONDS.map(c => c.v)
          for (const v of vals) {
            const f = e.fragment(v, lang)
            if (!f) continue
            expect(f).not.toMatch(/\\[dDWS]|\.\*/)
          }
        }
      }
    }
  })
})

describe('② 跨行負例', () => {
  for (const game of GAMES) {
    it(`${game}:每個百分比項目 × 條件,標籤行不符、下一行符合 → 兩種 . 假設都不中`, () => {
      let oldCrossHits = 0
      for (const e of percentEntries(numPage(game))) {
        for (const lang of ['zh', 'en'] as const) {
          const lab = lang === 'zh' ? e.zh[0] : e.en[0]
          for (const c of CONDS) {
            const f = e.fragment(c.v, lang)!
            const old = propertyFragment(lab, c.v, 3, true)!
            const bad = [0, 5, 49, 51, 79, 99, 121, 149, 999].find(n => !c.ok(n))
            const good = [999, 120, 86, 80, 60, 50, 10, 5, 0].find(n => c.ok(n))
            if (bad === undefined || good === undefined) continue
            const texts = [
              `${lab}: +${bad}% (augmented)\n其他屬性: +${good}% (augmented)`,
              `${lab}: +${bad}% (augmented)\n+${good}%`,
              `${lab}: +${bad}%\n${good}%`
            ]
            for (const t of texts) {
              expect(ci(f).test(t), `${f} × ${JSON.stringify(t)}`).toBe(false)
              expect(ciDot(f).test(t), `${f}(. 跨行)× ${JSON.stringify(t)}`).toBe(false)
              if (ciDot(old).test(t)) oldCrossHits++
            }
          }
        }
      }
      // 舊 `.*` 寫法在「. 跨行」假設下確實會誤中(這組負例有意義)
      expect(oldCrossHits).toBeGreaterThan(0)
    })
  }
  it('階級:名稱的數值不符、下一行有符合的數字 → 不中', () => {
    const f = mapTierFragment({ min: 16 }, 2, 'zh')!
    const t = '地圖（階級 14）\n--------\n怪物等級: 16）'
    expect(ci(f).test(t)).toBe(false)
    expect(ciDot(f).test(t)).toBe(false)
  })
})

/** 兩遊戲全部語料行(詞綴、隱藏、ambient;中英),`#` 代入多個樣本值 */
function corpusLines (): string[] {
  const out = new Set<string>()
  const vals = ['1', '5', '14', '16', '20', '30', '50', '80', '100', '150']
  for (const game of GAMES) {
    for (const p of loadAllPagesFor(game).filter(isCorpusPage)) {
      const raw = [...p.ambientZh, ...p.ambientEn, ...p.entries.flatMap(e => [...e.zh, ...e.en, ...e.hiddenZh, ...e.hiddenEn])]
      for (const l of raw) {
        if (l.includes('#')) for (const v of vals) out.add(l.replace(/#/g, v))
        else out.add(l)
      }
    }
  }
  return [...out]
}

describe('③ 稀有度 | 汙染條件列(第 35 步稀有度列;第 40 步起稀有度可多選、併入汙染)', () => {
  const rowOf = (game: 'poe1' | 'poe2'): AlgoEntry => numPage(game).entries.find(x => x.id === 'item_rarity_class')!
  const optsOf = (e: AlgoEntry) => {
    if (e.input.kind !== 'rarity') throw new Error('rarity')
    return e.input
  }
  /** 全部非空、非全選的稀有度組合(全選 = 不加稀有度條件) */
  const subsets = (ids: string[]): string[][] => {
    const out: string[][] = []
    for (let m = 1; m < (1 << ids.length) - 1; m++) out.push(ids.filter((_, i) => m & (1 << i)))
    return out
  }
  const choiceOf = (rarity: string[], corruption: Corruption = ''): AlgoValue => ({ choice: encodeRarityChoice({ rarity, corruption }) })
  for (const game of GAMES) {
    it(`${game}:條件列在數值區最後;四個稀有度 + 未 / 已汙染;預設仍是稀有(普通的繁中照 clientstrings)`, () => {
      const p = numPage(game)
      const e = rowOf(game)
      expect(p.entries[p.entries.length - 1].id).toBe(e.id)
      const inp = optsOf(e)
      expect(inp.options.map(o => o.id)).toEqual(['normal', 'magic', 'rare', 'unique'])
      expect(inp.options[0].zh).toBe(game === 'poe1' ? '普通' : '中')
      expect(inp.corruption.map(o => [o.id, o.zh, o.en])).toEqual([['uncorrupted', '未汙染', 'Not Corrupted'], ['corrupted', '已汙染', 'Corrupted']])
      expect(inp.def).toEqual({ choice: 'rare' })
      expect(e.terms!(choiceOf([]), 'zh')).toBeNull()
      expect(e.terms!(choiceOf(['normal', 'magic', 'rare', 'unique']), 'zh')).toBeNull()
      expect(e.terms!(choiceOf(['normal', 'magic', 'rare', 'unique'], 'uncorrupted'), 'zh')).toEqual(['!^已汙染$'])
    })
    it(`${game}:每個稀有度組合 × 分隔寫法只中選到的;物品稀有度 / 怪物稀有度 0–999 都不中`, () => {
      const e = rowOf(game)
      const inp = optsOf(e)
      for (const lang of ['zh', 'en'] as const) {
        const rarityLabel = lang === 'zh' ? e.zh[0] : e.en[0]
        const itemRarity = lang === 'zh' ? '物品稀有度' : 'Item Rarity'
        const monsterRarity = lang === 'zh' ? '怪物稀有度' : 'Monster Rarity'
        for (const pick of subsets(inp.options.map(o => o.id))) {
          const ts = e.terms!(choiceOf(pick), lang)!
          expect(ts.length).toBe(1)
          const r = ci(ts[0])
          for (const opt of inp.options) {
            const val = lang === 'zh' ? opt.zh : opt.en
            for (const sep of [': ', '：', ':', '： ']) expect(r.test(`${rarityLabel}${sep}${val}`), `${pick} ${val}`).toBe(pick.includes(opt.id))
          }
          for (let n = 0; n <= 999; n++) {
            for (const lab of [itemRarity, monsterRarity]) {
              for (const line of [`${lab}: +${n}%`, `${lab}：+${n}%`, `${lab}: ${n}% (augmented)`]) {
                if (r.test(line)) throw new Error(`${r.source} 誤中「${line}」`)
              }
            }
          }
        }
      }
    })
  }
  it('單選與第 35 步 rarityFragment 逐字相同(舊單字 choice 照讀);多選依固定順序;汙染各自一個 term', () => {
    const e = rowOf('poe1')
    expect(e.fragment({ choice: 'rare' }, 'zh')).toBe(rarityFragment('稀有度', '稀有'))
    expect(e.fragment({ choice: 'rare' }, 'zh')).toBe('稀有度[:：] *稀有')
    expect(e.fragment({ choice: 'normal' }, 'zh')).toBe('稀有度[:：] *普通')
    expect(e.fragment({ choice: 'unique' }, 'en')).toBe('Rarity[:：] *Unique')
    expect(e.terms!(choiceOf(['rare', 'magic'], 'uncorrupted'), 'zh')).toEqual(['稀有度[:：] *(魔法|稀有)', '!^已汙染$'])
    expect(e.terms!(choiceOf(['unique', 'normal', 'rare'], 'corrupted'), 'en')).toEqual(['Rarity[:：] *(Normal|Rare|Unique)', '^Corrupted$'])
    expect(rowOf('poe2').terms!(choiceOf(['normal', 'magic']), 'zh')).toEqual(['稀有度[:：] *(中|魔法)'])
    expect(e.fragment(choiceOf(['magic'], 'corrupted'), 'zh')).toBe('稀有度[:：] *魔法 ^已汙染$')
  })
  it('choice 編解碼:新格式、舊單字、壞值;按鈕切換', () => {
    expect(parseRarityChoice('mr|u')).toEqual({ rarity: ['magic', 'rare'], corruption: 'uncorrupted' })
    expect(parseRarityChoice('|c')).toEqual({ rarity: [], corruption: 'corrupted' })
    expect(parseRarityChoice('magic')).toEqual({ rarity: ['magic'], corruption: '' })
    expect(parseRarityChoice('xyz|q')).toEqual({ rarity: [], corruption: '' })
    expect(parseRarityChoice(undefined)).toEqual({ rarity: [], corruption: '' })
    expect(encodeRarityChoice({ rarity: ['unique', 'normal'], corruption: 'corrupted' })).toBe('nu|c')
    expect(encodeRarityChoice({ rarity: ['rare'], corruption: '' })).toBe('r')
    expect(toggleRarityIn('rare', 'magic')).toBe('mr')
    expect(toggleRarityIn('mr|u', 'rare')).toBe('m|u')
    expect(toggleCorruptionIn('m', 'uncorrupted')).toBe('m|u')
    expect(toggleCorruptionIn('m|u', 'corrupted')).toBe('m|c')
    expect(toggleCorruptionIn('m|c', 'corrupted')).toBe('m')
    for (const id of ['normal', 'magic', 'rare', 'unique']) expect(encodeRarityChoice(parseRarityChoice(id))).toHaveLength(1)
    expect(encodeRarityChoice({ rarity: ['normal', 'magic', 'rare', 'unique'], corruption: 'uncorrupted' }).length).toBeLessThanOrEqual(16)
  })
  it('兩遊戲全部語料行(詞綴 / 隱藏 / ambient,中英,# 代入樣本值)都不中任何稀有度組合;已汙染只中「已汙染」這行本身', () => {
    const lines = corpusLines()
    expect(lines.length).toBeGreaterThan(1000)
    for (const game of GAMES) {
      const e = rowOf(game)
      for (const pick of subsets(optsOf(e).options.map(o => o.id))) {
        for (const lang of ['zh', 'en'] as const) {
          const r = ci(e.terms!(choiceOf(pick), lang)![0])
          const hit = lines.find(l => r.test(l))
          expect(hit, `${game} ${pick} ${lang}`).toBeUndefined()
        }
      }
      for (const lang of ['zh', 'en'] as const) {
        const word = lang === 'zh' ? '已汙染' : 'Corrupted'
        const r = ci(e.terms!(choiceOf([], 'corrupted'), lang)![0])
        expect(r.test(word)).toBe(true)
        expect(lines.find(l => l !== word && r.test(l)), `${game} ${lang}`).toBeUndefined()
      }
    }
  })
  it('PoE1 真實剪貼簿(繁中 / 英文地圖樣本):只中「稀有度: X」那一行,且只有含它的組合中', () => {
    const e = rowOf('poe1')
    const inp = optsOf(e)
    const dirs = [['poe1/test/fixtures/cmn-Hant', 'zh'], ['poe1/test/fixtures/filter-visibility', 'zh'], ['poe1/test/fixtures/en', 'en']] as const
    let files = 0
    for (const [dir, lang] of dirs) {
      for (const name of fs.readdirSync(path.join(ROOT, dir)).filter(n => /^map-.*\.txt$/.test(n))) {
        const lines = readLines(`${dir}/${name}`)
        const rarityLine = lines.find(l => /^(稀有度|Rarity): /.test(l))!
        expect(rarityLine, name).toBeTruthy()
        for (const pick of subsets(inp.options.map(o => o.id))) {
          const r = ci(e.terms!(choiceOf(pick), lang)![0])
          const hits = lines.filter(l => r.test(l))
          const on = inp.options.some(o => pick.includes(o.id) && rarityLine.endsWith(lang === 'zh' ? o.zh : o.en))
          expect(hits, `${name} ${pick}`).toEqual(on ? [rarityLine] : [])
        }
        files++
      }
    }
    expect(files).toBeGreaterThanOrEqual(13)
  })
  it('真實剪貼簿(兩遊戲 × 中英):有「已汙染 / Corrupted」行的樣本 ⇔ 已汙染 term 命中(含汙染的 T16 地圖)', () => {
    const dirs = [
      ['poe1', 'poe1/test/fixtures/cmn-Hant', 'zh'], ['poe1', 'poe1/test/fixtures/filter-visibility', 'zh'], ['poe1', 'poe1/test/fixtures/en', 'en'],
      ['poe2', 'poe2/test/zhTW/fixtures/cmn-Hant', 'zh'], ['poe2', 'poe2/test/zhTW/fixtures/en', 'en']
    ] as const
    const hitFiles: string[] = []
    let files = 0
    for (const [game, dir, lang] of dirs) {
      const r = ci(rowOf(game).terms!(choiceOf([], 'corrupted'), lang)![0])
      for (const name of fs.readdirSync(path.join(ROOT, dir)).filter(n => n.endsWith('.txt'))) {
        const lines = readLines(`${dir}/${name}`)
        const has = lines.some(l => l === (lang === 'zh' ? '已汙染' : 'Corrupted'))
        if (has) hitFiles.push(name)
        expect(lines.some(l => r.test(l)), name).toBe(has)
        files++
      }
    }
    expect(files).toBeGreaterThanOrEqual(30)
    expect(hitFiles).toContain('map-t16-corrupted.txt')
  })
  it('收合摘要 condText:「魔法、稀有 · 未汙染」;舊單字照讀;什麼都沒選 = 不成立', () => {
    const e = rowOf('poe1')
    expect(condText(e, { choice: 'rare' }, 'zh')).toBe('稀有')
    expect(condText(e, { choice: 'normal' }, 'zh')).toBe('普通')
    expect(condText(e, { choice: 'unique' }, 'en')).toBe('Unique')
    expect(condText(e, choiceOf(['magic', 'rare'], 'uncorrupted'), 'zh')).toBe('魔法、稀有 · 未汙染')
    expect(condText(e, choiceOf([], 'corrupted'), 'en')).toBe('Corrupted')
    expect(condText(e, { choice: 'nope' }, 'zh')).toBeNull()
  })
  it('rarityFragment:空值回 null', () => {
    expect(rarityFragment('稀有度', '')).toBeNull()
    expect(rarityFragment('', '稀有')).toBeNull()
  })
})

describe('④ 階級 = 名稱「（階級 N）」', () => {
  it('證據:APT 解析器 MAP_TIER 取自名稱;PoE2 英文樣本與 items.ndjson 的換界石名稱帶階級、沒有「Waystone Tier:」行', () => {
    expect(fs.readFileSync(path.join(ROOT, 'data/poe1/cmn-Hant/client_strings.js'), 'utf8')).toContain('MAP_TIER: /（階級 (\\d+)）$/')
    expect(fs.readFileSync(path.join(ROOT, 'data/poe1/en/client_strings.js'), 'utf8')).toContain('MAP_TIER: / \\(Tier (\\d+)\\)$/')
    const ws = readLines('poe2/test/zhTW/fixtures/en/waystone-rare-01.txt')
    expect(ws).toContain('Waystone (Tier 14)')
    expect(ws.some(l => l.startsWith('Waystone Tier'))).toBe(false)
    for (const [lang, rel, re] of [
      ['zh', 'data/poe2/cmn-Hant/items.ndjson', /^換界石（階級 (\d+)）$/],
      ['en', 'data/poe2/en/items.ndjson', /^Waystone \(Tier (\d+)\)$/]
    ] as const) {
      const names = readLines(rel).filter(Boolean).map(l => JSON.parse(l).name as string).filter(n => re.test(n))
      expect(names.length, rel).toBe(16)
      for (const c of [{ v: { min: 15 }, ok: (n: number) => n >= 15 }, { v: { max: 3 }, ok: (n: number) => n <= 3 }, { v: { min: 1, max: 16 }, ok: () => true }]) {
        const r = ci(mapTierFragment(c.v, 2, lang)!)
        for (const n of names) expect(r.test(n), `${r.source} × ${n}`).toBe(c.ok(Number(re.exec(n)![1])))
      }
    }
  })
  it('PoE1 剪貼簿樣本:地圖名稱行命中、沒有「地圖階級」行;T17「夢魘地圖」沒有階級', () => {
    let maps = 0
    for (const dir of ['poe1/test/fixtures/cmn-Hant', 'poe1/test/fixtures/filter-visibility']) {
      for (const name of fs.readdirSync(path.join(ROOT, dir)).filter(n => /^map-.*\.txt$/.test(n))) {
        const lines = readLines(`${dir}/${name}`)
        expect(lines.some(l => l.startsWith('地圖階級')), name).toBe(false)
        const m = lines.map(l => /（階級 (\d+)）$/.exec(l)).find(Boolean)
        const r16 = ci(mapTierFragment({ min: 16 }, 2, 'zh')!)
        const hits = lines.filter(l => r16.test(l))
        if (!m) {
          expect(lines.some(l => l.includes('夢魘地圖')), name).toBe(true)
          expect(hits, name).toEqual([])
          continue
        }
        expect(hits, name).toEqual(Number(m[1]) >= 16 ? [m.input] : [])
        maps++
      }
    }
    expect(maps).toBeGreaterThanOrEqual(10)
  })
  it('合成名稱 0–99 × 條件逐值(兩遊戲、兩語)', () => {
    for (const c of CONDS) {
      const zh = ci(mapTierFragment(c.v, 2, 'zh')!)
      const en = ci(mapTierFragment(c.v, 2, 'en')!)
      for (let n = 0; n <= 99; n++) {
        const ok = c.ok(n)
        // 「（階級16）」= PobTools 語料行的寫法(沒有空白),剪貼簿是「（階級 16）」
        for (const t of [`地圖（階級 ${n}）`, `凋落的 地圖（階級 ${n}）`, `換界石（階級 ${n}）`, `堅定的地圖（階級${n}）`]) if (zh.test(t) !== ok) throw new Error(`${zh.source} × ${t}`)
        for (const t of [`Map (Tier ${n})`, `Blighted Map (Tier ${n})`, `Waystone (Tier ${n})`]) if (en.test(t) !== ok) throw new Error(`${en.source} × ${t}`)
      }
    }
  })
  it('語料行(# 代入樣本值;本身就是地圖 / 換界石名稱的行除外)與詞綴說明的「(階級: 1)」「(Tier: 1)」都不中', () => {
    // 地圖 / 換界石名稱本身也在語料裡(PoE1 map_mods 的 ambient「地圖（階級#）」與魔法地圖名稱隱藏行、PoE2 換界石名稱):那是正確命中
    const names = corpusLines().filter(l => /（階級 *\d+）|\(Tier \d+\)/.test(l))
    expect(names).toContain('地圖（階級16）')
    expect(names).toContain('Map (Tier 16)')
    const lines = [...corpusLines().filter(l => !names.includes(l)), '{ 前綴 "x" (階級: 1) }', '{ Prefix Modifier "Shocking" (Tier: 1) }', '換界石階級: 16']
    for (const v of [{ min: 1 }, { max: 99 }]) {
      for (const lang of ['zh', 'en'] as const) {
        const r = ci(mapTierFragment(v, 2, lang)!)
        expect(lines.find(l => r.test(l)), `${r.source}`).toBeUndefined()
      }
    }
  })
})

describe('⑤ 舊書籤 / 分享碼(只存數值)→ 新片段:對真實格式屬性行命中集合與舊片段相同', () => {
  /** 真實剪貼簿的屬性行(PoE1 繁中 / 英文地圖、PoE2 英文換界石)+ 每個標籤 0–999 的「: +N% (augmented)」「：+N%」行 */
  function sampleLines (labels: string[]): string[] {
    const out: string[] = []
    for (const dir of ['poe1/test/fixtures/cmn-Hant', 'poe1/test/fixtures/filter-visibility', 'poe1/test/fixtures/en']) {
      for (const name of fs.readdirSync(path.join(ROOT, dir)).filter(n => /^map-.*\.txt$/.test(n))) out.push(...readLines(`${dir}/${name}`))
    }
    out.push(...readLines('poe2/test/zhTW/fixtures/en/waystone-rare-01.txt'))
    for (const lab of labels) for (let n = 0; n <= 999; n++) out.push(`${lab}: +${n}% (augmented)`, `${lab}：+${n}%`, `${lab}: ${n}%`)
    return out.filter(Boolean)
  }
  for (const game of GAMES) {
    it(`${game}:每個百分比項目 × 條件 × 兩語,屬性行(「標籤: …%」)逐行命中集合相同;不同的只有舊寫法誤中的非屬性行`, () => {
      const entries = percentEntries(numPage(game))
      const lines = sampleLines(entries.flatMap(e => [e.zh[0], e.en[0]]))
      let compared = 0
      let realHits = 0
      const oldOnly = new Set<string>()
      for (const e of entries) {
        for (const lang of ['zh', 'en'] as const) {
          const lab = lang === 'zh' ? e.zh[0] : e.en[0]
          const isProperty = (l: string): boolean => new RegExp(`${lab}[:：]`, 'i').test(l)
          for (const c of CONDS) {
            const oldR = ci(propertyFragment(lab, c.v, 3, true)!)
            const newR = ci(e.fragment(c.v, lang)!)
            for (const l of lines) {
              const a = oldR.test(l)
              const b = newR.test(l)
              if (a !== b) {
                // 唯一允許的差異:舊 `.*` 中了不是「標籤: 數值%」格式的行(例:「地圖物品數量詞綴同時以 20% 的值影響凋落保險箱」)
                if (!(a && !b && !isProperty(l))) throw new Error(`${oldR.source} vs ${newR.source} × 「${l}」`)
                oldOnly.add(l)
              }
              if (a && l.includes('(augmented)')) realHits++
              compared++
            }
          }
        }
      }
      expect(compared).toBeGreaterThan(100000)
      expect(realHits).toBeGreaterThan(0)
      if (oldOnly.size) console.log(`[${game}] 舊寫法誤中、新寫法不中的非屬性行:\n  ${[...oldOnly].join('\n  ')}`)
    })
  }
})
