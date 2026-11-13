// @ts-check
// Poe Regex 清單檔產生:regex/gen/gen_regex_data{,2}.py → data/regex/regex_poe{1,2}.json,然後重寫 MANIFEST 的 data/regex 前綴。
//   node scripts/gen-regex-data.mjs --from ../Pob2/pob-zh-engine [--python python]
// 產生器 2026-11-13 自 PobTools 的 tools/ 搬進 regex/gen/(PobTools 已移除正則功能,之後由本專案維護;原本是單向同步)。
// 輸入:
//   * <from>/tools/{ggpk_zh,ggpk2_zh}/{cache,schema,out} —— 維護者本機的 GGPK 抽取,不進 git
//     → MANIFEST 記抽取時間 fetchedAt + 兩代 game_version + stats.json sha256,不記 commit。
// 產出不含時間戳,同樣輸入逐位元組可重現。
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
const FROM = path.resolve(ROOT, flag('--from') ?? '../Pob2/pob-zh-engine')
const PYTHON = flag('--python') ?? 'python'
const GAMES = [
  { game: 'poe1', script: 'gen_regex_data.py', out: 'tools/ggpk_zh/out/poe1' },
  { game: 'poe2', script: 'gen_regex_data2.py', out: 'tools/ggpk2_zh/out/poe2' }
]

/** @type {string[]} */
const versions = []
let fetchedAt = ''
for (const g of GAMES) {
  const outDir = path.join(FROM, g.out)
  const statsPath = path.join(outDir, 'stats.json')
  if (!fs.existsSync(statsPath)) {
    console.error(`找不到 GGPK 抽取資料:${statsPath}(--from 要指到 pob-zh-engine)`)
    process.exit(2)
  }
  /** @type {{ game_version?: string, ggpk_build?: string, generated_at?: string }} */
  const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8'))
  const at = new Date(meta.generated_at ?? fs.statSync(statsPath).mtime).toISOString()
  if (at > fetchedAt) fetchedAt = at
  const sha = crypto.createHash('sha256').update(fs.readFileSync(statsPath)).digest('hex')
  versions.push(`${g.game} game_version ${meta.game_version ?? '?'}(build ${meta.ggpk_build ?? '?'},stats.json sha256 ${sha})`)

  execFileSync(PYTHON, [path.join(ROOT, 'regex', 'gen', g.script)], {
    stdio: 'inherit',
    env: { ...process.env, POB_ZH_ENGINE: FROM, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' }
  })
}

execFileSync(process.execPath, [
  path.join(ROOT, 'scripts', 'verify-data-manifest.mjs'), '--write', '--prefix', 'data/regex',
  '--fetched-at', fetchedAt,
  '--source', `regex/gen/gen_regex_data{,2}.py 產生(GGPK 抽取:${versions.join(';')})`,
  '--path', 'pob-zh-engine/tools/{ggpk_zh,ggpk2_zh}(維護者本機 GGPK 抽取,不進 git);scripts/gen-regex-data.mjs 產生'
], { stdio: 'inherit' })
