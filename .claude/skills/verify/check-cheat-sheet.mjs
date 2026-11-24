// 速查表旅程(features/cheat-sheet.md)的斷言:一次匯入多張 + 釘住後再放大。寫 run.log / exit_code.txt
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
const log = []
let ok = true
const check = (cond, msg) => { log.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) ok = false }
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))

const imp = read('state-import.json')
check(JSON.stringify(imp.keepSent) === JSON.stringify(['syndicate-11111111.png', 'heist-22222222.png', 'expedition-33333333.webp']), '第二次匯入把既有清單傳給 main 保留')
check(JSON.stringify(imp.saved.cheatSheets) === JSON.stringify(['syndicate-11111111.png', 'heist-22222222.png', 'expedition-33333333.webp', 'delve-44444444.png']), '多選的新圖都加進清單、重複的不重複加')
check(imp.saved.cheatSheet === 'delve-44444444.png' && imp.chips.at(-1) === '*delve.png', '目前顯示最後一張新圖')

const z = read('state-zoom.json')
const pct = Number(String(z.pct).replace('%', ''))
check(pct > 100 && pct <= 800, `滾輪放大後倍率在 100–800%(${z.pct})`)
check(/scale\(/.test(z.transform), '圖片套上縮放')
check(['sheet-zoom-out', 'sheet-zoom-in', 'sheet-zoom-fit'].every(a => z.buttons.includes(a)), '標題列有縮小 / 放大 / 整張顯示')
check(z.saved.cheatSheets.length === 4 && z.chips.length === 5, '重新整理後清單仍在(內建 + 4 張)')
check(/多張|multiple/.test(z.importLabel), '匯入鈕提示可多選')
check(fs.readdirSync(dir).some(f => f.endsWith('.jpg') || f.endsWith('.png')), '有截圖')

fs.writeFileSync(path.join(dir, 'run.log'), log.join('\n') + '\n')
fs.writeFileSync(path.join(dir, 'exit_code.txt'), ok ? '0\n' : '1\n')
console.log(log.join('\n'))
process.exit(ok ? 0 : 1)
