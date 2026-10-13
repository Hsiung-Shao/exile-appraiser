// @ts-check
// PoE1 倉庫固定版面單向同步:Lailloken/Exile-UI `data/global/[stash-ninja] tabs.json` → data/poe1/stash/layouts.json,
// 然後重寫 MANIFEST 的 data/poe1/stash 前綴。
//   node scripts/sync-stash-layouts.mjs --from <Exile-UI clone> [--allow-dirty]
// 來源:https://github.com/Lailloken/Exile-UI(MIT)。
// 規則:
//   * 只取碎片頁三個子頁:fragments(一般)、scarabs(聖甲蟲)、betrayal(不滅之火);tab_* 三列 = 子頁按鈕位置。
//   * 座標維持 1440 基準與「0 = 接續前一格」的寫法(換算規則在 core/src/stash/layout.ts,與 Exile-UI 逐格相同)。
//   * 名稱:聖甲蟲 "of xxx" 接上一格的前綴(Exile-UI stash-ninja.ahk 同規則);以英文全名對 data/poe1/en/items.ndjson
//     的 refName(不分大小寫)→ 寫標準寫法;對不到 → 失敗(表的第 4 欄 ID 可能過期,不拿來對接)。
//   * 授權:LICENSE.md 複製到 LICENSES/exile-ui.MIT 與 renderer/public/licenses/(關於頁「授權全文」)。
import fs from 'node:fs'
import path from 'node:path'
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
  console.error('用法:node scripts/sync-stash-layouts.mjs --from <Exile-UI clone>')
  process.exit(2)
}
const FROM = path.resolve(ROOT, fromArg)
const SRC_REL = 'data/global/[stash-ninja] tabs.json'
const SRC = path.join(FROM, SRC_REL)
const DST_DIR = path.join(ROOT, 'data', 'poe1', 'stash')
const DST = path.join(DST_DIR, 'layouts.json')

if (!fs.existsSync(SRC)) {
  console.error(`找不到來源:${SRC}`)
  process.exit(2)
}
const git = (/** @type {string[]} */ a) => execFileSync('git', a, { cwd: FROM, encoding: 'utf8' }).trim()
const dirty = git(['status', '--porcelain', '--', SRC_REL, 'LICENSE.md'])
if (dirty && !args.includes('--allow-dirty')) {
  console.error('來源 clone 的 tabs.json / LICENSE.md 有未提交變更:\n' + dirty)
  process.exit(1)
}
const commit = git(['rev-parse', 'HEAD'])

/** 英文 refName(小寫)→ 標準寫法 */
const refNames = new Map()
for (const line of fs.readFileSync(path.join(ROOT, 'data', 'poe1', 'en', 'items.ndjson'), 'utf8').split('\n')) {
  if (!line.trim()) continue
  const o = JSON.parse(line)
  if (o.namespace === 'ITEM') refNames.set(String(o.refName).toLowerCase(), o.refName)
}

/** Exile-UI 鍵 → 本專案子頁 id(碎片頁「一般 / 聖甲蟲 / 不滅之火」) */
const SUBTABS = /** @type {const} */ ([['general', 'fragments'], ['scarabs', 'scarabs'], ['allflame', 'betrayal']])
const BUTTONS = /** @type {const} */ ({ tab_fragments: 'general', tab_scarabs: 'scarabs', tab_betrayal: 'allflame' })

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const num = (/** @type {unknown} */ v, /** @type {string} */ where) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${where}:座標不是非負整數 ${JSON.stringify(v)}`)
  return n
}

/** @type {Record<string, {x: number, y: number}> | null} */
let buttons = null
/** @type {Record<string, Array<{x: number, y: number, refName: string}>>} */
const subtabs = {}
for (const [id, key] of SUBTABS) {
  const rows = src[key]
  if (!Array.isArray(rows)) throw new Error(`tabs.json 沒有 ${key}`)
  /** @type {Record<string, {x: number, y: number}>} */
  const btn = {}
  const cells = []
  let prefix = ''
  for (const [i, row] of rows.entries()) {
    const where = `${key}[${i}]`
    if (!Array.isArray(row) || row.length < 3) throw new Error(`${where}:格式不符`)
    const x = num(row[0], where)
    const y = num(row[1], where)
    const name = String(row[2])
    if (name.startsWith('tab_')) {
      const b = BUTTONS[/** @type {keyof typeof BUTTONS} */ (name)]
      if (!b) throw new Error(`${where}:未知子頁按鈕 ${name}`)
      btn[b] = { x, y }
      continue
    }
    if (cells.length === 0 && (x === 0 || y === 0)) throw new Error(`${where}:第一格必須有完整座標`)
    let full = name
    if (key === 'scarabs' && name.startsWith('of ')) full = prefix + ' ' + name
    else prefix = name
    const refName = refNames.get(full.toLowerCase())
    if (!refName) throw new Error(`${where}:「${full}」在 data/poe1/en/items.ndjson 找不到`)
    cells.push({ x, y, refName })
  }
  if (Object.keys(btn).length !== 3) throw new Error(`${key}:子頁按鈕不是三顆`)
  if (buttons && JSON.stringify(buttons) !== JSON.stringify(btn)) throw new Error(`${key}:子頁按鈕位置與其他子頁不同`)
  buttons = btn
  subtabs[id] = cells
}

const out = {
  schema: 1,
  base: 1440,
  note: '座標 = Exile-UI 1440 基準;x 或 y 為 0 = 接續前一格(換算見 core/src/stash/layout.ts)',
  buttons,
  subtabs
}
fs.mkdirSync(DST_DIR, { recursive: true })
// 一格一行(diff 友善);LF 行尾
const body = [
  '{',
  `  "schema": ${out.schema},`,
  `  "base": ${out.base},`,
  `  "note": ${JSON.stringify(out.note)},`,
  `  "buttons": ${JSON.stringify(out.buttons)},`,
  '  "subtabs": {',
  SUBTABS.map(([id]) => `    "${id}": [\n` + subtabs[id].map(c => '      ' + JSON.stringify(c)).join(',\n') + '\n    ]').join(',\n'),
  '  }',
  '}',
  ''
].join('\n')
JSON.parse(body)
fs.writeFileSync(DST, body)
console.log(`寫入 ${path.relative(ROOT, DST)}:` + SUBTABS.map(([id]) => `${id} ${subtabs[id].length} 格`).join('、') + `(來源 @ ${commit})`)

const license = fs.readFileSync(path.join(FROM, 'LICENSE.md'))
for (const dir of [path.join(ROOT, 'LICENSES'), path.join(ROOT, 'renderer', 'public', 'licenses')]) {
  if (!fs.existsSync(dir)) continue
  fs.writeFileSync(path.join(dir, 'exile-ui.MIT'), license)
}

execFileSync(process.execPath, [
  path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'),
  '--write', '--prefix', 'data/poe1/stash',
  '--source', 'Lailloken/Exile-UI data/global/[stash-ninja] tabs.json',
  '--path', 'https://github.com/Lailloken/Exile-UI/blob/' + commit + '/data/global/%5Bstash-ninja%5D%20tabs.json',
  '--commit', commit
], { stdio: 'inherit', cwd: ROOT })
