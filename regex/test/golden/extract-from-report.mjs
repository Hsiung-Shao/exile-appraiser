// @ts-check
// 從 C++ `pob-zh.exe --regex-selftest` 的報告(pob-zh-engine `dist/regex_selftest.txt`)抽出逐字印出的 golden 值,
// 寫成 selftest-report.json(golden.test.ts 讀它)。報告格式改了這裡就會丟例外,不會悄悄少抽。
//   node regex/test/golden/extract-from-report.mjs ../pob-zh-engine/dist/regex_selftest.txt
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = process.argv[2]
if (!src) { console.error('用法:extract-from-report.mjs <regex_selftest.txt>'); process.exit(2) }
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/)

/** 報告行的說明文字 → golden 名稱(報告印的是 `check(..., "<說明>: " + r.query)`) */
const SYNTHETIC = [
  ['T1 one pick', '[T1]', 'query selects exactly the pick: '],
  ['T1 two picks', '[T1]', 'two picks: '],
  ['T2 different tails', '[T2]', 'and it selects only the first: '],
  ['T3 prefix', '[T3]', "a prefix-only match needs '^': "],
  ['T3 suffix', '[T3]', "a suffix-only match needs '$': "],
  ['T4 mixed case', '[T4]', 'mixed case: '],
  ['T5 any', '[T5]', 'Any is one quoted term: '],
  ['T5 none', '[T5]', 'None negates it: '],
  ['T5 all', '[T5]', 'All is separate terms, never an alternation: '],
  ['T7 build', '[T7]', 'and Build agrees: '],
  ['T9 repeat', '[T9]', 'repeat run: '],
  ['T13 printed only', '[T13]', 'the query is cut from the printed line only: '],
  ['T14 longer piece', '[T14]', 'still resolvable with a longer piece: '],
  ['T14 both picked', '[T14]', 'with both picked the shared text is fair game again: '],
  ['T14 all', '[T14]', 'All resolves both: '],
  ['T15 past ambient', '[T15]', 'resolvable past the ambient text: '],
  ['T15 name seam', '[T15]', 'a token never straddles the seam of a rare name: '],
  ['T16 mid-way', '[T16]', "a '^' token clears a hidden line that has the text mid-way: "],
  ['T16 fully anchored', '[T16]', 'a hidden line starting with it forces the fully anchored form: ']
]

/** @type {Record<string,string>} */
const synthetic = {}
for (const [name, section, prefix] of SYNTHETIC) {
  const start = lines.findIndex(l => l.startsWith(section + ' '))
  if (start < 0) throw new Error(`報告裡沒有 ${section}`)
  const hit = lines.slice(start).find(l => l.startsWith('  [PASS] ' + prefix))
  if (!hit) throw new Error(`${section} 沒有 PASS 行「${prefix}」`)
  synthetic[name] = hit.slice(('  [PASS] ' + prefix).length)
}

const TITLE_TO_PAGE = {
  '地圖詞綴': 'map_mods', '探險日誌詞綴': 'logbook_mods', '換界石詞綴': 'waystone_mods',
  '碑牌詞綴': 'tablet_mods', '聖物詞綴': 'relic_mods', '探險遺物詞綴': 'expedition_relic_mods'
}
const tenPicks = []
const singly = []
let cur = null
for (const l of lines) {
  const d = /^\[data\] (繁中|English) (\S+) -- (\d+) entries$/.exec(l)
  if (d) {
    const page = TITLE_TO_PAGE[d[2]]
    if (!page) throw new Error(`未知頁名 ${d[2]}`)
    cur = { lang: d[1] === '繁中' ? 'zh' : 'en', page, entries: Number(d[3]) }
    continue
  }
  if (!cur) continue
  let m = /^ {8}10 picks: (\d+) characters \(spelled out: (\d+)\)$/.exec(l)
  if (m) tenPicks.push({ lang: cur.lang, page: cur.page, length: Number(m[1]), plain: Number(m[2]) })
  m = /^ {8}singly findable: (\d+) \/ (\d+)(?: {3}stuck: (.*))?$/.exec(l)
  if (m) singly.push({ lang: cur.lang, page: cur.page, findable: Number(m[1]), tried: Number(m[2]), stuckExamples: m[3] ? m[3].split(' / ') : [] })
  m = /^ {8}stuck by hidden\/ambient text: (\d+)(?: \((.*)\))?$/.exec(l)
  if (m) Object.assign(singly[singly.length - 1], { stuckByHidden: Number(m[1]), stuckByHiddenExamples: m[2] ? m[2].split(' / ') : [] })
  m = /^ {2}\[PASS\] the page carries ambient text \((\d+) lines\)$/.exec(l)
  if (m) singly.push({ lang: cur.lang, page: cur.page, entries: cur.entries, ambientLines: Number(m[1]) })
}
// 把「ambient 行數」那筆與「singly」那筆合併成一頁一筆
/** @type {Record<string, any>} */
const perPage = {}
for (const s of singly) {
  const k = `${s.lang}/${s.page}`
  perPage[k] = { ...(perPage[k] ?? {}), ...s }
}
const pages = Object.values(perPage)
if (tenPicks.length !== 12 || pages.length !== 12) throw new Error(`預期 12 頁(2 語言 × 6 頁),抽到 tenPicks=${tenPicks.length} pages=${pages.length}`)

const ma = lines.find(l => l.includes('a bare 常 is known to reach other maps'))
const mb = lines.find(l => l.includes('and the entry is built without it: '))
const mam = ma && /\((\d+) entries, (\d+) ambient\)/.exec(ma)
if (!mam || !mb) throw new Error('報告裡沒有「常」回歸那兩行')
const pass = /^PASS (\d+) {3}FAIL (\d+)$/.exec(lines.find(l => l.startsWith('PASS ')) ?? '')

const out = {
  _source: 'pob-zh-engine dist/regex_selftest.txt(pob-zh.exe --regex-selftest);由 extract-from-report.mjs 產生,勿手改',
  _cppPassFail: pass ? { pass: Number(pass[1]), fail: Number(pass[2]) } : null,
  synthetic,
  tenPicks,
  pages,
  mapAilment: { query: mb.split('and the entry is built without it: ')[1], bareExtra: Number(mam[1]), bareAmbient: Number(mam[2]) }
}
const dst = path.join(path.dirname(fileURLToPath(import.meta.url)), 'selftest-report.json')
fs.writeFileSync(dst, JSON.stringify(out, null, 2) + '\n')
console.log(`寫入 ${dst}:synthetic ${Object.keys(synthetic).length}、tenPicks ${tenPicks.length}、pages ${pages.length}`)
