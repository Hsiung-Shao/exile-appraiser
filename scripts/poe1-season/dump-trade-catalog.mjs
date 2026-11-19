// 類型掃描第 6 段(查詢的類別 / 基底欄位)的離線對照:把存下來的交易站 `/api/trade/data/items` 與
// `/api/trade/data/filters` 縮成「有哪些基底名稱、有哪些類別選項、有哪些篩選欄位(`群組.欄位`)」,寫進 poe1/test/docs/trade-catalog-3.30.json。
//
//   node scripts/poe1-season/dump-trade-catalog.mjs --items <items.json> --filters <filters.json> --items-date YYYY-MM-DD --filters-date YYYY-MM-DD
//
// 只讀存檔,不連網。stat id 另有 poe1/test/docs/trade-stat-ids-3.30.json。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ n) => {
  const i = args.indexOf(n)
  if (i < 0 || !args[i + 1]) throw new Error(`缺少 ${n}`)
  return args[i + 1]
}
const items = JSON.parse(fs.readFileSync(flag('--items'), 'utf8'))
const filters = JSON.parse(fs.readFileSync(flag('--filters'), 'utf8'))
const category = filters.result.find((/** @type {any} */ g) => g.id === 'type_filters')
  ?.filters.find((/** @type {any} */ f) => f.id === 'category')
if (!category) throw new Error('filters 存檔沒有 type_filters.category')

/** 基底名稱(有 disc 的帶上 `|disc`,與查詢的 `{ option, discriminator }` 對應) */
const types = new Set()
for (const g of items.result) for (const e of g.entries) types.add(e.disc ? `${e.type}|${e.disc}` : e.type)

const out = {
  source: 'www.pathofexile.com /api/trade/data/{items,filters}',
  fetchedAt: { items: flag('--items-date'), filters: flag('--filters-date') },
  categories: category.option.options.map((/** @type {any} */ o) => o.id).filter(Boolean).sort(),
  types: [...types].sort(),
  // 查詢送的 `X_filters.filters.Y` 要在這裡找得到(poe1/test/trade-filter-ids.test.ts)
  filters: filters.result.flatMap((/** @type {any} */ g) => g.filters.map((/** @type {any} */ f) => `${g.id}.${f.id}`)).sort()
}
const OUT = path.join(ROOT, 'poe1/test/docs/trade-catalog-3.30.json')
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
console.log(`寫入 ${path.relative(ROOT, OUT)}:類別 ${out.categories.length}、基底 ${out.types.length}、篩選欄位 ${out.filters.length}`)
