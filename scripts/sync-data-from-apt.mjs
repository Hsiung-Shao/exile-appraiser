// @ts-check
// 從 fork 單向同步資料檔(逐位元組複製,保留原行尾),然後重寫 MANIFEST 中該遊戲的部分。
//   node scripts/sync-data-from-apt.mjs --from ../過時專案/apt-patched                 → data/poe1(PoE1,apt-patched)
//   node scripts/sync-data-from-apt.mjs --game poe2 --from ../過時專案/ee2-patched     → data/poe2(PoE2,ee2-patched)
// 資料只在 fork 端產生(apt `npm run regen-data`、ee2 的 tools-local),本專案不改資料內容。
// PoE2 的 `*.index.bin` 在 ee2-patched 是 gitignore 的,這裡同步後用 make-index-files --game poe2 重產
// (演算法與 E 的 renderer/src/assets/make-index-files.mjs 相同,產物與 E 本機跑出來的逐位元組一致)。
// PoE2 的交易站 data 快照(data/poe2/trade/)不屬於 fork,由 scripts/fetch-poe2-trade-data.mjs 另外更新。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const GAME = flag('--game') ?? 'poe1'
if (GAME !== 'poe1' && GAME !== 'poe2') {
  console.error(`--game 只接受 poe1 / poe2(收到 ${GAME})`)
  process.exit(2)
}
const FROM = path.resolve(ROOT, flag('--from') ?? (GAME === 'poe2' ? '../過時專案/ee2-patched' : '../過時專案/apt-patched'))
const SRC = path.join(FROM, 'renderer', 'public', 'data')
const DST = path.join(ROOT, 'data', GAME)
const LANGS = ['cmn-Hant', 'en']
/** PoE2:只取出貨需要的檔(E 的 index.bin 是本機產物,不從那裡拿) */
const POE2_LANG_FILES = ['items.ndjson', 'stats.ndjson', 'client_strings.js', 'app_i18n.json']
const POE2_ROOT_FILES = ['item-drop.json', 'remnants.json']

if (!fs.existsSync(SRC)) {
  console.error(`找不到來源資料目錄:${SRC}`)
  process.exit(2)
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: FROM, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'renderer/public/data'], { cwd: FROM, encoding: 'utf8' }).trim()
if (dirty) {
  console.error('來源 fork 的 renderer/public/data 有未提交變更,先在 fork 端 commit 再同步:\n' + dirty)
  process.exit(1)
}

let copied = 0
function copyFile (src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst) // 逐位元組;不做任何行尾或編碼轉換
  copied++
}

if (GAME === 'poe1') {
  copyFile(path.join(SRC, 'item-drop.json'), path.join(DST, 'item-drop.json'))
  for (const lang of LANGS) {
    const dir = path.join(SRC, lang)
    for (const name of fs.readdirSync(dir)) {
      copyFile(path.join(dir, name), path.join(DST, lang, name))
    }
  }
} else {
  for (const name of POE2_ROOT_FILES) copyFile(path.join(SRC, name), path.join(DST, name))
  for (const lang of LANGS) {
    for (const name of POE2_LANG_FILES) copyFile(path.join(SRC, lang, name), path.join(DST, lang, name))
  }
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-index-files.mjs'), '--game', 'poe2'], { stdio: 'inherit' })
}
console.log(`複製 ${copied} 個檔案(來源 ${FROM} @ ${commit})`)
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', `data/${GAME}`, '--commit', commit], { stdio: 'inherit' })
