// 本機實測自動更新:打包兩個**真的** nsis 安裝檔(A 舊、B 新),更新來源指向本機 generic feed,不對外發布任何東西。
// 流程與驗證步驟見 docs/release-flow.md「本機實測」。
//
//   node scripts/make-local-update-test.mjs [--a 3.29.90] [--b 3.29.91] [--port 45679] [--skip-build] [--only a|b]
//   node scripts/make-local-update-test.mjs --serve [--b 3.29.91] [--port 45679]
//
// - 打包:先 `npm run build`(renderer/dist + main/dist,`--skip-build` 略過),再對每個版本跑 electron-builder CLI(只 nsis):
//     -p never --win nsis
//     --config .local-update-test/electron-builder.local.yml   → main/electron-builder.yml 複本,publish 換成
//                                                               generic http://127.0.0.1:<port>/(原因見 writeLocalConfig)
//     -c.extraMetadata.version=<ver>                        → app.asar 內 package.json 的 version = app.getVersion()
//     -c.directories.output=.local-update-test/<ver>        → 各版獨立輸出夾(gitignored)
//   打完檢查 latest.yml 的 version 與 win-unpacked/resources/app-update.yml 的 provider/url,不符就失敗。
// - 版號:預設 A=3.29.90、B=3.29.91。不用 `-localtest.1` 之類的 prerelease:electron-builder 會依 prerelease 標籤
//   改用 `<tag>.yml` 通道檔、electron-updater 也會切通道。major.minor 維持 3.29(User-Agent 規則,CLAUDE.md 規則 4)。
// - `--serve`:只綁 127.0.0.1,供應 `.local-update-test/<B>/`(latest.yml、Setup.exe、.blockmap);支援單一 Range(差分下載),
//   每個請求印一行(含時間)。Ctrl+C 或結束行程即停。
import child_process from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_ROOT = path.join(ROOT, '.local-update-test')
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const verA = opt('--a', '3.29.90')
const verB = opt('--b', '3.29.91')
const port = Number(opt('--port', '45679'))
const feedUrl = `http://127.0.0.1:${port}/`
const only = opt('--only', null)
const stamp = () => new Date().toISOString()

for (const v of [verA, verB]) {
  if (!/^3\.29\.\d+$/.test(v)) throw new Error(`版號 ${v} 必須是 3.29.<n>(不帶 prerelease;見檔頭)`)
}

function run (cmd, cmdArgs, cwd) {
  console.log(`[local-update] ${stamp()} $ ${cmd} ${cmdArgs.join(' ')}  (cwd ${path.relative(ROOT, cwd) || '.'})`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const r = child_process.spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env, shell: process.platform === 'win32' && cmd === 'npm' })
  if (r.status !== 0) throw new Error(`${cmd} 失敗(exit ${r.status})`)
}

/**
 * electron-builder.yml 的 publish 換成 generic 的一份複本(其餘逐字相同)。
 * 不能用 `-c.publish.provider=generic -c.publish.url=…`:yml 的 publish 是陣列,CLI 物件會 deepAssign 到第一筆,
 * 殘留 owner/repo → 26.x schema 驗證失敗(`configuration.publish.0.provider must be equal to constant`)。
 * 設定內的相對路徑(dist、../renderer/dist、../LICENSE、icon)都相對於 projectDir(main/),與設定檔位置無關。
 */
function writeLocalConfig () {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'electron-builder.yml'), 'utf8')
  const re = /^publish:\r?\n(?:[ \t]+.*\r?\n)+/m
  if (!re.test(src)) throw new Error('electron-builder.yml 找不到 publish 區塊')
  const replaced = src.replace(re, `publish:\n  - provider: generic\n    url: ${feedUrl}\n`)
  fs.mkdirSync(OUT_ROOT, { recursive: true })
  const file = path.join(OUT_ROOT, 'electron-builder.local.yml')
  fs.writeFileSync(file, replaced)
  return file
}

function packageVersion (ver) {
  const out = path.join(OUT_ROOT, ver)
  fs.rmSync(out, { recursive: true, force: true })
  const cli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js')
  run(process.execPath, [cli, 'build', '-p', 'never', '--win', 'nsis',
    '--config', writeLocalConfig(),
    `-c.extraMetadata.version=${ver}`,
    `-c.directories.output=${out}`
  ], path.join(ROOT, 'main'))

  const latest = fs.readFileSync(path.join(out, 'latest.yml'), 'utf8')
  const updateYml = fs.readFileSync(path.join(out, 'win-unpacked', 'resources', 'app-update.yml'), 'utf8')
  const setup = path.join(out, `ExileAppraiser-Setup-${ver}.exe`)
  const problems = []
  if (!new RegExp(`^version: ${ver.replace(/\./g, '\\.')}$`, 'm').test(latest)) problems.push(`latest.yml version ≠ ${ver}`)
  if (!/^provider: generic$/m.test(updateYml)) problems.push('app-update.yml provider ≠ generic')
  if (!updateYml.includes(`url: ${feedUrl}`)) problems.push(`app-update.yml url ≠ ${feedUrl}`)
  if (!fs.existsSync(setup)) problems.push(`缺 ${path.basename(setup)}`)
  if (!fs.existsSync(setup + '.blockmap')) problems.push(`缺 ${path.basename(setup)}.blockmap`)
  if (problems.length) throw new Error(`[local-update] ${ver}:${problems.join(';')}`)
  console.log(`[local-update] ${ver} OK → ${path.relative(ROOT, setup)}(${fs.statSync(setup).size} bytes)\n--- app-update.yml ---\n${updateYml}--- latest.yml ---\n${latest}`)
}

function serve () {
  const dir = path.join(OUT_ROOT, verB)
  if (!fs.existsSync(path.join(dir, 'latest.yml'))) throw new Error(`${dir} 沒有 latest.yml,先打包 B`)
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '')
    const file = path.resolve(dir, rel)
    const range = req.headers.range
    const inside = file.startsWith(dir + path.sep)
    if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      console.log(`[feed] ${stamp()} ${req.method} /${rel} → 404`)
      res.writeHead(404).end('not found')
      return
    }
    const size = fs.statSync(file).size
    const m = typeof range === 'string' ? /^bytes=(\d+)-(\d*)$/.exec(range) : null
    if (m) {
      const start = Number(m[1])
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      console.log(`[feed] ${stamp()} ${req.method} /${rel} range ${start}-${end} → 206`)
      res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' })
      if (req.method === 'HEAD') { res.end(); return }
      fs.createReadStream(file, { start, end }).pipe(res)
      return
    }
    // 多段 Range(multipart)不支援 → 回整檔 200;electron-updater 會放棄差分改完整下載
    console.log(`[feed] ${stamp()} ${req.method} /${rel}${range ? ` (range ${range} 不支援 → 整檔)` : ''} → 200 ${size} bytes`)
    res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' })
    if (req.method === 'HEAD') { res.end(); return }
    fs.createReadStream(file).pipe(res)
  })
  server.listen(port, '127.0.0.1', () => { console.log(`[feed] ${stamp()} serving ${dir} at ${feedUrl}`) })
}

if (args.includes('--serve')) {
  serve()
} else {
  if (!args.includes('--skip-build')) run('npm', ['run', 'build'], ROOT)
  if (only !== 'b') packageVersion(verA)
  if (only !== 'a') packageVersion(verB)
  console.log(`[local-update] 完成。下一步見 docs/release-flow.md「本機實測」:靜默安裝 A → --serve → 啟動 A → 等 downloaded → ExileAppraiser.exe --quit`)
}
