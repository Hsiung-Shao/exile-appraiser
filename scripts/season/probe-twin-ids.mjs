// @ts-check
// 同文另一個交易站 id 實測(2026-11-25,取代人工搜尋):交易站同一類型、文字逐字相同、雜湊不同的 id(規則 16 拒收「與既有 id 不是同一個 stat」),
// 逐一匿名搜尋,有物品的才值得掛到既有詞綴(LIVE_TWIN_IDS)。手動執行,不進 npm test。
//
//   node scripts/season/probe-twin-ids.mjs [--league Standard] [--all] [--write]
//     → 結果寫 docs/poe1-season/twin-ids-probe.md;帶 --write 才把 total > 0 的加進 scripts/poe1-season/live-twin-ids.json 的 live、
//       0 筆的加進 checkedEmpty(下次略過,--all 連它們一起重搜)。先看報告確認,再加 --write 重跑。
// 候選取自版控裡的交易站快照 poe1/test/docs/trade-stats.json(update.mjs --write 會更新它)與 data/poe1。只送搜尋條件,不送使用者資料。
// 目前只有 PoE1(PoE2 還沒有同文 id 表;要加時改 SEARCH 的路徑 /api/trade2/search/poe2/<league>)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { planTypeIds } from '../poe1-season/lib.mjs'
import { addLiveTwins, probeTwinIds } from './lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ n) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined
const LEAGUE = flag('--league') ?? 'Standard'
const TWINS = path.join(ROOT, 'scripts/poe1-season/live-twin-ids.json')
const REPORT = path.join(ROOT, 'docs/poe1-season/twin-ids-probe.md')
const SEARCH = `https://www.pathofexile.com/api/trade/search/${encodeURIComponent(LEAGUE)}`
// 交易站沒有瀏覽器 UA 會回 403(同 update.mjs)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
// 搜尋端點的 IP 限流約 30 次 / 300 秒;固定間隔 10.5 秒,另外照 429 的 Retry-After
const GAP_MS = 10_500

const rows = (/** @type {string} */ f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
const tradeStats = JSON.parse(fs.readFileSync(path.join(ROOT, 'poe1/test/docs/trade-stats.json'), 'utf8')).result.flatMap((/** @type {any} */ g) => g.entries)
const twins = JSON.parse(fs.readFileSync(TWINS, 'utf8'))
const { rejects } = planTypeIds({ enStats: rows('data/poe1/en/stats.ndjson'), zhStats: rows('data/poe1/cmn-Hant/stats.ndjson'), tradeStats })
const skip = new Set([...twins.live, ...(args.includes('--all') ? [] : twins.checkedEmpty)])
const cands = rejects.filter(r => r.reason === '與既有 id 不是同一個 stat' && !skip.has(r.id))
console.log(`候選 ${cands.length} 個(${LEAGUE};已實測略過 ${skip.size} 個),約 ${Math.ceil(cands.length * GAP_MS / 60000)} 分鐘`)

let last = 0
const sleep = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms))
async function search (/** @type {string} */ id) {
  const wait = last + GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  last = Date.now()
  const res = await fetch(SEARCH, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { status: { option: 'any' }, stats: [{ type: 'and', filters: [{ id }] }] }, sort: { price: 'asc' } })
  })
  if (res.status === 429) return { status: 429, retryAfter: Number(res.headers.get('retry-after') ?? 60) }
  if (!res.ok) return { status: res.status }
  const body = await res.json()
  console.log(`  ${id}:${body.total}`)
  return { status: 200, total: body.total }
}

const results = await probeTwinIds({ ids: cands.map(c => c.id), search, sleep })
const textOf = new Map(cands.map(c => [c.id, c]))
const esc = (/** @type {string} */ s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ⏎ ')
fs.writeFileSync(REPORT, [
  `# 同文另一個交易站 id 實測(${LEAGUE},${new Date().toISOString().slice(0, 10)})`, '',
  '> 由 `scripts/season/probe-twin-ids.mjs` 產生,勿手改。total > 0 的經使用者確認後以 `--write` 加進 `scripts/poe1-season/live-twin-ids.json`。', '',
  '| id | 交易站文字 | 對到的詞綴 | 結果 |', '|---|---|---|---|',
  ...results.map(r => `| \`${r.id}\` | ${esc(textOf.get(r.id)?.to)} | ${esc((textOf.get(r.id)?.candidates ?? []).join(' / '))} | ${'total' in r ? r.total : `錯誤 ${r.error}`} |`), ''
].join('\n'))
const live = results.filter(r => (r.total ?? 0) > 0).length
console.log(`報告:${path.relative(ROOT, REPORT)};有物品 ${live}、0 筆 ${results.filter(r => r.total === 0).length}、錯誤 ${results.filter(r => r.error).length}`)

if (args.includes('--write')) {
  const empty = results.filter(r => r.total === 0).map(r => r.id).filter(id => !twins.checkedEmpty.includes(id))
  fs.writeFileSync(TWINS, JSON.stringify({ ...twins, live: addLiveTwins(twins.live, results), checkedEmpty: [...twins.checkedEmpty, ...empty] }, null, 1) + '\n')
  console.log(`寫入 ${path.relative(ROOT, TWINS)}:live +${live}、checkedEmpty +${empty.length}。接著跑 update.mjs --write 讓規則 16 掛上`)
} else console.log('(沒帶 --write,沒有改 live-twin-ids.json)')
