// @ts-check
// 資料檔來源鎖:data/ 底下每個檔的 sha256 + 來源(每個子目錄一個來源,最長前綴歸屬)。
//   node scripts/verify-data-manifest.mjs            → 驗證(不符 exit 1)
//   node scripts/verify-data-manifest.mjs --write --prefix <data/xxx> [--commit <sha>] [--source <text>] [--path <來源路徑>] [--fetched-at <ISO>]
//                                                     → 只重寫該前綴底下的檔案雜湊與來源紀錄(其他前綴原封不動)
//
// 來源(sources 的鍵):
//   data/poe1        ← apt-patched `renderer/public/data`(sync-data --game poe1)
//   data/poe2        ← ee2-patched `renderer/public/data`(sync-data --game poe2;*.index.bin 由 make-index-files --game poe2 產生)
//   data/poe2/trade  ← GGG `/api/trade2/data/{stats,items}` 快照(fetch-poe2-trade-data;記抓取時間)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const MANIFEST = path.join(DATA_DIR, 'MANIFEST.json')

function listFiles (dir) {
  /** @type {string[]} */
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(p))
    else if (p !== MANIFEST) out.push(p)
  }
  return out.sort()
}

function rel (p) {
  return path.relative(ROOT, p).split(path.sep).join('/')
}

function sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/** 最長前綴歸屬:`data/poe2/trade/intl/stats.json` 屬於 `data/poe2/trade`,不屬於 `data/poe2`。 */
export function ownerOf (file, prefixes) {
  return prefixes
    .filter(p => file === p || file.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0]
}

function readManifest () {
  if (!fs.existsSync(MANIFEST)) return { sources: {}, files: {} }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  // 舊格式(只有 PoE1 一個來源):`source` → `sources['data/poe1']`
  if (m.source && !m.sources) {
    m.sources = { 'data/poe1': { ...m.source, generatedAt: m.generatedAt } }
    delete m.source
    delete m.generatedAt
  }
  return m
}

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : (args[i + 1] ?? '')
}

if (args.includes('--write')) {
  const prefix = flag('--prefix') ?? 'data/poe1'
  const commit = flag('--commit')
  const fetchedAt = flag('--fetched-at')
  if (!commit && !fetchedAt) {
    console.error('--write 需要 --commit <來源 fork 的 commit sha> 或 --fetched-at <ISO 時間>(線上快照)')
    process.exit(2)
  }
  const manifest = readManifest()
  const defaults = {
    'data/poe1': { repo: 'apt-patched (Hsiung-Shao/awakened-poe-trade-zh-TW)', path: 'renderer/public/data' },
    'data/poe2': { repo: 'ee2-patched (Hsiung-Shao/Exiled-Exchange-2-zh-TW)', path: 'renderer/public/data' }
  }
  const prev = manifest.sources[prefix] ?? {}
  manifest.sources[prefix] = {
    ...(defaults[prefix] ?? {}),
    ...prev,
    ...(flag('--source') ? { repo: flag('--source') } : {}),
    ...(flag('--path') ? { path: flag('--path') } : {}),
    ...(commit ? { commit } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    generatedAt: new Date().toISOString()
  }
  const prefixes = Object.keys(manifest.sources)
  // 只換掉歸屬於這個前綴的檔案;其他來源的雜湊原封不動(不替別的來源「背書」本機的意外改動)
  const files = Object.fromEntries(Object.entries(manifest.files).filter(([f]) => ownerOf(f, prefixes) !== prefix))
  let n = 0
  for (const f of listFiles(DATA_DIR)) {
    const r = rel(f)
    if (ownerOf(r, prefixes) !== prefix) continue
    const buf = fs.readFileSync(f)
    files[r] = { sha256: sha256(buf), bytes: buf.length }
    n++
  }
  manifest.files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  const out = { sources: Object.fromEntries(Object.entries(manifest.sources).sort()), files: manifest.files }
  fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n')
  console.log(`MANIFEST 寫入 ${prefix}:${n} 個檔案(${commit ? `commit ${commit}` : `fetchedAt ${fetchedAt}`})`)
  process.exit(0)
}

const manifest = readManifest()
const prefixes = Object.keys(manifest.sources)
const expected = manifest.files
const actual = listFiles(DATA_DIR).map(rel)
let failed = 0
for (const f of actual) {
  const want = expected[f]
  if (!want) { console.error(`未登錄: ${f}`); failed++; continue }
  if (!ownerOf(f, prefixes)) { console.error(`沒有來源紀錄: ${f}`); failed++ }
  const buf = fs.readFileSync(path.join(ROOT, f))
  const got = sha256(buf)
  if (got !== want.sha256 || buf.length !== want.bytes) {
    console.error(`不符: ${f}\n  期望 ${want.sha256} (${want.bytes} B)\n  實際 ${got} (${buf.length} B)`)
    failed++
  }
}
for (const f of Object.keys(expected)) {
  if (!actual.includes(f)) { console.error(`遺失: ${f}`); failed++ }
}
if (failed) {
  console.error(`MANIFEST 驗證失敗:${failed} 項`)
  process.exit(1)
}
const summary = prefixes.map(p => {
  const s = manifest.sources[p]
  const count = actual.filter(f => ownerOf(f, prefixes) === p).length
  return `  ${p}(${count} 檔)← ${s.repo ?? ''}${s.commit ? ` @ ${s.commit}` : ''}${s.fetchedAt ? ` 抓取於 ${s.fetchedAt}` : ''}`
}).join('\n')
console.log(`MANIFEST 驗證通過:${actual.length} 個檔案\n${summary}`)
