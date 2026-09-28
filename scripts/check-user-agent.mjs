#!/usr/bin/env node
/**
 * 驗證本專案的版本號不會被 GGG 的 Cloudflare 擋掉。
 *
 * Electron 會把 app 名稱與版本寫進 User-Agent,而 GGG 用它擋過舊的第三方工具。
 * 規則卡的是 **major.minor 必須等於當前遊戲版本系列**:
 *
 *     awakened-poe-trade/3.29.0     → 200
 *     awakened-poe-trade/3.29.101   → 200
 *     awakened-poe-trade/3.29.900   → 200
 *     awakened-poe-trade/3.0.0      → 403   太舊
 *     awakened-poe-trade/0.1.0      → 403   太舊
 *     awakened-poe-trade/3.30.0     → 403   **比現行還新也擋**
 *
 * 被擋的症狀極具誤導性:app 顯示「Failed to load leagues,可能需要完成 CAPTCHA」,
 * 內建瀏覽器顯示 Cloudflare 的「Sorry, you have been blocked」。兩者都不會提到版號,
 * 而且同一台機器用一般瀏覽器 UA 打同一個網址是 200 —— 很容易誤判成 IP 被封或 cookie 失效。
 *
 * **遊戲改版(3.29 → 3.30)時務必先跑這支。** 沒跟著改版號的話,
 * 所有使用者會在改版當天同時失效。
 *
 * 用法:node scripts/check-user-agent.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = 'https://www.pathofexile.com/api/leagues?type=main&realm=pc'

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const builder = fs.readFileSync(path.join(ROOT, 'main/electron-builder.yml'), 'utf8')
const productName = /^productName:\s*"(.+)"\s*$/m.exec(builder)?.[1]

if (productName === undefined) {
  console.error('讀不到 electron-builder.yml 的 productName')
  process.exit(1)
}

// Electron 的 app.getName() 優先取 productName,沒有才用 name。
// 開發模式讀 main/package.json(無 productName)→ name;
// 打包後 electron-builder 會把 productName 寫進去 → productName。
// 兩種都要驗,因為使用者跑的是後者。
const CHROME_PART = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
const TAIL = 'Chrome/140.0.0.0 Electron/40.0.0 Safari/537.36'

const cases = [
  { label: '開發模式 (name)', appName: pkg.name },
  { label: '打包後 (productName)', appName: productName }
]

let failed = false

for (const { label, appName } of cases) {
  const ua = `${CHROME_PART} ${appName}/${pkg.version} ${TAIL}`
  let status
  try {
    const res = await fetch(ENDPOINT, { headers: { 'user-agent': ua } })
    status = res.status
  } catch (err) {
    console.error(`✗ ${label}:請求失敗 ${err.message}`)
    failed = true
    continue
  }

  if (status === 200) {
    console.log(`✓ ${label.padEnd(22)} ${appName}/${pkg.version}`)
  } else {
    console.error(`✗ ${label.padEnd(22)} ${appName}/${pkg.version} → HTTP ${status}`)
    failed = true
  }
}

if (failed) {
  const [maj, min] = pkg.version.split('.')
  console.error(`
被 GGG 的 Cloudflare 擋下。目前版號 ${pkg.version} 的 major.minor 是 ${maj}.${min}。

若遊戲已改版,把 main/package.json 的 version 改成新的系列(例如 3.30.900)再跑一次。
若遊戲沒改版,先確認網路正常、且不是被 IP 層的 rate limit 暫時擋住。

⚠ 不要靠改 productName 或 name 繞過 —— 實測那兩者不影響判定,卡的是版本號。`)
  process.exit(1)
}

console.log('\n通過。版號不會被 GGG 擋。')
