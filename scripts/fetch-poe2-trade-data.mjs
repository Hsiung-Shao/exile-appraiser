// @ts-check
// 抓 PoE2 交易站的 data 快照(兩區各 2 個 GET,間隔 3 秒),寫到 data/poe2/trade/{intl,tw}/{stats,items}.json,
// 再重寫 MANIFEST 的 data/poe2/trade 部分(記抓取時間)。
//   node scripts/fetch-poe2-trade-data.mjs
//
// 用途:ee2-patched 的解析器在本地 ndjson 查不到時,會退回查交易站的 stats / items 清單
// (`TRADE_ITEM_BY_REF` / `TRADE_STAT_BY_MATCH_STR`;上游是每次啟動線上抓 www)。本專案改成讀這份離線快照
// (poe2/src/web/background/TradeData.ts),測試與 CLI 因此不必連網。解析器只用 intl(英文 ref),
// tw 快照存檔備查(台服 id/繁中文字比對用)。遊戲改版或新賽季時重跑,跑完 `npm test` 看快照差異。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'data', 'poe2', 'trade')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const UA = `exile-appraiser/${pkg.version} (data snapshot; +https://github.com/Hsiung-Shao)`

const JOBS = /** @type {const} */ ([
  ['intl', 'www.pathofexile.com', 'stats'],
  ['intl', 'www.pathofexile.com', 'items'],
  ['tw', 'pathofexile.tw', 'stats'],
  ['tw', 'pathofexile.tw', 'items']
])

const fetchedAt = new Date().toISOString()
for (const [realm, host, kind] of JOBS) {
  const url = `https://${host}/api/trade2/data/${kind}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  const text = await res.text()
  if (!res.ok) {
    console.error(`${url} → HTTP ${res.status}\n${text.slice(0, 300)}`)
    process.exit(1)
  }
  const body = JSON.parse(text)
  if (!Array.isArray(body.result) || body.result.length === 0) {
    console.error(`${url} 回應結構不對(沒有 result 陣列)`)
    process.exit(1)
  }
  fs.mkdirSync(path.join(OUT, realm), { recursive: true })
  fs.writeFileSync(path.join(OUT, realm, `${kind}.json`), text) // 原樣存檔
  const entries = body.result.reduce((n, c) => n + (c.entries?.length ?? 0), 0)
  console.log(`${url} → ${text.length} B,${body.result.length} 類 / ${entries} 條`)
  await new Promise(resolve => setTimeout(resolve, 3000))
}
execFileSync(process.execPath, [
  path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', 'data/poe2/trade',
  '--source', 'GGG trade2 data API(www.pathofexile.com / pathofexile.tw)', '--path', '/api/trade2/data/{stats,items}',
  '--fetched-at', fetchedAt
], { stdio: 'inherit' })
