#!/usr/bin/env node
/**
 * 以本產品實際會送出的 User-Agent 打一次 GGG,確認沒被 Cloudflare 擋。
 *
 * 背景:Electron 會把 app 名稱與版本寫進 User-Agent(`app.userAgentFallback`),而 GGG 用它擋過
 * 舊版的第三方工具。2026-09-30 實測(`/api/leagues`、`/api/trade2/data/{leagues,static}`,台服 trade2 leagues):
 *
 *     awakened-poe-trade/0.1.0   → 403   舊版 Awakened PoE Trade 的產品名+版號
 *     awakened-poe-trade/3.29.0  → 200
 *     exile-appraiser/0.1.0      → 200
 *     exile-appraiser/0.1.1      → 200
 *     exile-appraiser/3.29.0     → 200
 *
 * 結論:GGG 擋的是「舊版 APT 的產品名+版號」,不是「major.minor 必須等於遊戲版本」這種泛用規則。
 * 那條規則是從 APT 照搬的,不適用本產品名;本專案改用 0.x.y 語意版號。
 *
 * 被擋的症狀極具誤導性:app 顯示「Failed to load leagues,可能需要完成 CAPTCHA」,
 * 內建瀏覽器顯示 Cloudflare 的「Sorry, you have been blocked」。兩者都不會提到版號,
 * 而且同一台機器用一般瀏覽器 UA 打同一個網址是 200 —— 很容易誤判成 IP 被封或 cookie 失效。
 *
 * **發版前跑一次;遊戲改版或 GGG 政策改變時重驗。**
 *
 * 驗的 UA(版本取 root package.json;UA 只含產品名、版號與 Chrome/Electron 版本,不含任何個資):
 *   1. 開發模式:Electron 預設格式,app 名 = main/package.json 的 name
 *   2. 打包後:同格式,app 名 = electron-builder.yml 的 productName
 *   3. 裸 `exile-appraiser/<version>`
 * 每次請求間隔 2.5 秒。
 *
 * 用法:node scripts/check-user-agent.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = 'https://www.pathofexile.com/api/leagues?type=main&realm=pc'
const GAP_MS = 2500

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))
const pkg = readJson('package.json')
const mainPkg = readJson('main/package.json')
const builder = fs.readFileSync(path.join(ROOT, 'main/electron-builder.yml'), 'utf8')
const productName = /^productName:\s*"(.+)"\s*$/m.exec(builder)?.[1]

if (productName === undefined) {
  console.error('讀不到 electron-builder.yml 的 productName')
  process.exit(1)
}
if (mainPkg.version !== pkg.version) {
  console.error(`root version ${pkg.version} 與 main/package.json version ${mainPkg.version} 不一致`)
  process.exit(1)
}

// Electron / Chrome 版本:取實際安裝的 electron 與 electron-to-chromium 對照表;查不到就用後援值。
const require = createRequire(path.join(ROOT, 'main/package.json'))
let electronVersion = '40.10.6'
let chromeVersion = '144.0.7559.236'
try {
  electronVersion = require('electron/package.json').version
  const table = require('electron-to-chromium/full-versions.json')
  if (table[electronVersion]) chromeVersion = table[electronVersion]
} catch {
  // 後援值即可:GGG 判定看的是產品名 + 版號
}

// Electron 的 userAgentFallback 格式(Windows):
//   Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) <app>/<ver> Chrome/<c> Electron/<e> Safari/537.36
// app.getName() 優先取 productName,沒有才用 name:開發模式 → name、打包後 → productName。
const electronUa = (appName) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${appName}/${pkg.version} Chrome/${chromeVersion} Electron/${electronVersion} Safari/537.36`

const cases = [
  { label: '開發模式 (name)', ua: electronUa(mainPkg.name) },
  { label: '打包後 (productName)', ua: electronUa(productName) },
  { label: '裸產品字串', ua: `${pkg.name}/${pkg.version}` }
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failed = false

console.log(`GET ${ENDPOINT}`)
for (const [i, { label, ua }] of cases.entries()) {
  if (i > 0) await sleep(GAP_MS)
  let status
  try {
    const res = await fetch(ENDPOINT, { headers: { 'user-agent': ua } })
    status = res.status
    await res.arrayBuffer()
  } catch (err) {
    console.error(`✗ ${label}:請求失敗 ${err.message}`)
    failed = true
    continue
  }
  const line = `${label.padEnd(20)} HTTP ${status}  UA: ${ua}`
  if (status === 200) {
    console.log(`✓ ${line}`)
  } else {
    console.error(`✗ ${line}`)
    failed = true
  }
}

if (failed) {
  console.error(`
被 GGG 擋下(或請求失敗)。目前版號 ${pkg.version}。

先確認網路正常、且不是被 IP 層的 rate limit 暫時擋住(隔幾分鐘再跑)。
若仍 403,代表 GGG 的判定規則變了:換幾組產品名 / 版號實測找出規則,更新本檔頭的實測紀錄與 CLAUDE.md 規則 4,
不要照舊猜測改版號。`)
  process.exit(1)
}

console.log('\n通過。目前的 User-Agent 不會被 GGG 擋。')
