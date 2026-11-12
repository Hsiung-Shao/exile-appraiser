// 輸出框直接輸入自訂字串 → 存成自訂書籤 → 還原。用法:node check-output-box.mjs <證據目錄>
// 讀 state-typed.json / state-saved.json / state-reset.json(內建瀏覽器 javascript_tool 的回傳值),寫 run.log 與 exit_code.txt。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const read = n => JSON.parse(readFileSync(join(dir, n), 'utf8'))
const typed = read('state-typed.json'); const saved = read('state-saved.json'); const reset = read('state-reset.json')
const text = typed.input
const checks = [
  ['輸出框不是唯讀', typed.readonlyBefore === false],
  ['輸入後框內是輸入的字串', typed.value === text],
  ['輸入後出現手動修改提示', !!typed.hint],
  ['長度顯示輸入字串的字數', typed.len.includes(String([...text].length))],
  ['對話框預先帶入輸入的字串', typed.dialogText === text],
  ['存檔有這筆自訂書籤且字串相同', saved.saved.some(b => b.name === saved.name && b.page === '@custom' && b.keys[0] === text)],
  ['書籤列出現這筆書籤', saved.bar.includes(saved.name)],
  ['還原後回到產生的字串且提示消失', reset.queryBox === typed.generatedBefore && reset.manualHint === false]
]
const lines = checks.map(([n, ok]) => `${ok ? 'PASS' : 'FAIL'} ${n}`)
const code = checks.every(c => c[1]) ? 0 : 1
writeFileSync(join(dir, 'run.log'), lines.join('\n') + `\nRESULT: ${code ? 'FAIL' : 'PASS'}\n`)
writeFileSync(join(dir, 'exit_code.txt'), String(code))
console.log(lines.join('\n'))
process.exit(code)
