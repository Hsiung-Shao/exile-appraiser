// @ts-check
// PoE2 物品種類(ItemClasses)與浮窗屬性名繁中名單向同步:pob-zh-engine 的 PoE2 GGPK 抽取表 `itemclasses`(Name 欄)
//   + 2026-10-30 `clientstrings`(Text 欄,只取 STRING_IDS 白名單)與 `alternatequalitytypes`(Description 欄,整張)
// → data/poe2/item-classes/item-classes.json,然後重寫 MANIFEST 的 data/poe2/item-classes 前綴。
//   node scripts/sync-poe2-item-classes.mjs --from ../Pob2/pob-zh-engine [--no-manifest]
// 用途:查價結果懸停浮窗的類別行(交易站 `properties[0]`,例 `Body Armour` → 胸甲)與屬性名
//       (`Stack Size` → 堆疊數量、`Quality (Life Modifiers)` → 品質(生命詞綴);poe2/src/web/price-check/trade/display-zh.ts)。
// 來源:`<from>/tools/ggpk2_zh/out/poe2/tables/{itemclasses,clientstrings,alternatequalitytypes}.json`(維護者本機的 GGPK 抽取管線產物,
//       pob-zh-engine 的 tools/ 不進 git → MANIFEST 記抽取時間 fetchedAt + 遊戲版本 + 來源檔 sha256,不記 commit)。
// GGPK = 第一真值;本腳本**不翻譯、不補值、不改字**,只做:以 Id 排序(語言無關鍵;不用 row 當鍵);
//   屬性名剝掉 GGPK 顯示標記 `[Tag]` / `[Tag|文字]`(規則與交易站屬性名相同 = EE2 `parseAffixStrings`;先例 sync-runeshape-data.mjs)。
// 守門(任一不符 exit 1):
//   * 每列 table / column 正確、id / en / tc 非空、id 不重複;白名單每個 id 都必須找得到
//   * 類別名不得含顯示標記 `[…]`(出現 → 先確認顯示規則);屬性名剝標記後不得再含 `[ ] { }`
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

/** 浮窗屬性名用到的 clientstrings(id 白名單;依 id 取值,不以英文字串搜尋) */
const STRING_IDS = [
  'Quality', // `[Quality]` → 品質
  'Level', // 寶石等級
  'ItemDisplayStackSize', // 堆疊數量
  'UltimatumItemisedTrialLevel', // `Area Level` → 區域等級
  'ItemDisplaySanctumFloors' // `Number of Trials` → 試煉數量
]
/** clientstrings 以外的屬性名來源(ids = null 取整張表);寫進資料檔的 id 加 `表名:` 前綴 */
const EXTRA_STRING_TABLES = [
  // 飾品 / 珠寶催化劑的品質類型:交易站屬性名 `Quality (Life Modifiers)` 等(26 列 = 13 種英文 × 兩組同字)
  { table: 'alternatequalitytypes', column: 'Description', ids: null }
]

/** 剝 GGPK 顯示標記 `[Tag]` / `[Tag|文字]`(= EE2 `parseAffixStrings`) */
const stripMarkup = (/** @type {string} */ s) => s.replace(/\[([^\]|]+)\|?([^\]]*)\]/g, (_, a, b) => b || a)

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

/** @type {Array<{ id: string, en: string, zh: string }>} */
const strings = []
/** @type {Record<string, string>} */
const stringSha = {}
/** @param {string} table @param {string} column @param {string[] | null} ids @param {boolean} prefixed */
function collectStrings (table, column, ids, prefixed) {
  const file = path.join(FROM, OUT_DIR_REL, 'tables', `${table}.json`)
  if (!fs.existsSync(file)) {
    errors.push(`找不到來源:${file}`)
    return
  }
  const buf = fs.readFileSync(file)
  stringSha[table] = crypto.createHash('sha256').update(buf).digest('hex')
  /** @type {Array<{ table: string, id: string, column: string, en: string, tc: string }>} */
  const src = JSON.parse(buf.toString('utf8'))
  const only = ids && new Set(ids)
  const seen = new Set()
  for (const r of src) {
    // 多欄表(clientstrings 有 Text / XBoxText…)只取指定欄,其餘欄不算錯
    if (r.column !== column || (only && !only.has(r.id))) continue
    const where = `${table}#${r.id}`
    if (r.table !== table) errors.push(`${where}:table ≠ ${table}`)
    const en = stripMarkup((r.en ?? '').trim())
    const zh = stripMarkup((r.tc ?? '').trim())
    if (!r.id || !en || !zh) { errors.push(`${where}:id / en / tc 有空值`); continue }
    if (seen.has(r.id)) errors.push(`${where}:id 重複`)
    seen.add(r.id)
    if (/[[\]{}]/.test(en) || /[[\]{}]/.test(zh)) errors.push(`${where}:剝標記後仍含標記或佔位(「${en}」/「${zh}」)`)
    strings.push({ id: prefixed ? `${table}:${r.id}` : r.id, en, zh })
  }
  if (!seen.size) errors.push(`${table}.${column}:沒有任何列`)
  for (const id of ids ?? []) {
    if (!seen.has(id)) errors.push(`${table}#${id}:白名單的 id 在來源找不到`)
  }
}
collectStrings('clientstrings', 'Text', STRING_IDS, false)
for (const t of EXTRA_STRING_TABLES) collectStrings(t.table, t.column, t.ids, true)
strings.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
if (errors.length) {
  console.error(`來源資料不符規則(${errors.length} 項),拒絕產生:\n  ` + errors.join('\n  '))
  process.exit(1)
}
classes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** @type {{ table: string, column: string, sha256: string, strings: { tables: string, sha256: Record<string, string> }, ggpkVersion?: string, extractedAt?: string }} */
const source = {
  table: TABLE,
  column: COLUMN,
  sha256: srcSha256,
  strings: { tables: 'clientstrings(Text,白名單)+ alternatequalitytypes(Description);已剝顯示標記', sha256: stringSha }
}
if (meta?.game_version) source.ggpkVersion = meta.game_version
if (meta?.generated_at) source.extractedAt = meta.generated_at
const out = { schema: 1, source, classes, strings }
fs.mkdirSync(DST_DIR, { recursive: true })
fs.writeFileSync(DST, JSON.stringify(out, null, 2) + '\n')
console.log(`寫入 ${path.relative(ROOT, DST)}:物品種類 ${classes.length} 筆、屬性名 ${strings.length} 筆(${TABLE}${source.ggpkVersion ? `,GGPK ${source.ggpkVersion}` : ''},來源 sha256 ${srcSha256.slice(0, 12)}…)`)

if (!args.includes('--no-manifest')) {
  const fetchedAt = meta?.generated_at
    ? new Date(meta.generated_at).toISOString()
    : fs.statSync(SRC).mtime.toISOString()
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', PREFIX,
    '--fetched-at', fetchedAt,
    '--source', `PoE2 GGPK ${TABLE}(${COLUMN} 欄)+ clientstrings(Text 欄白名單)+ alternatequalitytypes(Description 欄)${source.ggpkVersion ? `;game_version ${source.ggpkVersion}` : ''};來源檔 sha256 ${TABLE} ${srcSha256}${Object.entries(stringSha).map(([t, h]) => ` / ${t} ${h}`).join('')}`,
    '--path', `pob-zh-engine/${OUT_DIR_REL}/tables/{${TABLE},clientstrings,alternatequalitytypes}.json(維護者本機 GGPK 抽取,不進 git;scripts/sync-poe2-item-classes.mjs 產生)`
  ], { stdio: 'inherit' })
}
