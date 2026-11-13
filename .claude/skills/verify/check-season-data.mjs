// 實跑驗證的斷言:PoE1 賽季資料更新(3.30 寫法)。讀證據目錄裡的
//   state-item-rarity.json —— 正則「物品詞綴數值」頁搜尋「物品稀有度」並勾選主詞綴後,javascript_tool 的回傳值
//   check-cli.txt          —— `npm run check -- <含 3.30 稀有度寫法的物品> --realm intl` 的輸出
// 把每條檢查寫進 run.log、結束碼寫進 exit_code.txt(0 = 全過)。
// 用法:node .claude/skills/verify/check-season-data.mjs <證據目錄>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('用法:node check-season-data.mjs <證據目錄>'); process.exit(2) }

const lines = []
let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
}
const read = (name) => {
  try { return readFileSync(join(dir, name), 'utf8') } catch (e) { check(`讀 ${name}`, false, String(e.message)); return null }
}

const stateText = read('state-item-rarity.json')
if (stateText) {
  const s = JSON.parse(stateText)
  check('正則頁找得到物品稀有度主詞綴(explicit.stat_3917489142)', s.found === true)
  check('該列顯示 3.30 寫法「#%物品稀有度」', s.label === '#%物品稀有度', String(s.label))
  check('勾選後計數是 1 / N', /^已勾選 1 \/ \d+$/.test(s.count ?? ''), String(s.count))
  check('輸出一條加引號、含「物品稀有度」的搜尋字串', /^".*物品稀有度.*"$/.test(s.query ?? ''), String(s.query))
}

const cli = read('check-cli.txt')
if (cli) {
  check('無頭查價把「+14% to Item Rarity」解析成原詞綴', cli.includes('#% increased Rarity of Items found'))
  check('送出的條件帶 explicit.stat_3917489142', cli.includes('explicit.stat_3917489142'))
  check('沒有未解析詞綴警告', !/⚠/.test(cli))
}

const log = lines.join('\n') + `\n${failed ? `FAILED ${failed}` : 'ALL PASS'}\n`
writeFileSync(join(dir, 'run.log'), log)
writeFileSync(join(dir, 'exit_code.txt'), failed ? '1' : '0')
process.stdout.write(log)
process.exit(failed ? 1 : 0)
