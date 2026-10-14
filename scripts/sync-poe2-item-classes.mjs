// @ts-check
// PoE2 物品種類(ItemClasses)繁中名單向同步:pob-zh-engine 的 PoE2 GGPK 抽取表 `itemclasses`(Name 欄)
// → data/poe2/item-classes/item-classes.json,然後重寫 MANIFEST 的 data/poe2/item-classes 前綴。
//   node scripts/sync-poe2-item-classes.mjs --from ../Pob2/pob-zh-engine [--no-manifest]
// 用途:查價結果懸停浮窗的類別行(交易站 `properties[0]`,例 `Body Armour` → 胸甲;poe2/src/web/price-check/trade/display-zh.ts)。
// 來源:`<from>/tools/ggpk2_zh/out/poe2/tables/itemclasses.json`(維護者本機的 GGPK 抽取管線產物,
//       pob-zh-engine 的 tools/ 不進 git → MANIFEST 記抽取時間 fetchedAt + 遊戲版本 + 來源檔 sha256,不記 commit)。
// GGPK = 第一真值;本腳本**不翻譯、不補值、不改字**,只做:以 Id 排序(語言無關鍵;不用 row 當鍵)。
// 守門(任一不符 exit 1):
//   * 每列 table / column = itemclasses / Name、id / en / tc 非空、id 不重複
//   * en / tc 不得含顯示標記 `[…]`(出現 → 先確認顯示規則)
// 輸出不含時間戳:同一份來源重跑逐位元組相同。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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
  console.error('用法:node scripts/sync-poe2-item-classes.mjs --from <pob-zh-engine 路徑> [--no-manifest]')
  process.exit(2)
}
const FROM = path.resolve(ROOT, fromArg)
const OUT_DIR_REL = 'tools/ggpk2_zh/out/poe2'
const TABLE = 'itemclasses'
const COLUMN = 'Name'
const SRC = path.join(FROM, OUT_DIR_REL, 'tables', `${TABLE}.json`)
const META = path.join(FROM, OUT_DIR_REL, 'meta.json')
const PREFIX = 'data/poe2/item-classes'
const DST_DIR = path.join(ROOT, ...PREFIX.split('/'))
const DST = path.join(DST_DIR, 'item-classes.json')

if (!fs.existsSync(SRC)) {
  console.error(`找不到來源:${SRC}(先在 pob-zh-engine 跑 tools/ggpk2_zh 抽取)`)
  process.exit(2)
}
const srcBuf = fs.readFileSync(SRC)
const srcSha256 = crypto.createHash('sha256').update(srcBuf).digest('hex')
/** @type {{ game_version?: string, generated_at?: string, game?: string } | null} */
const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : null
if (meta && meta.game && meta.game !== 'poe2') {
  console.error(`meta.json 的 game = ${meta.game},不是 poe2`)
  process.exit(1)
}

/** @type {Array<{ table: string, row: number, id: string, column: string, en: string, tc: string }>} */
const rows = JSON.parse(srcBuf.toString('utf8'))
if (!Array.isArray(rows) || !rows.length) {
  console.error(`${SRC} 不是非空陣列`)
  process.exit(1)
}

/** @type {string[]} */
const errors = []
/** @type {Array<{ id: string, en: string, zh: string }>} */
const classes = []
const seenId = new Set()
for (const r of rows) {
  const where = `${r.table}#${r.id}`
  if (r.table !== TABLE) errors.push(`${where}:table ≠ ${TABLE}`)
  if (r.column !== COLUMN) errors.push(`${where}:column = ${r.column}(預期 ${COLUMN})`)
  if (!r.id || !r.en || !r.tc) { errors.push(`${where}:id / en / tc 有空值`); continue }
  if (seenId.has(r.id)) errors.push(`${where}:id 重複`)
  seenId.add(r.id)
  if (/[[\]]/.test(r.en) || /[[\]]/.test(r.tc)) errors.push(`${where}:含顯示標記(「${r.en}」/「${r.tc}」)`)
  classes.push({ id: r.id, en: r.en, zh: r.tc })
}
if (errors.length) {
  console.error(`來源資料不符規則(${errors.length} 項),拒絕產生:\n  ` + errors.join('\n  '))
  process.exit(1)
}
classes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** @type {{ table: string, column: string, sha256: string, ggpkVersion?: string, extractedAt?: string }} */
const source = { table: TABLE, column: COLUMN, sha256: srcSha256 }
if (meta?.game_version) source.ggpkVersion = meta.game_version
if (meta?.generated_at) source.extractedAt = meta.generated_at
const out = { schema: 1, source, classes }
fs.mkdirSync(DST_DIR, { recursive: true })
fs.writeFileSync(DST, JSON.stringify(out, null, 2) + '\n')
console.log(`寫入 ${path.relative(ROOT, DST)}:${classes.length} 筆(${TABLE}${source.ggpkVersion ? `,GGPK ${source.ggpkVersion}` : ''},來源 sha256 ${srcSha256.slice(0, 12)}…)`)

if (!args.includes('--no-manifest')) {
  const fetchedAt = meta?.generated_at
    ? new Date(meta.generated_at).toISOString()
    : fs.statSync(SRC).mtime.toISOString()
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', PREFIX,
    '--fetched-at', fetchedAt,
    '--source', `PoE2 GGPK ${TABLE}(${COLUMN} 欄${source.ggpkVersion ? `;game_version ${source.ggpkVersion}` : ''};來源檔 sha256 ${srcSha256})`,
    '--path', `pob-zh-engine/${OUT_DIR_REL}/tables/${TABLE}.json(維護者本機 GGPK 抽取,不進 git;scripts/sync-poe2-item-classes.mjs 產生)`
  ], { stdio: 'inherit' })
}
