// @ts-check
// 無頭驗證 CLI 的入口:依 --game(預設 poe1)轉到對應 workspace 的 `check`(poe1/src/cli.ts 或 poe2/src/cli.ts)。
//   npm run check -- <剪貼簿文字檔> [--game poe1|poe2] [--realm intl|tw|both] [--online] …
// 兩個 workspace 各有自己的 `@/…` tsconfig paths,tsx 以 workspace 目錄為 cwd 才解析得對,所以用 npm --workspace 轉。
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const i = args.indexOf('--game')
const game = i === -1 ? 'poe1' : args[i + 1]
if (game !== 'poe1' && game !== 'poe2') {
  console.error(`--game 只接受 poe1 / poe2(收到 ${game})`)
  process.exit(2)
}
const rest = i === -1 ? args : [...args.slice(0, i), ...args.slice(i + 2)]
// 不經 shell(Windows 的 shell:true 會把含空白的參數拆開,例如 --league 'Runes of Aldur'):
// 用 npm 自己設的 npm_execpath(npm-cli.js)以目前的 node 直接跑;沒有時(直接 node scripts/check.mjs)退回 npm 指令。
const npmCli = process.env.npm_execpath
const [cmd, pre] = npmCli && npmCli.endsWith('.js')
  ? [process.execPath, [npmCli]]
  : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []]
const r = spawnSync(cmd, [...pre, 'run', 'check', '--workspace', game, '--', ...rest], {
  stdio: 'inherit',
  shell: !(npmCli && npmCli.endsWith('.js')) && process.platform === 'win32',
  env: { ...process.env, INIT_CWD: process.env.INIT_CWD ?? process.cwd() }
})
process.exit(r.status ?? 1)
