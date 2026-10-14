// @ts-check
// 抓 PoE1 台服交易站的詞綴清單快照(1 個 GET),寫到 data/poe1/trade/tw/stats.json,
// 再重寫 MANIFEST 的 data/poe1/trade 部分(記抓取時間)。
//   node scripts/fetch-poe1-trade-data.mjs
//
// 用途:PoE1 查價結果「懸停顯示物品」浮窗的繁中化(poe1/src/web/price-check/trade/display-zh.ts)——
// 國際服 fetch 回應是英文,以 trade stat id 配對 en / cmn-Hant stats.ndjson 換成繁中;同一條詞綴有多種繁中寫法時,
// 用這份台服交易站同一個 id 的文字代入同樣數值挑一個(與 PoE2 的 data/poe2/trade/tw/stats.json 同一套規則)。
// 只抓台服(繁中文字);國際服英文以 stats.ndjson 為準,不另存。原樣存檔,不改字。
// 遊戲改版或新賽季時重跑,跑完 `npm test` 看 poe1/test/display-zh.test.ts 的覆蓋率數字。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'data', 'poe1', 'trade')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const UA = `exile-appraiser/${pkg.version} (data snapshot; +https://github.com/Hsiung-Shao)`

const JOBS = /** @type {const} */ ([
  ['tw', 'pathofexile.tw', 'stats']
])

const fetchedAt = new Date().toISOString()
for (const [realm, host, kind] of JOBS) {
  const url = `https://${host}/api/trade/data/${kind}`
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
}
execFileSync(process.execPath, [
  path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', 'data/poe1/trade',
  '--source', 'GGG trade data API(pathofexile.tw,PoE1)', '--path', '/api/trade/data/stats',
  '--fetched-at', fetchedAt
], { stdio: 'inherit' })
