// 物品詞綴數值頁「多種寫法」仲裁檔產生器:regex/scripts/data/item-mod-forms-arb.json(poe2db / poedb 仲裁原始結果)
// → data/regex/item-mod-forms.json(鍵 = `<交易站 stat id>|<ref>`,與 regex/src/pages/item-mods.ts 的 keyOfStat 相同;
// 值 = 站上查得到的寫法,依 stats.ndjson 原順序)。每種寫法都查不到的詞綴不列(維持排除)。
// 不上網;仲裁要重做時先更新 arb 檔(做法見 docs/regex-port.md「多種寫法仲裁」)。
//   node regex/scripts/gen-item-mod-forms.mjs
//   node scripts/verify-data-manifest.mjs --write --prefix data/regex/item-mod-forms.json --source "<…>" --fetched-at 2026-10-10
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ARB = path.join(ROOT, 'regex/scripts/data/item-mod-forms-arb.json')
const OUT = path.join(ROOT, 'data/regex/item-mod-forms.json')
const LANG_DIR = { zh: 'cmn-Hant', en: 'en' }
// 與 item-mods.ts ITEM_MOD_TRADE_CATS 相同順序
const TRADE_CATS = ['explicit', 'implicit', 'crafted', 'fractured']

function statsOf (game, lang) {
  const map = new Map()
  const text = fs.readFileSync(path.join(ROOT, 'data', game, LANG_DIR[lang], 'stats.ndjson'), 'utf8')
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const s = JSON.parse(line)
    if (typeof s.ref !== 'string' || !Array.isArray(s.matchers)) continue
    const ids = s.trade?.ids ?? {}
    let statId = null
    for (const c of TRADE_CATS) {
      const v = ids[c]
      if (Array.isArray(v) && typeof v[0] === 'string') { const d = v[0].indexOf('.'); statId = d >= 0 ? v[0].slice(d + 1) : v[0]; break }
    }
    if (!statId) continue
    const plain = s.matchers.filter(m => m.negate !== true && m.value === undefined && typeof m.string === 'string').map(m => m.string.trim())
    map.set(s.ref, { key: `${statId}|${s.ref}`, plain })
  }
  return map
}

const arb = JSON.parse(fs.readFileSync(ARB, 'utf8'))
const out = { schema: 1, fetchedAt: arb.fetchedAt, sources: arb.sources, note: '由 regex/scripts/gen-item-mod-forms.mjs 產生,勿手改。值 = poe2db / poedb 上查得到的寫法(依 stats.ndjson 順序)。', poe1: { zh: {}, en: {} }, poe2: { zh: {}, en: {} } }
const cache = {}
let missing = 0
for (const r of arb.rows) {
  const stats = (cache[`${r.game}/${r.lang}`] ??= statsOf(r.game, r.lang))
  const s = stats.get(r.ref)
  if (!s) { missing++; console.warn(`找不到 stat:${r.game} ${r.lang} ${r.ref}`); continue }
  const found = r.forms.filter(f => f.found).map(f => f.text)
  if (!found.length) continue
  const forms = s.plain.filter(t => found.includes(t))
  if (forms.length !== found.length) { missing++; console.warn(`寫法對不上 stats.ndjson:${r.game} ${r.lang} ${r.ref}`); continue }
  out[r.game][r.lang][s.key] = forms
}
for (const g of ['poe1', 'poe2']) for (const l of ['zh', 'en']) {
  out[g][l] = Object.fromEntries(Object.entries(out[g][l]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
const n = g => Object.keys(out[g].zh).length + ' zh / ' + Object.keys(out[g].en).length + ' en'
console.log(`寫出 ${path.relative(ROOT, OUT)}:poe1 ${n('poe1')}、poe2 ${n('poe2')}${missing ? `;對不上 ${missing} 筆` : ''}`)
if (missing) process.exitCode = 1
