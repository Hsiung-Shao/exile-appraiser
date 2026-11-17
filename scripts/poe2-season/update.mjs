// @ts-check
// PoE2 賽季資料更新:依規則更新 data/poe2/{en,cmn-Hant}/stats.ndjson(規則見 lib.mjs 與 CLAUDE.md 規則 1)。
// 2026-11-18 起 data/poe2 由本專案維護(底 = ee2-patched fc7de73),不再從 ee2-patched 同步。
//
//   node scripts/poe2-season/update.mjs            → 只印摘要(不寫任何檔)
//   node scripts/poe2-season/update.mjs --write    → 寫資料 + 重建索引 + 重寫 MANIFEST data/poe2
//
// 這一版的規則只依實機樣本與資料本身,不需要 GGPK 快照或連網;跑到摘要全 0 為止。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyStatPlan, planExtraZh, planLeadingNumber } from './lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LANGS = /** @type {const} */ (['en', 'cmn-Hant'])
const file = (/** @type {string} */ lang) => path.join(ROOT, 'data/poe2', lang, 'stats.ndjson')
const text = Object.fromEntries(LANGS.map(lang => [lang, fs.readFileSync(file(lang), 'utf8')]))
const rows = (/** @type {string} */ t) => t.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))

const zhStats = rows(text['cmn-Hant'])
const leading = planLeadingNumber({ zhStats })
const extra = planExtraZh({ zhStats })
const adds = [...leading.adds, ...extra.adds]

const summary = [
  `數字移到前面(規則 P1):繁中 +${leading.adds.length} 個 matcher`,
  `另一種繁中寫法(規則 P2):繁中 +${extra.adds.length} 個 matcher`
]
console.log(summary.join('\n'))

if (!process.argv.includes('--write')) {
  console.log('(沒帶 --write,沒有寫任何資料檔)')
  process.exit(0)
}
for (const lang of LANGS) fs.writeFileSync(file(lang), applyStatPlan(text[lang], lang, { adds }))
const node = (/** @type {string[]} */ a) => execFileSync(process.execPath, a, { cwd: ROOT, stdio: 'inherit' })
node(['scripts/make-index-files.mjs', '--game', 'poe2'])
node(['scripts/verify-data-manifest.mjs', '--write', '--prefix', 'data/poe2',
  '--source', 'ExileAppraiser 自己維護(底 = ee2-patched fc7de73;scripts/poe2-season/update.mjs 依實機樣本更新)',
  '--path', 'data/poe2', '--fetched-at', new Date().toISOString()])
