// 無頭驗證:產生一串搜尋字串並反向 Verify。
//   npx tsx src/cli.ts --game poe1 --page map_mods --lang zh --mode any --pick <id,id,...>
//   npx tsx src/cli.ts --game poe2 --page waystone_mods --lang zh --mode none --random 7,5
//   npx tsx src/cli.ts --game poe1 --list                          → 列出頁面
// --pick 接項目 id(GGPK modifier id)或 `#<列號>`;--random <seed,count> 用 selftest 同一個 LCG 抽不重複的列。
// --no-anchors 關掉 ^/$。exit code:Verify ok → 0,否則 1。
import { buildCorpus, entryTitle, type RegexGame, type RegexLang } from './data'
import type { Mode } from './gen'
import { loadRegexCatalogueFile } from './node'
import { samplePicks } from './rng'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
function fail (msg: string): never {
  console.error(msg)
  process.exit(2)
}

const game = (flag('--game') ?? 'poe1') as RegexGame
if (game !== 'poe1' && game !== 'poe2') fail(`--game 只接受 poe1 / poe2(收到 ${game})`)
const lang = (flag('--lang') ?? 'zh') as RegexLang
if (lang !== 'zh' && lang !== 'en') fail(`--lang 只接受 zh / en(收到 ${lang})`)
const mode = (flag('--mode') ?? 'any') as Mode
if (mode !== 'any' && mode !== 'all' && mode !== 'none') fail(`--mode 只接受 any / all / none(收到 ${mode})`)

const cat = loadRegexCatalogueFile(game)
if (args.includes('--list')) {
  for (const p of cat.pages) console.log(`${p.id}\t${p.entries.length} 項\t${p.title} / ${p.titleEn}`)
  process.exit(0)
}
const pageId = flag('--page') ?? cat.pages[0].id
const page = cat.pages.find(p => p.id === pageId)
if (!page) fail(`找不到頁面 ${pageId};可用:${cat.pages.map(p => p.id).join(', ')}`)

let picks: number[] = []
const pickArg = flag('--pick')
const randomArg = flag('--random')
if (pickArg) {
  for (const raw of pickArg.split(',').map(s => s.trim()).filter(Boolean)) {
    const i = raw.startsWith('#') ? Number(raw.slice(1)) : page.entries.findIndex(e => e.id === raw)
    if (!Number.isInteger(i) || i < 0 || i >= page.entries.length) fail(`--pick 找不到 ${raw}`)
    picks.push(i)
  }
} else if (randomArg) {
  const [seed, count] = randomArg.split(',').map(Number)
  if (!Number.isFinite(seed) || !Number.isFinite(count)) fail('--random 格式是 <seed,count>')
  picks = samplePicks(seed, page.entries.length, count)
} else {
  fail('需要 --pick <id,...> 或 --random <seed,count>')
}

const corpus = buildCorpus(page, lang, { anchors: !args.includes('--no-anchors') })
const r = corpus.build(picks, mode)
const v = corpus.verify(picks, r.query)
const name = (i: number): string => `#${i} ${page.entries[i].id}  ${entryTitle(page.entries[i], lang)}`

console.log(`遊戲 ${game}  頁面 ${page.id}(${page.title})  語言 ${lang}  模式 ${mode}  共 ${page.entries.length} 項`)
console.log('勾選:')
for (const i of picks) console.log('  ' + name(i))
console.log(`query:  ${r.query}`)
console.log(`length: ${r.length} / ${page.limit}${r.length > page.limit ? '  ⚠ 超過上限' : ''}`)
console.log(`tokens: ${JSON.stringify(r.usedTokens)}`)
console.log(`unresolved: ${r.unresolved.length}${r.unresolved.length ? '' : '(全部可單獨指定)'}`)
for (const i of r.unresolved) console.log('  ⚠ ' + name(i))
console.log(`Verify: ok=${v.ok}  missing=${JSON.stringify(v.missing)}  extra=${JSON.stringify(v.extra)}  ambient=${JSON.stringify(v.ambient)}`)
const consistent = v.extra.length === 0 && v.ambient.length === 0 && v.missing.length === r.unresolved.length
console.log(`round-trip(extra=0、ambient=0、missing 數 = unresolved 數):${consistent ? 'OK' : 'FAIL'}`)
process.exit(v.ok ? 0 : 1)
