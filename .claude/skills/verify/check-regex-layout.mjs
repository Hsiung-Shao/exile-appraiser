// 設定 › 正則的版面(設計稿 P10 / P11):兩欄、數值條件區換欄、書籤頁兩張小卡。用法:node check-regex-layout.mjs <證據目錄>
// 讀 state-layout.json(內建瀏覽器 javascript_tool 的回傳值,欄位見下),寫 run.log 與 exit_code.txt。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const s = JSON.parse(readFileSync(join(dir, 'state-layout.json'), 'utf8'))
const checks = [
  ['寬版:清單在左、輸出在右(右欄 x 大於左欄)', s.wide.sideX > s.wide.colX && s.wide.outInSide === true],
  ['寬版:右欄寬度固定、左欄比右欄寬', s.wide.sideW < s.wide.colW],
  ['數值條件展開時在左欄清單上方', s.expanded === 'col'],
  ['數值條件收合時在右欄', s.collapsed === 'side'],
  ['收合 / 展開後鍵盤焦點仍在數值條件的標題鈕上', s.focus.every(f => f === 'section-toggle')],
  ['輸出語言是分段鈕(繁中 / English)', s.lang.join('|') === '繁中|English'],
  ['勾選詞綴後輸出框有字串', typeof s.query === 'string' && s.query.length > 0],
  ['窄版:單欄,輸出疊在清單上方', s.narrow.sideY < s.narrow.colY && Math.abs(s.narrow.sideX - s.narrow.colX) < 2],
  ['書籤頁:子分頁是底線樣式的 tab', s.bookmarks.tabs === 2],
  ['書籤頁:地圖詞綴檢查與書籤列並排', s.bookmarks.cardsSameRow === true],
  ['書籤頁:書籤列是開關', s.bookmarks.switchRole === 'switch'],
  ['沒有 renderer 錯誤', s.errors === 0]
]
const lines = checks.map(([n, ok]) => `${ok ? 'PASS' : 'FAIL'} ${n}`)
const code = checks.every(c => c[1]) ? 0 : 1
writeFileSync(join(dir, 'run.log'), lines.join('\n') + `\nRESULT: ${code ? 'FAIL' : 'PASS'}\n`)
writeFileSync(join(dir, 'exit_code.txt'), String(code))
console.log(lines.join('\n'))
process.exit(code)
