// @ts-check
// 一次性錄製:對國際服 PoE1 交易站實查幾類物品(稀有 / 傳奇 / 寶石 / 破裂 / 工藝 / 勢力),
// 把 `/api/trade/fetch` 的回應剝掉個資後存成 poe1/test/docs/fetchResponses.json(查價結果懸停浮窗的測試資料)。
//   node scripts/record-poe1-fetch.mjs [--league Standard] [--per-case 2]
//   node scripts/record-poe1-fetch.mjs --scrub-only   (不上網,只對既有錄製檔重新剝除個資)
//
// 只在維護者手動執行時上網;測試只讀錄製檔(CLAUDE.md 守則 5 / 15 的精神:自動驗證不連網)。
// 每類 1 次 search + 1 次 fetch,請求間隔至少 7 秒,遵守 X-Rate-Limit / Retry-After;
// 收到 403 / 429 / 非 JSON(Cloudflare 擋)一律停下、不重試、不繞過。
// 剝除(同 poe2/test/runeshape/fixtures/trade 的規則):listing.account 的帳號名 / 角色名改成 sellerN / SellerN、
// 其餘帳號欄位只留線上狀態;item.extended.text(base64 物品全文,含備註原文)刪除;listing.whisper / whisper_token / stash 刪除;item.note 只保留標價格式(其他文字改成 `~price`)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'poe1', 'test', 'docs', 'fetchResponses.json')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const UA = `exile-appraiser/${pkg.version} (test recording; +https://github.com/Hsiung-Shao)`
const HOST = 'https://www.pathofexile.com'
const GAP_MS = 7000

const args = process.argv.slice(2)
const flag = (/** @type {string} */ name, /** @type {string} */ def) => {
  const i = args.indexOf(name)
  return i === -1 ? def : (args[i + 1] ?? def)
}
const LEAGUE = flag('--league', 'Standard')
const PER_CASE = Number(flag('--per-case', '2'))

/** @param {Record<string, unknown>} typeFilters @param {Record<string, unknown>} [misc] @param {Record<string, unknown>} [extra] */
function query (typeFilters, misc = {}, extra = {}) {
  const filters = /** @type {Record<string, unknown>} */ ({ type_filters: { filters: typeFilters } })
  if (Object.keys(misc).length) filters.misc_filters = { filters: misc }
  return { query: { status: { option: 'online' }, ...extra, filters }, sort: { price: 'asc' } }
}
const T = { option: 'true' }

const CASES = [
  ['rare-ring', query({ category: { option: 'accessory.ring' }, rarity: { option: 'rare' } }, { identified: T, corrupted: { option: 'false' } })],
  ['unique-goldrim', query({ rarity: { option: 'unique' } }, {}, { name: 'Goldrim', type: 'Leather Cap' })],
  ['gem-arc', query({ category: { option: 'gem.activegem' } }, { gem_level: { min: 20 }, quality: { min: 20 } }, { type: 'Arc' })],
  ['fractured-gloves', query({ category: { option: 'armour.gloves' }, rarity: { option: 'rare' } }, { fractured_item: T, identified: T })],
  ['crafted-bow', query({ category: { option: 'weapon.bow' }, rarity: { option: 'rare' } }, { crafted: T, identified: T })],
  ['shaper-chest', query({ category: { option: 'armour.chest' }, rarity: { option: 'rare' } }, { shaper_item: T, identified: T })]
]

let last = 0
async function gap () {
  const wait = last + GAP_MS - Date.now()
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  last = Date.now()
}

/** @param {string} url @param {RequestInit} [init] */
async function call (url, init = {}) {
  await gap()
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000)
  })
  const text = await res.text()
  const rl = ['x-rate-limit-ip', 'x-rate-limit-ip-state'].map(h => `${h}=${res.headers.get(h) ?? '-'}`).join(' ')
  console.log(`${init.method ?? 'GET'} ${url} → ${res.status}(${text.length} B;${rl})`)
  if (!res.ok) {
    console.error(`停止:HTTP ${res.status}(Retry-After ${res.headers.get('retry-after') ?? '-'})\n${text.slice(0, 300)}`)
    process.exit(1)
  }
  try {
    return JSON.parse(text)
  } catch {
    console.error(`停止:回應不是 JSON(可能被 Cloudflare 擋)\n${text.slice(0, 300)}`)
    process.exit(1)
  }
}

let sellerN = 0
/** @param {any} r */
function scrub (r) {
  const listing = r.listing ?? {}
  delete listing.whisper
  delete listing.whisper_token
  delete listing.stash
  // extended.text = base64 物品全文(含 Note 原文),浮窗不用 → 整個刪掉
  if (r.item?.extended) delete r.item.extended.text
  const acc = listing.account ?? {}
  sellerN += 1
  listing.account = {
    name: `seller${sellerN}`,
    lastCharacterName: `Seller${sellerN}`,
    online: acc.online ? { league: acc.online.league, ...(acc.online.status ? { status: acc.online.status } : {}) } : null
  }
  if (typeof r.item?.note === 'string' && !/^~(b\/o|price) [\d.\/]+ [\w-]+$/.test(r.item.note)) {
    r.item.note = '~price'
  }
  return r
}

if (args.includes('--scrub-only')) {
  const rec = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  for (const r of rec.result) {
    delete r.listing?.whisper
    delete r.listing?.whisper_token
    delete r.listing?.stash
    if (r.item?.extended) delete r.item.extended.text
  }
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 2) + '\n')
  console.log(`已重新剝除 ${path.relative(ROOT, OUT)}`)
  process.exit(0)
}

/** @type {any[]} */
const result = []
/** @type {Array<{ case: string, ids: string[] }>} */
const cases = []
for (const [name, body] of CASES) {
  const search = await call(`${HOST}/api/trade/search/${encodeURIComponent(LEAGUE)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const ids = (search.result ?? []).slice(0, PER_CASE)
  if (!ids.length) {
    console.warn(`${name}:沒有結果,略過`)
    continue
  }
  const fetched = await call(`${HOST}/api/trade/fetch/${ids.join(',')}?query=${search.id}`)
  const rows = (fetched.result ?? []).filter(Boolean).map(scrub)
  cases.push({ case: String(name), ids: rows.map(r => r.id) })
  result.push(...rows)
}

const out = {
  _source: `www.pathofexile.com /api/trade/{search,fetch}(PoE1,${LEAGUE});scripts/record-poe1-fetch.mjs 錄製,已剝帳號 / 角色名 / 密語 / 倉庫`,
  recordedAt: new Date().toISOString(),
  cases,
  result
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`寫入 ${path.relative(ROOT, OUT)}:${cases.length} 類 / ${result.length} 件`)
