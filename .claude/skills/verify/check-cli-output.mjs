// 實跑驗證的斷言:無頭查價(`npm run check -- <物品> --realm both`)的輸出要含指定字串、且沒有未解析詞綴。
// 純瀏覽器預覽拿不到聯盟清單(交易站 CORS),查價面板畫不出來時用這個留證據。
// 結果附加到 run.log;exit_code.txt 只在全部檢查都過時是 0(同一個證據目錄可連跑多件物品)。
// 用法:node .claude/skills/verify/check-cli-output.mjs <證據目錄> <輸出檔名> <必含字串>...
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, name, ...musts] = process.argv.slice(2)
if (!dir || !name || !musts.length) { console.error('用法:node check-cli-output.mjs <證據目錄> <輸出檔名> <必含字串>...'); process.exit(2) }

const file = join(dir, name)
const text = existsSync(file) ? readFileSync(file, 'utf8') : null
const lines = text === null ? [`FAIL ${name} 讀不到輸出檔`] : [
  ...musts.map(m => `${text.includes(m) ? 'PASS' : 'FAIL'} ${name} 含「${m}」`),
  `${/⚠/.test(text) ? 'FAIL' : 'PASS'} ${name} 沒有未解析詞綴警告`
]
const failed = lines.filter(l => l.startsWith('FAIL')).length
const codeFile = join(dir, 'exit_code.txt')
const before = existsSync(codeFile) ? readFileSync(codeFile, 'utf8').trim() : '0'
appendFileSync(join(dir, 'run.log'), lines.join('\n') + '\n')
writeFileSync(codeFile, failed || before !== '0' ? '1' : '0')
process.stdout.write(lines.join('\n') + '\n')
process.exit(failed ? 1 : 0)
