// 重算 selftest-report.json 的 poe1 列(pages / tenPicks / mapAilment),算法與 properties.test.ts / golden.test.ts 相同。
// PobTools 已移除正則、C++ 報告不再產生(CLAUDE.md 規則 11:由 TS 實作算出後更新)。只動 poe1,poe2 列與 synthetic 不碰。
// golden 裡沒有的新頁會加在最後(測試以 lang / game / page 查找,順序不影響)。
//   npx tsx test/golden/recompute-poe1.ts            → 印出差異
//   npx tsx test/golden/recompute-poe1.ts --write    → 寫回
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCorpus, entryLines } from '../../src/data'
import { loadAllRegexPages } from '../../src/node'
import { samplePicks } from '../../src/rng'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'selftest-report.json')
const golden = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const pages = loadAllRegexPages('poe1').pages.filter(p => p.game === 'poe1')

for (const lang of ['zh', 'en'] as const) {
  for (const page of pages) {
    const c = buildCorpus(page, lang)
    const bare = buildCorpus(page, lang, { hidden: false })
    const step = page.entries.length > 400 ? Math.floor(page.entries.length / 400) : 1
    let tried = 0
    const stuck: string[] = []
    const stuckBare: string[] = []
    for (let i = 0; i < page.entries.length; i += step) {
      tried++
      const want = lang === 'zh' ? page.entries[i].zh : page.entries[i].en
      const name = want.length ? want[0] : page.entries[i].id
      if (c.build([i], 'any').exact) continue
      stuck.push(name)
      if (bare.build([i], 'any').exact) stuckBare.push(name)
    }
    const row = {
      lang, game: 'poe1', page: page.id, entries: page.entries.length,
      ambientLines: (lang === 'zh' ? page.ambientZh : page.ambientEn).length,
      findable: tried - stuck.length, tried, stuckExamples: stuck.slice(0, 5),
      stuckByHidden: stuckBare.length, stuckByHiddenExamples: stuckBare.slice(0, 5)
    }
    const at = golden.pages.findIndex((g: any) => g.lang === lang && g.game === 'poe1' && g.page === page.id)
    if (at < 0) {
      console.log('pages 新頁', JSON.stringify(row))
      golden.pages.push(row)
    } else {
      if (JSON.stringify(golden.pages[at]) !== JSON.stringify(row)) console.log('pages', JSON.stringify(golden.pages[at]), '\n   →', JSON.stringify(row))
      golden.pages[at] = row
    }

    const sel = samplePicks(0x5EED1234, page.entries.length, 10)
    const r = c.build(sel, 'any')
    let plain = 0
    for (const i of sel) plain += [...entryLines(page.entries[i], lang).texts[0]].length + 1
    const t = golden.tenPicks.find((g: any) => g.lang === lang && g.game === 'poe1' && g.page === page.id)
    if (!t) {
      console.log('tenPicks 新頁', lang, page.id, `${r.length}/${plain}`)
      golden.tenPicks.push({ lang, game: 'poe1', page: page.id, length: r.length, plain })
      continue
    }
    if (t.length !== r.length || t.plain !== plain) console.log('tenPicks', lang, page.id, `${t.length}/${t.plain} → ${r.length}/${plain}`)
    t.length = r.length
    t.plain = plain
  }
}

const map = pages.find(p => p.id === 'map_mods')!
const idx = map.entries.findIndex(e => e.zh[0] === '怪物有 #% 機率避免元素異常狀態')
const cz = buildCorpus(map, 'zh')
const v = cz.verify([idx], '"常"')
const ma = { query: cz.build([idx], 'any').query, bareExtra: v.extra.length, bareAmbient: v.ambient.length }
if (JSON.stringify(ma) !== JSON.stringify(golden.mapAilment)) console.log('mapAilment', JSON.stringify(golden.mapAilment), '→', JSON.stringify(ma))
golden.mapAilment = ma

if (process.argv.includes('--write')) {
  fs.writeFileSync(FILE, JSON.stringify(golden, null, 2) + '\n')
  console.log('寫回', FILE)
}
