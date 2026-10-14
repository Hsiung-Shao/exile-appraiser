// @ts-check
// 下載 5 個 PoE2 通貨圖示到 renderer/public/images/poe2/(網址取自 data/poe2/en/items.ndjson 的 icon,以 refName 找)。
// MANIFEST 只管 data/ 底下,所以來源 URL 與 sha256 記在 renderer/public/images/poe2/SOURCE.json。冪等:檔案已在且雜湊與 SOURCE.json 相符就略過。
//   node scripts/fetch-poe2-currency-icons.mjs [--force]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'renderer/public/images/poe2')
const SOURCE = path.join(OUT, 'SOURCE.json')
const WANT = {
  'Exalted Orb': 'exa',
  'Divine Orb': 'divine',
  'Chaos Orb': 'chaos',
  'Orb of Annulment': 'annul',
  'Scroll of Wisdom': 'wisdom'
}
const PNG_MAGIC = '89504e470d0a1a0a'
const force = process.argv.includes('--force')

const urls = {}
for (const line of fs.readFileSync(path.join(ROOT, 'data/poe2/en/items.ndjson'), 'utf8').split('\n')) {
  if (!line.trim()) continue
  const j = JSON.parse(line)
  if (WANT[j.refName] && j.icon && !urls[j.refName]) urls[j.refName] = j.icon
}
fs.mkdirSync(OUT, { recursive: true })
const prev = fs.existsSync(SOURCE) ? JSON.parse(fs.readFileSync(SOURCE, 'utf8')) : { files: {} }
const files = {}
for (const [ref, key] of Object.entries(WANT)) {
  const url = urls[ref]
  if (!url) { console.error(`items.ndjson 找不到 ${ref} 的 icon`); process.exit(1) }
  const file = `${key}.png`
  const p = path.join(OUT, file)
  const old = prev.files?.[file]
  if (!force && old && old.url === url && fs.existsSync(p)) {
    const buf = fs.readFileSync(p)
    if (crypto.createHash('sha256').update(buf).digest('hex') === old.sha256) { files[file] = old; console.log(`略過 ${file}(已是最新)`); continue }
  }
  const res = await fetch(url)
  if (!res.ok) { console.error(`下載失敗 ${ref}: HTTP ${res.status}`); process.exit(1) }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.subarray(0, 8).toString('hex') !== PNG_MAGIC) { console.error(`${ref} 不是 PNG`); process.exit(1) }
  fs.writeFileSync(p, buf)
  files[file] = { refName: ref, url, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length }
  console.log(`下載 ${file}(${buf.length} B)`)
}
fs.writeFileSync(SOURCE, JSON.stringify({ source: 'data/poe2/en/items.ndjson icon(web.poecdn.com)', files }, null, 2) + '\n')
