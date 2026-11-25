// @ts-check
// 發版版號一次改齊(2026-11-25):root、main 與各 workspace 的 package.json + package-lock.json。更新說明仍由人寫。
//   node scripts/bump-version.mjs <x.y.z>
// 關於頁「支援遊戲版本」(renderer/src/web/settings/game-versions.ts)由兩代 update.mjs --write 依 GGPK 版本自動寫;這裡只印出來核對。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bumpVersion } from './season/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2] ?? ''
const PKGS = ['package.json', ...['main', 'core', 'poe1', 'poe2', 'regex', 'renderer'].map(d => `${d}/package.json`)]
const next = PKGS.map(f => [f, bumpVersion(fs.readFileSync(path.join(ROOT, f), 'utf8'), version)]) // 任一不合格就在寫檔前 throw
for (const [f, text] of next) fs.writeFileSync(path.join(ROOT, f), text)
console.log(`版號改成 ${version}:${PKGS.join('、')}`)
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--package-lock-only'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
console.log(fs.readFileSync(path.join(ROOT, 'renderer/src/web/settings/game-versions.ts'), 'utf8').match(/\{[\s\S]*?\}/)?.[0] ?? '')
console.log('接著:npm run check-user-agent、寫 docs/release-notes/v' + version + '.md')
