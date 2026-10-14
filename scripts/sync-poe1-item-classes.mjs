// @ts-check
// PoE1 物品種類(ItemClasses)與物品浮窗用的介面字串繁中名單向同步:pob-zh-engine 的 PoE1 GGPK 抽取表
//   `itemclasses`(Name 欄)+ `clientstrings`(Text 欄,只取下面 STRING_IDS 白名單)
// → data/poe1/item-classes/item-classes.json,然後重寫 MANIFEST 的 data/poe1/item-classes 前綴。
//   node scripts/sync-poe1-item-classes.mjs --from ../Pob2/pob-zh-engine [--no-manifest]
// 用途:PoE1 查價結果懸停浮窗(poe1/src/web/price-check/trade/display-zh.ts)的類別行(交易站 `properties[0]`,例 `Bow` → 弓)、
//       屬性名(`Evasion Rating` → 閃避值)、需求行(`Requires Level 65, 79 Int`)與物品標籤(`Corrupted`、`Shaper Item`…)。
// 來源:`<from>/tools/ggpk_zh/out/poe1/tables/{itemclasses,clientstrings}.json`(維護者本機的 GGPK 抽取管線產物,
//       pob-zh-engine 的 tools/ 不進 git → MANIFEST 記抽取時間 fetchedAt + 遊戲版本 + 來源檔 sha256,不記 commit)。
// GGPK = 第一真值;本腳本**不翻譯、不補值、不改字**(只去掉頭尾空白),以 Id 排序(語言無關鍵;不用 row 當鍵)。
// 守門(任一不符 exit 1):
//   * 每列 table / column 正確、id / en / tc 非空、id 不重複
//   * en / tc 不得含顯示標記 `[…]` 或格式佔位 `{0}`
//   * 白名單每個 id 都必須找得到
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
  console.error('用法:node scripts/sync-poe1-item-classes.mjs --from <pob-zh-engine 路徑> [--no-manifest]')
  process.exit(2)
}
const FROM = path.resolve(ROOT, fromArg)
const OUT_DIR_REL = 'tools/ggpk_zh/out/poe1'
const META = path.join(FROM, OUT_DIR_REL, 'meta.json')
const PREFIX = 'data/poe1/item-classes'
const DST_DIR = path.join(ROOT, ...PREFIX.split('/'))
const DST = path.join(DST_DIR, 'item-classes.json')

/** 物品浮窗用到的 clientstrings(id 白名單;依 id 取值,不以英文字串搜尋) */
const STRING_IDS = [
  // 需求行
  'ItemRequirementsLabel', 'Level', 'StrengthShort', 'DexterityShort', 'IntelligenceShort',
  // 屬性名(交易站 properties[].name)
  'Quality', 'Experience', 'ItemDisplayStringItemLevel', 'ItemDisplayStringSockets', 'ItemDisplayStackSize',
  'ItemDisplayWeaponPhysicalDamage', 'ItemDisplayWeaponElementalDamage', 'ItemDisplayWeaponChaosDamage',
  'ItemDisplayWeaponCriticalStrikeChance', 'ItemDisplayWeaponAttacksPerSecond', 'ItemDisplayShieldBlockChance',
  'ItemDisplayArmourArmour', 'ItemDisplayArmourEvasionRating', 'ItemDisplayArmourEnergyShield', 'ItemDisplayArmourWard',
  'ItemDisplaySkillGemManaCost', 'ItemDisplaySkillGemManaReserved', 'ItemDisplaySkillGemCastTime',
  'ItemDisplaySkillGemCriticalStrikeChance', 'ItemDisplaySkillGemCooldownTime', 'ItemDisplaySkillGemDamageEffectiveness',
  'ItemDisplayMapTier', 'ItemDisplayMapQuantityIncrease', 'ItemDisplayMapRarityIncrease', 'ItemDisplayMapPackSizeIncrease',
  'JewelRadiusLabel', 'JewelItemLimit',
  // 物品標籤
  'ItemPopupCorrupted', 'ItemPopupMirrored', 'ItemPopupUnidentified', 'ItemPopupSplit', 'ItemPopupUnmodifiable',
  'ItemPopupFracturedItem', 'ItemPopupSynthesisedItem', 'ItemPopupShaperItem', 'ItemPopupElderItem',
  'ItemPopupCrusaderItem', 'ItemPopupRedeemerItem', 'ItemPopupHunterItem', 'ItemPopupWarlordItem',
  'ItemPopupSearingExarchItem', 'ItemPopupEaterofWorldsItem'
]

/** @param {string} table */
function readTable (table) {
  const file = path.join(FROM, OUT_DIR_REL, 'tables', `${table}.json`)
  if (!fs.existsSync(file)) {
    console.error(`找不到來源:${file}(先在 pob-zh-engine 跑 tools/ggpk_zh 抽取)`)
    process.exit(2)
  }
  const buf = fs.readFileSync(file)
  /** @type {Array<{ table: string, row: number, id: string, column: string, en: string, tc: string }>} */
  const rows = JSON.parse(buf.toString('utf8'))
  if (!Array.isArray(rows) || !rows.length) {
    console.error(`${file} 不是非空陣列`)
    process.exit(1)
  }
  return { rows, sha256: crypto.createHash('sha256').update(buf).digest('hex') }
}

/** @type {{ game_version?: string, generated_at?: string, game?: string } | null} */
const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : null
if (meta && meta.game && meta.game !== 'poe1') {
  console.error(`meta.json 的 game = ${meta.game},不是 poe1`)
  process.exit(1)
}

/** @type {string[]} */
const errors = []
/**
 * @param {Array<{ table: string, id: string, column: string, en: string, tc: string }>} rows
 * @param {string} table @param {string} column @param {Set<string> | null} only
 */
function collect (rows, table, column, only) {
  /** @type {Array<{ id: string, en: string, zh: string }>} */
  const out = []
  const seen = new Set()
  for (const r of rows) {
    if (only && !only.has(r.id)) continue
    const where = `${r.table}#${r.id}`
    if (r.table !== table) errors.push(`${where}:table ≠ ${table}`)
    if (r.column !== column) errors.push(`${where}:column = ${r.column}(預期 ${column})`)
    const en = (r.en ?? '').trim()
    const zh = (r.tc ?? '').trim()
    if (!r.id || !en || !zh) { errors.push(`${where}:id / en / tc 有空值`); continue }
    if (seen.has(r.id)) errors.push(`${where}:id 重複`)
    seen.add(r.id)
    if (/[[\]{}]/.test(en) || /[[\]{}]/.test(zh)) errors.push(`${where}:含顯示標記或佔位(「${en}」/「${zh}」)`)
    out.push({ id: r.id, en, zh })
  }
  out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return out
}

const itemclasses = readTable('itemclasses')
const clientstrings = readTable('clientstrings')
const classes = collect(itemclasses.rows, 'itemclasses', 'Name', null)
const strings = collect(clientstrings.rows, 'clientstrings', 'Text', new Set(STRING_IDS))
for (const id of STRING_IDS) {
  if (!strings.some(s => s.id === id)) errors.push(`clientstrings#${id}:白名單的 id 在來源找不到`)
}
if (errors.length) {
  console.error(`來源資料不符規則(${errors.length} 項),拒絕產生:\n  ` + errors.join('\n  '))
  process.exit(1)
}

/** @type {{ tables: string, sha256: Record<string, string>, ggpkVersion?: string, extractedAt?: string }} */
const source = {
  tables: 'itemclasses(Name)+ clientstrings(Text,白名單)',
  sha256: { itemclasses: itemclasses.sha256, clientstrings: clientstrings.sha256 }
}
if (meta?.game_version) source.ggpkVersion = meta.game_version
if (meta?.generated_at) source.extractedAt = meta.generated_at
const out = { schema: 1, source, classes, strings }
fs.mkdirSync(DST_DIR, { recursive: true })
fs.writeFileSync(DST, JSON.stringify(out, null, 2) + '\n')
console.log(`寫入 ${path.relative(ROOT, DST)}:物品種類 ${classes.length} 筆、字串 ${strings.length} 筆(${source.ggpkVersion ? `GGPK ${source.ggpkVersion}` : '版本不明'})`)

if (!args.includes('--no-manifest')) {
  const fetchedAt = meta?.generated_at
    ? new Date(meta.generated_at).toISOString()
    : fs.statSync(path.join(FROM, OUT_DIR_REL, 'tables', 'itemclasses.json')).mtime.toISOString()
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', PREFIX,
    '--fetched-at', fetchedAt,
    '--source', `PoE1 GGPK itemclasses(Name 欄)+ clientstrings(Text 欄白名單)${source.ggpkVersion ? `;game_version ${source.ggpkVersion}` : ''};來源檔 sha256 itemclasses ${itemclasses.sha256} / clientstrings ${clientstrings.sha256}`,
    '--path', `pob-zh-engine/${OUT_DIR_REL}/tables/{itemclasses,clientstrings}.json(維護者本機 GGPK 抽取,不進 git;scripts/sync-poe1-item-classes.mjs 產生)`
  ], { stdio: 'inherit' })
}
