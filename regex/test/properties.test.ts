// 真實資料性質測試:逐條改寫自 PobTools `host/regex_selftest.cpp` DataTests()(:541–830)。
// 兩語言 × 全部出貨頁(schema 2:PoE1 十頁 + PoE2 七頁),順序與 C++ 報告相同。
// 數字基準(ambient 行數、單獨可指定數、卡住的名稱)來自 C++ 報告 `dist/regex_selftest.txt`,
// 由 golden/extract-from-report.mjs 抽成 golden/selftest-report.json;**允許差 0**。
import { describe, expect, it } from 'vitest'
import type { Mode } from '../src/gen'
import { buildCorpus, entryLines, type RegexLang, type RegexPage } from '../src/data'
import { loadAllRegexPages } from '../src/node'
import { Rng, samplePicks } from '../src/rng'
import golden from './golden/selftest-report.json'

const { pages } = loadAllRegexPages('poe1')

/** regex_selftest.cpp:518 `RoundTrip`:extra / ambient 是致命的;missing 只有在 Build 自己承認 unresolved 時才可接受 */
function roundTrip (page: RegexPage, lang: RegexLang, sel: number[], mode: Mode): string | null {
  const c = buildCorpus(page, lang)
  const r = c.build(sel, mode)
  const v = c.verify(sel, r.query)
  if (v.ambient.length) return `term "${v.ambient[0]}" matches text printed on every item of the page (query "${r.query}")`
  if (v.extra.length) return `false positive: ${v.extra.length} unpicked entries also match "${r.query}"`
  if (v.missing.length !== r.unresolved.length) return `missed ${v.missing.length} picks but only ${r.unresolved.length} were reported unresolvable`
  // TS 端加嚴:exact 時 Verify 必須整體 ok(C++ 由上面三條隱含)
  if (r.exact && !v.ok) return `exact build but Verify not ok (query "${r.query}")`
  return null
}

it('both games shipped, every page names a known game(:552–569)', () => {
  expect(pages.length).toBeGreaterThanOrEqual(2)
  expect(pages.some(p => p.game === 'poe1')).toBe(true)
  expect(pages.some(p => p.game === 'poe2')).toBe(true)
  expect(pages.map(p => `${p.game}/${p.id}`)).toEqual([
    'poe1/map_mods', 'poe1/logbook_mods', 'poe1/scarabs', 'poe1/flask_mods', 'poe1/cluster_jewel',
    'poe1/gem_names', 'poe1/tattoos', 'poe1/heist_equipment_mods', 'poe1/heist_contracts', 'poe1/vendor_bases',
    'poe2/waystone_mods', 'poe2/tablet_mods', 'poe2/relic_mods', 'poe2/expedition_relic_mods',
    'poe2/flask_charm_mods', 'poe2/gem_names', 'poe2/vendor_bases'])
})

for (const lang of ['zh', 'en'] as const) {
  for (const page of pages) {
    // 頁 id 在兩個遊戲會重複(gem_names、vendor_bases),golden 以 遊戲 + 頁 id 對位
    const base = golden.pages.find(g => g.lang === lang && g.page === page.id && g.game === page.game)!
    describe(`[data] ${lang === 'zh' ? '繁中' : 'English'} ${page.title} (${page.game}/${page.id}) -- ${page.entries.length} entries`, () => {
      it('entry count matches the C++ report', () => {
        expect(base, 'golden 缺這一頁').toBeDefined()
        expect(page.entries.length).toBe(base.entries)
      })

      // :617–621
      it(`the page carries ambient text (C++: ${base.ambientLines} lines)`, () => {
        const amb = lang === 'zh' ? page.ambientZh : page.ambientEn
        expect(amb.length > 0 || page.id === 'expedition_relic_mods').toBe(true)
        expect(amb.length).toBe(base.ambientLines)
      })

      // :623–640
      it('no hidden line repeats a printed line', () => {
        const printed = new Set(page.entries.flatMap(o => lang === 'zh' ? o.zh : o.en))
        const same = page.entries.flatMap(d => lang === 'zh' ? d.hiddenZh : d.hiddenEn).filter(h => printed.has(h))
        expect(same).toEqual([])
      })

      // :642–666
      it("every tier line rolls ('#'), none carries a digit", () => {
        const bad: string[] = []
        const tierOk = (raw: string): void => {
          const s = raw.replace(/[A-Z]/g, c => c.toLowerCase())
          for (const k of ['階層：', 'tier: ']) {
            let at = 0
            while ((at = s.indexOf(k, at)) !== -1) {
              at += k.length
              if (at >= s.length || s[at] !== '#') bad.push(s)
            }
          }
        }
        for (const s of lang === 'zh' ? page.ambientZh : page.ambientEn) tierOk(s)
        for (const d of page.entries) for (const h of lang === 'zh' ? d.hiddenZh : d.hiddenEn) tierOk(h)
        expect(bad).toEqual([])
      })

      // :669–686
      it('no two entries print the same first line', () => {
        const seen = new Set<string>()
        let dup = 0
        for (const d of page.entries) {
          const k = entryLines(d, lang).texts[0] ?? ''
          if (seen.has(k)) dup++
          else seen.add(k)
        }
        expect(dup).toBe(0)
      })

      // :688–709:種子 0xC0FFEE + mi*7919,每輪 1..10 個(可重複)隨機列
      const kRounds = page.entries.length > 1000 ? 40 : 120
      const modes: Mode[] = ['any', 'none', 'all']
      modes.forEach((mode, mi) => {
        it(`${mode}: ${kRounds} random picks round-trip`, () => {
          const rng = new Rng((0xC0FFEE + mi * 7919) >>> 0)
          const bad: string[] = []
          for (let round = 0; round < kRounds; round++) {
            const n = 1 + rng.below(10)
            const sel: number[] = []
            for (let k = 0; k < n; k++) sel.push(rng.below(page.entries.length))
            const why = roundTrip(page, lang, sel, mode)
            if (why) bad.push(`round ${round} [${sel.join(',')}]: ${why}`)
          }
          expect(bad).toEqual([])
        })
      })

      // :711–740:種子 0x5EED1234 的 10 個不重複列(逐字長度在 golden.test.ts 比)
      it(`10 picks fit the client's ${page.limit}-character field, shorter than spelling out, exact-or-says-so`, () => {
        const c = buildCorpus(page, lang)
        const sel = samplePicks(0x5EED1234, page.entries.length, 10)
        const r = c.build(sel, 'any')
        let plain = 0
        for (const i of sel) plain += [...entryLines(page.entries[i], lang).texts[0]].length + 1
        expect(r.length).toBeLessThanOrEqual(page.limit)
        expect(r.length).toBeLessThan(plain)
        expect(r.length <= page.limit || !r.exact).toBe(true)
      })

      // :742–803
      it(`singly findable matches C++ (${base.findable} / ${base.tried}), stuck by hidden/ambient = ${base.stuckByHidden}`, () => {
        const c = buildCorpus(page, lang)
        const bare = buildCorpus(page, lang, { hidden: false })
        const step = page.entries.length > 400 ? Math.floor(page.entries.length / 400) : 1
        let tried = 0
        const stuck: string[] = []
        const stuckBare: string[] = []
        const badVerify: string[] = []
        for (let i = 0; i < page.entries.length; i += step) {
          tried++
          const want = lang === 'zh' ? page.entries[i].zh : page.entries[i].en
          const name = want.length ? want[0] : page.entries[i].id
          const r = c.build([i], 'any')
          if (r.exact) {
            if (!c.verify([i], r.query).ok) badVerify.push(`${name} -> ${r.query}`)
            continue
          }
          stuck.push(name)
          if (bare.build([i], 'any').exact) stuckBare.push(name)
        }
        expect(badVerify).toEqual([])
        expect(stuck.length * 4).toBeLessThanOrEqual(tried)
        // 與 C++ 報告逐項對照(報告只印前 5 個名稱)
        expect({
          findable: tried - stuck.length,
          tried,
          stuckExamples: stuck.slice(0, 5),
          stuckByHidden: stuckBare.length,
          stuckByHiddenExamples: stuckBare.slice(0, 5)
        }).toEqual({
          findable: base.findable,
          tried: base.tried,
          stuckExamples: base.stuckExamples,
          stuckByHidden: base.stuckByHidden,
          stuckByHiddenExamples: base.stuckByHiddenExamples
        })
      })
    })
  }
}
