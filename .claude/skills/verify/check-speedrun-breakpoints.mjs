// 計時器自動分段旅程(features/speedrun-breakpoints.md)的斷言:
// 真的 fs.watchFile + 真的檔案追加(不是記憶體假檔)→ GameLogWatcher → autoAction → run。
// 用法:node .claude/skills/verify/check-speedrun-breakpoints.mjs <證據目錄>
// 不開遊戲、不送輸入;只寫證據目錄裡的暫存 Client.txt。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const dir = path.resolve(process.argv[2] ?? '')
if (!process.argv[2]) { console.error('用法:check-speedrun-breakpoints.mjs <證據目錄>'); process.exit(2) }
fs.mkdirSync(dir, { recursive: true })
const log = []
const say = (s) => { log.push(s); console.log(s) }
let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  say(`${ok ? 'PASS' : 'FAIL'} ${name}:得到 ${JSON.stringify(got)}${ok ? '' : `,預期 ${JSON.stringify(want)}`}`)
}

const entry = path.join(dir, 'entry.ts')
const root = path.resolve('.').replace(/\\/g, '/')
fs.writeFileSync(entry, [
  `export { GameLogWatcher } from '${root}/main/src/game-log'`,
  `export { autoAction } from '${root}/core/src/speedrun/autosplit'`,
  `export { presetRoute } from '${root}/core/src/speedrun/routes'`,
  `export { createRun } from '${root}/core/src/speedrun/run'`
].join('\n'))
const bundle = path.join(dir, 'bundle.mjs')
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' })
const { GameLogWatcher, autoAction, presetRoute, createRun } = await import(pathToFileURL(bundle).href)

const clientTxt = path.join(dir, 'Client.txt')
fs.writeFileSync(clientTxt, '2026/07/25 04:00:00 1 1186a803 [DEBUG Client 1] Generating level 1 area "1_1_town" with seed 1\r\n')
const route = { ...presetRoute('poe1', 'cmn-Hant'), autoStart: true, autoSplit: true }
const run = createRun(route, () => Date.now())
const events = []
const watcher = new GameLogWatcher({
  open: async (p) => {
    const h = await fsp.open(p, 'r')
    return { size: async () => (await h.stat()).size, read: async (buf, pos) => (await h.read(buf, 0, buf.length, pos)).bytesRead, close: async () => { await h.close() } }
  },
  watch: (p, ms, onChange) => { const l = () => onChange(); fs.watchFile(p, { interval: ms }, l); return () => fs.unwatchFile(p, l) },
  onArea: (e) => {
    const act = autoAction(run, route, e.area)
    if (act === 'start') run.start()
    else if (act === 'split') run.split()
    events.push({ area: e.area, level: e.level, act, index: run.index, phase: run.phase })
  },
  log: (m) => say(m)
})
await watcher.setTarget(clientTxt, 50)
const H = (n) => `2026/07/25 05:00:${String(n).padStart(2, '0')} ${n} 1186a803`
const feed = async (line) => { fs.appendFileSync(clientTxt, line + '\r\n'); await new Promise(r => setTimeout(r, 400)) }
const area = (n, lv, id) => `${H(n)} [DEBUG Client 1] Generating level ${lv} area "${id}" with seed 1`

await feed(area(1, 1, '1_1_1'))
check('進起跑區自動開始', [run.phase, run.index], ['running', 0])
await feed(area(2, 13, '1_2_1'))
check('第 1 章:進第 2 章第一張圖就分段', run.index, 1)
await feed(area(3, 13, '1_2_town'))
check('之後進第 2 章城鎮不再分段', run.index, 1)
for (const [n, id] of [[4, '1_3_1'], [5, '1_4_1'], [6, '1_5_1']]) await feed(area(n, 30, id))
check('第 2–4 章都在第一張圖分段', run.index, 4)
await feed(`${H(7)} [INFO Client 1] #路人: 你永久性的受到奇塔弗的殘酷影響。你現在 -30% 最大抗性。`)
check('玩家聊天貼同一句不分段', run.index, 4)
await feed(`${H(8)} [INFO Client 1] : 你永久性的受到奇塔弗的殘酷影響。你現在 -30% 最大抗性。`)
check('第 5 章:基塔弗訊息出現就分段', run.index, 5)
await feed(area(9, 45, '2_6_town'))
check('訊息分段後進第 6 章城鎮不重複分段', run.index, 5)
for (const [n, id] of [[10, '2_7_town'], [11, '2_8_1'], [12, '2_9_1'], [13, '2_10_town']]) await feed(area(n, 60, id))
check('第 6–9 章分段', run.index, 9)
await feed(`${H(14)} [INFO Client 1] : You have been permanently weakened by Kitava's merciless affliction. You now have a total of -60% to all Resistances.`)
check('第 10 章:英文基塔弗訊息 → 跑完', [run.phase, run.index], ['finished', 10])
await feed(area(15, 68, '2_11_endgame_town'))
check('跑完後進終局城鎮沒有作用', run.phase, 'finished')

await watcher.dispose()
fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify({ events, splitTimes: run.splitTimes }, null, 2))
say(failed ? `結果:${failed} 項失敗` : '結果:全部通過')
fs.writeFileSync(path.join(dir, 'run.log'), log.join('\n') + '\n')
fs.writeFileSync(path.join(dir, 'exit_code.txt'), failed ? '1' : '0')
process.exit(failed ? 1 : 0)
