// @ts-check
// 符文塑形「配方結果」資料單向同步:pob-zh-engine 的 PoE2 GGPK 抽取表 `expedition2recipes`(Description 欄)
// → data/poe2/runeshape/recipes.json,然後重寫 MANIFEST 的 data/poe2/runeshape 前綴。
//   node scripts/sync-runeshape-data.mjs --from ../Pob2/pob-zh-engine [--no-manifest]
// 來源:`<from>/tools/ggpk2_zh/out/poe2/tables/expedition2recipes.json`(維護者本機的 GGPK 抽取管線產物,
//       pob-zh-engine 的 tools/ 不進 git → MANIFEST 記抽取時間 fetchedAt + 遊戲版本 + 來源檔 sha256,不記 commit)。
// GGPK = 第一真值;本腳本**不翻譯、不補值**,只做:
//   * 剝除顯示標記 `[Rarity|X]` → X(`*Plain` 欄;原文 en / zh 保留標記)
//   * 以 id 排序(語言無關鍵;不用 row 當鍵)
// 守門(任一不符 exit 1):
//   * 每列 table / column = expedition2recipes / Description、id / en / tc 非空、id 不重複
//   * 標記只允許 `[Rarity|…]`(出現別種 `[…]` → 失敗,先確認顯示規則)、en 與 zh 的標記數相同
//   * zhPlain / enPlain 各自不重複(去空白、不分大小寫;下游以正規化名稱對接,不能有歧義)
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
  console.error('用法:node scripts/sync-runeshape-data.mjs --from <pob-zh-engine 路徑> [--no-manifest]')
  process.exit(2)
}
const FROM = path.resolve(ROOT, fromArg)
const OUT_DIR_REL = 'tools/ggpk2_zh/out/poe2'
const TABLE = 'expedition2recipes'
const SRC = path.join(FROM, OUT_DIR_REL, 'tables', `${TABLE}.json`)
const META = path.join(FROM, OUT_DIR_REL, 'meta.json')
const DST_DIR = path.join(ROOT, 'data', 'poe2', 'runeshape')
const DST = path.join(DST_DIR, 'recipes.json')

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

const MARKUP = /\[([^\]|]+)\|([^\]]*)\]/g
const ANY_BRACKET = /[[\]]/
/** `[Rarity|傳奇]胸甲` → `傳奇胸甲`;別種標記 → null(守門) */
function plain (/** @type {string} */ s) {
  let bad = false
  const out = s.replace(MARKUP, (_m, tag, text) => {
    if (tag !== 'Rarity') bad = true
    return text
  })
  if (bad || ANY_BRACKET.test(out)) return null
  return out
}
const markupCount = (/** @type {string} */ s) => (s.match(MARKUP) ?? []).length

/** @type {string[]} */
const errors = []
/** @type {Array<{ id: string, en: string, zh: string, enPlain: string, zhPlain: string }>} */
const recipes = []
const seenId = new Set()
for (const r of rows) {
  const where = `${r.table}#${r.id}`
  if (r.table !== TABLE) errors.push(`${where}:table ≠ ${TABLE}`)
  if (r.column !== 'Description') errors.push(`${where}:column = ${r.column}(預期 Description)`)
  if (!r.id || !r.en || !r.tc) { errors.push(`${where}:id / en / tc 有空值`); continue }
  if (seenId.has(r.id)) errors.push(`${where}:id 重複`)
  seenId.add(r.id)
  const enPlain = plain(r.en)
  const zhPlain = plain(r.tc)
  if (enPlain == null) errors.push(`${where}:en 有未知標記「${r.en}」`)
  if (zhPlain == null) errors.push(`${where}:zh 有未知標記「${r.tc}」`)
  if (markupCount(r.en) !== markupCount(r.tc)) errors.push(`${where}:en / zh 標記數不同(「${r.en}」/「${r.tc}」)`)
  if (enPlain == null || zhPlain == null) continue
  recipes.push({ id: r.id, en: r.en, zh: r.tc, enPlain, zhPlain })
}
for (const k of /** @type {const} */ (['enPlain', 'zhPlain'])) {
  const seen = new Map()
  for (const r of recipes) {
    const key = r[k].replace(/\s+/g, '').toLowerCase()
    if (seen.has(key)) errors.push(`${k} 重複:${seen.get(key)} / ${r.id}(${r[k]})`)
    else seen.set(key, r.id)
  }
}
if (errors.length) {
  console.error(`來源資料不符規則(${errors.length} 項),拒絕產生:\n  ` + errors.join('\n  '))
  process.exit(1)
}
recipes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** @type {{ table: string, column: string, sha256: string, ggpkVersion?: string, extractedAt?: string }} */
const source = { table: TABLE, column: 'Description', sha256: srcSha256 }
if (meta?.game_version) source.ggpkVersion = meta.game_version
if (meta?.generated_at) source.extractedAt = meta.generated_at
const out = { schema: 1, source, recipes }
fs.mkdirSync(DST_DIR, { recursive: true })
fs.writeFileSync(DST, JSON.stringify(out, null, 2) + '\n')
console.log(`寫入 ${path.relative(ROOT, DST)}:${recipes.length} 筆(${TABLE}${source.ggpkVersion ? `,GGPK ${source.ggpkVersion}` : ''},來源 sha256 ${srcSha256.slice(0, 12)}…)`)

if (!args.includes('--no-manifest')) {
  const fetchedAt = meta?.generated_at
    ? new Date(meta.generated_at).toISOString()
    : fs.statSync(SRC).mtime.toISOString()
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', 'data/poe2/runeshape',
    '--fetched-at', fetchedAt,
    '--source', `PoE2 GGPK ${TABLE}(Description 欄${source.ggpkVersion ? `;game_version ${source.ggpkVersion}` : ''};來源檔 sha256 ${srcSha256})`,
    '--path', `pob-zh-engine/${OUT_DIR_REL}/tables/${TABLE}.json(維護者本機 GGPK 抽取,不進 git;scripts/sync-runeshape-data.mjs 產生)`
  ], { stdio: 'inherit' })
}
