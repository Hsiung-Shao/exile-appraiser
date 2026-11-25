// @ts-check
// 開季總控(2026-11-25;PoE1 / PoE2 同一套流程,只差資料檔、交易站 API、GGPK 資料庫)。依序呼叫各支既有腳本,最後列出改了什麼、要人看什麼。
//
//   node scripts/season.mjs --game poe1|poe2 --from <pob-zh-engine 絕對路徑> [--write] [--skip-network --trade-dir <存檔>] [--exile-ui <Exile-UI clone>] [--diff <舊>,<新>]
//
// 不帶 --write:只跑前置檢查與資料更新的摘要(不寫任何檔)。
// --skip-network:不連網;PoE1 的詞綴資料要讀國際服交易站,所以要另給 --trade-dir(update.mjs --save-trade 存下的資料夾)。
// 步驟:① 前置檢查(本機 GGPK 版本庫、Docker、Supabase 四張表)② 詞綴資料(update.mjs 重跑到資料不再變,最多 5 輪)
//       ③ 差異掃描(只 PoE1)④ 正則 ⑤ 物品種類 / 浮窗字串 ⑥ 連網快照 ⑦ npm test + 正則鎖定數字差異 ⑧ 總結。
// 抽 GGPK 與匯入 Supabase 是 PobTools 的事;本腳本只讀。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { precheck, untilStable } from './season/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (/** @type {string} */ n) => args.includes(n) ? args[args.indexOf(n) + 1] : undefined
const GAME = flag('--game')
if (GAME !== 'poe1' && GAME !== 'poe2') { console.error('用 --game poe1 或 --game poe2'); process.exit(2) }
const FROM = path.resolve(flag('--from') ?? path.join(ROOT, '../Pob2/pob-zh-engine'))
const WRITE = args.includes('--write')
const SQLITE = path.join(FROM, GAME === 'poe1' ? 'tools/ggpk_zh/db/ggpk_zh.sqlite' : 'tools/ggpk2_zh/db/ggpk2_zh.sqlite')
const DOCKER = 'supabase_db_pobtools-ggpk-db'
const OFFLINE = args.includes('--skip-network')
if (OFFLINE && GAME === 'poe1' && !flag('--trade-dir')) { console.error('--skip-network 時 PoE1 要給 --trade-dir <交易站回應存檔>(update.mjs --save-trade 存的)'); process.exit(2) }

/** @type {{ step: string, ok: boolean, note?: string }[]} */
const log = []
const step = (/** @type {string} */ name) => console.log(`\n=== ${name} ===`)
/** 跑一支 node 腳本;失敗不丟例外,記進總結 */
function run (/** @type {string} */ name, /** @type {string[]} */ a, opt = {}) {
  const r = spawnSync(process.execPath, a, { cwd: ROOT, stdio: 'inherit', ...opt })
  log.push({ step: name, ok: r.status === 0, note: r.status === 0 ? undefined : `結束碼 ${r.status}` })
  return r.status === 0
}
function psql (/** @type {string} */ q) {
  return execFileSync('docker', ['exec', DOCKER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', q], { encoding: 'utf8' }).trim()
}

// ---- ① 前置檢查 ----
step('① 前置檢查')
const versions = fs.existsSync(SQLITE)
  ? new DatabaseSync(SQLITE, { readOnly: true }).prepare('select id, game_version gameVersion, complete from version').all()
  : []
if (!fs.existsSync(SQLITE)) console.error(`找不到本機 GGPK 版本庫:${SQLITE}`)
let supa = { latest: 0, rows: /** @type {{ id: number, gameVersion: string }[]} */ ([]) }
const pre = await precheck({
  game: GAME,
  versions,
  dockerOk: async () => { try { psql('select 1'); return true } catch { return false } },
  tableCounts: async () => {
    supa.rows = psql(`select id || '|' || game_version from ${GAME}.ggpk_version order by id`).split('\n').filter(Boolean).map(l => ({ id: Number(l.split('|')[0]), gameVersion: l.split('|')[1] }))
    supa.latest = supa.rows.at(-1)?.id ?? 0
    const count = (/** @type {string} */ t) => Number(psql(`select count(*) from ${GAME}.${t} where version_id = ${supa.latest}`))
    return { ggpk_stat: count('ggpk_stat'), ggpk_cell: count('ggpk_cell'), ggpk_row: count('ggpk_row'), rel: count('rel_mod'), gameVersion: supa.rows.at(-1)?.gameVersion }
  }
})
for (const w of pre.warnings) console.warn(`⚠ ${w}`)
for (const e of pre.errors) console.error(`✗ ${e}`)
if (!pre.ok) { console.error('\n前置檢查沒過:請先在 PobTools 抽 GGPK 並匯入本機 Supabase,再重跑。'); process.exit(1) }
console.log(`本機 GGPK:${pre.old.gameVersion}(v${pre.old.id})→ ${pre.new.gameVersion}(v${pre.new.id});Supabase 最新 version ${supa.latest}`)
log.push({ step: '前置檢查', ok: true, note: pre.warnings.join(';') || undefined })

// ---- ⑥ 連網快照先跑(PoE2 的資料更新要讀交易站快照)----
const network = () => {
  if (OFFLINE) { log.push({ step: '連網快照', ok: true, note: '--skip-network 略過' }); return }
  step('連網快照')
  if (GAME === 'poe1') {
    run('台服交易站快照', ['scripts/fetch-poe1-trade-data.mjs'])
    if (flag('--exile-ui')) run('倉庫版面', ['scripts/sync-stash-layouts.mjs', '--from', String(flag('--exile-ui'))])
    else log.push({ step: '倉庫版面', ok: true, note: '沒給 --exile-ui,略過' })
  } else run('PoE2 交易站快照', ['scripts/fetch-poe2-trade-data.mjs'])
}

const UPDATE = GAME === 'poe1' ? 'scripts/poe1-season/update.mjs' : 'scripts/poe2-season/update.mjs'
if (!WRITE) {
  step('② 詞綴資料(只看摘要)')
  run('詞綴資料摘要', [UPDATE, '--from', FROM, ...(GAME === 'poe1' && OFFLINE ? ['--trade-dir', String(flag('--trade-dir'))] : [])])
  console.log('\n(沒帶 --write:只跑了前置檢查與摘要,沒有寫任何資料檔)')
  process.exit(log.every(l => l.ok) ? 0 : 1)
}

const manifestBefore = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/MANIFEST.json'), 'utf8')).sources
if (GAME === 'poe2') network()

// ---- ② 詞綴資料:重跑到不再變 ----
step('② 詞綴資料')
const dataHash = () => {
  const h = crypto.createHash('sha256')
  for (const lang of ['en', 'cmn-Hant']) for (const f of ['stats.ndjson', 'items.ndjson']) {
    const p = path.join(ROOT, 'data', GAME, lang, f)
    if (fs.existsSync(p)) h.update(fs.readFileSync(p))
  }
  return h.digest('hex')
}
const tradeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-trade-'))
const stable = await untilStable({
  hash: async () => dataHash(),
  run: async (round) => {
    console.log(`-- 第 ${round} 輪`)
    // 第 1 輪的報告 = 這一季的變更清單(收斂後再寫會只剩全 0);第 1 輪存下交易站回應,之後讀存檔
    const extra = GAME !== 'poe1' ? [] : round === 1
      ? [...(OFFLINE ? ['--trade-dir', String(flag('--trade-dir'))] : ['--save-trade', tradeDir]), '--report', `docs/poe1-season/${pre.new.gameVersion}-report.md`]
      : ['--trade-dir', OFFLINE ? String(flag('--trade-dir')) : tradeDir]
    if (!run(`詞綴資料第 ${round} 輪`, [UPDATE, '--from', FROM, '--write', ...extra])) throw new Error(`update 第 ${round} 輪失敗`)
  }
})
log.push({ step: '詞綴資料收斂', ok: stable.stable, note: `${stable.rounds} 輪${stable.stable ? '' : ',跑滿仍在變:看規則是否互相打架'}` })

// ---- ③ 差異掃描(只 PoE1)----
if (GAME === 'poe1') {
  step('③ 差異掃描')
  // 舊 = 上一季(major.minor 不同)最新的 Supabase version;--diff 可覆寫
  const mm = (/** @type {string} */ v) => v.split('.').slice(0, 2).join('.')
  const newV = supa.rows.at(-1)
  const oldV = [...supa.rows].reverse().find(r => newV && mm(r.gameVersion) !== mm(newV.gameVersion))
  const diff = flag('--diff') ?? (oldV && newV ? `${oldV.id},${newV.id}` : '')
  if (!diff) log.push({ step: '差異掃描', ok: false, note: 'Supabase 找不到上一季的 version,用 --diff <舊>,<新> 指定' })
  else if (run('差異掃描產生句子', ['scripts/poe1-season/dump-type-sweep.mjs', '--diff', diff])) {
    // 只跑差異那組(-t):UPDATE_FIXTURES 只能重寫差異掃描的缺口檔,類型掃描的棘輪要留給 ⑦ 擋新缺口
    run('差異掃描缺口', [path.join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', 'test/type-sweep.test.ts', '-t', '開季差異掃描'],
      { cwd: path.join(ROOT, 'poe1'), env: { ...process.env, UPDATE_FIXTURES: '1', DIFF_SWEEP_REPORT: `../docs/poe1-season/${newV?.gameVersion ?? 'new'}-diff-sweep.md` } })
  }
} else log.push({ step: '差異掃描', ok: true, note: 'PoE2 尚未支援(等本機有兩個 PoE2 GGPK 版本)' })

// ---- ④ 正則 ⑤ 物品種類 / 浮窗字串 ----
step('④ 正則 ⑤ 物品種類 / 浮窗字串')
run('正則資料', ['scripts/gen-regex-data.mjs', '--from', FROM])
if (GAME === 'poe1') run('PoE1 物品種類 / 浮窗字串', ['scripts/sync-poe1-item-classes.mjs', '--from', FROM])
else {
  run('PoE2 物品種類 / 浮窗字串', ['scripts/sync-poe2-item-classes.mjs', '--from', FROM])
  run('符文塑形配方', ['scripts/sync-runeshape-data.mjs', '--from', FROM])
}
if (GAME === 'poe1') network()

// ---- ⑦ 測試 + 正則鎖定數字 ----
step('⑦ 測試')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const test = spawnSync(npm, ['test'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
log.push({ step: 'npm test', ok: test.status === 0, note: test.status === 0 ? undefined : '有紅燈:缺口棘輪變多 = 新缺口,依 issue-fix-round 修;快照差異逐筆看' })
const jsonOut = path.join(tradeDir, 'regex-locks.json')
spawnSync(process.execPath, [path.join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', 'test/item-mods.test.ts', 'test/item-mod-forms.test.ts', '--reporter=json', `--outputFile=${jsonOut}`], { cwd: path.join(ROOT, 'regex'), stdio: 'ignore' })
const locks = fs.existsSync(jsonOut)
  ? JSON.parse(fs.readFileSync(jsonOut, 'utf8')).testResults.flatMap((/** @type {any} */ f) => f.assertionResults.filter((/** @type {any} */ a) => a.status === 'failed').map((/** @type {any} */ a) => `${a.fullName}:${String(a.failureMessages[0] ?? '').split('\n')[0]}`))
  : ['(正則測試沒有輸出結果)']

// ---- ⑧ 總結 ----
const manifestAfter = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/MANIFEST.json'), 'utf8')).sources
const changed = Object.keys(manifestAfter).filter(k => JSON.stringify(manifestAfter[k]) !== JSON.stringify(manifestBefore[k]))
fs.rmSync(tradeDir, { recursive: true, force: true })
console.log(['', '=== 總結 ===',
  ...log.map(l => `${l.ok ? '✓' : '✗'} ${l.step}${l.note ? `(${l.note})` : ''}`), '',
  `MANIFEST 有更新的來源(${changed.length}):${changed.join('、') || '無'}`, '',
  '正則鎖定數字差異(看過再改測試裡的數字,不自動改):', ...(locks.length ? locks.map(s => `  - ${s}`) : ['  - 無']), '',
  '要人看:update 摘要的「需要人工看」、更新報告的拒收表、git diff'
].join('\n'))
process.exit(log.every(l => l.ok) && locks.length === 0 ? 0 : 1)
