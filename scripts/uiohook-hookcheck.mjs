// 實機檢查 uiohook 全域掛鉤能不能註冊(2026-10-03 回歸:.node 路徑過長 → SetWindowsHookEx 失敗,見 main/src/uiohook-prebuild.ts)。
// **只註冊 / 解除掛鉤,不送任何鍵盤 / 滑鼠輸入**;不拿單一實例鎖(使用者正在跑的 ExileAppraiser 不受影響)、不開視窗。CI 外手動跑。
//
//   node scripts/uiohook-hookcheck.mjs                         開發版(先 `npm run build`;用 node_modules 的 electron 跑 main/dist/main.js)
//   node scripts/uiohook-hookcheck.mjs --exe <ExileAppraiser.exe> 打包版(例:<輸出夾>\win-unpacked\ExileAppraiser.exe)
//   選項:--user-data-dir <dir>   轉給 Electron(長路徑時短路徑副本放在 <userData>\native;不給 = 預設 %APPDATA%\exile-appraiser)
//
// 做法:以 `--uiohook-selftest` 啟動 → main 依序 start / stop、1 秒後再 start / stop,印出實際載入的 .node 路徑與長度後結束。
// 輸出 log 的 `[uiohook]` / `[uiohook-selftest]` 行;結束碼 0 = 每次 start 都成功。
import child_process from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argVal = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined }
const exe = argVal('--exe')
const userDataDir = argVal('--user-data-dir')

let cmd, args
if (exe) {
  cmd = path.resolve(exe)
  args = []
} else {
  cmd = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  const mainJs = path.join(root, 'main', 'dist', 'main.js')
  if (!fs.existsSync(mainJs)) { console.error(`找不到 ${mainJs},先跑 npm run build`); process.exit(2) }
  args = [path.join(root, 'main')]
}
if (!fs.existsSync(cmd)) { console.error(`找不到 ${cmd}`); process.exit(2) }

const logFile = path.join(os.tmpdir(), `exile-appraiser-hookcheck-${process.pid}.log`)
args.push('--uiohook-selftest', `--ppz-log-file=${logFile}`)
if (userDataDir) args.push(`--user-data-dir=${path.resolve(userDataDir)}`)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE // 編輯器帶進來會讓 Electron 變成純 Node
delete env.UIOHOOK_NAPI_PREBUILD // 不讓外面的設定蓋過要檢查的行為

console.log(`> ${cmd} ${args.join(' ')}`)
const r = child_process.spawnSync(cmd, args, { env, stdio: 'ignore', timeout: 60_000, windowsHide: true })
let log = ''
try { log = fs.readFileSync(logFile, 'utf8') } catch { /* 沒有記錄檔 = 沒有輸出,log 維持空字串 */ }
try { fs.rmSync(logFile, { force: true }) } catch { /* 暫存記錄檔刪不掉不影響檢查結果 */ }
const lines = log.split(/\r?\n/).filter(l => l.includes('[uiohook'))
for (const l of lines) console.log(l.replace(/^\S+ \[pid \d+\] /, ''))
if (r.error) console.error(`啟動失敗:${r.error.message}`)
const pass = r.status === 0 && lines.some(l => l.includes('RESULT ok=2 fail=0'))
console.log(pass ? 'PASS:掛鉤註冊成功' : `FAIL(結束碼 ${String(r.status)})`)
process.exit(pass ? 0 : 1)
