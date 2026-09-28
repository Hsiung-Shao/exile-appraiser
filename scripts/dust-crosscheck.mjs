// @ts-check
// 拆粉基數交叉比對:APT `data/poe1/en/items.ndjson`(UNIQUE 的 unique.disenchantValue)vs `data/dust/poe-dust.json`。
//   node scripts/dust-crosscheck.mjs [--out docs/dust-crosscheck.md] [--json]
// 以英文 name + baseType 對接(不按位置);只輸出報告,不改任何資料。邏輯在 core/src/dust/crosscheck.ts(有 vitest)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const OUT = path.resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : 'docs/dust-crosscheck.md')

/** @type {typeof import('../core/src/dust/index.ts')} */
const dust = await tsImport(pathToFileURL(path.join(ROOT, 'core/src/dust/index.ts')).href, import.meta.url)

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/MANIFEST.json'), 'utf8'))
const src = (/** @type {string} */ p) => {
  const s = manifest.sources[p] ?? {}
  return `${s.repo ?? '?'}${s.commit ? ` @ ${s.commit}` : ''}`
}

const uniques = dust.dustUniquesFromNdjson(fs.readFileSync(path.join(ROOT, 'data/poe1/en/items.ndjson'), 'utf8'))
const rows = dust.parsePoeDust(fs.readFileSync(path.join(ROOT, 'data/dust/poe-dust.json'), 'utf8'))
const r = dust.crossCheck(uniques, rows)

const md = dust.renderCrossCheckMarkdown(r, {
  aptSource: `data/poe1/en/items.ndjson ← ${src('data/poe1')}`,
  dustSource: `data/dust/poe-dust.json ← ${src('data/dust')}`,
  generatedAt: new Date().toISOString()
})
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, md)

const summary = {
  aptCount: r.aptCount,
  dustCount: r.dustCount,
  matched: r.matched,
  mismatched: r.mismatched.length,
  onlyApt: r.onlyApt.length,
  onlyDust: r.onlyDust.length,
  missingGold: r.missingGold.length
}
if (args.includes('--json')) console.log(JSON.stringify(summary))
else {
  console.log(`APT 傳奇(有 disenchantValue)${summary.aptCount} / poe-dust ${summary.dustCount}`)
  console.log(`一致 ${summary.matched}、不一致 ${summary.mismatched}、只在 APT ${summary.onlyApt}、只在 poe-dust ${summary.onlyDust}、poe-dust 缺 goldCost ${summary.missingGold}`)
  console.log(`報告:${path.relative(ROOT, OUT)}`)
}
