// 產生一個假的 electron-updater 更新來源(generic provider),離線驗證 main/src/AppUpdater.ts 用。
//
//   node scripts/make-fake-update-feed.mjs [--out <dir>] [--version 3.29.1] [--serve <port>] [--write-dev-config]
//
// - 產出 `<out>/latest.yml` + `<out>/ExileAppraiser-Setup-<version>.exe`(隨機內容的假檔,**不可執行、也不會被執行**:
//   `autoUpdate` 開時會自動下載到 downloaded,但開發模式 `autoInstallOnAppQuit` 恆為 false(updater-core.ts),
//   結束程式不會執行它;只有按「安裝」才會 quitAndInstall,驗證時不按)。真的安裝檔端到端請用 make-local-update-test.mjs。
// - `--serve <port>`:在 127.0.0.1:<port> 以 HTTP 供應 <out>(electron-updater 的下載走 Electron net,
//   file:// 只保證「檢查」可用;要驗下載請用 --serve)。Ctrl+C 結束。
// - `--write-dev-config`:寫 `main/dev-app-update.yml`(已 gitignore)指向這個來源;
//   開發模式加 `--force-update-check` 才會讀它。範本見 `main/dev-app-update.yml.example`。
// 預設 <out> = `<repo>/.fake-update-feed/`(已 gitignore)。
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const out = path.resolve(opt('--out', path.join(ROOT, '.fake-update-feed')))
const version = opt('--version', '3.29.1')
const servePort = args.includes('--serve') ? Number(opt('--serve', '45678')) : null
const writeDevConfig = args.includes('--write-dev-config')

fs.mkdirSync(out, { recursive: true })
const fileName = `ExileAppraiser-Setup-${version}.exe`
// 固定種子的假內容(同版本每次產生一樣的 sha512,方便比對 log)
const body = Buffer.alloc(256 * 1024)
let seed = 0x2f6b1d
for (let i = 0; i < body.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; body[i] = seed >>> 24 }
Buffer.from('FAKE-UPDATE-DO-NOT-RUN').copy(body, 0)
fs.writeFileSync(path.join(out, fileName), body)
const sha512 = crypto.createHash('sha512').update(body).digest('base64')

const latestYml = [
  `version: ${version}`,
  'files:',
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${body.length}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  ''
].join('\n')
fs.writeFileSync(path.join(out, 'latest.yml'), latestYml)
console.log(`[fake-feed] ${out}\n  latest.yml  version ${version}\n  ${fileName}  ${body.length} bytes`)

const feedUrl = servePort ? `http://127.0.0.1:${servePort}/` : pathToFileURL(out + path.sep).toString()
if (writeDevConfig) {
  const devCfg = path.join(ROOT, 'main', 'dev-app-update.yml')
  fs.writeFileSync(devCfg, [
    '# 由 scripts/make-fake-update-feed.mjs 產生;只給開發模式 --force-update-check 用,不進 repo',
    'provider: generic',
    `url: ${feedUrl}`,
    'updaterCacheDirName: exile-appraiser-updater-dev',
    ''
  ].join('\n'))
  console.log(`[fake-feed] 已寫 ${devCfg} → ${feedUrl}`)
}

if (servePort) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '')
    const file = path.resolve(out, rel)
    console.log(`[fake-feed] ${req.method} /${rel}`)
    if (!file.startsWith(out) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'Content-Length': fs.statSync(file).size })
    fs.createReadStream(file).pipe(res)
  })
  server.listen(servePort, '127.0.0.1', () => { console.log(`[fake-feed] serving ${feedUrl}`) })
}
