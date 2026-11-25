// @ts-check
// PoE2 賽季資料更新:依規則更新 data/poe2/{en,cmn-Hant}/stats.ndjson(規則見 lib.mjs 與 CLAUDE.md 規則 1)。
// 2026-11-18 起 data/poe2 由本專案維護(底 = ee2-patched fc7de73),不再從 ee2-patched 同步。
//
//   node scripts/poe2-season/update.mjs                       → 只印摘要(不寫任何檔)
//   node scripts/poe2-season/update.mjs --write               → 寫資料 + 重建索引 + 重寫 MANIFEST data/poe2
//   node scripts/poe2-season/update.mjs --from <pob-zh-engine 絕對路徑> [--write]
//     → 另跑與 PoE1 共用的通用規則(planGeneric):GGPK = <from>/tools/ggpk2_zh/db/ggpk2_zh.sqlite 最新兩個完整版本,
//       交易站 = data/poe2/trade/intl/stats.json(scripts/fetch-poe2-trade-data.mjs 先更新)。只有一個版本時通用規則不動。
//
// 跑到摘要全 0 為止。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyStatPlan, planExtraZh, planGeneric, planLeadingNumber } from './lib.mjs'
import { setGameVersion } from '../season/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ n) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined
const LANGS = /** @type {const} */ (['en', 'cmn-Hant'])
const file = (/** @type {string} */ lang) => path.join(ROOT, 'data/poe2', lang, 'stats.ndjson')
const text = Object.fromEntries(LANGS.map(lang => [lang, fs.readFileSync(file(lang), 'utf8')]))
const rows = (/** @type {string} */ t) => t.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))

const zhStats = rows(text['cmn-Hant'])
const leading = planLeadingNumber({ zhStats })
const extra = planExtraZh({ zhStats })
const adds = [...leading.adds, ...extra.adds]

let ggpk = null
let generic = { adds: [], replace: [], remove: [], fill: {} }
if (flag('--from')) {
  const db = path.join(path.resolve(String(flag('--from'))), 'tools/ggpk2_zh/db/ggpk2_zh.sqlite')
  const tmp = path.join(os.tmpdir(), `poe2-season-${process.pid}.json`)
  execFileSync(flag('--python') ?? 'python', [path.join(ROOT, 'scripts/poe1-season/dump_ggpk.py'), db, tmp], { stdio: 'inherit' })
  ggpk = JSON.parse(fs.readFileSync(tmp, 'utf8'))
  fs.rmSync(tmp)
  const tradeStats = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/poe2/trade/intl/stats.json'), 'utf8')).result.flatMap((/** @type {any} */ g) => g.entries)
  generic = planGeneric({ enStats: rows(text.en), zhStats, ggpkOld: ggpk.stats.old, ggpkNew: ggpk.stats.new, tradeStats })
  adds.push(...generic.adds)
}

const summary = [
  `數字移到前面(規則 P1):繁中 +${leading.adds.length} 個 matcher`,
  `另一種繁中寫法(規則 P2):繁中 +${extra.adds.length} 個 matcher`,
  ...(ggpk
    ? [`GGPK ${ggpk.old.gameVersion}(v${ggpk.old.id})→ ${ggpk.new.gameVersion}(v${ggpk.new.id})${ggpk.old.id === ggpk.new.id ? ':只有一個版本,通用規則不動' : ''}`,
        `通用規則(與 PoE1 共用):改字 +${generic.adds.length} 個 matcher、失效 id 替換 ${generic.replace.length} / 移除 ${generic.remove.length}、補交易站 id ${Object.keys(generic.fill).length} 條`]
    : [])
]
console.log(summary.join('\n'))

if (!args.includes('--write')) {
  console.log('(沒帶 --write,沒有寫任何資料檔)')
  process.exit(0)
}
// shortcut: PoE2 寫檔器(lib.mjs applyStatPlan)只會加 matcher,還不會改交易站 id;真的出現時先停下,等需要時再補寫檔器
if (generic.replace.length || generic.remove.length || Object.keys(generic.fill).length) {
  console.error('通用規則要改交易站 id,PoE2 寫檔器還不支援:沒有寫入。明細:', JSON.stringify({ replace: generic.replace, remove: generic.remove, fill: generic.fill }, null, 1))
  process.exit(1)
}
for (const lang of LANGS) fs.writeFileSync(file(lang), applyStatPlan(text[lang], lang, { adds }))
const node = (/** @type {string[]} */ a) => execFileSync(process.execPath, a, { cwd: ROOT, stdio: 'inherit' })
node(['scripts/make-index-files.mjs', '--game', 'poe2'])
node(['scripts/verify-data-manifest.mjs', '--write', '--prefix', 'data/poe2',
  '--source', 'ExileAppraiser 自己維護(底 = ee2-patched fc7de73;scripts/poe2-season/update.mjs 依實機樣本更新)',
  '--path', 'data/poe2', '--fetched-at', new Date().toISOString()])
if (ggpk && ggpk.old.id !== ggpk.new.id) {
  const gv = path.join(ROOT, 'renderer/src/web/settings/game-versions.ts')
  fs.writeFileSync(gv, setGameVersion(fs.readFileSync(gv, 'utf8'), 'poe2', ggpk.new.gameVersion))
  console.log(`關於頁支援遊戲版本 poe2 = ${ggpk.new.gameVersion}`)
}
