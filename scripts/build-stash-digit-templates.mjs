// @ts-check
// PoE1 倉庫堆疊數量的數字模板:core/test/stash/fixtures/qty/(使用者截圖 + 人工判讀 truth.json)→ data/poe1/stash/digit-templates.json,
// 然後重寫 MANIFEST 的 data/poe1/stash/digit-templates.json 前綴。
//   node scripts/build-stash-digit-templates.mjs           → 產生 + 寫 MANIFEST
//   node scripts/build-stash-digit-templates.mjs --check   → 只比對(與現有檔不同 exit 1),不寫檔
// 規則(與 core/src/stash/quantity.ts 同一套,訓練函式就在那裡):
//   * 每格裁切區縮放到基準 client 高(= truth.json 的 clientH)→ 數字連通元件數 = 真值位數的格才採用 → 每位 11×15 白色程度、正規化
//   * 每個數字的樣本平均後正規化,值四捨五入到 5 位小數;輸出記來源截圖 sha256(不含時間戳,逐位元組可重現)。
// 截圖解碼用 sharp(PNG 無損,解碼結果與平台無關)。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURE_DIR = path.join(ROOT, 'core', 'test', 'stash', 'fixtures', 'qty')
export const OUT = path.join(ROOT, 'data', 'poe1', 'stash', 'digit-templates.json')
export const MANIFEST_PREFIX = 'data/poe1/stash/digit-templates.json'

/** @returns {Promise<{ buildDigitTemplates: Function, qtyCrop: Function, digitSamples: Function }>} */
async function core () {
  return await import(pathToFileURL(path.join(ROOT, 'core', 'src', 'stash', 'quantity.ts')).href)
}
async function layoutMod () {
  return await import(pathToFileURL(path.join(ROOT, 'core', 'src', 'stash', 'layout.ts')).href)
}

/** 產生模板 JSON 字串(不寫檔) */
export async function buildTemplatesJson (fixDir = FIXTURE_DIR) {
  const { buildDigitTemplates, qtyCrop, digitSamples } = await core()
  const { parseStashLayouts, cellRects } = await layoutMod()
  const truth = JSON.parse(fs.readFileSync(path.join(fixDir, 'truth.json'), 'utf8'))
  const layouts = parseStashLayouts(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'poe1', 'stash', 'layouts.json'), 'utf8')))
  const clientH = truth.clientH
  /** @type {Array<{ d: number, v: Float64Array }>} */
  const samples = []
  /** @type {Array<{ file: string, sha256: string }>} */
  const sources = []
  for (const tab of ['general', 'scarabs']) {
    const file = truth.files[tab]
    const buf = fs.readFileSync(path.join(fixDir, file))
    sources.push({ file: `core/test/stash/fixtures/qty/${file}`, sha256: crypto.createHash('sha256').update(buf).digest('hex') })
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.height !== clientH) throw new Error(`${file}:高 ${info.height} ≠ clientH ${clientH}`)
    const img = { data, width: info.width, height: info.height, channels: info.channels }
    const rects = cellRects(layouts, tab, clientH)
    rects.forEach((/** @type {{x:number,y:number,w:number,h:number}} */ r, /** @type {number} */ i) => {
      const t = truth[tab][i]
      if (typeof t !== 'number') return
      samples.push(...digitSamples(qtyCrop(img, r, clientH, clientH), t))
    })
  }
  const t = buildDigitTemplates(samples, clientH)
  return serialize({ ...t, sources })
}

/** 每個數字模板一行,其餘照 JSON 縮排 2 */
function serialize (/** @type {any} */ t) {
  const head = { schema: t.schema, w: t.w, h: t.h, baseClientH: t.baseClientH, counts: t.counts, sources: t.sources }
  const body = JSON.stringify(head, null, 2).replace(/\n}$/, '')
  const digits = t.digits.map((/** @type {number[] | null} */ d) => '    ' + JSON.stringify(d)).join(',\n')
  return `${body.replace(/"counts": \[[\s\S]*?\]/, `"counts": ${JSON.stringify(t.counts)}`)},\n  "digits": [\n${digits}\n  ]\n}\n`
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const json = await buildTemplatesJson()
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null
  if (process.argv.includes('--check')) {
    if (old !== json) {
      console.error(`${path.relative(ROOT, OUT)} 與重新產生的結果不同`)
      process.exit(1)
    }
    console.log('digit-templates.json 與重新產生的結果相同')
    process.exit(0)
  }
  fs.writeFileSync(OUT, json)
  console.log(`寫入 ${path.relative(ROOT, OUT)}(${json.length} B)`)
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', MANIFEST_PREFIX,
    '--source', '本 repo core/test/stash/fixtures/qty(使用者 2000×1125 截圖 + 人工判讀 truth.json;scripts/build-stash-digit-templates.mjs 產生)',
    '--path', 'core/test/stash/fixtures/qty',
    '--fetched-at', '2026-10-14T13:28:00.000Z'
  ], { stdio: 'inherit' })
}
