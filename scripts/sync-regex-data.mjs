// @ts-check
// Poe Regex 清單檔單向同步:pob-zh-engine `dist/Data/regex_poe{1,2}.json` → data/regex/(逐位元組複製),然後重寫 MANIFEST 的 data/regex 前綴。
//   node scripts/sync-regex-data.mjs --from ../pob-zh-engine [--allow-dirty]
// 資料只在 PobTools 端產生(維護者本機的 tools/gen_regex_data{,2}.py,從 GGPK 產),本專案不改內容。
// 守門:
//   * pob-zh-engine 的 git 追蹤版本在 `host/data/regex_poe*.json`(dist/Data 是 gitignore 的安裝目錄複本),
//     兩者必須逐位元組相同,且 host/data 那兩個檔不能有未提交變更 —— 否則 MANIFEST 記的 commit 對不上內容。
//   * commit 記 pob-zh-engine 所在 repo 的 HEAD(與 sync-data-from-apt 相同慣例)。
//   * --allow-dirty:host/data 有未提交變更時仍同步(產生器剛重跑、還沒 commit 的驗證用途)。
//     MANIFEST 的 data/regex 來源會帶 `dirty: true` 與 `dirtyFiles`(各檔 sha256),表示 commit
//     欄位**不**等於內容;pob-zh-engine commit 資料後不帶此旗標重跑一次即清除。
//     「dist/Data 與 host/data 逐位元組相同」這條守門不因此放寬。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const FROM = path.resolve(ROOT, flag('--from') ?? '../pob-zh-engine')
const SRC = path.join(FROM, 'dist', 'Data')
const TRACKED = path.join(FROM, 'host', 'data')
const DST = path.join(ROOT, 'data', 'regex')
const FILES = ['regex_poe1.json', 'regex_poe2.json']

for (const f of FILES) {
  if (!fs.existsSync(path.join(SRC, f))) {
    console.error(`找不到來源:${path.join(SRC, f)}(先在 pob-zh-engine 建置/部署 dist)`)
    process.exit(2)
  }
  const a = fs.readFileSync(path.join(SRC, f))
  const t = path.join(TRACKED, f)
  if (!fs.existsSync(t) || !a.equals(fs.readFileSync(t))) {
    console.error(`dist/Data/${f} 與 git 追蹤的 host/data/${f} 不同:先重建/部署 pob-zh-engine 或 commit 資料再同步`)
    process.exit(1)
  }
}
const git = (/** @type {string[]} */ a) => execFileSync('git', a, { cwd: FROM, encoding: 'utf8' }).trim()
const allowDirty = args.includes('--allow-dirty')
const dirty = git(['status', '--porcelain', '--', ...FILES.map(f => `host/data/${f}`)])
if (dirty && !allowDirty) {
  console.error('pob-zh-engine 的 host/data/regex_*.json 有未提交變更,先 commit 再同步(或加 --allow-dirty):\n' + dirty)
  process.exit(1)
}
if (dirty) console.warn('警告:以 --allow-dirty 同步未提交的資料,MANIFEST 會註記 dirty: true\n' + dirty)
const dirtyFiles = dirty
  ? Object.fromEntries(FILES.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(TRACKED, f))).digest('hex')]))
  : null
const commit = git(['rev-parse', 'HEAD'])
const dataCommit = git(['log', '-1', '--format=%h', '--', ...FILES.map(f => `host/data/${f}`)])

fs.mkdirSync(DST, { recursive: true })
for (const f of FILES) fs.copyFileSync(path.join(SRC, f), path.join(DST, f)) // 逐位元組
console.log(`複製 ${FILES.length} 個檔案(來源 ${SRC} @ ${commit};資料最後異動 ${dataCommit})`)
execFileSync(process.execPath, [
  path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', 'data/regex',
  '--commit', commit,
  '--source', 'pob-zh-engine dist/Data (PobTools Poe Regex)',
  '--path', 'pob-zh-engine/dist/Data(git 追蹤於 pob-zh-engine/host/data)',
  ...(dirtyFiles ? ['--dirty', '--dirty-files', JSON.stringify(dirtyFiles)] : [])
], { stdio: 'inherit' })
