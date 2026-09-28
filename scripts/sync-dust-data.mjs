// @ts-check
// 拆粉資料單向同步:deronek/poe-disenchant-tool `data/dust/poe-dust.js` → data/dust/poe-dust.json,然後重寫 MANIFEST 的 data/dust 前綴。
//   node scripts/sync-dust-data.mjs --from <poe-disenchant-tool 的 clone> [--allow-dirty]
// 來源:https://github.com/deronek/poe-disenchant-tool(MIT);數值最初整理自 @alserom 的 gist
// (https://gist.github.com/alserom/22bdd4106806cbd4f85a5cb8c4345c08)。
// 規則:
//   * 逐筆轉成 JSON,欄位與數值原樣(不改名、不補值、不換算),只依 name + baseType 排序(穩定、方便 diff)。
//   * name + baseType 重複 → 失敗(下游以這兩個英文字串對接,不能有歧義)。
//   * 來源 clone 有未提交變更 → 失敗(MANIFEST 記的 commit 必須等於內容);--allow-dirty 只給本機驗證。
//   * 授權:LICENSE 複製到 LICENSES/poe-disenchant-tool.MIT 與 renderer/public/licenses/(關於頁「授權全文」)。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const fromArg = flag('--from')
if (!fromArg) {
  console.error('用法:node scripts/sync-dust-data.mjs --from <poe-disenchant-tool clone>')
  process.exit(2)
}
const FROM = path.resolve(ROOT, fromArg)
const SRC_REL = 'data/dust/poe-dust.js'
const SRC = path.join(FROM, SRC_REL)
const DST_DIR = path.join(ROOT, 'data', 'dust')
const DST = path.join(DST_DIR, 'poe-dust.json')
const FIELDS = ['name', 'baseType', 'dustValIlvl84', 'dustValIlvl84Q20', 'goldCost', 'slots']

if (!fs.existsSync(SRC)) {
  console.error(`找不到來源:${SRC}`)
  process.exit(2)
}
const git = (/** @type {string[]} */ a) => execFileSync('git', a, { cwd: FROM, encoding: 'utf8' }).trim()
const dirty = git(['status', '--porcelain', '--', SRC_REL, 'LICENSE'])
if (dirty && !args.includes('--allow-dirty')) {
  console.error('來源 clone 的 poe-dust.js / LICENSE 有未提交變更:\n' + dirty)
  process.exit(1)
}
const commit = git(['rev-parse', 'HEAD'])

// poe-dust.js 是 `const data = [ {name: "…", …}, … ]; export default data;`(物件鍵沒有引號,不是 JSON)。
// 在隔離的 vm context 裡求值陣列字面值(不 import、不給任何全域),再逐筆驗欄位型別。
const text = fs.readFileSync(SRC, 'utf8')
const m = /const\s+data\s*=\s*(\[[\s\S]*\])\s*;?\s*export\s+default\s+data\s*;?\s*$/.exec(text)
if (!m) {
  console.error('poe-dust.js 格式不符(預期 `const data = [...]; export default data;`)')
  process.exit(1)
}
/** @type {unknown} */
const data = vm.runInNewContext('(' + m[1] + ')', Object.create(null), { timeout: 5000 })
if (!Array.isArray(data)) {
  console.error('poe-dust.js 的 data 不是陣列')
  process.exit(1)
}
/** @type {Array<Record<string, unknown>>} */
const rows = []
const seen = new Set()
for (const [i, row] of data.entries()) {
  if (row == null || typeof row !== 'object') throw new Error(`第 ${i} 筆不是物件`)
  const keys = Object.keys(row)
  const extra = keys.filter(k => !FIELDS.includes(k))
  if (extra.length) throw new Error(`第 ${i} 筆有未知欄位 ${extra.join(', ')}(先更新本腳本的 FIELDS 與 core/src/dust/data.ts)`)
  if (typeof row.name !== 'string' || typeof row.baseType !== 'string') throw new Error(`第 ${i} 筆 name/baseType 不是字串`)
  for (const k of FIELDS.slice(2)) {
    if (k in row && typeof row[k] !== 'number') throw new Error(`第 ${i} 筆 ${k} 不是數字:${JSON.stringify(row[k])}`)
  }
  const key = row.name + '\u0000' + row.baseType
  if (seen.has(key)) throw new Error(`name + baseType 重複:${row.name} / ${row.baseType}`)
  seen.add(key)
  // 欄位原樣:保留來源的鍵順序與值(缺的欄位就缺)
  rows.push(Object.fromEntries(keys.map(k => [k, row[k]])))
}
const cmp = (/** @type {string} */ a, /** @type {string} */ b) => a < b ? -1 : a > b ? 1 : 0
rows.sort((a, b) => cmp(String(a.name), String(b.name)) || cmp(String(a.baseType), String(b.baseType)))

fs.mkdirSync(DST_DIR, { recursive: true })
// 一筆一行(diff 友善);LF 行尾
fs.writeFileSync(DST, '[\n' + rows.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n')
console.log(`寫入 ${path.relative(ROOT, DST)}:${rows.length} 筆(來源 ${SRC} @ ${commit})`)

const license = fs.readFileSync(path.join(FROM, 'LICENSE'))
for (const dir of [path.join(ROOT, 'LICENSES'), path.join(ROOT, 'renderer', 'public', 'licenses')]) {
  if (!fs.existsSync(dir)) continue
  fs.writeFileSync(path.join(dir, 'poe-disenchant-tool.MIT'), license)
}

execFileSync(process.execPath, [
  path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'),
  '--write', '--prefix', 'data/dust',
  '--source', 'deronek/poe-disenchant-tool data/dust/poe-dust.js',
  '--path', 'https://github.com/deronek/poe-disenchant-tool/blob/' + commit + '/' + SRC_REL,
  '--commit', commit
], { stdio: 'inherit', cwd: ROOT })
