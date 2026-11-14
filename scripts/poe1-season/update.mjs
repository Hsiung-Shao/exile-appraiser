// @ts-check
// PoE1 賽季資料更新:依 GGPK 新舊兩版 + 國際服交易站現況,更新 data/poe1/{en,cmn-Hant}/{stats,items}.ndjson。
// 2026-11-14 起 PoE1 資料由本專案自己維護(不再從 apt-patched 同步)。規則見 lib.mjs 與 CLAUDE.md 規則 1。
//
//   node scripts/poe1-season/update.mjs --from <pob-zh-engine 絕對路徑>            → 只印摘要(不寫任何檔)
//   node scripts/poe1-season/update.mjs --from <...> --report docs/poe1-season/3.30-report.md
//   node scripts/poe1-season/update.mjs --from <...> --write                        → 寫資料 + 重建索引 + 重寫 MANIFEST data/poe1
//     [--trade-dir <dir>]  改讀已存檔的 stats.json / static.json / items.json(離線重跑;省略 = 連線抓國際服)
//     [--old N --new N]    指定 GGPK 快照(省略 = 最新兩個完整快照)   [--python python]
//
// 輸入的 GGPK 資料庫是維護者本機檔(<from>/tools/ggpk_zh/db/ggpk_zh.sqlite,不在任何版控)。只讀、不送任何使用者資料。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyItemPlan, applyStatPlan, planDeadIds, planItems, planNewStats, planStatText, planTradeBases, planTradeText, planUniques } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const FROM = path.resolve(ROOT, flag('--from') ?? '../Pob2/pob-zh-engine')
const DB = path.join(FROM, 'tools/ggpk_zh/db/ggpk_zh.sqlite')
const LANGS = /** @type {const} */ (['en', 'cmn-Hant'])
const TRADE = 'https://www.pathofexile.com/api/trade/data/'
// 交易站沒有瀏覽器 UA 會回 403(不是要登入)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

if (!fs.existsSync(DB)) {
  console.error(`找不到 GGPK 資料庫:${DB}\n用 --from 指定 pob-zh-engine 的路徑(在 worktree 裡要給絕對路徑)`)
  process.exit(2)
}

// ---- 輸入 ----
const tmp = path.join(os.tmpdir(), `poe1-season-${process.pid}.json`)
execFileSync(flag('--python') ?? 'python', [path.join(HERE, 'dump_ggpk.py'), DB, tmp,
  ...(flag('--old') ? ['--old', String(flag('--old'))] : []), ...(flag('--new') ? ['--new', String(flag('--new'))] : [])], { stdio: 'inherit' })
const ggpk = JSON.parse(fs.readFileSync(tmp, 'utf8'))
fs.rmSync(tmp)

async function trade (/** @type {string} */ name) {
  const dir = flag('--trade-dir')
  if (dir) return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')).result
  const res = await fetch(TRADE + name, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`交易站 ${name} 回 ${res.status}`)
  return (await res.json()).result
}
const tradeStats = (await trade('stats')).flatMap(g => g.entries)
const tradeStatic = (await trade('static')).flatMap(g => g.entries)
const tradeItems = (await trade('items')).flatMap(g => g.entries.map(e => ({ ...e, group: g.id })))
const fetchedAt = new Date().toISOString()

const file = (lang, name) => path.join(ROOT, 'data/poe1', lang, `${name}.ndjson`)
const text = Object.fromEntries(LANGS.flatMap(lang => ['stats', 'items'].map(name => [`${lang}/${name}`, fs.readFileSync(file(lang, name), 'utf8')])))
const rows = (/** @type {string} */ t) => t.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))

// ---- 計畫:改字(A)→ 套進記憶體 → 改字補漏(B)→ 失效 id → 新詞綴 → 物品 ----
const ruleA = planStatText({ enStats: rows(text['en/stats']), zhStats: rows(text['cmn-Hant/stats']), ggpkOld: ggpk.stats.old, ggpkNew: ggpk.stats.new })
const afterA = Object.fromEntries(LANGS.map(lang => [lang, rows(applyStatPlan(text[`${lang}/stats`], lang, { adds: ruleA.adds }))]))
const ruleB = planTradeText({ enStats: afterA.en, zhStats: afterA['cmn-Hant'], tradeStats, ggpkNew: ggpk.stats.new, ggpkOld: ggpk.stats.old })
const adds = [...ruleA.adds, ...ruleB.adds]
const afterB = rows(applyStatPlan(text['en/stats'], 'en', { adds }))
const dead = planDeadIds({ enStats: afterB, tradeStats })
const newStats = planNewStats({ enStats: afterB, ggpkOld: ggpk.stats.old, ggpkNew: ggpk.stats.new, tradeStats })
const items = planItems({ enItems: rows(text['en/items']), baseOld: ggpk.base.old, baseNew: ggpk.base.new, tradeStatic })
const bases = planTradeBases({ enItems: rows(text['en/items']), baseOld: ggpk.base.old, baseNew: ggpk.base.new, tradeItems })
const uniques = planUniques({ enItems: rows(applyItemPlan(text['en/items'], 'en', { bases: bases.adds })), tradeItems, words: ggpk.words })
const itemPlan = { ...items, bases: bases.adds, uniques: uniques.adds }
const statPlan = { adds, replace: dead.replace, remove: dead.remove, newStats }
const rejects = [...ruleA.rejects.map(r => ({ rule: '改字 A', ...r })), ...ruleB.rejects.map(r => ({ rule: '改字 B', ...r })), ...dead.rejects.map(r => ({ rule: '失效 id', ...r })), ...bases.rejects.map(r => ({ rule: '新底材', ...r })), ...uniques.rejects.map(r => ({ rule: '新傳奇', ...r }))]

const count = (list, lang) => list.filter(a => a.lang === lang).length
const summary = [
  `GGPK ${ggpk.old.gameVersion}(v${ggpk.old.id})→ ${ggpk.new.gameVersion}(v${ggpk.new.id},build ${ggpk.new.ggpkBuild});交易站 ${flag('--trade-dir') ? '讀存檔' : fetchedAt}`,
  `改字 A(GGPK 鍵):en +${count(ruleA.adds, 'en')} / 繁中 +${count(ruleA.adds, 'cmn-Hant')} 個 matcher,涉及 ${new Set(ruleA.adds.map(a => a.ref)).size} 條詞綴`,
  `改字 B(交易站現行文字):en +${count(ruleB.adds, 'en')} / 繁中 +${count(ruleB.adds, 'cmn-Hant')} 個 matcher`,
  `失效 id:替換 ${Object.keys(dead.replace).length}、移除 ${dead.remove.length}`,
  `新詞綴:${newStats.length} 列`,
  `物品:改名 ${items.renames.length}、新增 ${items.adds.length}、新底材 ${bases.adds.length}、新傳奇 ${uniques.adds.length}`,
  `拒收(沒改資料):${rejects.length}`
]
console.log(summary.join('\n'))

if (flag('--report')) {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ⏎ ')
  const table = (head, list) => list.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...list.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n') : '(無)'
  const md = [
    `# PoE1 賽季資料更新報告(${ggpk.new.gameVersion})`, '',
    '> 由 `scripts/poe1-season/update.mjs --report` 產生,勿手改。', '', ...summary.map(s => `- ${s}`), '',
    '## 物品改名', table(['舊名', '新名', '繁中', 'tradeTag'], items.renames.map(r => [r.from, r.to, r.zh, r.tradeTag])), '',
    '## 物品新增', table(['英文', '繁中', 'tradeTag'], items.adds.map(r => [r.refName, r.zh, r.tradeTag])), '',
    '## 新底材', table(['英文', '繁中', '類別'], bases.adds.map(r => [r.refName, r.zh, r.category])), '',
    '## 新傳奇', table(['英文', '繁中', '底材'], uniques.adds.map(r => [r.refName, r.zh, r.base])), '',
    '## 新詞綴', table(['ref', '繁中', 'id'], newStats.map(s => [s.ref, s.zh.map(m => m.string).join(' / '), Object.values(s.ids).flat().join(' ')])), '',
    '## 失效 id:替換', table(['舊 id', '新 id'], Object.entries(dead.replace)), '',
    '## 失效 id:移除', dead.remove.length ? dead.remove.map(i => `\`${i}\``).join(' ') : '(無)', '',
    '## 新增 matcher', table(['語系', 'ref', '新 matcher', '旗標'], adds.map(a => [a.lang, a.ref, a.matcher.string, [a.matcher.negate && 'negate', a.matcher.value !== undefined && `value ${a.matcher.value}`].filter(Boolean).join(' ')])), '',
    '## 拒收(沒改資料,需要人看)', table(['規則', '原因', 'ref / id', '語系', '內容'], rejects.map(r => [r.rule, r.reason, r.ref ?? r.id, r.lang, r.to ?? (r.candidates ?? []).join(' ')])), ''
  ].join('\n')
  const out = path.resolve(ROOT, String(flag('--report')))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, md)
  console.log(`報告:${path.relative(ROOT, out)}`)
}

if (!args.includes('--write')) {
  console.log('(沒帶 --write,沒有寫任何資料檔)')
  process.exit(0)
}
for (const lang of LANGS) {
  fs.writeFileSync(file(lang, 'stats'), applyStatPlan(text[`${lang}/stats`], lang, statPlan))
  fs.writeFileSync(file(lang, 'items'), applyItemPlan(text[`${lang}/items`], lang, itemPlan))
}
const node = (/** @type {string[]} */ a) => execFileSync(process.execPath, a, { cwd: ROOT, stdio: 'inherit' })
node(['scripts/make-index-files.mjs'])
node(['scripts/verify-data-manifest.mjs', '--write', '--prefix', 'data/poe1',
  '--source', `ExileAppraiser 自己維護(底 = apt-patched 384d1c5;scripts/poe1-season/update.mjs 以 GGPK ${ggpk.new.gameVersion} build ${ggpk.new.ggpkBuild} + 國際服交易站資料更新)`,
  '--path', 'data/poe1', '--fetched-at', fetchedAt])
