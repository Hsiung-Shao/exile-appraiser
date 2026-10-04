// 第 32 步:數值條件嵌進詞綴頁(sections.ts / embed.ts)的遷移往返。
// 「舊」= 改版前 renderer store 的做法(數值頁 map_numeric / waystone_numeric 是獨立頁、cat.pages 順序 = 語料頁 → 數值頁 → 商店頁);
// 「新」= 改版後 store 走的純函式(savedPicksOf / combineSels / bookmarkApplyOf / resolveState + resolvedValues)。
// 斷言:舊 state / 書籤 / 分享碼 / 範本 → 新結構後,產出的正則與舊版**逐字相同**;寫回是新結構,再讀一次不變。
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { combine, type CombineSel } from '../src/combine'
import type { RegexPage } from '../src/data'
import type { Mode } from '../src/gen'
import { loadAllPagesFor } from '../src/node'
import { applyPageKeys, combineOrder, isSectionPage, listedPages, pageKeysOf, sectionPageOf, type AlgoPage, type AlgoValue } from '../src/pages'
import { Rng } from '../src/rng'
import { base64url, decodeShare, encodeShare, parseTemplates, resolveState } from '../src/share'
import { SECTION_HOSTS, numericKeyOf, sectionHostOf, sectionIdOf } from '../src/sections'
import { migrateSections, parseRegexState, serializeRegexState, type RegexUiState } from '../src/state'
import { bookmarkApplyOf, bookmarkBodyOf, combineSels, resolvedValues, savedPicksOf, shareStateOf } from '../src/embed'
import { condText, sectionSummary } from '../src/view'

const GAMES = ['poe1', 'poe2'] as const
const all = { poe1: loadAllPagesFor('poe1'), poe2: loadAllPagesFor('poe2') }
const HOST = { poe1: 'map_mods', poe2: 'waystone_mods' } as const
const SEC = { poe1: 'map_numeric', poe2: 'waystone_numeric' } as const
const VENDOR = { poe1: 'vendor_items', poe2: 'vendor_items_poe2' } as const
const OTHER = { poe1: 'logbook_mods', poe2: 'tablet_mods' } as const
const MODES: Mode[] = ['any', 'all', 'none']
const byId = (pages: RegexPage[], id: string): RegexPage => pages.find(p => p.id === id)!

type OldCurrent = Array<{ page: string, keys: string[], alt: string[] }>
interface OldFile {
  schema: 2
  game: string
  page: string
  mode: Mode
  lang: 'zh' | 'en'
  bilingual: boolean
  current: OldCurrent
  bookmarks: Array<{ name: string, page: string, game: string, mode: Mode, lang: 'zh' | 'en', keys: string[], alt: string[], numeric?: Record<string, AlgoValue> }>
  numeric: Record<string, Record<string, AlgoValue>>
  custom: string[]
  excludes: string[]
  outScope: 'combined' | 'page'
}

/** 改版前 store 的 `combined`:cat.pages 順序、每頁 picks = applyPageKeys(存下的鍵)、values = numeric[頁 id] */
function oldCombined (pages: RegexPage[], f: OldFile, lang: 'zh' | 'en', mode: Mode) {
  const sels: CombineSel[] = []
  for (const p of pages) {
    const saved = f.current.find(x => x.page === p.id)
    if (!saved) continue
    const picks = applyPageKeys(p, saved.keys, saved.alt).picked
    if (picks.length) sels.push({ page: p, picks, values: f.numeric[p.id] })
  }
  return combine({ lang, mode, pages: sels, custom: f.custom, excludes: f.excludes })
}

/** 改版後 store 的 `combined`:savedPicksOf + combineSels */
function newCombined (pages: RegexPage[], s: RegexUiState, lang: 'zh' | 'en', mode: Mode) {
  const picks: Record<string, number[]> = {}
  for (const p of pages) { const r = savedPicksOf(p, s); if (r) picks[p.id] = r.picked }
  return combine({ lang, mode, pages: combineSels(pages, picks, s.numeric), custom: s.custom, excludes: s.excludes })
}

function randomValue (rng: Rng, p: AlgoPage, i: number): AlgoValue {
  const e = p.entries[i]
  if (e.input.kind !== 'range') return { ...e.input.def }
  const lo = e.input.lo
  const span = e.input.hi - lo
  const a = lo + rng.below(span + 1)
  const b = lo + rng.below(span + 1)
  switch (rng.below(3)) {
    case 0: return { min: a }
    case 1: return { max: a }
    default: return { min: Math.min(a, b), max: Math.max(a, b) }
  }
}

function pickSome (rng: Rng, n: number, max: number): number[] {
  const out = new Set<number>()
  const want = Math.min(n, rng.below(max + 1))
  while (out.size < want) out.add(rng.below(n))
  return [...out].sort((a, b) => a - b)
}

/** 隨機的舊格式(schema 2)regex_state.json */
function oldFile (game: 'poe1' | 'poe2', seed: number): OldFile {
  const pages = all[game]
  const rng = new Rng(seed)
  const host = byId(pages, HOST[game])
  const sec = byId(pages, SEC[game]) as AlgoPage
  const vendor = byId(pages, VENDOR[game]) as AlgoPage
  const other = byId(pages, OTHER[game])
  const current: OldCurrent = []
  const numeric: Record<string, Record<string, AlgoValue>> = {}
  for (const p of [host, other, sec, vendor]) {
    const picks = pickSome(rng, p.entries.length, p === sec ? p.entries.length : 6)
    if (!picks.length) continue
    const k = pageKeysOf(p, picks)
    current.push({ page: p.id, keys: k.keys, alt: k.alt })
  }
  // 數值頁的值:勾選的與沒勾的都可能存過(舊 store 改值會自動勾,取消勾選後值仍留著)
  numeric[sec.id] = {}
  for (let i = 0; i < sec.entries.length; i++) if (rng.below(2)) numeric[sec.id][sec.entries[i].id] = randomValue(rng, sec, i)
  numeric[vendor.id] = Object.fromEntries(vendor.entries.map(e => [e.id, { ...e.input.def }]))
  const hostKeys = current.find(c => c.page === host.id)
  const secKeys = current.find(c => c.page === sec.id)
  return {
    schema: 2,
    game,
    page: rng.below(2) ? sec.id : host.id,
    mode: MODES[rng.below(3)],
    lang: rng.below(2) ? 'en' : 'zh',
    bilingual: true,
    current,
    bookmarks: [
      ...(secKeys ? [{ name: '數值', page: sec.id, game, mode: 'any' as Mode, lang: 'zh' as const, keys: secKeys.keys, alt: secKeys.alt, numeric: Object.fromEntries(secKeys.keys.map(k => [k, numeric[sec.id][k] ?? sec.entries.find(e => e.id === k)!.input.def])) }] : []),
      ...(hostKeys ? [{ name: '詞綴', page: host.id, game, mode: 'none' as Mode, lang: 'en' as const, keys: hostKeys.keys, alt: hostKeys.alt }] : [])
    ],
    numeric,
    custom: rng.below(2) ? ['自訂 甲'] : [],
    excludes: rng.below(2) ? ['反射'] : [],
    outScope: 'combined'
  }
}

describe('sections:頁組成', () => {
  for (const g of GAMES) {
    it(`${g}:數值頁不在下拉選單、宿主頁後面緊接數值區`, () => {
      const pages = all[g]
      const listed = listedPages(pages).map(p => p.id)
      expect(listed).not.toContain(SEC[g])
      expect(listed).toContain(HOST[g])
      expect(listed).toContain(VENDOR[g])
      const sec = sectionPageOf(pages, HOST[g])!
      expect(sec.id).toBe(SEC[g])
      expect(isSectionPage(sec)).toBe(true)
      expect(sectionPageOf(pages, OTHER[g])).toBeNull()
      const order = combineOrder(pages).map(p => p.id)
      expect(order.indexOf(SEC[g])).toBe(order.indexOf(HOST[g]) + 1)
      expect(order.indexOf(SEC[g])).toBeLessThan(order.indexOf(VENDOR[g]))
      expect(combineOrder(pages, HOST[g]).map(p => p.id)).toEqual([HOST[g], SEC[g]])
      expect(combineOrder(pages, VENDOR[g]).map(p => p.id)).toEqual([VENDOR[g]])
    })
  }
  it('id 對照', () => {
    expect(SECTION_HOSTS).toEqual({ map_numeric: 'map_mods', waystone_numeric: 'waystone_mods' })
    expect(sectionHostOf('map_numeric')).toBe('map_mods')
    expect(sectionHostOf('map_mods')).toBeUndefined()
    expect(sectionHostOf('toString')).toBeUndefined()
    expect(sectionIdOf('waystone_mods')).toBe('waystone_numeric')
    expect(numericKeyOf('map_numeric')).toBe('map_mods')
    expect(numericKeyOf('vendor_items')).toBe('vendor_items')
  })
})

describe('sections:regex_state.json 遷移(schema 2 → 3)', () => {
  it('固定案例:勾選 / 數值 / 記住的頁 / 書籤都搬到宿主頁', () => {
    const f = {
      schema: 2, game: 'poe1', page: 'map_numeric', mode: 'any', lang: 'zh', bilingual: true,
      current: [
        { page: 'map_mods', keys: ['#% more Monster Life'], alt: ['怪物生命'] },
        { page: 'map_numeric', keys: ['tier', 'quantity'], alt: ['地圖階級', '物品數量'] },
        { page: 'vendor_items', keys: ['links'], alt: ['連結'] }
      ],
      bookmarks: [
        { name: 'n', page: 'map_numeric', game: 'poe1', mode: 'any', lang: 'zh', keys: ['tier'], alt: ['地圖階級'], numeric: { tier: { min: 16 } } },
        { name: 'm', page: 'map_mods', game: 'poe1', mode: 'none', lang: 'zh', keys: ['#% more Monster Life'], alt: ['x'] }
      ],
      numeric: { map_numeric: { tier: { min: 16 }, rarity: { max: 40 } }, vendor_items: { links: { choice: '6' } } },
      custom: [], excludes: [], outScope: 'page'
    }
    const r = parseRegexState(JSON.stringify(f))
    expect(r.ok).toBe(true)
    const s = r.state
    expect(s.page).toBe('map_mods')
    expect(s.current).toEqual([
      { page: 'map_mods', keys: ['#% more Monster Life'], alt: ['怪物生命'], num: ['tier', 'quantity'] },
      { page: 'vendor_items', keys: ['links'], alt: ['連結'] }
    ])
    expect(s.numeric).toEqual({ map_mods: { tier: { min: 16 }, rarity: { max: 40 } }, vendor_items: { links: { choice: '6' } } })
    expect(s.bookmarks[0]).toEqual({ name: 'n', page: 'map_mods', game: 'poe1', mode: 'any', lang: 'zh', keys: [], alt: [], num: ['tier'], numeric: { tier: { min: 16 } } })
    expect(s.bookmarks[1].num).toBeUndefined()
    // 寫回是新結構(schema 3、沒有舊頁 id),再讀一次不變;遷移可重複呼叫
    const text = serializeRegexState(s)
    const doc = JSON.parse(text)
    expect(doc.schema).toBe(4) // 第 33 步起 schema 4(書籤熱鍵);數值區結構同 3
    expect(text).not.toMatch(/map_numeric|waystone_numeric/)
    expect(parseRegexState(text).state).toEqual(s)
    const again = structuredClone(s)
    expect(migrateSections(again)).toBe(false)
    expect(again).toEqual(s)
  })
  it('只有數值頁的勾選(宿主頁沒勾)→ 宿主頁一筆 keys 空、num 有值;寫回保留', () => {
    const r = parseRegexState(JSON.stringify({ current: [{ page: 'waystone_numeric', keys: ['tier'], alt: [] }], bookmarks: [] }))
    expect(r.state.current).toEqual([{ page: 'waystone_mods', keys: [], alt: [], num: ['tier'] }])
    expect(parseRegexState(serializeRegexState(r.state)).state.current).toEqual(r.state.current)
  })
  it('只有 num 的新書籤不會被當成空書籤丟掉', () => {
    const r = parseRegexState(JSON.stringify({ bookmarks: [{ name: 'a', page: 'map_mods', keys: [], alt: [], num: ['tier'] }] }))
    expect(r.state.bookmarks.length).toBe(1)
  })

  for (const g of GAMES) {
    it(`${g}:40 組隨機舊檔 × 2 語 × 3 模式 —— 合併輸出逐字相同`, () => {
      const pages = all[g]
      for (let seed = 1; seed <= 40; seed++) {
        const f = oldFile(g, seed * 7919 + (g === 'poe2' ? 3 : 0))
        const s = parseRegexState(JSON.stringify(f)).state
        expect(JSON.stringify(s)).not.toMatch(/map_numeric|waystone_numeric/)
        const back = parseRegexState(serializeRegexState(s)).state
        for (const lang of ['zh', 'en'] as const) {
          for (const mode of MODES) {
            const want = oldCombined(pages, f, lang, mode)
            const got = newCombined(pages, s, lang, mode)
            expect(got.query, `seed ${seed} ${lang} ${mode}`).toBe(want.query)
            expect(got.length).toBe(want.length)
            expect(got.limit).toBe(want.limit)
            expect(got.conflicts).toEqual(want.conflicts)
            expect(newCombined(pages, back, lang, mode).query).toBe(want.query)
          }
        }
      }
    })

    it(`${g}:舊書籤(數值頁 / 詞綴頁 / 商店頁)載入後單頁輸出逐字相同`, () => {
      const pages = all[g]
      const sec = byId(pages, SEC[g]) as AlgoPage
      const vendor = byId(pages, VENDOR[g]) as AlgoPage
      let checked = 0
      for (let seed = 1; seed <= 30; seed++) {
        const f = oldFile(g, seed * 104729 + 11)
        f.bookmarks.push({ name: '商店', page: vendor.id, game: g, mode: 'any', lang: 'zh', keys: [vendor.entries[0].id], alt: [''], numeric: { [vendor.entries[0].id]: { ...vendor.entries[0].input.def } } })
        const s = parseRegexState(JSON.stringify(f)).state
        expect(s.bookmarks.length).toBe(f.bookmarks.length)
        f.bookmarks.forEach((ob, k) => {
          // 舊 loadBookmark:選該頁、該頁勾選 = 書籤鍵、數值併入 numeric[該頁];單頁輸出 = 只有該頁
          const op = byId(pages, ob.page)
          const oldValues = { ...(f.numeric[op.id] ?? {}), ...(ob.numeric ?? {}) }
          const want = combine({ lang: ob.lang, mode: ob.mode, pages: [{ page: op, picks: applyPageKeys(op, ob.keys, ob.alt).picked, values: oldValues }] })
          // 新:migrated 書籤 → bookmarkApplyOf → 單頁(宿主頁 + 數值區)
          const nb = s.bookmarks[k]
          const a = bookmarkApplyOf(pages, nb)!
          expect(a.missed).toBe(0)
          const values: Record<string, Record<string, AlgoValue>> = { ...s.numeric }
          for (const [key, m] of Object.entries(a.values)) values[key] = { ...(values[key] ?? {}), ...m }
          const got = combine({ lang: nb.lang, mode: nb.mode, pages: combineSels(pages, a.picks, values, a.page.id) })
          expect(a.page.id).toBe(op.id === sec.id ? HOST[g] : op.id)
          expect(got.query, `seed ${seed} bookmark ${ob.name}`).toBe(want.query)
          checked++
        })
      }
      expect(checked).toBeGreaterThan(60)
    })
  }

  it('新書籤本體:宿主頁 = 詞綴 keys + 數值區 num / numeric;往返 bookmarkApplyOf 回到同一組勾選', () => {
    const pages = all.poe1
    const host = byId(pages, 'map_mods')
    const sec = sectionPageOf(pages, host)!
    const picks = { map_mods: [2, 9], map_numeric: [0, 3] }
    const values = { map_mods: { tier: { min: 14 }, pack: { max: 20 } } }
    const body = bookmarkBodyOf(pages, host, picks, values, { game: 'poe1', mode: 'all', lang: 'zh' })!
    expect(body.keys).toEqual(pageKeysOf(host, [2, 9]).keys)
    expect(body.num).toEqual([sec.entries[0].id, sec.entries[3].id])
    expect(body.numeric).toEqual({ tier: { min: 14 }, [sec.entries[3].id]: sec.entries[3].id === 'pack' ? { max: 20 } : { ...sec.entries[3].input.def } })
    const a = bookmarkApplyOf(pages, { name: 'x', ...body })!
    expect(a.picks).toEqual(picks)
    // 只勾數值區也能存;什麼都沒勾 = null
    expect(bookmarkBodyOf(pages, host, { map_numeric: [1] }, {}, { game: 'poe1', mode: 'any', lang: 'zh' })!.keys).toEqual([])
    expect(bookmarkBodyOf(pages, host, {}, {}, { game: 'poe1', mode: 'any', lang: 'zh' })).toBeNull()
    // 未遷移的數值頁書籤(防禦路徑)也轉到宿主頁
    const legacy = bookmarkApplyOf(pages, { name: 'l', page: 'map_numeric', game: 'poe1', mode: 'any', lang: 'zh', keys: ['tier'], alt: [], numeric: { tier: { min: 16 } } })!
    expect(legacy.page.id).toBe('map_mods')
    expect(legacy.picks).toEqual({ map_mods: [], map_numeric: [0] })
    expect(legacy.values).toEqual({ map_mods: { tier: { min: 16 } } })
  })
})

/** 舊版(v1)分享碼:舊程式的 encodeShare 寫法 = JSON → gzip → base64url */
function legacyCode (doc: unknown): string {
  return base64url(new Uint8Array(zlib.gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'))))
}

/** 舊 applyCombo:resolveState 舊版(頁 id 直接對)→ cat.pages 順序合併 */
function oldComboCombined (pages: RegexPage[], raw: { mode: Mode, pages: Record<string, string[]>, numeric: Record<string, Record<string, AlgoValue>>, custom: string[], excludes: string[] }, lang: 'zh' | 'en') {
  const sels: CombineSel[] = []
  for (const p of pages) {
    const keys = raw.pages[p.id]
    if (!keys) continue
    const picks = applyPageKeys(p, keys).picked
    if (picks.length) sels.push({ page: p, picks, values: raw.numeric[p.id] })
  }
  return combine({ lang, mode: raw.mode, pages: sels, custom: raw.custom, excludes: raw.excludes })
}

function newComboCombined (pages: RegexPage[], st: Parameters<typeof resolveState>[0], lang: 'zh' | 'en') {
  const r = resolveState(st, pages)
  return { r, c: combine({ lang, mode: st.mode, pages: combineSels(pages, r.picks, resolvedValues(r.values)), custom: st.custom, excludes: st.excludes }) }
}

describe('sections:分享碼 v1 → v2', () => {
  for (const g of GAMES) {
    it(`${g}:20 組隨機 v1 舊碼 → 解碼為 v2 結構,輸出逐字相同;再複製(v2)往返不變`, async () => {
      const pages = all[g]
      for (let seed = 1; seed <= 20; seed++) {
        const f = oldFile(g, seed * 31337 + 5)
        const raw = {
          v: 1, game: g, mode: f.mode,
          pages: Object.fromEntries(f.current.map(c => [c.page, c.keys])),
          // 舊 currentShareState:數值只含已勾選項目
          numeric: Object.fromEntries(f.current.filter(c => c.page === SEC[g] || c.page === VENDOR[g]).map(c => {
            const p = byId(pages, c.page) as AlgoPage
            return [c.page, Object.fromEntries(c.keys.map(k => [k, f.numeric[c.page]?.[k] ?? p.entries.find(e => e.id === k)!.input.def]))]
          })),
          custom: f.custom,
          excludes: f.excludes
        }
        const d = await decodeShare(legacyCode(raw))
        expect(d.warnings).toEqual([])
        expect(d.state.v).toBe(2)
        expect(JSON.stringify(d.state)).not.toMatch(/map_numeric|waystone_numeric/)
        const secKeys = raw.pages[SEC[g]]
        if (secKeys) expect(d.state.sections[HOST[g]]).toEqual(secKeys)
        for (const lang of ['zh', 'en'] as const) {
          const want = oldComboCombined(pages, raw, lang)
          const { r, c } = newComboCombined(pages, d.state, lang)
          expect(r.missed).toBe(0)
          expect(r.unknownPages).toEqual([])
          expect(c.query, `seed ${seed} ${lang}`).toBe(want.query)
          // 套用後再「複製分享碼」= v2;解碼回來同一串
          const again = shareStateOf(g, pages, r.picks, resolvedValues(r.values), { mode: d.state.mode, custom: d.state.custom, excludes: d.state.excludes })
          const code2 = await encodeShare(again)
          const d2 = await decodeShare(code2)
          expect(d2.state).toEqual(again)
          expect(newComboCombined(pages, d2.state, lang).c.query).toBe(want.query)
        }
      }
    })
  }
})

describe('sections:範本 / templates.json', () => {
  it('舊格式範本(map_numeric)讀入轉成 sections,輸出與舊版相同', () => {
    const raw = {
      id: 'legacy', game: 'poe1', mode: 'any',
      pages: { map_mods: ['#% more Monster Life'], map_numeric: ['tier', 'quantity'] },
      numeric: { map_numeric: { tier: { min: 16 }, quantity: { min: 80 } } },
      custom: [], excludes: []
    }
    const r = parseTemplates({ templates: [raw] })
    expect(r.errors).toEqual([])
    const t = r.templates[0]
    expect(t.state.pages).toEqual({ map_mods: ['#% more Monster Life'] })
    expect(t.state.sections).toEqual({ map_mods: ['tier', 'quantity'] })
    expect(t.state.numeric).toEqual({ map_mods: { tier: { min: 16 }, quantity: { min: 80 } } })
    for (const lang of ['zh', 'en'] as const) {
      const want = oldComboCombined(all.poe1, raw as never, lang)
      expect(newComboCombined(all.poe1, t.state, lang).c.query).toBe(want.query)
      expect(want.query).toMatch(/階級|Tier/)
    }
  })
  it('出貨的 templates.json 沒有引用舊頁 id(不需改檔)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { defaultRegexDataDir } = await import('../src/node')
    expect(fs.readFileSync(path.join(defaultRegexDataDir(), 'templates.json'), 'utf8')).not.toMatch(/map_numeric|waystone_numeric/)
  })
})

describe('sections:收合摘要(view.ts)', () => {
  const sec = sectionPageOf(all.poe1, 'map_mods')!
  const e = (id: string) => sec.entries.find(x => x.id === id)!
  it('condText:≥ / ≤ / 區間、百分比、不成立', () => {
    expect(condText(e('tier'), { min: 16 }, 'zh')).toBe('≥16')
    expect(condText(e('quantity'), { min: 80 }, 'zh')).toBe('≥80%')
    expect(condText(e('quantity'), { max: 40 }, 'en')).toBe('≤40%')
    expect(condText(e('rarity'), { min: 50, max: 120 }, 'zh')).toBe('50–120%')
    expect(condText(e('rarity'), {}, 'zh')).toBeNull()
    expect(condText(e('rarity'), { min: 90, max: 10 }, 'zh')).toBeNull()
  })
  it('sectionSummary:只列勾選、列順序、名稱依介面語言', () => {
    const tierIdx = sec.entries.indexOf(e('tier'))
    const qtyIdx = sec.entries.indexOf(e('quantity'))
    const vals: Record<string, AlgoValue> = { quantity: { min: 80 } }
    const got = sectionSummary(sec, [qtyIdx, tierIdx], x => vals[x.id] ?? x.input.def, 'zh')
    expect(got.map(x => x.id)).toEqual(['tier', 'quantity'])
    expect(got[0]).toEqual({ id: 'tier', label: e('tier').zh[0], cond: '≥16' })
    expect(got[1].cond).toBe('≥80%')
    expect(sectionSummary(sec, [tierIdx], x => x.input.def, 'en')[0].label).toBe(e('tier').en[0])
    expect(sectionSummary(sec, [], x => x.input.def, 'zh')).toEqual([])
  })
})
